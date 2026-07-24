"use client";

import { useEffect, useRef, useState } from "react";
import { LandingExplainer } from "./LandingExplainer";
import { Onboarding } from "./Onboarding";
import { SponsorCredit } from "./SponsorCredit";
import {
  createShellState,
  newShellChat,
  type ShellHandlers,
  type ShellState,
} from "@/shell/types";

function money(n: number) {
  if (n < 0.0001 && n > 0) return `$${n.toExponential(2)}`;
  return `$${n.toFixed(4)}`;
}

function pct(n: number) {
  return `${n.toFixed(1)}%`;
}

function titleFrom(q: string) {
  const t = q.trim().replace(/\s+/g, " ");
  return t.length > 42 ? `${t.slice(0, 42)}...` : t || "New chat";
}

/**
 * Design shell only. No live API / Darwin loop.
 * Partner: pass `handlers` to wire real ask / chat / reset / replay.
 */
export function MintokenApp({
  initial,
  handlers,
}: {
  initial?: ShellState;
  handlers?: ShellHandlers;
}) {
  const [state, setState] = useState<ShellState>(
    () => initial ?? createShellState(),
  );
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadEnd = useRef<HTMLDivElement | null>(null);

  const activeChat =
    state.chats.find((c) => c.id === state.active_chat_id) ?? state.chats[0];

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: "end" });
  }, [activeChat?.messages.length, pending]);

  useEffect(() => {
    if (initial) return;
    fetch("/api/darwin", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load the routing loop.");
        setState((await response.json()) as ShellState);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Could not load mintoken."),
      );
  }, [initial]);

  const postAction = async (
    action: string,
    payload: Record<string, string> = {},
  ) => {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/darwin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const body = (await response.json()) as ShellState & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The routing loop could not finish.");
      setState(body);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "The routing loop could not finish.",
      );
    } finally {
      setPending(false);
    }
  };

  const maxCost = Math.max(
    state.baseline_unit_cost ?? 0.0001,
    ...state.generations.map((x) => x.cost_usd),
    0.0001,
  );

  const newChat = () => {
    if (handlers?.onNewChat) {
      void handlers.onNewChat();
      return;
    }
    void postAction("new-chat");
  };

  const selectChat = (chatId: string) => {
    if (handlers?.onSelectChat) {
      void handlers.onSelectChat(chatId);
      return;
    }
    void postAction("select-chat", { chat_id: chatId });
  };

  const reset = () => {
    if (handlers?.onReset) {
      void handlers.onReset();
      return;
    }
    setDraft("");
    void postAction("reset");
  };

  const markReplay = () => {
    if (handlers?.onMarkReplay) {
      void handlers.onMarkReplay();
      return;
    }
    void postAction("mark-replay");
  };

  const submit = async () => {
    const q = draft.trim();
    if (!q || pending) return;
    setDraft("");

    if (handlers?.onAsk) {
      setPending(true);
      try { await handlers.onAsk(q); } finally { setPending(false); }
      return;
    }
    await postAction("ask", { question: q });
  };

  return (
    <div className="app shell">
      <Onboarding />

      <aside className="sidebar" aria-label="Chat menu">
        <div className="sidebar-top">
          <a className="brand" href="/">
            mintoken
          </a>
          <button
            type="button"
            className="btn btn-primary sidebar-new"
            onClick={newChat}
          >
            New chat
          </button>
        </div>

        <nav className="sidebar-nav">
          <p className="sidebar-label">Chats</p>
          <ul className="chat-list">
            {state.chats.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`chat-item${c.id === state.active_chat_id ? " active" : ""}`}
                  onClick={() => selectChat(c.id)}
                >
                  {c.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="sidebar-foot">
          <a className="sidebar-link" href="#how-it-works">
            How it works
          </a>
          <button type="button" className="btn btn-quiet sidebar-reset" onClick={reset}>
            Reset
          </button>
        </div>
      </aside>

      <div className="main-col">
        <section className="dashboard" aria-label="mintoken dashboard">
          <header className="topbar">
            <div className="topbar-title">
              <span className="topbar-chat">{activeChat?.title ?? "New chat"}</span>
              <div className={`goal-rail compact${state.goal_met ? " met" : ""}`}>
                <span>
                  ≥{pct(state.goal.min_quality * 100)} quality · ≥40% below
                  always-premium
                </span>
                <strong>{state.goal_met ? "Goal met" : "Not met yet"}</strong>
              </div>
            </div>
          </header>

          <div className="workspace">
            <p className="lede">
              Ask anything. mintoken checks answer memory, routes a Pioneer tier,
              scores quality with Senso, and lets Guild promote cheaper policies
              when quality holds.
            </p>

            <div className="stats">
              <div className="stat">
                <div className="stat-top">
                  <span className="stat-k">Quality</span>
                  <SponsorCredit id="senso" compact />
                </div>
                <span className="stat-v">
                  {state.metrics.quality == null
                    ? "n/a"
                    : pct(state.metrics.quality * 100)}
                </span>
                <span className="stat-h">
                  Floor {pct(state.goal.min_quality * 100)}
                </span>
              </div>
              <div className="stat">
                <div className="stat-top">
                  <span className="stat-k">Prompt cost</span>
                  <SponsorCredit id="pioneer" compact />
                </div>
                <span className="stat-v">
                  {state.metrics.cost_usd == null
                    ? "n/a"
                    : money(state.metrics.cost_usd)}
                </span>
                <span className="stat-h">
                  {state.baseline_unit_cost == null
                    ? "Awaiting baseline"
                    : `Unit baseline ${money(state.baseline_unit_cost)}`}
                </span>
              </div>
              <div
                className={`stat${(state.metrics.savings_pct ?? 0) >= 40 ? " hot" : ""}`}
              >
                <div className="stat-top">
                  <span className="stat-k">Saved vs premium</span>
                  <SponsorCredit id="pioneer" compact />
                </div>
                <span className="stat-v">
                  {state.metrics.savings_pct == null
                    ? "n/a"
                    : pct(state.metrics.savings_pct)}
                </span>
                <span className="stat-h">Need ≥40%</span>
              </div>
              <div className="stat">
                <div className="stat-top">
                  <span className="stat-k">Memory hits</span>
                  <SponsorCredit id="memory" compact />
                </div>
                <span className="stat-v">{state.metrics.memory_hits}</span>
                <span className="stat-h">
                  {money(state.metrics.dollars_avoided)} avoided ·{" "}
                  {pct(state.metrics.memory_hit_rate * 100)} hit rate
                </span>
              </div>
            </div>

            <div className="main-grid">
              <div className="left-stack">
                <section className="panel chat-panel">
                  <div className="panel-h">
                    <span>Conversation</span>
                    <div className="panel-credits">
                      <SponsorCredit id="pioneer" compact />
                      <SponsorCredit id="senso" compact />
                    </div>
                  </div>
                  <div className="panel-b chat-thread">
                    {!activeChat?.messages.length ? (
                      <p className="empty">
                        No messages yet. Use the floating prompt below.
                      </p>
                    ) : (
                      <ul className="msg-list">
                        {activeChat.messages.map((m) => (
                          <li key={m.id} className={`msg msg-${m.role}`}>
                            <span className="msg-role">
                              {m.role === "user" ? "You" : "mintoken"}
                            </span>
                            <div className="msg-body">{m.content}</div>
                            {m.role === "assistant" ? (
                              <div className="msg-meta">
                                {m.from_memory ? "memory · " : ""}
                                {m.tier ?? "?"}
                                {m.model ? ` / ${m.model.split("/").pop()}` : ""}
                                {typeof m.quality === "number"
                                  ? ` · q ${pct(m.quality * 100)}`
                                  : ""}
                                {typeof m.cost_usd === "number"
                                  ? ` · ${money(m.cost_usd)}`
                                  : ""}
                              </div>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                    {pending ? <p className="msg-pending">Routing prompt…</p> : null}
                    {error ? <p className="msg-error" role="alert">{error}</p> : null}
                    <div ref={threadEnd} />
                  </div>
                </section>

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
                          .slice(0, 18)
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
              </div>

              <div className="side-stack">
                <section className="panel policy-panel">
                  <div className="panel-h">
                    <span>Routing policy</span>
                    <div className="panel-credits">
                      <SponsorCredit id="pioneer" compact />
                    </div>
                  </div>
                  <div className="panel-b">
                    <p className="policy-meta">
                      v{state.policy.version} · {state.policy.label}. Default{" "}
                      <strong>{state.policy.default_tier}</strong>. Challenger{" "}
                      {state.policy.challenger_label} (
                      {state.policy.challenger_tier}).
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
                    <span className="section-label">Recent prompts</span>
                    {state.generations.length === 0 ? (
                      <p className="empty">
                        Prompt generations appear here after your first message.
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
                    </div>
                  </div>
                  <div className="panel-b">
                    {state.memory.length === 0 ? (
                      <p className="empty">Solved prompts will appear here.</p>
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
                    className={`btn ${state.replay_marked ? "btn-on" : "btn-quiet"}`}
                    disabled={state.replay_marked}
                    onClick={markReplay}
                  >
                    {state.replay_marked ? "QA marked" : "Mark Replay QA"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <LandingExplainer />

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="composer-inner">
            <textarea
              className="composer-input"
              rows={1}
              placeholder="Ask mintoken anything..."
              value={draft}
              disabled={pending}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
            <button
              type="submit"
              className="btn btn-primary composer-send"
              disabled={pending || !draft.trim()}
            >
              {pending ? "Routing" : "Send"}
            </button>
          </div>
          <p className="composer-hint">
            Enter to send · Shift+Enter for newline · Memory is checked first
          </p>
        </form>
      </div>
    </div>
  );
}
