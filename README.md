# mintoken

mintoken reduces LLM inference cost by choosing a model per request and reusing
approved answers when it is safe to do so. The application keeps the existing
chat and metrics interface while its backend uses the BudgetDarwin routing,
memory, training, and evaluation pipeline.

## Run locally

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open `http://localhost:3000`.

`PIONEER_API_KEY` enables live Pioneer inference. Without it, the core agent
falls back to the configured Anthropic provider. The UI state and default vector
store are process-local, so they reset when the server instance restarts.

## Application functionality

### Model routing

For a new question, mintoken classifies the task and applies its learned routing
rules. The current model ladder uses `gpt-5-nano` for inexpensive lookups,
`claude-haiku-4-5` for stronger general responses, `claude-sonnet-5` as the
reference model, and `pioneer/auto` for code-related requests.

The router can run in three modes:

- `off`: use the built-in deterministic classifier.
- `learned`: apply the distilled routing table with zero router tokens.
- `llm`: ask a small model to read the synthesized routing prompt and select a
  model. Router tokens are included in total usage, so routing overhead cannot
  be reported as savings.

The Hugging Face UI calls the `learned` mode through
`src/engine/core-loop.ts`.

### Answer memory and replay

Every question checks answer memory before model generation. Exact matches can
replay directly; semantic matches must pass similarity, margin, entity,
operation, polarity, version, snapshot, and approval checks.

An accepted replay returns before the inference provider is reachable. It
therefore uses zero generation tokens. If the replay guard cannot verify the
important differences between two questions, it refuses semantic replay and
generates a new answer instead.

### Training

`pnpm train` uses `claude-sonnet-5` as a reference, tests cheaper models on the
same questions, and records the cheapest acceptable model for each task class.
The accepted examples are distilled into `artifacts/routing-rules.json`, while a
reference model synthesizes `artifacts/router-prompt.md`.

`POST /api/train` runs the same process for one question and records the result
in `artifacts/learning-log.jsonl`. It returns the candidates, judge decisions,
winning model, training cost, rule changes, and whether the router prompt was
rewritten.

### Measurement

The API returns provider-reported token usage, selected model, route, latency,
estimated model cost, and savings against the measured always-strong baseline.
The Hugging Face UI adapter maps those values into its existing quality, cost,
memory, activity, and policy panels.

The committed 20-case routing benchmark measured:

| Strategy | Quality | Tokens |
|---|---:|---:|
| Lean only | 0.911 | 6,619 |
| Always strong | 0.937 | 15,291 |
| Router | 0.947 | 12,501 |

On that benchmark, the router used 18.2% fewer tokens than always strong.

The replay benchmark measured 1,360 tokens for cold requests and 393 tokens
after three of four paraphrased questions replayed, a 71.1% reduction. The
replay safety set passed 20 of 20 probes; its Wilson 95% lower bound is 0.839.

## Sponsor integrations

### Pioneer

Pioneer serves the models used for live answers and exposes the model and usage
data that mintoken records for each request. mintoken also calls Pioneer during
training to compare cheaper models against `claude-sonnet-5`, allowing the
system to move large volumes of suitable requests away from the reference
model instead of paying its rate by default.

### Senso

The Darwin evolution loop calls Senso's `/org/search/context` endpoint and puts
the returned source chunks into the generation prompt. Those chunks are also
used when scoring whether a cheaper policy remains above the configured quality
floor, preventing a cost reduction from being accepted solely because it used
fewer tokens. The current Hugging Face chat path uses the BudgetDarwin local
context provider; the Senso adapter remains available in `src/adapters/senso.ts`
for the batch evolution path.

### Guild

After a Darwin challenger batch, mintoken sends its baseline cost, challenger
cost, challenger quality, minimum quality, and maximum cost ratio into a Guild
agent-test session. A challenger is promoted only when it meets both thresholds,
so a large apparent saving cannot replace the active policy if quality falls
below the floor. The Guild step is implemented in the batch evolution path and
is not called by each Hugging Face chat request.

### Band

When Guild promotes a Darwin policy, mintoken posts the policy version, quality,
batch cost, and savings percentage to a Band operations chat. If no chat exists,
the adapter can create `mintoken ops`; if Band is unavailable, it records the
same message as a cached application event. Band is only called after a
promotion, not for normal questions or rejected challengers.

### Replay

The UI includes a Replay LoopQA action for recording that the deployed public
experience was tested. Separately, mintoken's replay guard decides whether a
stored answer can safely replace a new Pioneer call; accepted matches reduce
that request to zero generation tokens. The safety benchmark includes both
paraphrases that must replay and near-matches that must be rejected.

## API routes

| Route | Purpose |
|---|---|
| `POST /api/darwin` | Chat, session, reset, and Replay QA actions for the current UI |
| `POST /api/ask` | Direct BudgetDarwin question endpoint |
| `GET /api/status` | Learned rules, episodes, measured results, and training history |
| `POST /api/train` | Run one live model-distillation training example |
| `GET /api/skill` | Return the generated routing skill |

## Commands

| Command | Requires provider key | Purpose |
|---|---:|---|
| `pnpm dev` | For live inference | Start the development server |
| `pnpm build` | No | Create the production build |
| `pnpm test` | No | Run unit and integration tests |
| `pnpm replay-safety` | No | Evaluate replay-only safety probes |
| `pnpm measure-ungated` | No | Measure why ungated semantic replay is unsafe |
| `pnpm calibrate` | No | Measure embedding similarity behavior |
| `pnpm savings` | Yes | Compare cold generation with warm replay |
| `pnpm evolve` | Yes | Run the benchmark and policy promotion gate |
| `pnpm train` | Yes | Distill model choices into routing rules |
| `pnpm router-overhead` | Yes | Compare zero-token rules with LLM-based routing |

## Main implementation files

```text
app/agent.ts                         agent initialization, status, routing, usage
src/engine/core-loop.ts              BudgetDarwin-to-Hugging-Face UI adapter
packages/core/src/pipeline.ts        replay, retrieval, routing, generation
packages/core/src/replay-guard.ts    replay eligibility and safety checks
packages/core/src/router.ts          route selection and learned history
packages/core/src/evolution.ts       candidate evaluation and promotion gate
packages/core/src/eval/scorer.ts     quality and failure scoring
packages/core/src/train/             model comparison and rule distillation
src/adapters/                        Senso, Guild, Band, and Darwin Pioneer adapters
```
