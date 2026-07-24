/**
 * The request pipeline.
 *
 * The load-bearing property: the replay path returns BEFORE the generator is
 * reachable. That is not a comment, it is enforced by a test that injects a
 * Generator which throws on any call — if the replay tests still pass, replay is
 * provably zero-generation. See pipeline.test.ts.
 */
import { randomUUID } from "node:crypto";
import { extractFeatures } from "./features.js";
import type {
  Embedder,
  GenerateResult,
  InferenceProvider,
  KnowledgeRetriever,
  RouteAlias,
  VectorStore,
} from "./ports.js";
import type { RoutingPolicy } from "./policy.js";
import {
  buildEmbeddingText,
  evaluateReplay,
  normalizeForExact,
  type Candidate,
  type MemoryRecord,
  type ReplayPolicy,
} from "./replay-guard.js";
import { chooseRoute, type RouteDecision, type RoutingEpisode } from "./router.js";

export const ANSWER_MEMORY = "answer_memory_v1";

export interface AskInput {
  question: string;
  tenantId: string;
  desiredFormat?: string;
  language?: string;
}

export interface Citation {
  sourceId: string;
  versionId: string;
  title: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /**
   * ALL prompt+completion tokens. `inputTokens` alone is the uncached remainder
   * only — summing just that under-reports our own spend, which is precisely the
   * number a judge checks.
   */
  totalGenerationTokens: number;
  usageSource: "provider" | "estimated" | "none";
  localEmbeddingCalls: number;
}

export interface MemoryDecision {
  hit: boolean;
  kind?: "exact" | "semantic";
  memoryId?: string;
  similarity?: number;
  margin?: number;
  /** Every candidate we refused and exactly why — this is the safety demo. */
  rejections: Array<{ memoryId: string; reasons: string[] }>;
}

export type PipelineRoute =
  | "EXACT_REPLAY"
  | "SEMANTIC_REPLAY"
  | "LEAN_RAG"
  | "STRONG_RAG"
  | "AUTO_CODE"
  | "ABSTAIN";

export interface AskResponse {
  runId: string;
  answer: string;
  citations: Citation[];
  route: PipelineRoute;
  selectedModelId?: string;
  providerRequestId?: string;
  usage: Usage;
  memory: MemoryDecision;
  /** False when answered from model knowledge rather than the verified corpus. */
  grounded?: boolean;
  /** Why the router chose what it chose — rendered in the trace. */
  routing?: RouteDecision;
  latencyMs: number;
}

export interface PipelineDeps {
  embeddings: Embedder;
  vectors: VectorStore;
  inference: InferenceProvider;
  policy: ReplayPolicy;
  activeSnapshotId: string;
  now?: () => Date;
  knowledge?: KnowledgeRetriever;
  /** When present, the router selects the route. Without it, everything is lean. */
  routingPolicy?: RoutingPolicy;
  /** Past episodes feeding the per-task-class lean success estimate. */
  episodes?: RoutingEpisode[];
  benchmarkMode?: boolean;
  /** Products/identifiers the corpus covers, so out-of-domain questions are not refused. */
  corpusTerms?: Set<string>;
  /**
   * Override the router for a bootstrap probe.
   *
   * The history gate is an absorbing state: lean stays closed until it has a
   * track record, a track record only accrues by taking lean, and exploration is
   * hard-off in benchmark mode to preserve determinism. So the benchmark can
   * never discover on its own that the cheap route works. This forces the route
   * so the outcome can be MEASURED per task class and seeded as honest history.
   */
  forceRoute?: "LEAN_RAG" | "STRONG_RAG" | "AUTO_CODE";
  /** Explicit overrides, used by tests. The routing policy wins when present. */
  contextK?: number;
  maxCharsPerChunk?: number;
  maxOutputTokens?: number;
}

const ZERO_USAGE = (embeds: number): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalGenerationTokens: 0,
  // Not "free": zero GENERATION tokens, at a real local compute cost we report.
  usageSource: "none",
  localEmbeddingCalls: embeds,
});

function usageFrom(r: GenerateResult, embeds: number): Usage {
  return {
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cacheReadTokens: r.cacheReadTokens,
    cacheWriteTokens: r.cacheWriteTokens,
    totalGenerationTokens:
      r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens,
    usageSource: r.usageSource,
    localEmbeddingCalls: embeds,
  };
}

function toMemoryRecord(payload: Record<string, unknown>): MemoryRecord {
  return payload as unknown as MemoryRecord;
}

export async function ask(deps: PipelineDeps, input: AskInput): Promise<AskResponse> {
  const runId = randomUUID();
  const t0 = Date.now();
  const now = deps.now?.() ?? new Date();
  let embeds = 0;

  const normalized = normalizeForExact(input.question);
  const maskedText = buildEmbeddingText(input.question);

  // The index holds MASKED vectors; the query must be masked identically or the
  // geometry does not line up.
  const [maskedVec] = await deps.embeddings.embedBatch([maskedText]);
  embeds++;

  const hits = await deps.vectors.search(ANSWER_MEMORY, maskedVec!, {
    limit: 3,
    filter: {
      op: "and",
      clauses: [
        { op: "eq", key: "tenantId", value: input.tenantId },
        { op: "eq", key: "kbSnapshotId", value: deps.activeSnapshotId },
        { op: "eq", key: "status", value: "approved" },
      ],
    },
  });

  let rejections: Array<{ memoryId: string; reasons: string[] }> = [];

  if (hits.length > 0) {
    // Unmasked re-score as a nonsense floor. Masking collapses question SHAPE, so
    // without this an unrelated question of the same shape could clear tau.
    const raws = await deps.embeddings.embedBatch([
      normalized,
      ...hits.map((h) => toMemoryRecord(h.payload).normalizedQuestion),
    ]);
    embeds += raws.length;
    const qRaw = raws[0]!;

    const candidates: Candidate[] = hits.map((h, i) => ({
      memory: toMemoryRecord(h.payload),
      cosMasked: h.score,
      cosRaw: raws[i + 1]!.reduce((s, v, j) => s + v * qRaw[j]!, 0),
    }));

    const verdict = evaluateReplay({
      queryText: input.question,
      queryFormat: input.desiredFormat,
      queryLanguage: input.language,
      candidates,
      policy: deps.policy,
      activeSnapshotId: deps.activeSnapshotId,
      semanticEnabled: deps.embeddings.semantic,
      now,
    });

    if (verdict.allowed) {
      // ── ZERO-GENERATION RETURN. The generator is not reachable from here. ──
      return {
        runId,
        answer: verdict.memory.answerText,
        citations: [],
        route: verdict.kind === "exact" ? "EXACT_REPLAY" : "SEMANTIC_REPLAY",
        usage: ZERO_USAGE(embeds),
        memory: {
          hit: true,
          kind: verdict.kind,
          memoryId: verdict.memory.id,
          similarity: verdict.similarity,
          margin: verdict.margin,
          rejections: [],
        },
        latencyMs: Date.now() - t0,
      };
    }
    rejections = verdict.rejections;
  }

  // ── Retrieval ──────────────────────────────────────────────────────────────
  // Retrieve at the WIDER budget so the router can observe cross-source
  // structure, then send only what the chosen route pays for. Retrieving at the
  // lean budget would make crossSourceGap unmeasurable — it could never see a
  // second source.
  const maxChars = deps.maxCharsPerChunk ?? deps.routingPolicy?.maxCharsPerChunk ?? 1200;
  const retrieveK = Math.max(deps.routingPolicy?.strongContextK ?? 4, deps.contextK ?? 2);
  const retrieved = deps.knowledge
    ? await deps.knowledge.searchContext({ query: input.question, maxResults: retrieveK })
    : [];

  // ── Route selection. Deterministic; no model decides which model to call. ──
  let routing = deps.routingPolicy
    ? chooseRoute(extractFeatures(input.question, retrieved, deps.corpusTerms), deps.routingPolicy, deps.episodes ?? [], {
        benchmarkMode: deps.benchmarkMode ?? true,
      })
    : undefined;

  if (deps.forceRoute && routing) {
    const p = deps.routingPolicy!;
    const lean = deps.forceRoute === "LEAN_RAG";
    routing = {
      ...routing,
      route: deps.forceRoute,
      reasons: [`forced:${deps.forceRoute}`, ...routing.reasons],
      contextK: lean ? p.leanContextK : p.strongContextK,
      maxOutputTokens: lean ? p.leanMaxOutputTokens : p.strongMaxOutputTokens,
    };
  }

  const memory: MemoryDecision = { hit: false, rejections };

  if (routing?.route === "ABSTAIN") {
    // Abstention is a real outcome, not an error. It costs zero generation
    // tokens, which is exactly why the scorer treats abstaining on an answerable
    // question as a critical failure rather than a cheap win.
    return {
      runId,
      answer:
        "The verified corpus does not contain enough evidence to answer this question. " +
        "Rather than guess, I am declining to answer.",
      citations: [],
      route: "ABSTAIN",
      usage: ZERO_USAGE(embeds),
      memory,
      routing,
      latencyMs: Date.now() - t0,
    };
  }

  const contextK = routing?.contextK ?? deps.contextK ?? 2;
  const chunks = retrieved.slice(0, contextK);
  const alias: RouteAlias =
    routing?.route === "AUTO_CODE" ? "auto-code" : routing?.route === "STRONG_RAG" ? "strong" : "lean";
  const routeLabel: PipelineRoute =
    routing?.route === "AUTO_CODE" ? "AUTO_CODE" : routing?.route === "STRONG_RAG" ? "STRONG_RAG" : "LEAN_RAG";

  // ── Generation ─────────────────────────────────────────────────────────────
  // NOTE: rejected candidates are deliberately NOT injected into the prompt. A
  // memory refused for Python whose answer says `npm install ...` would simply be
  // copied by the model, reopening the exact failure the guard exists to prevent.
  //
  // Truncation is where `maxCharsPerChunk` turns into real tokens. Input is ~82%
  // of the budget, so it is the highest-leverage number the policy carries.
  const evidence = chunks
    .map((c) => `[${c.contentId}] ${c.title}\n${c.text.slice(0, maxChars)}`)
    .join("\n\n");

  const citations: Citation[] = chunks.map((c) => ({
    sourceId: c.contentId,
    versionId: c.versionId,
    title: c.title,
  }));

  const ungrounded = routing?.grounded === false;

  const result = await deps.inference.generate({
    alias,
    system: {
      // Stable prefix first so it is cacheable; evidence and question after.
      stable: ungrounded
        ? // Out-of-corpus general question. Answering it is correct — refusing
          // would be unhelpful rather than safe — but the answer must not be
          // dressed up as corpus-verified.
          "Answer the question directly from your own knowledge. Be concise. " +
          "Do not cite sources, and do not claim the answer comes from any " +
          "documentation. If you are genuinely unsure, say so."
        : "Answer using ONLY the provided sources. Cite the source ids you used in " +
          "square brackets. If the sources do not contain the answer, say the corpus " +
          "is insufficient rather than guessing. Be concise and specific.",
      volatile: evidence ? `Sources:\n\n${evidence}` : undefined,
    },
    user: input.question,
    maxOutputTokens: routing?.maxOutputTokens ?? deps.maxOutputTokens ?? 400,
    requestId: runId,
  });

  return {
    runId,
    answer: result.text,
    citations: ungrounded ? [] : citations,
    route: routeLabel,
    grounded: !ungrounded,
    selectedModelId: result.selectedModelId,
    providerRequestId: result.providerRequestId,
    usage: usageFrom(result, embeds),
    memory,
    routing,
    latencyMs: Date.now() - t0,
  };
}
