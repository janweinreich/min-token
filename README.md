# BudgetDarwin

An agent that learns how much compute each question deserves — and refuses to pay twice for the same answer.

Three mechanisms, in order of how much they save:

1. **Replay** an already-approved answer when it is *provably* safe to. Zero generation tokens.
2. **Route** to the cheapest model that can actually handle the question, per task class.
3. **Evolve** its own routing policy against a benchmark, under a hard quality floor.

```bash
pnpm install
cp .env.example .env.local     # add PIONEER_API_KEY
pnpm dev                       # http://localhost:3000
```

Ask these three, in order — they are the whole product in thirty seconds:

| ask | what happens |
|---|---|
| *What package installs the Actian JavaScript SDK?* | generates · **246 tokens** on `claude-haiku-4-5` |
| *Which npm package do I need for Actian VectorAI from TypeScript?* | **replays · 0 tokens** (similarity 0.726) |
| *How do I install the Actian **Python** SDK?* | **refuses to replay** — `ecosystem_conflict: js→py` |

The right-hand panel shows why, for every request.

---

## Measured results

Every number here came from real Pioneer calls with provider-reported usage. Nothing is modelled.

**Routing** — 20 dev cases, scored against facts verifiable in the corpus:

| | quality | tokens |
|---|---:|---:|
| lean only | 0.911 | 6,619 |
| always-strong | 0.937 | 15,291 |
| **router** | **0.947** | **12,501** |

The router beats *both* fixed strategies on quality while spending **18.2% fewer tokens than always-strong**. Routing lookups cheap and comparisons expensive beats doing either uniformly.

**Replay** — same questions asked twice, paraphrased the second time:

```
cold  (all generated) : 1360 tokens
warm  (3/4 replayed)  :  393 tokens   -> 71.1% saved
```

**Replay safety** — 16 probes, 6 that must replay and 10 that must not: **16/16 correct**, Wilson 95% lower bound **0.806**. That bound is the ceiling for 16 probes; supporting a ≥0.95 claim needs roughly 80. We report the bound, not the point estimate.

Run them yourself: `pnpm replay-safety` (no API key, no network, milliseconds), `pnpm savings`, `pnpm evolve`.

---

## What is real, and what is not

Worth stating plainly, because the interesting parts are the limits.

**Real:** all token counts are provider-reported; the router runs on every request; replay safety is measured; quality comes from scoring answers a model actually produced.

**Not yet:** the benchmark is 20 dev / 8 holdout cases, which is small. It contains no abstain and no code cases, so two of the five routing rules are covered by unit tests but unmeasured end to end. The per-request "always-strong would have cost ~765" in the UI is an **estimate** from measured per-case averages — the header's benchmark comparison is the hard number.

**The evolution loop has promoted nothing so far, and that is the honest result.** Twice a candidate won on the dev set — once with *better* quality and 16% fewer tokens — and was then rejected by the holdout: quality 0.800 against the 0.900 floor, one critical failure, a single case collapsing to 0.250. Dev said ship it; held-out data said no. A loop that promotes nothing when nothing is safe is the gate working.

---

## How it works

**Replay is gated, not thresholded.** Sentence embeddings put the must-*reject* Python variant (0.755) *above* the must-*allow* paraphrase (0.524), so no similarity threshold separates them — the original spec's τ=0.97 fires on 1 of 3 legitimate paraphrases. So the question is embedded with entities **masked**, which measures question *shape* and gives recall, and a closed danger lexicon decides entity identity exactly, giving all of the precision. `packages/core/src/replay-guard.ts`.

**Routing history is per task class,** estimated with a Beta lower bound and a pessimistic prior. The cheap route must *earn* its way in over repeated clean successes rather than being trusted by default. `packages/core/src/router.ts`.

**The scorer is written adversarially,** because a token-minimizing search finds every weakness in the rubric it optimizes against. Two-sided length band (so shortening isn't free), rescaled similarity (so fluent nonsense scores 0), and omission-side hard failures — abstaining on an answerable question is a critical failure, since abstention is otherwise the global optimum. `packages/core/src/eval/scorer.ts`.

**The agent writes down what it learns.** `skills/routing/SKILL.md` is compiled from the promoted policy plus measured episodes, regenerated on every promotion, and verified against the real router before it is written — a skill that misdescribes the code is worse than none, because an agent would follow it.

```
packages/core/src/
  replay-guard.ts     masking, danger lexicon gate, replay decision
  router.ts           route selection, per-class Beta lower bound
  pipeline.ts         ask(): replay -> retrieve -> route -> generate
  policy.ts           the ~10 evolving numbers, with hard bounds
  evolution.ts        candidates, paired non-inferiority, promotion gate
  eval/scorer.ts      the adversarially-hardened rubric
  skill-synthesis.ts  compiles policy + episodes into the routing skill
```

## Scripts

| command | needs a key | what it does |
|---|---|---|
| `pnpm dev` | yes | the live app |
| `pnpm test` | no | 72 tests, incl. replay proven against a *throwing* generator |
| `pnpm replay-safety` | no | 16 probes, writes `artifacts/replay-safety.json` |
| `pnpm calibrate` | no | the cosine measurement the whole design rests on |
| `pnpm savings` | yes | cold-vs-warm token savings, with a safety control |
| `pnpm evolve` | yes | full evolution cycle, regenerates the skill |

## Stack

Pioneer for inference (`claude-haiku-4-5` lean, `claude-sonnet-5` strong, `pioneer/auto` for code — all on one Anthropic-compatible adapter). `Xenova/all-MiniLM-L6-v2` locally for embeddings, so memory lookup costs zero generation tokens. In-process vector index; Actian VectorAI is a drop-in behind the same port.
