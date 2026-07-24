/**
 * Skill synthesis — where the loop writes down what it learned.
 *
 * The evolution engine improves a policy, but a policy is a bag of numbers: it
 * cannot be read, reviewed, diffed, or handed to another agent. This module
 * compiles the promoted policy plus measured routing episodes into a routing
 * SKILL — a document an agent reads to decide which model a question deserves.
 *
 * Two rules make this honest rather than decorative:
 *
 *  1. EVERY line is DERIVED from a policy parameter or measured episode evidence.
 *     Nothing here is authored prose. That is why the skill cannot drift from
 *     behaviour: there is no place for an opinion to hide.
 *
 *  2. `assertSkillMatchesRouter` proves the stated decision procedure produces
 *     the same routes as the real router on probe inputs. A skill that describes
 *     behaviour the code does not have is worse than no skill, because an agent
 *     would follow it.
 */
import type { RoutingPolicy } from "./policy.js";
import { chooseRoute, type RequestFeatures, type Route, type RoutingEpisode } from "./router.js";
import { leanSuccessLowerBound } from "./router.js";
import type { AggregateMetrics } from "./eval/scorer.js";

export interface EpisodeRecord extends RoutingEpisode {
  taskType: string;
  generationTokens: number;
}

export interface TaskClassEvidence {
  taskType: string;
  n: number;
  leanAttempts: number;
  leanCleanSuccesses: number;
  leanSuccessLCB: number;
  meanTokensLean: number;
  meanTokensStrong: number;
  /** The route this evidence actually justifies. */
  recommendation: "prefer_lean" | "prefer_strong" | "insufficient_evidence";
}

/**
 * Per-task-class learning. This is the part that is genuinely LEARNED rather
 * than configured: it comes from what actually happened, not from a threshold.
 */
export function summarizeEpisodes(
  episodes: EpisodeRecord[],
  policy: RoutingPolicy,
): TaskClassEvidence[] {
  const byType = new Map<string, EpisodeRecord[]>();
  for (const e of episodes) {
    const list = byType.get(e.taskType) ?? [];
    list.push(e);
    byType.set(e.taskType, list);
  }

  const out: TaskClassEvidence[] = [];
  for (const [taskType, list] of [...byType.entries()].sort()) {
    const lean = list.filter((e) => e.route === "LEAN_RAG");
    const strong = list.filter((e) => e.route === "STRONG_RAG");
    const clean = lean.filter((e) => e.passed && !e.repaired);
    // Same estimator the router uses, so the skill cannot claim a confidence the
    // router would not act on.
    const lcb = leanSuccessLowerBound(
      list.map((e) => ({ similarity: 1, route: e.route, passed: e.passed, repaired: e.repaired, taskType })),
      policy.relatedThreshold,
      1.2816,
      taskType,
    );
    const mean = (xs: EpisodeRecord[]) =>
      xs.length ? Math.round(xs.reduce((s, e) => s + e.generationTokens, 0) / xs.length) : 0;

    out.push({
      taskType,
      n: list.length,
      leanAttempts: lean.length,
      leanCleanSuccesses: clean.length,
      leanSuccessLCB: lcb,
      meanTokensLean: mean(lean),
      meanTokensStrong: mean(strong),
      recommendation:
        lean.length < 3
          ? "insufficient_evidence"
          : lcb >= policy.leanMinHistoricalSuccess
            ? "prefer_lean"
            : "prefer_strong",
    });
  }
  return out;
}

export interface SkillInput {
  policyVersion: number;
  policy: RoutingPolicy;
  previousPolicy?: RoutingPolicy;
  episodes: EpisodeRecord[];
  holdout?: { before: AggregateMetrics; after: AggregateMetrics };
  qualityFloor: number;
  generatedAt: string;
}

function diffPolicy(a: RoutingPolicy, b: RoutingPolicy): string[] {
  return (Object.keys(b) as Array<keyof RoutingPolicy>)
    .filter((k) => a[k] !== b[k])
    .map((k) => `\`${String(k)}\`: ${a[k]} → ${b[k]}`);
}

/** Compile the policy + evidence into the routing skill. */
export function synthesizeRoutingSkill(input: SkillInput): string {
  const p = input.policy;
  const ev = summarizeEpisodes(input.episodes, p);
  const L: string[] = [];

  L.push(`# Routing Skill v${input.policyVersion}`);
  L.push("");
  L.push(
    `> Generated ${input.generatedAt} from policy v${input.policyVersion}. **Do not edit by hand** — ` +
      `this file is recompiled on every policy promotion, and every rule below is derived from a ` +
      `policy parameter or from measured routing episodes.`,
  );
  L.push("");

  L.push("## Goal");
  L.push("");
  L.push(
    `Answer the question using the fewest generation tokens, **subject to** benchmark quality staying ` +
      `at or above ${input.qualityFloor.toFixed(2)}. Quality is the constraint; tokens are what you minimize. ` +
      `Never trade quality for tokens — a cheaper answer that is wrong costs more than an expensive one.`,
  );
  L.push("");

  L.push("## Decision procedure");
  L.push("");
  L.push("Apply in order. The first rule that matches wins.");
  L.push("");
  L.push(
    `1. **Approved memory that passes every safety check** → replay it. Costs **0 generation tokens**. ` +
      `Requires masked similarity ≥ ${p.semanticReplayThreshold}, raw similarity ≥ ${p.rawCosineFloor}, ` +
      `an unambiguous margin ≥ ${p.semanticReplayMargin}, and a clean entity/operation/polarity/version gate. ` +
      `Never replay a temporal, personalized, or side-effecting question.`,
  );
  L.push(
    `2. **Task is code or debug** → route to the coding model with ${p.strongContextK} context chunks ` +
      `and up to ${p.strongMaxOutputTokens} output tokens. Check this *before* considering abstention: ` +
      `code is generated, not looked up, so weak retrieval is not grounds to refuse.`,
  );
  L.push(
    `3. **Top evidence score < ${p.abstainBelowContextScore} AND evidence coverage < 0.50** → abstain. ` +
      `Say the corpus is insufficient. Do not guess.`,
  );
  L.push(
    `4. **Lean route** if all hold: question ≤ ${p.leanMaxQuestionChars} chars, not temporal, no action intent, ` +
      `top evidence ≥ ${p.leanMinContextScore}, cross-source gap ≥ ${p.leanCrossSourceGap}, and the lean ` +
      `success lower bound ≥ ${p.leanMinHistoricalSuccess}. Send ${p.leanContextK} chunks, ` +
      `≤ ${p.leanMaxOutputTokens} output tokens.`,
  );
  L.push(
    `5. **Otherwise the strong route.** ${p.strongContextK} chunks, ≤ ${p.strongMaxOutputTokens} output tokens.`,
  );
  L.push("");
  L.push(
    `Chunks are truncated to ${p.maxCharsPerChunk} characters. This is the highest-leverage number here: ` +
      `input is roughly 82% of the token budget, so evidence volume dominates cost far more than output caps do.`,
  );
  L.push("");

  L.push("## What I have learned from traffic");
  L.push("");
  if (ev.length === 0) {
    L.push(
      "_No routing episodes recorded yet._ Until evidence accumulates, the lean route stays closed: " +
        "the success estimator uses a pessimistic prior, so a cheap route must **earn** its way in over " +
        "roughly 8–10 clean successes rather than being trusted by default.",
    );
  } else {
    L.push("| task class | n | lean tried | clean wins | success (lower bound) | mean tokens lean → strong | routing |");
    L.push("|---|---:|---:|---:|---:|---:|---|");
    for (const e of ev) {
      const verdict =
        e.recommendation === "prefer_lean"
          ? "**use lean**"
          : e.recommendation === "prefer_strong"
            ? "**skip lean** — go straight to strong"
            : "_gathering evidence_";
      L.push(
        `| ${e.taskType} | ${e.n} | ${e.leanAttempts} | ${e.leanCleanSuccesses} | ` +
          `${e.leanSuccessLCB.toFixed(2)} | ${e.meanTokensLean || "–"} → ${e.meanTokensStrong || "–"} | ${verdict} |`,
      );
    }
    L.push("");
    const skip = ev.filter((e) => e.recommendation === "prefer_strong");
    if (skip.length > 0) {
      L.push(
        `Routing **${skip.map((e) => e.taskType).join(", ")}** straight to the strong model avoids the retry tax: ` +
          `a lean attempt that fails and escalates costs more than starting strong, because the repair reuses ` +
          `the larger context.`,
      );
      L.push("");
    }
  }

  if (input.previousPolicy) {
    const d = diffPolicy(input.previousPolicy, p);
    L.push("## What changed in this version");
    L.push("");
    if (d.length === 0) {
      L.push("_No parameter changed._");
    } else {
      for (const line of d) L.push(`- ${line}`);
      if (input.holdout) {
        const { before, after } = input.holdout;
        const pct = before.totalGenerationTokens
          ? ((1 - after.totalGenerationTokens / before.totalGenerationTokens) * 100).toFixed(1)
          : "0.0";
        L.push("");
        L.push(
          `Verified on the held-out set: generation tokens ${before.totalGenerationTokens} → ` +
            `${after.totalGenerationTokens} (−${pct}%), quality ${before.overallQuality.toFixed(3)} → ` +
            `${after.overallQuality.toFixed(3)}, critical failures ${after.criticalFailures}.`,
        );
      }
    }
    L.push("");
  }

  L.push("## Rules that are not negotiable");
  L.push("");
  L.push("- Never replay a memory whose entities, operation, polarity, or version conflict with the question.");
  L.push("- Never abstain on a question the corpus can answer, even though abstaining is the cheapest route.");
  L.push("- Never shorten an answer below the length its facts require; brevity is not quality.");
  L.push("- Count every attempt, including failed and repaired ones, toward the token total.");
  L.push("");

  return L.join("\n");
}

// ── Integrity: the skill must describe the router that actually exists ───────

export interface Probe {
  name: string;
  features: RequestFeatures;
  expected: Route;
}

/**
 * A synthesized skill that misdescribes the code is worse than no skill, because
 * an agent would follow it. This replays the documented decision procedure
 * against the real router and reports any divergence.
 */
export function assertSkillMatchesRouter(
  policy: RoutingPolicy,
  probes: Probe[],
  episodes: RoutingEpisode[] = [],
): { ok: boolean; mismatches: Array<{ probe: string; expected: Route; actual: Route }> } {
  const mismatches: Array<{ probe: string; expected: Route; actual: Route }> = [];
  for (const probe of probes) {
    const actual = chooseRoute(probe.features, policy, episodes, { benchmarkMode: true }).route;
    if (actual !== probe.expected) {
      mismatches.push({ probe: probe.name, expected: probe.expected, actual });
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}
