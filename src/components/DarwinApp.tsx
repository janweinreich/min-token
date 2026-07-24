"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DarwinState } from "@/engine/types";
import { BuiltWithStrip } from "./BuiltWithStrip";

function money(n: number) {
  if (n < 0.0001 && n > 0) return `$${n.toExponential(2)}`;
  return `$${n.toFixed(4)}`;
}

function pct(n: number) {
  return `${n.toFixed(1)}%`;
}

export function DarwinApp({ initial }: { initial: DarwinState }) {
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

  return (
    <div className="shell">
      <header className="hero">
        <p className="brand">BudgetDarwin</p>
        <h1>Cut model spend. Keep quality.</h1>
        <p className="lede">
          Routes each question to cheap / mid / premium on Pioneer, scores against
          Senso ground truth, promotes cheaper policies via Guild, and skips
          recomputes with answer memory.
        </p>
        <p className="goal">
          Goal: quality ≥ {pct(state.goal.min_quality * 100)} · cost ≤{" "}
          {pct(state.goal.max_cost_ratio * 100)} of always-premium (≥40% saved)
          {goalMet ? " · met this session" : ""}
        </p>
      </header>

      <section className="controls">
        <button
          type="button"
          className="primary"
          disabled={busy || state.running}
          onClick={() => run("run-generation")}
        >
          {busy || state.running ? "Running…" : "Run generation"}
        </button>
        <button
          type="button"
          className={state.autopilot ? "on" : ""}
          disabled={busy}
          onClick={() => run("toggle-autopilot")}
        >
          Autopilot {state.autopilot ? "on" : "off"}
        </button>
        <button type="button" disabled={busy} onClick={() => run("reset")}>
          Reset
        </button>
        <a className="linkish" href="/api/darwin?view=policy" target="_blank" rel="noreferrer">
          Routing policy
        </a>
        <a className="linkish" href="/api/darwin?view=memory" target="_blank" rel="noreferrer">
          Answer memory
        </a>
      </section>

      {error ? <p className="error">{error}</p> : null}

      <section className="metrics">
        <Metric
          label="Quality"
          value={state.baseline.measured ? pct(state.metrics.quality * 100) : "—"}
          hint={`floor ${pct(state.goal.min_quality * 100)}`}
        />
        <Metric
          label="Batch cost"
          value={state.baseline.measured ? money(state.metrics.cost_usd) : "—"}
          hint={
            state.baseline.measured
              ? `baseline ${money(state.baseline.cost_usd)}`
              : "run once to measure baseline"
          }
        />
        <Metric
          label="Saved vs premium"
          value={state.baseline.measured ? pct(state.metrics.savings_pct) : "—"}
          hint="target ≥ 40%"
          accent={state.metrics.savings_pct >= 40}
        />
        <Metric
          label="Memory hits"
          value={`${state.memory_stats.hits}`}
          hint={`$${state.memory_stats.dollars_avoided.toFixed(4)} compute avoided · hit rate ${pct(state.metrics.memory_hit_rate * 100)}`}
        />
      </section>

      <section className="grid-2">
        <div className="panel">
          <h2>Policy</h2>
          <p className="mono">
            v{state.policy.version} · {state.policy.label} · default{" "}
            <strong>{state.policy.default_tier}</strong>
          </p>
          <ul className="rules">
            {state.policy.rules.map((r) => (
              <li key={r.id}>
                <code>{r.id}</code> → <strong>{r.use}</strong> · max_tokens{" "}
                {r.max_tokens}
              </li>
            ))}
          </ul>
          <p className="muted">
            Challenger: {state.challenger.label} (default {state.challenger.default_tier})
          </p>
        </div>

        <div className="panel">
          <h2>Generations</h2>
          {state.generations.length === 0 ? (
            <p className="muted">No generations yet. Run one to set the premium baseline, then evolve.</p>
          ) : (
            <div className="bars">
              {state.generations.map((g) => {
                const maxCost = Math.max(
                  state.baseline.cost_usd,
                  ...state.generations.map((x) => x.cost_usd),
                  0.0001,
                );
                return (
                  <div key={g.n} className="bar-row">
                    <span className="bar-label">
                      g{g.n}
                      {g.promoted ? " ★" : ""}
                    </span>
                    <div className="bar-track">
                      <div
                        className="bar-fill cost"
                        style={{ width: `${(g.cost_usd / maxCost) * 100}%` }}
                        title={`cost ${money(g.cost_usd)}`}
                      />
                      <div
                        className="bar-fill quality"
                        style={{ width: `${g.quality * 100}%` }}
                        title={`quality ${pct(g.quality * 100)}`}
                      />
                    </div>
                    <span className="bar-meta">
                      q {pct(g.quality * 100)} · {money(g.cost_usd)} · mem {g.memory_hits}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <p className="legend">
            <span className="swatch cost" /> cost &nbsp;
            <span className="swatch quality" /> quality &nbsp; ★ = Guild promote
          </p>
        </div>
      </section>

      <section className="panel">
        <h2>Event log</h2>
        <ul className="log">
          {[...state.events].reverse().slice(0, 40).map((e) => (
            <li key={e.id}>
              <span className={`src ${e.source}`}>{e.source}</span>
              <span>{e.summary}</span>
              {e.guild_trace_url ? (
                <a href={e.guild_trace_url} target="_blank" rel="noreferrer">
                  Guild trace
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Answer memory (recent)</h2>
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
            {state.memory.slice(0, 12).map((m) => (
              <tr key={m.id}>
                <td>{m.hits}</td>
                <td>{m.question}</td>
                <td>{m.tier}</td>
                <td>{pct(m.quality * 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <BuiltWithStrip status={state.sponsor_status} />
    </div>
  );
}

function Metric(props: {
  label: string;
  value: string;
  hint: string;
  accent?: boolean;
}) {
  return (
    <div className={`metric ${props.accent ? "accent" : ""}`}>
      <div className="metric-label">{props.label}</div>
      <div className="metric-value">{props.value}</div>
      <div className="metric-hint">{props.hint}</div>
    </div>
  );
}
