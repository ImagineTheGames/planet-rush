# pr-05 — the end-of-match summary as a beat, not a table

**Owner:** UI Engineer · **needs: pr-01** (the profile), **pr-04** (the numbers)
**Builds on:** `a0-09`, merged in `main` (#328) — this extends `src/ui/end-of-match.ts`, it does
not fork it.
**Plan:** `docs/progression-plan.md` §6 (read it in full — this brief is its summary)
**Blocks:** pr-08

---

## The ask, in the developer's words

> *"we need a fun end of match screen, that shows total ore mined, damage dealt, distance
> travelled, ships used, ore used, etc. all of the stats you can think of"*
>
> *"it needs to feel like a video game end match screen with the score counting up, the progress
> bar filling up to show you current level, whats left till next level as it fills up, and gives
> a rewarding animation as it fills up and completes… plus a satisfying sound"*

A screen with animations sprinkled on it and a **choreographed sequence** are different products,
and the second one is what was asked for. Build the timeline.

## What you are extending

`src/ui/end-of-match.ts` is pure and DOM-free: `endOfMatchModel(outcome, pointer)` derives words
and buttons, `endOfMatchLayout` places them, `./end-of-match-view` draws them. a0-09 made it
team-aware (`onYourSide`, `MatchOutcome.allies`). Keep every bit of that: **the result still
lands alone first** — the station-death ache keeps its beat (GDD §4.7) — and REMATCH is still the
one bright plate.

## The seven visible rows (plan §6.2)

**ore mined · damage dealt (HP) · ships destroyed · stations destroyed · distance travelled ·
ships used · ore used**, plus a match-time line under the headline, the XP total, and the level
bar. Everything else either pays XP without a row of its own or is cut, with reasons, in §6.2 —
including **no per-opponent breakdown**, because another player's stats are not yours to read
(§Q2).

**Stations destroyed shows `—`, never `0`, when the Crush did the killing.** Measured: 100% of
station deaths in an Easy bot lobby are the collapse phase. A stat that cannot be credited to a
real player is not shown rather than estimated.

## The timeline (plan §6.3) — durations `TUNABLE`, order and rules are not

| # | Beat | ~ | What |
|---|---|---|---|
| 0 | the result lands | 0 – 1.2 s | a0-09's screen, alone. No XP sequence exists yet. |
| 1 | rows arrive | +0.18 s each | each fades/rises in and **counts up from 0 over 0.5 s** |
| 2 | the XP total counts up | +0.9 s | one number, faster than the rows |
| 3 | the bar fills | +1.4 s | **from where the player started the match**, toward the next level |
| 4 | level-up *(conditional)* | +0.8 s | complete, flash, reset, tick the readout, cue |
| 5 | the settle | +0.4 s | hold; buttons take focus |

**Two cases that look like bugs and are the common ones:**

- **More than one level.** Repeat beat 4, each subsequent fill capped at **0.5 s**. Past **three**
  level-ups, collapse: jump to the final level and read `LEVEL 7 (+4)`.
- **Almost no XP.** The bar **always animates for its full beat-3 duration** however small the
  delta, so the motion is constant and only the distance changes, and the readout carries the
  number that did move (`+34 XP · 266 TO NEXT`). A player who earned little must see that they
  earned little — not see nothing and conclude the screen is broken.

## Four rules, and the test for each

1. **Skippable, always.** Any input — tap anywhere, any key, any pad button — snaps every counter
   and the bar to final and jumps to the settle. *Test:* run to completion, then run with a skip
   injected at every 100 ms mark, and assert **byte-identical final models**. **The first input
   skips and does not also press a button**, or a double-tapping player rematches by accident.
2. **The animation never computes the numbers.** Counters interpolate toward values fixed at
   teardown by pr-04. *Test:* the model is fully determined before the first frame, and the view
   is a pure function of `(model, elapsed)`.
3. **`prefers-reduced-motion` is honoured** — collapse to the end state, **with the level-up still
   marked** as a static state. ⚠ **This client honours it nowhere today**: a grep over `src/`,
   `index.html`, `public/` and `style-guide.md` returns nothing. `reduceVfx`
   (`src/render/index.ts:409`) is **not** it — that is a frame-rate reducer that sheds decorative
   VFX (GDD §4.3, risk 5) — though it is the right neighbour to sit a motion preference beside.
   You are **building the seam**, not inheriting one: `prefersReducedMotion(): boolean` on the
   `platform.ts` abstraction, never a bare `window.matchMedia` in UI code (GDD §4.1). Small, but
   scope nobody costed.
4. **Landscape phone.** Everything fits at **390 px** wide with **no scroll**, safe areas
   included. *Test:* the layout function at 390×844 and 844×390 places every element inside the
   viewport. If it does not fit, **cut a row** — do not add a scrollbar.

## The single write site

Compute → add to the profile → `saveProfile` → *then* animate. **Once, at teardown, never
mid-match** (GDD §4.8: the sim must never depend on the profile; a crash mid-match should cost at
most the current match). *Test:* one `saveProfile` call per match, and skipping the animation does
not skip the write.

## Traps

- **Do not put XP or a level anywhere in the match.** The ratified answer is *level yes, XP never,
  lobby only* (§Q2). s4's persistent HUD XP bar is cancelled. On this screen you show **your own**
  level and XP and nobody else's.
- **Do not reach for `matchEnd`, `musicWin` or `musicLoss`.** All forty bank slots are under
  `deny-all` (a0-01). The four cues this sequence needs are pr-07. Until they land, ship silent
  and wire the call sites.
- **The ache comes first.** Beat 0 exists so a defeat is not made cheerful by a level-up landing
  on top of it. Do not compress it away to save a second.
- **`endOfMatchModel` stays pure.** The sequence's state is `(model, elapsed, skipped)` — do not
  smuggle a clock into the model.

## Definition of Done

```
npx tsc --noEmit
npm test -- --run
bash -c "grep -rn 'prefersReducedMotion' src/platform/platform.ts | grep -q ."
bash -c "grep -rn 'matchMedia' src/ui/ | wc -l | grep -q '^0$'"
bash -c "git fetch origin main && git merge-base --is-ancestor origin/main HEAD"
```

## Evidence line

Four frames from the real booted client at 844×390: the result alone (beat 0), mid-count (beat
1), the bar mid-fill (beat 3), and the settle — plus a fifth under `prefers-reduced-motion`,
showing the same final numbers with the level-up marked. And the skip test's identical-models
assertion, named.

## AS BUILT — annotations from the lane (`agent/ui/p1-05-summary-sequence`)

Read against `docs/progression-plan.md` §6 line by line: **the brief and the plan do not
disagree anywhere**, so nothing here is a correction of the brief. These are the five
decisions the brief left open, recorded where the next reader will look.

1. **The DEFEATED overlay carries no summary at all.** Neither document says so outright,
   but §Q2 and Trap 14 do: *level yes, XP never, lobby only*, and an eliminated player is
   still **in** a match — the others fight on, their `wavesSurvived` and placement are not
   final, and the profile may not be written mid-match (§6.4, GDD §4.8). So the sequence
   rides the **result** screen only, and the elimination overlay keeps a0-09's screen to
   the pixel (`endOfMatchLayout` with no `summaryRows` is character for character what it
   was, and the `phone-portrait-eliminated` golden did not move).
2. **No row was cut.** Rule 4's fallback is *"cut a row, do not add a scrollbar"* — the
   fallback is conditional and was not needed. At 844×390 the band splits into two
   columns (result + actions | the stat sheet) and all seven rows fit; at 390×844 it
   stacks. The choice is made on measured heights, so it is a rule and not a device list.
3. **A STAGED boot rests the sequence at its end state** (`?debug=1`, and `?freeze=1`
   which already pinned everything else). A screenshot harness captures two frames and
   compares them, so a screen mid-count between them is a gate that fails on its own
   animation. `__endScreenStage.summarySeek(t)` asks for a beat by name, which is how the
   evidence run photographs four beats of one sequence.
4. **Online, the observer is fed the reconciled predicted world**, because there is no
   other one: `session.world` is the predicted world and this client is handed no
   authoritative `World` object (`src/net/session.ts`). The plan's trap is met exactly
   offline — where the world *is* authority — and the honest limit is written at the
   wiring in `src/main.ts`. A genuinely authoritative feed is a netcode-lane change.
5. **Distance is shown in arena units**, ungrouped by any invented unit (`1 465`), because
   the sim has no metre and a screen is a bad place to mint one.

## Open questions this brief is exposed to

- **Question C** — a station the Crush killed. *Ships as:* `—`, credited to nobody. If the
  developer picks "last player to damage it," it is a one-line read off pr-02's `lastHitBy`.
- The §6.2 **SHOW/CUT** verdicts are the Architect's and are cheap to reverse. If a row moves,
  re-run rule 4's 390 px test before anything else.
