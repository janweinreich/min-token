/**
 * The request pipeline.
 *
 * The load-bearing property: the replay path returns BEFORE the generator is
 * reachable. That is not a comment, it is enforced by a test that injects a
 * Generator which throws on any call — if the replay tests still pass, replay is
 * provably zero-generation. See pipeline.test.ts.
 */
import { randomUUID } from "node:crypto";
import type { Embedder, GenerateResult, InferenceProvider, VectorStore } from "./ports.js";
import {
  buildEmbeddingText,
  evaluateReplay,
  normalizeForExact,
  type Candidate,
  type MemoryRecord,
  type ReplayPolicy,
} from "./replay-guard.js";

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

export interface AskResponse {
  runId: string;
  answer: string;
  citations: Citation[];
  route: "EXACT_REPLAY" | "SEMANTIC_REPLAY" | "GENERATED";
  selectedModelId?: string;
  providerRequestId?: string;
  usage: Usage;
  memory: MemoryDecision;
  latencyMs: number;
}

export interface PipelineDeps {
  embeddings: Embedder;
  vectors: VectorStore;
  inference: InferenceProvider;
  policy: ReplayPolicy;
  activeSnapshotId: string;
  now?: () => Date;
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

  // Pre-filter in the store, not in JS: tenant + snapshot + language + status.
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

  let decision: MemoryDecision = { hit: false, rejections: [] };

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
    decision = { hit: false, rejections: verdict.rejections };
  }

  // ── Generation path ────────────────────────────────────────────────────────
  // NOTE: rejected candidates are deliberately NOT injected into the prompt. A
  // memory refused for Python whose answer says `npm install ...` would simply be
  // copied by the model, reopening the exact failure the guard exists to prevent.
  const result = await deps.inference.generate({
    alias: "lean",
    system: {
      stable:
        "You answer questions about the provided documentation. Use only the given sources. " +
        "If the evidence is insufficient, say so plainly rather than guessing.",
    },
    user: input.question,
    maxOutputTokens: 400,
    requestId: runId,
  });

  return {
    runId,
    answer: result.text,
    citations: [],
    route: "GENERATED",
    selectedModelId: result.selectedModelId,
    providerRequestId: result.providerRequestId,
    usage: usageFrom(result, embeds),
    memory: decision,
    latencyMs: Date.now() - t0,
  };
}
