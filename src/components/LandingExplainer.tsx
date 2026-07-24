"use client";

import { SponsorCredit } from "./SponsorCredit";

const FLOW = [
  {
    n: "01",
    title: "Memory lookup",
    body: "Normalize the question. Hit → reuse stored answer, skip Pioneer.",
  },
  {
    n: "02",
    title: "Pioneer route",
    body: "Miss → call cheap, mid, or premium per the active policy.",
  },
  {
    n: "03",
    title: "Senso score",
    body: "Ground-truth quality check. Floor is 0.90.",
  },
  {
    n: "04",
    title: "A/B cost",
    body: "Baseline is always-premium. Challenger tries cheaper tiers.",
  },
  {
    n: "05",
    title: "Guild decide",
    body: "Promote if quality holds and cost ≤ 60% of premium.",
  },
  {
    n: "06",
    title: "Band + Replay",
    body: "Announce promotes on Band. Mark Replay QA after LoopQA.",
  },
] as const;

const INTEGRATIONS: {
  id: "memory" | "pioneer" | "senso" | "guild" | "band" | "replay";
  title: string;
  bullets: string[];
}[] = [
  {
    id: "memory",
    title: "Answer memory",
    bullets: [
      "Runs before every Pioneer call.",
      "JSON seed + runtime store. No database.",
      "Hits raise Memory hits and dollars avoided.",
    ],
  },
  {
    id: "pioneer",
    title: "Pioneer",
    bullets: [
      "OpenAI-compatible chat at PIONEER_BASE_URL.",
      "Policy maps features to cheap / mid / premium.",
      "Drives Batch cost, savings, and routing rules.",
    ],
  },
  {
    id: "senso",
    title: "Senso",
    bullets: [
      "Context via /org/search/context.",
      "Quality vs ground truth, not self-graded.",
      "Below 0.90 blocks Guild promote.",
    ],
  },
  {
    id: "guild",
    title: "Guild",
    bullets: [
      "Agent-test session after each challenger batch.",
      "Promote bumps policy version; reject keeps incumbent.",
      "Activity shows the decision and a trace link.",
    ],
  },
  {
    id: "band",
    title: "Band",
    bullets: [
      "On promote: posts version, quality, cost, savings %.",
      "Ops chat stays current without opening the app.",
      "Activity tags events as band (live or cached).",
    ],
  },
  {
    id: "replay",
    title: "Replay",
    bullets: [
      "Outside the generation loop. LoopQA the public URL.",
      'Mark Replay QA posts { "action": "mark-replay" }.',
      "Lights the Replay row and logs QA in Activity.",
    ],
  },
];

export function LandingExplainer() {
  return (
    <section className="landing" id="how-it-works">
      <div className="landing-inner">
        <header className="landing-intro">
          <div className="landing-intro-copy">
            <p className="landing-kicker">How mintoken works</p>
            <h2>Cut LLM spend. Hold quality. Evolve the route.</h2>
            <p>
              mintoken A/B-tests Pioneer cheap / mid / premium tiers against a
              Senso 0.90 quality floor, promotes winners with Guild, announces on
              Band, and skips recompute with answer memory.
            </p>
          </div>
          <div className="landing-intro-stats">
            <div className="landing-pill">
              <span className="landing-pill-k">Quality floor</span>
              <span className="landing-pill-v">0.90</span>
            </div>
            <div className="landing-pill">
              <span className="landing-pill-k">Cost target</span>
              <span className="landing-pill-v">−40%</span>
            </div>
            <div className="landing-pill">
              <span className="landing-pill-k">Repeat calls</span>
              <span className="landing-pill-v">$0</span>
            </div>
          </div>
        </header>

        <div className="landing-section">
          <div className="landing-section-h">
            <h3>Generation loop</h3>
            <p>One user prompt walks this path end to end.</p>
          </div>
          <div className="landing-flow">
            {FLOW.map((step) => (
              <article key={step.n} className="landing-flow-card">
                <span className="landing-flow-n">{step.n}</span>
                <h4>{step.title}</h4>
                <p>{step.body}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="landing-section">
          <div className="landing-section-h">
            <h3>Integrations</h3>
            <p>Each tool owns one job in the loop.</p>
          </div>
          <div className="landing-integrations">
            {INTEGRATIONS.map((item) => (
              <article key={item.id} className="landing-int-card">
                <div className="landing-int-top">
                  <SponsorCredit id={item.id} />
                  <h4>{item.title}</h4>
                </div>
                <ul>
                  {item.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>

        <div className="landing-criteria">
          <span className="landing-criteria-label">Success</span>
          <span>≥90% quality</span>
          <span className="landing-criteria-sep" aria-hidden>
            ·
          </span>
          <span>≥40% below always-premium</span>
          <span className="landing-criteria-sep" aria-hidden>
            ·
          </span>
          <span>Memory hits compound savings</span>
        </div>
      </div>
    </section>
  );
}
