/**
 * Run the whole training loop on ONE question, live, and return every step.
 *
 * `pnpm train` does this in bulk offline, which is the right way to actually
 * learn but the wrong way to show what learning IS. This endpoint runs the same
 * functions on a single question and returns the intermediate state that the
 * batch script throws away: every model's actual answer, the judge's verdict on
 * each one, which rung won and why, what that did to the rules, and — when the
 * evidence has changed enough to be worth it — the re-synthesized router prompt.
 *
 * It is deliberately expensive: one reference answer, one answer per cheaper
 * rung, one judge call per candidate. That cost is the point. Training is what
 * you pay once so that serving can be cheap, and the panel shows both numbers.
 */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { aggregate, distilOne, type TrainingExample } from "../../../packages/core/src/train/distil.js";
import { synthesizeRouterPrompt } from "../../../packages/core/src/train/synthesize-prompt.js";
import { buildRouterPrompt } from "../../../packages/core/src/train/llm-router.js";
import { REFERENCE_MODEL } from "../../../packages/core/src/train/ladder.js";
import { classifyTask } from "../../../packages/core/src/features.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BASE = process.env.PIONEER_BASE_URL ?? "https://api.pioneer.ai/v1";

async function callByModel(modelId: string, system: string, user: string, maxOut: number) {
  const res = await fetch(`${BASE}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.PIONEER_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: maxOut,
      system: [{ type: "text", text: system }],
      messages: [{ role: "user", content: user }],
      thinking: { type: "disabled" },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const j = (await res.json()) as {
    content?: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
    error?: unknown;
  };
  if (!res.ok || !j.content) throw new Error(`${modelId}: ${JSON.stringify(j.error ?? j).slice(0, 140)}`);
  return {
    text: (j.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join(""),
    inputTokens: j.usage?.input_tokens ?? 0,
    outputTokens: j.usage?.output_tokens ?? 0,
  };
}

/** Re-synthesizing on every question would cost more than it teaches. */
const RESYNTH_EVERY = 3;

export async function POST(req: Request) {
  try {
    const { question } = (await req.json()) as { question?: string };
    if (!question?.trim()) return Response.json({ error: "question is required" }, { status: 400 });

    const example = await distilOne(
      { id: question.slice(0, 40), question: question.trim(), taskType: classifyTask(question) },
      callByModel,
    );

    await mkdir("artifacts", { recursive: true });
    await appendFile("artifacts/training-examples.jsonl", JSON.stringify(example) + "\n", "utf8");

    const all: TrainingExample[] = (await readFile("artifacts/training-examples.jsonl", "utf8"))
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as TrainingExample);

    // Snapshot the rules BEFORE this example so the change is recordable.
    // "What the agent knows" is a state; "what it just learned" is a diff, and
    // only the diff shows evolution.
    const before = aggregate(all.slice(0, -1));
    const rules = aggregate(all);
    const changes: Array<{ taskType: string; from: string | null; to: string; n: number; kind: string }> = [];
    for (const r of rules) {
      const b = before.find((x) => x.taskType === r.taskType);
      if (!b) changes.push({ taskType: r.taskType, from: null, to: r.recommended, n: r.n, kind: "new class" });
      else if (b.recommended !== r.recommended)
        changes.push({ taskType: r.taskType, from: b.recommended, to: r.recommended, n: r.n, kind: "route changed" });
      else if (!b.confident && r.confident)
        changes.push({ taskType: r.taskType, from: b.recommended, to: r.recommended, n: r.n, kind: "now confident" });
    }

    await writeFile(
      "artifacts/routing-rules.json",
      JSON.stringify({ generatedAt: new Date().toISOString(), rules }, null, 2) + "\n",
      "utf8",
    );

    // The prompt is only rewritten when enough new evidence has accumulated to
    // plausibly change it. Rewriting it per question would be a synthesis call
    // per question to restate the same conclusion.
    let promptUpdated = false;
    let prompt = "";
    if (all.length % RESYNTH_EVERY === 0) {
      const synth = await synthesizeRouterPrompt(all, callByModel, REFERENCE_MODEL, buildRouterPrompt(rules));
      await writeFile("artifacts/router-prompt.md", synth.prompt + "\n", "utf8");
      promptUpdated = synth.source === "synthesized";
      prompt = synth.prompt;
    } else {
      prompt = await readFile("artifacts/router-prompt.md", "utf8").catch(() => "");
    }

    // The learning log is the agent's own history. Without it every reload
    // looks like the first question it has ever seen.
    await appendFile(
      "artifacts/learning-log.jsonl",
      JSON.stringify({
        at: new Date().toISOString(),
        question: example.question,
        taskType: example.taskType,
        winner: example.cheapestAcceptable,
        rejected: example.candidates.filter((c) => !c.acceptable).map((c) => c.model),
        savingPct: example.savingVsReference?.pct ?? 0,
        trainingSetSize: all.length,
        changes,
        promptRewritten: promptUpdated,
      }) + "\n",
      "utf8",
    );

    const refCandidate = {
      model: example.referenceModel,
      totalTokens: example.referenceTokens,
      costUsd: example.referenceCostUsd,
    };

    return Response.json({
      question: example.question,
      taskType: example.taskType,
      reference: refCandidate,
      candidates: example.candidates,
      winner: example.cheapestAcceptable,
      saving: example.savingVsReference,
      trainingSetSize: all.length,
      rules,
      changes,
      promptUpdated,
      resynthEvery: RESYNTH_EVERY,
      untilResynth: (RESYNTH_EVERY - (all.length % RESYNTH_EVERY)) % RESYNTH_EVERY,
      prompt,
      // What this cost, so the panel can be honest that training is not free.
      trainingCostUsd:
        example.referenceCostUsd + example.candidates.reduce((s, c) => s + c.costUsd, 0),
      trainingTokens:
        example.referenceTokens + example.candidates.reduce((s, c) => s + c.totalTokens, 0),
    });
  } catch (e) {
    return Response.json({ error: String(e).slice(0, 500) }, { status: 500 });
  }
}
