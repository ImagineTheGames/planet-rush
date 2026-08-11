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

(see DECISIONS for why; commits listed as they land)

## DECISIONS

## NEXT
