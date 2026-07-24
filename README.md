# BudgetDarwin (`min-token`)

tokens& Self-Evolving Agents Hackathon — Jul 24, 2026 · SF  
Repo: https://github.com/janweinreich/min-token

Routes each question across Pioneer **cheap / mid / premium**, scores against Senso ground truth, promotes cheaper policies with Guild, announces on Band, and **reuses prior answers from memory** so repeat questions cost $0 compute.

**Goal:** quality ≥ 90% · cut batch cost ≥ 40% vs always-premium.

Plan: [WIN_PLAN.md](./WIN_PLAN.md) · Model: [docs/MODEL.md](./docs/MODEL.md) · Sponsors: [docs/SPONSORS.md](./docs/SPONSORS.md)

---

## Run

```bash
cp .env.example .env
# fill keys (see Missing keys below)

npm install
npm run dev
# http://localhost:3000
```

**Deploy:** connect this GitHub repo to Vercel (root = repo root). Set the same env vars in the Vercel project.

### Demo clicks

1. **Run generation** — measures always-premium baseline, then runs a challenger with memory on.
2. Watch **Saved vs premium** and **Memory hits**.
3. On Guild **promote**, open **Routing policy** and the Guild trace link in the log.
4. Turn **Autopilot** on for unattended loops.
5. **Answer memory** JSON: `/api/darwin?view=memory`

---

## Sponsors

| Tool | Job |
|---|---|
| Pioneer | Tiered inference + $ estimate |
| Senso | Ground-truth context + policy citeable |
| Guild | A/B promote / reject with session trace |
| Band | Ops announce on promote |
| Replay | QA the deployed UI (mark via API after pass) |

Fail-soft: missing keys still run the demo with local answers / local Guild decisions / cached Band.

---

## Answer memory

Stored prompts → solutions live in:

- seed: [`src/data/answer-memory.seed.json`](src/data/answer-memory.seed.json)
- runtime: `src/data/answer-memory.runtime.json` (gitignored; in-memory on Vercel warm instances)

Lookup runs **before** Pioneer. Hits show in the Memory hits metric and event log (`source: memory`).

---

## Missing keys checklist

Copy from your other hackathon `.env` if you have it.

| Variable | Needed for |
|---|---|
| `PIONEER_API_KEY` | Live inference (else offline answers) |
| `PIONEER_MODEL_CHEAP` / `_MID` / `_PREMIUM` | Real tier split (else defaults) |
| `SENSO_API_KEY` | Live truth search |
| `GUILD_API_KEY` + `GUILD_WORKSPACE_ID` | Live Guild sessions |
| `GUILD_POLICY_AGENT_ID` (+ version) | Optional; falls back to organizer ids |
| `BAND_TOM_API_KEY` or `BAND_AGENT_API_KEY` | Live Band announce |
| `BAND_PUBLIC_CHAT_ID` | Stable ops chat (else creates one) |
| `REPLAY_API_KEY` | LoopQA MCP only |

After Replay QA on the public URL, `POST /api/darwin` `{ "action": "mark-replay" }` lights the Replay chip.

---

## Submit

1. Public GitHub (this repo)
2. Working Vercel URL
3. 3-minute demo video
4. Tools used: Pioneer, Senso, Guild, Band, Replay
