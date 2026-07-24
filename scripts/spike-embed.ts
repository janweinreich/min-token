/**
 * The gate that everything downstream depends on.
 *
 * Hypothesis under test: with raw sentence embeddings, the must-REJECT entity swap
 * scores HIGHER than the must-ALLOW paraphrase — so no scalar threshold separates
 * them. Masking entities before embedding should collapse question-shape pairs
 * together, moving the decision entirely onto the deterministic gate.
 *
 * If the unmasked inversion is NOT real, the spec's design might survive and this
 * plan is over-engineered. Measure, don't assume.
 */
import { miniLmEmbedder, cosine } from "../packages/core/src/embeddings/minilm.js";

// Minimal stand-in for the real lexicon (packages/core/src/danger-lexicon.ts).
// Natural placeholder WORDS, not <ANGLE_BRACKETS> — wordpiece shreds those.
const MASK: Array<[RegExp, string]> = [
  [/\b(javascript|js|typescript|ts|node\.?js|python|py|java|go|rust|ruby)\b/gi, "the language"],
  [/\b(actian|vectorai|vector ai|senso|pioneer|guild|postgres|qdrant)\b/gi, "the platform"],
  [/@[\w-]+\/[\w.-]+/g, "the package"],
  [/\b(npm|pip|yarn|pnpm|poetry|cargo)\b/gi, "the package manager"],
  [/\bv?\d+(\.\d+)+\b/g, "a version"],
];

function mask(s: string): string {
  let out = s.toLowerCase().trim().replace(/[?.!]+$/, "").replace(/\s+/g, " ");
  for (const [re, rep] of MASK) out = out.replace(re, rep);
  return out.replace(/\s+/g, " ").trim();
}

const ANCHOR = "How do I install the Actian JavaScript SDK?";

const PAIRS: Array<{ label: string; text: string; want: "ALLOW" | "REJECT" }> = [
  { label: "identical, recased",        text: "how do i install the actian javascript sdk",                                  want: "ALLOW"  },
  { label: "paraphrase (npm/TS)",       text: "Which npm package should I install to use Actian VectorAI from TypeScript?",  want: "ALLOW"  },
  { label: "paraphrase (plain)",        text: "What do I need to add to my project to use Actian's JS client?",              want: "ALLOW"  },
  { label: "ENTITY SWAP -> Python",     text: "How do I install the Actian Python SDK?",                                     want: "REJECT" },
  { label: "OPERATION SWAP -> uninstall", text: "How do I uninstall the Actian JavaScript SDK?",                             want: "REJECT" },
  { label: "PRODUCT SWAP -> Senso",     text: "How do I install the Senso JavaScript SDK?",                                  want: "REJECT" },
  { label: "TEMPORAL -> latest version", text: "What is the latest version of the Actian JavaScript SDK?",                   want: "REJECT" },
  { label: "unrelated corpus question", text: "What is the difference between a Guild coded agent and an LLM agent?",        want: "REJECT" },
];

function bar(x: number): string {
  const n = Math.max(0, Math.min(30, Math.round(x * 30)));
  return "█".repeat(n).padEnd(30, "·");
}

async function main() {
  const t0 = Date.now();
  const h = await miniLmEmbedder.health();
  if (!h.ok) {
    console.error("EMBEDDER FAILED TO LOAD:", h.error);
    process.exit(1);
  }
  console.log(`\nembedder: ${miniLmEmbedder.modelId}  dim=${miniLmEmbedder.dimension}`);
  console.log(`cold load + warmup: ${Date.now() - t0} ms`);

  const t1 = Date.now();
  await miniLmEmbedder.embed("steady state latency probe");
  console.log(`steady-state single embed: ${Date.now() - t1} ms\n`);

  const rawTexts = [ANCHOR, ...PAIRS.map((p) => p.text)];
  const mskTexts = rawTexts.map(mask);
  const rawVecs = await miniLmEmbedder.embedBatch(rawTexts);
  const mskVecs = await miniLmEmbedder.embedBatch(mskTexts);

  console.log(`anchor: "${ANCHOR}"`);
  console.log(`masked: "${mask(ANCHOR)}"\n`);
  console.log("want    cos_raw                          cos_masked   pair");
  console.log("─".repeat(100));

  const allowRaw: number[] = [];
  const rejectRaw: number[] = [];
  const allowMsk: number[] = [];
  const rejectMsk: number[] = [];

  PAIRS.forEach((p, i) => {
    const r = cosine(rawVecs[0]!, rawVecs[i + 1]!);
    const m = cosine(mskVecs[0]!, mskVecs[i + 1]!);
    (p.want === "ALLOW" ? allowRaw : rejectRaw).push(r);
    (p.want === "ALLOW" ? allowMsk : rejectMsk).push(m);
    console.log(
      `${p.want.padEnd(7)} ${r.toFixed(3)} ${bar(r)}  ${m.toFixed(3)}       ${p.label}`,
    );
  });

  const minAllowRaw = Math.min(...allowRaw);
  const maxRejectRaw = Math.max(...rejectRaw);
  const minAllowMsk = Math.min(...allowMsk);
  const maxRejectMsk = Math.max(...rejectMsk);

  console.log("\n" + "─".repeat(100));
  console.log(`RAW     worst ALLOW = ${minAllowRaw.toFixed(3)}   best REJECT = ${maxRejectRaw.toFixed(3)}`);
  console.log(`MASKED  worst ALLOW = ${minAllowMsk.toFixed(3)}   best REJECT = ${maxRejectMsk.toFixed(3)}`);

  const rawSeparable = minAllowRaw > maxRejectRaw;
  console.log(
    `\nIs a single threshold viable on RAW cosine? ${rawSeparable ? "YES" : "NO — the distributions overlap/invert"}`,
  );
  if (!rawSeparable) {
    console.log(
      `  => cosine cannot be the safety mechanism. It buys RECALL; the deterministic\n` +
      `     gate must buy 100% of the PRECISION. This is the plan's core claim, confirmed.`,
    );
  }
  console.log(
    `\nMasked recall floor (tau candidate) = ${minAllowMsk.toFixed(3)}` +
    `  -> masking lifts worst-ALLOW by ${(minAllowMsk - minAllowRaw).toFixed(3)}`,
  );
  console.log(
    `At spec tau=0.97, semantic replay fires on ${allowRaw.filter((x) => x >= 0.97).length}/${allowRaw.length} must-ALLOW pairs.\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
