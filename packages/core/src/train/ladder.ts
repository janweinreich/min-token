/**
 * The model ladder used by training mode, cheapest first.
 *
 * Prices are Pioneer's own published per-MTok rates (GET /v1/models). "Cheapest
 * acceptable" is decided against these, so a label means "this model was good
 * enough AND costs less", not merely "this model was good enough".
 */
export interface Rung {
  id: string;
  inUsd: number;
  outUsd: number;
  /** Which pipeline alias this rung stands in for, when one applies. */
  alias?: "lean" | "strong";
}

export const LADDER: Rung[] = [
  { id: "gpt-5-nano", inUsd: 0.05, outUsd: 0.4 },
  { id: "openai/gpt-oss-20b", inUsd: 0.0721, outUsd: 0.309 },
  { id: "claude-haiku-4-5", inUsd: 1.0, outUsd: 5.0, alias: "lean" },
  { id: "claude-sonnet-5", inUsd: 2.0, outUsd: 10.0, alias: "strong" },
];

/** The reference and judge. Deliberately the top of the ladder. */
export const REFERENCE_MODEL = "claude-sonnet-5";

/**
 * The model that READS the skill and routes at serve time.
 *
 * Measured, and the first measurement was WRONG in an instructive way.
 *
 * gpt-5-nano was originally ruled out: at max_tokens 60 it burned its whole
 * budget and returned an EMPTY string with stop_reason max_tokens, which read as
 * "this model cannot emit a verdict". It was actually "this model was cut off
 * mid-thought". Truncation and refusal are indistinguishable from the outside —
 * both are an empty body — and that ambiguity cost a 20x cheaper router.
 *
 * Given 300 tokens of headroom it emits valid JSON in ~37 output tokens.
 *
 *   deepseek-v4-flash  still 500s from Pioneer (the id resolves; the call fails)
 *   gpt-oss-20b        errors on the Messages surface
 *   claude-haiku-4-5   works, and is 20x the price of nano
 *   gpt-5-nano         works with headroom — $0.05/$0.40 vs haiku's $1/$5
 *
 * Override with ROUTER_MODEL. Any replacement must be given ROUTER_MAX_TOKENS
 * of room, or it will look broken when it is merely truncated.
 */
export const ROUTER_MODEL = process.env.ROUTER_MODEL ?? "gpt-5-nano";

/**
 * Headroom for the routing verdict. NOT a cost lever — a reasoning model that
 * hits this cap returns nothing at all, so trimming it does not save tokens, it
 * discards the request. Only ~37 of these are typically billed.
 */
export const ROUTER_MAX_TOKENS = Number(process.env.ROUTER_MAX_TOKENS ?? 300);

export function costUsd(rung: Rung, inTok: number, outTok: number): number {
  return (inTok * rung.inUsd + outTok * rung.outUsd) / 1_000_000;
}

export function rungOf(id: string): Rung | undefined {
  return LADDER.find((r) => r.id === id);
}
