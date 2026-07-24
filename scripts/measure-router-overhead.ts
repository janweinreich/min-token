/**
 * Does the LLM router pay for itself?
 *
 * The router is not free: it reads the distilled rules and emits a verdict, which
 * costs real tokens on a real model, every request. Those tokens are charged to
 * the same budget the router is trying to shrink. So the honest question is not
 * "does it pick a cheaper model" — it obviously does — but "does picking a
 * cheaper model save more than deciding to costs".
 *
 * This runs each question BOTH ways against the live API and reports the net.
 * A negative net is a real result and gets reported as one.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { routeWithLlm } from "../packages/core/src/train/llm-router.js";
import { LADDER, ROUTER_MODEL, rungOf } from "../packages/core/src/train/ladder.js";
import type { ClassRule } from "../packages/core/src/train/distil.js";

const BASE = process.env.PIONEER_BASE_URL ?? "https://api.pioneer.ai/v1";
const KEY = process.env.PIONEER_API_KEY ?? "";
if (!KEY) {
  console.error("PIONEER_API_KEY not set (source .env.local)");
  process.exit(1);
}

/** Deliberately spans the range: trivial lookups where overhead dominates,
 *  and heavy reasoning where a rung change moves real money. */
const QUESTIONS = [
  "How many continents are there on Earth?",
  "What is the chemical symbol for gold?",
  "What year did the Berlin Wall fall?",
  "Explain why the sky appears blue.",
  "What is the difference between a mutex and a semaphore?",
  "Compare orbital refuelling versus a single heavy-lift launch for a Mars cargo mission, and say which wins on cost.",
  "Walk through how you would design a rate limiter that is fair across tenants of very different sizes.",
  "Explain the trade-offs between optimistic and pessimistic concurrency control in a multi-region database.",
];

async function call(modelId: string, system: string, user: string, maxOut: number) {
  const res = await fetch(`${BASE}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: modelId,
      max_tokens: maxOut,
      system: [{ type: "text", text: system }],
      messages: [{ role: "user", content: user }],
      thinking: { type: "disabled" },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
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

const ANSWER_SYSTEM = "Answer the question directly and concisely from your own knowledge.";

function usd(modelId: string, inTok: number, outTok: number): number {
  const r = rungOf(modelId);
  return r ? (inTok * r.inUsd + outTok * r.outUsd) / 1_000_000 : 0;
}

async function main() {
  const { rules } = JSON.parse(await readFile("artifacts/routing-rules.json", "utf8")) as {
    rules: ClassRule[];
  };
  // The deterministic baseline the router has to beat. This is what the keyword
  // classifier picks today for an ungrounded question, by difficulty.
  const BASELINE = "claude-haiku-4-5";

  console.log(`router=${ROUTER_MODEL}  baseline=${BASELINE}  rules=${rules.length}`);
  console.log(`ladder: ${LADDER.map((r) => r.id).join(" < ")}\n`);

  let netTok = 0;
  let netUsd = 0;
  let wins = 0;
  const rows: Array<Record<string, unknown>> = [];

  for (const q of QUESTIONS) {
    const d = await routeWithLlm(q, rules, call, BASELINE);
    const routerTok = d.inputTokens + d.outputTokens;

    const [chosen, base] = await Promise.all([
      call(d.model, ANSWER_SYSTEM, q, 700),
      call(BASELINE, ANSWER_SYSTEM, q, 700),
    ]);

    const chosenTok = chosen.inputTokens + chosen.outputTokens;
    const baseTok = base.inputTokens + base.outputTokens;
    const withRouter = chosenTok + routerTok;

    const dTok = baseTok - withRouter;
    const dUsd =
      usd(BASELINE, base.inputTokens, base.outputTokens) -
      (usd(d.model, chosen.inputTokens, chosen.outputTokens) + d.costUsd);

    netTok += dTok;
    netUsd += dUsd;
    if (dTok > 0) wins++;
    rows.push({ question: q, picked: d.model, routerTokens: routerTok, answerTokens: chosenTok,
                withRouter, baselineTokens: baseTok, deltaTokens: dTok, deltaUsd: dUsd });

    console.log(`${q.slice(0, 58)}${q.length > 58 ? "…" : ""}`);
    console.log(
      `  picked ${d.model.padEnd(18)} router ${String(routerTok).padStart(4)} tok` +
        ` + answer ${String(chosenTok).padStart(4)} = ${String(withRouter).padStart(4)}` +
        `  vs baseline ${String(baseTok).padStart(4)}` +
        `  → ${dTok >= 0 ? "+" : ""}${dTok} tok, ${dUsd >= 0 ? "+" : ""}$${dUsd.toFixed(6)}`,
    );
  }

  console.log("\n─────────────────────────────────────────────────────────");
  console.log(`net tokens vs always-${BASELINE}: ${netTok >= 0 ? "+" : ""}${netTok} (${wins}/${QUESTIONS.length} questions won)`);
  console.log(`net cost:   ${netUsd >= 0 ? "+" : ""}$${netUsd.toFixed(5)}`);
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/router-overhead.json",
    JSON.stringify(
      { router: ROUTER_MODEL, baseline: BASELINE, questions: QUESTIONS.length,
        netTokens: netTok, netUsd, wins, rows },
      null, 2,
    ) + "\n",
  );
  console.log("wrote artifacts/router-overhead.json");

  console.log(
    netTok > 0
      ? "The router pays for itself ON TOKENS at this mix."
      : "The router COSTS more tokens than it saves at this mix.\n" +
        "  Its overhead is fixed per request while the saving scales with answer length,\n" +
        "  so it only pays on questions long enough to matter. Report the mix, not a headline.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
