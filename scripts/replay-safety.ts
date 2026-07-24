/**
 * The replay-safety measurement. Costs ZERO generation tokens — every probe is
 * an embedding plus a gate evaluation — so it runs offline, in milliseconds,
 * with no API key. It is the cheapest evidence in the build and the only thing
 * that can support the safety half of the claim.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { miniLmEmbedder } from "../packages/core/src/embeddings/minilm.js";
import { runReplaySafety, type ReplayProbe, type SeedMemory } from "../packages/core/src/eval/runner.js";
import { wilsonLowerBound } from "../packages/core/src/eval/scorer.js";
import { DEFAULT_REPLAY_POLICY } from "../packages/core/src/replay-guard.js";

const jsonl = async <T>(p: string): Promise<T[]> =>
  (await readFile(p, "utf8")).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);

const probes = await jsonl<ReplayProbe>("data/benchmarks/replay.jsonl");
const seeds = await jsonl<SeedMemory>("data/memory-fixtures/seed-v1.jsonl");

const r = await runReplaySafety({
  probes,
  seeds,
  embedder: miniLmEmbedder,
  policy: DEFAULT_REPLAY_POLICY,
  activeSnapshotId: "sponsor-docs-v1",
});

const lb = wilsonLowerBound(r.correct, r.total);
console.log(`\nreplay safety: ${r.correct}/${r.total} correct decisions`);
console.log(`Wilson 95% lower bound: ${lb.toFixed(3)}`);
console.log(`(${probes.filter((p) => p.mustReplay).length} must replay, ${probes.filter((p) => p.mustRejectReplay).length} must refuse)\n`);

if (r.failures.length) {
  console.log("FAILURES");
  for (const f of r.failures) {
    console.log(`  ${f.id.padEnd(22)} expected ${f.expected}, got ${f.actual}  — ${f.why}`);
    if (f.reasons.length) console.log(`  ${" ".repeat(22)} gate said: ${f.reasons.join(", ")}`);
  }
  console.log();
}

await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/replay-safety.json",
  JSON.stringify({ correct: r.correct, total: r.total, wilsonLowerBound: lb, failures: r.failures }, null, 2) + "\n",
);
console.log("wrote artifacts/replay-safety.json");
if (lb < 0.95) {
  console.log(
    `\nNOTE: a lower bound of ${lb.toFixed(3)} does not support a ">= 0.95 replay precision" claim.\n` +
      `With ${r.total} probes even a perfect score caps at ${wilsonLowerBound(r.total, r.total).toFixed(3)}.\n` +
      `Report the bound, not the point estimate.`,
  );
}
