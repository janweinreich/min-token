/**
 * Regression tests for routing. The first block is a real observed failure:
 * "how do you build a rocket" spent 1028 tokens on the STRONG model to answer
 * that the corpus was insufficient — worse than the always-strong baseline the
 * router exists to beat.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "./policy.js";
import { extractFeatures } from "./features.js";
import { chooseRoute, type RoutingEpisode } from "./router.js";
import type { RetrievedChunk } from "./ports.js";

const CORPUS = new Set(["actian", "vectorai", "pioneer", "guild", "@actian/vectorai-client"]);

/** Chunks that mention "build" — which is what caused the original failure. */
const chunks: RetrievedChunk[] = [
  { contentId: "guild-agents", versionId: "v1", title: "Publishing", chunkIndex: 0, score: 0.31,
    text: "The workflow is create, add operations, then build and publish a version." },
  { contentId: "actian-vectorai", versionId: "v1", title: "Docker", chunkIndex: 0, score: 0.22,
    text: "Run the actian/vectorai image with the EULA variable set." },
];

const earnedLookups: RoutingEpisode[] = Array.from({ length: 30 }, () => ({
  similarity: 1, route: "LEAN_RAG", passed: true, repaired: false, taskType: "lookup",
}));

function route(q: string, eps: RoutingEpisode[] = []) {
  return chooseRoute(extractFeatures(q, chunks, CORPUS), DEFAULT_POLICY, eps, { benchmarkMode: true });
}

describe("out-of-domain questions never take the expensive grounded path", () => {
  it("does not send a rocket question to the strong model (the observed 1028-token failure)", () => {
    const d = route("how to you build a rocket");
    expect(d.grounded).toBe(false);
    expect(d.route).toBe("LEAN_RAG");
    expect(d.maxOutputTokens).toBe(DEFAULT_POLICY.leanMaxOutputTokens);
    expect(d.reasons.join()).toContain("ungrounded");
  });

  it("is decided by the QUESTION, not by retrieval luck", () => {
    // Accidental lexical overlap with the corpus must not make an off-topic
    // question look grounded. "build" appears in the Guild docs.
    const d = route("what is the best way to build a treehouse for my kids");
    expect(d.grounded).toBe(false);
  });

  it("still escalates a genuinely complex general question", () => {
    const d = route("Explain the tradeoffs between microservices and a monolith");
    expect(d.grounded).toBe(false);
    expect(d.route).toBe("STRONG_RAG");
  });

  it("keeps a simple general question on the cheap model", () => {
    const d = route("give me a recipe for apple pie");
    expect(d.grounded).toBe(false);
    expect(d.route).toBe("LEAN_RAG");
  });
});

describe("in-domain questions keep the grounded contract", () => {
  it("stays grounded when the question is about the corpus", () => {
    expect(route("Which port does Actian VectorAI use for gRPC?", earnedLookups).grounded).toBe(true);
  });

  it("abstains rather than guessing when in-domain evidence is absent", () => {
    const none: RetrievedChunk[] = [
      { contentId: "x", versionId: "v1", title: "x", chunkIndex: 0, score: 0.02, text: "unrelated" },
    ];
    const d = chooseRoute(
      extractFeatures("What is the Actian rate limit for @actian/vectorai-client?", none, CORPUS),
      DEFAULT_POLICY, earnedLookups, { benchmarkMode: true },
    );
    expect(d.route).toBe("ABSTAIN");
  });

  it("takes the cheap route once that class has earned it", () => {
    // A real in-domain hit scores well above leanMinContextScore; the fixture
    // above is deliberately weak to model the accidental-overlap case.
    const strongHit: RetrievedChunk[] = [
      { contentId: "actian-vectorai", versionId: "v1", title: "Ports", chunkIndex: 0, score: 0.88,
        text: "The gRPC endpoint listens on port 6574 by default." },
      { contentId: "actian-vectorai", versionId: "v1", title: "Ports", chunkIndex: 1, score: 0.72,
        text: "Port 6575 serves the data REST API." },
    ];
    const d = chooseRoute(
      extractFeatures("Which port does Actian VectorAI use for gRPC?", strongHit, CORPUS),
      DEFAULT_POLICY, earnedLookups, { benchmarkMode: true },
    );
    expect(d.route).toBe("LEAN_RAG");
    expect(d.grounded).toBe(true);
  });
});
