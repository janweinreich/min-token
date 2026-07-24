/**
 * Router distillation.
 *
 * The live loop's success label is weak: "did it return a grounded answer over 40
 * characters". That is not quality, it is liveness. This module produces a real
 * label — a strong model answers the question, the cheap rungs answer it too, and
 * the strong model then judges which cheap answers would actually have been good
 * enough. The cheapest one that passes is the correct route for that question.
 *
 * Three deliberate choices, because an LLM judge is easy to fool by accident:
 *
 *  - The judge is asked whether a candidate is ACCEPTABLE against the reference,
 *    one at a time. Not "which is best" — ranking invites position bias, and we
 *    do not need a ranking, we need a threshold.
 *  - Candidates are unlabelled in the prompt. The judge never learns which model
 *    wrote what, so it cannot prefer a name.
 *  - A candidate that merely matches the reference in style is not enough; the
 *    judge is asked about substance the answer would need to be useful.
 */
import type { InferenceProvider } from "../ports.js";
import { LADDER, REFERENCE_MODEL, costUsd, rungOf, type Rung } from "./ladder.js";

export interface TrainingQuestion {
  id: string;
  question: string;
  taskType: string;
  /** Evidence to answer from, when the question is corpus-grounded. */
  evidence?: string;
}

export interface CandidateRun {
  model: string;
  answer: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  acceptable?: boolean;
  verdict?: string;
}

export interface TrainingExample {
  id: string;
  question: string;
  taskType: string;
  referenceModel: string;
  referenceTokens: number;
  referenceCostUsd: number;
  candidates: CandidateRun[];
  /** Cheapest rung the judge accepted. Null when only the reference was good enough. */
  cheapestAcceptable: string | null;
  savingVsReference: { tokens: number; costUsd: number; pct: number } | null;
}

/** A raw model call by concrete id, bypassing the alias mapping. */
export type RawGenerate = (
  modelId: string,
  system: string,
  user: string,
  maxOutputTokens: number,
) => Promise<{ text: string; inputTokens: number; outputTokens: number }>;

const ANSWER_SYSTEM = (evidence?: string) =>
  evidence
    ? "Answer using ONLY the provided sources. Be concise and specific.\n\nSources:\n\n" + evidence
    : "Answer the question directly and concisely from your own knowledge.";

const JUDGE_SYSTEM = `You grade whether a cheaper model's answer is GOOD ENOUGH to ship in place of a reference answer.

Judge substance, not style. The candidate does not need to match the reference's wording, length or structure. It needs to:
  - contain the facts a user actually needs to act on
  - state nothing that contradicts the reference
  - invent no specifics the reference does not support

Reply with ONLY a compact JSON object, no prose, no code fence:
{"acceptable": true|false, "why": "<12 words or fewer>"}

Be strict about wrong or invented facts, and lenient about brevity and phrasing.`;

function parseVerdict(text: string): { acceptable: boolean; why: string } {
  const m = /\{[\s\S]*?\}/.exec(text);
  if (!m) return { acceptable: false, why: "unparseable verdict" };
  try {
    const j = JSON.parse(m[0]) as { acceptable?: unknown; why?: unknown };
    return {
      // Anything not explicitly true is treated as a fail. A judge that returns
      // junk must not silently promote a cheap model.
      acceptable: j.acceptable === true,
      why: typeof j.why === "string" ? j.why.slice(0, 80) : "",
    };
  } catch {
    return { acceptable: false, why: "unparseable verdict" };
  }
}

export async function distilOne(
  q: TrainingQuestion,
  generate: RawGenerate,
  opts: { maxOutputTokens?: number; ladder?: Rung[] } = {},
): Promise<TrainingExample> {
  const ladder = opts.ladder ?? LADDER;
  const maxOut = opts.maxOutputTokens ?? 320;
  const system = ANSWER_SYSTEM(q.evidence);

  // 1. Reference answer from the top of the ladder.
  const ref = await generate(REFERENCE_MODEL, system, q.question, maxOut);
  const refRung = rungOf(REFERENCE_MODEL)!;
  const refTokens = ref.inputTokens + ref.outputTokens;
  const refCost = costUsd(refRung, ref.inputTokens, ref.outputTokens);

  // 2. Every cheaper rung answers the same question.
  const cheaper = ladder.filter((r) => r.id !== REFERENCE_MODEL);
  const candidates: CandidateRun[] = [];
  for (const rung of cheaper) {
    try {
      const c = await generate(rung.id, system, q.question, maxOut);
      candidates.push({
        model: rung.id,
        answer: c.text,
        inputTokens: c.inputTokens,
        outputTokens: c.outputTokens,
        totalTokens: c.inputTokens + c.outputTokens,
        costUsd: costUsd(rung, c.inputTokens, c.outputTokens),
      });
    } catch {
      // A rung that errors is simply not a candidate. Recording it as
      // unacceptable would confuse "worse" with "unavailable".
    }
  }

  // 3. The reference model judges each candidate, unlabelled and one at a time.
  for (const c of candidates) {
    const prompt =
      `QUESTION\n${q.question}\n\n` +
      `REFERENCE ANSWER\n${ref.text}\n\n` +
      `CANDIDATE ANSWER\n${c.answer}\n\n` +
      `Is the candidate good enough to ship instead of the reference?`;
    const v = await generate(REFERENCE_MODEL, JUDGE_SYSTEM, prompt, 100);
    const parsed = parseVerdict(v.text);
    c.acceptable = parsed.acceptable;
    c.verdict = parsed.why;
  }

  // 4. Cheapest accepted rung wins. Ladder order is price order.
  const accepted = candidates.filter((c) => c.acceptable);
  const cheapest =
    ladder.find((r) => accepted.some((c) => c.model === r.id))?.id ?? null;
  const won = cheapest ? accepted.find((c) => c.model === cheapest)! : null;

  return {
    id: q.id,
    question: q.question,
    taskType: q.taskType,
    referenceModel: REFERENCE_MODEL,
    referenceTokens: refTokens,
    referenceCostUsd: refCost,
    candidates,
    cheapestAcceptable: cheapest,
    savingVsReference: won
      ? {
          tokens: refTokens - won.totalTokens,
          costUsd: refCost - won.costUsd,
          pct: refCost > 0 ? ((refCost - won.costUsd) / refCost) * 100 : 0,
        }
      : null,
  };
}

// ── Aggregation: examples -> a routing rule per task class ───────────────────

export interface ClassRule {
  taskType: string;
  n: number;
  /** Model the judge accepted most often as the cheapest sufficient one. */
  recommended: string;
  /** Share of questions in this class where that model was accepted. */
  support: number;
  /** False when the class is too thin to justify anything below the reference. */
  confident: boolean;
  meanSavingPct: number;
  examples: string[];
}

/**
 * Minimum examples before a class may be routed below the reference model.
 *
 * With n=1 a single accepted answer reads as 100% support, which is how a lucky
 * question ends up routing an entire class to a model that usually fails. Thin
 * classes stay on the reference: the expensive default is the safe one.
 */
export const MIN_SUPPORT_N = 3;

export function aggregate(examples: TrainingExample[]): ClassRule[] {
  const byClass = new Map<string, TrainingExample[]>();
  for (const e of examples) {
    const l = byClass.get(e.taskType) ?? [];
    l.push(e);
    byClass.set(e.taskType, l);
  }

  const out: ClassRule[] = [];
  for (const [taskType, list] of [...byClass.entries()].sort()) {
    // The recommendation is the cheapest model that was accepted on a MAJORITY of
    // this class. Picking the cheapest ever accepted would overfit to one lucky
    // question and route the whole class to a model that usually fails.
    let recommended = REFERENCE_MODEL;
    let support = 1;
    for (const rung of LADDER) {
      const ok = list.filter((e) =>
        e.candidates.some((c) => c.model === rung.id && c.acceptable),
      ).length;
      const share = ok / list.length;
      if (share > 0.5 && list.length >= MIN_SUPPORT_N) {
        recommended = rung.id;
        support = share;
        break;
      }
    }
    const savings = list
      .filter((e) => e.cheapestAcceptable === recommended && e.savingVsReference)
      .map((e) => e.savingVsReference!.pct);
    out.push({
      taskType,
      n: list.length,
      recommended,
      support,
      confident: list.length >= MIN_SUPPORT_N,
      meanSavingPct: savings.length ? savings.reduce((a, b) => a + b, 0) / savings.length : 0,
      examples: list.slice(0, 2).map((e) => e.question),
    });
  }
  return out;
}

/** Convenience wrapper so scripts can drive the ladder through an InferenceProvider. */
export function rawGenerateVia(
  provider: InferenceProvider,
  callByModel: (modelId: string, system: string, user: string, maxOut: number) => Promise<{
    text: string;
    inputTokens: number;
    outputTokens: number;
  }>,
): RawGenerate {
  void provider;
  return callByModel;
}
