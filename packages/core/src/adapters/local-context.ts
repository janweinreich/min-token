/**
 * Local knowledge retrieval over data/sources/*.md.
 *
 * The load-bearing detail is source IDENTITY, not retrieval quality. `contentId`
 * is a stable filename slug and `versionId` is a content hash, so:
 *
 *   - editing a source changes its versionId, which rolls the snapshot, which
 *     invalidates every memory bound to the old one — the knowledge-invalidation
 *     journey demos fully offline;
 *   - a remote knowledge API can later be adopted by storing ITS ids alongside
 *     the slug rather than replacing it, so citations and benchmark
 *     expectations survive the switch.
 *
 * Get this wrong and swapping the retrieval backend invalidates every stored
 * memory's citations and every benchmark expectation at once.
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { danger } from "../danger-lexicon.js";
import type { Embedder, KnowledgeRetriever, RetrievedChunk } from "../ports.js";

interface Chunk extends RetrievedChunk {
  vector?: number[];
  tokens: Set<string>;
}

const STOP = new Set([
  "the", "a", "an", "is", "are", "to", "of", "and", "or", "in", "on", "for",
  "with", "how", "do", "i", "it", "that", "this", "be", "as", "by", "at",
  "from", "what", "which", "you", "your", "can", "if", "not",
]);

function terms(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9@./_-]+/)
      .filter((t) => t.length > 1 && !STOP.has(t)),
  );
}

/** Split on `##` headings so a chunk is a coherent topic, then cap by size. */
function splitSections(md: string, maxChars: number): Array<{ title: string; text: string }> {
  const out: Array<{ title: string; text: string }> = [];
  const parts = md.split(/\n(?=## )/);
  for (const part of parts) {
    const heading = /^#{1,3}\s+(.+)$/m.exec(part)?.[1] ?? "untitled";
    const body = part.trim();
    if (!body) continue;
    if (body.length <= maxChars) {
      out.push({ title: heading, text: body });
      continue;
    }
    // Split oversized sections on blank lines rather than mid-sentence.
    let buf = "";
    for (const para of body.split(/\n\n+/)) {
      if (buf && buf.length + para.length > maxChars) {
        out.push({ title: heading, text: buf.trim() });
        buf = "";
      }
      buf += para + "\n\n";
    }
    if (buf.trim()) out.push({ title: heading, text: buf.trim() });
  }
  return out;
}

export class LocalContextProvider implements KnowledgeRetriever {
  readonly info = {
    name: "knowledge" as const,
    mode: "local" as const,
    label: "local corpus (data/sources)",
  };

  private chunks: Chunk[] = [];
  private contents: Array<{ contentId: string; versionId: string; title: string }> = [];

  constructor(
    private dir: string,
    private embedder: Embedder,
    private maxChars = 1200,
  ) {}

  async load(): Promise<{ sources: number; chunks: number; corpusHash: string }> {
    const files = (await readdir(this.dir)).filter((f) => f.endsWith(".md")).sort();
    this.chunks = [];
    this.contents = [];
    const hashes: string[] = [];

    for (const file of files) {
      const raw = await readFile(join(this.dir, file), "utf8");
      const contentId = basename(file, ".md"); // stable slug — never a generated uuid
      const versionId = createHash("sha256").update(raw).digest("hex").slice(0, 16);
      const title = /^#\s+(.+)$/m.exec(raw)?.[1] ?? contentId;
      this.contents.push({ contentId, versionId, title });
      hashes.push(`${contentId}:${versionId}`);

      splitSections(raw, this.maxChars).forEach((s, i) => {
        this.chunks.push({
          contentId,
          versionId,
          title: s.title,
          chunkIndex: i,
          text: s.text,
          score: 0,
          tokens: terms(s.text),
        });
      });
    }

    const vectors = await this.embedder.embedBatch(this.chunks.map((c) => `${c.title}\n${c.text}`));
    this.chunks.forEach((c, i) => (c.vector = vectors[i]));

    return {
      sources: files.length,
      chunks: this.chunks.length,
      corpusHash: createHash("sha256").update(hashes.join("|")).digest("hex").slice(0, 16),
    };
  }

  async searchContext(input: { query: string; maxResults: number }): Promise<RetrievedChunk[]> {
    const [qv] = await this.embedder.embedBatch([input.query]);
    const qt = terms(input.query);

    const scored = this.chunks.map((c) => {
      const dense = c.vector ? c.vector.reduce((s, v, i) => s + v * qv![i]!, 0) : 0;
      // Lexical boost: an exact package name or version is a much stronger signal
      // than sentence similarity, and a 384-dim model blurs precisely those.
      let overlap = 0;
      for (const t of qt) if (c.tokens.has(t)) overlap++;
      const lexical = qt.size ? overlap / qt.size : 0;
      return { ...c, score: 0.65 * dense + 0.35 * lexical };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, input.maxResults).map(({ tokens, vector, ...rest }) => rest);
  }

  async listContents() {
    return this.contents;
  }

  /**
   * Tokens the corpus actually talks about. Used to tell "asked about our docs and
   * we failed to retrieve" apart from "was never a docs question".
   */
  corpusTerms(): Set<string> {
    const out = new Set<string>();
    for (const c of this.chunks) {
      for (const t of danger(`${c.title} ${c.text}`)) {
        if (t.cls === "product" || t.cls === "identifier") out.add(t.value);
      }
    }
    return out;
  }

  async health() {
    return { ok: this.chunks.length > 0, latencyMs: 0 };
  }
}
