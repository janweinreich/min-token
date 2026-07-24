# BudgetDarwin - Full Application Build Plan

Version: 1.0
Purpose: Implementation handoff for a one-day self-evolving agents hackathon
Primary stack: TypeScript, Next.js, Fastify, PostgreSQL, Actian VectorAI DB, Senso, Pioneer, Guild

---

## 1. Executive build brief

### Product statement

BudgetDarwin is a developer-knowledge agent that learns how much compute each question deserves. It avoids paying twice for the same intelligence by reusing approved answers from Actian semantic memory, uses Senso as the verified source of truth for new questions, routes only genuinely difficult work to stronger Pioneer inference, and autonomously evolves its routing policy under a hard quality constraint.

### The demo claim

> BudgetDarwin preserves at least 90 percent benchmark quality while reducing generation tokens by at least 40 percent compared with an always-strong-model baseline.

### The key product behavior

1. A question arrives.
2. BudgetDarwin searches Actian for a previously approved answer to the same or a safely equivalent question.
3. If a safe memory is found, it returns that answer with zero LLM generation tokens.
4. If no safe memory exists, it retrieves verified source chunks from Senso.
5. A deterministic policy chooses a lean model, Pioneer Auto for coding tasks, or a stronger fallback.
6. A deterministic validator checks grounding, citations, structure, and benchmark facts.
7. Failed lean attempts may escalate once, using the same retrieved context.
8. The full episode is written to Actian so future routing improves.
9. A policy evolution cycle tests constrained mutations and promotes only candidates that pass the quality gate.
10. Guild exposes the application as a deterministic, versioned agent and provides the visible control-plane story.

### Sponsor roles

- Senso: verified, current knowledge context. Use the context-only search endpoint so Senso does not generate a second answer.
- Actian VectorAI DB: semantic answer memory and routing episode memory.
- Pioneer: lean and strong inference; use Pioneer Auto only for coding tasks because that router is currently coding-focused.
- Guild: deterministic agent wrapper, custom HTTP integration, sessions, versioning, and an externally visible evolution trigger.

### Scope decision

The initial domain is a developer copilot for the sponsor stack and the application itself. It answers questions such as:

- How do I install the Actian JavaScript SDK?
- What is the difference between a Guild coded agent and an LLM agent?
- Write a TypeScript function that queries Senso context and stores a successful result in Actian.
- How should the retry path count token cost?

This domain is deliberate. It gives the team stable source documents, objective facts, testable code questions, and a legitimate use for Pioneer's coding router.

---

## 2. Product contract

### Primary user

A developer or technical operator who asks repeated and paraphrased questions about a curated technical corpus.

### Core user need

The user wants a correct, grounded answer quickly. They do not care which model answered. The system should avoid expensive inference when it already possesses a trusted answer or when a smaller route is sufficient.

### Required outcomes

The complete application must demonstrate all of the following:

1. Exact repeated question returns from Actian memory with zero generation tokens.
2. Safe paraphrase returns from Actian memory with zero generation tokens.
3. A similar question with a changed critical constraint does not replay the wrong answer.
4. A new easy question uses a lean route.
5. A difficult coding question uses Pioneer Auto or the configured strong route.
6. A failed lean answer escalates at most once.
7. Every model attempt, including failed attempts, contributes to token and cost totals.
8. A changed Senso knowledge snapshot invalidates stale memories.
9. An evolution cycle proposes multiple policy mutations.
10. A passing mutation is promoted and affects subsequent live requests.
11. A quality-violating mutation is rejected or rolled back.
12. Guild can invoke answer and evolution operations through a custom integration.

### Success metrics

Primary metrics:

- Overall benchmark quality >= 0.90.
- Hard-case benchmark quality >= 0.85.
- Critical factual errors = 0.
- Token reduction versus actual always-strong baseline >= 40 percent.
- Direct replay precision >= 0.95.

Secondary metrics:

- Memory hit rate.
- Exact replay rate.
- Semantic replay rate.
- Model calls avoided.
- Retry tax.
- Average and p95 latency.
- Estimated cost reduction.
- Route distribution.
- Stale or unsafe replay attempts blocked.

### Non-goals for the hackathon build

- General web search.
- Arbitrary self-modifying code.
- Open-ended prompt rewriting.
- Fine-tuning a router during the event.
- A multi-agent conversation swarm.
- Fully automated approval of unknown live answers.
- Enterprise identity, billing, or multi-region deployment.
- A subjective LLM judge on every live request.

---

## 3. Product behavior and user journeys

### Journey A: exact replay

1. User asks: "How do I install the Actian JavaScript SDK?"
2. The answer is generated, validated, approved, and stored in Actian.
3. The same question is asked later.
4. BudgetDarwin embeds the normalized question locally and searches Actian.
5. The top result has the same normalized question, active knowledge snapshot, approved status, and valid quality score.
6. BudgetDarwin returns the stored answer and citations.
7. UI displays: `ACTIAN EXACT REPLAY - 0 generation tokens`.

### Journey B: semantic replay

Stored question:

> How do I install the Actian JavaScript SDK?

New question:

> Which npm package should I install to use Actian VectorAI from TypeScript?

The semantic score is above the active threshold, the query signatures agree on product and language, the memory is approved, and the knowledge snapshot is current. The prior answer is returned directly.

### Journey C: replay rejection because a constraint changed

Stored question:

> How do I install the Actian JavaScript SDK?

New question:

> How do I install the Actian Python SDK?

Even if vector similarity is high, the critical entity differs. The compatibility guard rejects replay and proceeds to Senso retrieval and generation.

### Journey D: easy new question

1. No safe memory exists.
2. Senso returns a high-confidence chunk from one source.
3. The query is a direct factual lookup, has no code, and historical lean-route success is high.
4. The policy selects `LEAN_RAG` with two context chunks and a short output budget.
5. The answer passes validation and is stored as a candidate memory.

### Journey E: difficult coding question

1. The query includes code or an implementation request.
2. No safe memory exists.
3. Senso returns relevant documentation chunks.
4. The policy selects `PIONEER_AUTO_CODE`.
5. The response is validated with required imports, expected API names, and optional executable tests.
6. The result and routing metadata are stored.

### Journey F: escalation without double retrieval

1. The policy selects `LEAN_RAG`.
2. The answer omits a required citation or fails the benchmark fact check.
3. The same Senso chunks are reused.
4. One repair or strong-model attempt is made.
5. Both attempts count toward the request's tokens and cost.
6. The episode records that similar questions should skip the lean route next time.

### Journey G: knowledge invalidation

1. A source is added or updated through the application's Senso ingestion workflow.
2. The app creates a new active `kb_snapshot_id`.
3. Actian searches are filtered to the new snapshot.
4. Old memories remain auditable but cannot be replayed.

### Journey H: self-evolution

1. Current policy is conservative and replays only near-exact matches.
2. The evolution engine creates bounded one-parameter mutations.
3. Candidates run against a frozen benchmark and frozen memory snapshot.
4. A candidate lowers the replay threshold slightly, improves token savings, and preserves quality.
5. Guild triggers the evolution operation.
6. The candidate is promoted to the active policy.
7. A later paraphrase uses the new threshold and replays safely.

---

## 4. System architecture

```text
+-------------------------+
| Next.js Web Application |
| Chat, Dashboard, Memory |
| Evolution, Benchmarks   |
+------------+------------+
             |
             | HTTPS / SSE
             v
+-------------------------+
| Fastify API             |
|                         |
| Request pipeline        |
| Router                   |
| Validator                |
| Token accounting         |
| Evolution engine         |
+----+----------+---------+
     |          |          \
     |          |           \
     v          v            v
+---------+ +-----------+ +-----------+
| Actian  | | Senso     | | Pioneer   |
| Answer  | | Verified  | | Inference |
| memory  | | context   | | and auto  |
| Episodes| |           | | routing   |
+---------+ +-----------+ +-----------+
     |
     v
+-------------------------+
| PostgreSQL              |
| Runs, attempts, policy, |
| benchmark, evolution    |
+-------------------------+

External control plane:

+-------------------------+
| Guild coded agent       |
| Custom HTTP integration |
| Sessions and versions   |
+------------+------------+
             |
             v
       Fastify API
```

### Why this split

- The frontend stays independent from agent orchestration.
- The API owns secrets, routing, token accounting, and all sponsor calls.
- Actian stores semantic memory, not relational reporting state.
- PostgreSQL provides reliable aggregation and version history.
- Guild calls a narrow authenticated HTTP surface and does not need external npm packages inside the agent runtime.
- Local embeddings keep memory lookup free of generation-token charges.

---

## 5. Request state machine

Every request must have a durable run record and move through explicit states.

```text
RECEIVED
  -> NORMALIZED
  -> EMBEDDED
  -> MEMORY_SEARCHED
      -> REPLAYED
      OR
      -> CONTEXT_RETRIEVED
          -> ROUTED
          -> GENERATED
          -> VALIDATED
              -> REPAIRED (optional, once)
          -> PERSISTED
  -> COMPLETED

Any state may move to FAILED with an error category.
```

Recommended run statuses:

- `received`
- `normalizing`
- `searching_memory`
- `retrieving_context`
- `routing`
- `generating`
- `validating`
- `repairing`
- `storing_memory`
- `completed`
- `failed`

Each transition should emit an event for the live trace UI.

---

## 6. Execution routes

### Route 0: `EXACT_REPLAY`

Use when:

- Stored normalized question equals the new normalized question.
- Memory is approved and replayable.
- Knowledge snapshot is current.
- Tenant, language, task type, and output format are compatible.
- Memory is not expired or revoked.

Generation tokens: 0.

### Route 1: `SEMANTIC_REPLAY`

Use when:

- Top Actian similarity is above the active policy threshold.
- Top-1 versus top-2 score margin is sufficiently large.
- Critical query signature fields are compatible.
- Memory is approved, current, nonvolatile, and replayable.
- The question is not personalized, temporal, or action-taking.

Generation tokens: 0.

### Route 2: `LEAN_RAG`

Use when:

- No safe direct replay exists.
- Query is a lookup or simple explanation.
- Senso top score is strong.
- Retrieved evidence is concentrated in one source.
- Similar Actian routing episodes show a high lean-route success rate.
- Query does not require substantial code or multi-source comparison.

Initial settings:

- Context chunks sent to model: 2.
- Maximum output tokens: approximately 120.
- One model call.
- No separate critic call.

### Route 3: `PIONEER_AUTO_CODE`

Use when:

- The task is coding, debugging, implementation, or refactoring.
- No safe memory exists.
- The feature classifier marks the request as code-related.

Use Pioneer's router-backed model alias only for coding tasks. Capture the selected model when the API response exposes it; otherwise retain the alias and use the Pioneer dashboard as the authoritative routing trace.

### Route 4: `STRONG_RAG`

Use when:

- Query requires synthesis across sources.
- Query is ambiguous or has low retrieval confidence.
- Historical lean success is low.
- Lean validation failed.
- The task is complex but is not a coding task suitable for Pioneer Auto.

Initial settings:

- Context chunks sent to model: 4.
- Maximum output tokens: approximately 260.
- One direct call or one repair after a lean attempt.

### Route 5: `ABSTAIN`

Use when:

- Senso returns no sufficient evidence.
- Required source scope is absent.
- A critical factual question cannot be grounded.

Return a concise statement that the verified corpus is insufficient. Do not guess.

---

## 7. Query normalization and signature extraction

### Normalization

Create two normalized values:

1. `normalized_for_exact_match`
2. `normalized_for_embedding`

Exact normalization should:

- Trim whitespace.
- Collapse repeated whitespace.
- Lowercase ordinary text.
- Preserve package names, versions, language names, code identifiers, URLs, and numeric values.
- Remove harmless terminal punctuation.
- Preserve code blocks exactly in a separate field.

Do not aggressively remove words. The words `Python`, `TypeScript`, `v1`, `latest`, and `delete` can change the meaning.

### Query signature

```ts
interface QuerySignature {
  language: string;
  domain: string;
  taskType:
    | "lookup"
    | "explanation"
    | "comparison"
    | "code"
    | "debug"
    | "action"
    | "unknown";
  productEntities: string[];
  packageEntities: string[];
  versionEntities: string[];
  codeLanguage?: string;
  requestedFormat: "concise" | "detailed" | "code" | "table" | "unknown";
  temporal: boolean;
  personalized: boolean;
  actionIntent: boolean;
  criticalConstraints: string[];
}
```

### Deterministic feature extraction

Do not call a model merely to classify the question. Use:

- Keyword dictionaries for sponsor products and programming languages.
- Regexes for package names and semantic versions.
- Code-fence detection.
- Intent verbs such as `implement`, `write`, `debug`, `compare`, `explain`, `install`.
- Temporal terms such as `latest`, `current`, `today`, `newest`, `price`, `available now`.
- Personalization terms such as `my account`, `my workspace`, `our private`, `for user`.
- Action verbs such as `delete`, `publish`, `send`, `create`, `deploy` when the request expects an external side effect.

The signature is a replay safety guard, not a perfect semantic parser.

---

## 8. Actian semantic memory design

### Collections

Create two collections with the same embedding dimension and cosine distance:

1. `answer_memory_v1`
2. `routing_episodes_v1`

Start with a 384-dimensional local sentence embedding model. Pin the model identifier and version in configuration. Never change the embedding model for an existing collection; create a new collection version if the embedding model changes.

### Collection A: `answer_memory_v1`

Vector content:

```text
normalized question
+ task type
+ critical entities
+ requested format
```

Payload:

```ts
interface AnswerMemoryPayload {
  memoryType: "approved_answer" | "candidate_answer";
  tenantId: string;
  scopeKey: string;

  originalQuestion: string;
  normalizedQuestion: string;
  querySignature: QuerySignature;

  answerText: string;
  citations: Array<{
    sourceId: string;
    versionId: string;
    title: string;
    chunkIndex?: number;
  }>;

  kbSnapshotId: string;
  embeddingModelId: string;

  status: "candidate" | "approved" | "revoked" | "stale";
  approvalReason?: "benchmark" | "admin" | "positive_feedback";
  replayable: boolean;
  volatile: boolean;
  qualityScore: number;
  citationScore: number;
  criticalFailure: boolean;

  answerFormat: string;
  language: string;
  taskType: string;

  sourceRoute: string;
  sourceModelId?: string;
  originalInputTokens: number;
  originalOutputTokens: number;
  originalCostUsd?: number;

  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  replayCount: number;
  positiveFeedbackCount: number;
  negativeFeedbackCount: number;
  invalidationReason?: string;
}
```

### Collection B: `routing_episodes_v1`

Vector content: normalized question and task signature.

Payload:

```ts
interface RoutingEpisodePayload {
  memoryType: "routing_episode";
  tenantId: string;
  runId: string;
  question: string;
  querySignature: QuerySignature;

  route: string;
  selectedModelId?: string;
  policyVersion: number;
  kbSnapshotId: string;

  passed: boolean;
  qualityScore: number;
  criticalFailure: boolean;
  failureReason?: string;

  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  repairTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  latencyMs: number;

  topMemoryScore?: number;
  topSensoScore?: number;
  repaired: boolean;
  betterRoute?: string;
  createdAt: string;
}
```

### Memory search filters

Before vector ranking, filter by:

- `tenantId` equals current tenant.
- `status` equals `approved` for direct replay.
- `kbSnapshotId` equals active snapshot.
- `language` equals request language.
- `replayable` equals true.
- `criticalFailure` equals false.

Return at most three candidates with payloads.

### Direct replay safety checks

All checks must pass:

1. Memory status is approved.
2. Quality score meets `minimumStoredQuality`.
3. Citation score meets its threshold.
4. Current and stored snapshot IDs match.
5. Memory is not expired.
6. Memory has no negative feedback.
7. Query is not temporal.
8. Query is not personalized.
9. Query does not request an external action.
10. Critical product, package, language, and version constraints are compatible.
11. Requested output format is compatible.
12. Similarity is above the current threshold.
13. Top result has enough score margin over the second result.

### Suggested initial thresholds

```json
{
  "semanticReplayThreshold": 0.97,
  "semanticReplayMargin": 0.03,
  "relatedMemoryThreshold": 0.90,
  "minimumStoredQuality": 0.92,
  "minimumCitationScore": 1.0,
  "maximumMemoryAgeDays": 30
}
```

Treat these as policy parameters, not universal truths.

### Candidate versus approved memory

Do not automatically replay every generated answer.

A newly generated answer should be stored as `candidate` unless one of these is true:

- It answered a labeled benchmark case and scored above the auto-approval threshold.
- An administrator approved it in the Memory page.
- It received explicit positive feedback and no conflicting signal.

Only approved memory may be returned directly. Candidate memory may influence route selection or appear as a nonauthoritative experience hint, but it is not the final answer.

### Knowledge snapshot invalidation

Maintain an active snapshot record in PostgreSQL. Each source ingestion or update creates a new snapshot containing the Senso content IDs and version IDs known to the application.

Every answer memory stores the active snapshot ID. Actian searches filter to the active snapshot. Old memories remain available for audit but are not replayable.

For the hackathon, all source changes should go through the application's ingestion script or Source Admin page so snapshot changes remain reliable.

### Actian failure behavior

If Actian is unavailable:

- Disable replay for that request.
- Continue with Senso and Pioneer.
- Mark `memory_status = unavailable`.
- Do not pretend a memory lookup succeeded.
- Store the routing episode later only if a retry queue exists; otherwise retain it in PostgreSQL.

---

## 9. Local embedding service

### Purpose

Actian stores and searches vectors. The application generates embeddings locally so memory lookup does not require an LLM generation call.

### Implementation

Use a Transformers.js-compatible sentence embedding model through a singleton service in the API process.

Responsibilities:

- Load model once at startup.
- Warm it with a sample query.
- Produce normalized Float32 vectors.
- Mean-pool and normalize if the model requires it.
- Expose model ID, version, and dimension.
- Cache recent embeddings by SHA-256 hash of normalized text.
- Reject insertion if produced dimension differs from collection dimension.

```ts
interface EmbeddingService {
  modelId: string;
  dimension: number;
  embed(text: string): Promise<number[]>;
}
```

### Operational rules

- Use the same model for insert and search.
- Pin the model and package version in the lockfile.
- Download model weights before the demo if network availability is uncertain.
- Track embedding latency separately from generation latency.
- Do not call the result "free"; describe it as zero generation tokens with local compute cost.

---

## 10. Senso integration

### Runtime use

Call the context-only endpoint rather than the answer-generation endpoint.

```text
POST /org/search/context
```

The API service should send:

```json
{
  "query": "the user question",
  "max_results": 4
}
```

Then choose how many returned chunks enter the model prompt:

- Lean route: top 2.
- Strong route: top 4.
- Replay route: no Senso call in the normal path, provided snapshot validity is trusted.

### Senso client interface

```ts
interface SensoContextChunk {
  contentId: string;
  versionId: string;
  chunkIndex: number;
  chunkText: string;
  score: number;
  title: string;
  vectorId?: string;
}

interface SensoClient {
  searchContext(input: {
    query: string;
    maxResults: number;
    contentIds?: string[];
  }): Promise<{
    chunks: SensoContextChunk[];
    totalResults: number;
    processingTimeMs: number;
  }>;
}
```

### Corpus setup

Prepare a curated corpus of approximately 15 to 25 pages, not hundreds of noisy pages. Include:

- Senso context/search documentation.
- Actian installation, JavaScript SDK, payload, and filtered search documentation.
- Guild coded-agent, custom-integration, sessions, and versioning documentation.
- Pioneer compatible inference and model-router documentation.
- An internal `BudgetDarwin Architecture Guide` written by the team.

### Ingestion

Support two setup paths:

1. Raw markdown/text through Senso raw ingestion.
2. File upload through Senso's presigned upload flow.

For a one-day build, prefer raw markdown ingestion from `data/sources`. It is simpler and easier to version. Poll ingestion completion before running the benchmark.

### Context budgeting

Before adding chunks to a prompt:

- Remove duplicated boilerplate.
- Retain title, source ID, version ID, and relevant chunk text.
- Truncate each chunk at a configured character or token limit.
- Keep source numbering stable.
- Do not include unused chunks.

### Senso failure behavior

If Senso returns no chunks or is unavailable:

- Direct memory replay may still proceed if snapshot validation is sound.
- New factual generation must abstain or use an explicitly marked fallback corpus.
- Do not generate an authoritative documentation answer without evidence.

---

## 11. Pioneer integration

### Model strategy

Configure three logical capabilities:

1. `leanModelId`: inexpensive fixed model for straightforward grounded answers.
2. `strongModelId`: more capable fixed model for synthesis and repair.
3. `pioneer/auto`: coding-only routed path.

Do not hard-code a model catalog from memory. At setup time, query the model listing endpoint and choose model IDs available to the team account. Persist the selected IDs in environment variables.

### Provider adapter

```ts
interface GenerateRequest {
  route: "LEAN_RAG" | "STRONG_RAG" | "PIONEER_AUTO_CODE";
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: number;
  temperature: number;
  requestId: string;
}

interface GenerateResult {
  text: string;
  modelAlias: string;
  selectedModelId?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCostUsd?: number;
  latencyMs: number;
  providerRequestId?: string;
  rawMetadata?: Record<string, unknown>;
}
```

### Prompt contract

Use a strict JSON response shape:

```json
{
  "answer": "concise grounded answer",
  "citations": ["source-1", "source-2"],
  "confidence": 0.0,
  "insufficient_context": false
}
```

System prompt requirements:

- Use only provided sources.
- Do not invent package names or methods.
- Cite source IDs exactly.
- Stay below the route word limit.
- If evidence is insufficient, set `insufficient_context` to true.
- Return JSON only.
- Do not expose hidden reasoning.

### Prompt order for caching

Keep the stable instructions first. Put changing question and evidence afterward. If the selected Pioneer-backed Anthropic model requires explicit cache markers, add them only after confirming the client and model support. Prompt caching is a bonus, not a dependency for the core demo.

### Retry behavior

- One transport retry for safe transient errors with short exponential backoff.
- One semantic repair attempt at most.
- Never run a second Senso retrieval during repair.
- Count all failed and repaired attempts.
- If Pioneer is unavailable, use the configured fallback provider only if one is available; otherwise return a transparent error.

### Pioneer Auto guard

Because Pioneer Auto is currently coding-focused, call it only when `taskType` is `code` or `debug`. General explanation and lookup tasks should use fixed model IDs through the compatible API.

---

## 12. Deterministic validator

### Live structural validation

For every generated answer:

1. Parse JSON.
2. Ensure `answer` is nonempty.
3. Ensure cited IDs exist in the retrieved Senso context.
4. Ensure no unknown source ID is cited.
5. Enforce maximum word or output size.
6. Enforce required answer format.
7. Detect obvious placeholder or truncated text.
8. For code, verify required imports or identifiers.
9. If `insufficient_context` is true, ensure the answer does not make unsupported claims.

### Benchmark validation

Benchmark cases provide stronger ground truth:

```ts
interface BenchmarkCase {
  id: string;
  setName: "dev" | "holdout" | "replay";
  question: string;
  taskType: string;
  requiredFacts: string[];
  requiredPatterns?: string[];
  forbiddenFacts: string[];
  referenceAnswer: string;
  expectedSourceIds: string[];
  maxWords: number;
  critical: boolean;
  codeTest?: {
    language: string;
    command: string;
    fixturePath: string;
  };
}
```

### Quality score

For non-code cases:

- Required fact coverage: 40 percent.
- Citation validity and expected-source coverage: 25 percent.
- Semantic similarity to reference answer using local embeddings: 15 percent.
- Format and length compliance: 10 percent.
- Completeness and abstention correctness: 10 percent.

For code cases:

- Required fact/API coverage: 25 percent.
- Citation validity: 15 percent.
- Executable or static code checks: 40 percent.
- Semantic/reference coverage: 10 percent.
- Format compliance: 10 percent.

Hard failure conditions:

- A forbidden critical fact appears.
- A critical code test fails.
- The answer cites a source that was not retrieved.
- The answer invents a known prohibited API name.

A hard failure sets `criticalFailure = true` and prevents policy promotion regardless of average score.

### Repair trigger

Repair if:

- JSON parsing fails.
- Citation validation fails.
- Required benchmark fact coverage is below the repair threshold.
- Critical code structure is missing.

Repair prompt includes the original evidence and a compact list of validation errors. Do not include the full failed answer unless necessary.

---

## 13. Routing policy

### Policy schema

```ts
interface RoutingPolicyConfig {
  semanticReplayThreshold: number;
  semanticReplayMargin: number;
  relatedMemoryThreshold: number;
  minimumStoredQuality: number;
  minimumCitationScore: number;
  maximumMemoryAgeDays: number;

  leanMinSensoScore: number;
  leanMinScoreGap: number;
  leanMinHistoricalSuccess: number;
  leanMaxQuestionChars: number;
  leanContextK: number;
  strongContextK: number;
  leanMaxOutputTokens: number;
  strongMaxOutputTokens: number;

  repairBelowQuality: number;
  maximumRepairAttempts: number;
  abstainBelowSensoScore: number;
}
```

### Initial policy

```json
{
  "semanticReplayThreshold": 0.97,
  "semanticReplayMargin": 0.03,
  "relatedMemoryThreshold": 0.90,
  "minimumStoredQuality": 0.92,
  "minimumCitationScore": 1.0,
  "maximumMemoryAgeDays": 30,

  "leanMinSensoScore": 0.86,
  "leanMinScoreGap": 0.06,
  "leanMinHistoricalSuccess": 0.88,
  "leanMaxQuestionChars": 240,
  "leanContextK": 2,
  "strongContextK": 4,
  "leanMaxOutputTokens": 120,
  "strongMaxOutputTokens": 260,

  "repairBelowQuality": 0.78,
  "maximumRepairAttempts": 1,
  "abstainBelowSensoScore": 0.45
}
```

### Router pseudocode

```ts
function chooseGenerationRoute(
  features: RequestFeatures,
  policy: RoutingPolicyConfig,
): "LEAN_RAG" | "PIONEER_AUTO_CODE" | "STRONG_RAG" | "ABSTAIN" {
  if (features.topSensoScore < policy.abstainBelowSensoScore) {
    return "ABSTAIN";
  }

  if (features.signature.taskType === "code" ||
      features.signature.taskType === "debug") {
    return "PIONEER_AUTO_CODE";
  }

  const leanCandidate =
    features.questionLength <= policy.leanMaxQuestionChars &&
    !features.signature.temporal &&
    !features.signature.actionIntent &&
    features.uniqueSourceCount <= 1 &&
    features.topSensoScore >= policy.leanMinSensoScore &&
    features.sensoScoreGap >= policy.leanMinScoreGap &&
    features.similarLeanSuccessRate >= policy.leanMinHistoricalSuccess;

  return leanCandidate ? "LEAN_RAG" : "STRONG_RAG";
}
```

### Historical route features from Actian

Retrieve similar routing episodes and compute:

- Lean success rate.
- Strong success rate.
- Average tokens by route.
- Average quality by route.
- Repair frequency.
- Cheapest historically successful route.

If similar lean attempts frequently require repair, go directly to the stronger route. This is how BudgetDarwin avoids retry tax.

---

## 14. Core request pipeline pseudocode

```ts
async function handleQuestion(input: AskRequest): Promise<AskResponse> {
  const run = await runs.create(input);
  const policy = await policies.getActive();
  const snapshot = await snapshots.getActive();

  try {
    const normalized = normalizeQuestion(input.question);
    const signature = extractQuerySignature(input.question, input);
    const queryVector = await embeddings.embed(
      buildEmbeddingText(normalized, signature),
    );

    await runEvents.emit(run.id, "memory.search.started");

    const answerCandidates = await answerMemory.search({
      vector: queryVector,
      tenantId: input.tenantId,
      kbSnapshotId: snapshot.id,
      language: signature.language,
      limit: 3,
    });

    const replay = evaluateReplaySafety({
      question: input.question,
      normalized,
      signature,
      candidates: answerCandidates,
      policy,
      snapshot,
    });

    if (replay.allowed) {
      const response = buildReplayResponse(run, replay, policy);
      await answerMemory.recordUse(replay.memoryId);
      await routingEpisodes.store(buildReplayEpisode(response));
      await runs.complete(run.id, response);
      return response;
    }

    const relatedEpisodes = await routingEpisodes.search({
      vector: queryVector,
      tenantId: input.tenantId,
      kbSnapshotId: snapshot.id,
      limit: 8,
    });

    const senso = await sensoClient.searchContext({
      query: input.question,
      maxResults: policy.strongContextK,
    });

    const features = buildRequestFeatures({
      input,
      normalized,
      signature,
      answerCandidates,
      relatedEpisodes,
      senso,
    });

    const route = chooseGenerationRoute(features, policy);

    if (route === "ABSTAIN") {
      const response = buildAbstention(run, senso, policy);
      await runs.complete(run.id, response);
      return response;
    }

    const firstAttempt = await executeGenerationAttempt({
      runId: run.id,
      route,
      question: input.question,
      context: selectContext(senso.chunks, route, policy),
      relatedMemory: replay.relatedMemory,
      policy,
    });

    let finalAttempt = firstAttempt;
    let validation = validateGeneratedAnswer(firstAttempt, senso.chunks, input);

    if (!validation.passed &&
        policy.maximumRepairAttempts > 0 &&
        route !== "STRONG_RAG") {
      finalAttempt = await executeRepairAttempt({
        runId: run.id,
        originalRoute: route,
        question: input.question,
        context: selectContext(senso.chunks, "STRONG_RAG", policy),
        errors: validation.errors,
        policy,
      });
      validation = validateGeneratedAnswer(finalAttempt, senso.chunks, input);
    }

    const response = buildGeneratedResponse({
      run,
      policy,
      snapshot,
      attempts: await attempts.forRun(run.id),
      finalAttempt,
      validation,
      senso,
    });

    await routingEpisodes.store(buildRoutingEpisode(response));

    if (validation.passed) {
      await answerMemory.storeCandidate({
        vector: queryVector,
        question: input.question,
        normalized,
        signature,
        response,
        snapshot,
      });
    }

    await runs.complete(run.id, response);
    return response;
  } catch (error) {
    await runs.fail(run.id, classifyError(error));
    throw error;
  }
}
```

---

## 15. Relational data model

Use PostgreSQL for operational state and reporting. Drizzle ORM is a reasonable TypeScript choice, but the schema should remain ordinary SQL-compatible.

### `source_snapshots`

- `id` text primary key
- `label` text
- `status` enum: active, archived, building
- `corpus_hash` text
- `content_versions` jsonb
- `created_at` timestamptz
- `activated_at` timestamptz nullable

### `policies`

- `id` uuid primary key
- `version` integer unique
- `parent_id` uuid nullable
- `status` enum: candidate, active, rejected, rolled_back, archived
- `config` jsonb
- `created_by` text
- `created_at` timestamptz
- `promoted_at` timestamptz nullable
- `promotion_reason` text nullable

### `runs`

- `id` uuid primary key
- `tenant_id` text
- `session_id` text nullable
- `question` text
- `normalized_question` text
- `query_signature` jsonb
- `status` text
- `route` text nullable
- `policy_id` uuid
- `kb_snapshot_id` text
- `answer` text nullable
- `citations` jsonb nullable
- `quality_score` numeric nullable
- `critical_failure` boolean default false
- `memory_id` text nullable
- `memory_similarity` numeric nullable
- `input_tokens` integer default 0
- `output_tokens` integer default 0
- `cache_read_tokens` integer default 0
- `cache_write_tokens` integer default 0
- `estimated_cost_usd` numeric nullable
- `baseline_tokens` integer nullable
- `tokens_avoided` integer nullable
- `latency_ms` integer nullable
- `error_category` text nullable
- `created_at` timestamptz
- `completed_at` timestamptz nullable

### `attempts`

- `id` uuid primary key
- `run_id` uuid foreign key
- `ordinal` integer
- `route` text
- `model_alias` text
- `selected_model_id` text nullable
- `prompt_hash` text
- `input_tokens` integer
- `output_tokens` integer
- `cache_read_tokens` integer
- `cache_write_tokens` integer
- `estimated_cost_usd` numeric nullable
- `latency_ms` integer
- `raw_response` jsonb nullable
- `validation` jsonb
- `created_at` timestamptz

### `run_events`

- `id` bigserial primary key
- `run_id` uuid
- `sequence` integer
- `event_type` text
- `payload` jsonb
- `created_at` timestamptz

### `feedback`

- `id` uuid primary key
- `run_id` uuid
- `rating` enum: positive, negative
- `correction` text nullable
- `created_at` timestamptz

### `benchmark_cases`

- `id` text primary key
- `set_name` text
- `question` text
- `task_type` text
- `required_facts` jsonb
- `required_patterns` jsonb
- `forbidden_facts` jsonb
- `reference_answer` text
- `expected_source_ids` jsonb
- `max_words` integer
- `critical` boolean
- `code_test` jsonb nullable
- `enabled` boolean

### `benchmark_runs`

- `id` uuid primary key
- `policy_id` uuid nullable
- `run_type` enum: baseline, candidate, incumbent, holdout
- `memory_fixture_id` text
- `status` text
- `metrics` jsonb nullable
- `started_at` timestamptz
- `completed_at` timestamptz nullable

### `benchmark_results`

- `id` uuid primary key
- `benchmark_run_id` uuid
- `case_id` text
- `run_id` uuid
- `score` numeric
- `critical_failure` boolean
- `breakdown` jsonb

### `evolution_cycles`

- `id` uuid primary key
- `incumbent_policy_id` uuid
- `candidate_policy_ids` jsonb
- `winning_policy_id` uuid nullable
- `decision` text
- `dev_metrics` jsonb
- `holdout_metrics` jsonb nullable
- `started_at` timestamptz
- `completed_at` timestamptz nullable

---

## 16. API contract

Use `/api/v1` for browser-facing endpoints and `/guild/v1` for Guild-facing operations. Both may call the same service layer.

### `POST /api/v1/ask`

Request:

```json
{
  "question": "How do I install the Actian JavaScript SDK?",
  "sessionId": "optional-session-id",
  "tenantId": "demo",
  "desiredFormat": "concise",
  "maxWords": 140,
  "mode": "live"
}
```

Response:

```json
{
  "runId": "uuid",
  "answer": "...",
  "citations": [
    {
      "id": "source-1",
      "title": "Actian JavaScript SDK installation",
      "contentId": "...",
      "versionId": "...",
      "score": 0.95
    }
  ],
  "route": "SEMANTIC_REPLAY",
  "selectedModelId": null,
  "quality": {
    "score": 0.98,
    "passed": true,
    "criticalFailure": false
  },
  "usage": {
    "inputTokens": 0,
    "outputTokens": 0,
    "cacheReadTokens": 0,
    "totalGenerationTokens": 0,
    "estimatedCostUsd": 0,
    "baselineTokens": 520,
    "tokensAvoided": 520
  },
  "memory": {
    "hit": true,
    "type": "semantic",
    "memoryId": "...",
    "similarity": 0.981,
    "checks": {
      "snapshot": "passed",
      "constraints": "passed",
      "volatility": "passed"
    }
  },
  "policy": {
    "id": "uuid",
    "version": 4
  }
}
```

### `POST /api/v1/ask/stream`

Use Server-Sent Events. Events:

- `run.started`
- `memory.search.started`
- `memory.search.completed`
- `memory.replay.accepted`
- `memory.replay.rejected`
- `senso.context.started`
- `senso.context.completed`
- `route.selected`
- `generation.started`
- `generation.token` optional
- `validation.completed`
- `repair.started`
- `memory.write.completed`
- `run.completed`
- `run.failed`

### `GET /api/v1/runs/:runId`

Return full run, attempts, events, sources, memory decision, and token accounting.

### `POST /api/v1/feedback`

```json
{
  "runId": "uuid",
  "rating": "positive",
  "correction": null
}
```

Positive feedback may approve a candidate memory only if structural validation already passed. Negative feedback revokes linked replay memory and creates a routing failure episode.

### `GET /api/v1/memories`

Filters:

- status
- taskType
- snapshotId
- minimumQuality
- query

### `POST /api/v1/memories/:id/approve`

Approve a candidate memory. Record actor and reason.

### `POST /api/v1/memories/:id/revoke`

Revoke memory immediately. It must not appear in future direct replay filters.

### `POST /api/v1/benchmarks/run`

```json
{
  "setName": "dev",
  "policyId": "active",
  "runType": "incumbent",
  "memoryFixtureId": "seed-v1"
}
```

### `GET /api/v1/benchmarks/:id`

Return progress, metrics, case-level results, quality, tokens, latency, and failures.

### `POST /api/v1/evolution/run`

```json
{
  "maxCandidates": 5,
  "autoPromote": true,
  "devSet": "dev",
  "holdoutSet": "holdout",
  "memoryFixtureId": "seed-v1"
}
```

### `GET /api/v1/evolution/:id`

Return incumbent, mutations, dev results, holdout results, winner, and decision.

### `GET /api/v1/policies/active`

Return active policy and latest evolution summary.

### `POST /api/v1/policies/:id/promote`

Manual promotion guarded by the same quality checks.

### `POST /api/v1/policies/:id/rollback`

Activate the prior known-good policy and record the rollback reason.

### `GET /api/v1/metrics/summary`

Parameters: time range, benchmark run, policy version.

### `POST /api/v1/sources/ingest-text`

Admin endpoint for raw markdown or text. After successful compilation, create and activate a new source snapshot.

### Health endpoints

- `GET /health`: process alive.
- `GET /ready`: Postgres, Actian, Senso key/config, Pioneer key/config, embedding model ready.
- `GET /api/v1/integrations/status`: per-integration health and last successful call.

---

## 17. Evolution engine

### Core principle

The agent evolves a small policy, not arbitrary application code. Mutations are bounded and testable.

### Mutable parameters

- Semantic replay threshold.
- Semantic replay score margin.
- Minimum stored quality.
- Lean Senso score threshold.
- Lean score-gap threshold.
- Lean historical success threshold.
- Lean context count.
- Lean output-token limit.
- Repair quality threshold.
- Maximum memory age.

### Candidate generation

Generate a neighborhood around the incumbent. Change only one parameter per candidate.

Example:

```text
Candidate A: replay threshold 0.97 -> 0.96
Candidate B: lean context 3 -> 2
Candidate C: lean output tokens 140 -> 120
Candidate D: lean historical success 0.90 -> 0.87
Candidate E: repair threshold 0.80 -> 0.77
```

### Bounds

Prevent unsafe values:

```text
semanticReplayThreshold: 0.90 to 0.995
semanticReplayMargin: 0.00 to 0.10
minimumStoredQuality: 0.88 to 1.00
leanContextK: 1 to 4
strongContextK: 3 to 6
leanMaxOutputTokens: 80 to 180
strongMaxOutputTokens: 180 to 400
maximumRepairAttempts: fixed at 1 for hackathon
```

### Fair evaluation

Benchmark evaluation must not leak answers across candidates.

- Use `mode = benchmark`.
- Disable live memory writes.
- Start every candidate from the same frozen Actian memory fixture.
- Use a dedicated replay test set with seeded approved memories.
- Do not insert holdout answers into memory.
- Run candidates against the same Senso snapshot.
- Use temperature 0 or the lowest supported deterministic setting.

### Two-stage selection

1. Run incumbent and candidates on the development set.
2. Reject any candidate below the development quality gate.
3. Rank passing candidates by actual token or cost reduction.
4. Run the best candidate and incumbent on the holdout set.
5. Promote only if the holdout gate also passes.

### Promotion gate

```ts
function canPromote(
  candidate: AggregateMetrics,
  incumbent: AggregateMetrics,
): boolean {
  return (
    candidate.overallQuality >= 0.90 &&
    candidate.hardQuality >= 0.85 &&
    candidate.criticalFailures === 0 &&
    candidate.replayPrecision >= 0.95 &&
    candidate.totalGenerationTokens <=
      incumbent.totalGenerationTokens * 0.97 &&
    candidate.p95LatencyMs <= incumbent.p95LatencyMs * 1.10
  );
}
```

The 3 percent minimum improvement avoids promoting noise.

### Rollback

Keep the previous active policy. If post-promotion live monitoring detects:

- critical error,
- replay complaint,
- quality drop below threshold,
- excessive failure rate,

then set the promoted policy to `rolled_back` and reactivate the previous version.

### Evolution event story

Store and display:

- Mutation.
- Before and after quality.
- Before and after tokens.
- Replay hit rate.
- Critical failures.
- Decision.
- Active policy version.

---

## 18. Benchmark design

### Dataset size

Create at least 36 cases:

- 10 direct factual lookups.
- 8 explanations or comparisons.
- 8 coding or debugging questions.
- 6 safe paraphrase replay cases.
- 4 unsafe near-match cases that must reject replay.

Suggested split:

- Development: 20.
- Holdout: 10.
- Replay safety: 6.

### Baseline

Run a real baseline before optimization:

```text
ALWAYS_STRONG_NO_MEMORY
```

Every benchmark case receives:

- Strong route.
- Four Senso chunks.
- Strong output budget.
- Same validation.

Persist actual input tokens, output tokens, quality, cost, and latency. Do not estimate the baseline from model pricing alone.

### BudgetDarwin comparison

Run the active policy with the same question set and same source snapshot. Include memory routes where the replay fixture intentionally contains prior approved answers.

### Token accounting

```text
actual_generation_tokens = sum(all attempt input tokens + output tokens)
retry_tax = sum(tokens from attempts whose answers were not returned)
baseline_generation_tokens = actual recorded baseline total
tokens_saved = baseline - actual
savings_percent = tokens_saved / baseline
```

Cache-read tokens should be shown separately. Do not hide repair calls.

### Example benchmark case

```json
{
  "id": "actian-install-js-01",
  "setName": "dev",
  "question": "What package installs the Actian JavaScript SDK?",
  "taskType": "lookup",
  "requiredFacts": ["@actian/vectorai-client"],
  "requiredPatterns": ["npm install"],
  "forbiddenFacts": ["actian-vectorai-client-python"],
  "referenceAnswer": "Install @actian/vectorai-client with npm.",
  "expectedSourceIds": ["actian-js-installation"],
  "maxWords": 80,
  "critical": true
}
```

### Replay safety cases

Include pairs such as:

- JavaScript SDK versus TypeScript wording: replay allowed.
- JavaScript SDK versus Python SDK: replay rejected.
- Stable installation question versus latest package version: replay rejected.
- General API explanation versus a request to delete data: replay rejected.

---

## 19. Frontend specification

### Page 1: Dashboard

KPI cards:

- Quality.
- Tokens per answer.
- Savings versus baseline.
- Memory hit rate.
- Model calls avoided.
- Current policy version.

Charts:

- Quality and tokens by policy version.
- Route distribution.
- Token breakdown by route.
- Memory hit rate over time.
- Retry tax.

Prominent evolution card:

```text
POLICY v6 PROMOTED
Mutation: semanticReplayThreshold 0.97 -> 0.96
Holdout quality: 93.1% -> 92.8%
Generation tokens: 18,420 -> 15,620
Critical failures: 0
Decision: PROMOTE
```

### Page 2: Chat

Required UI elements:

- Question input.
- Desired answer format selector.
- Submit button.
- Live trace timeline.
- Answer and clickable citations.
- Route badge.
- Selected model or alias.
- Quality badge.
- Token and cost summary.
- Memory decision details.
- Positive and negative feedback controls.

Example route badges:

- `ACTIAN EXACT REPLAY - 0 gen tokens`
- `ACTIAN SEMANTIC REPLAY - similarity 0.981`
- `LEAN RAG - 2 Senso chunks`
- `PIONEER AUTO - coding task`
- `STRONG RAG - repair`

### Page 3: Run detail

Show:

- Full event timeline.
- Query signature.
- Actian candidates and rejection reasons.
- Senso chunks and scores.
- Route feature values.
- Every model attempt.
- Validation errors.
- Final token accounting.
- Linked memory and routing episode IDs.

### Page 4: Memory explorer

Columns:

- Original question.
- Status.
- Quality.
- Snapshot.
- Replay count.
- Task type.
- Age.
- Feedback.

Actions:

- Search semantically.
- Approve candidate.
- Revoke memory.
- Inspect citations.
- View similar questions.
- Mark stale.

### Page 5: Evolution lab

Show:

- Active policy JSON.
- Start evolution button.
- Candidate mutation table.
- Development metrics.
- Holdout gate.
- Promotion or rejection reason.
- Rollback button.

### Page 6: Benchmark

Show:

- Baseline versus active policy summary.
- Per-case result table.
- Failed fact checks.
- Replay safety results.
- Token and latency totals.
- Download JSON results.

### Page 7: Integrations and health

Show:

- Senso status and active snapshot.
- Actian status and collection counts.
- Pioneer status and configured model aliases.
- Guild public API status.
- Embedding model and dimension.
- PostgreSQL status.

### Visual direction

Use a dark purple-blue interface inspired by the event artwork. Make route changes highly visible. The core visual is a graph where quality remains nearly flat while tokens fall across policy versions.

---

## 20. Repository structure

```text
budget-darwin/
  apps/
    web/
      app/
        page.tsx
        chat/page.tsx
        runs/[id]/page.tsx
        memory/page.tsx
        evolution/page.tsx
        benchmark/page.tsx
        integrations/page.tsx
      components/
      lib/api.ts
      package.json

    api/
      src/
        server.ts
        config.ts
        routes/
          ask.ts
          runs.ts
          feedback.ts
          memories.ts
          benchmarks.ts
          evolution.ts
          policies.ts
          sources.ts
          health.ts
          guild.ts
        services/
          request-pipeline.ts
          router.ts
          replay-safety.ts
          validator.ts
          token-accounting.ts
          evolution-engine.ts
          benchmark-runner.ts
          snapshot-service.ts
        integrations/
          senso-client.ts
          actian-client.ts
          pioneer-client.ts
          embedding-service.ts
        repositories/
          run-repository.ts
          policy-repository.ts
          benchmark-repository.ts
          answer-memory-repository.ts
          routing-episode-repository.ts
        prompts/
          grounded-answer.ts
          repair.ts
        types/
      package.json

  packages/
    shared/
      src/types.ts
      src/schemas.ts
    db/
      src/schema.ts
      src/client.ts
      migrations/
    eval/
      src/scorer.ts
      src/code-runner.ts
      src/fixtures.ts

  guild/
    agent/
      agent.ts
      guild.json
      package.json
    integration/
      openapi.yaml
      README.md

  data/
    sources/
      senso.md
      actian.md
      guild.md
      pioneer.md
      budgetdarwin-architecture.md
    benchmarks/
      dev.jsonl
      holdout.jsonl
      replay.jsonl
    memory-fixtures/
      seed-v1.jsonl

  infra/
    docker-compose.yml
    Dockerfile.api
    Dockerfile.web

  scripts/
    bootstrap-actian.ts
    ingest-senso.ts
    wait-for-senso.ts
    seed-database.ts
    seed-memory.ts
    run-baseline.ts
    run-benchmark.ts
    export-demo-results.ts

  docs/
    architecture.md
    demo-script.md
    incident-playbook.md

  .env.example
  pnpm-workspace.yaml
  package.json
  README.md
```

---

## 21. Environment configuration

```bash
NODE_ENV=development
PORT=4000
WEB_ORIGIN=http://localhost:3000

DATABASE_URL=postgresql://budgetdarwin:budgetdarwin@localhost:5432/budgetdarwin

ACTIAN_GRPC_URL=localhost:6574
ACTIAN_REST_URL=http://localhost:6573
ACTIAN_ANSWER_COLLECTION=answer_memory_v1
ACTIAN_EPISODE_COLLECTION=routing_episodes_v1

EMBEDDING_MODEL_ID=Xenova/all-MiniLM-L6-v2
EMBEDDING_DIMENSION=384

SENSO_BASE_URL=https://apiv2.senso.ai/api/v1
SENSO_API_KEY=

PIONEER_BASE_URL=https://api.pioneer.ai/v1
PIONEER_API_KEY=
PIONEER_LEAN_MODEL_ID=
PIONEER_STRONG_MODEL_ID=
PIONEER_AUTO_MODEL_ID=pioneer/auto

DEFAULT_TENANT_ID=demo
ACTIVE_KB_SNAPSHOT_ID=sponsor-docs-v1

INTERNAL_API_KEY=
GUILD_INTEGRATION_API_KEY=
PUBLIC_API_BASE_URL=

ENABLE_PIONEER_AUTO=true
ENABLE_PROMPT_CACHING=false
ENABLE_AUTO_PROMOTION=true
```

Do not expose any secret through the web client.

---

## 22. Local infrastructure

### Docker Compose services

- `postgres`
- `vectorai`
- optionally `api`
- optionally `web`

During rapid development, run API and web directly with `pnpm dev` and run only Postgres and Actian in Docker.

### Actian bootstrap

At API startup or through a script:

1. Health-check Actian.
2. Check whether collections exist.
3. Create missing collections with configured dimension and cosine distance.
4. Verify configured embedding dimension matches collection dimension.
5. Optionally create payload indexes for frequently filtered fields such as tenant, status, snapshot, and task type.

### Senso bootstrap

1. Read markdown files from `data/sources`.
2. Ingest each source through raw-text ingestion.
3. Poll until sources are queryable.
4. Store content IDs and version IDs.
5. Create and activate `sponsor-docs-v1` snapshot.
6. Run three smoke-test queries.

### Pioneer bootstrap

1. Validate API key.
2. List available models.
3. Verify selected lean and strong IDs.
4. Make one 10-token smoke request.
5. If coding auto route is enabled, make a tiny `pioneer/auto` coding request.
6. Record successful configuration in integration health.

---

## 23. Guild implementation

### Integration shape

Expose these authenticated operations:

- `POST /guild/v1/answer`
- `POST /guild/v1/evolve`
- `GET /guild/v1/policy`
- `GET /guild/v1/metrics`
- `GET /guild/v1/status`

Create an OpenAPI 3.1 file and import it into a Guild custom integration. Each endpoint becomes a typed tool.

### Local development requirement

Guild cannot call localhost or private addresses through a custom integration. Expose the API through a public HTTPS tunnel during development and use the tunnel URL as the integration base URL.

### Authentication

Use an API-key scheme. Guild stores and injects the key. The API expects a dedicated header such as:

```text
X-BudgetDarwin-Key: <secret>
```

### Guild agent

Use an auto-managed coded agent. It should not use an LLM to decide routing. It should deterministically inspect the command and call the corresponding BudgetDarwin tool.

Supported commands:

- Normal question -> call `answer`.
- `evolve` -> call `evolve`.
- `status` -> call `status`.
- `policy` -> call `policy`.
- `metrics` -> call `metrics`.

The response should surface route, quality, tokens, and policy version.

### Guild workflow

1. Install and authenticate the Guild CLI.
2. Initialize an auto-managed state agent.
3. Create the custom integration with the public base URL.
4. Import `guild/integration/openapi.yaml`.
5. Build and publish integration version 1.0.0.
6. Connect the API-key credential.
7. Import only the BudgetDarwin tools needed by the agent.
8. Test the agent.
9. Save, validate, and publish its version.
10. Use Guild sessions during the demo to show answer and evolution calls.

### Important accounting note

Guild sessions are the control-plane trace for custom tool calls. The BudgetDarwin application remains the source of truth for token usage from Pioneer calls made by the external API service. Do not imply that Guild independently measured those external token totals unless the calls were actually made through Guild's own LLM runtime.

---

## 24. Implementation workstreams

### Workstream A: infrastructure and integrations

Deliverables:

- Monorepo.
- Docker Compose.
- PostgreSQL schema and migrations.
- Actian collections.
- Senso client and ingestion script.
- Pioneer provider adapter.
- Environment validation.
- Health endpoints.

Acceptance:

- `pnpm dev` starts web and API.
- Actian health and search pass.
- Senso returns source chunks.
- Pioneer returns one structured response.
- PostgreSQL migration passes from a clean database.

### Workstream B: memory and routing core

Deliverables:

- Embedding singleton.
- Query normalization.
- Query signature extraction.
- Actian answer memory repository.
- Actian routing episode repository.
- Replay safety guard.
- Deterministic router.
- Historical route feature aggregation.

Acceptance:

- Exact question replays.
- Safe paraphrase replays.
- Python/JavaScript near-match is rejected.
- Stale snapshot is rejected.
- Failed route history changes later route selection.

### Workstream C: generation, validation, and accounting

Deliverables:

- Prompt builders.
- Lean, strong, and Pioneer Auto adapters.
- Structured response parser.
- Validator.
- Repair path.
- Attempt recording.
- Usage aggregation.

Acceptance:

- Invalid citation triggers repair.
- Only one repair attempt occurs.
- Token totals include both attempts.
- Response always contains route and usage metadata.

### Workstream D: benchmark and evolution

Deliverables:

- Benchmark JSONL schema.
- Seed cases.
- Scorer.
- Baseline runner.
- Frozen memory fixture.
- Candidate mutation generator.
- Dev and holdout evaluation.
- Promotion and rollback.

Acceptance:

- Baseline and active policy can be compared.
- Candidate evaluation does not write live memory.
- A passing policy promotes.
- A quality-violating policy rejects.
- Policy version affects the next live request.

### Workstream E: frontend

Deliverables:

- Chat with live trace.
- Dashboard KPIs and charts.
- Run detail.
- Memory explorer.
- Evolution lab.
- Benchmark page.
- Integration health.

Acceptance:

- A judge can see why a route was chosen.
- A memory replay visibly displays zero generation tokens.
- Evolution before/after metrics fit on one screen.
- All critical demo flows require no developer console.

### Workstream F: Guild and demo

Deliverables:

- Public tunnel.
- OpenAPI integration.
- Guild coded agent.
- Published version.
- Seeded demo questions.
- Demo script and backup recording.

Acceptance:

- Guild can ask a question.
- Guild can trigger an evolution cycle.
- Session shows operations and result.
- Demo can run from a clean browser session.

---

## 25. Suggested one-day team plan

Assume four builders and approximately ten focused hours.

### Roles

- Builder 1: API and sponsor integrations.
- Builder 2: Actian memory, validation, benchmark, evolution.
- Builder 3: frontend and visualizations.
- Builder 4: Guild, infrastructure, data, testing, demo production.

### Hour 0:00 to 0:30 - lock the contract

All:

- Confirm product scope.
- Confirm available credentials.
- Choose lean and strong Pioneer models.
- Assign owners.
- Freeze API request/response interfaces.
- Create repository and project board.

### Hour 0:30 to 1:30 - prove every sponsor connection

Builder 1:

- Senso context smoke call.
- Pioneer smoke call.

Builder 2:

- Start Actian.
- Create collections.
- Insert and search one point.

Builder 3:

- Scaffold dashboard and chat shell.
- Add mocked SSE timeline.

Builder 4:

- Start Postgres.
- Configure Guild CLI and workspace.
- Create tunnel.

Gate: no feature development continues until Senso, Actian, and Pioneer each have a successful real call.

### Hour 1:30 to 3:30 - complete the vertical slice

Builder 1:

- Implement Senso and Pioneer clients.
- Implement `/ask` route.

Builder 2:

- Implement embedding, Actian memory repository, and replay check.
- Implement initial router.

Builder 3:

- Connect chat to `/ask`.
- Display answer, route, source, and token fields.

Builder 4:

- Prepare source corpus.
- Ingest Senso docs.
- Seed first benchmark and memory examples.

Gate: ask a new question, store answer, ask again, and get a zero-generation replay.

### Hour 3:30 to 5:30 - quality and accounting

Builder 1:

- Implement structured prompts and repair route.
- Record provider usage.

Builder 2:

- Implement validator and benchmark scorer.
- Implement routing episodes and historical success feature.

Builder 3:

- Build run trace and dashboard KPIs.

Builder 4:

- Build Guild custom integration and coded agent.
- Test Guild answer operation.

Gate: failed lean attempt escalates once and all tokens are counted.

### Hour 5:30 to 7:30 - evolution loop

Builder 1:

- Improve error handling and integration status.

Builder 2:

- Build candidate generator, benchmark runner, promotion gate, and rollback.

Builder 3:

- Build evolution page and before/after chart.

Builder 4:

- Finish 36-case benchmark.
- Seed replay and unsafe near-match fixtures.

Gate: run an evolution cycle that promotes or rejects a candidate for a visible reason.

### Hour 7:30 to 8:45 - hardening

All:

- Run complete benchmark.
- Fix critical errors.
- Verify savings calculation.
- Test Actian, Senso, and Pioneer failure paths.
- Confirm stale snapshot rejection.
- Confirm exact and semantic replay.
- Confirm Guild evolution operation.

### Hour 8:45 to 10:00 - presentation

- Freeze features.
- Export final metrics.
- Rehearse demo twice.
- Record backup video.
- Clean repository.
- Add README architecture and setup.
- Capture sponsor-tool proof screenshots.

---

## 26. Prioritized issue backlog

### P0 - application must work

| ID | Issue | Estimate | Depends on |
|---|---|---:|---|
| P0-01 | Create pnpm workspace and app scaffolds | 30m | none |
| P0-02 | Docker Compose for Actian and Postgres | 30m | none |
| P0-03 | PostgreSQL schema and migration | 45m | P0-01 |
| P0-04 | Senso context client | 45m | P0-01 |
| P0-05 | Pioneer provider adapter | 60m | P0-01 |
| P0-06 | Local embedding singleton | 60m | P0-01 |
| P0-07 | Actian collection bootstrap | 30m | P0-02, P0-06 |
| P0-08 | Answer-memory repository | 60m | P0-07 |
| P0-09 | Routing-episode repository | 45m | P0-07 |
| P0-10 | Query normalization and signature | 45m | P0-01 |
| P0-11 | Replay safety guard | 60m | P0-08, P0-10 |
| P0-12 | Deterministic router | 60m | P0-09, P0-10 |
| P0-13 | Prompt builders and structured parser | 60m | P0-04, P0-05 |
| P0-14 | Validator and one-repair path | 75m | P0-13 |
| P0-15 | End-to-end request pipeline | 90m | P0-03 through P0-14 |
| P0-16 | Token and cost accounting | 45m | P0-05, P0-15 |
| P0-17 | Chat UI with route and usage badges | 90m | P0-15 |
| P0-18 | Dashboard KPI page | 75m | P0-16 |
| P0-19 | Benchmark schema and 20 initial cases | 90m | P0-04 |
| P0-20 | Baseline runner and scorer | 90m | P0-14, P0-19 |
| P0-21 | Policy mutation and promotion | 90m | P0-20 |
| P0-22 | Evolution UI | 60m | P0-21 |
| P0-23 | Guild OpenAPI integration | 60m | P0-15 |
| P0-24 | Guild coded agent | 60m | P0-23 |
| P0-25 | End-to-end demo fixtures | 60m | all core |

### P1 - full operator experience

| ID | Issue | Estimate | Depends on |
|---|---|---:|---|
| P1-01 | SSE live event stream | 60m | P0-15 |
| P1-02 | Run detail page | 60m | P1-01 |
| P1-03 | Memory explorer with approve/revoke | 90m | P0-08 |
| P1-04 | Source ingestion admin page | 90m | P0-04 |
| P1-05 | Snapshot activation and invalidation UI | 45m | P1-04 |
| P1-06 | Feedback approval/revocation workflow | 60m | P1-03 |
| P1-07 | Complete 36-case benchmark | 90m | P0-19 |
| P1-08 | Integration health page | 45m | sponsor clients |
| P1-09 | Rollback UI | 30m | P0-21 |

### P2 - production follow-up

- User authentication and tenant isolation.
- Postgres and Actian backups.
- Distributed worker queue.
- Rate limiting.
- PII redaction.
- Managed deployment.
- Source version synchronization independent of app ingestion.
- Advanced memory clustering and deduplication.
- Replay QA or browser testing integration.
- Adaptive feedback model.

---

## 27. Testing strategy

### Unit tests

- Normalization preserves versions and language names.
- Query signature extracts code language and temporal terms.
- Replay guard accepts safe paraphrase.
- Replay guard rejects changed package, version, or language.
- Replay guard rejects stale snapshot.
- Router selects lean, coding auto, strong, and abstain correctly.
- Token accounting includes repair attempts.
- Quality scorer handles required and forbidden facts.
- Candidate mutation respects bounds.
- Promotion gate rejects critical failures.

### Integration tests

- Actian create, upsert, search, filter, and payload update.
- Senso context response parsing.
- Pioneer structured response and usage parsing.
- PostgreSQL transaction when a run completes.
- Benchmark mode does not write live memory.
- Guild integration authenticates and reaches public API.

### End-to-end tests

1. New question -> generation -> candidate memory.
2. Approve memory -> exact replay.
3. Safe paraphrase -> semantic replay.
4. Unsafe near-match -> generation, not replay.
5. Lean failure -> one repair.
6. Snapshot bump -> previous memory rejected.
7. Evolution -> candidate promoted -> active policy version changes.
8. Guild asks question -> result returned.
9. Guild triggers evolution -> decision returned.

### Failure injection

- Stop Actian: request still generates.
- Invalid Senso key: new factual request abstains or errors transparently.
- Pioneer timeout: retry once, then fail cleanly.
- Pioneer invalid JSON: repair once.
- Postgres unavailable: fail request rather than return untracked generation in benchmark mode.
- Bad candidate policy: promotion rejected.

### Manual demo checklist

- Browser starts on Dashboard.
- Baseline metrics loaded.
- Memory seeded.
- Exact replay ready.
- Safe paraphrase ready.
- Unsafe near-match ready.
- Coding question ready.
- Evolution candidate ready.
- Guild session ready.
- Backup video available.

---

## 28. Observability and token accounting

### Per-run fields

- Run ID.
- Policy version.
- Snapshot ID.
- Route.
- Memory candidates and scores.
- Replay decision and failed checks.
- Senso scores and source IDs.
- Model alias and selected model when available.
- Input, output, cache read, and cache write tokens.
- Attempt latency.
- Total request latency.
- Quality breakdown.
- Repair reason.
- Estimated cost.
- Baseline comparison.

### Trace event example

```json
{
  "eventType": "memory.replay.rejected",
  "payload": {
    "topSimilarity": 0.944,
    "memoryId": "...",
    "reasons": [
      "critical_constraint_mismatch: javascript -> python"
    ]
  }
}
```

### Dashboard calculations

- `memory_hit_rate = replayed_requests / total_requests`
- `model_calls_avoided = replayed_requests`
- `retry_tax_tokens = tokens from nonfinal attempts`
- `average_quality = mean benchmark score`
- `token_savings_percent = (baseline - actual) / baseline`
- `replay_precision = correct replays / all direct replays`

### Logging rules

- Never log API keys.
- Avoid logging full user content in production mode unless explicitly enabled.
- Hash prompts for deduplication.
- Store source IDs and quality outcomes.
- Use structured JSON logs.

---

## 29. Security and safety

### Secrets

- Server-side only.
- Separate keys for local, demo, and production.
- Dedicated Guild integration key.
- Rotate any key shown on screen or committed accidentally.

### Memory safety

- Tenant and scope filters on every Actian query.
- Do not store passwords, API keys, or private credentials in memory.
- Redact likely secrets before memory insertion.
- Candidate and approved states.
- Revocation is immediate.
- Snapshot invalidation is mandatory.
- Action requests are never directly replayed as actions.

### Prompt-injection resistance

- Treat Senso chunks as evidence, not instructions.
- Put source text in clearly delimited blocks.
- System prompt says source content cannot override system rules.
- Restrict citations to retrieved IDs.
- Do not expose tools to the generative model; the deterministic pipeline owns all sponsor calls.

### API security

- CORS allowlist.
- Rate limit public endpoints.
- API key for Guild endpoints.
- Request size limits.
- Zod validation.
- Safe error messages.
- Timeout and circuit breaker around remote integrations.

---

## 30. Deployment plan

### Hackathon deployment

Recommended:

- Run Actian and Postgres in Docker on a laptop with sufficient memory.
- Run API and web locally.
- Expose API through an HTTPS tunnel for Guild.
- Use a second local browser or hosted static frontend only if needed.
- Pre-download embedding model weights.
- Pre-ingest Senso sources.

### Full deployment after the event

Use a single container-capable VM or managed container host:

- Reverse proxy with TLS.
- Web container.
- API container.
- PostgreSQL service or managed Postgres.
- Actian container with persistent volume.
- Regular database backups.
- Health checks and restart policies.

Avoid serverless-only platforms for the Actian process because it requires a persistent service and data volume.

### Deployment gate

Do not deploy until:

- Clean migration succeeds.
- Collections are created.
- Embedding dimension is verified.
- Source snapshot is active.
- Pioneer model IDs are valid.
- Guild public endpoint authenticates.
- Benchmark report is stored.

---

## 31. Risk register and fallbacks

### Risk: semantic replay returns the wrong answer

Mitigation:

- Conservative threshold.
- Score margin.
- Critical constraint comparison.
- Approved-only memory.
- Current snapshot filter.
- Replay safety benchmark.

Fallback: disable semantic replay and retain exact replay only.

### Risk: Pioneer Auto is used for noncoding tasks

Mitigation: hard route guard based on deterministic task type.

Fallback: use fixed Pioneer model IDs for all noncoding questions.

### Risk: Senso ingestion is not complete

Mitigation: ingest early, poll completion, prepare raw markdown files, and smoke-test queries.

Fallback: use already ingested corpus and do not demonstrate source updates live.

### Risk: Guild cannot reach local API

Mitigation: establish tunnel in the first hour and use a stable public URL.

Fallback: use a small hosted API instance or show prerecorded Guild session.

### Risk: Actian uses too much laptop memory

Mitigation: confirm Docker memory allocation before the event and keep collections small.

Fallback: run Actian on the strongest team laptop or a container VM.

### Risk: model response does not expose selected Pioneer route metadata

Mitigation: store model alias, provider request ID, and response model field when present; show the Pioneer dashboard for authoritative router detail.

Fallback: present route as `PIONEER_AUTO_CODE` and avoid claiming an exact selected model in the app.

### Risk: quality score is gamed by benchmark memory

Mitigation: frozen memory fixtures, no writes in benchmark mode, and a holdout set.

### Risk: token savings disappear after retries

Mitigation: include retry tax, learn historical failure routes, and route recurring hard classes directly to strong inference.

---

## 32. Demo script

### 0:00 to 0:20 - problem

Show baseline dashboard:

```text
Always-strong quality: 95.0%
Tokens per answer: 1,420
Memory hit rate: 0%
```

Say:

> Most agents pay the full intelligence cost every time, even when the answer already exists.

### 0:20 to 0:55 - Actian memory

Ask a seeded question, then a paraphrase.

Show:

```text
ACTIAN SEMANTIC REPLAY
Similarity: 0.981
Knowledge snapshot: current
Quality: 98%
Generation tokens: 0
Tokens avoided: 512
```

Say:

> Actian remembers verified work, so BudgetDarwin refuses to pay for the same intelligence twice.

### 0:55 to 1:25 - safety guard

Ask the Python variation of the JavaScript question.

Show replay rejection:

```text
Similarity: 0.944
Replay rejected
Reason: critical constraint changed from JavaScript to Python
```

Then show a grounded lean answer from Senso.

### 1:25 to 1:55 - hard-route quality

Ask a coding question. Show route:

```text
PIONEER AUTO - coding task
Senso chunks: 4
Quality: 96%
```

Say:

> Cheap is not the goal. Cheap when safe is the goal.

### 1:55 to 2:35 - self-evolution

Use Guild to trigger `evolve`.

Show candidate table and promotion:

```text
Replay threshold: 0.97 -> 0.96
Quality: 93.1% -> 92.8%
Tokens: 18,420 -> 15,620
Critical errors: 0
Decision: PROMOTE v6
```

### 2:35 to 3:00 - result

Show final graph:

```text
Quality: 92.8%
Token reduction: 47.3%
Model calls avoided: 31%
Critical errors: 0
```

Closing line:

> BudgetDarwin remembers high-quality work, spends compute only where it changes the answer, and evolves how aggressive it can be without crossing its quality floor.

---

## 33. Definition of done

The application is ready to submit when every statement below is true.

### Core pipeline

- [ ] New question produces a grounded answer with Senso citations.
- [ ] Exact replay returns from Actian with zero generation tokens.
- [ ] Safe paraphrase replay works.
- [ ] Unsafe near-match replay is blocked.
- [ ] Lean route works.
- [ ] Pioneer coding route works.
- [ ] Strong fallback works.
- [ ] Repair occurs at most once.
- [ ] All attempts are counted.

### Memory

- [ ] Candidate and approved states exist.
- [ ] Only approved memory replays.
- [ ] Snapshot mismatch blocks replay.
- [ ] Negative feedback revokes memory.
- [ ] Routing episodes affect later routing.

### Evolution

- [ ] Baseline is an actual recorded run.
- [ ] Dev and holdout sets exist.
- [ ] Benchmark mode does not write live memory.
- [ ] Candidate mutations are bounded.
- [ ] Promotion gate checks quality and critical failures.
- [ ] Rollback exists.
- [ ] Active policy version changes live behavior.

### UI

- [ ] Chat shows route and citations.
- [ ] Chat shows memory similarity and safety checks.
- [ ] Dashboard shows quality and token savings.
- [ ] Evolution page shows before and after.
- [ ] Run detail shows all attempts.
- [ ] Memory page can approve and revoke.

### Sponsor proof

- [ ] Senso context response is visible.
- [ ] Actian memory record and similarity search are visible.
- [ ] Pioneer route or inference metadata is visible.
- [ ] Guild session can answer and evolve.

### Submission

- [ ] Public repository is clean.
- [ ] README includes setup and architecture.
- [ ] Environment example contains no secrets.
- [ ] Three-minute video is recorded.
- [ ] Backup demo is recorded.
- [ ] Final benchmark JSON is committed or attached.

---

## 34. Official implementation references

Senso:

- https://docs.senso.ai/docs/concepts
- https://docs.senso.ai/docs/authentication
- https://docs.senso.ai/docs/hello-world

Actian VectorAI DB:

- https://docs.vectoraidb.actian.com/docs/installation/docker
- https://docs.vectoraidb.actian.com/sdks/javascript/installation
- https://docs.vectoraidb.actian.com/sdks/javascript/reference
- https://docs.vectoraidb.actian.com/docs/fundamentals/search/filtered-search-task
- https://docs.vectoraidb.actian.com/docs/fundamentals/payload/filter-payload-task

Pioneer:

- https://docs.pioneer.ai/concepts/router
- https://docs.pioneer.ai/api-reference/inference/openai-compatible
- https://docs.pioneer.ai/api-reference/inference/anthropic-compatible
- https://docs.pioneer.ai/api-reference/prompt-caching

Guild:

- https://docs.guild.ai/sdk/coded-agents
- https://docs.guild.ai/services/create-an-integration
- https://docs.guild.ai/platform/sessions
- https://docs.guild.ai/guide/versions
- https://docs.guild.ai/insights/usage

---

## 35. Final implementation principle

When tradeoffs arise, preserve this order:

1. Correctness and grounding.
2. Safe memory reuse.
3. Accurate accounting.
4. Visible evolution.
5. UI polish.
6. Additional features.

The benchmark, replay guard, and promotion gate are the actual product. The dashboard makes them understandable, but it must never substitute for measured behavior.
