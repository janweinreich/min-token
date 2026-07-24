import { createHash, randomUUID } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import type { AnswerMemoryRecord, RouteTier } from "@/engine/types";
import seed from "@/data/answer-memory.seed.json";

const DATA_DIR = path.join(process.cwd(), "src", "data");
const RUNTIME_FILE = path.join(DATA_DIR, "answer-memory.runtime.json");

type MemoryStore = {
  records: AnswerMemoryRecord[];
};

declare global {
  var __budgetDarwinMemory: MemoryStore | undefined;
}

function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function questionKey(q: string): string {
  return createHash("sha256").update(normalizeQuestion(q)).digest("hex").slice(0, 24);
}

function loadStore(): MemoryStore {
  if (globalThis.__budgetDarwinMemory) return globalThis.__budgetDarwinMemory;

  let records: AnswerMemoryRecord[] = (seed as AnswerMemoryRecord[]).map((r) => ({
    ...r,
  }));

  try {
    if (existsSync(RUNTIME_FILE)) {
      const raw = JSON.parse(readFileSync(RUNTIME_FILE, "utf8")) as {
        records?: AnswerMemoryRecord[];
      };
      if (raw.records?.length) {
        const byNorm = new Map(records.map((r) => [r.question_norm, r]));
        for (const r of raw.records) byNorm.set(r.question_norm, r);
        records = [...byNorm.values()];
      }
    }
  } catch {
    // keep seed
  }

  const store = { records };
  globalThis.__budgetDarwinMemory = store;
  return store;
}

function persist(store: MemoryStore) {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(
      RUNTIME_FILE,
      JSON.stringify({ records: store.records }, null, 2),
      "utf8",
    );
  } catch {
    // Vercel read-only FS; in-memory still works for warm instances
  }
}

export function listMemory(): AnswerMemoryRecord[] {
  return loadStore().records.slice().sort((a, b) => b.hits - a.hits);
}

export function lookupAnswer(question: string): AnswerMemoryRecord | null {
  const store = loadStore();
  const norm = normalizeQuestion(question);
  const hit =
    store.records.find((r) => r.question_norm === norm) ??
    store.records.find(
      (r) =>
        norm.includes(r.question_norm) || r.question_norm.includes(norm),
    );
  if (!hit) return null;
  hit.hits += 1;
  hit.updated_at = new Date().toISOString();
  persist(store);
  return { ...hit };
}

export function storeAnswer(opts: {
  question: string;
  answer: string;
  tier: RouteTier;
  model: string;
  quality: number;
  cost_usd: number;
}): AnswerMemoryRecord {
  const store = loadStore();
  const norm = normalizeQuestion(opts.question);
  const existing = store.records.find((r) => r.question_norm === norm);
  const now = new Date().toISOString();

  if (existing) {
    if (opts.quality >= existing.quality) {
      existing.answer = opts.answer;
      existing.tier = opts.tier;
      existing.model = opts.model;
      existing.quality = opts.quality;
      existing.cost_usd = opts.cost_usd;
    }
    existing.updated_at = now;
    persist(store);
    return { ...existing };
  }

  const record: AnswerMemoryRecord = {
    id: `mem-${questionKey(opts.question)}-${randomUUID().slice(0, 6)}`,
    question_norm: norm,
    question: opts.question,
    answer: opts.answer,
    tier: opts.tier,
    model: opts.model,
    quality: opts.quality,
    cost_usd: opts.cost_usd,
    hits: 0,
    created_at: now,
    updated_at: now,
  };
  store.records.push(record);
  persist(store);
  return { ...record };
}

export { normalizeQuestion, questionKey };
