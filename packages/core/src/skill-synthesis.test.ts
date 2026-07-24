import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, type RoutingPolicy } from "./policy.js";
import type { RetrievedChunk } from "./ports.js";
import type { RequestFeatures } from "./router.js";
import {
  assertSkillMatchesRouter,
  summarizeEpisodes,
  synthesizeRoutingSkill,
  type EpisodeRecord,
  type Probe,
} from "./skill-synthesis.js";

function chunk(contentId: string, score: number, text = "npm install @actian/vectorai-client"): RetrievedChunk {
  return { contentId, versionId: "v1", title: contentId, chunkIndex: 0, text, score };
}

function features(over: Partial<RequestFeatures> = {}): RequestFeatures {
  return {
    questionChars: 60,
    taskType: "lookup",
    temporal: false,
    actionIntent: false,
    queryTerms: ["npm"],
    chunks: [chunk("a", 0.9), chunk("a", 0.85)],
    ...over,
  };
}

/** The decision procedure exactly as the skill documents it. */
const PROBES: Probe[] = [
  {
    name: "rule 2 — code beats abstention even on weak evidence",
    features: features({ taskType: "code", chunks: [chunk("a", 0.05, "unrelated")], queryTerms: ["zzz"] }),
    expected: "AUTO_CODE",
  },
  {
    name: "rule 3 — abstain on weak evidence AND poor coverage",
    features: features({ chunks: [chunk("a", 0.05, "unrelated")], queryTerms: ["zzz"] }),
    expected: "ABSTAIN",
  },
  {
    name: "rule 4 — lean when every condition holds and history has been earned",
    features: features(),
    expected: "LEAN_RAG",
  },
  {
    name: "rule 5 — strong when the question is too long for lean",
    features: features({ questionChars: 9999 }),
    expected: "STRONG_RAG",
  },
  {
    name: "rule 4 — temporal questions never take the lean route",
    features: features({ temporal: true }),
    expected: "STRONG_RAG",
  },
];

/** Enough clean lean history for rule 4's lower bound to clear its threshold. */
const EARNED = Array.from({ length: 30 }, () => ({
  similarity: 1,
  route: "LEAN_RAG" as const,
  passed: true,
  repaired: false,
}));

describe("the skill describes the router that actually exists", () => {
  it("matches real router behaviour on every documented rule", () => {
    const r = assertSkillMatchesRouter(DEFAULT_POLICY, PROBES, EARNED);
    expect(r.mismatches).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("detects divergence when the policy no longer matches the documented rule", () => {
    // Close the lean route entirely; the "rule 4 -> LEAN_RAG" probe must now fail.
    const closed: RoutingPolicy = { ...DEFAULT_POLICY, leanMinContextScore: 0.99 };
    const r = assertSkillMatchesRouter(closed, PROBES, EARNED);
    expect(r.ok).toBe(false);
    expect(r.mismatches.map((m) => m.probe).join()).toContain("rule 4");
  });
});

describe("the skill is derived, not authored", () => {
  const base = {
    policyVersion: 1,
    policy: DEFAULT_POLICY,
    episodes: [] as EpisodeRecord[],
    qualityFloor: 0.9,
    generatedAt: "2026-07-24T12:00:00Z",
  };

  it("states the goal as constrained optimization, not 'get better'", () => {
    const md = synthesizeRoutingSkill(base);
    expect(md).toContain("subject to");
    expect(md).toMatch(/quality is the constraint/i);
  });

  it("carries the actual policy numbers into the prose", () => {
    const md = synthesizeRoutingSkill(base);
    expect(md).toContain(String(DEFAULT_POLICY.maxCharsPerChunk));
    expect(md).toContain(String(DEFAULT_POLICY.leanContextK));
    expect(md).toContain(String(DEFAULT_POLICY.semanticReplayThreshold));
  });

  it("changes when the policy changes — the doc cannot go stale", () => {
    const evolved: RoutingPolicy = { ...DEFAULT_POLICY, maxCharsPerChunk: 800 };
    const before = synthesizeRoutingSkill(base);
    const after = synthesizeRoutingSkill({ ...base, policy: evolved, policyVersion: 2 });
    expect(after).not.toBe(before);
    expect(after).toContain("800");
  });

  it("reports what changed between versions with holdout evidence", () => {
    const evolved: RoutingPolicy = { ...DEFAULT_POLICY, maxCharsPerChunk: 800 };
    const md = synthesizeRoutingSkill({
      ...base,
      policyVersion: 2,
      policy: evolved,
      previousPolicy: DEFAULT_POLICY,
      holdout: {
        before: { n: 10, overallQuality: 0.94, hardQuality: 0.94, criticalFailures: 0, totalGenerationTokens: 7780, replayRate: 0, abstainRate: 0, p95LatencyMs: 1400 },
        after: { n: 10, overallQuality: 0.94, hardQuality: 0.94, criticalFailures: 0, totalGenerationTokens: 5780, replayRate: 0, abstainRate: 0, p95LatencyMs: 1400 },
      },
    });
    expect(md).toContain("maxCharsPerChunk");
    expect(md).toContain("1200 → 800");
    expect(md).toMatch(/7780 → 5780/);
    expect(md).toContain("25.7%");
  });

  it("keeps the non-negotiable safety rules regardless of what evolved", () => {
    const md = synthesizeRoutingSkill(base);
    expect(md).toMatch(/never abstain on a question the corpus can answer/i);
    expect(md).toMatch(/count every attempt/i);
  });
});

describe("learning from traffic", () => {
  const ep = (taskType: string, route: "LEAN_RAG" | "STRONG_RAG", passed: boolean, repaired: boolean, tokens: number): EpisodeRecord => ({
    taskType,
    route,
    passed,
    repaired,
    similarity: 1,
    generationTokens: tokens,
  });

  const episodes: EpisodeRecord[] = [
    ...Array.from({ length: 20 }, () => ep("lookup", "LEAN_RAG", true, false, 400)),
    ...Array.from({ length: 3 }, () => ep("lookup", "STRONG_RAG", true, false, 1100)),
    // Comparison questions keep failing on lean and having to be repaired.
    ...Array.from({ length: 10 }, () => ep("comparison", "LEAN_RAG", false, true, 900)),
    ...Array.from({ length: 6 }, () => ep("comparison", "STRONG_RAG", true, false, 1200)),
  ];

  it("recommends lean where lean has actually been working", () => {
    const ev = summarizeEpisodes(episodes, DEFAULT_POLICY);
    const lookup = ev.find((e) => e.taskType === "lookup")!;
    expect(lookup.recommendation).toBe("prefer_lean");
    expect(lookup.leanSuccessLCB).toBeGreaterThan(DEFAULT_POLICY.leanMinHistoricalSuccess);
  });

  it("recommends skipping lean where lean keeps needing repair", () => {
    const ev = summarizeEpisodes(episodes, DEFAULT_POLICY);
    const cmp = ev.find((e) => e.taskType === "comparison")!;
    expect(cmp.recommendation).toBe("prefer_strong");
    // This is the retry-tax lesson: the lean attempt was not cheaper once it
    // failed and escalated.
    expect(cmp.leanCleanSuccesses).toBe(0);
  });

  it("withholds a recommendation on thin evidence instead of guessing", () => {
    const thin = [ep("debug", "LEAN_RAG", true, false, 300), ep("debug", "STRONG_RAG", true, false, 900)];
    const ev = summarizeEpisodes(thin, DEFAULT_POLICY);
    expect(ev.find((e) => e.taskType === "debug")!.recommendation).toBe("insufficient_evidence");
  });

  it("writes the learned routing into the skill document", () => {
    const md = synthesizeRoutingSkill({
      policyVersion: 3,
      policy: DEFAULT_POLICY,
      episodes,
      qualityFloor: 0.9,
      generatedAt: "2026-07-24T12:00:00Z",
    });
    expect(md).toContain("What I have learned from traffic");
    expect(md).toMatch(/use lean/);
    expect(md).toMatch(/skip lean/);
    expect(md).toMatch(/retry tax/i);
  });

  it("says the lean route stays closed until it is earned, when there is no history", () => {
    const md = synthesizeRoutingSkill({
      policyVersion: 1,
      policy: DEFAULT_POLICY,
      episodes: [],
      qualityFloor: 0.9,
      generatedAt: "2026-07-24T12:00:00Z",
    });
    expect(md).toMatch(/earn/i);
    expect(md).toMatch(/pessimistic prior/i);
  });
});
