import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { resolve } from "node:path";
import type { Embedder } from "../ports.js";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const DIMENSION = 384;

env.cacheDir = resolve(process.cwd(), ".models");
env.allowLocalModels = true;
// Default to offline once weights are cached: a network blip mid-demo must not
// turn a 10ms embed into a 30s hang. Set EMBEDDING_ALLOW_DOWNLOAD=true to prefetch.
env.allowRemoteModels = process.env.EMBEDDING_ALLOW_DOWNLOAD !== "false";

/**
 * A memoized PROMISE, not an awaited value: concurrent first-callers share one
 * load. Awaiting here would race two ORT sessions => double memory, two downloads.
 */
let loading: Promise<FeatureExtractionPipeline> | null = null;

function extractor(): Promise<FeatureExtractionPipeline> {
  loading ??= (async () => {
    const p = await pipeline("feature-extraction", MODEL_ID, { dtype: "q8" });
    const warm = await p("warmup query", { pooling: "mean", normalize: true });
    const dim = (warm.data as Float32Array).length;
    if (dim !== DIMENSION) {
      throw new Error(`embedder produced dim ${dim}, expected ${DIMENSION}`);
    }
    return p;
  })().catch((e) => {
    loading = null; // allow retry after a failed load
    throw e;
  });
  return loading;
}

/**
 * 1-slot queue. ORT sessions are not reliably reentrant under concurrent run().
 * At ~10ms/embed a mutex costs nothing and removes a class of flaky-dim bugs.
 */
let tail: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = tail.then(fn, fn);
  tail = next.catch(() => {});
  return next;
}

export const miniLmEmbedder: Embedder = {
  modelId: MODEL_ID,
  dimension: DIMENSION,
  semantic: true,
  info: { name: "embeddings", mode: "local", label: `${MODEL_ID} q8 (${DIMENSION}d)` },

  async embed(text: string): Promise<number[]> {
    const [v] = await this.embedBatch([text]);
    return v!;
  },

  embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return Promise.resolve([]);
    return serialize(async () => {
      const p = await extractor();
      const out = await p(texts, { pooling: "mean", normalize: true });
      const flat = out.data as Float32Array;
      return texts.map((_, i) =>
        Array.from(flat.subarray(i * DIMENSION, (i + 1) * DIMENSION)),
      );
    });
  },

  async health() {
    const t = Date.now();
    try {
      await this.embed("health");
      return { ok: true, latencyMs: Date.now() - t };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t, error: String(e).slice(0, 200) };
    }
  },
};

/** Cosine over L2-normalized vectors. */
export function cosine(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}
