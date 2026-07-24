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
              Skips Pioneer entirely on repeat questions via answer memory
              ($0 compute on hits).
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
              <strong>Answer memory</strong> — normalize the question; on a hit,
              reuse the stored answer and skip Pioneer.
            </li>
            <li>
              <strong>Pioneer</strong> — miss → call the policy&apos;s tier
              (cheap / mid / premium) with a token budget.
            </li>
            <li>
              <strong>Senso</strong> — score the answer against ground-truth
              context; reject paths that fall under 0.90.
            </li>
            <li>
              <strong>Baseline vs challenger</strong> — first run measures
              always-premium cost; later runs try a cheaper policy on the same
              batch.
            </li>
            <li>
              <strong>Guild</strong> — promote if quality ≥ floor and cost ≤ 60%
              of premium baseline; otherwise reject and keep the current policy.
            </li>
            <li>
              <strong>Band</strong> — on promote, post version, quality, and
              savings to ops chat.
            </li>
            <li>
              <strong>Replay</strong> — after LoopQA on the public URL, mark the
              session complete in the dashboard.
            </li>
          </ol>
        </div>

        <div className="landing-block">
          <h3>How each integration is wired</h3>
          <p className="landing-lead">
            Each tool owns one job in the loop. Here is what it does, what API
            or action it uses, and how that shows up on the dashboard above.
          </p>

          <div className="landing-stack">
            <article className="landing-card">
              <div className="landing-card-h">
                <SponsorCredit id="memory" />
                <h4>Answer memory</h4>
              </div>
              <ul className="landing-list">
                <li>
                  Lookup runs <em>before</em> Pioneer on every task.
                </li>
                <li>
                  Stored as seed + runtime JSON (no database). Hits raise Memory
                  hits and dollars avoided.
                </li>
                <li>
                  Activity logs <code>source: memory</code>. Table shows reused
                  questions, tier, and quality.
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
                  OpenAI-compatible chat completions at Pioneer (
                  <code>PIONEER_BASE_URL</code>).
                </li>
                <li>
                  Policy maps task features → cheap / mid / premium model + max
                  tokens.
                </li>
                <li>
                  Dashboard: Batch cost, Saved vs premium, Routing policy rules,
                  generation cost bars.
                </li>
                <li>
                  If inference is unavailable, local answers keep the loop
                  moving so policy evolution still runs.
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
                  Pulls ground-truth context via{" "}
                  <code>/org/search/context</code>.
                </li>
                <li>
                  Quality is scored against those facts, not self-graded by the
                  answering model.
                </li>
                <li>
                  Floor is 0.90. Below that, Guild will not promote the
                  challenger.
                </li>
                <li>Dashboard: Quality metric and Senso-tagged activity.</li>
              </ul>
            </article>

            <article className="landing-card">
              <div className="landing-card-h">
                <SponsorCredit id="guild" />
                <h4>Guild — promote or reject</h4>
              </div>
              <ul className="landing-list">
                <li>
                  After each challenger batch, opens a Guild agent-test session
                  with quality, cost, and savings in the input.
                </li>
                <li>
                  Promote → new routing policy becomes current (version bumps,
                  rules update).
                </li>
                <li>
                  Reject → keep the incumbent policy; try again next generation.
                </li>
                <li>
                  Dashboard: Activity decision + Open Guild trace link; Routing
                  policy shows the live rules.
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
                  On Guild promote only: posts policy version, quality, batch
                  cost, and savings % to the configured Band chat.
                </li>
                <li>
                  Keeps ops in the loop without opening the dashboard.
                </li>
                <li>
                  Dashboard: Activity events tagged <code>band</code> (live or
                  cached if keys are missing).
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
                  Outside the generation loop. Use Replay / LoopQA against the
                  public URL after ship.
                </li>
                <li>
                  Mark Replay QA calls{" "}
                  <code>POST /api/darwin</code> with{" "}
                  <code>{`{ "action": "mark-replay" }`}</code>.
                </li>
                <li>
                  Dashboard: Replay row under Answer memory; Activity gets a QA
                  complete event.
                </li>
              </ul>
            </article>
          </div>
        </div>

        <div className="landing-block landing-goal">
          <h3>Success criteria</h3>
          <ul className="landing-list">
            <li>Quality stays at or above 90%.</li>
            <li>
              Batch cost drops at least 40% versus the always-premium baseline.
            </li>
            <li>
              Memory hits compound savings on any question the system has
              already solved.
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
