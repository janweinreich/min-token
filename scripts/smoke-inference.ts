/**
 * Live smoke against the real provider. Doubles as the sponsor-proof artifact:
 * prints the model Pioneer's router actually selected, and the full token
 * breakdown the benchmark claim depends on.
 */
import { pioneerInference } from "../packages/core/src/adapters/messages-inference.js";

const key = process.env.PIONEER_API_KEY;
if (!key) {
  console.error("PIONEER_API_KEY not set (source .env.local)");
  process.exit(1);
}

const provider = pioneerInference(key);
console.log(`\n${provider.info.label}\n`);

const CASES = [
  { alias: "lean" as const, q: "In one sentence: what does npm install do?" },
  { alias: "strong" as const, q: "In one sentence: why is a vector index unnecessary for 500 rows?" },
  { alias: "auto-code" as const, q: "Write a one-line TypeScript function that sums an array." },
];

const h = await provider.health();
console.log(`health: ok=${h.ok} ${h.latencyMs}ms ${h.error ?? ""}\n`);

console.log("alias      selected model                 in  out  cRd  cWr  TOTAL   $        src       ms");
console.log("─".repeat(96));

let grand = 0;
for (const c of CASES) {
  const r = await provider.generate({
    alias: c.alias,
    system: { stable: "You are terse. Answer in one short sentence." },
    user: c.q,
    maxOutputTokens: 80,
    requestId: `smoke-${c.alias}`,
  });
  const total = r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens;
  grand += total;
  console.log(
    `${c.alias.padEnd(10)} ${(r.selectedModelId ?? "?").padEnd(29)} ` +
      `${String(r.inputTokens).padStart(3)} ${String(r.outputTokens).padStart(4)} ` +
      `${String(r.cacheReadTokens).padStart(4)} ${String(r.cacheWriteTokens).padStart(4)} ` +
      `${String(total).padStart(6)}   ${(r.estimatedCostUsd?.toFixed(6) ?? "n/a").padEnd(8)} ` +
      `${r.usageSource.padEnd(9)} ${r.latencyMs}`,
  );
  if (r.providerRequestId) console.log(`${" ".repeat(11)}provider request id: ${r.providerRequestId}`);
}

console.log("─".repeat(96));
console.log(`total generation tokens across ${CASES.length} calls: ${grand}\n`);
console.log(
  "Note: totals include cache-read/write, not just input_tokens.\n" +
    "input_tokens is the UNCACHED REMAINDER only — summing it alone under-reports our own spend.\n",
);
