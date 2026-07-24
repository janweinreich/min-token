import { randomUUID } from "crypto";

export type GuildDecision = "promote" | "reject";

export type GuildABResult = {
  live: boolean;
  session_id: string;
  trace_url: string;
  decision: GuildDecision;
  reason: string;
  error?: string;
};

function traceBase() {
  return (
    process.env.GUILD_TRACE_BASE_URL ?? "https://app.guild.ai/sessions"
  ).replace(/\/$/, "");
}

export async function runPolicyAB(opts: {
  baseline_cost: number;
  challenger_cost: number;
  challenger_quality: number;
  min_quality: number;
  max_cost_ratio: number;
}): Promise<GuildABResult> {
  const costOk =
    opts.baseline_cost > 0 &&
    opts.challenger_cost <= opts.baseline_cost * opts.max_cost_ratio;
  const qualityOk = opts.challenger_quality >= opts.min_quality;
  const decision: GuildDecision =
    costOk && qualityOk ? "promote" : "reject";
  const reason = qualityOk
    ? costOk
      ? `Promote: quality ${opts.challenger_quality.toFixed(3)} ≥ ${opts.min_quality}, cost $${opts.challenger_cost.toFixed(4)} ≤ ${(opts.max_cost_ratio * 100).toFixed(0)}% of baseline $${opts.baseline_cost.toFixed(4)}.`
      : `Reject: quality ok but cost $${opts.challenger_cost.toFixed(4)} above ${(opts.max_cost_ratio * 100).toFixed(0)}% of baseline.`
    : `Reject: quality ${opts.challenger_quality.toFixed(3)} below floor ${opts.min_quality}.`;

  const key = process.env.GUILD_API_KEY;
  const workspaceId = process.env.GUILD_WORKSPACE_ID;
  const base = (
    process.env.GUILD_BASE_URL ?? "https://app.guild.ai/api"
  ).replace(/\/$/, "");

  if (key && workspaceId) {
    try {
      const agentId =
        process.env.GUILD_POLICY_AGENT_ID ||
        process.env.GUILD_ORGANIZER_AGENT_ID ||
        "policy_ab_eval";
      const versionId =
        process.env.GUILD_POLICY_VERSION_ID ||
        process.env.GUILD_ORGANIZER_VERSION_ID;

      if (!versionId) {
        const session_id = `guild-local-${randomUUID().slice(0, 8)}`;
        return {
          live: false,
          session_id,
          trace_url: `${traceBase()}/${session_id}`,
          decision,
          reason,
          error:
            "GUILD_POLICY_VERSION_ID / GUILD_ORGANIZER_VERSION_ID missing; local A/B decision",
        };
      }

      // Guild requires session_type + agent_version_id for AGENT_TEST sessions.
      const body: Record<string, unknown> = {
        agent_id: agentId,
        session_type: "agent_test",
        agent_version_id: versionId,
        input: {
          task: "policy_ab_eval",
          ...opts,
          decision,
          reason,
        },
      };

      const res = await fetch(`${base}/workspaces/${workspaceId}/sessions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });

      if (res.ok) {
        const data = (await res.json()) as { id?: string; session_id?: string };
        const session_id = String(data.id ?? data.session_id ?? randomUUID());
        return {
          live: true,
          session_id,
          trace_url: `${traceBase()}/${session_id}`,
          decision,
          reason,
        };
      }

      const errText = await res.text().catch(() => "");
      const session_id = `guild-local-${randomUUID().slice(0, 8)}`;
      return {
        live: false,
        session_id,
        trace_url: `${traceBase()}/${session_id}`,
        decision,
        reason,
        error: `Guild HTTP ${res.status}: ${errText.slice(0, 160)}`,
      };
    } catch (err) {
      const session_id = `guild-local-${randomUUID().slice(0, 8)}`;
      return {
        live: false,
        session_id,
        trace_url: `${traceBase()}/${session_id}`,
        decision,
        reason,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const session_id = `guild-local-${randomUUID().slice(0, 8)}`;
  return {
    live: false,
    session_id,
    trace_url: `${traceBase()}/${session_id}`,
    decision,
    reason,
    error: "GUILD_API_KEY or GUILD_WORKSPACE_ID missing; local A/B decision",
  };
}
