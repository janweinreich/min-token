"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "mintoken-onboarding-v1";

type Step = {
  title: string;
  body: string;
  logo?: string;
  logoClass?: string;
  sponsor?: string;
};

const STEPS: Step[] = [
  {
    title: "Welcome to mintoken",
    body: "Type your own prompt in the composer. mintoken routes it, measures quality and cost, then shows every decision.",
  },
  {
    title: "Pioneer routes each call",
    sponsor: "Pioneer",
    logo: "/sponsors/pioneer.png",
    body: "Each memory miss goes to a cheap, mid, or premium tier. If Pioneer is unavailable, local inference keeps the demo moving.",
  },
  {
    title: "Senso scores quality",
    sponsor: "Senso",
    logo: "/sponsors/senso.png",
    body: "Every fresh answer is grounded and checked against the 0.90 quality floor.",
  },
  {
    title: "Guild promotes or rejects",
    sponsor: "Guild",
    logo: "/sponsors/guild.png",
    body: "Cheaper policies promote only when quality holds and cost stays at or below 60% of premium.",
  },
  {
    title: "Band announces wins",
    sponsor: "Band",
    logo: "/sponsors/band.png",
    body: "A promotion posts version, quality, cost, and savings to the ops feed.",
  },
  {
    title: "Memory + Replay",
    sponsor: "Replay",
    logo: "/sponsors/replay.png",
    logoClass: "replay",
    body: "Repeat prompts can skip recompute. Mark Replay QA after checking the public experience.",
  },
];

export function Onboarding() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") return;
      setOpen(true);
    } catch {
      setOpen(true);
    }
  }, []);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore
    }
    setOpen(false);
  }, []);

  if (!open) return null;

  const current = STEPS[step] ?? STEPS[0]!;
  const last = step === STEPS.length - 1;

  return (
    <div className="onboard" role="dialog" aria-modal="true" aria-label="mintoken tour">
      <div className="onboard-card">
        <div className="onboard-top">
          <span className="onboard-step">
            {step + 1} / {STEPS.length}
          </span>
          <button type="button" className="onboard-skip" onClick={dismiss}>
            Skip
          </button>
        </div>

        {current.logo ? (
          <div className="onboard-logo-wrap">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className={`onboard-logo${current.logoClass ? ` ${current.logoClass}` : ""}`}
              src={current.logo}
              alt={current.sponsor ?? ""}
            />
          </div>
        ) : null}

        <h2 className="onboard-title">{current.title}</h2>
        <p className="onboard-body">{current.body}</p>

        <div className="onboard-actions">
          {step > 0 ? (
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => setStep((s) => s - 1)}
            >
              Back
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              if (last) dismiss();
              else setStep((s) => s + 1);
            }}
          >
            {last ? "Got it" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
