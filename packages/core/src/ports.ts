/**
 * The four seams. Every sponsor sits behind one of these, selected by env.
 * No vendor type may appear in a signature here — that is what makes the swap real.
 */

export type PortMode = "live" | "local" | "degraded" | "unavailable";

export interface PortInfo {
  readonly name: "knowledge" | "vectors" | "inference" | "embeddings";
  readonly mode: PortMode;
  /** Rendered verbatim in the health strip. */
  readonly label: string;
}

export interface HealthProbe {
  readonly info: PortInfo;
  health(): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
}

// ── Embeddings ───────────────────────────────────────────────────────────────

export interface Embedder extends HealthProbe {
  readonly modelId: string;
  readonly dimension: number;
  /**
   * false => SEMANTIC_REPLAY must be hard-disabled. A hash embedder that silently
   * stands in for MiniLM would make replay fire on lexical near-misses, which is
   * the single worst failure this product can have.
   */
  readonly semantic: boolean;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

// ── Knowledge retrieval ──────────────────────────────────────────────────────

export interface RetrievedChunk {
  /** Stable across local and remote adapters: slug of the source path. */
  contentId: string;
  /** sha256 of source bytes — changing a source changes this, which rolls the snapshot. */
  versionId: string;
  title: string;
  chunkIndex: number;
  text: string;
  score: number;
}

export interface KnowledgeRetriever extends HealthProbe {
  searchContext(input: {
    query: string;
    maxResults: number;
    signal?: AbortSignal;
  }): Promise<RetrievedChunk[]>;
  listContents(): Promise<Array<{ contentId: string; versionId: string; title: string }>>;
}

// ── Vector store ─────────────────────────────────────────────────────────────

export type VecFilter =
  | { op: "eq"; key: string; value: string | number | boolean }
  | { op: "in"; key: string; values: Array<string | number> }
  | { op: "gte"; key: string; value: number }
  | { op: "lte"; key: string; value: number }
  | { op: "and"; clauses: VecFilter[] }
  | { op: "not"; clause: VecFilter };

export interface VecPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}
export interface VecHit {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

export interface VectorStore extends HealthProbe {
  readonly dimension: number;
  ensureCollection(name: string, dimension: number): Promise<void>;
  upsert(collection: string, points: VecPoint[]): Promise<void>;
  search(
    collection: string,
    vector: number[],
    opts: { limit: number; filter?: VecFilter; scoreThreshold?: number },
  ): Promise<VecHit[]>;
  delete(collection: string, ids: string[]): Promise<void>;
  count(collection: string, filter?: VecFilter): Promise<number>;
}

// ── Inference ────────────────────────────────────────────────────────────────

export type RouteAlias = "lean" | "strong" | "auto-code";

export interface GenerateRequest {
  alias: RouteAlias;
  /** Split is structural: the caller cannot put the question in the cached prefix. */
  system: { stable: string; volatile?: string };
  user: string;
  maxOutputTokens: number;
  responseSchema?: Record<string, unknown>;
  /** NOTE: no `temperature` — it is a 400 on claude-sonnet-5 / opus-5 / fable-5. */
  effort?: "low" | "medium" | "high";
  /** Concrete model id, overriding the alias. Used by the distilled LLM router. */
  modelOverride?: string;
  requestId: string;
  signal?: AbortSignal;
}

export interface GenerateResult {
  text: string;
  parsed?: unknown;
  modelAlias: RouteAlias;
  selectedModelId?: string;
  /**
   * The UNCACHED remainder only. Total prompt tokens =
   * inputTokens + cacheReadTokens + cacheWriteTokens. Summing only inputTokens
   * under-reports our own usage — exactly the number a judge checks.
   */
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  estimatedCostUsd?: number;
  latencyMs: number;
  providerRequestId?: string;
  /** Disk-cache hit — must be excluded from token accounting. */
  fromCache: boolean;
  /** 'provider' when the API reported usage; 'estimated' never counts toward a claim. */
  usageSource: "provider" | "estimated";
}

export interface InferenceProvider extends HealthProbe {
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

export interface AppPorts {
  knowledge: KnowledgeRetriever;
  vectors: VectorStore;
  inference: InferenceProvider;
  embeddings: Embedder;
}
