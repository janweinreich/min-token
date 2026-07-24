/**
 * The real evaluator. This is the function that makes the evolution loop's
 * decisions measurements rather than arithmetic.
 *
 * It runs the ACTUAL pipeline — real retrieval, real routing, real model calls —
 * against the benchmark and scores the answers with the real scorer. Tokens are
 * provider-reported. Nothing here is modelled.
 */
import { readFile } from "node:fs/promises";
import { cosine } from "../embeddings/minilm.js";
import { ask, type PipelineDeps } from "../pipeline.js";
import type { RoutingPolicy } from "../policy.js";
import type { RoutingEpisode } from "../router.js";
import { scoreAnswer, type BenchmarkCase, type CaseResult } from "./scorer.js";
import {
  EXTRACTOR_VERSION,
  buildEmbeddingText,
  evaluateReplay,
  normalizeForExact,
  type Candidate,
  type MemoryRecord,
  type ReplayPolicy,
} from "../replay-guard.js";
import type { Embedder } from "../ports.js";

export async function loadCases(path: string): Promise<BenchmarkCase[]> {
  const raw = await readFile(path, "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as BenchmarkCase);
}

/** Source ids cited as `[slug]` in the answer text. */
function extractCitations(answer: string): string[] {
  return [...answer.matchAll(/\[([a-z0-9][a-z0-9-]*)\]/gi)].map((m) => m[1]!.toLowerCase());
}

export interface RunOptions {
  cases: BenchmarkCase[];
  deps: Omit<PipelineDeps, "routingPolicy" | "episodes" | "benchmarkMode">;
  policy: RoutingPolicy;
  embedder: Embedder;
  episodes?: RoutingEpisode[];
  /** Cache keyed by (policy-relevant inputs) so repeated cycles do not re-bill. */
  cache?: Map<string, CaseResult>;
  onCase?: (r: CaseResult, c: BenchmarkCase) => void;
  /** Bootstrap probe: force a route so its outcome can be measured per class. */
  forceRoute?: "LEAN_RAG" | "STRONG_RAG" | "AUTO_CODE";
}

export interface RunResult {
  results: CaseResult[];
  episodes: RoutingEpisode[];
  replayCorrect: number;
  replayTotal: number;
}

/**
 * Benchmark mode invariants, enforced rather than documented:
 *  - exploration is off (it would destroy determinism and the paired comparison);
 *  - memory writes are not performed here at all, so one case cannot contaminate
 *    the next and candidates stay independent of evaluation order.
 */
export async function runBenchmark(opts: RunOptions): Promise<RunResult> {
  const results: CaseResult[] = [];
  const episodes: RoutingEpisode[] = [];
  let replayCorrect = 0;
  let replayTotal = 0;

  for (const c of opts.cases) {
    // Only the inputs that can change the answer belong in the key.
    const key = [
      c.id,
      opts.policy.leanContextK,
      opts.policy.strongContextK,
      opts.policy.maxCharsPerChunk,
      opts.policy.leanMaxOutputTokens,
      opts.policy.strongMaxOutputTokens,
      opts.policy.leanMinContextScore,
      opts.policy.leanCrossSourceGap,
      opts.policy.leanMinHistoricalSuccess,
      opts.policy.abstainBelowContextScore,
      opts.policy.semanticReplayThreshold,
      opts.forceRoute ?? "auto",
    ].join("|");

    const cached = opts.cache?.get(key);
    if (cached) {
      results.push(cached);
      continue;
    }

    const r = await ask(
      { ...opts.deps, policy: opts.deps.policy, routingPolicy: opts.policy, episodes: opts.episodes ?? [], benchmarkMode: true, forceRoute: opts.forceRoute },
      { question: c.question, tenantId: "bench" },
    );

    const replayed = r.route.endsWith("REPLAY");
    if (c.mustRejectReplay !== undefined) {
      replayTotal++;
      if (replayed === !!c.mustRejectReplay === false) replayCorrect++;
    }

    // Semantic similarity to the reference, measured with the same local model.
    const [av, bv] = await opts.embedder.embedBatch([r.answer, c.referenceAnswer]);
    const referenceCosine = cosine(av!, bv!);

    const score = scoreAnswer(c, {
      answer: r.answer,
      citedSourceIds: extractCitations(r.answer),
      retrievedSourceIds: r.citations.map((x) => x.sourceId),
      abstained: r.route === "ABSTAIN",
      replayed,
      referenceCosine,
      jsonParsed: true,
    });

    const result: CaseResult = {
      caseId: c.id,
      critical: c.critical,
      score,
      generationTokens: r.usage.totalGenerationTokens,
      replayed,
      abstained: r.route === "ABSTAIN",
      latencyMs: r.latencyMs,
    };
    results.push(result);
    opts.cache?.set(key, result);
    opts.onCase?.(result, c);

    if (r.routing && !replayed) {
      episodes.push({
        similarity: 1,
        route: r.routing.route,
        passed: !score.criticalFailure && score.score >= 0.8,
        repaired: false,
        taskType: c.taskType,
        generationTokens: r.usage.totalGenerationTokens,
      });
    }
  }

  // NOTE: no `|| 1` fallback. "Measured nothing" must surface as zero rather than
  // as a passing denominator of one — that fudge is how an unmeasured guarantee
  // reads like a satisfied one.
  return { results, episodes, replayCorrect, replayTotal };
}

// ── Replay safety, measured separately and for free ──────────────────────────

export interface ReplayProbe {
  id: string;
  question: string;
  mustReplay?: boolean;
  mustRejectReplay?: boolean;
  why: string;
}

export interface SeedMemory {
  id: string;
  normalizedQuestion: string;
  answerText: string;
  answerFormat: string;
  language: string;
  taskType: string;
}

export interface ReplaySafetyResult {
  correct: number;
  total: number;
  failures: Array<{ id: string; expected: string; actual: string; why: string; reasons: string[] }>;
}

/**
 * Evaluates ONLY the replay decision — no generation, no model call.
 *
 * That is the point: a replay decision is an embedding plus a gate evaluation,
 * so this set costs zero generation tokens and runs in milliseconds. It is the
 * cheapest evidence in the build, which is why it should be large: six perfect
 * pairs support a Wilson lower bound of 0.512, nowhere near the >= 0.95 the
 * safety claim needs, while eighty reach 0.954.
 */
export async function runReplaySafety(opts: {
  probes: ReplayProbe[];
  seeds: SeedMemory[];
  embedder: Embedder;
  policy: ReplayPolicy;
  activeSnapshotId: string;
}): Promise<ReplaySafetyResult> {
  const vectors = await opts.embedder.embedBatch(
    opts.seeds.map((s) => buildEmbeddingText(s.normalizedQuestion)),
  );
  const memories: MemoryRecord[] = opts.seeds.map((s) => ({
    id: s.id,
    normalizedQuestion: s.normalizedQuestion,
    answerText: s.answerText,
    answerFormat: s.answerFormat,
    language: s.language,
    status: "approved",
    replayable: true,
    volatile: false,
    criticalFailure: false,
    qualityScore: 0.97,
    citationScore: 1,
    kbSnapshotId: opts.activeSnapshotId,
    embeddingModelId: opts.embedder.modelId,
    extractorVersion: EXTRACTOR_VERSION,
    negativeFeedbackCount: 0,
    createdAt: new Date().toISOString(),
  }));

  const failures: ReplaySafetyResult["failures"] = [];
  let correct = 0;

  for (const p of opts.probes) {
    const [maskedQ, rawQ] = await opts.embedder.embedBatch([
      buildEmbeddingText(p.question),
      normalizeForExact(p.question),
    ]);
    const seedRaw = await opts.embedder.embedBatch(
      opts.seeds.map((s) => normalizeForExact(s.normalizedQuestion)),
    );

    const candidates: Candidate[] = memories
      .map((m, i) => ({
        memory: m,
        cosMasked: vectors[i]!.reduce((s, v, j) => s + v * maskedQ![j]!, 0),
        cosRaw: seedRaw[i]!.reduce((s, v, j) => s + v * rawQ![j]!, 0),
      }))
      .sort((a, b) => b.cosMasked - a.cosMasked)
      .slice(0, 3);

    const verdict = evaluateReplay({
      queryText: p.question,
      candidates,
      policy: opts.policy,
      activeSnapshotId: opts.activeSnapshotId,
      semanticEnabled: opts.embedder.semantic,
    });

    const expectReplay = p.mustReplay === true;
    const ok = verdict.allowed === expectReplay;
    if (ok) correct++;
    else {
      failures.push({
        id: p.id,
        expected: expectReplay ? "REPLAY" : "REFUSE",
        actual: verdict.allowed ? "REPLAY" : "REFUSE",
        why: p.why,
        reasons: verdict.allowed ? [] : verdict.rejections.flatMap((r) => r.reasons).slice(0, 3),
      });
    }
  }

  return { correct, total: opts.probes.length, failures };
}
