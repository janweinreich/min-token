/**
 * The strong reasoner writes the router's prompt.
 *
 * Everything upstream of this already exists: the reference model answers, the
 * cheap rungs answer, the reference judges each cheap answer one at a time, and
 * the cheapest accepted rung is recorded. That produces a corpus of
 * (question, task class, which cheap model was good enough, why) tuples.
 *
 * What this adds is the step that makes the loop close on itself. Instead of a
 * human-authored template that renders an aggregated table, the reference model
 * READS the tuples and writes the routing prompt — deciding for itself which
 * signals in a question predict that a cheap model will hold up. The prompt
 * becomes a learned artifact rather than a fixed one, so re-running training on
 * new traffic can change how the router reasons, not merely the numbers it
 * reasons over.
 *
 * The output is still bounded: routeWithLlm validates the picked model against
 * the ladder and falls back deterministically, so a synthesized prompt that
 * drifts cannot route to something that does not exist. A prompt that fails
 * validation here is discarded in favour of the built-in template rather than
 * shipped — a learned artifact that does not work is worse than a fixed one
 * that does.
 */
import { LADDER } from "./ladder.js";
import type { RawGenerate } from "./distil.js";
import type { TrainingExample } from "./distil.js";

export interface SynthesisResult {
  prompt: string;
  /** `synthesized` = written by the reference model. `builtin` = validation rejected it. */
  source: "synthesized" | "builtin";
  reason: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * The evidence, compressed. Full answer text would blow the context and is not
 * what the router needs — it needs to see WHICH questions a cheap model held up
 * on and the judge's stated reason, which is the actual signal.
 */
export function evidenceDigest(examples: TrainingExample[]): string {
  return examples
    .map((e) => {
      const runs = e.candidates
        .map((c) => `      ${c.model}: ${c.acceptable ? "ACCEPTED" : "REJECTED"} — ${(c.verdict ?? "").slice(0, 110)}`)
        .join("\n");
      return (
        `  Q: ${e.question}\n` +
        `    class: ${e.taskType}\n` +
        `    cheapest model the judge accepted: ${e.cheapestAcceptable ?? "none — only the reference was good enough"}\n` +
        runs
      );
    })
    .join("\n\n");
}

const META_PROMPT = (ladder: string, digest: string) => `You are writing the SYSTEM PROMPT for a cheap, fast model whose only job is to look at an incoming question and name which model should answer it. That router model is not smart. Your prompt is the only thing it will have.

Below is training evidence. For each question a strong reference model produced an answer, every cheaper model also produced one, and the reference model then judged each cheap answer on its own merits. "ACCEPTED" means that cheap model's answer was good enough to ship.

MODELS AVAILABLE TO THE ROUTER, cheapest first:
${ladder}

TRAINING EVIDENCE:
${digest}

Study what actually distinguishes the questions where a cheap model held up from the ones where it did not. Do not just restate the per-class counts — the router needs to generalise to questions in no class you have seen. Write the prompt around the observable features of a question that predicted the outcome.

Write the router's system prompt now. It MUST:
  - state the available models and that cheapest-that-still-works wins
  - give concrete, checkable criteria for moving up or down the ladder, grounded in what you observed above
  - warn about the failure mode you can see in the evidence, if there is one

Do NOT write the output-format instruction — that is appended for you. Write the
reasoning guidance only.

Keep it under 300 words. This prompt is sent on EVERY routed request, so every
word is paid for again each time — a router prompt that is twice as long has to
be twice as good to break even.

Output ONLY the system prompt text itself. No preamble, no explanation, no markdown fence around it.`;

/**
 * The output contract is machinery, not learned content, so it is APPENDED
 * rather than left to the model. Measured: asked to include it verbatim, the
 * reference model produced it on one run and paraphrased it on the next, which
 * failed validation and silently dropped the whole synthesized prompt. The model
 * should decide how to route; it should not get a vote on the wire format the
 * parser depends on.
 */
export const OUTPUT_CONTRACT = `

Reply with ONLY compact JSON, no prose and no code fence:
{"model": "<exact id from the list>", "why": "<10 words or fewer>"}`;

/** A synthesized prompt has to actually work. These are the non-negotiables. */
export function validatePrompt(p: string): { ok: boolean; reason: string } {
  if (p.trim().length < 200) return { ok: false, reason: "too short to be a usable prompt" };
  if (p.length > 8000) return { ok: false, reason: "too long — would cost more per request than it saves" };
  if (!/"model"/.test(p) || !/"why"/.test(p)) {
    return { ok: false, reason: "does not specify the JSON output contract" };
  }
  // At least half the ladder must be nameable, or the router cannot reach them.
  const named = LADDER.filter((r) => p.includes(r.id)).length;
  if (named < Math.ceil(LADDER.length / 2)) {
    return { ok: false, reason: `names only ${named}/${LADDER.length} ladder models` };
  }
  return { ok: true, reason: `names ${named}/${LADDER.length} models, states the JSON contract` };
}

export async function synthesizeRouterPrompt(
  examples: TrainingExample[],
  call: RawGenerate,
  referenceModel: string,
  fallbackPrompt: string,
): Promise<SynthesisResult> {
  const ladder = LADDER.map((r) => `  ${r.id} ($${r.inUsd}/$${r.outUsd} per MTok)`).join("\n");
  const meta = META_PROMPT(ladder, evidenceDigest(examples));

  // Budget generously and retry once on an empty body. Measured against Pioneer:
  // a run that hits max_tokens returns a single text block of length ZERO while
  // still billing the full output, so "empty" and "truncated" look identical
  // from the outside and only a retry distinguishes a blip from a real failure.
  let text = "";
  let r = { text: "", inputTokens: 0, outputTokens: 0 };
  try {
    for (let attempt = 0; attempt < 2 && !text; attempt++) {
      r = await call(referenceModel, "You write precise, compact system prompts.", meta, 3000);
      text = r.text.replace(/^\s*```(?:markdown|text)?\s*/i, "").replace(/```\s*$/, "").trim();
    }
    const v = validatePrompt(text + OUTPUT_CONTRACT);
    return v.ok
      ? {
          prompt: text + OUTPUT_CONTRACT,
          source: "synthesized",
          reason: v.reason,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          costUsd: 0,
        }
      : {
          prompt: fallbackPrompt,
          source: "builtin",
          reason: `rejected: ${v.reason}`,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          costUsd: 0,
        };
  } catch (e) {
    return {
      prompt: fallbackPrompt,
      source: "builtin",
      reason: `synthesis call failed: ${String(e).slice(0, 80)}`,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
  }
}
