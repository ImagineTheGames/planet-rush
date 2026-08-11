# u15-01-onboarding-forgets-you-between-matches.md — working notes (UI)

Scratch memory for THIS brief, across retries and resumes. Keep it current; a
future me reads it before touching the branch. It is a working note, not
evidence — "done" is the DoD, the PR and QA's attestation, never a line here.

Branch: `agent/ui/u15-01-onboarding-persistence`.

## WHAT THE BRIEF ASKS (two halves of a0-19's G-3)

- **Half A** — §2.10's *"they never appear again after each is completed once"*
  survives one page load only. EXIT TO MENU navigates, the `Hud` (and the
  `Onboarding` inside it) is rebuilt, and the second match re-teaches the game.
  Fix: persist completion **through the existing profile store** (p1-01) — no
  second storage scheme.
- **Half B** — the SPEND prompt retires on the wrong action.
- Half C (HAUL-HOME copy) already landed in a0-25. Not this brief.

## WHAT I FOUND FIRST (before writing anything)

- `src/ui/onboarding.ts` is pure and DOM-free by design, and the audit's own
  task list says keep it that way. So persistence enters as an **injected port**,
  never as a `localStorage` import.
- **Half B's literal wording does not reproduce.** The audit says the prompt
  "retires on BANK (`src/main.ts:3266`)". There is no BANK wedge on the wheel any
  more (`WHEEL_EXCLUDED_ITEMS = ['bank']`, `build-wheel.ts:102`; `WHEEL_ORDER` is
  turret/shield/satellite/repair/upgrade), and no production path writes a
  `'bank'` order. What line 3266 actually is, then and now, is `hasOrdered = true`
  — set from `writeWheelOrders`, which returns true for an order **submitted**,
  not one the sim **accepted**. main.ts's own comment two lines below says so:
  *"an order submitted is not an order the sim ACCEPTED."* So the live defect is
  the same defect the audit named, one step along: **the prompt retires on a
  press, not on a spend.** A player who confirms TURRET with 2 ore, is refused,
  and never buys anything has been taught nothing and lost the prompt. See
  DECISIONS for why that reading, and why it matters more now than it did.

## BUILT

- `6217810` — this note.
- `5f0c2d3` — **the red run, watched first** (LESSONS §24). 14 failing in
  `src/ui/onboarding.test.ts` plus `src/ui/onboarding-memory.test.ts`, which
  could not even resolve its module. Captured verbatim in
  `evidence/u15-01-onboarding-persistence/red-before.txt`.
- `6278a3f` — both halves:
  - **A.** `Onboarding` takes an injected `OnboardingMemory` port (`load()` at
    construction, `save()` only when the completed set GROWS — `update` runs
    every frame). The state machine stays pure and DOM-free; the storage is the
    new `src/ui/onboarding-memory.ts`, over the ONE career profile.
    `Profile.onboarded?: readonly string[]` is optional and additive, validated
    with the same `asIdArray` `unlocked` uses, so `v` stays 1. Wired at the one
    `new Hud(...)` (`src/main.ts`) with `createProfileOnboardingMemory(
    platform.storage)`.
  - **B.** `OnboardingSignals.hasSpent` replaces `hasOrdered`, derived by the new
    pure `oreWasSpent(prev, next)` from the SpendFacts the HUD already holds —
    core HP up (a bought repair), turret/shield/satellite count up, an upgrade
    tier up. Latched in `hud.ts` `updateWheel` off the SAME before/after pair the
    confirm chime runs on, under the same wheel-open-on-both-frames gate.
    `hasOrdered` is gone from `HudFrame` and `main.ts`.
- `b58aaac` — `evidence/u15-01-onboarding-persistence/readback.{ts,json}`: three
  matches over one store. Match 1 teaches all four; EXIT TO MENU and a reload
  teach none; the career beside it (xp 4211, 7 matches) is untouched.

## DECISIONS

- **The profile, not a twelfth flat key.** The audit's task sketch said add
  `planet-rush:onboarding`; the brief overrules it — *"a profile store already
  exists… use it; do not add a second storage scheme."* It also passes the
  profile's own admission test (plan §2.1): *would this still be true if the
  player picked up a different phone and signed in?* A player who has learned
  that their gun is their mining tool has learned it. Fire mode and control
  scheme are settings and stay flat keys; this is career.
- **Additive optional field, `v` stays 1.** `onboarded?` follows `unlocked?` and
  `equipped?` exactly. Bumping the version would demand a migration rung for a
  field whose absence already reads correctly ("nothing taught yet") — and
  migration is this profile's only repair tool, so it is not spent on nothing.
- **`save()` re-reads the profile at the moment it writes.** There are two
  writers now (`bankMatch` at the end of a match, this one mid-match) and a copy
  held across the other's write is exactly how a tutorial prompt rolls back a
  career the developer ruled is never wiped. One extra read, at most four times
  in a player's life. Tested (`onboarding-memory.test.ts`).
- **Write on completion, not at match end.** A player who learns to mine and then
  closes the tab has still learned to mine. Guarded to one write per lesson by a
  size check, because `update` is a per-frame call.
- **Half B — what the defect actually is.** The audit's "retires on BANK" does
  not reproduce: there is no BANK wedge (`WHEEL_EXCLUDED_ITEMS`), so
  `writeWheelOrders` can only return true for a spend-shaped order, and
  implementing the audit's literal fix would have changed nothing. The live
  defect one step along is the same defect: `hasOrdered` was an order
  **submitted**, and main.ts's own comment says *"an order submitted is not an
  order the sim ACCEPTED"*. Confirm TURRET with 2 ore, be refused on cost, and
  the prompt retired having taught nothing. So it now retires on the sim's own
  state change — the discipline `press-feedback.ts` already uses for the confirm
  chime, and the reading that makes the audit's sentence true for banking too.
- **Rejected: an order-kind filter** (`hasSpent = ordered && item !== 'bank'`).
  Two lines, and it fixes a path no player can take while leaving the one they
  can. Persistence is what raises the stakes: a wrong retirement used to cost one
  match of tuition and now costs every match this player will ever play.
- **Rejected: "banked ore fell" as the spend signal.** `spendOre` takes from the
  HOLD first (`sim/buildings.ts:114`), so a purchase paid out of cargo never
  touches `banked` — and a station elimination zeroes the bank, which is not a
  purchase.
- **Kept: the wheel-open-on-both-frames gate.** A new match opens a fresh core at
  full HP; without the gate that jump reads as a repair, and with persistence it
  would retire SPEND permanently on a match boot. The cost is a false NEGATIVE —
  buy and close the wheel in the same frame and the prompt survives to the next
  wheel-open. That is the right way to be wrong now that the answer is permanent.
- **`ordered` still fires the haptic on any wheel order**, per a0-19's own note 3
  (*"splitting it must not stop the haptic firing on a BANK press"*).
- **Not built: a RESET ONBOARDING settings row.** The audit's Q-4 recommends one
  and the developer has not ruled; it is not in this brief. Raised in the PR —
  with the practical note that on a real device the prompts are now demonstrable
  only by clearing storage.

## NEXT

- **PR #395 open**, branch pushed. `npx tsc --noEmit` clean; `src/ui` (48 files,
  1612 tests) and `src/progression` green locally. The full 269-file
  `npm test -- --run` is slow on this lane (2 workers, three lanes contending —
  see `vitest.config.ts`) and is in flight alongside CI's own run of it.
- If a future session picks this up: the run's log is `/tmp/u15-full.log`, and
  `npm test -- --run | tail` looks HUNG for ~20 minutes because the pipe buffers
  the whole reporter — redirect to a file and `grep -c ✓` instead.
- For QA: the four live-stage prompt specs run on a fresh browser context, so an
  empty profile means they fire exactly as before. Nothing to re-baseline. On a
  real device, seeing the prompts a second time now needs storage cleared —
  that is the fix working, and it is why Q-4's RESET ONBOARDING row is raised in
  the PR rather than silently built.
