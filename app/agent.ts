/**
 * The live agent singleton.
 *
 * Module scope, attached to globalThis so Next's dev HMR does not load a second
 * ONNX session or lose the accumulated memory and episodes mid-demo.
 */
import { InMemoryVectorStore } from "../packages/core/src/adapters/in-memory-store.js";
import { LocalContextProvider } from "../packages/core/src/adapters/local-context.js";
import { anthropicInference, pioneerInference } from "../packages/core/src/adapters/messages-inference.js";
import { miniLmEmbedder } from "../packages/core/src/embeddings/minilm.js";
import { ANSWER_MEMORY, ask, type AskResponse, type PipelineDeps } from "../packages/core/src/pipeline.js";
import { DEFAULT_POLICY } from "../packages/core/src/policy.js";
import { leanSuccessLowerBound, type RoutingEpisode } from "../packages/core/src/router.js";
import { classifyTask } from "../packages/core/src/features.js";
import {
  DEFAULT_REPLAY_POLICY,
  EXTRACTOR_VERSION,
  buildEmbeddingText,
  normalizeForExact,
} from "../packages/core/src/replay-guard.js";

const SNAPSHOT = "sponsor-docs-v1";
const TENANT = "demo";

/**
 * Measured per-case averages from the live benchmark (artifacts/benchmark.json).
 * Used ONLY for the per-request counterfactual, which the UI labels `est.` —
 * the hard number is the committed benchmark comparison, not this.
 */
export const MEASURED = {
  leanTokensPerCase: 331,
  strongTokensPerCase: 765,
  routerQuality: 0.947,
  strongQuality: 0.937,
  leanQuality: 0.911,
  routerTokens: 12501,
  strongTokens: 15291,
  leanTokens: 6619,
  cases: 20,
};

export interface Agent {
  deps: PipelineDeps;
  episodes: RoutingEpisode[];
  session: { asks: number; spent: number; avoidedEst: number; replays: number };
  ready: Promise<void>;
}

declare global {
  // eslint-disable-next-line no-var
  var __bdAgent: Agent | undefined;
}

function build(): Agent {
  const store = new InMemoryVectorStore({
    dimension: miniLmEmbedder.dimension,
    persistPath: "data/memory/live.jsonl",
  });
  const knowledge = new LocalContextProvider("data/sources", miniLmEmbedder);
  const key = process.env.PIONEER_API_KEY;
  const inference = key
    ? pioneerInference(key)
    : anthropicInference(process.env.ANTHROPIC_API_KEY ?? "");

  const agent: Agent = {
    deps: {
      embeddings: miniLmEmbedder,
      vectors: store,
      inference,
      knowledge,
      policy: DEFAULT_REPLAY_POLICY,
      routingPolicy: DEFAULT_POLICY,
      activeSnapshotId: SNAPSHOT,
      benchmarkMode: false, // exploration ON in the live path
      episodes: [],
    },
    episodes: [],
    session: { asks: 0, spent: 0, avoidedEst: 0, replays: 0 },
    ready: Promise.resolve(),
  };

  agent.ready = (async () => {
    await store.ensureCollection(ANSWER_MEMORY, miniLmEmbedder.dimension);
    await store.restore();
    await knowledge.load();
  })();

  return agent;
}

export function agent(): Agent {
  globalThis.__bdAgent ??= build();
  return globalThis.__bdAgent;
}

export interface LearnedRow {
  taskType: string;
  leanTried: number;
  cleanWins: number;
  lcb: number;
  verdict: "use lean" | "skip lean" | "gathering evidence";
}

export function learned(a: Agent): LearnedRow[] {
  const byType = new Map<string, RoutingEpisode[]>();
  for (const e of a.episodes) {
    const list = byType.get(e.taskType ?? "unknown") ?? [];
    list.push(e);
    byType.set(e.taskType ?? "unknown", list);
  }
  return [...byType.entries()]
    .sort()
    .map(([taskType, list]) => {
      const lean = list.filter((e) => e.route === "LEAN_RAG");
      const clean = lean.filter((e) => e.passed && !e.repaired);
      const lcb = leanSuccessLowerBound(list, DEFAULT_POLICY.relatedThreshold, 1.2816, taskType);
      return {
        taskType,
        leanTried: lean.length,
        cleanWins: clean.length,
        lcb,
        verdict:
          lean.length < 3
            ? ("gathering evidence" as const)
            : lcb >= DEFAULT_POLICY.leanMinHistoricalSuccess
              ? ("use lean" as const)
              : ("skip lean" as const),
      };
    });
}

/** Approve a generated answer into memory so a later paraphrase can replay it. */
async function approve(a: Agent, question: string, answer: string) {
  const [vec] = await miniLmEmbedder.embedBatch([buildEmbeddingText(question)]);
  await a.deps.vectors.upsert(ANSWER_MEMORY, [
    {
      id: `live-${Date.now()}`,
      vector: vec!,
      payload: {
        id: `live-${Date.now()}`,
        tenantId: TENANT,
        normalizedQuestion: normalizeForExact(question),
        answerText: answer,
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
    },
  ]);
}

export async function handle(question: string, autoApprove: boolean) {
  const a = agent();
  await a.ready;

  const r: AskResponse = await ask({ ...a.deps, episodes: a.episodes }, { question, tenantId: TENANT });

  const replayed = r.route.endsWith("REPLAY");
  const spent = r.usage.totalGenerationTokens;
  // Counterfactual: what an always-strong agent would have spent. An ESTIMATE
  // from measured per-case averages — the UI labels it as such, and the hard
  // number is the committed benchmark comparison.
  const strongEst = MEASURED.strongTokensPerCase;

  a.session.asks++;
  a.session.spent += spent;
  a.session.avoidedEst += Math.max(0, strongEst - spent);
  if (replayed) a.session.replays++;

  if (!replayed && r.routing) {
    a.episodes.push({
      similarity: 1,
      route: r.routing.route,
      // No live grader, so "passed" means the pipeline produced a grounded,
      // non-abstained answer. Weaker than the benchmark's scored pass — stated
      // rather than dressed up.
      passed: r.route !== "ABSTAIN" && r.answer.length > 40,
      repaired: false,
      taskType: classifyTask(question),
      generationTokens: spent,
    });
    if (autoApprove && r.answer.length > 40 && r.route !== "ABSTAIN") {
      await approve(a, question, r.answer);
    }
  }

  return {
    ...r,
    strongEstimate: strongEst,
    session: a.session,
    learned: learned(a),
    measured: MEASURED,
    policyVersion: 1,
    episodeCount: a.episodes.length,
  };
}
