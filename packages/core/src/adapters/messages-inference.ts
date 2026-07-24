/**
 * One inference adapter over the Anthropic-compatible Messages API.
 *
 * Verified live: Pioneer serves `claude-haiku-4-5`, `claude-sonnet-5` AND
 * `pioneer/auto` on POST /v1/messages, so lean, strong and code routes are the
 * same class with different model IDs. Anthropic-direct is the same class with a
 * different baseURL, which is why the zero-config fallback costs nothing.
 *
 * Deliberately raw fetch, not @anthropic-ai/sdk: Pioneer returns non-standard
 * top-level fields (pioneer_routed_model, pioneer_inference_id, pioneer_savings)
 * that a typed SDK response may drop, and those are the sponsor-proof.
 */
import type { GenerateRequest, GenerateResult, InferenceProvider, RouteAlias } from "../ports.js";

export interface MessagesConfig {
  baseUrl: string;
  apiKey: string;
  /** How the provider expects the key. Pioneer and Anthropic both accept x-api-key. */
  label: string;
  models: Record<RouteAlias, string>;
  /** Per-MTok rates for cost estimation, keyed by concrete model id. */
  rates?: Record<string, { input: number; output: number }>;
  maxRetries?: number;
  timeoutMs?: number;
}

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface RawResponse {
  content?: Array<{ type: string; text?: string }>;
  model?: string;
  usage?: RawUsage;
  stop_reason?: string;
  pioneer_routed_model?: string;
  pioneer_inference_id?: string;
  pioneer_savings?: unknown;
}

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

/**
 * Thinking is PINNED, and this is a benchmark-integrity control, not a style choice.
 *
 * claude-sonnet-5 runs adaptive thinking by DEFAULT and thinking tokens are billed
 * as output tokens; claude-haiku-4-5 does not think by default. Leaving both at
 * their defaults would make a strong-baseline-vs-lean-route comparison show a
 * large "token reduction" that is purely a thinking-config artifact rather than
 * anything our router did. Both arms must therefore carry the same setting.
 *
 * `effort` is NOT sent: it errors on claude-haiku-4-5. `temperature`/`top_p`/`top_k`
 * are NOT sent either — they are a 400 on claude-sonnet-5 and the Opus 5 family.
 */
export const PINNED_THINKING = { type: "disabled" as const };

export class MessagesInference implements InferenceProvider {
  readonly info;
  private cfg: Required<Pick<MessagesConfig, "maxRetries" | "timeoutMs">> & MessagesConfig;

  constructor(cfg: MessagesConfig) {
    this.cfg = { maxRetries: 2, timeoutMs: 60_000, ...cfg };
    this.info = {
      name: "inference" as const,
      mode: "live" as const,
      label: `${cfg.label} (lean=${cfg.models.lean}, strong=${cfg.models.strong}, code=${cfg.models["auto-code"]})`,
    };
  }

  private modelFor(alias: RouteAlias): string {
    return this.cfg.models[alias];
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const model = req.modelOverride ?? this.modelFor(req.alias);
    const started = Date.now();

    const system = [{ type: "text", text: req.system.stable }];
    if (req.system.volatile) system.push({ type: "text", text: req.system.volatile });

    const body: Record<string, unknown> = {
      model,
      max_tokens: req.maxOutputTokens,
      system,
      messages: [{ role: "user", content: req.user }],
      thinking: PINNED_THINKING,
    };

    let lastErr = "";
    for (let attempt = 0; attempt <= this.cfg.maxRetries; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.cfg.timeoutMs);
      req.signal?.addEventListener("abort", () => ac.abort(), { once: true });
      try {
        const res = await fetch(`${this.cfg.baseUrl}/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": this.cfg.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(body),
          signal: ac.signal,
        });

        if (!res.ok) {
          const text = await res.text();
          lastErr = `HTTP ${res.status}: ${text.slice(0, 300)}`;
          if (!RETRYABLE.has(res.status) || attempt === this.cfg.maxRetries) {
            throw new Error(lastErr);
          }
          const retryAfter = Number(res.headers.get("retry-after"));
          const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 400 * 2 ** attempt;
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }

        const json = (await res.json()) as RawResponse;
        const u = json.usage ?? {};
        // Absence of provider usage must never be silently treated as zero — a
        // benchmark row built on estimated usage is not publishable.
        const hasUsage = typeof u.input_tokens === "number" && typeof u.output_tokens === "number";

        return {
          text: (json.content ?? [])
            .filter((b) => b.type === "text")
            .map((b) => b.text ?? "")
            .join(""),
          modelAlias: req.alias,
          // Pioneer reports the model its router ACTUALLY selected; fall back to
          // the echoed model for fixed routes and Anthropic-direct.
          selectedModelId: json.pioneer_routed_model ?? json.model,
          inputTokens: u.input_tokens ?? 0,
          outputTokens: u.output_tokens ?? 0,
          cacheReadTokens: u.cache_read_input_tokens ?? 0,
          cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
          estimatedCostUsd: this.cost(json.pioneer_routed_model ?? json.model, u),
          latencyMs: Date.now() - started,
          providerRequestId: json.pioneer_inference_id,
          fromCache: false,
          usageSource: hasUsage ? "provider" : "estimated",
        };
      } catch (e) {
        lastErr = String(e);
        if (attempt === this.cfg.maxRetries) throw new Error(lastErr);
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error(lastErr || "generate failed");
  }

  private cost(model: string | undefined, u: RawUsage): number | undefined {
    const r = model ? this.cfg.rates?.[model] : undefined;
    if (!r) return undefined;
    const inTok = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    const cacheRead = u.cache_read_input_tokens ?? 0;
    return (
      (inTok * r.input + cacheRead * r.input * 0.1 + (u.output_tokens ?? 0) * r.output) / 1_000_000
    );
  }

  async health() {
    const t = Date.now();
    try {
      const res = await fetch(`${this.cfg.baseUrl}/models`, {
        headers: { "x-api-key": this.cfg.apiKey },
        signal: AbortSignal.timeout(10_000),
      });
      return { ok: res.ok, latencyMs: Date.now() - t, error: res.ok ? undefined : `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t, error: String(e).slice(0, 200) };
    }
  }
}

/** Pioneer: the sponsor path. Verified live on /v1/messages. */
export function pioneerInference(apiKey: string): MessagesInference {
  return new MessagesInference({
    baseUrl: process.env.PIONEER_BASE_URL ?? "https://api.pioneer.ai/v1",
    apiKey,
    label: "pioneer",
    models: {
      lean: process.env.PIONEER_LEAN_MODEL ?? "claude-haiku-4-5",
      strong: process.env.PIONEER_STRONG_MODEL ?? "claude-sonnet-5",
      "auto-code": "pioneer/auto",
    },
    // Pioneer's own published per-MTok rates (GET /v1/models), because Pioneer is
    // who bills. Covers the models its router has been observed to select, so a
    // routed call still reports a cost instead of "n/a".
    rates: {
      "claude-haiku-4-5": { input: 1, output: 5 },
      "claude-sonnet-5": { input: 2, output: 10 },
      "claude-sonnet-4-6": { input: 3, output: 15 },
      "gemini-3.1-flash-lite": { input: 0.25, output: 1.5 },
      "deepseek-ai/DeepSeek-V4-Pro": { input: 0.435, output: 0.87 },
      "deepseek-ai/DeepSeek-V4-Flash": { input: 0.14, output: 0.28 },
      "gpt-5-nano": { input: 0.05, output: 0.4 },
      "gpt-5.5": { input: 5, output: 30 },
      "zai-org/GLM-5.2": { input: 1.5, output: 4.5 },
    },
  });
}

/** Anthropic direct: identical class, different baseURL. Zero-config fallback. */
export function anthropicInference(apiKey: string): MessagesInference {
  return new MessagesInference({
    baseUrl: "https://api.anthropic.com/v1",
    apiKey,
    label: "anthropic",
    models: {
      lean: "claude-haiku-4-5",
      strong: "claude-sonnet-5",
      // Anthropic has no router; code falls back to the strong model and the
      // route label must NOT claim otherwise.
      "auto-code": "claude-sonnet-5",
    },
    // Anthropic first-party rates. Sonnet 5 is at its introductory $2/$10
    // through 2026-08-31; it reverts to $3/$15 after that.
    rates: {
      "claude-haiku-4-5": { input: 1, output: 5 },
      "claude-sonnet-5": { input: 2, output: 10 },
    },
  });
}
