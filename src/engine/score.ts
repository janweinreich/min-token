import type { Task } from "@/engine/types";
import type { SensoHit } from "@/adapters/senso";

/** Local checklist score; works offline. Live Senso hits boost the score. */
export function scoreAnswer(opts: {
  task: Task;
  answer: string;
  sensoHits?: SensoHit[];
}): { score: number; matched: string[]; missed: string[]; rationale: string } {
  const text = opts.answer.toLowerCase();
  const matched: string[] = [];
  const missed: string[] = [];

  for (const key of opts.task.must_include) {
    if (text.includes(key.toLowerCase())) matched.push(key);
    else missed.push(key);
  }

  const coverage =
    opts.task.must_include.length === 0
      ? 1
      : matched.length / opts.task.must_include.length;

  let sensoBoost = 0;
  if (opts.sensoHits && opts.sensoHits.length > 0) {
    if (opts.task.must_include.length === 0) {
      sensoBoost = Math.min(0.15, opts.sensoHits.length * 0.05);
    } else {
      const hitText = opts.sensoHits.map((h) => h.chunk_text.toLowerCase()).join(" ");
      const overlap = opts.task.must_include.filter((k) =>
        hitText.includes(k.toLowerCase()),
      ).length;
      sensoBoost = Math.min(0.15, (overlap / opts.task.must_include.length) * 0.15);
    }
  }

  const lengthPenalty =
    opts.answer.length < 40 ? 0.08 : opts.answer.length > 1200 ? 0.05 : 0;

  const score = Math.max(
    0,
    Math.min(1, coverage * 0.9 + sensoBoost + 0.1 - lengthPenalty),
  );

  return {
    score: Number(score.toFixed(3)),
    matched,
    missed,
    rationale: `matched ${matched.length}/${opts.task.must_include.length}; sensoBoost=${sensoBoost.toFixed(2)}`,
  };
}
