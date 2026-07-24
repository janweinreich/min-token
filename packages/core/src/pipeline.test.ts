/**
 * GATE A. The headline test here is the throwing generator: if replay tests pass
 * while any call to generate() throws, "zero generation tokens" is a proven
 * property of the code path, not a claim in a slide.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { InMemoryVectorStore } from "./adapters/in-memory-store.js";
import { cosine, miniLmEmbedder } from "./embeddings/minilm.js";
import { ANSWER_MEMORY, ask, type PipelineDeps } from "./pipeline.js";
import {
  DEFAULT_REPLAY_POLICY,
  EXTRACTOR_VERSION,
  buildEmbeddingText,
  type MemoryRecord,
} from "./replay-guard.js";
import type { GenerateRequest, InferenceProvider } from "./ports.js";
import { DEFAULT_POLICY } from "./policy.js";

const SNAPSHOT = "sponsor-docs-v1";
const TENANT = "demo";

/** Any call is a bug. This is what makes the zero-token claim provable. */
const throwingGenerator: InferenceProvider = {
  info: { name: "inference", mode: "unavailable", label: "THROWS — must never be called" },
  async health() {
    return { ok: false, latencyMs: 0 };
  },
  async generate() {
    throw new Error("GENERATOR CALLED ON A REPLAY PATH — zero-token claim is false");
  },
};

const seed: MemoryRecord[] = [
  {
    id: "mem-actian-install-js",
    normalizedQuestion: "how do i install the actian javascript sdk",
    answerText:
      "Install @actian/vectorai-client with npm: `npm install @actian/vectorai-client`.",
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
  {
    id: "mem-guild-agents",
    normalizedQuestion: "what is the difference between a guild coded agent and an llm agent",
    answerText:
      "A Guild coded agent runs deterministic code you author; an LLM agent decides its actions with a model.",
    answerFormat: "concise",
    language: "en",
    status: "approved",
    replayable: true,
    volatile: false,
    criticalFailure: false,
    qualityScore: 0.95,
    citationScore: 1,
    kbSnapshotId: SNAPSHOT,
    embeddingModelId: miniLmEmbedder.modelId,
    extractorVersion: EXTRACTOR_VERSION,
    negativeFeedbackCount: 0,
    createdAt: new Date().toISOString(),
  },
];

let store: InMemoryVectorStore;

async function deps(inference: InferenceProvider = throwingGenerator): Promise<PipelineDeps> {
  return {
    embeddings: miniLmEmbedder,
    vectors: store,
    inference,
    policy: DEFAULT_REPLAY_POLICY,
    activeSnapshotId: SNAPSHOT,
  };
}

beforeAll(async () => {
  store = new InMemoryVectorStore({ dimension: miniLmEmbedder.dimension });
  await store.ensureCollection(ANSWER_MEMORY, miniLmEmbedder.dimension);
  const vectors = await miniLmEmbedder.embedBatch(
    seed.map((m) => buildEmbeddingText(m.normalizedQuestion)),
  );
  await store.upsert(
    ANSWER_MEMORY,
    seed.map((m, i) => ({
      id: m.id,
      vector: vectors[i]!,
      payload: { ...m, tenantId: TENANT } as unknown as Record<string, unknown>,
    })),
  );
}, 120_000);

describe("Gate A — zero-generation replay", () => {
  it("replays an exact repeat with a generator that throws on any call", async () => {
    const r = await ask(await deps(), {
      question: "How do I install the Actian JavaScript SDK?",
      tenantId: TENANT,
    });
    expect(r.route).toBe("EXACT_REPLAY");
    expect(r.usage.totalGenerationTokens).toBe(0);
    expect(r.usage.usageSource).toBe("none");
    expect(r.answer).toContain("@actian/vectorai-client");
  });

  it("replays a safe paraphrase with a generator that throws on any call", async () => {
    const r = await ask(await deps(), {
      question: "Which npm package should I install to use Actian VectorAI from TypeScript?",
      tenantId: TENANT,
    });
    expect(r.route).toBe("SEMANTIC_REPLAY");
    expect(r.usage.totalGenerationTokens).toBe(0);
    expect(r.memory.kind).toBe("semantic");
    expect(r.memory.similarity!).toBeGreaterThan(DEFAULT_REPLAY_POLICY.semanticReplayThreshold);
  });

  it("reports local embedding calls rather than calling replay 'free'", async () => {
    const r = await ask(await deps(), {
      question: "How do I install the Actian JavaScript SDK?",
      tenantId: TENANT,
    });
    expect(r.usage.localEmbeddingCalls).toBeGreaterThan(0);
  });
});

describe("Gate A — unsafe near-matches fall through to generation", () => {
  const spyGen = () => {
    const generate = vi.fn(async (_req: GenerateRequest) => ({
      text: "Use pip install actian-vectorai-client.",
      modelAlias: "lean" as const,
      selectedModelId: "claude-haiku-4-5",
      inputTokens: 120,
      cacheReadTokens: 30,
      cacheWriteTokens: 10,
      outputTokens: 45,
      latencyMs: 5,
      providerRequestId: "req_test",
      fromCache: false,
      usageSource: "provider" as const,
    }));
    const provider: InferenceProvider = {
      info: { name: "inference", mode: "live", label: "spy" },
      async health() {
        return { ok: true, latencyMs: 0 };
      },
      generate,
    };
    return { provider, generate };
  };

  it("does NOT replay the Python variant, and says exactly why", async () => {
    const { provider, generate } = spyGen();
    const r = await ask(await deps(provider), {
      question: "How do I install the Actian Python SDK?",
      tenantId: TENANT,
    });
    expect(r.route).toBe("LEAN_RAG");
    expect(generate).toHaveBeenCalledOnce();
    const reasons = r.memory.rejections.flatMap((x) => x.reasons).join(",");
    expect(reasons).toMatch(/ecosystem_conflict|uncovered_language/);
  });

  it("counts ALL token classes, not just the uncached remainder", async () => {
    const { provider } = spyGen();
    const r = await ask(await deps(provider), {
      question: "How do I install the Actian Python SDK?",
      tenantId: TENANT,
    });
    // 120 input + 45 output + 30 cache-read + 10 cache-write
    expect(r.usage.totalGenerationTokens).toBe(205);
    expect(r.usage.totalGenerationTokens).toBeGreaterThan(r.usage.inputTokens + r.usage.outputTokens);
  });

  it("never injects a rejected memory's answer into the prompt", async () => {
    const { provider, generate } = spyGen();
    await ask(await deps(provider), {
      question: "How do I install the Actian Python SDK?",
      tenantId: TENANT,
    });
    const sent = JSON.stringify(generate.mock.calls[0]![0]);
    // The rejected JS memory says `npm install @actian/vectorai-client`. If that
    // leaks into the prompt the model copies it and we reopen Journey C.
    expect(sent).not.toContain("@actian/vectorai-client");
    expect(sent).not.toContain("npm install");
  });
});

describe("tenant and snapshot isolation", () => {
  it("does not replay another tenant's memory", async () => {
    const { provider } = spyGen2();
    const r = await ask(await deps(provider), {
      question: "How do I install the Actian JavaScript SDK?",
      tenantId: "someone-else",
    });
    expect(r.route).toBe("LEAN_RAG");
  });

  it("does not replay when the active snapshot has moved on", async () => {
    const { provider } = spyGen2();
    const d = { ...(await deps(provider)), activeSnapshotId: "sponsor-docs-v2" };
    const r = await ask(d, {
      question: "How do I install the Actian JavaScript SDK?",
      tenantId: TENANT,
    });
    expect(r.route).toBe("LEAN_RAG");
  });
});

function spyGen2() {
  const provider: InferenceProvider = {
    info: { name: "inference", mode: "live", label: "spy" },
    async health() {
      return { ok: true, latencyMs: 0 };
    },
    async generate() {
      return {
        text: "generated",
        modelAlias: "lean" as const,
        inputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 1,
        latencyMs: 1,
        fromCache: false,
        usageSource: "provider" as const,
      };
    },
  };
  return { provider };
}

describe("the router actually selects the model", () => {
  const chunk = (id: string, score: number, text: string) => ({
    contentId: id, versionId: "v1", title: id, chunkIndex: 0, text, score,
  });
  const knowledge = {
    info: { name: "knowledge" as const, mode: "local" as const, label: "stub" },
    async health() { return { ok: true, latencyMs: 0 }; },
    async listContents() { return []; },
    async searchContext() {
      return [chunk("a", 0.9, "npm install @actian/vectorai-client"), chunk("b", 0.4, "other")];
    },
  };

  const spy = () => {
    const generate = vi.fn(async (_r: GenerateRequest) => ({
      text: "answer", modelAlias: "lean" as const, inputTokens: 10, cacheReadTokens: 0,
      cacheWriteTokens: 0, outputTokens: 5, latencyMs: 1, fromCache: false,
      usageSource: "provider" as const,
    }));
    return {
      generate,
      provider: {
        info: { name: "inference" as const, mode: "live" as const, label: "spy" },
        async health() { return { ok: true, latencyMs: 0 }; },
        generate,
      } satisfies InferenceProvider,
    };
  };

  async function routed(question: string, over: Partial<PipelineDeps> = {}) {
    const { provider, generate } = spy();
    const r = await ask(
      { ...(await deps(provider)), knowledge, routingPolicy: DEFAULT_POLICY, benchmarkMode: true, ...over },
      { question, tenantId: "routing-tenant" },
    );
    return { r, sent: generate.mock.calls[0]?.[0] };
  }

  it("sends a coding question to the code alias, not lean", async () => {
    const { r, sent } = await routed("Write a TypeScript function that queries Actian and returns the hits.");
    expect(r.route).toBe("AUTO_CODE");
    expect(sent!.alias).toBe("auto-code");
  });

  it("falls back to strong when lean has not earned its history", async () => {
    // No episodes -> the pessimistic prior keeps the cheap route closed.
    const { r, sent } = await routed("What package installs the Actian JavaScript SDK?");
    expect(r.route).toBe("STRONG_RAG");
    expect(sent!.alias).toBe("strong");
    expect(r.routing!.leanSuccessLCB).toBeLessThan(DEFAULT_POLICY.leanMinHistoricalSuccess);
  });

  it("takes the lean route once that task class has earned it", async () => {
    const earned = Array.from({ length: 30 }, () => ({
      similarity: 1, route: "LEAN_RAG" as const, passed: true, repaired: false, taskType: "lookup",
    }));
    const { r, sent } = await routed("What package installs the Actian JavaScript SDK?", { episodes: earned });
    expect(r.route).toBe("LEAN_RAG");
    expect(sent!.alias).toBe("lean");
  });

  it("history is scoped per task class — a failing class must not close another", async () => {
    const mixed = [
      ...Array.from({ length: 30 }, () => ({ similarity: 1, route: "LEAN_RAG" as const, passed: true, repaired: false, taskType: "lookup" })),
      ...Array.from({ length: 30 }, () => ({ similarity: 1, route: "LEAN_RAG" as const, passed: false, repaired: true, taskType: "comparison" })),
    ];
    const { r } = await routed("What package installs the Actian JavaScript SDK?", { episodes: mixed });
    expect(r.route).toBe("LEAN_RAG"); // lookups unaffected by comparison failures
  });

  it("the route controls the output budget the provider is given", async () => {
    const { sent } = await routed("Write a TypeScript function to query Actian.");
    expect(sent!.maxOutputTokens).toBe(DEFAULT_POLICY.strongMaxOutputTokens);
  });

  it("abstains without calling any model when evidence is absent", async () => {
    const empty = { ...knowledge, async searchContext() { return [chunk("a", 0.02, "unrelated text")]; } };
    const { provider, generate } = spy();
    const r = await ask(
      { ...(await deps(provider)), knowledge: empty, routingPolicy: DEFAULT_POLICY, benchmarkMode: true },
      { question: "What is the airspeed velocity of an unladen swallow?", tenantId: "routing-tenant" },
    );
    expect(r.route).toBe("ABSTAIN");
    expect(generate).not.toHaveBeenCalled();
    expect(r.usage.totalGenerationTokens).toBe(0);
  });
});

describe("embedding geometry", () => {
  it("write-time and read-time embedding text are identical for the same question", async () => {
    const a = buildEmbeddingText("How do I install the Actian JavaScript SDK?");
    const b = buildEmbeddingText("how do i install the actian javascript sdk");
    const [va, vb] = await miniLmEmbedder.embedBatch([a, b]);
    expect(cosine(va!, vb!)).toBeGreaterThan(0.999);
  });
});
