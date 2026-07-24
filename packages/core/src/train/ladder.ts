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
 * Measured, because the obvious cheap choices do not work as routers:
 *   deepseek-v4-flash  500s from Pioneer on both compatible surfaces
 *   gpt-5-nano         consumed 384 output tokens and emitted an EMPTY string
 *                      (stop_reason max_tokens) — it is a reasoning model that
 *                      spends its whole budget thinking, so it can answer
 *                      cheaply but cannot be relied on to emit a routing verdict
 *   gpt-oss-20b        errored on the Messages surface
 *   claude-haiku-4-5   works: ~29 output tokens, valid JSON
 *
 * So the router is the cheapest rung that reliably EMITS, not the cheapest rung.
 * Override with ROUTER_MODEL once a cheaper one behaves.
 */
export const ROUTER_MODEL = process.env.ROUTER_MODEL ?? "claude-haiku-4-5";

export function costUsd(rung: Rung, inTok: number, outTok: number): number {
  return (inTok * rung.inUsd + outTok * rung.outUsd) / 1_000_000;
}

export function rungOf(id: string): Rung | undefined {
  return LADDER.find((r) => r.id === id);
}
