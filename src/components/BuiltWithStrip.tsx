"use client";

import type { DarwinState, SponsorStatus } from "@/engine/types";

const LABELS: { key: keyof SponsorStatus; name: string }[] = [
  { key: "pioneer", name: "Pioneer" },
  { key: "senso", name: "Senso" },
  { key: "guild", name: "Guild" },
  { key: "band", name: "Band" },
  { key: "replay", name: "Replay" },
];

export function BuiltWithStrip({ status }: { status: SponsorStatus }) {
  return (
    <div className="built-with">
      <span className="built-label">Sponsors</span>
      {LABELS.map(({ key, name }) => (
        <span
          key={key}
          className={`chip ${status[key] ? "on" : "off"}`}
          title={status[key] ? "Live call this session" : "Not live yet / fail-soft"}
        >
          {name}
        </span>
      ))}
    </div>
  );
}

export function missingKeys(): string[] {
  // client-visible hint only — real check is server .env
  return [];
}

export type { DarwinState };
