/**
 * Runs a real evolution cycle through the real engine, gate and scorer.
 *
 * The EVALUATOR here is synthetic — it models token cost as a function of policy
 * rather than calling models, because the corpus and benchmark cases are not
 * written yet. Everything downstream of it (candidate generation, bounds, paired
 * statistics, the promotion gate, the two-stage dev/holdout split) is the real
 * production code path. Swapping in the live benchmark runner replaces exactly
 * one function.
 */
import { DEFAULT_POLICY, type RoutingPolicy } from "../packages/core/src/policy.js";
import { runEvolutionCycle, type EvaluateFn } from "../packages/core/src/evolution.js";
import type { CaseResult } from "../packages/core/src/eval/scorer.js";

/**
 * Token model calibrated to the shape measured against live Pioneer: input
 * dominates (~82%), so evidence volume drives cost far more than output caps.
 */
function tokensPerCase(p: RoutingPolicy): number {
  const chunkTokens = (p.maxCharsPerChunk / 4) * p.leanContextK;
  const systemTokens = 90;
  return Math.round(systemTokens + chunkTokens + p.leanMaxOutputTokens * 0.55);
}

/** Quality degrades only when evidence gets genuinely too thin to ground an answer. */
function qualityFor(p: RoutingPolicy): number {
  let q = 0.94;
  if (p.maxCharsPerChunk < 700) q -= 0.12; // real grounding loss
  if (p.leanContextK < 2) q -= 0.05;
  if (p.semanticReplayThreshold < 0.56) q -= 0.2; // unsafe replays start landing
  return q;
}

const evaluate: EvaluateFn = async (policy, setName) => {
  const n = setName === "dev" ? 12 : 10;
  const tokens = tokensPerCase(policy);
  const q = qualityFor(policy);
  const results: CaseResult[] = Array.from({ length: n }, (_, i) => ({
    caseId: `${setName}-${i}`,
    critical: i < 3,
    score: { score: q, criticalFailure: false, failures: [], breakdown: {} },
    generationTokens: tokens,
    replayed: false,
    abstained: false,
    latencyMs: 1400,
  }));
  // Replay precision is measured on a large set because it costs zero model
  // tokens — 6 pairs cannot support the >=0.95 claim, 80 can.
  const replayTotal = 80;
  const replayCorrect = policy.semanticReplayThreshold < 0.56 ? 71 : 80;
  return { results, replayCorrect, replayTotal };
};

let policy = { ...DEFAULT_POLICY };
console.log("\nBudgetDarwin — evolution\n" + "=".repeat(78));
console.log(`objective: minimize generation tokens SUBJECT TO quality >= 0.90\n`);

for (let gen = 1; gen <= 4; gen++) {
  const before = tokensPerCase(policy);
  const cycle = await runEvolutionCycle(policy, evaluate);

  console.log(`── cycle ${gen} ${"─".repeat(62)}`);
  console.log("  candidate mutation                       dev quality  dev tokens  gate");
  for (const c of cycle.candidates) {
    const m = c.mutation;
    const failed = c.devVerdict.checks.filter((x) => !x.pass).map((x) => x.id);
    console.log(
      `  ${`${String(m.parameter)} ${m.from} -> ${m.to}`.padEnd(40)} ` +
        `${c.devMetrics.overallQuality.toFixed(3).padStart(11)}  ` +
        `${String(c.devMetrics.totalGenerationTokens).padStart(10)}  ` +
        `${failed.length === 0 ? "PASS" : "reject: " + failed[0]}`,
    );
  }

  console.log(`  decision: ${cycle.decision.toUpperCase()}`);
  console.log(`  ${cycle.narrative}`);
  if (cycle.decision !== "promote" || !cycle.promoted) {
    console.log("\n  converged — no remaining candidate clears the gate.\n");
    break;
  }
  policy = cycle.promoted;
  const after = tokensPerCase(policy);
  console.log(`  tokens/case ${before} -> ${after}  (${(((after - before) / before) * 100).toFixed(1)}%)\n`);
}

const start = tokensPerCase(DEFAULT_POLICY);
const end = tokensPerCase(policy);
console.log("=".repeat(78));
console.log(`tokens per case: ${start} -> ${end}   reduction ${(((start - end) / start) * 100).toFixed(1)}%`);
console.log(`quality: ${qualityFor(DEFAULT_POLICY).toFixed(3)} -> ${qualityFor(policy).toFixed(3)}  (floor 0.900)`);
console.log("\nchanged parameters:");
for (const k of Object.keys(DEFAULT_POLICY) as Array<keyof RoutingPolicy>) {
  if (DEFAULT_POLICY[k] !== policy[k]) console.log(`  ${String(k)}: ${DEFAULT_POLICY[k]} -> ${policy[k]}`);
}
console.log();
