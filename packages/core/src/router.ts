/**
 * Deterministic route selection. No model is called to decide which model to call.
 */
import type { RoutingPolicy } from "./policy.js";
import type { RetrievedChunk } from "./ports.js";

export type Route = "LEAN_RAG" | "STRONG_RAG" | "AUTO_CODE" | "ABSTAIN";

export interface RoutingEpisode {
  /** Cosine similarity of this episode's question to the current one. */
  similarity: number;
  route: Route;
  passed: boolean;
  repaired: boolean;
  /**
   * Task class this episode belongs to. History is scoped by it: without that,
   * one global success estimate lets a class where lean keeps failing
   * (comparisons, say) close the lean route for a class where it works fine
   * (lookups). The per-class routing the synthesized skill advertises is only
   * deliverable if the router estimates per class.
   */
  taskType?: string;
  /** Provider-reported tokens this episode actually cost. */
  generationTokens?: number;
}

export interface RequestFeatures {
  questionChars: number;
  taskType: "lookup" | "explanation" | "comparison" | "code" | "debug" | "action" | "unknown";
  temporal: boolean;
  actionIntent: boolean;
  /** Danger tokens the question raises — used for evidence-coverage abstention. */
  queryTerms: string[];
  chunks: RetrievedChunk[];
  /** False when the question was never about the corpus at all. */
  inCorpusDomain?: boolean;
}

export interface RouteDecision {
  route: Route;
  reasons: string[];
  /** False => answered from the model's own knowledge, not the verified corpus. */
  grounded: boolean;
  contextK: number;
  maxOutputTokens: number;
  /** True when lean was chosen by exploration rather than by earned history. */
  exploratory: boolean;
  leanSuccessLCB: number;
  crossSourceGap: number;
  evidenceCoverage: number;
}

/**
 * Lower bound of a Beta posterior over lean-route success, normal-approximated.
 *
 * A raw mean over 3 episodes is unusable, and at t=0 there are none. The prior is
 * deliberately pessimistic (mean 0.25) so cold start never takes the cheap route:
 * lean has to EARN its way in over roughly 8-10 clean successes, rather than
 * being trusted by default and discovering failures on the user.
 */
export function leanSuccessLowerBound(
  episodes: RoutingEpisode[],
  relatedThreshold: number,
  z = 1.2816, // one-sided 90%
  /** Scope to a task class. Omit to pool every class. */
  taskType?: string,
): number {
  let n = 0;
  let k = 0;
  for (const e of episodes) {
    if (e.route !== "LEAN_RAG") continue;
    if (taskType !== undefined && e.taskType !== undefined && e.taskType !== taskType) continue;
    // Weight by how similar the past question was; a distant episode says little.
    const w = Math.max(
      0,
      Math.min(1, (e.similarity - relatedThreshold) / Math.max(1e-6, 1 - relatedThreshold)),
    );
    if (w <= 0) continue;
    n += w;
    if (e.passed && !e.repaired) k += w;
  }
  const a = k + 1;
  const b = n - k + 3; // pessimistic prior: Beta(1, 3), mean 0.25
  const mean = a / (a + b);
  const varr = (a * b) / ((a + b) ** 2 * (a + b + 1));
  return Math.max(0, Math.min(1, mean - z * Math.sqrt(varr)));
}

/** Score gap to the best chunk from a DIFFERENT source, over the chunks lean would actually send. */
export function crossSourceGap(chunks: RetrievedChunk[], k: number): number {
  const top = chunks[0];
  if (!top) return 0;
  const other = chunks.slice(0, Math.max(k, 2)).find((c) => c.contentId !== top.contentId);
  return other ? top.score - other.score : 1;
}

/** Fraction of the question's meaningful terms actually present in the retrieved evidence. */
export function evidenceCoverage(terms: string[], chunks: RetrievedChunk[]): number {
  if (terms.length === 0) return 1;
  const hay = chunks.map((c) => c.text.toLowerCase()).join(" ");
  const hit = terms.filter((t) => hay.includes(t.toLowerCase())).length;
  return hit / terms.length;
}

export function chooseRoute(
  f: RequestFeatures,
  policy: RoutingPolicy,
  episodes: RoutingEpisode[],
  opts: { benchmarkMode: boolean; rand?: () => number } = { benchmarkMode: true },
): RouteDecision {
  const reasons: string[] = [];
  const top = f.chunks[0]?.score ?? 0;
  const gap = crossSourceGap(f.chunks, policy.leanContextK);
  const coverage = evidenceCoverage(f.queryTerms, f.chunks);
  // Scoped to this task class — see RoutingEpisode.taskType.
  const lcb = leanSuccessLowerBound(episodes, policy.relatedThreshold, 1.2816, f.taskType);

  const base = {
    reasons,
    grounded: true,
    exploratory: false,
    leanSuccessLCB: lcb,
    crossSourceGap: gap,
    evidenceCoverage: coverage,
  };

  // 1. CODE FIRST. The spec checked abstention first, which made a coding request
  //    with weak retrieval abstain instead of routing to the code model — and
  //    "write a TypeScript function that queries X" is a spec-listed target
  //    question that matches no single doc chunk well. Code is GENERATED, not
  //    looked up, so low retrieval score is not grounds to refuse it.
  if (f.taskType === "code" || f.taskType === "debug") {
    reasons.push(top < policy.abstainBelowContextScore ? "code_low_evidence" : "code_grounded");
    return {
      ...base,
      route: "AUTO_CODE",
      contextK: policy.strongContextK,
      maxOutputTokens: policy.strongMaxOutputTokens,
    };
  }

  // 2. OUT OF DOMAIN — checked before anything about retrieval.
  //
  // This ordering is the fix for a real failure: "how do you build a rocket"
  // scored evidence coverage 0.50 purely because the word "build" appears in the
  // Guild docs, so it did not look like "no evidence", fell through to the
  // grounded path, and spent 1028 tokens on the STRONG model to say the corpus
  // was insufficient — worse than the always-strong baseline it exists to beat.
  //
  // Whether a question is about the corpus is a property of the QUESTION, not of
  // how lucky retrieval got. Decide it first.
  if (f.inCorpusDomain === false) {
    // Difficulty from the deterministic task class and length — the same signals
    // used everywhere else, rather than a second ad-hoc classifier.
    const hard =
      f.taskType === "comparison" ||
      f.taskType === "explanation" ||
      f.questionChars > policy.leanMaxQuestionChars;
    reasons.push(`ungrounded:${hard ? "complex" : "simple"}_general_question`);
    return {
      ...base,
      grounded: false,
      route: hard ? "STRONG_RAG" : "LEAN_RAG",
      contextK: 0,
      maxOutputTokens: hard ? policy.strongMaxOutputTokens : policy.leanMaxOutputTokens,
    };
  }

  // 3. In-domain but unsupported: we are supposed to know this and do not.
  //    Do not guess — a wrong answer about a documented API is the expensive
  //    kind of wrong.
  if (top < policy.abstainBelowContextScore && coverage < 0.5) {
    reasons.push(`abstain:in_domain,top=${top.toFixed(2)},coverage=${coverage.toFixed(2)}`);
    return { ...base, route: "ABSTAIN", contextK: 0, maxOutputTokens: 0 };
  }

  // 3. Lean gate.
  const checks: Array<[string, boolean]> = [
    ["length", f.questionChars <= policy.leanMaxQuestionChars],
    ["not_temporal", !f.temporal],
    ["no_action_intent", !f.actionIntent],
    ["context_score", top >= policy.leanMinContextScore],
    ["cross_source_gap", gap >= policy.leanCrossSourceGap],
  ];
  const failed = checks.filter(([, ok]) => !ok).map(([n]) => n);
  const historyOk = lcb >= policy.leanMinHistoricalSuccess;

  if (failed.length === 0 && historyOk) {
    reasons.push("lean_earned");
    return {
      ...base,
      route: "LEAN_RAG",
      contextK: policy.leanContextK,
      maxOutputTokens: policy.leanMaxOutputTokens,
    };
  }

  // 4. Exploration. Without it the history gate is an ABSORBING STATE: lean never
  //    fires, so no lean episodes are ever recorded, so lean never fires. Hard-off
  //    in benchmark mode — it would destroy determinism and the paired comparison.
  if (
    failed.length === 0 &&
    !historyOk &&
    !opts.benchmarkMode &&
    (opts.rand ?? Math.random)() < policy.explorationEpsilon
  ) {
    reasons.push(`lean_exploratory:lcb=${lcb.toFixed(2)}`);
    return {
      ...base,
      route: "LEAN_RAG",
      exploratory: true,
      contextK: policy.leanContextK,
      maxOutputTokens: policy.leanMaxOutputTokens,
    };
  }

  reasons.push(...(failed.length ? failed.map((x) => `lean_blocked:${x}`) : [`lean_blocked:history:lcb=${lcb.toFixed(2)}`]));
  return {
    ...base,
    route: "STRONG_RAG",
    contextK: policy.strongContextK,
    maxOutputTokens: policy.strongMaxOutputTokens,
  };
}
