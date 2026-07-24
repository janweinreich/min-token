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
      });
    }
  }

  return { results, episodes, replayCorrect, replayTotal: replayTotal || 1 };
}
