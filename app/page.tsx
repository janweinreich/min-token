"use client";

import { useState } from "react";

type Rejection = { memoryId: string; reasons: string[] };
type Learned = { taskType: string; leanTried: number; cleanWins: number; lcb: number; verdict: string };

interface Res {
  answer: string;
  route: string;
  selectedModelId?: string;
  latencyMs: number;
  usage: { totalGenerationTokens: number; inputTokens: number; outputTokens: number; localEmbeddingCalls: number };
  memory: { hit: boolean; kind?: string; similarity?: number; rejections: Rejection[] };
  routing?: { reasons: string[]; leanSuccessLCB: number; contextK: number; evidenceCoverage: number };
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
  const last = log[log.length - 1]?.r;

  async function send(question: string) {
    if (!question.trim() || busy) return;
    setBusy(true);
    setQ("");
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const r = (await res.json()) as Res;
      setLog((l) => [...l, { q: question, r }]);
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
                <div className="dim tiny">
                  {last.usage.localEmbeddingCalls} local embeddings (not free — local compute, zero generation) ·{" "}
                  {last.latencyMs} ms
                </div>
              </li>
            </ol>
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

          {last && (
            <div className="session">
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
