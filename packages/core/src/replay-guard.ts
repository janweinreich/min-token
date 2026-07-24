/**
 * The replay safety guard. A false positive here returns a confidently wrong
 * answer, which is the worst failure this product can have.
 *
 * Architecture (inverted from the spec, on measured evidence):
 *   masked cosine  -> RECALL   (candidate generation only)
 *   this gate      -> PRECISION (100% of it)
 *
 * The spec paired tau=0.97 with the gate as a secondary sanity check. Measurement
 * showed the must-REJECT Python swap (0.755) outscores the must-ALLOW paraphrase
 * (0.524), so no threshold separates them and tau=0.97 fires on 1/3 legitimate
 * paraphrases. The gate must therefore be authoritative.
 */
import {
  danger,
  ecosystemOf,
  expand,
  hasActionIntent,
  isPersonalized,
  isTemporal,
  maskEntities,
  valuesOf,
  type DangerToken,
} from "./danger-lexicon.js";

export interface MemoryRecord {
  id: string;
  normalizedQuestion: string;
  answerText: string;
  answerFormat: string;
  language: string;
  status: "candidate" | "approved" | "revoked" | "stale";
  replayable: boolean;
  volatile: boolean;
  criticalFailure: boolean;
  qualityScore: number;
  citationScore: number;
  kbSnapshotId: string;
  embeddingModelId: string;
  extractorVersion: number;
  negativeFeedbackCount: number;
  expiresAt?: string;
  createdAt: string;
}

export interface ReplayPolicy {
  semanticReplayThreshold: number;
  semanticReplayMargin: number;
  asymmetricThresholdBump: number;
  minimumStoredQuality: number;
  minimumCitationScore: number;
  maximumMemoryAgeDays: number;
  rawCosineFloor: number;
}

/** Bump the extractor version whenever the lexicon or masking changes. */
export const EXTRACTOR_VERSION = 1;

export interface GateResult {
  ok: boolean;
  reasons: string[];
}

// ── Normalization ────────────────────────────────────────────────────────────

/**
 * Preserves package names, versions, language names and identifiers — the words
 * `Python`, `TypeScript`, `v1` and `delete` all change the meaning of a question.
 */
export function normalizeForExact(q: string): string {
  return q
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^\s*(hi|hey|hello|please|could you|can you|i'd like to know)\b[,\s]*/i, "")
    .replace(/[?!.]+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The string that gets embedded. MUST be identical at write and read time, and
 * MUST NOT include metadata (task type, entities, format) — concatenating those
 * adds a near-constant component to every vector, which raises the floor of all
 * pairwise cosines and makes tau meaningless. Metadata belongs in filters and
 * the gate, never in the geometry.
 */
export function buildEmbeddingText(question: string): string {
  return maskEntities(normalizeForExact(question));
}

// ── The gate ─────────────────────────────────────────────────────────────────

export interface GateInput {
  queryText: string;
  queryFormat?: string;
  queryLanguage?: string;
  memory: MemoryRecord;
}

export function gateCompatible(input: GateInput): GateResult {
  const { queryText, memory } = input;
  const reasons: string[] = [];
  const reject = (r: string) => reasons.push(r);

  // 0. Absolute blocks on the query itself. A temporal, personalized or
  //    side-effecting request is never served from memory regardless of score.
  if (isTemporal(queryText)) reject("query_temporal");
  if (isPersonalized(queryText)) reject("query_personalized");
  if (hasActionIntent(queryText)) reject("query_action_intent");

  const Dq = danger(queryText);
  // Memory side includes the ANSWER, not just the stored question. This is the
  // defense against the extractor missing an entity on the memory side: if the
  // query says "python" and the stored answer says "npm install", step 1 or 2 fires
  // even though the stored question never named a language.
  const Dm: DangerToken[] = [
    ...danger(memory.normalizedQuestion),
    ...danger(memory.answerText),
  ];

  // 1. Containment: every danger token the QUERY raises must be covered by memory.
  for (const cls of ["language", "product", "packageManager", "operation", "surface"] as const) {
    const q = valuesOf(Dq, cls);
    const m = expand(valuesOf(Dm, cls));
    for (const t of q) {
      if (!m.has(t)) reject(`uncovered_${cls}:${t}`);
    }
  }

  // 2. Ecosystem conflict, both directions.
  const qEco = new Set(
    [...valuesOf(Dq, "language"), ...valuesOf(Dq, "packageManager")]
      .map(ecosystemOf)
      .filter((x): x is string => !!x),
  );
  const mEco = new Set(
    [...valuesOf(Dm, "language"), ...valuesOf(Dm, "packageManager")]
      .map(ecosystemOf)
      .filter((x): x is string => !!x),
  );
  for (const a of mEco) {
    for (const b of qEco) {
      if (a !== b) reject(`ecosystem_conflict:${a}->${b}`);
    }
  }

  // 3. Operations — exact and directed. Verbs are where entity gates leak
  //    ("install" vs "uninstall" is a one-token swap that cosine cannot see).
  const qOps = valuesOf(Dq, "operation");
  const mOps = valuesOf(Dm, "operation");
  if (qOps.size > 0 && mOps.size === 0) reject("operation_unspecified_in_memory");

  // 4. Polarity — embeddings are negation-blind.
  // Polarity is read from the QUESTIONS only. Reading it from answer text made
  // "an LLM agent ... is not reproducible" look like a negated query and refused a
  // legitimate paraphrase. Negation matters in what was ASKED, not in prose.
  const qPol = valuesOf(Dq, "polarity").size > 0;
  const mPol = valuesOf(danger(memory.normalizedQuestion), "polarity").size > 0;
  if (qPol !== mPol) reject("polarity_mismatch");

  // 5. Versions. Memory pinned + query silent is ALLOWED (memory is snapshot-pinned).
  const qVer = valuesOf(Dq, "version");
  const mVer = valuesOf(Dm, "version");
  if (qVer.size > 0 && mVer.size === 0) reject("version_unpinned_in_memory");
  for (const v of qVer) {
    const major = v.split(".")[0];
    if (![...mVer].some((mv) => mv.split(".")[0] === major)) {
      reject(`version_major_mismatch:${v}`);
    }
  }

  // 6. Any numeric literal in the query must appear in memory.
  const mNum = valuesOf(Dm, "numeric");
  for (const n of valuesOf(Dq, "numeric")) {
    if (!mNum.has(n)) reject(`numeric_constraint:${n}`);
  }

  // 7. Format compatibility.
  const qf = input.queryFormat ?? "unknown";
  if ((qf === "code" || qf === "table") && memory.answerFormat !== qf) {
    reject(`format_mismatch:${qf}`);
  }

  // 8. Language of the request.
  if (input.queryLanguage && input.queryLanguage !== memory.language) {
    reject("request_language_mismatch");
  }

  return { ok: reasons.length === 0, reasons };
}

// ── Payload preconditions ────────────────────────────────────────────────────

export function memoryReplayable(
  m: MemoryRecord,
  policy: ReplayPolicy,
  activeSnapshotId: string,
  now = new Date(),
): GateResult {
  const reasons: string[] = [];
  if (m.status !== "approved") reasons.push(`status:${m.status}`);
  if (!m.replayable) reasons.push("not_replayable");
  if (m.volatile) reasons.push("volatile");
  if (m.criticalFailure) reasons.push("critical_failure");
  if (m.negativeFeedbackCount > 0) reasons.push("negative_feedback");
  if (m.qualityScore < policy.minimumStoredQuality) reasons.push("below_min_quality");
  if (m.citationScore < policy.minimumCitationScore) reasons.push("below_min_citation");
  if (m.kbSnapshotId !== activeSnapshotId) reasons.push("stale_snapshot");
  if (m.extractorVersion !== EXTRACTOR_VERSION) reasons.push("extractor_version_drift");
  if (m.expiresAt && new Date(m.expiresAt) <= now) reasons.push("expired");

  const ageDays = (now.getTime() - new Date(m.createdAt).getTime()) / 86_400_000;
  if (ageDays > policy.maximumMemoryAgeDays) reasons.push("too_old");

  return { ok: reasons.length === 0, reasons };
}

// ── The full decision ────────────────────────────────────────────────────────

export interface Candidate {
  memory: MemoryRecord;
  cosMasked: number;
  cosRaw: number;
}

export type ReplayDecision =
  | { allowed: true; memory: MemoryRecord; kind: "exact" | "semantic"; similarity: number; margin: number }
  | { allowed: false; rejections: Array<{ memoryId: string; reasons: string[] }> };

/**
 * Two memories with materially the SAME answer must not cancel each other via the
 * margin check — that was a real defect in the spec, where near-duplicate good
 * memories collapsed the margin and wrongly refused replay.
 */
function answerEquivalent(a: MemoryRecord, b: MemoryRecord): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return norm(a.answerText) === norm(b.answerText);
}

export function evaluateReplay(input: {
  queryText: string;
  queryFormat?: string;
  queryLanguage?: string;
  candidates: Candidate[];
  policy: ReplayPolicy;
  activeSnapshotId: string;
  /** Hard-disable semantic replay when the embedder is not semantic. */
  semanticEnabled: boolean;
  now?: Date;
}): ReplayDecision {
  const { queryText, candidates, policy, activeSnapshotId } = input;
  const now = input.now ?? new Date();
  const rejections: Array<{ memoryId: string; reasons: string[] }> = [];
  const normQuery = normalizeForExact(queryText);

  const passing: Candidate[] = [];
  for (const c of candidates) {
    const pre = memoryReplayable(c.memory, policy, activeSnapshotId, now);
    const gate = gateCompatible({
      queryText,
      queryFormat: input.queryFormat,
      queryLanguage: input.queryLanguage,
      memory: c.memory,
    });
    const reasons = [...pre.reasons, ...gate.reasons];
    if (reasons.length > 0) rejections.push({ memoryId: c.memory.id, reasons });
    else passing.push(c);
  }

  if (passing.length === 0) return { allowed: false, rejections };

  // Exact replay: normalized questions match. Vector-independent, so it survives
  // a degraded embedder.
  const exact = passing.find((c) => c.memory.normalizedQuestion === normQuery);
  if (exact) {
    return { allowed: true, memory: exact.memory, kind: "exact", similarity: 1, margin: 1 };
  }

  if (!input.semanticEnabled) {
    rejections.push({ memoryId: "*", reasons: ["semantic_replay_disabled_non_semantic_embedder"] });
    return { allowed: false, rejections };
  }

  passing.sort((a, b) => b.cosMasked - a.cosMasked);
  const top = passing[0]!;

  // Asymmetric threshold: raise the bar when the MEMORY commits to entities the
  // query never mentions (memory more specific than the question).
  //
  // Defaults to 0, deliberately. Because the embedded text is entity-MASKED, the
  // vector carries no entity information, so bumping tau on entity differences
  // re-litigates what the gate already decides exactly — and a genuine paraphrase
  // almost always uses different words, so the bump fires nearly always. Measured:
  // a bump of 0.10 pushed tau to 0.72 and rejected the 0.655 paraphrase that is
  // the entire point of semantic replay. Left as a policy knob for the evolution
  // engine to explore under bounds, not as a default.
  const qKnown = new Set(danger(queryText).map((t) => `${t.cls}:${t.value}`));
  const mKnown = new Set(danger(top.memory.normalizedQuestion).map((t) => `${t.cls}:${t.value}`));
  const memoryMoreSpecific = [...mKnown].some((k) => !qKnown.has(k));
  const tau =
    policy.semanticReplayThreshold + (memoryMoreSpecific ? policy.asymmetricThresholdBump : 0);

  const reasons: string[] = [];
  if (top.cosMasked < tau) reasons.push(`below_threshold:${top.cosMasked.toFixed(3)}<${tau.toFixed(3)}`);
  // Nonsense floor on the UNMASKED vector: masking collapses shape, so without
  // this a totally unrelated question with the same shape could clear tau.
  if (top.cosRaw < policy.rawCosineFloor) {
    reasons.push(`raw_cosine_floor:${top.cosRaw.toFixed(3)}<${policy.rawCosineFloor}`);
  }

  // Margin measured only against MATERIALLY DIFFERENT competitors.
  const competitors = passing.slice(1).filter((c) => !answerEquivalent(top.memory, c.memory));
  const margin = competitors.length > 0 ? top.cosRaw - competitors[0]!.cosRaw : 1;
  if (margin < policy.semanticReplayMargin) {
    reasons.push(`ambiguous_margin:${margin.toFixed(3)}`);
  }

  if (reasons.length > 0) {
    rejections.push({ memoryId: top.memory.id, reasons });
    return { allowed: false, rejections };
  }

  return {
    allowed: true,
    memory: top.memory,
    kind: "semantic",
    similarity: top.cosMasked,
    margin,
  };
}

/** Derived from the measured cosine distribution, not guessed. See scripts/calibrate.ts. */
export const DEFAULT_REPLAY_POLICY: ReplayPolicy = {
  // Measured floor for a legitimate paraphrase is 0.655 (masked); 0.62 leaves headroom.
  semanticReplayThreshold: 0.62,
  semanticReplayMargin: 0.02,
  asymmetricThresholdBump: 0,
  minimumStoredQuality: 0.92,
  minimumCitationScore: 1.0,
  maximumMemoryAgeDays: 30,
  rawCosineFloor: 0.35,
};
