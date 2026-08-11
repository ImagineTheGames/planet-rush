# a0-25 — the onboarding teaches a mechanic the game no longer has

Branch: `agent/ui/a0-25-haul-home-prompt`

## BUILT

- **`2e82d5f` test (RED)** — `src/ui/onboarding.test.ts`. Asserts §2.10's amended
  sentence verbatim on every device, plus the two absences the brief names (no
  `fly home`, no literal `press E` on touch). Watched fail on the shipped copy
  first (LESSONS §24); the failure output is in the PR body.
- **`988bb8d` fix** — `src/ui/onboarding.ts:82`. The template is now
  `'Hold full — fly into your collection field to bank, then press {build} to spend'`.
  Module header, the `PromptId.HaulHome` doc and the copy comment updated to say
  what the string now teaches.
- **`9f4f602` live proof** — `Hud.debugOnboardingPrompt()` (`src/ui/hud.ts`),
  `window.__onboardingStage` under `?debug=1` (`src/main.ts`, READ-ONLY), and
  `tests/live-stage/haul-prompt.spec.ts`: 3 cases (desktop, phone landscape,
  phone portrait) on the real built bundle.
- **`264420a` evidence** — `evidence/a0-25-haul-home-prompt/`: five frames
  (before/after desktop, before/after phone landscape, after phone portrait) and
  the measured wrap table.

DoD: `npx tsc --noEmit` clean; `npm test -- --run` 283 files / 4934 tests green;
live-stage `haul-prompt` 3/3 and the sibling `prompt-band` 2/2 still green.

## DECISIONS

**The amendment is the ratification — carried verbatim, not re-worded.** §2.10's
sentence is *"Hold full — fly into your collection field to bank, then press E to
spend"*. `docs/gdd-conformance.md:820` proposes a variant (*"…to bank, **or**
press {build} to spend"*) — a nicer sentence, arguably, and rejected: LESSONS §17
says the amendment is the ratification, and "or" makes the two halves
alternatives when the GDD wrote them as a sequence. The only edit to the GDD's
own words is `E` → `{build}`, which §2.10 requires of itself (input-agnostic via
the action mapping, §2.4).

**Report 1 — the other three prompts, diffed against §2.10.**

| Prompt | GDD §2.10 | Shipped | Verdict |
|---|---|---|---|
| MINE | "Hold fire on the asteroid — your shots chip it into ore" | `'Hold {fire} on the asteroid — your shots chip the rock'` | **DIVERGES** — see below |
| SPEND | "Spend ore on defense — or UPGRADE SHIP to mine and hit harder" | identical | **matches** |
| UNDER-ATTACK | "Your station is under attack — follow the arrow" | identical | **matches** |

(`Hold fire` → `Hold {fire}` is not drift: the token is the mechanism §2.10 asks
for. Only MINE's tail differs.)

**MINE is left alone, and that is the finding.** Not because it "merely reads
oddly" — because **two ratifications disagree**, and choosing between them is the
Director's call, not a lane's:

- `docs/design-amendments.md:1120` (2026-07-26, the beam funeral) ratifies the
  shipped string by name: *"the coach copy becomes 'Hold {fire} on the asteroid —
  your shots chip the rock.'"*
- GDD §2.10 (amended 2026-07-27, one day later) quotes *"your shots chip it into
  ore"*.
- `docs/lore-copy-sweep.md:115` (later still, the v0.7 lore pivot) reviewed this
  exact line and ruled **"on-theme — keep"** while changing its neighbour.

So the shipped tail was chosen deliberately and blessed twice; the GDD's tail is
the newer document. HAUL-HOME had no such conflict — nothing ever ratified "fly
home", the amendment simply was not applied — which is why one is fixed here and
the other is reported. The two tails do differ in what they teach: "into ore" is
where mining's *output* is named, and the codex entry
(`content/codex/codex-systems.json`) uses the GDD's wording.

**Report 2 — prompt completion does NOT persist across matches.** §2.10 requires
each prompt *"never appear again after each is completed once"*, and it does not
hold. `a0-19` could not confirm it; confirmed here, and **not fixed here** — it is
a separate brief with its own evidence, per the brief:

- `Onboarding.completed` is a plain in-memory `Set` (`src/ui/onboarding.ts:190`).
  It is a field of `Hud` (`src/ui/hud.ts:477`), and `new Hud(...)` runs once per page
  (`src/main.ts:1398`).
- There is no `planet-rush:onboarding` key. The persisted keys are fire mode,
  control scheme, hull, name, match mode, abundance, size, map, haptics, profile
  and its backup — settings, profile and lobby state only.
- Offline REMATCH keeps the memory (`rematch()`, `src/main.ts:2771`, deliberately
  does not rebuild the HUD). **EXIT TO MENU does not**: `exitToMenu()`
  (`src/main.ts:2953`) calls `window.location.assign`, a full navigation — new
  page, new `Hud`, new `Onboarding`, all four lessons taught again. So does a
  reload, a PWA cold start, and tomorrow. Online REMATCH routes through
  `exitToMenu()` too, so it re-teaches as well.
- The fix is small and the *decision* is not: it needs a storage key and an
  answer to "does a player who finished the tutorial ever get it back?" (a RESET
  ONBOARDING settings row, `docs/gdd-conformance.md:825`). Director's call.

**The read-back seam is not scope creep, it is the evidence.** The brief asks for
the resolved token on both keyboard and touch. Which token gets resolved is
decided by boot-time device detection (`navigator.maxTouchPoints` → `isTouch` →
`activeDevice` → `HudFrame.device`), which no unit test crosses — a phone handed
`'keyboard'` would have kept the unit suite green while printing "press E". So
`debugOnboardingPrompt()` reports the drawn string and the measured box, and
`__onboardingStage` is READ-ONLY: the full hold is staged by the existing
`__oreHudStage.mine()`, which already parks the ship away from home so the
collection field cannot drain it.

**Rejected: touching the band, the panel or the trigger machine.** The copy is
41 characters longer, which is exactly the kind of change that invites a layout
"fix". It fits — measured, three viewports, no ellipsis (`evidence/…/README.md`).
`a0-24` owns the clipping, `a0-20` owns the theme, and the trigger conditions and
firing order are untouched.

**Rejected: `git checkout main -- …` frames as "before" without saying so.** The
before pair is this branch with only `src/ui/onboarding.ts` reverted (the seam
must exist to read back what was drawn). Disclosed in the evidence README; the
build stamp in those frames carries the dirty marker.

## NEXT

Nothing outstanding on this brief. Two things handed up, neither actionable here:

1. **MINE's tail** — Director to pick between `docs/design-amendments.md`'s
   ratified "chip the rock" and GDD §2.10's "chip it into ore", and retire the
   loser so the next audit does not re-find it.
2. **Onboarding persistence** — a separate brief; the storage key is trivial, the
   "can a player reset it?" question is not.
