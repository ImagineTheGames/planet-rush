# a0-111 — eleven briefs shipped in a day, and somebody finally looked

Eleven briefs merged between 2026-08-19 and 2026-08-20 and most of them changed
what a player sees. All of them went out on green CI. CI proves the pixels match
yesterday's pixels; it cannot tell you a word is wrong or a control is
unreachable. This directory is a camera pointed at yesterday.

Everything here comes off the **production bundle** — `npm run build` plus
`npm run preview`, on this directory's own port — on two profiles, phone
landscape 798x384 dpr2 touch and desktop 1280x800 dpr2. The build stamp
`84ddec7*` is in the corner of every frame: **no capture passes `?freeze=1`**,
because `src/main.ts` sets `buildBadge.visible = !flags.freeze` and a frozen
frame is one with the stamp deliberately hidden.

## The seven things the brief asked for, and how they came back

| # | Asked | Verdict |
|---|---|---|
| 1 | the end-of-match screen, all four outcomes | **not clean** — VICTORY, DEFEAT and ELIMINATED are right; DRAW has no reachable path |
| 2 | the lobby and join flow; the word "claim" must not appear | verified — zero instances across the whole reachable walk |
| 3 | the settings FIRE MODE row under Tap Commander | verified — AUTO-FIRE, dim, refuses the press, `?` explains the lock |
| 4 | the doors screen: SETTINGS gone, BACK still works | verified |
| 5 | the ore counter with its new ground | verified — the scrim is there and it works |
| 6 | the phone minimap out to the true screen edge | verified — 12px, was 132px |
| 7 | the under-attack prompt, on-screen and off-screen | verified — the frame a0-99 could not take |

**Six of seven came back verified.** Three further defects turned up on the way
and are in the manifest as their own entries: a failed HOST puts the DOWNLOAD
LOG button over the word HOST; a rival nameplate is drawn into the ore counter's
rect on 4 of 28 sampled frames; the alarm arrow is drawn across the wave clock.

## How to re-run it

```
npx vite preview --port 4311 --strictPort          # or let the config build+serve
A0_111_REUSE=1 PREVIEW_PORT=4311 npx playwright test \
  --config evidence/a0-111-yesterday-with-eyes/playwright.config.ts
node evidence/a0-111-yesterday-with-eyes/crops.mjs
node evidence/a0-111-yesterday-with-eyes/plates.mjs
node evidence/a0-111-yesterday-with-eyes/manifest-entries.mjs
```

`shots/` holds the specimens and a JSON readback beside each. `crops/` holds
nearest-neighbour magnifications of stated rectangles of stated frames — no
filtering, no annotation. `plates.json` composes them into the images the
manifest points at, with a caption under each frame written **after looking at
that frame**. Where a readback and an image ever disagreed, the image won and
the disagreement went in the attestation.

## Three traps this run hit, written down so the next one doesn't

**The word recorder that returned an alphabet.** The "claim" hunt is not a grep —
the brief says a string can be assembled at runtime — so `words.ts` patches the
2D context before the bundle loads and records what is actually rasterised. The
first cut recorded `fillText` alone and reported the doors screen as 54 distinct
"strings": `8`, `4`, `d`, `e`, `c`. This game letter-spaces its type and a canvas
context cannot, so Pixi draws **one character per call**. A hunt over that list
would have come back clean on a screen that was shouting the word.

**The draw that was a harness bug twice before it was a finding.** Killing the
seats in waves crowns whoever fell last — the sim being right about a match that
was already over. A single simultaneous burst 800ms after boot lands *nothing*,
because `station.spawnProtect` refuses every point of damage in the opening
seconds. Only the retried eight-at-once burst gets a real no-survivor world, and
the screen over it still says `DEFEAT / Player 8 won.`

**The scrim I nearly declared missing.** I looked for a luminance step at the ore
counter's rect edges, found none, and almost wrote that a0-102 shipped nothing.
There is no step because what shipped is a *soft* scrim, not a bounded plate.
Wrong instrument, wrong finding — the right one is to put a busy background
behind it and compare the plating under the counter with the same plating beside
it.
