/**
 * The LLM router: a cheap model reads the distilled skill and picks the model.
 *
 * This is the piece that makes the skill an INPUT rather than only a readout.
 * The deterministic router still owns everything safety-related — replay, the
 * grounded/ungrounded split, abstention — because those must not be promptable.
 * All this decides is which rung answers, and it is bounded to the ladder.
 *
 * Economics, measured rather than assumed, because a router that costs more than
 * it saves is theatre. The prompt is the rules table plus one question: ~400 input
 * and ~30 output tokens. On claude-haiku-4-5 that is about $0.00055 per decision.
 * A lookup it moves from claude-sonnet-5 down to gpt-5-nano saves roughly $0.0017.
 * So it pays about 3x — real, but far tighter than it looks, and the margin only
 * exists because the router is itself cheap.
 *
 * The deterministic router costs ZERO, so this is an addition, not a replacement.
 * Its value is generalising to questions the keyword classifier has no class for.
 */
import { LADDER, ROUTER_MODEL } from "./ladder.js";
import type { ClassRule } from "./distil.js";

export interface RouterDecision {
  model: string;
  reason: string;
  /** How the choice was reached. `fallback` means the LLM did not give a usable answer. */
  source: "llm" | "fallback";
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

export type RouterCall = (
  modelId: string,
  system: string,
  user: string,
  maxOut: number,
) => Promise<{ text: string; inputTokens: number; outputTokens: number }>;

export function buildRouterPrompt(rules: ClassRule[]): string {
  const allowed = LADDER.map((r) => `${r.id} ($${r.inUsd}/$${r.outUsd} per MTok)`).join("\n  ");
  const table = rules
    .map(
      (r) =>
        `  ${r.taskType.padEnd(12)} -> ${r.recommended}` +
        `  (learned from ${r.n} judged examples, accepted on ${(r.support * 100).toFixed(0)}%` +
        `${r.confident ? "" : ", TOO FEW — prefer the strongest model"})`,
    )
    .join("\n");

  return `You choose which model should answer a question. Cheapest model that will still produce a good answer wins.

MODELS, cheapest first:
  ${allowed}

LEARNED ROUTING, distilled by having a strong model judge whether cheaper answers were good enough:
${table}

How to choose:
- Match the question to the closest task class above and start from its model.
- Move UP the ladder if the question needs multi-step reasoning, synthesis across
  several ideas, careful trade-off analysis, or precise domain facts where a
  mistake matters.
- Stay cheap for simple lookups, definitions, short factual answers and
  well-known general knowledge.
- If a class is marked TOO FEW, do not trust it; prefer a stronger model.

Reply with ONLY compact JSON, no prose and no code fence:
{"model": "<exact id from the list>", "why": "<10 words or fewer>"}`;
}

export async function routeWithLlm(
  question: string,
  rules: ClassRule[],
  call: RouterCall,
  fallbackModel: string,
): Promise<RouterDecision> {
  const t0 = Date.now();
  const rung = LADDER.find((r) => r.id === ROUTER_MODEL);
  try {
    const r = await call(ROUTER_MODEL, buildRouterPrompt(rules), question, 60);
    // Strip a markdown fence first — haiku reliably wraps JSON in ```json.
    const cleaned = r.text.replace(/```(?:json)?/gi, "");
    const m = /\{[\s\S]*?\}/.exec(cleaned);
    const parsed = m ? (JSON.parse(m[0]) as { model?: unknown; why?: unknown }) : null;
    const picked = typeof parsed?.model === "string" ? parsed.model.trim() : "";

    // Bounded to the ladder. A router that can name any string is a router that
    // can be talked into naming an expensive one — or a nonexistent one.
    const valid = LADDER.some((x) => x.id === picked);
    const cost = rung ? (r.inputTokens * rung.inUsd + r.outputTokens * rung.outUsd) / 1_000_000 : 0;

    return {
      model: valid ? picked : fallbackModel,
      reason: valid
        ? typeof parsed?.why === "string"
          ? parsed.why.slice(0, 60)
          : "chosen by router"
        : `router returned "${picked.slice(0, 24)}" which is not on the ladder`,
      source: valid ? "llm" : "fallback",
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costUsd: cost,
      latencyMs: Date.now() - t0,
    };
  } catch (e) {
    // The router failing must never fail the request. Fall back to the
    // deterministic choice, which is always available and never throws.
    return {
      model: fallbackModel,
      reason: `router unavailable (${String(e).slice(0, 40)})`,
      source: "fallback",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      latencyMs: Date.now() - t0,
    };
  }
}
