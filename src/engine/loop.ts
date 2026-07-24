import { randomUUID } from "crypto";
import { inferTask } from "@/adapters/pioneer";
import { announcePromotion } from "@/adapters/band";
import { runPolicyAB } from "@/adapters/guild";
import {
  policyMarkdown,
  publishPolicyNote,
  searchTruth,
} from "@/adapters/senso";
import { scoreAnswer } from "@/engine/score";
import { pickTier } from "@/engine/seed";
import type {
  ChatMessage,
  DarwinEvent,
  DarwinState,
  GenerationSnapshot,
  RoutePolicy,
  Task,
  Trial,
} from "@/engine/types";
import { lookupAnswer, storeAnswer, listMemory } from "@/lib/answer-memory";

function evt(
  source: DarwinEvent["source"],
  summary: string,
  extra?: Partial<DarwinEvent>,
): DarwinEvent {
  return {
    id: `evt-${randomUUID().slice(0, 10)}`,
    at: new Date().toISOString(),
    source,
    summary,
    ...extra,
  };
}

function taskFromPrompt(question: string): Task {
  const q = question.trim();
  const words = q.split(/\s+/).filter(Boolean).length;
  const needs_precision =
    /\b(exact|precise|id|version|percent|%|0\.\d+|tier|model)\b/i.test(q) ||
    /\?$/.test(q);
  const length =
    words < 12 ? "short" : words < 40 ? "medium" : ("long" as const);
  return {
    id: `u-${randomUUID().slice(0, 8)}`,
    question: q,
    must_include: [],
    features: { length, needs_precision },
  };
}

function titleFromPrompt(question: string): string {
  const t = question.trim().replace(/\s+/g, " ");
  return t.length > 42 ? `${t.slice(0, 42)}...` : t || "New chat";
}

function mutateChallenger(policy: RoutePolicy, lowQualityTaskIds: string[]): RoutePolicy {
  const next: RoutePolicy = {
    ...policy,
    version: policy.version,
    label: "mutated-challenger",
    rules: policy.rules.map((r) => ({ ...r })),
    explore_rate: Math.min(0.4, policy.explore_rate + 0.05),
  };

  // Push short/non-precise work cheaper; keep precision on mid+.
  for (const rule of next.rules) {
    if (rule.when.needs_precision) {
      if (rule.use === "cheap") rule.use = "mid";
      continue;
    }
    if (rule.when.length === "short" && rule.use !== "cheap") {
      rule.use = "cheap";
      rule.max_tokens = Math.min(rule.max_tokens, 120);
    } else if (rule.use === "premium") {
      rule.use = "mid";
    }
  }

  if (lowQualityTaskIds.length > 0 && next.default_tier === "cheap") {
    next.default_tier = "mid";
  }

  return next;
}

async function runBatch(
  state: DarwinState,
  policy: RoutePolicy,
  generation: number,
  useMemory: boolean,
  tasks: Task[] = state.tasks,
): Promise<{
  trials: Trial[];
  quality: number;
  cost_usd: number;
  latency_ms: number;
  memory_hits: number;
  pioneer_calls: number;
  pioneer_live: boolean;
  senso_live: boolean;
  events: DarwinEvent[];
  dollars_avoided: number;
  low_quality_task_ids: string[];
}> {
  const trials: Trial[] = [];
  const events: DarwinEvent[] = [];
  let memory_hits = 0;
  let pioneer_calls = 0;
  let pioneer_live = false;
  let senso_live = false;
  let dollars_avoided = 0;
  const low_quality_task_ids: string[] = [];

  for (const task of tasks) {
    const explore = Math.random() < policy.explore_rate;
    const pick = pickTier(policy, task, explore);

    if (useMemory) {
      const mem = lookupAnswer(task.question);
      if (mem && mem.quality >= state.goal.min_quality - 0.05) {
        memory_hits += 1;
        dollars_avoided += Math.max(0, estimatePremiumCost() - mem.cost_usd);
        trials.push({
          id: `tr-${randomUUID().slice(0, 8)}`,
          generation,
          task_id: task.id,
          question: task.question,
          tier: mem.tier,
          model: mem.model,
          answer: mem.answer,
          quality: mem.quality,
          cost_usd: 0,
          latency_ms: 2,
          from_memory: true,
          memory_hit_id: mem.id,
          pioneer_live: false,
          senso_live: false,
          at: new Date().toISOString(),
        });
        events.push(
          evt(
            "memory",
            `Memory hit for ${task.id}: reused ${mem.id} (quality ${mem.quality.toFixed(2)}, $0 compute)`,
            { payload: { task_id: task.id, memory_id: mem.id } },
          ),
        );
        continue;
      }
    }

    const senso = await searchTruth(task.question);
    if (senso.live) senso_live = true;

    const inferred = await inferTask({
      task,
      tier: pick.tier,
      max_tokens: pick.max_tokens,
      contextSnippets: senso.hits.map((h) => h.chunk_text),
    });
    pioneer_calls += 1;
    if (inferred.live) pioneer_live = true;

    const scored = scoreAnswer({
      task,
      answer: inferred.text,
      sensoHits: senso.hits,
    });

    if (scored.score < state.goal.min_quality) {
      low_quality_task_ids.push(task.id);
    }

    const stored = storeAnswer({
      question: task.question,
      answer: inferred.text,
      tier: pick.tier,
      model: inferred.model,
      quality: scored.score,
      cost_usd: inferred.cost_usd,
    });

    trials.push({
      id: `tr-${randomUUID().slice(0, 8)}`,
      generation,
      task_id: task.id,
      question: task.question,
      tier: pick.tier,
      model: inferred.model,
      answer: inferred.text,
      quality: scored.score,
      cost_usd: inferred.cost_usd,
      latency_ms: inferred.latency_ms,
      from_memory: false,
      pioneer_live: inferred.live,
      senso_live: senso.live,
      at: new Date().toISOString(),
    });

    events.push(
      evt(
        inferred.live ? "pioneer" : "cache",
        `${task.id} → ${pick.tier}/${inferred.model.split("/").pop()} · q=${scored.score.toFixed(2)} · $${inferred.cost_usd.toFixed(5)} · ${inferred.latency_ms}ms · stored ${stored.id}`,
        {
          payload: {
            task_id: task.id,
            tier: pick.tier,
            rule_id: pick.rule_id,
            explore,
          },
        },
      ),
    );
  }

  const n = Math.max(1, trials.length);
  const quality = trials.reduce((s, t) => s + t.quality, 0) / n;
  const cost_usd = trials.reduce((s, t) => s + t.cost_usd, 0);
  const latency_ms = trials.reduce((s, t) => s + t.latency_ms, 0) / n;

  return {
    trials,
    quality,
    cost_usd,
    latency_ms,
    memory_hits,
    pioneer_calls,
    pioneer_live,
    senso_live,
    events,
    dollars_avoided,
    low_quality_task_ids,
  };
}

function estimatePremiumCost(): number {
  // mid-of-pack premium estimate for avoided-spend accounting on memory hits
  return 0.0012;
}

export async function runGeneration(state: DarwinState): Promise<{
  state: DarwinState;
  turn_events: DarwinEvent[];
}> {
  const s: DarwinState = {
    ...state,
    running: true,
    events: [...state.events],
    trials: [...state.trials],
    generations: [...state.generations],
  };
  const turn_events: DarwinEvent[] = [];

  const push = (e: DarwinEvent) => {
    s.events = [...s.events, e];
    turn_events.push(e);
  };

  // 1) Measure always-premium baseline once
  if (!s.baseline.measured) {
    push(evt("engine", "Measuring always-premium baseline (no memory reuse)…"));
    const basePolicy: RoutePolicy = {
      ...s.policy,
      label: "always-premium",
      default_tier: "premium",
      explore_rate: 0,
      rules: s.policy.rules.map((r) => ({ ...r, use: "premium" as const })),
    };
    const base = await runBatch(s, basePolicy, 0, false);
    s.baseline = {
      quality: base.quality,
      cost_usd: base.cost_usd,
      latency_ms: base.latency_ms,
      measured: true,
    };
    s.sponsor_status = {
      ...s.sponsor_status,
      pioneer: s.sponsor_status.pioneer || base.pioneer_live,
      senso: s.sponsor_status.senso || base.senso_live,
    };
    s.trials = [...s.trials, ...base.trials];
    for (const e of base.events) push(e);
    push(
      evt(
        "engine",
        `Baseline set: quality ${base.quality.toFixed(3)}, cost $${base.cost_usd.toFixed(4)}, latency ${base.latency_ms.toFixed(0)}ms`,
      ),
    );
  }

  // 2) Run challenger batch WITH memory
  const gen = s.generation + 1;
  push(
    evt(
      "engine",
      `Generation ${gen}: running challenger “${s.challenger.label}” (memory on)`,
    ),
  );

  const batch = await runBatch(s, s.challenger, gen, true);
  s.generation = gen;
  s.trials = [...s.trials, ...batch.trials];
  s.memory_stats = {
    lookups: s.memory_stats.lookups + s.tasks.length,
    hits: s.memory_stats.hits + batch.memory_hits,
    stores: s.memory_stats.stores + batch.pioneer_calls,
    dollars_avoided: s.memory_stats.dollars_avoided + batch.dollars_avoided,
  };
  s.sponsor_status = {
    ...s.sponsor_status,
    pioneer: s.sponsor_status.pioneer || batch.pioneer_live,
    senso: s.sponsor_status.senso || batch.senso_live,
  };
  for (const e of batch.events) push(e);

  const savings_pct =
    s.baseline.cost_usd > 0
      ? ((s.baseline.cost_usd - batch.cost_usd) / s.baseline.cost_usd) * 100
      : 0;

  // 3) Guild A/B
  const guild = await runPolicyAB({
    baseline_cost: s.baseline.cost_usd,
    challenger_cost: batch.cost_usd,
    challenger_quality: batch.quality,
    min_quality: s.goal.min_quality,
    max_cost_ratio: s.goal.max_cost_ratio,
  });
  if (guild.live) s.sponsor_status = { ...s.sponsor_status, guild: true };

  push(
    evt(guild.live ? "guild" : "cache", `Guild A/B: ${guild.decision}. ${guild.reason}`, {
      guild_trace_url: guild.trace_url,
      payload: { session_id: guild.session_id, live: guild.live, error: guild.error },
    }),
  );

  let promoted = false;
  if (guild.decision === "promote") {
    promoted = true;
    const promotedPolicy: RoutePolicy = {
      ...s.challenger,
      version: s.policy.version + 1,
      promoted_at: new Date().toISOString(),
      label: s.challenger.label,
    };
    s.policy = promotedPolicy;
    s.challenger = mutateChallenger(promotedPolicy, batch.low_quality_task_ids);

    const md = policyMarkdown({
      version: promotedPolicy.version,
      label: promotedPolicy.label,
      default_tier: promotedPolicy.default_tier,
      rules: promotedPolicy.rules,
      quality: batch.quality,
      cost_usd: batch.cost_usd,
      savings_pct,
    });
    s.cited_policy_markdown = md;
    const pub = await publishPolicyNote(md);
    s.cited_policy_url = pub.url ?? "/api/darwin?view=policy";
    push(
      evt("senso", `Routing policy v${promotedPolicy.version} ready (${pub.url ?? "in-app"})`, {
        payload: { live: pub.live, error: pub.error },
      }),
    );

    const band = await announcePromotion({
      policy_version: promotedPolicy.version,
      policy_label: promotedPolicy.label,
      quality: batch.quality,
      cost_usd: batch.cost_usd,
      savings_pct,
    });
    if (band.live) s.sponsor_status = { ...s.sponsor_status, band: true };
    push(
      evt(band.live ? "band" : "cache", `Band: ${band.content}`, {
        payload: { message_id: band.message_id, error: band.error },
      }),
    );
  } else {
    s.challenger = mutateChallenger(s.challenger, batch.low_quality_task_ids);
    push(
      evt(
        "engine",
        `Challenger mutated after reject (default_tier=${s.challenger.default_tier}).`,
      ),
    );
  }

  const snap: GenerationSnapshot = {
    n: gen,
    at: new Date().toISOString(),
    policy_version: s.policy.version,
    quality: batch.quality,
    cost_usd: batch.cost_usd,
    latency_ms: batch.latency_ms,
    memory_hits: batch.memory_hits,
    pioneer_calls: batch.pioneer_calls,
    promoted,
    guild_decision: guild.decision,
  };
  s.generations = [...s.generations, snap];

  s.metrics = {
    quality: batch.quality,
    cost_usd: batch.cost_usd,
    latency_ms: batch.latency_ms,
    savings_pct,
    memory_hit_rate:
      s.memory_stats.lookups > 0
        ? s.memory_stats.hits / s.memory_stats.lookups
        : 0,
  };
  s.memory = listMemory();
  s.running = false;

  push(
    evt(
      "engine",
      `Gen ${gen} done: quality ${batch.quality.toFixed(3)} · $${batch.cost_usd.toFixed(4)} · savings ${savings_pct.toFixed(1)}% · memory hits ${batch.memory_hits}/${s.tasks.length}`,
    ),
  );

  return { state: s, turn_events };
}

export async function runUserPrompt(
  state: DarwinState,
  question: string,
): Promise<{ state: DarwinState; turn_events: DarwinEvent[] }> {
  const trimmed = question.trim();
  if (!trimmed) {
    return { state, turn_events: [] };
  }

  const s: DarwinState = {
    ...state,
    running: true,
    events: [...state.events],
    trials: [...state.trials],
    generations: [...state.generations],
    chats: state.chats.map((c) => ({
      ...c,
      messages: [...c.messages],
    })),
  };
  const turn_events: DarwinEvent[] = [];
  const push = (e: DarwinEvent) => {
    s.events = [...s.events, e];
    turn_events.push(e);
  };

  let chat =
    s.chats.find((c) => c.id === s.active_chat_id) ??
    s.chats[0] ??
    null;
  if (!chat) {
    const at = new Date().toISOString();
    chat = {
      id: `chat-${randomUUID().slice(0, 8)}`,
      title: "New chat",
      created_at: at,
      updated_at: at,
      messages: [],
    };
    s.chats = [chat];
    s.active_chat_id = chat.id;
  }

  const userMsg: ChatMessage = {
    id: `msg-${randomUUID().slice(0, 10)}`,
    role: "user",
    content: trimmed,
    at: new Date().toISOString(),
  };
  chat.messages.push(userMsg);
  if (chat.messages.filter((m) => m.role === "user").length === 1) {
    chat.title = titleFromPrompt(trimmed);
  }
  chat.updated_at = userMsg.at;

  // Measure always-premium baseline once (seed batch) so savings stay grounded.
  if (!s.baseline.measured) {
    push(evt("engine", "Measuring always-premium baseline (seed batch)…"));
    const basePolicy: RoutePolicy = {
      ...s.policy,
      label: "always-premium",
      default_tier: "premium",
      explore_rate: 0,
      rules: s.policy.rules.map((r) => ({ ...r, use: "premium" as const })),
    };
    const base = await runBatch(s, basePolicy, 0, false, s.tasks);
    s.baseline = {
      quality: base.quality,
      cost_usd: base.cost_usd,
      latency_ms: base.latency_ms,
      measured: true,
    };
    s.sponsor_status = {
      ...s.sponsor_status,
      pioneer: s.sponsor_status.pioneer || base.pioneer_live,
      senso: s.sponsor_status.senso || base.senso_live,
    };
    s.trials = [...s.trials, ...base.trials];
    for (const e of base.events) push(e);
    push(
      evt(
        "engine",
        `Baseline set: quality ${base.quality.toFixed(3)}, cost $${base.cost_usd.toFixed(4)}`,
      ),
    );
  }

  const task = taskFromPrompt(trimmed);
  const gen = s.generation + 1;
  push(
    evt(
      "engine",
      `Prompt gen ${gen}: routing “${trimmed.slice(0, 64)}${trimmed.length > 64 ? "…" : ""}” via ${s.challenger.label}`,
    ),
  );

  const batch = await runBatch(s, s.challenger, gen, true, [task]);
  s.generation = gen;
  s.trials = [...s.trials, ...batch.trials];
  s.memory_stats = {
    lookups: s.memory_stats.lookups + 1,
    hits: s.memory_stats.hits + batch.memory_hits,
    stores: s.memory_stats.stores + batch.pioneer_calls,
    dollars_avoided: s.memory_stats.dollars_avoided + batch.dollars_avoided,
  };
  s.sponsor_status = {
    ...s.sponsor_status,
    pioneer: s.sponsor_status.pioneer || batch.pioneer_live,
    senso: s.sponsor_status.senso || batch.senso_live,
  };
  for (const e of batch.events) push(e);

  const baselineUnit =
    s.tasks.length > 0 ? s.baseline.cost_usd / s.tasks.length : s.baseline.cost_usd;
  const savings_pct =
    baselineUnit > 0
      ? ((baselineUnit - batch.cost_usd) / baselineUnit) * 100
      : 0;

  const guild = await runPolicyAB({
    baseline_cost: baselineUnit,
    challenger_cost: batch.cost_usd,
    challenger_quality: batch.quality,
    min_quality: s.goal.min_quality,
    max_cost_ratio: s.goal.max_cost_ratio,
  });
  if (guild.live) s.sponsor_status = { ...s.sponsor_status, guild: true };

  push(
    evt(guild.live ? "guild" : "cache", `Guild A/B: ${guild.decision}. ${guild.reason}`, {
      guild_trace_url: guild.trace_url,
      payload: { session_id: guild.session_id, live: guild.live, error: guild.error },
    }),
  );

  let promoted = false;
  if (guild.decision === "promote") {
    promoted = true;
    const promotedPolicy: RoutePolicy = {
      ...s.challenger,
      version: s.policy.version + 1,
      promoted_at: new Date().toISOString(),
      label: s.challenger.label,
    };
    s.policy = promotedPolicy;
    s.challenger = mutateChallenger(promotedPolicy, batch.low_quality_task_ids);

    const md = policyMarkdown({
      version: promotedPolicy.version,
      label: promotedPolicy.label,
      default_tier: promotedPolicy.default_tier,
      rules: promotedPolicy.rules,
      quality: batch.quality,
      cost_usd: batch.cost_usd,
      savings_pct,
    });
    s.cited_policy_markdown = md;
    const pub = await publishPolicyNote(md);
    s.cited_policy_url = pub.url ?? "/api/darwin?view=policy";
    push(
      evt("senso", `Routing policy v${promotedPolicy.version} ready (${pub.url ?? "in-app"})`, {
        payload: { live: pub.live, error: pub.error },
      }),
    );

    const band = await announcePromotion({
      policy_version: promotedPolicy.version,
      policy_label: promotedPolicy.label,
      quality: batch.quality,
      cost_usd: batch.cost_usd,
      savings_pct,
    });
    if (band.live) s.sponsor_status = { ...s.sponsor_status, band: true };
    push(
      evt(band.live ? "band" : "cache", `Band: ${band.content}`, {
        payload: { message_id: band.message_id, error: band.error },
      }),
    );
  } else {
    s.challenger = mutateChallenger(s.challenger, batch.low_quality_task_ids);
    push(
      evt(
        "engine",
        `Challenger mutated after reject (default_tier=${s.challenger.default_tier}).`,
      ),
    );
  }

  const trial = batch.trials[0];
  const assistantMsg: ChatMessage = {
    id: `msg-${randomUUID().slice(0, 10)}`,
    role: "assistant",
    content: trial?.answer ?? "No answer produced.",
    at: new Date().toISOString(),
    trial_id: trial?.id,
    tier: trial?.tier,
    model: trial?.model,
    quality: trial?.quality,
    cost_usd: trial?.cost_usd,
    from_memory: trial?.from_memory,
  };
  chat.messages.push(assistantMsg);
  chat.updated_at = assistantMsg.at;

  s.chats = s.chats.map((c) => (c.id === chat!.id ? { ...chat! } : c));
  s.active_chat_id = chat.id;

  const snap: GenerationSnapshot = {
    n: gen,
    at: new Date().toISOString(),
    policy_version: s.policy.version,
    quality: batch.quality,
    cost_usd: batch.cost_usd,
    latency_ms: batch.latency_ms,
    memory_hits: batch.memory_hits,
    pioneer_calls: batch.pioneer_calls,
    promoted,
    guild_decision: guild.decision,
  };
  s.generations = [...s.generations, snap];

  s.metrics = {
    quality: batch.quality,
    cost_usd: batch.cost_usd,
    latency_ms: batch.latency_ms,
    savings_pct,
    memory_hit_rate:
      s.memory_stats.lookups > 0
        ? s.memory_stats.hits / s.memory_stats.lookups
        : 0,
  };
  s.memory = listMemory();
  s.running = false;

  push(
    evt(
      "engine",
      `Prompt done: quality ${batch.quality.toFixed(3)} · $${batch.cost_usd.toFixed(4)} · savings ${savings_pct.toFixed(1)}%${trial?.from_memory ? " · memory" : ""}`,
    ),
  );

  return { state: s, turn_events };
}
