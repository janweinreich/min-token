import { describe, expect, it } from "vitest";
import { createInitialState } from "./seed";
import { applyCoreResult, type CoreResult } from "./core-loop";

function result(overrides: Partial<CoreResult> = {}): CoreResult {
  return {
    runId: "run-1",
    answer: "A grounded answer from the BudgetDarwin pipeline.",
    citations: [],
    route: "LEAN_RAG",
    selectedModelId: "lean-model",
    latencyMs: 25,
    usage: {
      inputTokens: 80,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalGenerationTokens: 100,
      routerTokens: 0,
      usageSource: "provider",
      localEmbeddingCalls: 1,
      estimatedCostUsd: 0.001,
    },
    memory: { hit: false, rejections: [] },
    tools: [],
    strongEstimate: 400,
    savings: {
      tokensUsed: 100,
      tokensBaseline: 400,
      tokensSaved: 300,
      usdUsed: 0.001,
      usdBaseline: 0.004,
      usdSaved: 0.003,
      pct: 75,
      baselineModel: "claude-sonnet-5",
    },
    session: {
      asks: 1,
      spent: 100,
      avoidedEst: 300,
      replays: 0,
      costUsd: 0.001,
      avoidedUsdEst: 0.003,
    },
    learned: [],
    measured: {
      leanTokensPerCase: 331,
      strongTokensPerCase: 765,
      routerQuality: 0.947,
      strongQuality: 0.937,
      leanQuality: 0.911,
      routerTokens: 12501,
      strongTokens: 15291,
      leanTokens: 6619,
      cases: 20,
      strongCostPerCase: 0.004,
    },
    policyVersion: 1,
    routerModel: "router-model",
    distilledRulesAvailable: 0,
    routerPromptSynthesized: true,
    episodeCount: 1,
    seededEpisodes: 0,
    ...overrides,
  };
}

describe("applyCoreResult", () => {
  it("adapts a core generation without changing the shell contract", () => {
    const next = applyCoreResult(createInitialState(), "How does routing work?", result());

    expect(next.chats[0]?.messages).toHaveLength(2);
    expect(next.chats[0]?.messages[1]).toMatchObject({
      role: "assistant",
      tier: "cheap",
      model: "lean-model",
      from_memory: false,
    });
    expect(next.metrics).toMatchObject({
      quality: 0.911,
      cost_usd: 0.001,
      savings_pct: 75,
    });
    expect(next.memory_stats).toMatchObject({ lookups: 1, hits: 0, stores: 1 });
  });

  it("records zero-token replay as a memory hit", () => {
    const replay = result({
      route: "EXACT_REPLAY",
      memory: {
        hit: true,
        kind: "exact",
        memoryId: "memory-1",
        rejections: [],
      },
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalGenerationTokens: 0,
        routerTokens: 0,
        usageSource: "none",
        localEmbeddingCalls: 1,
        estimatedCostUsd: 0,
      },
      savings: {
        tokensUsed: 0,
        tokensBaseline: 400,
        tokensSaved: 400,
        usdUsed: 0,
        usdBaseline: 0.004,
        usdSaved: 0.004,
        pct: 100,
        baselineModel: "claude-sonnet-5",
      },
    });

    const next = applyCoreResult(createInitialState(), "Repeat that", replay);

    expect(next.chats[0]?.messages[1]?.from_memory).toBe(true);
    expect(next.metrics.cost_usd).toBe(0);
    expect(next.metrics.savings_pct).toBe(100);
    expect(next.memory_stats).toMatchObject({ lookups: 1, hits: 1, stores: 0 });
  });
});
