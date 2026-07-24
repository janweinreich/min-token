"use client";

import { SponsorCredit } from "./SponsorCredit";

export function LandingExplainer() {
  return (
    <section className="landing" id="how-it-works">
      <div className="landing-inner">
        <header className="landing-head">
          <h2>How mintoken cuts spend without dropping quality</h2>
          <p>
            Each Run generation measures an always-premium Pioneer baseline,
            then routes the same batch through a cheaper challenger policy.
            Senso gates quality. Guild promotes only when quality holds and cost
            falls. Band announces the win. Answer memory skips Pioneer on
            repeats. Replay QA marks the deploy after you ship.
          </p>
        </header>

        <div className="landing-grid">
          <article className="landing-card">
            <div className="landing-card-h">
              <SponsorCredit id="pioneer" />
              <h3>Pioneer · cheap / mid / premium</h3>
            </div>
            <p>
              Every task picks a Pioneer tier via the active routing policy
              (`inferTask` → Pioneer OpenAI-compatible API). Judges see tier
              choices in Routing policy, Batch cost, and Saved vs premium. If
              the key 403s, mintoken fail-softs to local answers so the loop
              still demos.
            </p>
          </article>

          <article className="landing-card">
            <div className="landing-card-h">
              <SponsorCredit id="senso" />
              <h3>Senso · quality gate</h3>
            </div>
            <p>
              Answers are scored against Senso ground-truth context
              (`/org/search/context`). The Quality metric is that score against
              a 0.90 floor. Without a live key, local truth snippets keep
              scoring honest enough for the demo.
            </p>
          </article>

          <article className="landing-card">
            <div className="landing-card-h">
              <SponsorCredit id="guild" />
              <h3>Guild · promote or reject</h3>
            </div>
            <p>
              After a challenger batch, Guild A/B decides promote vs reject
              (live session when workspace + agent are set). Activity shows the
              decision and an Open Guild trace link. Promoted policies update
              Routing policy version and rules in-place.
            </p>
          </article>

          <article className="landing-card">
            <div className="landing-card-h">
              <SponsorCredit id="band" />
              <h3>Band · ops announce</h3>
            </div>
            <p>
              On Guild promote, Band posts policy version, quality, and savings
              to the configured chat. Activity logs the announce (live or
              cached). Judges see Band events tagged `band` in the feed.
            </p>
          </article>

          <article className="landing-card">
            <div className="landing-card-h">
              <SponsorCredit id="memory" />
              <h3>Answer memory · $0 repeats</h3>
            </div>
            <p>
              Before Pioneer, mintoken looks up normalized questions in JSON
              memory. Hits increment Memory hits, skip inference cost, and log
              `source: memory`. Seed + runtime files; no database required.
            </p>
          </article>

          <article className="landing-card">
            <div className="landing-card-h">
              <SponsorCredit id="replay" />
              <h3>Replay · LoopQA on the deploy</h3>
            </div>
            <p>
              Replay is not in the generation loop. After LoopQA passes the
              public URL, the dashboard Mark Replay QA action calls{" "}
              <code>POST /api/darwin</code> with{" "}
              <code>{`{ "action": "mark-replay" }`}</code>, lights the Replay
              credit, and appends a QA event to Activity.
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}
