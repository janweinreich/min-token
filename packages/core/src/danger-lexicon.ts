/**
 * The closed danger lexicon.
 *
 * Measured fact (scripts/spike-embed.ts): raw cosine puts every must-REJECT
 * distractor ABOVE the must-ALLOW paraphrase (0.755 Python-swap vs 0.524
 * paraphrase). Cosine therefore cannot decide safety. It buys recall; THIS FILE
 * buys 100% of the precision.
 *
 * Closed-world by design: we only need to recognise the CLASS of a dangerous
 * token, never to parse the sentence. That turns an unsolvable NER problem into
 * a dictionary.
 */

export type DangerClass =
  | "language"
  | "product"
  | "packageManager"
  | "operation"
  | "descriptiveOperation"
  | "polarity"
  | "temporal"
  | "version"
  | "identifier"
  | "numeric";

export interface DangerToken {
  readonly cls: DangerClass;
  readonly value: string;
}

const LANGUAGES = [
  "javascript", "js", "typescript", "ts", "node", "nodejs", "python", "py",
  "python3", "java", "go", "golang", "rust", "ruby", "csharp", "php", "bash",
  "shell", "sql", "curl",
] as const;

const PRODUCTS = [
  "actian", "vectorai", "senso", "pioneer", "guild", "band", "replay",
  "postgres", "postgresql", "qdrant", "docker", "anthropic", "claude",
] as const;

const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "pip", "poetry", "cargo", "gem", "brew"] as const;

/**
 * Only MUTATING operations gate replay.
 *
 * The distinction is whether swapping the verb changes what the correct answer
 * IS. "install" vs "uninstall" and "create" vs "delete" are inverses — serving
 * one for the other is actively harmful. But "what port should I CONNECT to"
 * and "which port does it LISTEN on" are the same fact asked from two
 * directions, and gating on those verbs refused legitimate paraphrases while
 * buying no safety at all: the dangerous cases (a Python question hitting a
 * JavaScript memory) are already caught by language and ecosystem, not by verbs.
 *
 * Measured: treating descriptive verbs as dangerous cost real replay recall.
 */
const OPERATIONS = [
  "install", "uninstall", "upgrade", "downgrade", "create", "delete", "drop",
  "revoke", "publish", "deploy", "migrate", "rollback", "enable", "disable",
  "start", "stop",
] as const;

/**
 * Descriptive verbs. Extracted so they can be reported in traces, but NOT used
 * for the containment check.
 */
const DESCRIPTIVE_OPERATIONS = [
  "connect", "authenticate", "search", "query", "insert", "upsert", "configure",
  "read", "list", "get", "use", "call", "run",
] as const;

const POLARITY = ["not", "without", "never", "cannot", "cant", "avoid", "except", "instead"] as const;

const TEMPORAL = ["latest", "current", "newest", "today", "now", "recent", "price", "currently"] as const;

const PERSONAL = ["my account", "my workspace", "our private", "for user", "my org"] as const;

const ACTION_INTENT = ["delete", "publish", "send", "deploy", "drop", "revoke", "purge"] as const;

/**
 * DIRECTED coverage: memory value -> query values it may serve.
 * Asymmetry is the point. A JS answer serves a TypeScript question; a
 * TypeScript-specific answer does NOT serve a plain-JS question.
 */
const COVERS: Record<string, readonly string[]> = {
  javascript: ["javascript", "js", "typescript", "ts", "node", "nodejs", "npm", "pnpm", "yarn"],
  js: ["javascript", "js", "typescript", "ts", "node", "nodejs", "npm", "pnpm", "yarn"],
  typescript: ["typescript", "ts"],
  ts: ["typescript", "ts"],
  node: ["node", "nodejs", "javascript", "js"],
  nodejs: ["node", "nodejs", "javascript", "js"],
  python: ["python", "py", "python3", "pip", "poetry"],
  py: ["python", "py", "python3", "pip", "poetry"],
  python3: ["python", "py", "python3", "pip", "poetry"],
  actian: ["actian", "vectorai"],
  vectorai: ["actian", "vectorai"],
  postgres: ["postgres", "postgresql"],
  postgresql: ["postgres", "postgresql"],
};

/** Cross-ecosystem pairs that can never serve each other. */
const ECOSYSTEM: Record<string, string> = {
  javascript: "js", js: "js", typescript: "js", ts: "js", node: "js", nodejs: "js",
  npm: "js", pnpm: "js", yarn: "js",
  python: "py", py: "py", python3: "py", pip: "py", poetry: "py",
  ruby: "rb", gem: "rb",
  rust: "rs", cargo: "rs",
  go: "go", golang: "go",
  java: "jvm",
};

const WORD_SETS: Array<[DangerClass, readonly string[]]> = [
  ["language", LANGUAGES],
  ["product", PRODUCTS],
  ["packageManager", PACKAGE_MANAGERS],
  ["operation", OPERATIONS],
  ["descriptiveOperation", DESCRIPTIVE_OPERATIONS],
  ["polarity", POLARITY],
  ["temporal", TEMPORAL],
];

const RE_VERSION = /\bv?(\d+(?:\.\d+)+)\b/g;
const RE_SCOPED_PKG = /@[\w-]+\/[\w.-]+/g;
const RE_DOTTED_ID = /\b[A-Za-z_][\w]*(?:[.\/][\w.\/-]+)+\b/g;
const RE_NUMERIC = /\b\d+\b/g;

/** Extract every dangerous token present in a text. */
export function danger(text: string): DangerToken[] {
  const lower = ` ${text.toLowerCase().replace(/[^\w@./-]+/g, " ")} `;
  const out: DangerToken[] = [];
  const seen = new Set<string>();

  const push = (cls: DangerClass, value: string) => {
    const k = `${cls}:${value}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push({ cls, value });
    }
  };

  for (const [cls, words] of WORD_SETS) {
    for (const w of words) {
      if (lower.includes(` ${w} `)) push(cls, w);
    }
  }
  for (const m of text.matchAll(RE_SCOPED_PKG)) push("identifier", m[0].toLowerCase());
  for (const m of text.matchAll(RE_DOTTED_ID)) push("identifier", m[0].toLowerCase());
  for (const m of text.matchAll(RE_VERSION)) push("version", m[1]!);
  for (const m of text.matchAll(RE_NUMERIC)) push("numeric", m[0]!);

  return out;
}

export function valuesOf(tokens: DangerToken[], cls: DangerClass): Set<string> {
  return new Set(tokens.filter((t) => t.cls === cls).map((t) => t.value));
}

/** Expand a memory-side token set to everything it may serve. */
export function expand(values: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const v of values) {
    out.add(v);
    for (const c of COVERS[v] ?? []) out.add(c);
  }
  return out;
}

export function ecosystemOf(value: string): string | undefined {
  return ECOSYSTEM[value];
}

export function isTemporal(text: string): boolean {
  const l = ` ${text.toLowerCase()} `;
  return TEMPORAL.some((t) => l.includes(` ${t} `));
}

export function isPersonalized(text: string): boolean {
  const l = text.toLowerCase();
  return PERSONAL.some((p) => l.includes(p));
}

export function hasActionIntent(text: string): boolean {
  const l = ` ${text.toLowerCase().replace(/[^\w]+/g, " ")} `;
  return ACTION_INTENT.some((a) => l.includes(` ${a} `));
}

/**
 * Entity masking for the EMBEDDED text.
 *
 * Natural placeholder WORDS, never <ANGLE_BRACKETS> — MiniLM's wordpiece
 * tokenizer shreds those and the geometry gets worse, not better.
 *
 * Measured effect: lifts the worst must-ALLOW paraphrase 0.524 -> 0.655 and
 * collapses entity swaps to 1.000. The collapse is DELIBERATE: after masking the
 * vector measures question SHAPE, and entity identity is decided exactly, by the gate.
 */
const MASK_RULES: Array<[RegExp, string]> = [
  [new RegExp(`\\b(${LANGUAGES.join("|")})\\b`, "gi"), "the language"],
  [new RegExp(`\\b(${PRODUCTS.join("|")})\\b`, "gi"), "the platform"],
  [RE_SCOPED_PKG, "the package"],
  [new RegExp(`\\b(${PACKAGE_MANAGERS.join("|")})\\b`, "gi"), "the package manager"],
  [/\bv?\d+(?:\.\d+)+\b/g, "a version"],
];

export function maskEntities(text: string): string {
  let out = text;
  for (const [re, rep] of MASK_RULES) out = out.replace(re, rep);
  return out.replace(/\s+/g, " ").trim();
}
