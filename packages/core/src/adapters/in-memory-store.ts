/**
 * Tier-0 vector store: in-process array + cosine.
 *
 * At this corpus size (a few hundred memories x 384 dims) a brute-force scan is
 * ~0.2ms — HNSW is pure overhead, and pgvector's IVFFlat needs >1000 rows before
 * an index beats a scan while being LESS accurate. The real reason this is the
 * default, though, is that it makes `pnpm test` and `pnpm dev` work with no
 * Docker and no credentials at all.
 *
 * Filter parity with Actian is total, because a JS predicate is strictly more
 * expressive than a filter DSL.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { VecFilter, VecHit, VecPoint, VectorStore } from "../ports.js";

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/** Compile the neutral filter DSL to a predicate. The Actian adapter compiles the same DSL to its Filter builder. */
export function compileFilter(f: VecFilter | undefined): (p: Record<string, unknown>) => boolean {
  if (!f) return () => true;
  switch (f.op) {
    case "eq":
      return (p) => p[f.key] === f.value;
    case "in":
      return (p) => f.values.includes(p[f.key] as string | number);
    case "gte":
      return (p) => typeof p[f.key] === "number" && (p[f.key] as number) >= f.value;
    case "lte":
      return (p) => typeof p[f.key] === "number" && (p[f.key] as number) <= f.value;
    case "and": {
      const subs = f.clauses.map(compileFilter);
      return (p) => subs.every((s) => s(p));
    }
    case "not": {
      const sub = compileFilter(f.clause);
      return (p) => !sub(p);
    }
  }
}

export interface InMemoryStoreOptions {
  dimension: number;
  /** Append-only jsonl so memories survive a restart during the demo. */
  persistPath?: string;
}

export class InMemoryVectorStore implements VectorStore {
  readonly dimension: number;
  readonly info = {
    name: "vectors" as const,
    mode: "local" as const,
    label: "in-process cosine index",
  };

  private collections = new Map<string, Map<string, VecPoint>>();
  private persistPath?: string;

  constructor(opts: InMemoryStoreOptions) {
    this.dimension = opts.dimension;
    this.persistPath = opts.persistPath;
  }

  async ensureCollection(name: string, dimension: number): Promise<void> {
    if (dimension !== this.dimension) {
      // Dimension drift silently invalidates every stored vector, so fail loudly.
      throw new Error(
        `collection ${name} wants dim ${dimension}, store is ${this.dimension}`,
      );
    }
    if (!this.collections.has(name)) this.collections.set(name, new Map());
  }

  private coll(name: string): Map<string, VecPoint> {
    const c = this.collections.get(name);
    if (!c) throw new Error(`unknown collection: ${name}`);
    return c;
  }

  async upsert(collection: string, points: VecPoint[]): Promise<void> {
    const c = this.coll(collection);
    for (const p of points) {
      if (p.vector.length !== this.dimension) {
        throw new Error(`point ${p.id} has dim ${p.vector.length}, expected ${this.dimension}`);
      }
      c.set(p.id, p);
    }
    if (this.persistPath) {
      await mkdir(dirname(this.persistPath), { recursive: true });
      const lines = points.map((p) => JSON.stringify({ collection, point: p })).join("\n");
      await appendFile(this.persistPath, lines + "\n", "utf8");
    }
  }

  async search(
    collection: string,
    vector: number[],
    opts: { limit: number; filter?: VecFilter; scoreThreshold?: number },
  ): Promise<VecHit[]> {
    const pred = compileFilter(opts.filter);
    const hits: VecHit[] = [];
    for (const p of this.coll(collection).values()) {
      if (!pred(p.payload)) continue;
      const score = dot(vector, p.vector);
      if (opts.scoreThreshold !== undefined && score < opts.scoreThreshold) continue;
      hits.push({ id: p.id, score, payload: p.payload });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, opts.limit);
  }

  async delete(collection: string, ids: string[]): Promise<void> {
    const c = this.coll(collection);
    for (const id of ids) c.delete(id);
  }

  async count(collection: string, filter?: VecFilter): Promise<number> {
    const pred = compileFilter(filter);
    let n = 0;
    for (const p of this.coll(collection).values()) if (pred(p.payload)) n++;
    return n;
  }

  async health() {
    return { ok: true, latencyMs: 0 };
  }

  /** Restore from the append-only log; later lines win. */
  async restore(): Promise<number> {
    if (!this.persistPath) return 0;
    let raw: string;
    try {
      raw = await readFile(this.persistPath, "utf8");
    } catch {
      return 0;
    }
    let n = 0;
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const { collection, point } = JSON.parse(line) as { collection: string; point: VecPoint };
      await this.ensureCollection(collection, point.vector.length);
      this.coll(collection).set(point.id, point);
      n++;
    }
    return n;
  }
}
