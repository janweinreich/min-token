import { randomUUID } from "node:crypto";
import { handle } from "../../app/agent.js";
import type {
  AnswerMemoryRecord,
  ChatMessage,
  DarwinEvent,
  DarwinState,
  GenerationSnapshot,
  RouteTier,
} from "./types";

export type CoreResult = Awaited<ReturnType<typeof handle>>;

function routeTier(route: CoreResult["route"]): RouteTier {
  if (route === "LEAN_RAG") return "cheap";
  if (route === "AUTO_CODE") return "mid";
  return "premium";
}

function titleFromPrompt(question: string): string {
  const title = question.trim().replace(/\s+/g, " ");
  return title.length > 42 ? `${title.slice(0, 42)}...` : title || "New chat";
}

function event(source: DarwinEvent["source"], summary: string): DarwinEvent {
  return {
    id: `evt-${randomUUID().slice(0, 10)}`,
    at: new Date().toISOString(),
    source,
    summary,
  };
}

function qualityFor(result: CoreResult): number {
  if (result.route === "ABSTAIN") return 0;
  if (result.memory.hit) return 0.97;
  if (result.route === "LEAN_RAG") return result.measured.leanQuality;
  return result.measured.strongQuality;
}

function updateMemory(
  memory: AnswerMemoryRecord[],
  question: string,
  result: CoreResult,
  tier: RouteTier,
  quality: number,
): AnswerMemoryRecord[] {
  if (result.route === "ABSTAIN") return memory;

  const now = new Date().toISOString();
  if (result.memory.hit) {
    const id = result.memory.memoryId ?? `memory-${result.runId}`;
    const existing = memory.find((record) => record.id === id);
    if (existing) {
      return memory.map((record) =>
        record.id === id
          ? { ...record, hits: record.hits + 1, updated_at: now }
          : record,
      );
    }
    return [
      {
        id,
        question_norm: question.toLowerCase(),
        question,
        answer: result.answer,
        tier,
        model: result.selectedModelId ?? "answer-memory",
        quality,
        cost_usd: 0,
        hits: 1,
        created_at: now,
        updated_at: now,
      },
      ...memory,
    ];
  }

  return [
    {
      id: `memory-${result.runId}`,
      question_norm: question.toLowerCase(),
      question,
      answer: result.answer,
      tier,
      model: result.selectedModelId ?? result.route,
      quality,
      cost_usd: result.usage.estimatedCostUsd,
      hits: 0,
      created_at: now,
      updated_at: now,
    },
    ...memory,
  ];
}

export function applyCoreResult(
  state: DarwinState,
  question: string,
  result: CoreResult,
): DarwinState {
  const now = new Date().toISOString();
  const replayed = result.memory.hit;
  const tier = routeTier(result.route);
  const quality = qualityFor(result);
  const generation = state.generation + 1;
  const spentTokens = result.savings.tokensUsed;
  const savingsPct = result.savings.pct;
  const baselineUnitCost = result.savings.usdBaseline;

  const chats = state.chats.map((chat) => ({
    ...chat,
    messages: [...chat.messages],
  }));
  let chat = chats.find((candidate) => candidate.id === state.active_chat_id);
  if (!chat) chat = chats[0];
  if (!chat) throw new Error("No active chat.");

  const userMessage: ChatMessage = {
    id: `msg-${randomUUID().slice(0, 10)}`,
    role: "user",
    content: question,
    at: now,
  };
  const assistantMessage: ChatMessage = {
    id: `msg-${randomUUID().slice(0, 10)}`,
    role: "assistant",
    content: result.answer,
    at: now,
    trial_id: result.runId,
    tier,
    model: result.selectedModelId ?? result.route,
    quality,
    cost_usd: result.usage.estimatedCostUsd,
    from_memory: replayed,
  };
  chat.messages.push(userMessage, assistantMessage);
  if (chat.messages.filter((message) => message.role === "user").length === 1) {
    chat.title = titleFromPrompt(question);
  }
  chat.updated_at = now;

  const routeSummary = `${result.route.replaceAll("_", " ")} · ${spentTokens} generation tokens · ${result.latencyMs}ms`;
  const reasonSummary = result.routing?.reasons.join(" · ");
  const turnEvents = [
    event(replayed ? "memory" : "engine", routeSummary),
    ...(reasonSummary ? [event("engine", reasonSummary)] : []),
  ];
  const snapshot: GenerationSnapshot = {
    n: generation,
    at: now,
    policy_version: result.policyVersion,
    quality,
    cost_usd: result.usage.estimatedCostUsd,
    latency_ms: result.latencyMs,
    memory_hits: replayed ? 1 : 0,
    pioneer_calls: replayed || result.route === "ABSTAIN" ? 0 : 1,
    promoted: false,
    guild_decision: "skip",
  };
  const lookups = state.memory_stats.lookups + 1;
  const hits = state.memory_stats.hits + (replayed ? 1 : 0);

  return {
    ...state,
    chats,
    active_chat_id: chat.id,
    baseline: {
      quality: result.measured.strongQuality,
      cost_usd: baselineUnitCost,
      latency_ms: state.baseline.latency_ms,
      measured: true,
    },
    policy: {
      ...state.policy,
      version: result.policyVersion,
      label: "budget-darwin",
      default_tier: tier,
    },
    trials: state.trials,
    generations: [...state.generations, snapshot],
    events: [...state.events, ...turnEvents],
    memory: updateMemory(state.memory, question, result, tier, quality),
    memory_stats: {
      lookups,
      hits,
      stores:
        state.memory_stats.stores +
        (!replayed && result.route !== "ABSTAIN" ? 1 : 0),
      dollars_avoided:
        state.memory_stats.dollars_avoided +
        result.savings.usdSaved,
    },
    metrics: {
      quality,
      cost_usd: result.usage.estimatedCostUsd,
      latency_ms: result.latencyMs,
      savings_pct: savingsPct,
      memory_hit_rate: hits / lookups,
    },
    sponsor_status: {
      ...state.sponsor_status,
      pioneer:
        state.sponsor_status.pioneer ||
        (!replayed && result.route !== "ABSTAIN"),
    },
    generation,
    running: false,
  };
}

export async function runCoreUserPrompt(
  state: DarwinState,
  question: string,
): Promise<{ state: DarwinState; turn_events: DarwinEvent[] }> {
  const trimmed = question.trim();
  if (!trimmed) return { state, turn_events: [] };

  const result = await handle(trimmed, true, "learned");
  const next = applyCoreResult(state, trimmed, result);
  return {
    state: next,
    turn_events: next.events.slice(state.events.length),
  };
}
