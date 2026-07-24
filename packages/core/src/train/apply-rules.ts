/**
 * Apply the distilled rules DETERMINISTICALLY, at zero token cost.
 *
 * This exists because of a measurement, scripts/measure-router-overhead.ts:
 * having a cheap model read the skill and emit a verdict lost on 8 of 8
 * questions, −4,496 tokens and −$0.0216 net against an always-haiku baseline.
 * The router's cost is FIXED (~470 tokens of rules table + question + verdict)
 * while its saving scales with answer length, so on short answers the overhead
 * is larger than the entire answer — and when it upgrades a question to a
 * stronger model it pays twice, once to decide and once for the longer answer.
 *
 * The distillation is still the valuable part. What training mode learns is a
 * table mapping task class to the cheapest model that was judged good enough;
 * reading that table is a dictionary lookup, and a dictionary lookup does not
 * need an LLM. So the learning stays and the serve-time inference goes.
 *
 * The LLM router in llm-router.ts is kept for comparison, not deleted: showing
 * both side by side is what makes the token economics legible.
 */
import type { ClassRule } from "./distil.js";

export interface AppliedRoute {
  model: string;
  reason: string;
  /** `learned` = a confident distilled rule fired. `fallback` = none applied. */
  source: "learned" | "fallback";
  /** Always zero. Stated explicitly because it is the entire point. */
  tokens: 0;
}

export function applyRules(
  taskType: string,
  rules: ClassRule[],
  fallbackModel: string,
): AppliedRoute {
  const rule = rules.find((r) => r.taskType === taskType);

  if (!rule) {
    return {
      model: fallbackModel,
      reason: `no rule learned for "${taskType}" yet`,
      source: "fallback",
      tokens: 0,
    };
  }

  // An unconfident rule is one distilled from too few judged examples. Trusting
  // it would be reading noise as policy, so it holds at the safer model rather
  // than taking the cheap suggestion.
  if (!rule.confident) {
    return {
      model: fallbackModel,
      reason: `"${taskType}" rule has only ${rule.n} judged example(s) — too thin to trust`,
      source: "fallback",
      tokens: 0,
    };
  }

  return {
    model: rule.recommended,
    reason: `learned: "${taskType}" was answered acceptably by ${rule.recommended} on ${(rule.support * 100).toFixed(0)}% of ${rule.n} judged examples`,
    source: "learned",
    tokens: 0,
  };
}
