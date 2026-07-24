"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { DarwinState } from "@/engine/types";
import { LandingExplainer } from "./LandingExplainer";
import { Onboarding } from "./Onboarding";
import { SponsorCredit } from "./SponsorCredit";

function money(n: number) {
  if (n < 0.0001 && n > 0) return `$${n.toExponential(2)}`;
  return `$${n.toFixed(4)}`;
}

function pct(n: number) {
  return `${n.toFixed(1)}%`;
}

export function MintokenApp({ initial }: { initial: DarwinState }) {
  const [state, setState] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const stateRef = useRef(state);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/darwin", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as DarwinState;
    if (mounted.current) setState(data);
  }, []);

  const run = useCallback(async (action: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/darwin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        if (data.state) setState(data.state);
        return;
      }
      setState(data as DarwinState);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!state.autopilot) return;
    const id = setInterval(() => {
      const s = stateRef.current;
      if (!s.autopilot || busyRef.current || s.running) return;
      void run("run-generation");
    }, 12000);
    return () => clearInterval(id);
  }, [state.autopilot, run]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const goalMet =
    state.baseline.measured &&
    state.metrics.quality >= state.goal.min_quality &&
    state.metrics.savings_pct >= 40;

  const running = busy || state.running;
  const maxCost = Math.max(
    state.baseline.cost_usd,
    ...state.generations.map((x) => x.cost_usd),
    0.0001,
  );

  return (
    <div className="app">
      <Onboarding />

      <section className="dashboard" aria-label="mintoken dashboard">
        <header className="topbar">
          <Link className="brand" href="/">
            mintoken
          </Link>
          <div className="top-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={running}
              onClick={() => run("run-generation")}
            >
              {running ? "Running…" : "Run generation"}
            </button>
            <button
              type="button"
              className={`btn ${state.autopilot ? "btn-on" : "btn-quiet"}`}
              disabled={busy}
              onClick={() => run("toggle-autopilot")}
            >
              Autopilot {state.autopilot ? "on" : "off"}
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              disabled={busy}
              onClick={() => run("reset")}
            >
              Reset
            </button>
          </div>
        </header>

        <div className="workspace">
          <div className="intro">
            <p className="lede">
              Autonomous Pioneer routing (cheap / mid / premium) with a Senso
              quality floor, Guild promote on cheaper policies, Band announce on
              wins, and answer memory that skips recompute.
            </p>
            <div className={`goal-rail${goalMet ? " met" : ""}`}>
              <span>
                ≥{pct(state.goal.min_quality * 100)} quality · ≥40% below
                always-premium
              </span>
              <strong>{goalMet ? "Goal met" : "Not met yet"}</strong>
            </div>
          </div>

          {error ? <p className="error-banner">{error}</p> : null}

          <div className="stats">
            <div className="stat">
              <div className="stat-top">
                <span className="stat-k">Quality</span>
                <SponsorCredit id="senso" compact />
              </div>
              <span className="stat-v">
                {state.baseline.measured
                  ? pct(state.metrics.quality * 100)
                  : "n/a"}
              </span>
              <span className="stat-h">
                Floor {pct(state.goal.min_quality * 100)}
              </span>
            </div>
            <div className="stat">
              <div className="stat-top">
                <span className="stat-k">Batch cost</span>
                <SponsorCredit id="pioneer" compact />
              </div>
              <span className="stat-v">
                {state.baseline.measured
                  ? money(state.metrics.cost_usd)
                  : "n/a"}
              </span>
              <span className="stat-h">
                {state.baseline.measured
                  ? `Baseline ${money(state.baseline.cost_usd)}`
                  : "Run once for baseline"}
              </span>
            </div>
            <div
              className={`stat${state.metrics.savings_pct >= 40 ? " hot" : ""}`}
            >
              <div className="stat-top">
                <span className="stat-k">Saved vs premium</span>
                <SponsorCredit id="pioneer" compact />
              </div>
              <span className="stat-v">
                {state.baseline.measured
                  ? pct(state.metrics.savings_pct)
                  : "n/a"}
              </span>
              <span className="stat-h">Need ≥40%</span>
            </div>
            <div className="stat">
              <div className="stat-top">
                <span className="stat-k">Memory hits</span>
                <SponsorCredit id="memory" compact />
              </div>
              <span className="stat-v">{state.memory_stats.hits}</span>
              <span className="stat-h">
                {money(state.memory_stats.dollars_avoided)} avoided ·{" "}
                {pct(state.metrics.memory_hit_rate * 100)} hit rate
              </span>
            </div>
          </div>

          <div className="main-grid">
            <section className="panel panel-activity">
              <div className="panel-h">
                <span>Activity</span>
                <div className="panel-credits">
                  <SponsorCredit id="guild" compact />
                  <SponsorCredit id="band" compact />
                </div>
              </div>
              <div className="panel-b">
                {state.events.length === 0 ? (
                  <p className="empty">No events yet.</p>
                ) : (
                  <ul className="feed">
                    {[...state.events]
                      .reverse()
                      .slice(0, 24)
                      .map((e) => (
                        <li key={e.id}>
                          <span className="tag">{e.source}</span>
                          <div>
                            <div>{e.summary}</div>
                            {e.guild_trace_url ? (
                              <a
                                href={e.guild_trace_url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open Guild trace
                              </a>
                            ) : null}
                          </div>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            </section>

            <div className="side-stack">
              <section className="panel policy-panel">
                <div className="panel-h">
                  <span>Routing policy</span>
                  <div className="panel-credits">
                    <SponsorCredit id="pioneer" compact />
                    <a
                      href="/api/darwin?view=policy"
                      target="_blank"
                      rel="noreferrer"
                    >
                      JSON
                    </a>
                  </div>
                </div>
                <div className="panel-b">
                  <p className="policy-meta">
                    v{state.policy.version} · {state.policy.label}. Default{" "}
                    <strong>{state.policy.default_tier}</strong>. Challenger{" "}
                    {state.challenger.label} ({state.challenger.default_tier}).
                  </p>
                  <ul className="rule-list">
                    {state.policy.rules.map((r) => (
                      <li key={r.id}>
                        <code>{r.id}</code>
                        <span>
                          {r.use} · {r.max_tokens} tok
                        </span>
                      </li>
                    ))}
                  </ul>
                  <span className="section-label">Generations</span>
                  {state.generations.length === 0 ? (
                    <p className="empty">
                      Run generation to set the premium baseline, then evolve.
                    </p>
                  ) : (
                    <div className="gen-list">
                      {state.generations.slice(-5).map((g) => (
                        <div key={g.n} className="gen-row">
                          <span
                            className={`gen-id${g.promoted ? " promoted" : ""}`}
                          >
                            g{g.n}
                            {g.promoted ? " promoted" : ""}
                          </span>
                          <div>
                            <div className="bar">
                              <span
                                style={{
                                  width: `${Math.min(
                                    100,
                                    (g.cost_usd / maxCost) * 100,
                                  )}%`,
                                }}
                              />
                            </div>
                            <div className="gen-meta">
                              {pct(g.quality * 100)} · {money(g.cost_usd)} ·{" "}
                              {g.memory_hits} mem
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              <section className="panel memory-panel">
                <div className="panel-h">
                  <span>Answer memory</span>
                  <div className="panel-credits">
                    <SponsorCredit id="memory" compact />
                    <a
                      href="/api/darwin?view=memory"
                      target="_blank"
                      rel="noreferrer"
                    >
                      JSON
                    </a>
                  </div>
                </div>
                <div className="panel-b">
                  {state.memory.length === 0 ? (
                    <p className="empty">Empty until answers are stored.</p>
                  ) : (
                    <table className="mem">
                      <thead>
                        <tr>
                          <th>Hits</th>
                          <th>Question</th>
                          <th>Tier</th>
                          <th>Quality</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.memory.slice(0, 6).map((m) => (
                          <tr key={m.id}>
                            <td>{m.hits}</td>
                            <td>{m.question}</td>
                            <td>{m.tier}</td>
                            <td>{pct(m.quality * 100)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>

              <div className="replay-row">
                <SponsorCredit id="replay" />
                <div className="replay-copy">
                  <strong>Replay LoopQA</strong>
                  <span>Mark after QA on the public URL.</span>
                </div>
                <button
                  type="button"
                  className={`btn ${state.sponsor_status.replay ? "btn-on" : "btn-quiet"}`}
                  disabled={busy || state.sponsor_status.replay}
                  onClick={() => run("mark-replay")}
                >
                  {state.sponsor_status.replay
                    ? "QA marked"
                    : "Mark Replay QA"}
                </button>
              </div>
            </div>
          </div>

          <a className="scroll-hint" href="#how-it-works">
            How each sponsor is wired ↓
          </a>
        </div>
      </section>

      <LandingExplainer />
    </div>
  );
}
