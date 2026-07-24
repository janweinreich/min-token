/**
 * The policy is the thing that evolves. It is a small set of numbers with hard
 * bounds — never code, never prompts. That constraint is what makes a
 * self-modifying agent safe to run unattended.
 */
import type { ReplayPolicy } from "./replay-guard.js";

export interface RoutingPolicy extends ReplayPolicy {
  // ── When to dare use the cheap model ──
  leanMinContextScore: number;
  /** Score gap to the best chunk from a DIFFERENT source. Compatible with
   *  concentration, unlike the spec's raw top1-top2 gap which contradicted it. */
  leanCrossSourceGap: number;
  leanMinHistoricalSuccess: number;
  leanMaxQuestionChars: number;
  /** Similarity floor for a past episode to count toward the history estimate. */
  relatedThreshold: number;

  // ── How much evidence to send ──
  // Input is ~82% of the token budget, so THESE are the high-leverage knobs.
  leanContextK: number;
  strongContextK: number;
  maxCharsPerChunk: number;

  // ── Output budgets (low leverage: ~2.8% on lean cases only) ──
  leanMaxOutputTokens: number;
  strongMaxOutputTokens: number;

  // ── Repair and abstention ──
  repairBelowQuality: number;
  maximumRepairAttempts: number;
  abstainBelowContextScore: number;

  /** Fraction of eligible-but-unproven requests routed to lean anyway, so the
   *  history gate is not an absorbing state. Forced to 0 in benchmark mode. */
  explorationEpsilon: number;
}

export interface Bound {
  min: number;
  max: number;
  step: number;
  /** Integers must not be mutated into fractions. */
  integer?: boolean;
}

/**
 * Hard bounds. A mutation outside these is not generated, so the search can
 * never wander into a policy that is unsafe by construction.
 */
export const BOUNDS: Partial<Record<keyof RoutingPolicy, Bound>> = {
  semanticReplayThreshold: { min: 0.5, max: 0.9, step: 0.02 },
  semanticReplayMargin: { min: 0, max: 0.1, step: 0.01 },
  leanMinContextScore: { min: 0.2, max: 0.9, step: 0.05 },
  leanCrossSourceGap: { min: 0, max: 0.3, step: 0.02 },
  leanMinHistoricalSuccess: { min: 0.4, max: 0.9, step: 0.05 },
  leanContextK: { min: 1, max: 4, step: 1, integer: true },
  strongContextK: { min: 3, max: 6, step: 1, integer: true },
  maxCharsPerChunk: { min: 400, max: 1600, step: 100, integer: true },
  leanMaxOutputTokens: { min: 80, max: 320, step: 20, integer: true },
  strongMaxOutputTokens: { min: 180, max: 500, step: 20, integer: true },
  repairBelowQuality: { min: 0.6, max: 0.9, step: 0.02 },
  abstainBelowContextScore: { min: 0.1, max: 0.6, step: 0.05 },
  explorationEpsilon: { min: 0, max: 0.3, step: 0.05 },
};

/**
 * Deliberately NOT mutable: `minimumStoredQuality` and `maximumMemoryAgeDays`.
 * Their harm only materialises as memories accumulate, which the frozen
 * benchmark fixture is specifically constructed to prevent. Mutating a parameter
 * the evaluation is structurally blind to is unfalsifiable optimization — it
 * would burn candidate slots producing wins that cannot be wrong.
 */
export const NON_MUTABLE: ReadonlyArray<keyof RoutingPolicy> = [
  "minimumStoredQuality",
  "minimumCitationScore",
  "maximumMemoryAgeDays",
  "maximumRepairAttempts",
  "rawCosineFloor",
  "asymmetricThresholdBump",
  // Measured non-separable (scripts/measure-ungated.ts). Evolution optimises for
  // tokens, and turning this off would look like a large win while serving wrong
  // answers — exactly the trade the gate exists to forbid.
  "requireGateEvidence",
];

export const DEFAULT_POLICY: RoutingPolicy = {
  // replay (measured — see scripts/spike-embed.ts)
  semanticReplayThreshold: 0.62,
  semanticReplayMargin: 0.02,
  asymmetricThresholdBump: 0,
  requireGateEvidence: true,
  minimumStoredQuality: 0.92,
  minimumCitationScore: 1.0,
  maximumMemoryAgeDays: 30,
  rawCosineFloor: 0.35,

  // routing
  leanMinContextScore: 0.45,
  leanCrossSourceGap: 0.06,
  // 0.60 not the spec's 0.88: under a Beta lower bound with a pessimistic prior,
  // 0.88 needs ~35 clean successes before lean EVER fires — unreachable in a day.
  leanMinHistoricalSuccess: 0.6,
  leanMaxQuestionChars: 240,
  relatedThreshold: 0.5,

  leanContextK: 2,
  strongContextK: 4,
  maxCharsPerChunk: 1200,

  leanMaxOutputTokens: 160,
  strongMaxOutputTokens: 320,

  repairBelowQuality: 0.78,
  maximumRepairAttempts: 1,
  abstainBelowContextScore: 0.25,

  explorationEpsilon: 0.15,
};

export function clampToBounds(key: keyof RoutingPolicy, value: number): number {
  const b = BOUNDS[key];
  if (!b) return value;
  const v = Math.min(b.max, Math.max(b.min, value));
  return b.integer ? Math.round(v) : Number(v.toFixed(4));
}

export function isWithinBounds(p: RoutingPolicy): boolean {
  return (Object.keys(BOUNDS) as Array<keyof RoutingPolicy>).every((k) => {
    const b = BOUNDS[k]!;
    const v = p[k] as number;
    return v >= b.min && v <= b.max;
  });
}
