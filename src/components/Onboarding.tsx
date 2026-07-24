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
    body: "This is the product UI shell. Type in the floating composer; your partner wires the live routing loop behind it.",
  },
  {
    title: "Pioneer routes each call",
    sponsor: "Pioneer",
    logo: "/sponsors/pioneer.png",
    body: "Prompts will go to cheap, mid, or premium tiers once Pioneer is connected.",
  },
  {
    title: "Senso scores quality",
    sponsor: "Senso",
    logo: "/sponsors/senso.png",
    body: "Quality will be checked against ground-truth context once Senso is connected.",
  },
  {
    title: "Guild promotes or rejects",
    sponsor: "Guild",
    logo: "/sponsors/guild.png",
    body: "Cheaper policies promote only when quality holds, once Guild A/B is connected.",
  },
  {
    title: "Band announces wins",
    sponsor: "Band",
    logo: "/sponsors/band.png",
    body: "On promote, Band will post ops notes with version, quality, and savings.",
  },
  {
    title: "Memory + Replay",
    sponsor: "Replay",
    logo: "/sponsors/replay.png",
    logoClass: "replay",
    body: "Answer memory and Replay QA light up in these panels once wired.",
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

  const current = STEPS[step];
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
