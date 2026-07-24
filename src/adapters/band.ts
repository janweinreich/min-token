export type BandAnnounceResult = {
  live: boolean;
  status: "live" | "cached";
  message_id: string;
  content: string;
  error?: string;
};

function baseUrl() {
  return (process.env.BAND_BASE_URL ?? "https://app.band.ai").replace(/\/$/, "");
}

function agentKey(): string | undefined {
  return (
    process.env.BAND_TOM_API_KEY ||
    process.env.BAND_AGENT_API_KEY ||
    undefined
  );
}

export async function announcePromotion(opts: {
  policy_version: number;
  policy_label: string;
  quality: number;
  cost_usd: number;
  savings_pct: number;
}): Promise<BandAnnounceResult> {
  const content = [
    `mintoken promote: policy v${opts.policy_version} (${opts.policy_label}).`,
    `Quality ${(opts.quality * 100).toFixed(1)}%.`,
    `Batch cost $${opts.cost_usd.toFixed(4)}.`,
    `Savings vs always-premium: ${opts.savings_pct.toFixed(1)}%.`,
  ].join(" ");

  const key = agentKey();
  if (!key) {
    return {
      live: false,
      status: "cached",
      message_id: `cached-band-${Date.now()}`,
      content,
      error: "BAND_TOM_API_KEY / BAND_AGENT_API_KEY missing",
    };
  }

  try {
    let chatId = process.env.BAND_PUBLIC_CHAT_ID;
    if (!chatId) {
      const create = await fetch(`${baseUrl()}/api/v1/agent/chats`, {
        method: "POST",
        headers: {
          "X-API-Key": key,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "mintoken ops" }),
        signal: AbortSignal.timeout(15000),
      });
      if (create.ok) {
        const raw = (await create.json()) as {
          data?: { id?: string };
          id?: string;
        };
        chatId = raw.data?.id ?? raw.id;
      }
    }

    if (!chatId) {
      return {
        live: false,
        status: "cached",
        message_id: `cached-band-${Date.now()}`,
        content,
        error: "No Band chat id",
      };
    }

    const mention =
      process.env.BAND_OPS_MENTION ||
      process.env.BAND_TOM_AGENT_ID ||
      "ops";
    const body = `@${mention} ${content}`;

    const res = await fetch(
      `${baseUrl()}/api/v1/agent/chats/${chatId}/messages`,
      {
        method: "POST",
        headers: {
          "X-API-Key": key,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: body }),
        signal: AbortSignal.timeout(15000),
      },
    );

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      return {
        live: false,
        status: "cached",
        message_id: `cached-band-${Date.now()}`,
        content,
        error: `Band ${res.status}: ${err.slice(0, 160)}`,
      };
    }

    const raw = (await res.json()) as {
      data?: { id?: string };
      id?: string;
    };
    return {
      live: true,
      status: "live",
      message_id: String(raw.data?.id ?? raw.id ?? `band-${Date.now()}`),
      content,
    };
  } catch (err) {
    return {
      live: false,
      status: "cached",
      message_id: `cached-band-${Date.now()}`,
      content,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
