"use client";

type SponsorId = "pioneer" | "senso" | "guild" | "band" | "replay" | "memory";

const CREDIT: Record<
  SponsorId,
  { name: string; feature?: string; src?: string; className?: string }
> = {
  replay: {
    name: "Replay",
    feature: "session QA",
    src: "/sponsors/replay.png",
    className: "replay",
  },
  guild: {
    name: "Guild",
    feature: "promote",
    src: "/sponsors/guild.png",
  },
  band: {
    name: "Band",
    feature: "announce",
    src: "/sponsors/band.png",
  },
  pioneer: {
    name: "Pioneer",
    feature: "routing",
    src: "/sponsors/pioneer.png",
  },
  senso: {
    name: "Senso",
    feature: "quality",
    src: "/sponsors/senso.png",
  },
  memory: {
    name: "Answer memory",
    feature: "repeats",
  },
};

export function SponsorCredit({
  id,
  compact = false,
}: {
  id: SponsorId;
  compact?: boolean;
}) {
  const c = CREDIT[id];
  const label = `${c.name}${c.feature ? ` (${c.feature})` : ""}`;

  return (
    <span
      className={`sponsor-credit${compact ? " compact" : ""}`}
      title={label}
      aria-label={label}
    >
      {c.src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={`sponsor-credit-logo${c.className ? ` ${c.className}` : ""}`}
          src={c.src}
          alt={c.name}
        />
      ) : (
        <span className="sponsor-credit-mark" aria-hidden>
          M
        </span>
      )}
      {!compact && c.feature ? (
        <span className="sponsor-credit-feature">{c.feature}</span>
      ) : null}
    </span>
  );
}
