"use client";

import { SponsorCredit } from "./SponsorCredit";

export function LandingExplainer() {
  return (
    <section className="landing" id="how-it-works">
      <div className="landing-inner">
        <header className="landing-head">
          <p className="landing-kicker">Product</p>
          <h2>mintoken evolves how you spend on LLM calls</h2>
          <p>
            Most apps default every request to a premium model. mintoken treats
            routing as something that can improve: it A/B-tests cheaper Pioneer
            tiers, keeps a hard quality floor, and only ships a new policy when
            both cost and quality clear the bar.
          </p>
        </header>

        <div className="landing-block">
          <h3>What it does</h3>
          <ul className="landing-list">
            <li>
              Routes each task to Pioneer <strong>cheap</strong>,{" "}
              <strong>mid</strong>, or <strong>premium</strong> using the active
              policy.
            </li>
            <li>
              Scores answers against Senso ground truth with a{" "}
              <strong>0.90 quality floor</strong>.
            </li>
            <li>
              Promotes a cheaper challenger only when Guild says quality held
              and batch cost dropped.
            </li>
            <li>
              Skips Pioneer on repeat questions via answer memory ($0 compute on
              hits).
            </li>
            <li>
              Announces promoted policies on Band and records Replay QA on the
              live deploy.
            </li>
          </ul>
        </div>

        <div className="landing-block">
          <h3>How a generation runs</h3>
          <ol className="landing-steps">
            <li>
              <span className="landing-step-body">
                <strong>Answer memory</strong> — normalize the question; on a
                hit, reuse the stored answer and skip Pioneer.
              </span>
            </li>
            <li>
              <span className="landing-step-body">
                <strong>Pioneer</strong> — miss → call the policy&apos;s tier
                (cheap / mid / premium) with a token budget.
              </span>
            </li>
            <li>
              <span className="landing-step-body">
                <strong>Senso</strong> — score against ground-truth context;
                reject paths under 0.90.
              </span>
            </li>
            <li>
              <span className="landing-step-body">
                <strong>Baseline vs challenger</strong> — first run measures
                always-premium cost; later runs try a cheaper policy on the same
                batch.
              </span>
            </li>
            <li>
              <span className="landing-step-body">
                <strong>Guild</strong> — promote if quality ≥ floor and cost ≤
                60% of premium baseline; otherwise keep the current policy.
              </span>
            </li>
            <li>
              <span className="landing-step-body">
                <strong>Band</strong> — on promote, post version, quality, and
                savings to ops chat.
              </span>
            </li>
            <li>
              <span className="landing-step-body">
                <strong>Replay</strong> — after LoopQA on the public URL, mark
                the session complete in the dashboard.
              </span>
            </li>
          </ol>
        </div>

        <div className="landing-block">
          <h3>How each integration is wired</h3>
          <p className="landing-lead">
            Each tool owns one job in the loop: what it does, how it connects,
            and where it shows up above.
          </p>

          <div className="landing-stack">
            <article className="landing-card">
              <div className="landing-card-h">
                <SponsorCredit id="memory" />
                <h4>Answer memory</h4>
              </div>
              <ul className="landing-list">
                <li>Lookup runs before Pioneer on every task.</li>
                <li>
                  Seed + runtime JSON (no database). Hits raise Memory hits and
                  dollars avoided.
                </li>
                <li>
                  Activity logs <code>source: memory</code>; table lists reused
                  questions.
                </li>
              </ul>
            </article>

            <article className="landing-card">
              <div className="landing-card-h">
                <SponsorCredit id="pioneer" />
                <h4>Pioneer — tiered inference</h4>
              </div>
              <ul className="landing-list">
                <li>
                  OpenAI-compatible chat at Pioneer (
                  <code>PIONEER_BASE_URL</code>).
                </li>
                <li>
                  Policy maps task features → cheap / mid / premium + max
                  tokens.
                </li>
                <li>
                  Shows in Batch cost, Saved vs premium, Routing policy, and
                  generation bars.
                </li>
              </ul>
            </article>

            <article className="landing-card">
              <div className="landing-card-h">
                <SponsorCredit id="senso" />
                <h4>Senso — quality gate</h4>
              </div>
              <ul className="landing-list">
                <li>
                  Ground-truth context via <code>/org/search/context</code>.
                </li>
                <li>
                  Quality scored against facts, not self-graded by the answering
                  model.
                </li>
                <li>
                  Floor 0.90 — below that, Guild will not promote.
                </li>
              </ul>
            </article>

            <article className="landing-card">
              <div className="landing-card-h">
                <SponsorCredit id="guild" />
                <h4>Guild — promote or reject</h4>
              </div>
              <ul className="landing-list">
                <li>
                  Agent-test session after each challenger batch (quality, cost,
                  savings in input).
                </li>
                <li>
                  Promote bumps policy version and rules; reject keeps the
                  incumbent.
                </li>
                <li>
                  Activity shows the decision and an Open Guild trace link.
                </li>
              </ul>
            </article>

            <article className="landing-card">
              <div className="landing-card-h">
                <SponsorCredit id="band" />
                <h4>Band — ops announce</h4>
              </div>
              <ul className="landing-list">
                <li>
                  On promote only: posts version, quality, cost, and savings %
                  to the Band chat.
                </li>
                <li>
                  Activity events tagged <code>band</code> (live or cached).
                </li>
              </ul>
            </article>

            <article className="landing-card">
              <div className="landing-card-h">
                <SponsorCredit id="replay" />
                <h4>Replay — deploy QA</h4>
              </div>
              <ul className="landing-list">
                <li>
                  Outside the generation loop — LoopQA against the public URL.
                </li>
                <li>
                  Mark Replay QA → <code>POST /api/darwin</code>{" "}
                  <code>{`{ "action": "mark-replay" }`}</code>.
                </li>
              </ul>
            </article>
          </div>
        </div>

        <div className="landing-block landing-goal">
          <h3>Success criteria</h3>
          <ul className="landing-list">
            <li>Quality at or above 90%.</li>
            <li>Batch cost at least 40% below always-premium.</li>
            <li>Memory hits compound savings on solved questions.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
