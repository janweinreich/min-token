import type {
  ChatSession,
  DarwinState,
  RoutePolicy,
  RouteTier,
  Task,
} from "./types";

/** Grounded Q&A about mintoken itself. Scoring uses must_include vs answer text (+ Senso when live). */
export const DEMO_TASKS: Task[] = [
  {
    id: "t01",
    question: "What does mintoken optimize for?",
    must_include: ["quality", "cost"],
    features: { length: "short", needs_precision: false },
  },
  {
    id: "t02",
    question: "What quality floor does mintoken target?",
    must_include: ["0.90", "90"],
    features: { length: "short", needs_precision: true },
  },
  {
    id: "t03",
    question: "How much cost reduction is the standing goal versus always-premium?",
    must_include: ["40"],
    features: { length: "short", needs_precision: true },
  },
  {
    id: "t04",
    question: "Which three Pioneer route tiers does the policy use?",
    must_include: ["cheap", "mid", "premium"],
    features: { length: "short", needs_precision: true },
  },
  {
    id: "t05",
    question: "What role does Senso play in scoring answers?",
    must_include: ["ground", "truth", "score"],
    features: { length: "medium", needs_precision: false },
  },
  {
    id: "t06",
    question: "When does Guild promote a challenger routing policy?",
    must_include: ["quality", "cost", "promote"],
    features: { length: "medium", needs_precision: false },
  },
  {
    id: "t07",
    question: "What does Band announce after a successful promote?",
    must_include: ["cost", "quality", "policy"],
    features: { length: "medium", needs_precision: false },
  },
  {
    id: "t08",
    question: "Why skip recomputing an answer that was already solved?",
    must_include: ["memory", "cost"],
    features: { length: "short", needs_precision: false },
  },
  {
    id: "t09",
    question: "What artifact gets published when a policy wins?",
    must_include: ["routing", "policy", "cited"],
    features: { length: "medium", needs_precision: false },
  },
  {
    id: "t10",
    question: "Name the five sponsor tools wired into mintoken.",
    must_include: ["pioneer", "senso", "guild", "band", "replay"],
    features: { length: "medium", needs_precision: true },
  },
  {
    id: "t11",
    question: "What happens if a cheap route scores below the quality floor?",
    must_include: ["reject", "tier", "quality"],
    features: { length: "medium", needs_precision: false },
  },
  {
    id: "t12",
    question: "How does answer memory reduce spend on repeat questions?",
    must_include: ["lookup", "reuse", "compute"],
    features: { length: "medium", needs_precision: false },
  },
];

export function initialPolicy(label = "always-premium"): RoutePolicy {
  return {
    version: 1,
    default_tier: "premium",
    explore_rate: 0.15,
    label,
    rules: [
      {
        id: "r-short",
        when: { length: "short", needs_precision: false },
        use: "premium",
        max_tokens: 180,
      },
      {
        id: "r-precise",
        when: { needs_precision: true },
        use: "premium",
        max_tokens: 220,
      },
    ],
  };
}

export function cheapChallenger(): RoutePolicy {
  return {
    version: 1,
    default_tier: "cheap",
    explore_rate: 0.25,
    label: "prefer-cheap",
    rules: [
      {
        id: "r-short-cheap",
        when: { length: "short", needs_precision: false },
        use: "cheap",
        max_tokens: 120,
      },
      {
        id: "r-mid",
        when: { length: "medium", needs_precision: false },
        use: "mid",
        max_tokens: 160,
      },
      {
        id: "r-precise-mid",
        when: { needs_precision: true },
        use: "mid",
        max_tokens: 200,
      },
    ],
  };
}

export function newChatSession(title = "New chat"): ChatSession {
  const at = new Date().toISOString();
  return {
    id: `chat-${Math.random().toString(36).slice(2, 10)}`,
    title,
    created_at: at,
    updated_at: at,
    messages: [],
  };
}

export function createInitialState(): DarwinState {
  const chat = newChatSession();
  return {
    goal: { min_quality: 0.9, max_cost_ratio: 0.6 },
    tasks: DEMO_TASKS,
    chats: [chat],
    active_chat_id: chat.id,
    baseline: { quality: 0, cost_usd: 0, latency_ms: 0, measured: false },
    policy: initialPolicy(),
    challenger: cheapChallenger(),
    trials: [],
    generations: [],
    events: [
      {
        id: "evt-boot",
        at: new Date().toISOString(),
        source: "engine",
        summary:
          "mintoken ready. Type a prompt to route via Pioneer, score with Senso, and evolve cheaper policies.",
      },
    ],
    memory: [],
    memory_stats: { lookups: 0, hits: 0, stores: 0, dollars_avoided: 0 },
    metrics: {
      quality: 0,
      cost_usd: 0,
      latency_ms: 0,
      savings_pct: 0,
      memory_hit_rate: 0,
    },
    sponsor_status: {
      pioneer: false,
      senso: false,
      guild: false,
      band: false,
      replay: false,
    },
    autopilot: false,
    generation: 0,
    running: false,
  };
}

export function pickTier(
  policy: RoutePolicy,
  task: Task,
  explore: boolean,
): { tier: RouteTier; max_tokens: number; rule_id: string } {
  if (explore) {
    const order: RouteTier[] = ["cheap", "mid", "premium"];
    const idx = Math.max(0, order.indexOf(policy.default_tier) - 1);
    return {
      tier: order[idx] ?? "cheap",
      max_tokens: 140,
      rule_id: "explore",
    };
  }
  for (const rule of policy.rules) {
    const lengthOk =
      rule.when.length === undefined || rule.when.length === task.features.length;
    const precisionOk =
      rule.when.needs_precision === undefined ||
      rule.when.needs_precision === task.features.needs_precision;
    if (lengthOk && precisionOk) {
      return { tier: rule.use, max_tokens: rule.max_tokens, rule_id: rule.id };
    }
  }
  return {
    tier: policy.default_tier,
    max_tokens: 180,
    rule_id: "default",
  };
}
