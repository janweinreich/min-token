# Prompt: Rebuild mintoken UI (match existing shell) + wire full functionality

## Your job

You own **both**:

1. **A brand-new UI/UX implementation** that is **very similar** to the current mintoken design shell in this repo (do not invent a different product look).
2. **Full functionality wiring** so the UI is no longer a mock: every panel, metric, chat action, sponsor credit, and activity event reflects the real Darwin / mintoken loop.

Repo: `https://github.com/janweinreich/min-token` (local: `min-token`). Branch: `main`. Product name: **mintoken** (lowercase).

The current app is intentionally a **UI shell only** (`MintokenApp` keeps local state; `/api/darwin` returns 501). Engine + adapters still exist under `src/engine` and `src/adapters` for you to reconnect or refactor. Prefer reconnecting and completing them over rewriting from scratch unless something is broken.

---

## Product (what the UI must express)

**mintoken** evolves how LLM calls are routed to cut spend without losing quality.

- User types **their own prompts** in a ChatGPT-like composer (not a "Run generation" batch button).
- Each prompt:
  1. Checks **answer memory** (reuse prior Q→A at $0 compute when quality is good enough).
  2. On miss: **Pioneer** inference on **cheap / mid / premium** per active routing policy.
  3. **Senso** grounds / scores quality (floor **0.90**).
  4. Compares cost vs an **always-premium baseline** (unitized).
  5. **Guild** A/B: promote cheaper policy if quality holds and cost ≤ **60%** of premium unit (goal: **≥40% savings**).
  6. On promote: publish policy note (Senso/in-app) + **Band** ops announce.
  7. **Replay**: QA on public URL; UI "Mark Replay QA" after LoopQA.

**Goals shown in UI:** quality ≥ 90% · cost ≥ 40% below always-premium · memory hits compound savings.

**Fail-soft:** missing/broken sponsor keys must still demo (local answers, local Guild, cached Band). Never hard-crash the UI.

---

## Design reference (match this closely)

Study and visually match:

| Area | Path |
|---|---|
| Main shell UI | `src/components/MintokenApp.tsx` |
| Styles | `src/app/globals.css` |
| Onboarding | `src/components/Onboarding.tsx` |
| Below-fold landing | `src/components/LandingExplainer.tsx` |
| Sponsor logos | `src/components/SponsorCredit.tsx` + `public/sponsors/*` |
| Shell contracts | `src/shell/types.ts`, `src/shell/index.ts` |

You may **rebuild components from scratch**, but the result must feel like the same product: same information architecture, same ChatGPT-adjacent interaction model, same white/black Geist look, same in-context sponsor logos.

### Visual system (hard constraints)

- **Fonts:** Geist Sans + Geist Mono via `next/font` only. No Instrument Serif, Manrope, or "fancy editorial" stacks.
- **Colors:** white background, near-black ink, light gray surfaces/borders. CSS variables already in `globals.css` (`--bg`, `--ink`, `--muted`, `--border`, `--surface`, `--live`, etc.). Do not switch to purple gradients, dark-mode-default, cream/terracotta clichés, or glow-heavy AI aesthetics.
- **No em-dashes** in user-facing copy (`—`). Use periods, commas, colons, or hyphens.
- **Sponsor marks:** **logo only** next to features (no "Senso" text beside the image). Names only in `alt` / `aria-label` / `title`. Feature labels like "quality" are optional; prefer clean logo chips.
- **Logo placement (do not swap files):**
  - `public/sponsors/senso.png` → Quality metric / scoring
  - `public/sponsors/pioneer.png` → Prompt cost, savings, routing policy, conversation
  - `public/sponsors/guild.png` → Activity (promote/reject)
  - `public/sponsors/band.png` → Activity (announce)
  - `public/sponsors/replay.png` → Replay LoopQA row only (NOT next to the mintoken brand wordmark)
  - Memory can use the "M" mark or a dedicated treatment on Memory hits / Answer memory
- Pioneer PNG was remastered to black-on-transparent and cropped; keep it centered with `object-fit: contain; object-position: center`.
- **Type size:** readable, not tiny. Body ~16–18px, metric values large (~28–36px), buttons ~44px tall.
- **Motion:** light and intentional only. **No GSAP, ScrollTrigger, Lenis, or scroll-hijacking.** Native document scroll only.
- **Layout density:** intentional panels with borders; not empty wireframe; not cluttered marketing scroll. Dashboard first; landing below the fold.

### Layout to recreate (ChatGPT-like + FinOps dashboard)

**Left sidebar (~16.5rem, light surface):**

- Brand: **mintoken**
- **New chat** primary button
- **Chats** list (active state, truncated titles from first user message)
- Footer: **How it works** → `#how-it-works`, **Reset**

**Main column:**

1. Sticky top bar: active chat title + goal rail (`≥90% quality · ≥40% below always-premium` + Goal met / Not met yet)
2. Short lede explaining prompt → Pioneer → Senso → Guild
3. **Stats row (4):** Quality (Senso), Prompt cost (Pioneer), Saved vs premium (Pioneer), Memory hits (memory)
4. **Main grid:**
   - Left stack:
     - **Conversation** panel (user/assistant messages; assistant meta: tier / model / quality / cost / memory)
     - **Activity** feed (Guild + Band logos; event source tags; Guild trace links when present)
   - Right stack:
     - **Routing policy** (version, default tier, challenger, rules list, recent prompt generations with cost bars)
     - **Answer memory** table (hits, question, tier, quality)
     - **Replay LoopQA** row (logo + Mark Replay QA)
5. **Floating composer** fixed to bottom of main column (not full viewport under sidebar): textarea + Send; Enter sends, Shift+Enter newline; disabled while running
6. Below fold: **`#how-it-works` landing** — full-width (same `--max` as dashboard), product intro, generation-loop cards, integration cards with large logos + specific bullets, success strip. Not a skinny left-aligned blog column. No "for judges" language; normal product copy.

**Onboarding:** first-visit modal (`localStorage` key e.g. `mintoken-onboarding-v1`), short steps, Skip / Next / Got it, sponsor logos on relevant steps.

---

## Interaction model (critical)

**Do not bring back "Run generation" or Autopilot as the primary UX.**

Primary action = **user prompt in the floating composer**, like ChatGPT.

| UI action | Required behavior |
|---|---|
| Send prompt | Run full ask pipeline for that question; append user + assistant messages; update metrics, activity, policy, memory, generations |
| New chat | Create empty session; select it |
| Select chat | Switch `active_chat_id`; show that thread |
| Reset | Clear runtime state back to initial (keep seed memory if appropriate) |
| Mark Replay QA | Set replay status true; log event; disable button |

First prompt may measure **always-premium baseline** once (seed task batch or equivalent) so savings % is meaningful; show pending state in UI ("Routing prompt…" / disable send).

---

## Shell contract (implement against this, even if you rebuild UI)

Types in `src/shell/types.ts`:

```ts
ShellHandlers = {
  onAsk?: (question: string) => void | Promise<void>
  onNewChat?: () => void | Promise<void>
  onSelectChat?: (chatId: string) => void | Promise<void>
  onReset?: () => void | Promise<void>
  onMarkReplay?: () => void | Promise<void>
}
```

`ShellState` fields the UI must stay able to render (names can map 1:1 from server state):

- `chats[]`, `active_chat_id`
- `goal.min_quality`, `goal_met`
- `metrics`: quality, cost_usd, savings_pct, memory_hits, dollars_avoided, memory_hit_rate (nulls → show `n/a` until measured)
- `baseline_unit_cost`
- `policy` + `rules`
- `generations[]`
- `events[]` (+ optional `guild_trace_url`)
- `memory[]`
- `replay_marked`

**Recommended architecture:**

1. Restore/implement real `POST /api/darwin` (or equivalent App Router API).
2. Lift state: server `DarwinState` (or your store) → map to `ShellState` **or** drive UI directly from server JSON.
3. Pass live `handlers` into the app that POST actions and then set state from response.
4. Keep fail-soft adapters.

Existing engine pieces to reuse / finish:

- `src/engine/loop.ts` — includes `runGeneration` and `runUserPrompt` (prompt-centric path)
- `src/engine/seed.ts` — DEMO_TASKS, policies, `createInitialState`, `newChatSession`
- `src/engine/types.ts` — `DarwinState`, chats, trials, etc.
- `src/engine/score.ts` — local checklist + Senso boost (handle empty `must_include` for freeform user prompts)
- `src/lib/answer-memory.ts` + seed JSON
- Adapters: `pioneer.ts`, `senso.ts`, `guild.ts`, `band.ts`
- `src/lib/store.ts` — in-memory process state (note: ephemeral on Vercel; OK for hackathon demo)

API actions the previous live app used / should expose again:

| action | body | effect |
|---|---|---|
| `ask` | `{ question }` | `runUserPrompt`; return full state |
| `new-chat` | | prepend chat, set active |
| `select-chat` | `{ chat_id }` | switch active |
| `reset` | | `resetState()` |
| `mark-replay` | | `sponsor_status.replay = true` + event |
| GET `/api/darwin` | | full state JSON |
| GET `?view=policy` | | markdown policy |
| GET `?view=memory` | | memory JSON |

Stub today returns shell/501; replace it.

Suggested ask pipeline (already sketched in `runUserPrompt`):

1. Ensure active chat; append user message; title from first prompt.
2. If baseline not measured: run always-premium batch on seed tasks once; set baseline.
3. Build `Task` from freeform prompt (heuristic length / precision).
4. `runBatch` with challenger policy + memory on `[task]`.
5. Unit baseline = `baseline.cost_usd / seedTasks.length`; compute `savings_pct`.
6. Guild A/B; on promote → bump policy, mutate challenger, Senso policy note, Band announce; on reject → mutate challenger.
7. Append assistant message with answer + tier/model/quality/cost/from_memory.
8. Update metrics, generations, events, memory list; `running: false`.

---

## Sponsor wiring (must be visible in-context)

| Sponsor | Backend | UI surfaces |
|---|---|---|
| **Pioneer** | `inferTask` cheap/mid/premium; cost estimate | Conversation meta, Prompt cost, Saved vs premium, Routing policy, Activity (`pioneer` / `cache`) |
| **Senso** | `searchTruth`, score boost, `policyMarkdown` / publish | Quality metric, Conversation credits, policy markdown link/view |
| **Guild** | `runPolicyAB` session + trace URL | Activity decision + "Open Guild trace" |
| **Band** | `announcePromotion` on promote | Activity `band` events |
| **Replay** | LoopQA outside app; `mark-replay` | Replay row only |
| **Answer memory** | lookup before Pioneer; store after score | Memory hits, Answer memory table, `memory` events |

Env (see `.env.example` / README): `PIONEER_API_KEY`, model overrides, `SENSO_API_KEY`, `GUILD_*`, `BAND_*`. `REPLAY_API_KEY` is MCP/LoopQA only, not required on Vercel for the mark button.

Pioneer may 403 if billing/inference not enabled → fail-soft local answers; UI still works.

---

## Copy / content rules

- Specific product language (Pioneer tiers, 0.90 floor, Guild promote, Band announce, memory skips recompute).
- No filler ("reimagine the future of AI…").
- No "judges see…" framing.
- Landing explains what mintoken does, how a prompt runs, how each integration is wired (API/action + which panel).

---

## Non-goals / do not do

- Do not ship another long kinetic marketing page with custom scroll libraries.
- Do not put Replay logo beside the mintoken wordmark.
- Do not show offline/live sponsor status chips as the main sponsor story; show **in-context logos + real events**.
- Do not require Supabase/Redis/Clerk for MVP; memory is JSON/in-memory (document Vercel ephemerality).
- Do not leave the UI on placeholder "UI shell" assistant replies once wiring is done.

---

## Acceptance checklist

- [ ] New UI clearly matches the shell's IA and visual language (sidebar + dashboard + floating composer + how-it-works).
- [ ] User can create chats, switch chats, send prompts, see streamed/returned answers with tier/cost/quality.
- [ ] First ask establishes baseline; later asks update savings %, quality, memory hits.
- [ ] Activity shows engine/pioneer/senso/guild/band/memory events; Guild trace link when live.
- [ ] Policy panel updates on promote; Band event on promote.
- [ ] Answer memory table fills; repeat prompts can hit memory ($0 / from_memory).
- [ ] Mark Replay QA works.
- [ ] Reset works.
- [ ] Fail-soft without keys.
- [ ] `npm run build` passes; works on `localhost:3000`; deployable to Vercel with env vars.
- [ ] No em-dashes in UI; logos correct and not microscopic; native scroll feels normal.

---

## Suggested build order

1. Re-read shell UI + `src/shell/types.ts` + `loop.ts` `runUserPrompt`.
2. Restore API + store; map state → UI.
3. Wire `onAsk` end-to-end with fail-soft.
4. Wire new/select/reset/replay.
5. Rebuild or harden UI to match shell polish (if rewriting, pixel-match structure).
6. Verify each sponsor path and landing copy.
7. Deploy + Replay QA + mark replay.
8. Update README demo steps to **prompt-based** flow (remove Run generation / Autopilot as primary).

---

## Tone for your work

Treat the current shell as the **design source of truth**. Your deliverable is that same product experience, live: ChatGPT-simple prompting on the left/bottom, FinOps Darwin metrics and sponsor-wired panels on the main stage, honest fail-soft behavior, hackathon-demo ready.
