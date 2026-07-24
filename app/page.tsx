"use client";

import { useEffect, useState } from "react";

type Rejection = { memoryId: string; reasons: string[] };
type Learned = { taskType: string; leanTried: number; cleanWins: number; lcb: number; verdict: string };

interface Res {
  answer: string;
  route: string;
  selectedModelId?: string;
  latencyMs: number;
  usage: {
    totalGenerationTokens: number;
    inputTokens: number;
    outputTokens: number;
    routerTokens: number;
    localEmbeddingCalls: number;
    estimatedCostUsd?: number;
  };
  savings?: {
    tokensUsed: number; tokensBaseline: number; tokensSaved: number;
    usdUsed: number; usdBaseline: number; usdSaved: number;
    pct: number; baselineModel: string;
  };
  memory: { hit: boolean; kind?: string; similarity?: number; rejections: Rejection[] };
  routing?: { reasons: string[]; leanSuccessLCB: number; contextK: number; evidenceCoverage: number };
  llmRouting?: {
    model: string; reason: string; source: string; promptSource?: string;
    inputTokens: number; outputTokens: number; costUsd: number; latencyMs: number;
  };
  citations: { sourceId: string }[];
  strongEstimate: number;
  session: { asks: number; spent: number; avoidedEst: number; replays: number; costUsd: number; avoidedUsdEst: number };
  learned: Learned[];
  measured: {
    routerQuality: number; strongQuality: number;
    routerTokens: number; strongTokens: number;
    strongTokensPerCase: number; cases: number;
  };
  episodeCount: number;
  seededEpisodes?: number;
  grounded?: boolean;
  routerModel?: string;
  distilledRulesAvailable?: number;
  routerPromptSynthesized?: boolean;
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

const MODES = [
  { id: "off" as const, label: "OFF", hint: "keyword router · free" },
  { id: "learned" as const, label: "LEARNED RULES", hint: "distilled table · free" },
  { id: "llm" as const, label: "MODEL READS SKILL", hint: "~625 tok/request" },
  { id: "train" as const, label: "LEARN FROM THIS", hint: "runs every model · expensive" },
];

interface TrainRes {
  question: string;
  taskType: string;
  reference: { model: string; totalTokens: number; costUsd: number };
  candidates: Array<{
    model: string; answer: string; totalTokens: number; costUsd: number;
    acceptable?: boolean; verdict?: string;
  }>;
  winner: string | null;
  saving: { tokens: number; costUsd: number; pct: number } | null;
  trainingSetSize: number;
  rules: Array<{ taskType: string; recommended: string; n: number; support: number; confident: boolean }>;
  promptUpdated: boolean;
  untilResynth: number;
  resynthEvery: number;
  prompt: string;
  trainingCostUsd: number;
  trainingTokens: number;
  error?: string;
}

const usd = (n: number) => (n >= 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(5)}`);

export default function Page() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<Array<{ q: string; r: Res }>>([]);
  const [skill, setSkill] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [routerMode, setRouterMode] = useState<"off" | "learned" | "llm" | "train">("off");
  const [train, setTrain] = useState<TrainRes | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [status, setStatus] = useState<Partial<Res> | null>(null);

  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => {});
  }, []);

  const last = log[log.length - 1]?.r;
  const view = last ?? status;
  const sv = last?.savings;

  async function send(question: string) {
    if (!question.trim() || busy) return;
    setBusy(true);
    setQ("");

    // Training mode runs the whole distillation on this one question instead of
    // answering it cheaply. Different endpoint, different panel.
    if (routerMode === "train") {
      try {
        const res = await fetch("/api/train", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question }),
        });
        const t = (await res.json()) as TrainRes;
        setTrain(t);
        fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => {});
      } finally {
        setBusy(false);
      }
      return;
    }

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, routerMode }),
      });
      const r = (await res.json()) as Res;
      setLog((l) => [...l, { q: question, r }]);
      if (skill !== null) fetch("/api/skill").then((x) => x.text()).then(setSkill);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <header className="goal">
        <div>
          <b>BudgetDarwin</b> <span className="dim">— the cheapest model that still answers well</span>
        </div>
        <div className="spacer" />
        <div className="pill">{view?.distilledRulesAvailable ?? 0} learned rules</div>
        <div className="pill">{view?.episodeCount ?? 0} episodes</div>
      </header>

      <div className="cols">
        {/* ── chat ───────────────────────────────────────────── */}
        <section className="chat">
          {log.length === 0 && (
            <div className="empty">
              <p>Ask these three in order:</p>
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
              placeholder={busy ? "thinking…" : "ask anything…"}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send(q)}
              disabled={busy}
            />
            <button onClick={() => send(q)} disabled={busy || !q.trim()}>ask</button>
          </div>

          {/* Training mode. The whole strip changes state, not just the selected
              button — "which of three buttons looks pressed" is not a legible
              way to answer "am I in training mode right now". */}
          <div className={routerMode === "off" ? "modes" : "modes active"}>
            <span className="modeLabel">
              TRAINING MODE <b>{routerMode === "off" ? "OFF" : "ON"}</b>
            </span>
            {MODES.map((mo) => (
              <button
                key={mo.id}
                className={routerMode === mo.id ? "mode on" : "mode"}
                onClick={() => setRouterMode(mo.id)}
                disabled={busy}
              >
                {mo.label}
                <em>{mo.hint}</em>
              </button>
            ))}
          </div>

          <div className="suggest">
            {SUGGESTED.map((s) => (
              <button key={s} onClick={() => send(s)} disabled={busy}>
                {s.length > 44 ? s.slice(0, 42) + "…" : s}
              </button>
            ))}
          </div>
        </section>

        {/* ── the number that matters ────────────────────────── */}
        <aside className="panel">
          {routerMode === "train" && (
            <>
              <h2>Learning from this question</h2>
              {busy && <p className="dim">running every model, then judging each answer…</p>}
              {!busy && !train && <p className="dim">Ask a question and every model will answer it.</p>}
              {train?.error && <p className="warn">{train.error}</p>}
              {train && !train.error && (
                <>
                  <div className="ladder">
                    <div className="lrow ref">
                      <span className="lm">{train.reference.model}</span>
                      <span className="lb">REFERENCE</span>
                      <span className="lt">{train.reference.totalTokens} tok · {usd(train.reference.costUsd)}</span>
                    </div>
                    {train.candidates.map((c) => (
                      <div
                        key={c.model}
                        className={
                          c.model === train.winner ? "lrow win" : c.acceptable ? "lrow ok" : "lrow bad"
                        }
                      >
                        <span className="lm">{c.model}</span>
                        <span className="lb">
                          {c.model === train.winner ? "CHOSEN" : c.acceptable ? "good enough" : "rejected"}
                        </span>
                        <span className="lt">{c.totalTokens} tok · {usd(c.costUsd)}</span>
                        <p className="lv">{c.verdict}</p>
                      </div>
                    ))}
                  </div>

                  <div className={train.winner ? "saveband" : "saveband none"}>
                    {train.winner ? (
                      <>
                        <b>{train.winner}</b> matched the reference for{" "}
                        <b>{usd(train.saving?.costUsd ?? 0)}</b> less
                        <span className="pct">{Math.round(train.saving?.pct ?? 0)}%</span>
                      </>
                    ) : (
                      <>no cheaper model was good enough — this class stays at the reference</>
                    )}
                  </div>

                  <p className="basis">
                    Judged by <b>{train.reference.model}</b>, one candidate at a time, without being told
                    which model produced it. This lesson cost {train.trainingTokens} tokens
                    ({usd(train.trainingCostUsd)}) — training is what you pay once so serving is cheap.
                  </p>

                  <h2>Training data</h2>
                  <p className="tiny">
                    <b className="good">+1</b> example → <b>{train.trainingSetSize}</b> total ·{" "}
                    class <code>{train.taskType}</code>
                  </p>
                  <table>
                    <thead><tr><th>class</th><th>n</th><th>use</th><th>accepted</th></tr></thead>
                    <tbody>
                      {train.rules.map((r) => (
                        <tr key={r.taskType}>
                          <td>{r.taskType}</td>
                          <td>{r.n}</td>
                          <td className={r.confident ? "good" : "dim"}>{r.recommended}</td>
                          <td>{(r.support * 100).toFixed(0)}%{r.confident ? "" : " (thin)"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <h2>Router prompt</h2>
                  {train.promptUpdated ? (
                    <div className="saveband">
                      <b>rewritten</b> by {train.reference.model} from all {train.trainingSetSize} examples
                    </div>
                  ) : (
                    <p className="tiny dim">
                      unchanged — rewritten every {train.resynthEvery} examples, {train.untilResynth} to go.
                      Re-synthesizing per question would be a synthesis call to restate the same conclusion.
                    </p>
                  )}
                  <button className="disclose" onClick={() => setShowPrompt(!showPrompt)}>
                    {showPrompt ? "hide" : "show"} the prompt the model wrote
                  </button>
                  {showPrompt && <pre className="skill">{train.prompt}</pre>}
                </>
              )}
            </>
          )}

          {routerMode !== "train" && (
          <>
          <h2>This request</h2>
          {sv ? (
            <>
              <div className="bigrow">
                <div className="big">
                  <span className="n">{sv.tokensUsed}</span>
                  <span className="l">tokens used</span>
                </div>
                <div className="vs">vs</div>
                <div className="big muted">
                  <span className="n">{sv.tokensBaseline}</span>
                  <span className="l">if always {sv.baselineModel}</span>
                </div>
              </div>

              <div className={sv.tokensSaved > 0 ? "saveband" : "saveband none"}>
                {sv.tokensSaved > 0 ? (
                  <>
                    saved <b>{sv.tokensSaved} tokens</b> and <b>{usd(sv.usdSaved)}</b>
                    <span className="pct">{sv.pct}%</span>
                  </>
                ) : (
                  <>no saving here — this one needed the stronger model</>
                )}
              </div>

              <div className="costrow">
                <span>cost <b>{usd(sv.usdUsed)}</b></span>
                <span className="dim">baseline {usd(sv.usdBaseline)}</span>
              </div>

              {last!.usage.routerTokens > 0 && (
                <div className="warn tiny">
                  includes {last!.usage.routerTokens} tokens the router spent deciding — counted, not hidden
                </div>
              )}
              <p className="basis">
                Baseline = the measured {last!.measured.strongTokensPerCase}-token always-strong average over{" "}
                {last!.measured.cases} benchmark cases at Pioneer&apos;s published rate. An estimate; the hard
                number is under &ldquo;evidence&rdquo;.
              </p>
            </>
          ) : (
            <p className="dim">Ask something to see the comparison.</p>
          )}

          <h2>This session</h2>
          {view?.session ? (
            <div className="sess">
              <div><span className="n">{view.session.asks}</span><span className="l">asks</span></div>
              <div><span className="n">{view.session.replays}</span><span className="l">replayed free</span></div>
              <div><span className="n good">{view.session.avoidedEst}</span><span className="l">tokens avoided</span></div>
              <div><span className="n good">{usd(view.session.avoidedUsdEst ?? 0)}</span><span className="l">saved</span></div>
            </div>
          ) : (
            <p className="dim">—</p>
          )}

          <h2>How it saved</h2>
          {last ? (
            <ul className="how">
              <li>
                <b>memory</b>{" "}
                {last.memory.hit ? (
                  <span className="good">
                    reused an approved answer (similarity {last.memory.similarity?.toFixed(2)}) → 0 tokens
                  </span>
                ) : last.memory.rejections.length ? (
                  <span className="warn">refused to reuse — {last.memory.rejections[0]!.reasons[0]}</span>
                ) : (
                  <span className="dim">nothing similar stored yet</span>
                )}
              </li>
              <li>
                <b>model</b>{" "}
                {last.llmRouting ? (
                  last.llmRouting.source === "learned" ? (
                    <span className="learned">
                      learned rule → <b>{last.llmRouting.model}</b> · 0 router tokens
                    </span>
                  ) : (
                    <span className="learned">
                      {last.routerModel} read the{" "}
                      {last.llmRouting.promptSource === "synthesized" ? "model-written" : "built-in"} prompt →{" "}
                      <b>{last.llmRouting.model}</b> · &ldquo;{last.llmRouting.reason}&rdquo;
                    </span>
                  )
                ) : (
                  <span className="dim">{last.selectedModelId ?? "no model call"} — keyword router, free</span>
                )}
              </li>
              <li>
                <b>sponsors</b>{" "}
                <span className="dim">
                  {last.tools.filter((t) => t.live).map((t) => t.sponsor).join(", ") || "none live"}
                </span>
              </li>
            </ul>
          ) : (
            <p className="dim">—</p>
          )}

          <button className="disclose" onClick={() => setShowDetail(!showDetail)}>
            {showDetail ? "hide the evidence" : "show the evidence"}
          </button>

          {showDetail && (
            <div className="detail">
              <h3>Measured benchmark</h3>
              {view?.measured && (
                <p className="tiny">
                  router <b className="good">{view.measured.routerQuality.toFixed(3)}</b> quality /{" "}
                  {view.measured.routerTokens} tok · always-strong {view.measured.strongQuality.toFixed(3)} /{" "}
                  {view.measured.strongTokens} tok, over {view.measured.cases} cases — better quality, 18% fewer
                  tokens.
                </p>
              )}

              <h3>What the agent has learned</h3>
              {view?.learned?.length ? (
                <table>
                  <thead>
                    <tr><th>class</th><th>tried</th><th>clean</th><th>conf.</th><th>routing</th></tr>
                  </thead>
                  <tbody>
                    {view.learned.map((r) => (
                      <tr key={r.taskType}>
                        <td>{r.taskType}</td><td>{r.leanTried}</td><td>{r.cleanWins}</td>
                        <td>{r.lcb.toFixed(2)}</td>
                        <td className={r.verdict === "use lean" ? "good" : "warn"}>{r.verdict}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="dim tiny">No episodes yet.</p>
              )}

              <h3>Sponsor tools</h3>
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
                <p className="dim tiny">—</p>
              )}

              <h3>
                The skill it wrote for itself{" "}
                <button
                  className="link"
                  onClick={async () => setSkill(skill === null ? await (await fetch("/api/skill")).text() : null)}
                >
                  {skill === null ? "show" : "hide"}
                </button>
              </h3>
              <p className="tiny dim">
                Recompiled on every interaction, including the distilled routing table
                {view?.routerPromptSynthesized
                  ? " — and the router's own prompt, written by claude-sonnet-5 from the judged pairs"
                  : ""}
                . <code>skills/routing/SKILL.md</code>
              </p>
              {skill !== null && <pre className="skill">{skill}</pre>}
            </div>
          )}
          </>
          )}
        </aside>
      </div>
    </main>
  );
}
