/**
 * The complete loop, end to end:
 *
 *   traffic -> episodes -> evolution cycle -> promoted policy -> SYNTHESIZED SKILL
 *                                                                      |
 *                        the routing skill an agent reads <------------+
 *
 * Emits skills/routing/SKILL.md and verifies the emitted skill actually matches
 * the router before writing it — a skill that misdescribes the code is worse than
 * no skill, because an agent would follow it.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { DEFAULT_POLICY, type RoutingPolicy } from "../packages/core/src/policy.js";
import { runEvolutionCycle, type EvaluateFn } from "../packages/core/src/evolution.js";
import type { CaseResult } from "../packages/core/src/eval/scorer.js";
import type { RetrievedChunk } from "../packages/core/src/ports.js";
import type { RequestFeatures } from "../packages/core/src/router.js";
import {
  assertSkillMatchesRouter,
  synthesizeRoutingSkill,
  type EpisodeRecord,
  type Probe,
} from "../packages/core/src/skill-synthesis.js";

// ── Simulated traffic. Lookups suit the cheap model; comparisons do not. ──────
const episodes: EpisodeRecord[] = [
  ...Array.from({ length: 22 }, () => ({ taskType: "lookup", route: "LEAN_RAG" as const, passed: true, repaired: false, similarity: 1, generationTokens: 420 })),
  ...Array.from({ length: 4 }, () => ({ taskType: "lookup", route: "STRONG_RAG" as const, passed: true, repaired: false, similarity: 1, generationTokens: 1150 })),
  ...Array.from({ length: 11 }, () => ({ taskType: "comparison", route: "LEAN_RAG" as const, passed: false, repaired: true, similarity: 1, generationTokens: 980 })),
  ...Array.from({ length: 7 }, () => ({ taskType: "comparison", route: "STRONG_RAG" as const, passed: true, repaired: false, similarity: 1, generationTokens: 1210 })),
  ...Array.from({ length: 5 }, () => ({ taskType: "code", route: "STRONG_RAG" as const, passed: true, repaired: false, similarity: 1, generationTokens: 1400 })),
];

const tokensPerCase = (p: RoutingPolicy) =>
  Math.round(90 + (p.maxCharsPerChunk / 4) * p.leanContextK + p.leanMaxOutputTokens * 0.55);
const qualityFor = (p: RoutingPolicy) => {
  let q = 0.94;
  if (p.maxCharsPerChunk < 700) q -= 0.12;
  if (p.leanContextK < 2) q -= 0.05;
  if (p.semanticReplayThreshold < 0.56) q -= 0.2;
  return q;
};

const evaluate: EvaluateFn = async (policy, setName) => {
  const n = setName === "dev" ? 12 : 10;
  const results: CaseResult[] = Array.from({ length: n }, (_, i) => ({
    caseId: `${setName}-${i}`,
    critical: i < 3,
    score: { score: qualityFor(policy), criticalFailure: false, failures: [], breakdown: {} },
    generationTokens: tokensPerCase(policy),
    replayed: false,
    abstained: false,
    latencyMs: 1400,
  }));
  return { results, replayCorrect: policy.semanticReplayThreshold < 0.56 ? 71 : 80, replayTotal: 80 };
};

// ── Probes: the documented decision procedure, checked against the real router ─
const ch = (id: string, score: number, text = "npm install @actian/vectorai-client"): RetrievedChunk => ({
  contentId: id, versionId: "v1", title: id, chunkIndex: 0, text, score,
});
const f = (over: Partial<RequestFeatures> = {}): RequestFeatures => ({
  questionChars: 60, taskType: "lookup", temporal: false, actionIntent: false,
  queryTerms: ["npm"], chunks: [ch("a", 0.9), ch("a", 0.85)], ...over,
});
const PROBES: Probe[] = [
  { name: "rule 2 code-before-abstain", features: f({ taskType: "code", chunks: [ch("a", 0.05, "x")], queryTerms: ["zzz"] }), expected: "AUTO_CODE" },
  { name: "rule 3 abstain", features: f({ chunks: [ch("a", 0.05, "x")], queryTerms: ["zzz"] }), expected: "ABSTAIN" },
  { name: "rule 4 lean", features: f(), expected: "LEAN_RAG" },
  { name: "rule 5 strong", features: f({ questionChars: 9999 }), expected: "STRONG_RAG" },
];
const EARNED = episodes.map((e) => ({ similarity: 1, route: e.route, passed: e.passed, repaired: e.repaired, taskType: e.taskType }));

// ── Run ──────────────────────────────────────────────────────────────────────
let policy = { ...DEFAULT_POLICY };
let version = 1;
let previous: RoutingPolicy | undefined;
let holdout: { before: any; after: any } | undefined;

console.log("\nGOAL  minimize generation tokens subject to quality >= 0.90\n");

for (let gen = 0; gen < 6; gen++) {
  const cycle = await runEvolutionCycle(policy, evaluate);
  const promoted = cycle.decision === "promote" && cycle.promoted;
  console.log(
    `cycle ${gen + 1}: ${cycle.decision.padEnd(7)} ${cycle.narrative.slice(0, 96)}`,
  );
  if (!promoted) break;
  previous = policy;
  policy = cycle.promoted!;
  version++;
  const before = { totalGenerationTokens: tokensPerCase(previous) * 10, overallQuality: qualityFor(previous), hardQuality: qualityFor(previous), criticalFailures: 0, n: 10, replayRate: 0, abstainRate: 0, p95LatencyMs: 1400 };
  const after = { totalGenerationTokens: tokensPerCase(policy) * 10, overallQuality: qualityFor(policy), hardQuality: qualityFor(policy), criticalFailures: 0, n: 10, replayRate: 0, abstainRate: 0, p95LatencyMs: 1400 };
  holdout = { before, after };
}

// The skill must describe the router that exists, or it must not be written.
const check = assertSkillMatchesRouter(policy, PROBES, EARNED);
if (!check.ok) {
  console.error("\nREFUSING TO WRITE SKILL — it does not match the router:");
  for (const m of check.mismatches) console.error(`  ${m.probe}: documented ${m.expected}, actual ${m.actual}`);
  process.exit(1);
}
console.log(`\nskill/router agreement verified on ${PROBES.length} probes`);

const skill = synthesizeRoutingSkill({
  policyVersion: version,
  policy,
  previousPolicy: previous,
  episodes,
  holdout,
  qualityFloor: 0.9,
  generatedAt: new Date(1784_920_000_000).toISOString(),
});

await mkdir("skills/routing", { recursive: true });
await writeFile("skills/routing/SKILL.md", skill + "\n", "utf8");

const start = tokensPerCase(DEFAULT_POLICY);
const end = tokensPerCase(policy);
console.log(
  `policy v1 -> v${version}   tokens/case ${start} -> ${end} (-${(((start - end) / start) * 100).toFixed(1)}%)  ` +
    `quality ${qualityFor(DEFAULT_POLICY).toFixed(3)} -> ${qualityFor(policy).toFixed(3)}`,
);
console.log(`wrote skills/routing/SKILL.md (${skill.split("\n").length} lines)\n`);
console.log("─".repeat(78));
console.log(skill);
