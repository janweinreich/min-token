# Sponsors — BudgetDarwin

| Sponsor | Adapter | Visible proof |
|---|---|---|
| Pioneer | [`src/adapters/pioneer.ts`](../src/adapters/pioneer.ts) | Event log `pioneer` + model/tier/$ |
| Senso | [`src/adapters/senso.ts`](../src/adapters/senso.ts) | Context in scoring; policy at `/api/darwin?view=policy` |
| Guild | [`src/adapters/guild.ts`](../src/adapters/guild.ts) | A/B decision + **Guild trace** link |
| Band | [`src/adapters/band.ts`](../src/adapters/band.ts) | Promote announce in log (`band` / cached) |
| Replay | QA process | Chip after `{ "action": "mark-replay" }` |

## Judge clicks

1. Run generation (twice if first is baseline-only).
2. Confirm **Saved vs premium** and **Memory hits** move on second run.
3. Open Guild trace from the log when decision is promote/reject.
4. Open **Routing policy** markdown.
5. Open **Answer memory** JSON.

## Replay (LoopQA)

Access code: `HACKATHON`  
MCP: `.mcp.json` → `loopqa` with `REPLAY_API_KEY`.

1. Deploy public URL.
2. Submit URL at qa.replay.io.
3. Fix ≥1 bug via recordings.
4. List bugs in README; mark Replay in UI.
