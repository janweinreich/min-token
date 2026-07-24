/**
 * The point of these tests is adversarial: a token-minimizing search will find
 * every weakness in the rubric, so the rubric is tested by trying to cheat it.
 */
import { describe, expect, it } from "vitest";
import { BOUNDS, DEFAULT_POLICY, NON_MUTABLE, isWithinBounds, type RoutingPolicy } from "./policy.js";
import {
  DEFAULT_GATE,
  canPromote,
  generateCandidates,
  pairedDelta,
  runEvolutionCycle,
  type EvaluateFn,
} from "./evolution.js";
import { lengthBand, rescaleSimilarity, scoreAnswer, wilsonLowerBound, type BenchmarkCase, type CaseResult, type ScoredAnswer } from "./eval/scorer.js";

const CASE: BenchmarkCase = {
  id: "actian-install-js-01",
  setName: "dev",
  question: "What package installs the Actian JavaScript SDK?",
  taskType: "lookup",
  requiredFacts: ["@actian/vectorai-client"],
  requiredPatterns: ["npm install"],
  forbiddenFacts: ["actian-vectorai-client-python"],
  referenceAnswer:
    "Install the @actian/vectorai-client package from npm by running npm install @actian/vectorai-client in your project directory.",
  expectedSourceIds: ["actian-js-installation"],
  maxWords: 80,
  critical: true,
  answerable: true,
};

function answer(over: Partial<ScoredAnswer> = {}): ScoredAnswer {
  return {
    answer:
      "Install the @actian/vectorai-client package from npm by running npm install @actian/vectorai-client in your project directory.",
    citedSourceIds: ["actian-js-installation"],
    retrievedSourceIds: ["actian-js-installation", "actian-overview"],
    abstained: false,
    replayed: false,
    referenceCosine: 0.95,
    jsonParsed: true,
    ...over,
  };
}

describe("scorer closes the shortening exploit", () => {
  it("a full answer scores well", () => {
    const s = scoreAnswer(CASE, answer());
    expect(s.criticalFailure).toBe(false);
    expect(s.score).toBeGreaterThan(0.9);
  });

  it("keyword-soup that still contains every required fact is NOT cheap to produce", () => {
    // This is exactly what a token-minimizing policy converges on: the shortest
    // string containing all required facts plus a citation.
    const soup = scoreAnswer(
      CASE,
      answer({ answer: "@actian/vectorai-client npm install", referenceCosine: 0.66 }),
    );
    expect(soup.criticalFailure).toBe(true);
    expect(soup.failures).toContain("degenerate_length");
    // Under the spec's one-sided rubric this scored ~0.97 (facts 1.0, citations
    // 1.0, and length compliance IMPROVED because shorter is "compliant").
    expect(soup.score).toBeLessThan(0.7);
  });

  it("the length band penalises too-short exactly as it penalises too-long", () => {
    expect(lengthBand(60, 100, 120)).toBe(1);
    expect(lengthBand(30, 100, 120)).toBeLessThan(1); // too short is NOT free
    expect(lengthBand(200, 100, 120)).toBeLessThan(1);
  });

  it("unrelated fluent text collects no free similarity credit", () => {
    expect(rescaleSimilarity(0.5)).toBe(0); // the old rubric gave ~0.075 for this
    expect(rescaleSimilarity(0.85)).toBe(1);
  });
});

describe("scorer closes the abstain exploit", () => {
  it("abstaining on an answerable case is a critical failure, not a low score", () => {
    // ABSTAIN costs ~0 generation tokens, so without this "abstain on everything"
    // is the GLOBAL optimum of a token-minimizing search.
    const s = scoreAnswer(CASE, answer({ abstained: true, answer: "The corpus is insufficient." }));
    expect(s.criticalFailure).toBe(true);
    expect(s.failures).toContain("abstained_on_answerable");
  });

  it("abstaining correctly on an unanswerable case is rewarded", () => {
    const unanswerable: BenchmarkCase = {
      ...CASE,
      critical: false,
      answerable: false,
      requiredFacts: [],
      requiredPatterns: [],
      expectedSourceIds: [],
      referenceAnswer: "The verified corpus does not cover this.",
    };
    const s = scoreAnswer(
      unanswerable,
      answer({ abstained: true, answer: "The verified corpus does not cover this question.", referenceCosine: 0.9 }),
    );
    expect(s.criticalFailure).toBe(false);
  });
});

describe("scorer catches omission, not just commission", () => {
  it("a critical case missing its required facts fails outright", () => {
    const s = scoreAnswer(
      CASE,
      answer({ answer: "You should install the client library with your package manager as usual, following the docs.", referenceCosine: 0.8 }),
    );
    expect(s.criticalFailure).toBe(true);
    expect(s.failures.join()).toContain("critical_missing_facts");
  });

  it("citing a source that was never retrieved fails", () => {
    const s = scoreAnswer(CASE, answer({ citedSourceIds: ["invented-source"] }));
    expect(s.criticalFailure).toBe(true);
    expect(s.failures).toContain("cited_unretrieved_source");
  });

  it("replaying on a must-reject replay case is a critical failure", () => {
    const s = scoreAnswer({ ...CASE, mustRejectReplay: true }, answer({ replayed: true }));
    expect(s.criticalFailure).toBe(true);
    expect(s.failures).toContain("replayed_unsafe_memory");
  });
});

describe("candidate generation stays inside the bounds", () => {
  it("mutates exactly one parameter per candidate", () => {
    for (const c of generateCandidates(DEFAULT_POLICY, { max: 8 })) {
      const diff = (Object.keys(DEFAULT_POLICY) as Array<keyof RoutingPolicy>).filter(
        (k) => DEFAULT_POLICY[k] !== c.policy[k],
      );
      expect(diff).toEqual([c.mutation.parameter]);
    }
  });

  it("never produces an out-of-bounds policy", () => {
    for (const c of generateCandidates(DEFAULT_POLICY, { max: 20 })) {
      expect(isWithinBounds(c.policy)).toBe(true);
    }
  });

  it("never mutates a parameter the benchmark is structurally blind to", () => {
    const mutated = generateCandidates(DEFAULT_POLICY, { max: 20 }).map((c) => c.mutation.parameter);
    for (const forbidden of NON_MUTABLE) expect(mutated).not.toContain(forbidden);
  });

  it("explores the highest-leverage knobs first, within a small candidate budget", () => {
    // Regression: candidates were once generated in bounds-declaration order and
    // truncated at 5, which meant the loop explored five threshold knobs and NEVER
    // tried maxCharsPerChunk or leanContextK — the evidence knobs that dominate,
    // because input is ~82% of the token budget.
    const first = generateCandidates(DEFAULT_POLICY, { max: 3 }).map((c) => c.mutation.parameter);
    expect(first).toContain("maxCharsPerChunk");
    expect(first).toContain("leanContextK");
    expect(first).not.toContain("leanMaxOutputTokens"); // ~2.8% on lean cases only
  });

  it("keeps integer parameters integral", () => {
    for (const c of generateCandidates(DEFAULT_POLICY, { max: 20 })) {
      const b = BOUNDS[c.mutation.parameter];
      if (b?.integer) expect(Number.isInteger(c.mutation.to)).toBe(true);
    }
  });
});

// ── Gate behaviour ───────────────────────────────────────────────────────────

function results(spec: { n: number; score: number; tokens: number; critical?: boolean; abstained?: boolean }): CaseResult[] {
  return Array.from({ length: spec.n }, (_, i) => ({
    caseId: `c${i}`,
    critical: spec.critical ?? i < 3,
    score: { score: spec.score, criticalFailure: false, failures: [], breakdown: {} },
    generationTokens: spec.tokens,
    replayed: false,
    abstained: spec.abstained ?? false,
    latencyMs: 100,
  }));
}

describe("promotion gate", () => {
  const inc = results({ n: 12, score: 0.94, tokens: 1000 });

  it("promotes a genuine win: fewer tokens, quality intact", () => {
    const v = canPromote({
      candidate: results({ n: 12, score: 0.935, tokens: 800 }),
      incumbent: inc,
      replayCorrect: 80,
      replayTotal: 80,
      gate: DEFAULT_GATE,
    });
    expect(v.promote).toBe(true);
  });

  it("rejects a candidate that buys tokens with quality", () => {
    const v = canPromote({
      candidate: results({ n: 12, score: 0.86, tokens: 500 }),
      incumbent: inc,
      replayCorrect: 80,
      replayTotal: 80,
      gate: DEFAULT_GATE,
    });
    expect(v.promote).toBe(false);
    expect(v.checks.find((c) => c.id === "quality_floor")!.pass).toBe(false);
  });

  it("rejects a token win too small to distinguish from noise", () => {
    const v = canPromote({
      candidate: results({ n: 12, score: 0.94, tokens: 995 }), // 0.5% win
      incumbent: inc,
      replayCorrect: 80,
      replayTotal: 80,
      gate: DEFAULT_GATE,
    });
    expect(v.checks.find((c) => c.id === "token_win_exceeds_noise")!.pass).toBe(false);
  });

  it("rejects on a single badly-regressed case even when the mean looks fine", () => {
    const cand = results({ n: 12, score: 0.94, tokens: 800 });
    cand[0]!.score.score = 0.5; // one case collapses; mean barely moves
    const v = canPromote({
      candidate: cand,
      incumbent: inc,
      replayCorrect: 80,
      replayTotal: 80,
      gate: DEFAULT_GATE,
    });
    expect(v.checks.find((c) => c.id === "no_bad_single_regression")!.pass).toBe(false);
  });

  it("rejects when abstention was inflated to save tokens", () => {
    const v = canPromote({
      candidate: results({ n: 12, score: 0.94, tokens: 400, abstained: true }),
      incumbent: inc,
      replayCorrect: 80,
      replayTotal: 80,
      gate: DEFAULT_GATE,
    });
    expect(v.checks.find((c) => c.id === "abstain_not_inflated")!.pass).toBe(false);
  });

  it("six perfect replay pairs cannot support a >=0.95 precision claim", () => {
    expect(wilsonLowerBound(6, 6)).toBeLessThan(0.95); // the spec's set size
    expect(wilsonLowerBound(80, 80)).toBeGreaterThan(0.95);

    const v = canPromote({
      candidate: results({ n: 12, score: 0.94, tokens: 800 }),
      incumbent: inc,
      replayCorrect: 6,
      replayTotal: 6,
      gate: DEFAULT_GATE,
    });
    expect(v.checks.find((c) => c.id === "replay_precision")!.pass).toBe(false);
  });
});

describe("paired evaluation has power an unpaired comparison lacks", () => {
  it("collapses the standard error when most cases are unaffected", () => {
    const inc = results({ n: 20, score: 0.9, tokens: 1000 });
    const cand = results({ n: 20, score: 0.9, tokens: 800 });
    cand[0]!.score.score = 0.85; // exactly one case moves
    const p = pairedDelta(cand, inc);
    expect(p.worstCaseRegression).toBeCloseTo(0.05, 5);
    // 19 of 20 differences are exactly zero, so the loss bound stays tight.
    expect(p.upperLoss).toBeLessThan(0.02);
  });
});

describe("the full cycle", () => {
  const evaluator =
    (tokensFor: (p: RoutingPolicy) => number, scoreFor: (p: RoutingPolicy) => number): EvaluateFn =>
    async (policy, setName) => ({
      results: results({ n: setName === "dev" ? 12 : 10, score: scoreFor(policy), tokens: tokensFor(policy) }),
      replayCorrect: 80,
      replayTotal: 80,
    });

  it("promotes a mutation that genuinely saves tokens", async () => {
    // Fewer context chunks -> fewer input tokens, quality essentially flat.
    const cycle = await runEvolutionCycle(
      DEFAULT_POLICY,
      evaluator(
        (p) => 400 + p.maxCharsPerChunk / 2 + p.leanContextK * 100,
        () => 0.94,
      ),
    );
    expect(cycle.decision).toBe("promote");
    expect(cycle.promoted).toBeDefined();
    expect(cycle.narrative).toMatch(/holdout tokens/);
  });

  it("rejects everything when saving tokens costs quality", async () => {
    const cycle = await runEvolutionCycle(
      DEFAULT_POLICY,
      evaluator(
        (p) => 400 + p.maxCharsPerChunk / 2,
        // Any reduction in evidence tanks quality below the floor.
        (p) => (p.maxCharsPerChunk < DEFAULT_POLICY.maxCharsPerChunk ? 0.6 : 0.94),
      ),
    );
    expect(cycle.decision).toBe("reject");
    expect(cycle.promoted).toBeUndefined();
  });

  it("evaluates exactly one candidate against the holdout", async () => {
    const seen: Array<"dev" | "holdout"> = [];
    const cycle = await runEvolutionCycle(DEFAULT_POLICY, async (policy, setName) => {
      seen.push(setName);
      return {
        results: results({ n: 12, score: 0.94, tokens: 400 + policy.maxCharsPerChunk / 2 }),
        replayCorrect: 80,
        replayTotal: 80,
      };
    });
    expect(cycle.decision).toBe("promote");
    // Holdout is confirmatory: incumbent + winner only. Ranking candidates on the
    // holdout would turn it into a second dev set and the floor would stop meaning anything.
    expect(seen.filter((s) => s === "holdout")).toHaveLength(2);
  });
});
