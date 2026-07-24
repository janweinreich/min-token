/**
 * Measure the replay boundary for questions the danger lexicon cannot see.
 *
 * The lexicon is CLOSED and software-shaped (language, product, packageManager,
 * operation, surface). Once the agent started answering general-knowledge
 * questions, memory filled with pairs where the gate extracts NOTHING, so the
 * only evidence left is cosine similarity — and cosine alone put
 * "boiling point of water" and "freezing point of water" at 0.803, far above
 * the 0.62 replay threshold. That is a false replay: the worst failure here.
 *
 * This script asks whether a higher threshold separates real paraphrases from
 * opposites in that ungated regime, or whether ungated replay must simply be
 * refused. Run it before touching the threshold — the last threshold that was
 * set by intuition is the reason this bug exists.
 */
import { miniLmEmbedder } from "../packages/core/src/embeddings/minilm.js";
import { buildEmbeddingText } from "../packages/core/src/replay-guard.js";
import { danger, valuesOf, type DangerClass } from "../packages/core/src/danger-lexicon.js";

/** Must NOT replay: same topic, opposite or materially different question. */
const OPPOSITES: Array<[string, string]> = [
  ["What is the boiling point of water at sea level in Celsius?", "What is the freezing point of water at sea level in Celsius?"],
  ["What is the largest planet in the solar system?", "What is the smallest planet in the solar system?"],
  ["Which country has the highest population?", "Which country has the lowest population?"],
  ["What is the tallest mountain on Earth?", "What is the deepest ocean trench on Earth?"],
  ["How long does it take light to reach Earth from the Sun?", "How long does it take light to reach Mars from the Sun?"],
  ["What is the melting point of iron?", "What is the melting point of aluminium?"],
  ["When did the Second World War begin?", "When did the Second World War end?"],
  ["What is the fastest land animal?", "What is the fastest bird?"],
  ["How many bones are in the adult human body?", "How many bones are in a newborn human body?"],
  ["What is the capital of Australia?", "What is the largest city in Australia?"],
];

/** SHOULD replay: same question, different words. */
const PARAPHRASES: Array<[string, string]> = [
  ["What is the boiling point of water at sea level in Celsius?", "At sea level, what temperature does water boil at in Celsius?"],
  ["What is the largest planet in the solar system?", "Which planet in our solar system is the biggest?"],
  ["What is the tallest mountain on Earth?", "Which mountain on Earth is the highest?"],
  ["How many bones are in the adult human body?", "What is the number of bones an adult human has?"],
  ["What is the capital of Australia?", "Which city is Australia's capital?"],
  ["When did the Second World War begin?", "In what year did World War Two start?"],
  ["What is the fastest land animal?", "Which land animal can run the quickest?"],
  ["How long does it take light to reach Earth from the Sun?", "How many minutes does sunlight take to travel to Earth?"],
];

const GATED: DangerClass[] = ["language", "product", "packageManager", "operation", "surface"];

function gatedCount(q: string): number {
  const toks = danger(q);
  return GATED.reduce((n, c) => n + valuesOf(toks, c).size, 0);
}

async function cos(a: string, b: string): Promise<number> {
  const [x, y] = await miniLmEmbedder.embedBatch([buildEmbeddingText(a), buildEmbeddingText(b)]);
  if (!x || !y) throw new Error("embedder returned no vector");
  let d = 0;
  for (let i = 0; i < x.length; i++) d += x[i]! * y[i]!;
  return d;
}

async function main() {
  const opp: number[] = [];
  const par: number[] = [];

  console.log("\nMUST NOT replay (opposites / different question, same topic)");
  for (const [a, b] of OPPOSITES) {
    const s = await cos(a, b);
    opp.push(s);
    console.log(`  ${s.toFixed(3)}  gate-entities ${gatedCount(a)}/${gatedCount(b)}  ${a.slice(0, 44)}`);
  }

  console.log("\nSHOULD replay (true paraphrases)");
  for (const [a, b] of PARAPHRASES) {
    const s = await cos(a, b);
    par.push(s);
    console.log(`  ${s.toFixed(3)}  gate-entities ${gatedCount(a)}/${gatedCount(b)}  ${a.slice(0, 44)}`);
  }

  const worstLegit = Math.min(...par);
  const worstUnsafe = Math.max(...opp);
  console.log("\n─────────────────────────────────────────────────────────");
  console.log(`opposites      max ${worstUnsafe.toFixed(3)}  mean ${(opp.reduce((a, b) => a + b) / opp.length).toFixed(3)}`);
  console.log(`paraphrases    min ${worstLegit.toFixed(3)}  mean ${(par.reduce((a, b) => a + b) / par.length).toFixed(3)}`);
  console.log(
    worstLegit > worstUnsafe
      ? `SEPARABLE: a threshold in (${worstUnsafe.toFixed(3)}, ${worstLegit.toFixed(3)}) splits them. Margin ${(worstLegit - worstUnsafe).toFixed(3)}.`
      : `NOT SEPARABLE: opposites reach ${worstUnsafe.toFixed(3)} while a real paraphrase sits at ${worstLegit.toFixed(3)}.\n` +
        `  No cosine threshold can do this job. Ungated replay must be REFUSED, not retuned.`,
  );
  // How many legit paraphrases a "refuse ungated" rule would cost.
  const ungatedLegit = PARAPHRASES.filter(([a, b]) => gatedCount(a) === 0 && gatedCount(b) === 0).length;
  console.log(`cost of refusing ungated replay: ${ungatedLegit}/${PARAPHRASES.length} legit paraphrases lose their 0-token path`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
