# Routing Skill v1

> Generated 2026-07-24T21:58:36.693Z from policy v1. **Do not edit by hand** — this file is recompiled on every policy promotion, and every rule below is derived from a policy parameter or from measured routing episodes.

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
| lookup | 95 | 50 | 45 | 0.79 | 299 → 744 | **use lean** |
| unknown | 1 | 0 | 0 | 0.00 | – → 730 | _gathering evidence_ |

Routing **comparison, explanation** straight to the strong model avoids the retry tax: a lean attempt that fails and escalates costs more than starting strong, because the repair reuses the larger context.

## Rules that are not negotiable

- Never replay a memory whose entities, operation, polarity, or version conflict with the question.
- Never abstain on a question the corpus can answer, even though abstaining is the cheapest route.
- Never shorten an answer below the length its facts require; brevity is not quality.
- Count every attempt, including failed and repaired ones, toward the token total.

