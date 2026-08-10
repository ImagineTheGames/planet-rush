# a1-06 — re-verifying the two merged fixes on the live build

`a1-05` found two real defects on the served build and left four unresolved
verdicts. Both fixes then merged (#362 `51e8445`, #363 `b67071a`). **Merged is
not shipped.** This round re-attests those four against the build a player
actually loads, and measures the one risk the wave-interval fix introduces.

Everything here was captured against the **live GitHub Pages deployment**, never
a lane checkout:

    https://imaginethegames.github.io/planet-rush/

## The gate — which sha was actually under the camera

**`e567af0`**, stamped `2026-08-10T00:53:24Z`. Every item in this round names it.

`version.json` says so, and the in-frame build badge says so, but both are
strings the build writes *about itself*. The gate this round actually leans on
is `verify-served-source.mjs`, which is stronger than either:

- The client ships sourcemaps (`build.sourcemap: true`), and a sourcemap carries
  `sourcesContent` — **the original source of the code on the page**.
- Pull `assets/index-C-UgMqNF.js.map` (6.3 MB, 380 sources) and compare it, byte
  for byte, against `git show e567af0:<path>` for every file the two fixes
  touched.
- All eight mapped files are **identical**, including `src/ui/shell-lifetime.ts`
  — a file that did not exist before #363.

Output is committed as `served-source-check.json`.

### Two traps in that gate, both hit before being understood

**Do not gate on the bundle FILENAME.** `vite.config.ts` injects `__BUILD_INFO__`
with an ISO build *time*, so Vite's content hash moves on every build even when
the source is byte-identical. A local `npm run build` of `e567af0` emitted
`index-Fw38SFaJ.js` while the site served `index-C-UgMqNF.js`. That mismatch is
the timestamp, not a stale deploy — filing it as one would have manufactured
exactly the false finding this round exists to prevent.

**Two files in the fixes' diffs cannot appear in a sourcemap at all**, and their
absence is not a finding: `src/net/transport.ts` declares only types (zero
runtime exports, so TypeScript erases it) and `src/ui/index.ts` is a pure
re-export barrel (rollup flattens it). Both are reported as `erased`, not as
failures.

## What the round measured

Six new manifest items, all on served sha `e567af0`, all **verified** — and the
four a1-05 verdicts are left exactly as they were.

| Item | Verdict |
| --- | --- |
| The gate: served build carries both fixes | **verified** — sourcemap byte-match |
| Wave clock, offline (`PLAY → PLAY SOLO`, `YIELD · SCARCE`) | **verified** — 180 s |
| Wave clock, online (real gameserver, 2 clients) | **verified** — 180 s |
| The **rocks** arriving at 180 s, not just the counter | **verified** — +23,606 px vs a ~50 px noise floor |
| Clean-boot `TypeError` | **verified** — zero across six boots, with a control |
| Match length under 180 s SCARCE | **verified** — collapse at 12:30, resolved inside the rail |
| Sky parallax | left `inconclusive` — see below |

### The arithmetic, and the +1 nobody should trip on

For wave 1 the HUD computes `countdownToNext = waveTime(2, interval) - t`, so
**MATCH + NEXT sums to the interval itself**. The ratified SCARCE interval is
`WAVE_INTERVAL_S × 1.2 = 150 × 1.2 = 180`.

Every reading in this round sums to **181**, not 180. That is not a one-second
error in the interval — it is a display artefact, and the same one a1-05 saw:
`formatClock` does `Math.ceil`, and *both* fields go through it, so for any
non-integer `t` the displayed pair reads one second high. a1-05's readings summed
to **151** against a 150 s baseline for exactly the same reason. The comparison
is therefore apples-to-apples: **151 → 181, i.e. 150 → 180.**

### Why "zero errors" is a claim worth anything here

Six clean boots (desktop and 390 px; doors, lobby, match) logged **zero**
uncaught errors, where a1-05 logged exactly one per session. But a recorder that
was never wired up reports zero too, so the shot ends with a **control**: a
clean boot is given a deliberate uncaught `TypeError` of the same shape, thrown
off the boot stack from a `setTimeout`. It was caught, and the captured string is
`Cannot read properties of null (reading 'clear')` — the a1-05 message verbatim.
The zeroes are real.

### Showing the wave ARRIVE, not just the clock counting

`WAVE n/5` is `waveClockAt(t, interval)` — client-side clock arithmetic — so it
looks identical whether or not the server agrees. Asteroids don't: online they
are server-authoritative. Counting pixels that go from dark to lit between
consecutive committed frames of a parked online client gives a noise floor of
33–72 px per interval, and **23,606 px** across the one interval that brackets
the boundary — between the frame reading `NEXT 0:01 / WAVE 1/5` and the frame
reading `WAVE 2/5 · Far Belt`. The rocks arrive at 180 s. (`analyse-arrival.mjs`
→ `arrival-analysis.json`.)

One correction kept on the record: the capture's inline `rockInkPct` first put
that step one frame early, because it took a *second* screenshot to measure,
about a second after the one it saved, and the wave landed in the gap. The
frames were right and the number beside them was wrong — the worst way round.
The camera now measures exactly the bytes it commits.

### The trap in the match-length measurement

The first run reported the match "ending" at 451 s and would have filed a
finding that SCARCE matches run *short* of the 10–15 min rail. Looking at the
frame killed that: it reads **ELIMINATED — 7th of 8, your reactor was
destroyed.** An unpiloted client dies long before the match resolves; 451 s is
how long an idle ship survives, not a match length.

The camera now takes **SPECTATE** on elimination and watches the live match to
its actual end. SPECTATE has no clean-boot seam (`__endScreenStage.spectate` is
`flags.debug` only), so it is a real click at the plate centre measured off the
captured frame — the **lower** of the two plates, deliberately, because the upper
one is REMATCH and hitting it would silently restart the match. The click is
verified (the HUD clock must come back) and the shot refuses to report a number
if it did not.

The measured match: waves on the new metronome all the way down (MATCH 5:04
wave 2, 7:09 wave 3, 9:25 wave 4, last wave due 12:01 = 4 × 180), `COLLAPSE` on
the strip by MATCH 12:50 and not at 11:42 — the deadline firing at its anchored
750 s = 12:30 — and the match resolved between MATCH 12:50 and ~13:58. Inside
the rail.

**Report the in-sim MATCH clock, not the wall clock.** This run's wall clock was
946 s against ~830 s of sim, because the headless client accumulated ~96 s of
lag while other captures ran beside it; once they finished it tracked real time
exactly (four consecutive 68 s wall intervals each advanced MATCH by 68 s). Do
not run other heavy captures next to this one.

Two more honest limits: `MATCH TIME · 05:12` on the result screen is this
client's *own* time — it was eliminated then — not the match's length; and this
is one solo match with an unpiloted ship, not a characterisation of eight humans.

## Files

- `capture.mjs` — the round's camera. `node evidence/a1-06-live-round/capture.mjs [shot-id ...]`
- `verify-served-source.mjs` — the gate. `node evidence/a1-06-live-round/verify-served-source.mjs [sha]`
- `served-source-check.json` — the gate's output.
- `readback.json`, `readback-match-length.json` — the numbers behind each frame.
- Images land in `evidence/images/a1-06-*.png`; claims live in `evidence/manifest.json`.

## What this round did NOT close

`a1-05-sky-parallax-not-camera-locked` stays **inconclusive**, and deliberately.
It was never a suspected defect — a1-05 proved the backdrop travels with the
ship (219 px best re-alignment per 844 units flown) and could only not separate
a sky layer from a deep-star layer, because the arena the boot reaches paints
almost no sky. Nothing in the two merged fixes touches parallax, and closing it
needs a sky-rich arena hand-flown from the lobby. The brief marked it optional
and said not to burn the round on it; this round spent its time on the wave
clock, the console and the match-length rail instead.
