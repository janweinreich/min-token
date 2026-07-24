export type RouteTier = "cheap" | "mid" | "premium";

export type Task = {
  id: string;
  question: string;
  /** Keywords / short facts that a correct answer should cover */
  must_include: string[];
  features: {
    length: "short" | "medium" | "long";
    needs_precision: boolean;
  };
};

export type RouteRule = {
  id: string;
  when: {
    length?: Task["features"]["length"];
    needs_precision?: boolean;
  };
  use: RouteTier;
  max_tokens: number;
};

export type RoutePolicy = {
  version: number;
  default_tier: RouteTier;
  rules: RouteRule[];
  explore_rate: number;
  promoted_at?: string;
  label: string;
};

export type Trial = {
  id: string;
  generation: number;
  task_id: string;
  question: string;
  tier: RouteTier;
  model: string;
  answer: string;
  quality: number;
  cost_usd: number;
  latency_ms: number;
  from_memory: boolean;
  memory_hit_id?: string;
  pioneer_live: boolean;
  senso_live: boolean;
  at: string;
};

export type GenerationSnapshot = {
  n: number;
  at: string;
  policy_version: number;
  quality: number;
  cost_usd: number;
  latency_ms: number;
  memory_hits: number;
  pioneer_calls: number;
  promoted: boolean;
  guild_decision?: "promote" | "reject" | "skip";
};

export type DarwinEvent = {
  id: string;
  at: string;
  source: "engine" | "pioneer" | "senso" | "guild" | "band" | "memory" | "cache";
  summary: string;
  guild_trace_url?: string;
  payload?: Record<string, unknown>;
};

export type SponsorStatus = {
  pioneer: boolean;
  senso: boolean;
  guild: boolean;
  band: boolean;
  replay: boolean;
};

export type AnswerMemoryRecord = {
  id: string;
  question_norm: string;
  question: string;
  answer: string;
  tier: RouteTier;
  model: string;
  quality: number;
  cost_usd: number;
  hits: number;
  created_at: string;
  updated_at: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: string;
  trial_id?: string;
  tier?: RouteTier;
  model?: string;
  quality?: number;
  cost_usd?: number;
  from_memory?: boolean;
};

export type ChatSession = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages: ChatMessage[];
};

export type DarwinState = {
  goal: {
    min_quality: number;
    max_cost_ratio: number;
  };
  tasks: Task[];
  chats: ChatSession[];
  active_chat_id: string;
  baseline: {
    quality: number;
    cost_usd: number;
    latency_ms: number;
    measured: boolean;
  };
  policy: RoutePolicy;
  challenger: RoutePolicy;
  trials: Trial[];
  generations: GenerationSnapshot[];
  events: DarwinEvent[];
  memory: AnswerMemoryRecord[];
  memory_stats: {
    lookups: number;
    hits: number;
    stores: number;
    dollars_avoided: number;
  };
  metrics: {
    quality: number;
    cost_usd: number;
    latency_ms: number;
    savings_pct: number;
    memory_hit_rate: number;
  };
  sponsor_status: SponsorStatus;
  autopilot: boolean;
  cited_policy_url?: string;
  cited_policy_markdown?: string;
  generation: number;
  running: boolean;
};

export type AdvanceResult = {
  state: DarwinState;
  turn_events: DarwinEvent[];
};
