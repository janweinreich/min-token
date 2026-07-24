/**
 * MEASURED end-to-end token savings. No simulation anywhere in this file.
 *
 * Every generated answer is a real Pioneer call and every token count is
 * provider-reported. The saving is computed by asking the same questions twice:
 * once cold (memory empty, real generation) and once warm (memory approved,
 * replay). The difference is not modelled — it is the arithmetic of two measured
 * runs over an identical question set.
 *
 * Deliberately conservative: the warm pass asks PARAPHRASES, not the identical
 * strings, so the saving comes from semantic replay clearing the safety gate
 * rather than from trivial exact-match.
 */
import { InMemoryVectorStore } from "../packages/core/src/adapters/in-memory-store.js";
import { LocalContextProvider } from "../packages/core/src/adapters/local-context.js";
import { pioneerInference } from "../packages/core/src/adapters/messages-inference.js";
import { miniLmEmbedder } from "../packages/core/src/embeddings/minilm.js";
import { ANSWER_MEMORY, ask, type AskResponse, type PipelineDeps } from "../packages/core/src/pipeline.js";
import { DEFAULT_POLICY } from "../packages/core/src/policy.js";
import { EXTRACTOR_VERSION, buildEmbeddingText, normalizeForExact } from "../packages/core/src/replay-guard.js";

const key = process.env.PIONEER_API_KEY;
if (!key) {
  console.error("PIONEER_API_KEY not set (source .env.local)");
  process.exit(1);
}

const SNAPSHOT = "sponsor-docs-v1";
const TENANT = "demo";

/** cold = asked first, generating for real. warm = a paraphrase asked afterwards. */
const PAIRS = [
  {
    cold: "What package installs the Actian JavaScript SDK?",
    warm: "Which npm package do I need to use Actian VectorAI from TypeScript?",
  },
  {
    cold: "What is the difference between a Guild coded agent and an LLM agent?",
    warm: "How does a Guild coded agent differ from an agent driven by a model?",
  },
  {
    cold: "Which port does the Actian VectorAI gRPC endpoint listen on?",
    warm: "What port should I connect to for Actian VectorAI over gRPC?",
  },
  {
    cold: "How does Pioneer report which model its router selected?",
    warm: "Where does Pioneer tell me the model that actually served a routed request?",
  },
];

/** A paraphrase that MUST NOT replay — proof the saving is not coming from a lax gate. */
const UNSAFE = "What package installs the Actian Python SDK?";

const store = new InMemoryVectorStore({ dimension: miniLmEmbedder.dimension });
await store.ensureCollection(ANSWER_MEMORY, miniLmEmbedder.dimension);

const knowledge = new LocalContextProvider("data/sources", miniLmEmbedder);
const loaded = await knowledge.load();
console.log(
  `\ncorpus: ${loaded.sources} sources, ${loaded.chunks} chunks, hash ${loaded.corpusHash}`,
);

const deps: PipelineDeps = {
  embeddings: miniLmEmbedder,
  vectors: store,
  inference: pioneerInference(key),
  knowledge,
  policy: DEFAULT_POLICY,
  activeSnapshotId: SNAPSHOT,
  contextK: DEFAULT_POLICY.leanContextK,
  maxCharsPerChunk: DEFAULT_POLICY.maxCharsPerChunk,
  maxOutputTokens: DEFAULT_POLICY.leanMaxOutputTokens,
};

const total = (r: AskResponse) => r.usage.totalGenerationTokens;

// ── Pass 1: COLD. Memory is empty; every answer is generated for real. ───────
console.log("\nPASS 1 — cold (memory empty, real generation)");
console.log("─".repeat(92));
let coldTokens = 0;
const generated: AskResponse[] = [];

for (const p of PAIRS) {
  const r = await ask(deps, { question: p.cold, tenantId: TENANT });
  coldTokens += total(r);
  generated.push(r);
  console.log(
    `  ${r.route.padEnd(9)} ${String(total(r)).padStart(5)} tok  ` +
      `[${r.usage.usageSource}] ${p.cold.slice(0, 52)}`,
  );
}

// ── Approve the answers into memory, exactly as the live approval path would ──
const vectors = await miniLmEmbedder.embedBatch(PAIRS.map((p) => buildEmbeddingText(p.cold)));
await store.upsert(
  ANSWER_MEMORY,
  PAIRS.map((p, i) => ({
    id: `mem-${i}`,
    vector: vectors[i]!,
    payload: {
      id: `mem-${i}`,
      tenantId: TENANT,
      normalizedQuestion: normalizeForExact(p.cold),
      answerText: generated[i]!.answer,
      answerFormat: "concise",
      language: "en",
      status: "approved",
      replayable: true,
      volatile: false,
      criticalFailure: false,
      qualityScore: 0.97,
      citationScore: 1,
      kbSnapshotId: SNAPSHOT,
      embeddingModelId: miniLmEmbedder.modelId,
      extractorVersion: EXTRACTOR_VERSION,
      negativeFeedbackCount: 0,
      createdAt: new Date().toISOString(),
    },
  })),
);

// ── Pass 2: WARM. Same questions, PARAPHRASED. ──────────────────────────────
console.log("\nPASS 2 — warm (memory approved, paraphrased questions)");
console.log("─".repeat(92));
let warmTokens = 0;
let replays = 0;

for (const p of PAIRS) {
  const r = await ask(deps, { question: p.warm, tenantId: TENANT });
  warmTokens += total(r);
  if (r.route.endsWith("REPLAY")) replays++;
  const sim = r.memory.similarity ? ` sim=${r.memory.similarity.toFixed(3)}` : "";
  console.log(
    `  ${r.route.padEnd(16)} ${String(total(r)).padStart(5)} tok${sim.padEnd(11)} ${p.warm.slice(0, 44)}`,
  );
}

// ── The safety control. If this replays, the saving above is not trustworthy. ─
console.log("\nSAFETY CONTROL — near-match that must NOT replay");
console.log("─".repeat(92));
const unsafe = await ask(deps, { question: UNSAFE, tenantId: TENANT });
const blocked = !unsafe.route.endsWith("REPLAY");
console.log(
  `  ${unsafe.route.padEnd(16)} ${String(total(unsafe)).padStart(5)} tok   ${UNSAFE}`,
);
console.log(
  `  ${blocked ? "BLOCKED" : "*** LEAKED ***"} — ${unsafe.memory.rejections.flatMap((x) => x.reasons).slice(0, 3).join(", ") || "no rejection recorded"}`,
);

// ── Result ───────────────────────────────────────────────────────────────────
const saved = coldTokens - warmTokens;
const pct = coldTokens ? ((saved / coldTokens) * 100).toFixed(1) : "0.0";
console.log("\n" + "=".repeat(92));
console.log(`cold  (all generated) : ${String(coldTokens).padStart(6)} generation tokens`);
console.log(`warm  (${replays}/${PAIRS.length} replayed)  : ${String(warmTokens).padStart(6)} generation tokens`);
console.log(`saved                 : ${String(saved).padStart(6)} tokens  (${pct}%)`);
console.log(
  `\nAll counts provider-reported over an identical ${PAIRS.length}-question set.` +
    `\nSavings are from SEMANTIC replay (paraphrases), not exact-match.` +
    `\nSafety control ${blocked ? "held" : "FAILED — do not trust the number above"}.`,
);
if (!blocked) process.exit(1);
