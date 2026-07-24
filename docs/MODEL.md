# Model — BudgetDarwin

## Goal

```text
quality ≥ 0.90
cost_usd(batch) ≤ 0.60 × cost_usd(always_premium_baseline)
```

## State

See `DarwinState` in [`src/engine/types.ts`](../src/engine/types.ts).

| Field | Meaning |
|---|---|
| `tasks[]` | Fixed grounded Q&A batch |
| `baseline` | Once-per-session always-premium measurement |
| `policy` / `challenger` | Current vs experimental route genome |
| `memory[]` | Answer memory records (prompt → solution) |
| `generations[]` | Per-loop quality / cost / memory hits |
| `events[]` | Append-only sponsor-tagged log |

## Loop

1. If baseline unset → run all tasks on premium (memory off).
2. Run challenger batch (memory on): lookup → else Senso context → Pioneer infer → score → store memory.
3. Guild A/B: promote if quality floor + cost ratio met.
4. On promote: set policy, Band announce, write policy markdown citeable.
5. Else mutate challenger (nudge short tasks cheaper; raise tier if quality failed).

## Scoring

`scoreAnswer` in [`src/engine/score.ts`](../src/engine/score.ts): fraction of `must_include` tokens present in the answer, plus a small boost when Senso hits also contain those tokens.

## Answer memory

Normalize question → exact / substring match in store → reuse answer at **$0** compute cost. New Pioneer answers are upserted when quality is better or equal.
