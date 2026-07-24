"use client";

import { useState } from "react";

type Rejection = { memoryId: string; reasons: string[] };
type Learned = { taskType: string; leanTried: number; cleanWins: number; lcb: number; verdict: string };

interface Res {
  answer: string;
  route: string;
  selectedModelId?: string;
  latencyMs: number;
  usage: { totalGenerationTokens: number; inputTokens: number; outputTokens: number; routerTokens: number; localEmbeddingCalls: number };
  memory: { hit: boolean; kind?: string; similarity?: number; rejections: Rejection[] };
  routing?: { reasons: string[]; leanSuccessLCB: number; contextK: number; evidenceCoverage: number };
  llmRouting?: {
    model: string; reason: string; source: string;
    inputTokens: number; outputTokens: number; costUsd: number; latencyMs: number;
  };
  routerModel?: string;
  distilledRulesAvailable?: number;
  citations: { sourceId: string }[];
  strongEstimate: number;
  session: { asks: number; spent: number; avoidedEst: number; replays: number };
  learned: Learned[];
  measured: {
    routerQuality: number; strongQuality: number; leanQuality: number;
    routerTokens: number; strongTokens: number; leanTokens: number;
    leanTokensPerCase: number; strongTokensPerCase: number; cases: number;
  };
  episodeCount: number;
  seededEpisodes?: number;
  grounded?: boolean;
  tools: { sponsor: string; what: string; live: boolean; detail: string }[];
  error?: string;
}

const SUGGESTED = [
  "What package installs the Actian JavaScript SDK?",
  "Which npm package do I need for Actian VectorAI from TypeScript?",
  "How do I install the Actian Python SDK?",
];

const ROUTE_COLOR: Record<string, string> = {
  EXACT_REPLAY: "#22c55e",
  SEMANTIC_REPLAY: "#22c55e",
  LEAN_RAG: "#38bdf8",
  STRONG_RAG: "#f59e0b",
  AUTO_CODE: "#a78bfa",
  ABSTAIN: "#94a3b8",
};

export default function Page() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<Array<{ q: string; r: Res }>>([]);
  const [skill, setSkill] = useState<string | null>(null);
  // Training mode. `learned` applies the distilled rules as a lookup at zero
  // tokens; `llm` pays a cheap model to read the same rules. Measured, the LLM
  // variant loses 4,496 tokens over 8 questions — it is offered so the
  // comparison is visible on stage, not because it wins.
  const [routerMode, setRouterMode] = useState<"off" | "learned" | "llm">("off");
  const last = log[log.length - 1]?.r;

  async function send(question: string) {
    if (!question.trim() || busy) return;
    setBusy(true);
    setQ("");
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, routerMode }),
      });
      const r = (await res.json()) as Res;
      setLog((l) => [...l, { q: question, r }]);
      // The agent rewrote its own skill from the new evidence — pull it back so
      // the change is visible the moment it happens.
      if (skill !== null) fetch("/api/skill").then((x) => x.text()).then(setSkill);
    } finally {
      setBusy(false);
    }
  }

  const m = last?.measured;
  const savedPct =
    last && last.strongEstimate > 0
      ? Math.round(((last.strongEstimate - last.usage.totalGenerationTokens) / last.strongEstimate) * 100)
      : 0;

  return (
    <main>
      <header className="goal">
        <div>
          <b>GOAL</b> minimize generation tokens <i>subject to</i> quality ≥ 0.90
        </div>
        <div className="spacer" />
        {m && (
          <div className="measured">
            measured benchmark ·{" "}
            <span className="ok">router {m.routerQuality.toFixed(3)} / {m.routerTokens}</span> vs{" "}
            <span className="dim">always-strong {m.strongQuality.toFixed(3)} / {m.strongTokens}</span>
          </div>
        )}
        <div className="pill">policy v1 · {last?.episodeCount ?? 0} episodes</div>
      </header>

      <div className="cols">
        {/* ── chat ───────────────────────────────────────────── */}
        <section className="chat">
          {log.length === 0 && (
            <div className="empty">
              <p>Ask these three in order to see the whole loop:</p>
              <ol>
                <li>a question → <b>generates</b></li>
                <li>a paraphrase → <b>replays at 0 tokens</b></li>
                <li>the Python variant → <b>refuses to replay</b></li>
              </ol>
            </div>
          )}
          {log.map(({ q: question, r }, i) => (
            <div key={i} className="turn">
              <div className="user">{question}</div>
              <div className="assistant">
                <span className="badge" style={{ background: ROUTE_COLOR[r.route] ?? "#64748b" }}>
                  {r.route.replace(/_/g, " ")}
                </span>
                {r.grounded === false && <span className="ungrounded">general knowledge</span>}
                {r.selectedModelId && <span className="model">{r.selectedModelId}</span>}
                <span className={r.usage.totalGenerationTokens === 0 ? "tok zero" : "tok"}>
                  {r.usage.totalGenerationTokens} tokens
                </span>
                <p>{r.error ?? r.answer}</p>
              </div>
            </div>
          ))}
          <div className="composer">
            <input
              value={q}
              placeholder={busy ? "thinking…" : "ask about Actian, Pioneer or Guild…"}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send(q)}
              disabled={busy}
            />
            <button onClick={() => send(q)} disabled={busy || !q.trim()}>
              ask
            </button>
          </div>
          <div className="trainmode">
            <b>training mode</b>
            {(["off", "learned", "llm"] as const).map((mo) => (
              <button
                key={mo}
                className={routerMode === mo ? "mode on" : "mode"}
                onClick={() => setRouterMode(mo)}
                disabled={busy}
              >
                {mo === "off" ? "off" : mo === "learned" ? "apply learned rules · 0 tok" : `${last?.routerModel ?? "cheap model"} reads the skill · ~470 tok`}
              </button>
            ))}
            <span className="tiny">
              {last?.distilledRulesAvailable
                ? `${last.distilledRulesAvailable} distilled rules · measured: paying a model to read them lost 4,496 tokens over 8 questions, so applying them as a lookup is the default`
                : "run `pnpm train` first — no distilled rules yet"}
            </span>
          </div>
          <div className="suggest">
            {SUGGESTED.map((s) => (
              <button key={s} onClick={() => send(s)} disabled={busy}>
                {s.length > 46 ? s.slice(0, 44) + "…" : s}
              </button>
            ))}
          </div>
        </section>

        {/* ── live token-saving view ─────────────────────────── */}
        <aside className="panel">
          <h2>What just happened</h2>
          {!last && <p className="dim">Ask something to see how the tokens were saved.</p>}
          {last && (
            <ol className="steps">
              <li>
                <b>1 · memory lookup</b>
                {last.memory.hit ? (
                  <div className="good">
                    HIT ({last.memory.kind}, similarity {last.memory.similarity?.toFixed(3)}) → answer reused,{" "}
                    <b>0 generation tokens</b>
                  </div>
                ) : last.memory.rejections.length ? (
                  <div>
                    <span className="warn">refused to reuse {last.memory.rejections.length} candidate(s)</span>
                    {last.memory.rejections.slice(0, 2).map((x, i) => (
                      <code key={i}>{x.reasons.slice(0, 2).join(" · ")}</code>
                    ))}
                  </div>
                ) : (
                  <div className="dim">no similar answer in memory yet</div>
                )}
              </li>
              {!last.memory.hit && (
                <>
                  <li>
                    <b>2 · retrieval</b>
                    <div className="dim">
                      {last.citations.length} chunk(s) ·{" "}
                      {last.citations.map((c) => c.sourceId).join(", ") || "—"}
                    </div>
                  </li>
                  <li>
                    <b>3 · route</b>
                    <div>
                      <span className="badge sm" style={{ background: ROUTE_COLOR[last.route] ?? "#64748b" }}>
                        {last.route.replace(/_/g, " ")}
                      </span>{" "}
                      {last.selectedModelId}
                    </div>
                    <code>{last.routing?.reasons.join(" · ")}</code>
                    {last.llmRouting && (
                      <div className={last.llmRouting.source === "llm" ? "llmrouted" : "dim"}>
                        {last.llmRouting.source === "learned" ? (
                          <>
                            <b>learned rule</b> chose <b>{last.llmRouting.model}</b> — {last.llmRouting.reason}
                            <span className="tiny"> · 0 router tokens</span>
                          </>
                        ) : last.llmRouting.source === "llm" ? (
                          <>
                            <b>{last.routerModel}</b> read the learned skill and picked{" "}
                            <b>{last.llmRouting.model}</b> — &ldquo;{last.llmRouting.reason}&rdquo;
                            <span className="tiny"> · router cost ${last.llmRouting.costUsd.toFixed(5)}</span>
                          </>
                        ) : (
                          <>router fell back to {last.llmRouting.model}: {last.llmRouting.reason}</>
                        )}
                      </div>
                    )}
                    {last.routing && (
                      <div className="dim">
                        lean confidence {last.routing.leanSuccessLCB.toFixed(2)} · evidence coverage{" "}
                        {last.routing.evidenceCoverage.toFixed(2)}
                      </div>
                    )}
                  </li>
                </>
              )}
              <li>
                <b>4 · tokens</b>
                <div className="bars">
                  <div className="bar">
                    <span>this request</span>
                    <div className="track">
                      <div
                        className="fill now"
                        style={{ width: `${Math.max(2, (last.usage.totalGenerationTokens / last.strongEstimate) * 100)}%` }}
                      />
                    </div>
                    <b>{last.usage.totalGenerationTokens}</b>
                  </div>
                  <div className="bar">
                    <span>always-strong</span>
                    <div className="track">
                      <div className="fill ref" style={{ width: "100%" }} />
                    </div>
                    <b>~{last.strongEstimate}</b>
                  </div>
                </div>
                <div className={savedPct > 0 ? "good" : "dim"}>
                  {savedPct > 0 ? `${savedPct}% cheaper than routing everything to the strong model` : "no saving"}{" "}
                  <span className="est">est.</span>
                </div>
                {last.usage.routerTokens > 0 && (
                  <div className="warn tiny">
                    includes {last.usage.routerTokens} tokens the router itself spent deciding —
                    counted here, not hidden. On a cheap answer that overhead can exceed what the
                    cheaper model saves.
                  </div>
                )}
                <div className="dim tiny">
                  {last.usage.localEmbeddingCalls} local embeddings (not free — local compute, zero generation) ·{" "}
                  {last.latencyMs} ms
                </div>
              </li>
            </ol>
          )}

          {last?.grounded === false && (
            <p className="ungroundedNote">
              Outside the verified corpus, so this was answered from the model&apos;s own knowledge and
              carries no citations. It still took the <b>cheapest model that fits the question</b> —
              refusing would have been unhelpful rather than safe.
            </p>
          )}

          <h2>Sponsor tools on this request</h2>
          {last ? (
            <ul className="tools">
              {last.tools.map((t) => (
                <li key={t.sponsor + t.what}>
                  <span className={t.live ? "dot live" : "dot"} />
                  <b>{t.sponsor}</b> <span className="dim">{t.what}</span>
                  <div className="dim tiny">{t.detail}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="dim">—</p>
          )}

          <h2>The loop — refines every interaction</h2>
          {last?.learned.length ? (
            <table>
              <thead>
                <tr>
                  <th>task class</th>
                  <th>lean tried</th>
                  <th>clean</th>
                  <th>confidence</th>
                  <th>routing</th>
                </tr>
              </thead>
              <tbody>
                {last.learned.map((r) => (
                  <tr key={r.taskType}>
                    <td>{r.taskType}</td>
                    <td>{r.leanTried}</td>
                    <td>{r.cleanWins}</td>
                    <td>{r.lcb.toFixed(2)}</td>
                    <td className={r.verdict === "use lean" ? "good" : r.verdict === "skip lean" ? "warn" : "dim"}>
                      {r.verdict}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="dim">
              No episodes yet. The cheap route stays closed until it earns its way in — the confidence estimator
              uses a pessimistic prior, so lean must succeed repeatedly before it is trusted.
            </p>
          )}

          <h2>
            The skill it wrote for itself{" "}
            <button
              className="link"
              onClick={async () => setSkill(skill === null ? await (await fetch("/api/skill")).text() : null)}
            >
              {skill === null ? "show" : "hide"}
            </button>
          </h2>
          <p className="dim tiny">
            Recompiled from the evidence above on every interaction, and verified against the real
            router before it is written. <code style={{ display: "inline", padding: "1px 4px" }}>skills/routing/SKILL.md</code>
          </p>
          {skill !== null && <pre className="skill">{skill}</pre>}

          {last && (
            <div className="session">
              {last.seededEpisodes ? (
                <>
                  seeded with <b>{last.seededEpisodes}</b> measured episodes (committed, from a real
                  bootstrap run) · learned <b>{last.episodeCount - last.seededEpisodes}</b> more here
                  <br />
                </>
              ) : null}
              session · {last.session.asks} asks · {last.session.replays} replayed at zero ·{" "}
              <b>{last.session.spent}</b> tokens spent ·{" "}
              <b className="good">{last.session.avoidedEst}</b> avoided <span className="est">est.</span>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
