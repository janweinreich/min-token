# Routing Skill v1

> Generated 2026-07-24T22:44:17.011Z from policy v1. **Do not edit by hand** — this file is recompiled on every policy promotion, and every rule below is derived from a policy parameter or from measured routing episodes.

## Goal

Answer the question using the fewest generation tokens, **subject to** benchmark quality staying at or above 0.90. Quality is the constraint; tokens are what you minimize. Never trade quality for tokens — a cheaper answer that is wrong costs more than an expensive one.

## Decision procedure

Apply in order. The first rule that matches wins.

1. **Approved memory that passes every safety check** → replay it. Costs **0 generation tokens**. Requires masked similarity ≥ 0.62, raw similarity ≥ 0.35, an unambiguous margin ≥ 0.02, and a clean entity/operation/polarity/version gate. Never replay a temporal, personalized, or side-effecting question.
2. **Task is code or debug** → route to the coding model with 4 context chunks and up to 320 output tokens. Check this *before* considering abstention: code is generated, not looked up, so weak retrieval is not grounds to refuse.
3. **Top evidence score < 0.25 AND evidence coverage < 0.50** → abstain. Say the corpus is insufficient. Do not guess.
4. **Lean route** if all hold: question ≤ 240 chars, not temporal, no action intent, top evidence ≥ 0.45, cross-source gap ≥ 0.06, and the lean success lower bound ≥ 0.6. Send 2 chunks, ≤ 160 output tokens.
5. **Otherwise the strong route.** 4 chunks, ≤ 320 output tokens.

Chunks are truncated to 1200 characters. This is the highest-leverage number here: input is roughly 82% of the token budget, so evidence volume dominates cost far more than output caps do.

## What I have learned from traffic

| task class | n | lean tried | clean wins | success (lower bound) | mean tokens lean → strong | routing |
|---|---:|---:|---:|---:|---:|---|
| comparison | 30 | 11 | 8 | 0.44 | 275 → 847 | **skip lean** — go straight to strong |
| explanation | 34 | 4 | 3 | 0.29 | 380 → 779 | **skip lean** — go straight to strong |
| lookup | 92 | 47 | 45 | 0.85 | 304 → 744 | **use lean** |

Routing **comparison, explanation** straight to the strong model avoids the retry tax: a lean attempt that fails and escalates costs more than starting strong, because the repair reuses the larger context.

## Distilled model choice (training mode)

Learned by having **claude-sonnet-5** answer each question, having every cheaper model answer it too, and then having claude-sonnet-5 judge which cheap answers were good enough to ship. The cheapest accepted model is the right route.

| task class | n | use this model | accepted on | mean cost saving |
|---|---:|---|---:|---:|
| comparison | 2 | `claude-sonnet-5` _(too few examples — held at the reference)_ | 100% | 0% |
| explanation | 1 | `claude-sonnet-5` _(too few examples — held at the reference)_ | 100% | 0% |
| lookup | 4 | `gpt-5-nano` | 75% | 98% |
| unknown | 4 | `claude-haiku-4-5` | 100% | 58% |

A model is only recommended for a class when it was accepted on a **majority** of that class. Cheapest-ever-accepted would overfit to one lucky question and route the whole class to a model that usually fails.

**These rules are applied as a lookup, not read by a model.** Measured over 8 questions, paying a cheap model to read this table at request time cost 4,404 tokens more than it saved (0/8 wins): its overhead is fixed per request while its saving scales with answer length. See `artifacts/router-overhead.json`.

## Rules that are not negotiable

- Never replay a memory whose entities, operation, polarity, or version conflict with the question.
- Never abstain on a question the corpus can answer, even though abstaining is the cheapest route.
- Never shorten an answer below the length its facts require; brevity is not quality.
- Count every attempt, including failed and repaired ones, toward the token total.

