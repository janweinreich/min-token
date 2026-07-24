/**
 * TRAINING MODE.
 *
 *   strong model answers  ->  cheap ladder answers  ->  strong model judges
 *        -> cheapest acceptable per question -> labelled examples -> skill
 *
 * Every call is real. The output is artifacts/training-examples.jsonl plus a
 * prescriptive routing table written into the skill, which the cheap LLM router
 * then reads at serve time.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { synthesizeRoutingSkill, type EpisodeRecord } from "../packages/core/src/skill-synthesis.js";
import { DEFAULT_POLICY } from "../packages/core/src/policy.js";
import { LADDER, REFERENCE_MODEL, ROUTER_MODEL } from "../packages/core/src/train/ladder.js";
import { aggregate, distilOne, type TrainingExample, type TrainingQuestion } from "../packages/core/src/train/distil.js";
import { synthesizeRouterPrompt } from "../packages/core/src/train/synthesize-prompt.js";
import { buildRouterPrompt } from "../packages/core/src/train/llm-router.js";
import { LocalContextProvider } from "../packages/core/src/adapters/local-context.js";
import { miniLmEmbedder } from "../packages/core/src/embeddings/minilm.js";
import { classifyTask } from "../packages/core/src/features.js";

const key = process.env.PIONEER_API_KEY;
if (!key) {
  console.error("PIONEER_API_KEY not set (source .env.local)");
  process.exit(1);
}
const BASE = process.env.PIONEER_BASE_URL ?? "https://api.pioneer.ai/v1";

/** Direct call by concrete model id — training bypasses the alias mapping. */
async function callByModel(modelId: string, system: string, user: string, maxOut: number) {
  const res = await fetch(`${BASE}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: modelId,
      max_tokens: maxOut,
      system: [{ type: "text", text: system }],
      messages: [{ role: "user", content: user }],
      thinking: { type: "disabled" },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`${modelId}: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
  const j = (await res.json()) as {
    content?: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  return {
    text: (j.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join(""),
    inputTokens: j.usage?.input_tokens ?? 0,
    outputTokens: j.usage?.output_tokens ?? 0,
  };
}

// ── Training set: corpus questions (with evidence) + general questions ───────
const knowledge = new LocalContextProvider("data/sources", miniLmEmbedder);
await knowledge.load();

const CORPUS_QS = [
  "What package installs the Actian JavaScript SDK?",
  "Which port does the Actian VectorAI gRPC endpoint listen on?",
  "Which HTTP header does the Pioneer API use for authentication?",
  "What is the difference between a Guild coded agent and an LLM agent?",
  "Why does Guild require a public HTTPS tunnel for local development?",
  "How does Pioneer report which model actually served a routed request?",
];
const GENERAL_QS = [
  "Give me a recipe for apple pie",
  "How do you build a model rocket?",
  "Explain the tradeoffs between microservices and a monolith",
  "What is the capital of France?",
];

const questions: TrainingQuestion[] = [];
for (const q of CORPUS_QS) {
  const chunks = await knowledge.searchContext({ query: q, maxResults: 2 });
  questions.push({
    id: q.slice(0, 40),
    question: q,
    taskType: classifyTask(q),
    evidence: chunks.map((c) => `[${c.contentId}] ${c.title}\n${c.text.slice(0, 1200)}`).join("\n\n"),
  });
}
for (const q of GENERAL_QS) {
  questions.push({ id: q.slice(0, 40), question: q, taskType: classifyTask(q) });
}

console.log(`\nTRAINING MODE`);
console.log(`  reference + judge : ${REFERENCE_MODEL}`);
console.log(`  ladder            : ${LADDER.map((r) => `${r.id} ($${r.inUsd}/$${r.outUsd})`).join("\n                      ")}`);
console.log(`  questions         : ${questions.length}`);
console.log(`  calls             : ~${questions.length * (LADDER.length + (LADDER.length - 1))} (answers + judgements)\n`);

const examples: TrainingExample[] = [];
for (const q of questions) {
  process.stdout.write(`  ${q.question.slice(0, 46).padEnd(48)}`);
  try {
    const e = await distilOne(q, callByModel);
    examples.push(e);
    const ok = e.candidates.filter((c) => c.acceptable).map((c) => c.model.split("/").pop());
    console.log(
      `${(e.cheapestAcceptable ?? "reference only").split("/").pop()!.padEnd(20)}` +
        `${e.savingVsReference ? `-${e.savingVsReference.pct.toFixed(0)}% cost` : "no cheaper option"}` +
        `   accepted: ${ok.join(", ") || "none"}`,
    );
  } catch (err) {
    console.log(`SKIPPED (${String(err).slice(0, 60)})`);
  }
}

await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/training-examples.jsonl",
  examples.map((e) => JSON.stringify(e)).join("\n") + "\n",
);

const rules = aggregate(examples);
console.log(`\nDISTILLED ROUTING RULES`);
console.log("  task class    n   recommended model         support  mean saving");
console.log("  " + "─".repeat(72));
for (const r of rules) {
  console.log(
    `  ${r.taskType.padEnd(13)} ${String(r.n).padStart(2)}   ${r.recommended.padEnd(24)} ` +
      `${(r.support * 100).toFixed(0).padStart(4)}%   ${r.meanSavingPct.toFixed(0).padStart(4)}%  ${r.confident ? "" : "(thin — held at reference)"}`,
  );
}

await writeFile(
  "artifacts/routing-rules.json",
  JSON.stringify({ measuredAt: new Date().toISOString(), referenceModel: REFERENCE_MODEL, routerModel: ROUTER_MODEL, rules }, null, 2) + "\n",
);

// ── Append the prescriptive table to the skill ───────────────────────────────
// ── Step 5: the reference model writes the router's prompt from the pairs ──
//
// The pairs are (question, class, which cheap model the judge accepted, why).
// Handing them to the reference model and asking it to write the routing prompt
// is what makes the prompt a LEARNED artifact instead of a fixed template: new
// traffic can change how the router reasons, not just the numbers it reads.
console.log("\nsynthesizing the router prompt from the training pairs...");
const synth = await synthesizeRouterPrompt(examples, callByModel, REFERENCE_MODEL, buildRouterPrompt(rules));
await writeFile("artifacts/router-prompt.md", synth.prompt + "\n", "utf8");
console.log(`  ${synth.source} (${synth.reason}) -> artifacts/router-prompt.md`);

const skillPath = "skills/routing/SKILL.md";

// The skill has exactly ONE writer: synthesizeRoutingSkill. This script used to
// append its table by hand, which meant the live agent's next regeneration
// deleted it — and, once the synthesizer learned to render the table itself, an
// append here would have truncated the non-negotiable rules that follow it.
// Two writers and a marker-based splice is how a file quietly loses sections.
const episodes: EpisodeRecord[] = (
  (JSON.parse(await readFile("artifacts/episodes.json", "utf8")) as {
    episodes?: Array<Record<string, unknown>>;
  }).episodes ?? []
).map((e) => ({
  similarity: Number(e.similarity ?? 0),
  route: e.route as EpisodeRecord["route"],
  passed: Boolean(e.passed),
  repaired: Boolean(e.repaired),
  taskType: String(e.taskType ?? "unknown"),
  generationTokens: Number(e.generationTokens ?? 0),
}));

await mkdir("skills/routing", { recursive: true });
await writeFile(
  skillPath,
  synthesizeRoutingSkill({
    policyVersion: 1,
    policy: DEFAULT_POLICY,
    episodes,
    qualityFloor: 0.9,
    generatedAt: new Date().toISOString(),
    distilled: rules,
    referenceModel: REFERENCE_MODEL,
  }) + "\n",
  "utf8",
);

const totalRef = examples.reduce((s, e) => s + e.referenceCostUsd, 0);
const totalBest = examples.reduce(
  (s, e) => s + (e.candidates.find((c) => c.model === e.cheapestAcceptable)?.costUsd ?? e.referenceCostUsd),
  0,
);
console.log(
  `\n  ${examples.length} examples -> artifacts/training-examples.jsonl` +
    `\n  rules -> artifacts/routing-rules.json, appended to ${skillPath}` +
    `\n\n  cost if everything used ${REFERENCE_MODEL}: $${totalRef.toFixed(6)}` +
    `\n  cost using the distilled choice          : $${totalBest.toFixed(6)}` +
    `\n  saving                                   : ${(((totalRef - totalBest) / totalRef) * 100).toFixed(1)}%\n`,
);
