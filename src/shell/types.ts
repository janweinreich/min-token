/** Stable UI contracts for the live mintoken dashboard. */

export type ShellChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: string;
  tier?: string;
  model?: string;
  quality?: number;
  cost_usd?: number;
  from_memory?: boolean;
};

export type ShellChat = {
  id: string;
  title: string;
  messages: ShellChatMessage[];
};

export type ShellState = {
  chats: ShellChat[];
  active_chat_id: string;
  goal: { min_quality: number };
  goal_met: boolean;
  metrics: {
    quality: number | null;
    cost_usd: number | null;
    savings_pct: number | null;
    memory_hits: number;
    dollars_avoided: number;
    memory_hit_rate: number;
  };
  baseline_unit_cost: number | null;
  policy: {
    version: number;
    label: string;
    default_tier: string;
    challenger_label: string;
    challenger_tier: string;
    rules: { id: string; use: string; max_tokens: number }[];
  };
  generations: {
    n: number;
    promoted: boolean;
    quality: number;
    cost_usd: number;
    memory_hits: number;
  }[];
  events: { id: string; source: string; summary: string; guild_trace_url?: string }[];
  memory: {
    id: string;
    hits: number;
    question: string;
    tier: string;
    quality: number;
  }[];
  replay_marked: boolean;
};

export type ShellHandlers = {
  onAsk?: (question: string) => void | Promise<void>;
  onNewChat?: () => void | Promise<void>;
  onSelectChat?: (chatId: string) => void | Promise<void>;
  onReset?: () => void | Promise<void>;
  onMarkReplay?: () => void | Promise<void>;
};

export function createShellState(): ShellState {
  const chatId = "chat-demo";
  return {
    chats: [
      {
        id: chatId,
        title: "New chat",
        messages: [],
      },
    ],
    active_chat_id: chatId,
    goal: { min_quality: 0.9 },
    goal_met: false,
    metrics: {
      quality: null,
      cost_usd: null,
      savings_pct: null,
      memory_hits: 0,
      dollars_avoided: 0,
      memory_hit_rate: 0,
    },
    baseline_unit_cost: null,
    policy: {
      version: 1,
      label: "prefer-cheap",
      default_tier: "cheap",
      challenger_label: "mutated-challenger",
      challenger_tier: "mid",
      rules: [
        { id: "r-short-cheap", use: "cheap", max_tokens: 120 },
        { id: "r-mid", use: "mid", max_tokens: 160 },
        { id: "r-precise-mid", use: "mid", max_tokens: 200 },
      ],
    },
    generations: [],
    events: [
      {
        id: "evt-shell",
        source: "engine",
        summary: "mintoken is ready for a prompt.",
      },
    ],
    memory: [],
    replay_marked: false,
  };
}

export function newShellChat(title = "New chat"): ShellChat {
  return {
    id: `chat-${Math.random().toString(36).slice(2, 10)}`,
    title,
    messages: [],
  };
}
