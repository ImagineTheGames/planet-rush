# a0-69-make-the-explosion-lab-play.md — working notes (art)

Branch `agent/art/a0-69-explosion-lab-live`. PR **#442 MERGED** 2026-08-17 04:32
(merge commit `b5cc0e4`), 13 checks passing, 0 failing.
Working note only — the DoD, the PR and QA's attestation are the evidence.

> The later notes-only commit `6446840` sits on the branch *after* that merge, so
> it is **not in main**. Deliberate: it is a working note, not a deliverable, and
> opening a second PR from this head would make the a0-69 DoD's
> `sort_by(.number)|last` point at a new OPEN PR instead of the merged #442.
> Do not open one.

## BUILT

All of it, in one commit: **f462106** "feat(a0-69): the explosion lab plays, on
the game's own renderer". Nothing in `src/` changed, so **no golden re-baseline**.

- `tools/explosion-lab/candidates.ts` — the 19 candidates + 3 families, lifted
  out of the generator so one array feeds both the live panel and the stills.
- `tools/explosion-lab/runtime.ts` — the live end: real `ParticlePool`, real
  emitters, real `pool.update`, real **`VfxLayer`** (the client's only particle
  draw path) over the real `SpriteTextureCache` on a real PixiJS WebGL renderer.
- `tools/make-explosion-lab.ts` — bundles that runtime (esbuild, minified, single
  IIFE) and inlines it. One command regenerates everything:
  `npx vite-node tools/make-explosion-lab.ts`.
- `docs/art-direction/explosion-lab.html` + the `assets/preview/` twin — 1,074,722
  bytes, one line, zero external URLs.

Per candidate: Play/Pause, Replay (t=0, same seed), canvas is a play button,
`t · particle count` readout. Per family: Play family, Stop, Loop (off by
default). Nothing autoplays. Filmstrip kept underneath at 128 px in `<details>`.

## DECISIONS

- **Full renderer bundled — nothing left out.** The brief allowed falling back to
  the particle subsystem alone if the budget blew. It didn't: 532 KB runtime,
  1.05 MB board, 4 MB ceiling. `sky-preview`'s canvas2d "game today" panel is the
  precedent for why a lookalike draw path is not acceptable.
- **One offscreen renderer, 19 canvases.** 19 WebGL contexts exceed what Chrome
  keeps alive (~16, oldest evicted) — the top of the page would go black while
  the bottom played. One renderer draws each panel; the frame is `drawImage`
  blitted to that panel's 2D canvas. The pixels are the renderer's.
- **The board is emitted as ONE LINE, and the gate is why.** The DoD asserts
  `grep -civE '…' | grep -qx 1`; `-c` with `-v` counts NON-matching lines, so only
  a one-line document scores 1 (the a0-63 board scores 243). Flagged to the
  Director in NEXT — if the `-v` was a slip, dropping `collapse()` restores a
  readable, diffable board.
- **Bundle rides in a `JSON.stringify`d string handed to indirect `eval`.** PixiJS
  keeps GLSL/WGSL in template literals where a newline is a preprocessor line
  ending, so the page-wide fold would have corrupted every shader.
- **Rejected:** a sibling `.js`/`.css` (the dashboard `readFileSync`s the single
  `.html` at `server.mjs:294` — anything beside it 404s and the board is blank);
  re-implementing particle motion in canvas2d; retuning anything (not in scope).

## Verified (this session, independently — not inherited)

- `npx tsc --noEmit` **clean**.
- **Generator reproduces byte-identically**: re-ran it, both copies md5
  `fc50a2d2…`, working tree clean.
- **File gates**: 1 line · 1,074,722 bytes · `<canvas`/`requestAnimationFrame`
  present · 0 external URLs. All four file DoD commands PASS.
- **Determinism, at pixel level.** Canvas hash and clock read in the *same* rAF
  callback (pairing them across callbacks is a race — that's a test bug, not a
  page bug, and it cost a round here). A/G/N, two replays each: 63/88/83 shared
  simulated times, **0 differing frames**.
- **Frame-rate independence, forced.** Candidate G unthrottled (122 rAF ticks) vs
  6× CPU-throttled (54 ticks): 44 shared simulated times, **0 differing frames**.
- **Inside the ART page's iframe** (dashboard on `WORKSPACE_DIR=/lanes/lane-2`):
  `data-live=on`, 19 canvases, all clocks `ready` at load (no autoplay), family
  plays in lockstep (`0.58s` × 5, B correctly reads `end` — it is a 0.30 s
  effect, not skew), **no console errors, no failed requests**.
- **Loop**: 6 restarts in 9 s, off by default. **Stop** returns to `ready`.
- **Looked at the frames.** 0.15 s / 0.35 s: plasma ring, embers, ship sprite on
  vacuum ground — live matches the stills.
- **`npm test -- --run`: 5592/5593.** The one failure is
  `src/net/playtest-log.test.ts:354` — a **wall-clock flake outside this lane's
  ownership and untouched by this branch**. The pre-boot fallback log stamps `at`
  from real time, so under a loaded 663 s run ≥1 ms elapses and it reads 1, not 0.
  Passes 3/3 in isolation; PR #442's "Typecheck, test, build" is green.

## NEXT

- Nothing to build. PR #442 is merged and the board is in main.
- **Director:** confirm the one-line fold is wanted (see DECISIONS).
- **Director:** `status/art-review.json` still calls this board "shown as a
  filmstrip at 0.05 / 0.15 / …". Gitignored and outside this lane, so it cannot
  be fixed here; the blurb now understates the board.
- The answer wanted back is one letter per family, e.g. "B, J, N". Nothing is
  ported until the developer names one.
