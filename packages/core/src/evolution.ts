/**
 * The self-improvement loop.
 *
 * Objective: minimize generation tokens SUBJECT TO a hard quality floor. Quality
 * is the constraint, tokens are what is minimized — which is what stops the
 * search from discovering that the cheapest agent is one that never answers.
 *
 * What evolves is a handful of bounded numbers, never code and never prompts.
 */
import { BOUNDS, NON_MUTABLE, clampToBounds, type RoutingPolicy } from "./policy.js";
import { aggregate, wilsonLowerBound, type AggregateMetrics, type CaseResult } from "./eval/scorer.js";

export interface Mutation {
  parameter: keyof RoutingPolicy;
  from: number;
  to: number;
  direction: "cheaper" | "safer";
}

export interface Candidate {
  policy: RoutingPolicy;
  mutation: Mutation;
}

/**
 * Neighbourhood around the incumbent, one parameter per candidate.
 *
 * One-at-a-time is deliberate: with a benchmark this small, a multi-parameter
 * mutation that wins tells you nothing about WHICH change earned it, so you
 * cannot build on it and cannot explain it on stage.
 */
/**
 * Explored in order of measured leverage, NOT declaration order.
 *
 * Input tokens are ~82% of the budget, so the evidence knobs dominate: cutting
 * maxCharsPerChunk from 1200 to 1100 across every generated answer dwarfs
 * anything done to output caps, where leanMaxOutputTokens is worth ~2.8% on lean
 * cases only and does the most quality damage per token saved.
 *
 * This ordering is load-bearing: with a candidate cap of 5 and declaration order,
 * the loop would have explored five threshold knobs and never once tried its best
 * lever.
 */
const LEVERAGE_ORDER: Array<keyof RoutingPolicy> = [
  "maxCharsPerChunk",
  "leanContextK",
  "strongContextK",
  "semanticReplayThreshold",
  "leanMinContextScore",
  "leanMinHistoricalSuccess",
  "leanCrossSourceGap",
  "semanticReplayMargin",
  "strongMaxOutputTokens",
  "leanMaxOutputTokens",
  "repairBelowQuality",
  "abstainBelowContextScore",
  "explorationEpsilon",
];

export function generateCandidates(
  incumbent: RoutingPolicy,
  opts: { max?: number; parameters?: Array<keyof RoutingPolicy> } = {},
): Candidate[] {
  const max = opts.max ?? 5;
  const declared = Object.keys(BOUNDS) as Array<keyof RoutingPolicy>;
  const ordered = [
    ...LEVERAGE_ORDER.filter((k) => declared.includes(k)),
    ...declared.filter((k) => !LEVERAGE_ORDER.includes(k)),
  ];
  const mutable = (opts.parameters ?? ordered).filter((k) => !NON_MUTABLE.includes(k));

  // "cheaper" is the direction that should reduce tokens for each knob.
  const cheaperDirection: Partial<Record<keyof RoutingPolicy, -1 | 1>> = {
    semanticReplayThreshold: -1, // replay more
    semanticReplayMargin: -1,
    leanMinContextScore: -1, // dare lean more often
    leanCrossSourceGap: -1,
    leanMinHistoricalSuccess: -1,
    leanContextK: -1, // send less evidence  <- high leverage: input is ~82% of tokens
    strongContextK: -1,
    maxCharsPerChunk: -1, // <- highest leverage knob in the whole policy
    leanMaxOutputTokens: -1, // low leverage (~2.8% on lean cases only)
    strongMaxOutputTokens: -1,
    repairBelowQuality: -1, // repair less often
    abstainBelowContextScore: 1,
    explorationEpsilon: -1,
  };

  const out: Candidate[] = [];
  for (const p of mutable) {
    if (out.length >= max) break;
    const b = BOUNDS[p];
    const dir = cheaperDirection[p];
    if (!b || !dir) continue;
    const from = incumbent[p] as number;
    const to = clampToBounds(p, from + dir * b.step);
    if (to === from) continue; // already at the bound
    out.push({
      policy: { ...incumbent, [p]: to },
      mutation: { parameter: p, from, to, direction: "cheaper" },
    });
  }
  return out;
}

// ── Paired statistics ────────────────────────────────────────────────────────

/** One-sided t quantiles at alpha=0.10, by degrees of freedom. */
const T90: Record<number, number> = {
  5: 1.476, 8: 1.397, 10: 1.372, 12: 1.356, 15: 1.341, 20: 1.325, 30: 1.31,
};
function tQuantile(df: number): number {
  if (df <= 0) return 3;
  const keys = Object.keys(T90).map(Number).sort((a, b) => a - b);
  for (const k of keys) if (df <= k) return T90[k]!;
  return 1.2816; // -> z as df grows
}

export interface PairedResult {
  meanDelta: number;
  se: number;
  worstCaseRegression: number;
  /** Upper bound on how much quality could really have been lost. */
  upperLoss: number;
}

/**
 * Paired over identical cases. At temperature 0 with a frozen fixture the
 * pipeline is deterministic, and most one-parameter mutations change behaviour on
 * only a few cases — the unaffected ones contribute a difference of exactly zero,
 * which collapses the standard error and is why paired testing has real power
 * here where an unpaired comparison has almost none.
 */
export function pairedDelta(candidate: CaseResult[], incumbent: CaseResult[]): PairedResult {
  const byId = new Map(incumbent.map((r) => [r.caseId, r]));
  const d: number[] = [];
  for (const c of candidate) {
    const i = byId.get(c.caseId);
    if (i) d.push(c.score.score - i.score.score);
  }
  const n = d.length || 1;
  const mean = d.reduce((s, x) => s + x, 0) / n;
  const variance = n > 1 ? d.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1) : 0;
  const se = Math.sqrt(variance / n);
  return {
    meanDelta: mean,
    se,
    worstCaseRegression: Math.max(0, ...d.map((x) => -x)),
    upperLoss: -mean + tQuantile(n - 1) * se,
  };
}

// ── The promotion gate ───────────────────────────────────────────────────────

export interface GateConfig {
  minOverallQuality: number;
  minHardQuality: number;
  /** Non-inferiority margin: how much paired quality loss is tolerable. */
  nonInferiorityMargin: number;
  maxSingleCaseRegression: number;
  minCaseQuality: number;
  minReplayPrecisionLB: number;
  /** Measured run-to-run token spread; the token win must exceed this. */
  sigmaRepeatTokens: number;
  maxAbstainRateIncrease: number;
  maxLatencyRatio: number;
}

export const DEFAULT_GATE: GateConfig = {
  minOverallQuality: 0.9,
  minHardQuality: 0.85,
  nonInferiorityMargin: 0.03,
  maxSingleCaseRegression: 0.15,
  minCaseQuality: 0.6,
  minReplayPrecisionLB: 0.95,
  sigmaRepeatTokens: 0,
  maxAbstainRateIncrease: 0.05,
  maxLatencyRatio: 1.1,
};

export interface GateVerdict {
  promote: boolean;
  checks: Array<{ id: string; pass: boolean; detail: string }>;
}

export function canPromote(input: {
  candidate: CaseResult[];
  incumbent: CaseResult[];
  replayCorrect: number;
  replayTotal: number;
  gate: GateConfig;
}): GateVerdict {
  const { gate } = input;
  const c = aggregate(input.candidate);
  const i = aggregate(input.incumbent);
  const paired = pairedDelta(input.candidate, input.incumbent);
  const replayLB = wilsonLowerBound(input.replayCorrect, input.replayTotal);
  const minCase = Math.min(1, ...input.candidate.map((r) => r.score.score));
  // The token win must clear measured noise, not an arbitrary 3%.
  const requiredWin = Math.max(gate.sigmaRepeatTokens * 3, i.totalGenerationTokens * 0.02);

  const checks = [
    { id: "no_critical_failures", pass: c.criticalFailures === 0, detail: `${c.criticalFailures}` },
    {
      id: "replay_precision",
      pass: replayLB >= gate.minReplayPrecisionLB,
      detail: `${input.replayCorrect}/${input.replayTotal} wilsonLB=${replayLB.toFixed(3)}`,
    },
    { id: "min_case_quality", pass: minCase >= gate.minCaseQuality, detail: minCase.toFixed(3) },
    {
      id: "no_bad_single_regression",
      pass: paired.worstCaseRegression <= gate.maxSingleCaseRegression,
      detail: paired.worstCaseRegression.toFixed(3),
    },
    {
      id: "non_inferior_quality",
      pass: paired.upperLoss <= gate.nonInferiorityMargin,
      detail: `upperLoss=${paired.upperLoss.toFixed(4)} <= ${gate.nonInferiorityMargin}`,
    },
    {
      id: "quality_floor",
      pass: c.overallQuality >= gate.minOverallQuality && c.hardQuality >= gate.minHardQuality,
      detail: `overall=${c.overallQuality.toFixed(3)} hard=${c.hardQuality.toFixed(3)}`,
    },
    {
      id: "token_win_exceeds_noise",
      pass: c.totalGenerationTokens <= i.totalGenerationTokens - requiredWin,
      detail: `${c.totalGenerationTokens} vs ${i.totalGenerationTokens} (need -${Math.round(requiredWin)})`,
    },
    {
      id: "abstain_not_inflated",
      pass: c.abstainRate <= i.abstainRate + gate.maxAbstainRateIncrease,
      detail: `${c.abstainRate.toFixed(2)} vs ${i.abstainRate.toFixed(2)}`,
    },
    {
      id: "latency",
      pass: c.p95LatencyMs <= i.p95LatencyMs * gate.maxLatencyRatio,
      detail: `${c.p95LatencyMs} vs ${i.p95LatencyMs}`,
    },
  ];

  return { promote: checks.every((x) => x.pass), checks };
}

// ── The cycle ────────────────────────────────────────────────────────────────

export interface EvaluateFn {
  (policy: RoutingPolicy, setName: "dev" | "holdout"): Promise<{
    results: CaseResult[];
    replayCorrect: number;
    replayTotal: number;
  }>;
}

export interface EvolutionCycle {
  incumbent: RoutingPolicy;
  candidates: Array<{
    mutation: Mutation;
    devMetrics: AggregateMetrics;
    devVerdict: GateVerdict;
  }>;
  winner?: { mutation: Mutation; policy: RoutingPolicy; holdoutVerdict: GateVerdict };
  decision: "promote" | "reject" | "no_candidates";
  promoted?: RoutingPolicy;
  narrative: string;
}

/**
 * Two-stage. The holdout is CONFIRMATORY ONLY: exactly one candidate is ever
 * evaluated against it, once. Ranking several candidates on the holdout would
 * make it a second dev set and the quality floor would stop meaning anything.
 */
export async function runEvolutionCycle(
  incumbent: RoutingPolicy,
  evaluate: EvaluateFn,
  gate: GateConfig = DEFAULT_GATE,
  maxCandidates = 5,
): Promise<EvolutionCycle> {
  const candidates = generateCandidates(incumbent, { max: maxCandidates });
  if (candidates.length === 0) {
    return { incumbent, candidates: [], decision: "no_candidates", narrative: "all parameters at their bounds" };
  }

  const devIncumbent = await evaluate(incumbent, "dev");
  const scored: EvolutionCycle["candidates"] = [];
  const survivors: Array<{ c: Candidate; tokens: number }> = [];

  for (const c of candidates) {
    const r = await evaluate(c.policy, "dev");
    const verdict = canPromote({
      candidate: r.results,
      incumbent: devIncumbent.results,
      replayCorrect: r.replayCorrect,
      replayTotal: r.replayTotal,
      gate,
    });
    const m = aggregate(r.results);
    scored.push({ mutation: c.mutation, devMetrics: m, devVerdict: verdict });
    if (verdict.promote) survivors.push({ c, tokens: m.totalGenerationTokens });
  }

  if (survivors.length === 0) {
    return {
      incumbent,
      candidates: scored,
      decision: "reject",
      narrative: `all ${candidates.length} candidates failed the dev gate`,
    };
  }

  survivors.sort((a, b) => a.tokens - b.tokens);
  const best = survivors[0]!.c;

  const holdIncumbent = await evaluate(incumbent, "holdout");
  const holdCandidate = await evaluate(best.policy, "holdout");
  const holdoutVerdict = canPromote({
    candidate: holdCandidate.results,
    incumbent: holdIncumbent.results,
    replayCorrect: holdCandidate.replayCorrect,
    replayTotal: holdCandidate.replayTotal,
    gate,
  });

  const hc = aggregate(holdCandidate.results);
  const hi = aggregate(holdIncumbent.results);
  const pct = hi.totalGenerationTokens
    ? ((1 - hc.totalGenerationTokens / hi.totalGenerationTokens) * 100).toFixed(1)
    : "0.0";

  return {
    incumbent,
    candidates: scored,
    winner: { mutation: best.mutation, policy: best.policy, holdoutVerdict },
    decision: holdoutVerdict.promote ? "promote" : "reject",
    promoted: holdoutVerdict.promote ? best.policy : undefined,
    narrative: holdoutVerdict.promote
      ? `${String(best.mutation.parameter)} ${best.mutation.from} -> ${best.mutation.to}: ` +
        `holdout tokens ${hi.totalGenerationTokens} -> ${hc.totalGenerationTokens} (-${pct}%), ` +
        `quality ${hi.overallQuality.toFixed(3)} -> ${hc.overallQuality.toFixed(3)}, ` +
        `critical failures ${hc.criticalFailures}`
      : `${String(best.mutation.parameter)} won on dev but failed the holdout gate: ` +
        holdoutVerdict.checks.filter((x) => !x.pass).map((x) => `${x.id}(${x.detail})`).join(", "),
  };
}
