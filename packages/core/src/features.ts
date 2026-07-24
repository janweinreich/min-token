/**
 * Deterministic request features.
 *
 * No model is called to classify the question. Calling one would be
 * self-defeating: the whole product claim is that we avoid inference we do not
 * need, and spending a model call to decide whether to spend a model call is
 * exactly the waste being eliminated. Keyword dictionaries and regexes are also
 * reproducible, which the benchmark requires.
 */
import { danger, hasActionIntent, isPersonalized, isTemporal, valuesOf } from "./danger-lexicon.js";
import type { RetrievedChunk } from "./ports.js";
import type { RequestFeatures } from "./router.js";

export type TaskType = RequestFeatures["taskType"];

const CODE_VERBS = [
  "write", "implement", "code", "function", "script", "snippet", "example",
  "class", "method", "refactor", "compile", "typescript", "python", "javascript",
];
const DEBUG_VERBS = ["debug", "fix", "error", "exception", "stack trace", "failing", "broken", "why does", "traceback"];
const COMPARE_VERBS = ["difference", "differ", "compare", "versus", " vs ", "better than", "instead of", "tradeoff"];
const EXPLAIN_VERBS = ["explain", "how does", "why is", "what happens", "describe", "walk me through"];

export function classifyTask(question: string): TaskType {
  const q = ` ${question.toLowerCase()} `;
  const hasCodeFence = /```/.test(question);

  if (DEBUG_VERBS.some((v) => q.includes(v))) return "debug";
  // A code fence, or an explicit request to produce code.
  if (hasCodeFence) return "code";
  if (/\b(write|implement|refactor|generate)\b/.test(q) && CODE_VERBS.some((v) => q.includes(v))) {
    return "code";
  }
  if (hasActionIntent(question)) return "action";
  if (COMPARE_VERBS.some((v) => q.includes(v))) return "comparison";
  if (EXPLAIN_VERBS.some((v) => q.includes(v))) return "explanation";
  if (/^\s*(what|which|where|who|when)\b/i.test(question)) return "lookup";
  return "unknown";
}

/**
 * The terms abstention is judged against. Danger tokens are used rather than all
 * words because they are the ones that carry the question's actual constraints —
 * a question is unanswerable when its *entities* are absent from the evidence,
 * not when its stopwords are.
 */
export function significantTerms(question: string): string[] {
  const d = danger(question);
  const terms = new Set<string>();
  for (const cls of ["product", "language", "packageManager", "identifier", "version"] as const) {
    for (const v of valuesOf(d, cls)) terms.add(v);
  }
  if (terms.size === 0) {
    // Fall back to content words so coverage is never vacuously 1.0.
    for (const w of question.toLowerCase().split(/[^a-z0-9@./_-]+/)) {
      if (w.length > 4) terms.add(w);
    }
  }
  return [...terms];
}

/**
 * Does this question claim to be ABOUT the corpus?
 *
 * This is what separates the two very different reasons to have no evidence:
 *
 *   in-domain + no evidence  -> we are supposed to know this and do not. ABSTAIN;
 *                               guessing about a documented API is how you ship a
 *                               confidently wrong answer.
 *   out-of-domain            -> it was never a corpus question. Refusing "give me
 *                               a recipe" is not safety, it is just unhelpful —
 *                               and it throws away the cheap-model saving on
 *                               exactly the questions that are cheapest to serve.
 */
export function mentionsCorpusDomain(question: string, corpusTerms: Set<string>): boolean {
  const d = danger(question);
  for (const cls of ["product", "identifier"] as const) {
    for (const v of valuesOf(d, cls)) if (corpusTerms.has(v)) return true;
  }
  return false;
}

export function extractFeatures(
  question: string,
  chunks: RetrievedChunk[],
  corpusTerms?: Set<string>,
): RequestFeatures {
  return {
    questionChars: question.length,
    taskType: classifyTask(question),
    temporal: isTemporal(question),
    actionIntent: hasActionIntent(question) || isPersonalized(question),
    queryTerms: significantTerms(question),
    chunks,
    inCorpusDomain: corpusTerms ? mentionsCorpusDomain(question, corpusTerms) : true,
  };
}
