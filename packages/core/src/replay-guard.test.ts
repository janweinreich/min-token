import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPLAY_POLICY,
  EXTRACTOR_VERSION,
  buildEmbeddingText,
  evaluateReplay,
  gateCompatible,
  normalizeForExact,
  type Candidate,
  type MemoryRecord,
} from "./replay-guard.js";

const SNAPSHOT = "sponsor-docs-v1";

function mem(over: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "m1",
    normalizedQuestion: "how do i install the actian javascript sdk",
    answerText: "Install @actian/vectorai-client with npm: `npm install @actian/vectorai-client`.",
    answerFormat: "concise",
    language: "en",
    status: "approved",
    replayable: true,
    volatile: false,
    criticalFailure: false,
    qualityScore: 0.97,
    citationScore: 1.0,
    kbSnapshotId: SNAPSHOT,
    embeddingModelId: "Xenova/all-MiniLM-L6-v2",
    extractorVersion: EXTRACTOR_VERSION,
    negativeFeedbackCount: 0,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

/** Cosines below are the MEASURED values from scripts/spike-embed.ts. */
function cand(m: MemoryRecord, cosMasked: number, cosRaw: number): Candidate {
  return { memory: m, cosMasked, cosRaw };
}

const base = {
  policy: DEFAULT_REPLAY_POLICY,
  activeSnapshotId: SNAPSHOT,
  semanticEnabled: true,
};

describe("normalization", () => {
  it("preserves meaning-bearing tokens", () => {
    const n = normalizeForExact("  How do I install the Actian JavaScript SDK?  ");
    expect(n).toBe("how do i install the actian javascript sdk");
  });

  it("collapses entity identity in the embedded text but not the exact text", () => {
    const js = buildEmbeddingText("How do I install the Actian JavaScript SDK?");
    const py = buildEmbeddingText("How do I install the Actian Python SDK?");
    // Deliberately identical: the vector measures question SHAPE. The gate decides identity.
    expect(js).toBe(py);
    expect(normalizeForExact("How do I install the Actian Python SDK?")).not.toBe(
      normalizeForExact("How do I install the Actian JavaScript SDK?"),
    );
  });
});

describe("Journey A — exact replay", () => {
  it("replays an identical question with zero generation", () => {
    const d = evaluateReplay({
      ...base,
      queryText: "How do I install the Actian JavaScript SDK?",
      candidates: [cand(mem(), 1.0, 0.993)],
    });
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.kind).toBe("exact");
  });
});

describe("Journey B — safe paraphrase replays", () => {
  it("allows the npm/TypeScript paraphrase the spec's tau=0.97 would have refused", () => {
    const d = evaluateReplay({
      ...base,
      queryText: "Which npm package should I install to use Actian VectorAI from TypeScript?",
      candidates: [cand(mem(), 0.655, 0.524)],
    });
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.kind).toBe("semantic");
    // The measured raw cosine is 0.524 — far under the spec's 0.97.
    expect(0.524).toBeLessThan(0.97);
  });
});

describe("Journey C — unsafe near-matches are rejected", () => {
  it("rejects the Python swap despite it OUTSCORING the legitimate paraphrase", () => {
    const d = evaluateReplay({
      ...base,
      queryText: "How do I install the Actian Python SDK?",
      // Measured: masked collapses to 1.000, raw 0.755 — both above the paraphrase.
      candidates: [cand(mem(), 1.0, 0.755)],
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      const all = d.rejections.flatMap((r) => r.reasons).join(",");
      expect(all).toMatch(/ecosystem_conflict|uncovered_language/);
    }
  });

  it("rejects the operation swap install -> uninstall", () => {
    const d = evaluateReplay({
      ...base,
      queryText: "How do I uninstall the Actian JavaScript SDK?",
      candidates: [cand(mem(), 0.805, 0.788)],
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.rejections.flatMap((r) => r.reasons).join(",")).toMatch(/uncovered_operation/);
    }
  });

  it("rejects a temporal question outright", () => {
    const d = evaluateReplay({
      ...base,
      queryText: "What is the latest version of the Actian JavaScript SDK?",
      candidates: [cand(mem(), 0.779, 0.809)],
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.rejections.flatMap((r) => r.reasons).join(",")).toContain("query_temporal");
    }
  });

  it("rejects an action-intent question", () => {
    const d = evaluateReplay({
      ...base,
      queryText: "Delete my Actian collection using the JavaScript SDK",
      candidates: [cand(mem(), 0.9, 0.7)],
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.rejections.flatMap((r) => r.reasons).join(",")).toContain("query_action_intent");
    }
  });

  it("catches an entity the stored QUESTION never mentioned, via the answer text", () => {
    // Stored question is language-neutral; only the answer reveals it is npm/JS.
    const m = mem({ normalizedQuestion: "how do i install the actian sdk" });
    const d = evaluateReplay({
      ...base,
      queryText: "How do I install the Actian SDK with pip?",
      candidates: [cand(m, 0.95, 0.85)],
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.rejections.flatMap((r) => r.reasons).join(",")).toMatch(
        /ecosystem_conflict|uncovered_packageManager/,
      );
    }
  });
});

describe("Journey G — snapshot invalidation", () => {
  it("refuses to replay a memory bound to a superseded snapshot", () => {
    const d = evaluateReplay({
      ...base,
      queryText: "How do I install the Actian JavaScript SDK?",
      candidates: [cand(mem({ kbSnapshotId: "sponsor-docs-v0" }), 1.0, 0.993)],
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.rejections.flatMap((r) => r.reasons).join(",")).toContain("stale_snapshot");
    }
  });
});

describe("memory lifecycle preconditions", () => {
  it.each([
    ["candidate memory is never replayed", { status: "candidate" as const }, "status:candidate"],
    ["revoked memory is never replayed", { status: "revoked" as const }, "status:revoked"],
    ["negative feedback blocks replay", { negativeFeedbackCount: 1 }, "negative_feedback"],
    ["volatile memory blocks replay", { volatile: true }, "volatile"],
    ["a critical failure blocks replay", { criticalFailure: true }, "critical_failure"],
    ["extractor drift blocks replay", { extractorVersion: 999 }, "extractor_version_drift"],
  ])("%s", (_name, over, expected) => {
    const d = evaluateReplay({
      ...base,
      queryText: "How do I install the Actian JavaScript SDK?",
      candidates: [cand(mem(over), 1.0, 0.993)],
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.rejections.flatMap((r) => r.reasons).join(",")).toContain(expected);
    }
  });
});

describe("margin defect from the spec", () => {
  it("does NOT let two near-duplicate good memories cancel each other", () => {
    const a = mem({ id: "a" });
    const b = mem({ id: "b" }); // same answer text => materially equivalent
    const d = evaluateReplay({
      ...base,
      queryText: "Which npm package do I need for Actian VectorAI in TypeScript?",
      candidates: [cand(a, 0.66, 0.53), cand(b, 0.659, 0.529)],
    });
    // Under the spec's raw top1-vs-top2 margin this would be refused (gap 0.001).
    expect(d.allowed).toBe(true);
  });

  it("still refuses when the competitor is a materially DIFFERENT answer", () => {
    const a = mem({ id: "a" });
    // Must itself PASS the gate (same npm/JS entities), or it never reaches the
    // margin check and the test would pass for the wrong reason.
    const b = mem({
      id: "b",
      answerText: "With npm, install @actian/vectorai-server — the client package is deprecated.",
    });
    const d = evaluateReplay({
      ...base,
      queryText: "Which npm package do I need for Actian VectorAI in TypeScript?",
      candidates: [cand(a, 0.66, 0.53), cand(b, 0.659, 0.529)],
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.rejections.flatMap((r) => r.reasons).join(",")).toMatch(/ambiguous_margin/);
    }
  });
});

describe("degraded embedder honesty", () => {
  it("hard-disables semantic replay but keeps exact replay working", () => {
    const semantic = evaluateReplay({
      ...base,
      semanticEnabled: false,
      queryText: "Which npm package should I install for Actian from TypeScript?",
      candidates: [cand(mem(), 0.655, 0.524)],
    });
    expect(semantic.allowed).toBe(false);

    const exact = evaluateReplay({
      ...base,
      semanticEnabled: false,
      queryText: "How do I install the Actian JavaScript SDK?",
      candidates: [cand(mem(), 1.0, 0.993)],
    });
    expect(exact.allowed).toBe(true);
  });
});

describe("gate directionality", () => {
  it("a JavaScript answer serves a TypeScript question", () => {
    expect(
      gateCompatible({
        queryText: "How do I install the Actian SDK in TypeScript?",
        memory: mem(),
      }).ok,
    ).toBe(true);
  });

  it("a TypeScript-specific answer does NOT serve a plain JavaScript question", () => {
    const tsOnly = mem({
      normalizedQuestion: "how do i type the actian client in typescript",
      answerText: "Import the TypeScript types from the typescript declaration bundle.",
    });
    expect(
      gateCompatible({ queryText: "How do I use the Actian client in JavaScript?", memory: tsOnly })
        .ok,
    ).toBe(false);
  });
});
