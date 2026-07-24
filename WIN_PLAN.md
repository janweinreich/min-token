# BudgetDarwin — win plan (min-token)

**Repo:** [janweinreich/min-token](https://github.com/janweinreich/min-token) · branch `main`  
**Event:** tokens& Self-Evolving Agents Hackathon — Fri Jul 24, 2026 · submit 4:30 PDT  
**Product:** BudgetDarwin (shipped as this repo)

---

## Sponsor stack (no new tools required)

**Use the same hackathon five you already have keys for.** Do not add Actian or payment rails on the critical path.

| Sponsor | Role in BudgetDarwin | Visible proof | Prize path |
|---|---|---|---|
| **Pioneer** | Multi-tier inference (`cheap` / `mid` / `premium`) | Per-trial model id + $ + latency | Best Pioneer ($500) |
| **Senso** | Ground-truth KB, score answers, store trials, publish **Routing Policy vN** → cited.md | Score hits + cited.md URL | Best Senso (credits) |
| **Guild** | A/B evaluate challenger vs current policy; promote/reject as traced session | Guild trace link on promote | Guild pool ($2k) |
| **Band** | Ops announce on promote (“cost −42%, quality 91%”) | Feed labeled Band | Best Band ($1k) |
| **Replay** | QA the FinOps SaaS control plane; fix ≥1 bug | Badge + bugs-fixed note | Replay pool ($3k) |

**Out (locked):**
- **Actian** — trial memory lives in Senso (`darwin-trials` folder), not a second vector DB
- **x402 / MPP / CDP / agentic.market** — save-money product; skip payments unless spare time after freeze
- **Influence Integrity Lab / Turtle society** — lives in other repos (`agentic-society` / `minus-tokens`); not this product

**Keys:** copy from existing `.env` (Pioneer, Senso, Guild, Band, Replay). Add only tier model vars:

```bash
PIONEER_MODEL_CHEAP=
PIONEER_MODEL_MID=
PIONEER_MODEL_PREMIUM=
```

---

## One-sentence pitch

BudgetDarwin is an autonomous agent that continuously A/B-tests how it routes work across Pioneer models, scores answers against a Senso ground-truth KB, and promotes cheaper routes only when quality holds — cutting spend while you watch.

---

## Value prop

| | |
|---|---|
| **Primary** | **Save money** — ≥40% lower $/batch vs always-premium baseline |
| **Secondary** | **Save time** — autopilot evolves routing; no human picking models |
| **Soft third** | Publish evolved routing policy to **cited.md** (challenge “publish” beat) |

**Standing goal:** quality ≥ **0.90** (mean Senso-grounded score) AND cost ≤ **60%** of always-premium baseline (≥40% savings).

---

## Why this wins

| Criterion | How we hit it |
|---|---|
| **Idea** | Real FinOps pain: agents overpay by sending every call to the biggest model |
| **Autonomy** | Autopilot loop: route → answer → score → remember → mutate → Guild A/B → promote |
| **Technical** | Multi-tier Pioneer routing, grounded scoring, policy genome evolution, live $ graph |
| **Tool use** | All 5 sponsors have a non-decorative click |
| **Presentation** | One graph + one promote + live loop tick in 3 minutes |

**Uniqueness:** quality scored against **verified Senso docs** (not LLM-as-judge); evolution is **Guild-traced promote**; artifact is a **citeable routing policy**.

---

## Product loop

```text
goal → run eval batch → route via policy → Pioneer infer
  → Senso score → write trial to Senso → propose cheaper challenger
  → Guild A/B → promote? → Band announce + publish policy to cited.md → repeat
```

**Autonomy UI:** Autopilot toggle (judges watch ≥2 generations). Manual **Run generation** for controlled demo beats.

### Route genome (what evolves)

```text
RoutePolicy = {
  version,
  default_tier: cheap | mid | premium,
  rules: [{ when: task_features, use: tier, max_tokens }],
  explore_rate,
  promoted_at?,
  metrics: { quality, cost_usd, latency_ms, n }
}
```

Cost = tokens × Pioneer catalog $/1M (fail-soft relative weights 1 / 3 / 10).

### Workload

12–20 grounded Q&A tasks from a seeded Senso truth KB (`services/senso-kb/darwin-truth/`).  
Score = citation/fact overlap vs Senso context hits (0–1), fail-soft keyword checklist.

---

## Greenfield architecture (this repo)

Build Next.js App Router from scratch in `min-token`. Optionally copy fail-soft adapter *patterns* from `minus-tokens` / `agentic-society` — do not port the Lab sim.

```text
Browser (FinOps control plane)
  → Next.js App Router
     → engine: policy + trial + score + loop + metrics
     → Pioneer  — tiered infer
     → Senso    — score + trials + cited.md policy
     → Guild    — A/B + promote traces
     → Band     — ops announce
     → Replay   — QA only
```

### Target tree

```text
min-token/
  README.md                 # product + demo + submit
  WIN_PLAN.md               # this file
  docs/MODEL.md             # state, scoring, mutation rules
  docs/SPONSORS.md          # wiring + judge click paths
  .env.example
  .mcp.json                 # Band / Guild / Replay placeholders
  services/
    senso-kb/darwin-truth/  # ground-truth docs
    guild-agents/
      policy_ab_eval/
      policy_promote/
  src/
    app/page.tsx
    app/api/darwin/route.ts
    components/DarwinApp.tsx
    components/BuiltWithStrip.tsx
    engine/{types,loop,score,policy,metrics,seed}.ts
    adapters/{pioneer,senso,guild,band}.ts
    lib/store.ts
```

### API (`/api/darwin`)

- `GET` → full `DarwinState`
- `POST` `{ action: "run-generation" | "toggle-autopilot" | "reset" | "mark-replay" }`

### UI (Darwin control plane)

- Brand **BudgetDarwin** + goal line (≥90% quality · −40% cost)
- Metrics: Quality, $/batch, $ saved vs baseline, Latency
- Generation history: quality vs cost
- Policy card (current genome + version)
- Event log with sponsor sources + Guild traces
- Controls: Autopilot, Run generation, Reset
- Built-with strip (5 sponsors)

---

## Day schedule → 4:30 submit

| Window | Ship | Verify |
|---|---|---|
| **Now–11:40** | Scaffold Next.js + `DarwinState` + empty DarwinApp + goal metrics | Page loads as BudgetDarwin |
| **11:40–12:20** | Pioneer multi-tier `infer` + cost; seed 12 tasks | 3 live calls logged |
| **12:20–1:00** | Senso score + truth seed; always-premium baseline | Scores in [0,1]; baseline $ set |
| **1:00–1:30** | Lunch stagger; finish `loop.ts` mutate/challenger | One gen E2E offline |
| **1:30–2:15** | Guild A/B + Band on promote | Trace link + Band label |
| **2:15–2:45** | Autopilot + chart + policy card | 2 unattended gens |
| **2:45–3:15** | Publish policy → cited.md (or in-app artifact) | URL or clear publish event |
| **3:15–3:45** | Deploy; Replay QA; fix ≥1 bug | Public URL + bugs note |
| **3:45–4:15** | Demo video + README polish + submit form | Submitted |
| **4:15–4:30** | Freeze; rehearse twice | — |

### Cut if behind

1. cited.md URL (keep policy markdown in UI)  
2. Fancy chart → numbers only  
3. Band (keep Guild + Pioneer + Senso)  
4. Autopilot timer → manual Run generation ×2  

### Never cut

Measurable goal · live Pioneer · Senso scoring · ≥1 Guild promote · ≥3 sponsors green · demo video · public URL · Replay attempt

---

## 3-minute demo

| Time | Beat |
|---|---|
| 0:00–0:25 | Name BudgetDarwin. “Most agents overpay for every call.” Show goal. |
| 0:25–1:00 | Baseline: always premium — high $, quality ~0.92. |
| 1:00–2:00 | Autopilot: cheaper routes; Senso scores; Guild reject/promote. |
| 2:00–2:30 | Promote: Band alert + Guild trace; ≥40% $ down, quality ≥0.90. |
| 2:30–2:50 | cited.md / policy card — “this is what evolved.” |
| 2:50–3:00 | Name sponsors. Built-with greens. |

---

## Ship checklist

- [ ] Autopilot or two manual generations (no hand-edited JSON)
- [ ] Baseline vs current $ and quality visible
- [ ] ≥1 promote with Guild trace URL
- [ ] Pioneer live on ≥1 tier (prefer three env models)
- [ ] Senso live scoring (or honest fail-soft)
- [ ] Band promote message (live or labeled cache)
- [ ] Replay QA + ≥1 bug noted
- [ ] Deployed URL + GitHub + 3-min video + tools listed on tokens& form
- [ ] First sentence of demo is **save money**

---

## Risks

| Risk | Mitigation |
|---|---|
| Only one Pioneer model usable | Relative cost via max_tokens/temp weights; still live Pioneer calls |
| cited.md publish flaky | In-app policy artifact; URL is stretch |
| Cheap tier fails quality gate | Seed tasks answerable from short Senso context; tune checklist |
| Autopilot too slow | 8–12s interval; pre-warm one gen; cache repeats |
| “Another router” | Lead with $ saved + Senso-grounded + Guild promote in first 20s |

---

## Above and beyond

1. Evolving **policy genome**, not one-shot routing  
2. Quality from **external verified KB** (Senso)  
3. **Guild-governed** promote (auditable)  
4. **Band** ops signal surface  
5. **Citeable** evolved policy (challenge-aligned)  
6. **Replay**-hardened SaaS for largest cash prize path  

---

## Implementation todos

1. Scaffold Next.js + DarwinState + `/api/darwin` + DarwinApp shell  
2. Pioneer multi-tier infer + cost/latency + 12 tasks  
3. Senso truth seed + scoreAnswer + trial record + baseline  
4. `runGeneration` loop: route, score, mutate challenger, metrics  
5. Guild A/B promote + Band announce  
6. FinOps UI: chart, policy card, event log, autopilot  
7. Publish RoutePolicy to cited.md (or in-app fallback)  
8. Deploy, Replay, README/SPONSORS, demo video, submit  
