import type { DarwinState } from "@/engine/types";
import type { ShellState } from "@/shell/types";

export function toShellState(state: DarwinState): ShellState {
  const baselineUnit =
    state.baseline.measured && state.tasks.length
      ? state.baseline.cost_usd / state.tasks.length
      : null;
  const measured = state.generation > 0;

  return {
    chats: state.chats.map((chat) => ({
      id: chat.id,
      title: chat.title,
      messages: chat.messages,
    })),
    active_chat_id: state.active_chat_id,
    goal: { min_quality: state.goal.min_quality },
    goal_met:
      measured &&
      state.metrics.quality >= state.goal.min_quality &&
      state.metrics.savings_pct >= 40,
    metrics: {
      quality: measured ? state.metrics.quality : null,
      cost_usd: measured ? state.metrics.cost_usd : null,
      savings_pct: measured ? state.metrics.savings_pct : null,
      memory_hits: state.memory_stats.hits,
      dollars_avoided: state.memory_stats.dollars_avoided,
      memory_hit_rate: state.metrics.memory_hit_rate,
    },
    baseline_unit_cost: baselineUnit,
    policy: {
      version: state.policy.version,
      label: state.policy.label,
      default_tier: state.policy.default_tier,
      challenger_label: state.challenger.label,
      challenger_tier: state.challenger.default_tier,
      rules: state.policy.rules.map(({ id, use, max_tokens }) => ({
        id,
        use,
        max_tokens,
      })),
    },
    generations: state.generations.map(
      ({ n, promoted, quality, cost_usd, memory_hits }) => ({
        n,
        promoted,
        quality,
        cost_usd,
        memory_hits,
      }),
    ),
    events: state.events.map(({ id, source, summary, guild_trace_url }) => ({
      id,
      source,
      summary,
      guild_trace_url,
    })),
    memory: state.memory.map(({ id, hits, question, tier, quality }) => ({
      id,
      hits,
      question,
      tier,
      quality,
    })),
    replay_marked: state.sponsor_status.replay,
  };
}
