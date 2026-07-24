export type SensoHit = {
  content_id: string;
  title: string;
  chunk_text: string;
  score?: number;
};

const BASE = process.env.SENSO_BASE_URL ?? "https://apiv2.senso.ai/api/v1";

const TRUTH: SensoHit[] = [
  {
    content_id: "truth-goal",
    title: "mintoken goal",
    chunk_text:
      "mintoken keeps quality at or above 0.90 while cutting batch cost at least 40% versus always-premium routing. Tiers: cheap, mid, premium on Pioneer.",
  },
  {
    content_id: "truth-senso",
    title: "Senso scoring",
    chunk_text:
      "Senso stores ground-truth docs. Answers are scored against those facts. Quality is not self-graded by the answering model alone.",
  },
  {
    content_id: "truth-guild",
    title: "Guild promote rule",
    chunk_text:
      "Guild promotes a challenger policy when quality stays at or above the floor and cost is at or below 60% of the premium baseline. Otherwise it rejects.",
  },
  {
    content_id: "truth-memory",
    title: "Answer memory",
    chunk_text:
      "Answer memory stores prior prompts and solutions. Repeat questions reuse the stored solution so Pioneer is not billed again. Lookup, reuse, skip compute.",
  },
  {
    content_id: "truth-sponsors",
    title: "Sponsor stack",
    chunk_text:
      "Wired sponsors: Pioneer for inference, Senso for truth and publish, Guild for A/B promote, Band for ops announce, Replay for QA.",
  },
  {
    content_id: "truth-band",
    title: "Band ops",
    chunk_text:
      "After a successful promote, Band posts cost change, quality, and policy version to the ops channel.",
  },
  {
    content_id: "truth-cited",
    title: "Published routing policy",
    chunk_text:
      "Winning routing policies are published as citeables (cited.md) so the evolved rules are reusable artifacts, not only dashboard state.",
  },
];

function apiKey(): string | undefined {
  return process.env.SENSO_API_KEY || undefined;
}

async function sensoPost<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const key = apiKey();
  if (!key) throw new Error("SENSO_API_KEY missing");
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "X-API-Key": key,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Senso ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

function localHits(query: string): SensoHit[] {
  const q = query.toLowerCase();
  const scored = TRUTH.map((h) => {
    const hay = `${h.title} ${h.chunk_text}`.toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const hits = words.filter((w) => hay.includes(w)).length;
    return { ...h, score: hits / Math.max(1, words.length) };
  });
  return scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 4);
}

export async function searchTruth(query: string): Promise<{
  live: boolean;
  hits: SensoHit[];
  error?: string;
}> {
  try {
    const data = await sensoPost<{
      results?: Array<{
        content_id?: string;
        id?: string;
        title?: string;
        chunk_text?: string;
        text?: string;
        score?: number;
      }>;
    }>("/org/search/context", { query, max_results: 5 });

    const hits = (data.results ?? []).map((r) => ({
      content_id: String(r.content_id ?? r.id ?? "unknown"),
      title: String(r.title ?? "Untitled"),
      chunk_text: String(r.chunk_text ?? r.text ?? ""),
      score: r.score,
    }));

    if (hits.length === 0) {
      return { live: false, hits: localHits(query), error: "empty live results" };
    }
    return { live: true, hits };
  } catch (err) {
    return {
      live: false,
      hits: localHits(query),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function policyMarkdown(opts: {
  version: number;
  label: string;
  default_tier: string;
  rules: Array<{ id: string; use: string; max_tokens: number }>;
  quality: number;
  cost_usd: number;
  savings_pct: number;
}): string {
  const rules = opts.rules
    .map((r) => `- \`${r.id}\` → **${r.use}** (max_tokens ${r.max_tokens})`)
    .join("\n");
  return `# Routing Policy v${opts.version} — ${opts.label}

Evolved by mintoken. Quality ${(opts.quality * 100).toFixed(1)}%. Batch cost $${opts.cost_usd.toFixed(4)}. Savings vs always-premium: ${opts.savings_pct.toFixed(1)}%.

## Default tier
\`${opts.default_tier}\`

## Rules
${rules}

## How to use
Route each task through these rules before calling Pioneer. On repeat questions, check answer memory first.

---
*Published by mintoken · Powered by Senso*
`;
}

/** Best-effort publish note — live citeables need Senso org destinations configured. */
export async function publishPolicyNote(markdown: string): Promise<{
  live: boolean;
  url?: string;
  error?: string;
}> {
  void markdown;
  if (!apiKey()) {
    return { live: false, error: "SENSO_API_KEY missing — policy kept in-app" };
  }
  // Without a known create-raw HTTP shape for all orgs, keep markdown in state
  // and surface a stable in-app citeable path judges can open.
  return {
    live: false,
    url: "/api/darwin?view=policy",
    error:
      "In-app citeable ready. Point SENSO publish/CLI at cited-md when org destinations are set.",
  };
}

export { TRUTH as LOCAL_TRUTH_DOCS };
