/**
 * The benchmark scorer. This rubric is what the evolution loop optimizes against,
 * so every weakness in it becomes a strategy the loop will discover.
 *
 * Two exploits are closed here explicitly:
 *
 *  1. SHORTENING. Under the spec's rubric, terser output barely moves the score:
 *     required facts are substring-matched so the shortest string containing them
 *     still scores 1.0; citations cost ~5 tokens and are unchanged; and
 *     format-and-length compliance IMPROVES because shorter is scored compliant.
 *     Net cost of gutting an answer is ~3 points — cheap enough that a
 *     token-minimizing search takes it every time. Fixed with a TWO-SIDED length
 *     band, so too-short is penalised exactly like too-long.
 *
 *  2. FREE CREDIT. Raw cosine to the reference gives ~0.45-0.55 for any unrelated
 *     technical English, so every answer collected ~0.075 for nothing and the
 *     rubric floor for garbage sat near 0.40, not 0. Fixed by rescaling similarity
 *     so the floor is a real zero.
 */
export interface BenchmarkCase {
  id: string;
  setName: "dev" | "holdout" | "replay";
  question: string;
  taskType: string;
  requiredFacts: string[];
  requiredPatterns?: string[];
  forbiddenFacts: string[];
  referenceAnswer: string;
  expectedSourceIds: string[];
  maxWords: number;
  critical: boolean;
  /** For replay-safety cases: replaying at all is a critical failure. */
  mustRejectReplay?: boolean;
  /** True when the corpus genuinely supports an answer; abstaining here is a failure. */
  answerable?: boolean;
}

export interface ScoredAnswer {
  answer: string;
  citedSourceIds: string[];
  retrievedSourceIds: string[];
  abstained: boolean;
  replayed: boolean;
  /** Cosine to the reference answer, supplied by the caller (local embeddings). */
  referenceCosine: number;
  jsonParsed: boolean;
}

export interface Score {
  score: number;
  criticalFailure: boolean;
  failures: string[];
  breakdown: Record<string, number>;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function factCoverage(answer: string, facts: string[]): { ratio: number; missing: string[] } {
  if (facts.length === 0) return { ratio: 1, missing: [] };
  const a = norm(answer);
  const missing = facts.filter((f) => !a.includes(norm(f)));
  return { ratio: (facts.length - missing.length) / facts.length, missing };
}

/**
 * Two-sided. Below 0.6x the reference length the score falls off linearly, which
 * is what removes the "shorter is free" gradient the loop would otherwise climb.
 */
export function lengthBand(words: number, refWords: number, maxWords: number): number {
  const floor = 0.6 * refWords;
  if (words < floor) return Math.max(0, words / Math.max(1, floor));
  if (words <= maxWords) return 1;
  return Math.max(0, 1 - (words - maxWords) / maxWords);
}

/** Rescale so unrelated-but-fluent text scores 0, not 0.5. */
export function rescaleSimilarity(cos: number): number {
  return Math.max(0, Math.min(1, (cos - 0.5) / 0.35));
}

export function scoreAnswer(c: BenchmarkCase, a: ScoredAnswer): Score {
  const failures: string[] = [];
  const words = a.answer.trim().split(/\s+/).filter(Boolean).length;

  const { ratio: F, missing } = factCoverage(a.answer, c.requiredFacts);
  const P =
    !c.requiredPatterns || c.requiredPatterns.length === 0
      ? 1
      : c.requiredPatterns.filter((p) => new RegExp(p, "i").test(a.answer)).length /
        c.requiredPatterns.length;

  const citationValidity = a.citedSourceIds.every((id) => a.retrievedSourceIds.includes(id)) ? 1 : 0;
  const citationCoverage =
    c.expectedSourceIds.length === 0
      ? 1
      : c.expectedSourceIds.filter((id) => a.citedSourceIds.includes(id)).length /
        c.expectedSourceIds.length;
  const C = citationValidity * citationCoverage;

  const refWords = c.referenceAnswer.trim().split(/\s+/).filter(Boolean).length;
  const L = lengthBand(words, refWords, c.maxWords);
  const S = rescaleSimilarity(a.referenceCosine);
  const A = a.abstained === (c.answerable === false) ? 1 : 0;

  const breakdown = { facts: F, patterns: P, citations: C, length: L, similarity: S, abstention: A };
  const score = 0.4 * F + 0.1 * P + 0.2 * C + 0.1 * L + 0.15 * S + 0.05 * A;

  // ── Hard failures ──
  // The spec's four all detect errors of COMMISSION. A degenerate policy commits
  // nothing — it simply says less — so the omission side has to be covered too.
  const a_ = norm(a.answer);
  for (const f of c.forbiddenFacts) {
    if (a_.includes(norm(f))) failures.push(`forbidden_fact:${f}`);
  }
  if (citationValidity === 0) failures.push("cited_unretrieved_source");
  if (c.critical && F < 1) failures.push(`critical_missing_facts:${missing.join("|")}`); // NEW
  if (words < 0.4 * refWords) failures.push("degenerate_length"); // NEW
  // ABSTAIN costs ~0 generation tokens, so without this "abstain on everything"
  // is the GLOBAL optimum of a token-minimizing search.
  if (a.abstained && c.answerable !== false) failures.push("abstained_on_answerable"); // NEW
  if (!a.jsonParsed) failures.push("json_parse_failed_after_repair"); // NEW
  if (c.mustRejectReplay && a.replayed) failures.push("replayed_unsafe_memory"); // NEW

  return {
    score: failures.length > 0 ? Math.min(score, 0.5) : score,
    criticalFailure: failures.length > 0,
    failures,
    breakdown,
  };
}

// ── Aggregate metrics ────────────────────────────────────────────────────────

export interface CaseResult {
  caseId: string;
  critical: boolean;
  score: Score;
  generationTokens: number;
  replayed: boolean;
  abstained: boolean;
  latencyMs: number;
}

export interface AggregateMetrics {
  n: number;
  overallQuality: number;
  hardQuality: number;
  criticalFailures: number;
  totalGenerationTokens: number;
  replayRate: number;
  abstainRate: number;
  p95LatencyMs: number;
}

export function aggregate(results: CaseResult[]): AggregateMetrics {
  const n = results.length || 1;
  const hard = results.filter((r) => r.critical);
  const lat = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  return {
    n: results.length,
    overallQuality: results.reduce((s, r) => s + r.score.score, 0) / n,
    hardQuality: hard.length
      ? hard.reduce((s, r) => s + r.score.score, 0) / hard.length
      : 1,
    criticalFailures: results.filter((r) => r.score.criticalFailure).length,
    totalGenerationTokens: results.reduce((s, r) => s + r.generationTokens, 0),
    replayRate: results.filter((r) => r.replayed).length / n,
    abstainRate: results.filter((r) => r.abstained).length / n,
    p95LatencyMs: lat[Math.floor(0.95 * (lat.length - 1))] ?? 0,
  };
}

/**
 * Wilson lower bound. With 6 replay pairs a perfect score still only supports
 * 0.512, which cannot back a ">= 0.95 replay precision" claim; 80 pairs reaches
 * 0.954. Replay decisions cost zero model tokens, so this power is nearly free.
 */
export function wilsonLowerBound(successes: number, n: number, z = 1.96): number {
  if (n === 0) return 0;
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Math.max(0, (centre - margin) / d);
}
