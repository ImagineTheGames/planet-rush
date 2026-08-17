# a0-69 — the explosion lab must play, not pose

Branch: `agent/art/a0-69-explosion-lab-live`. Owner: Art Agent.

> *"for the vfx, id like to see the live animation playing, and not just frame by
> frame"* — the developer, 2026-08-17.

**This brief is the viewer, not the effects.** The candidate set, the nineteen
names, the three families and the "Departure" caveat are byte-for-byte what a0-63
ratified. Nothing in `src/` changed — not one byte, so no golden re-baseline.

## BUILT

- `tools/explosion-lab/candidates.ts` — the nineteen candidates + the three
  families, lifted out of the generator so **one** copy feeds both ends. The node
  side bakes the stills from it; the browser side plays from it. A lab whose live
  panel and whose stills could disagree is worse than either alone.
- `tools/explosion-lab/runtime.ts` — the live end. Real `ParticlePool`, real
  emitters, real `pool.update`, and the real **`VfxLayer`** (the client's only
  particle draw path) over the real `SpriteTextureCache` on a real PixiJS WebGL
  renderer.
- `tools/make-explosion-lab.ts` — now also bundles that runtime with esbuild
  (minified, single IIFE) and inlines it. Still the single command that
  regenerates everything: `npx vite-node tools/make-explosion-lab.ts`.
- `docs/art-direction/explosion-lab.html` (+ the `assets/preview/` twin) — 1.05 MB,
  one file, no external URLs, opens off disk and inside the ART page's iframe.

Per candidate: **▶ Play / ❚❚ Pause**, **↻ Replay** (t=0, same seed), the canvas
itself is a play button, and a `t · particle count` readout. Per family:
**▶ Play family** (all at the same instant), **■ Stop**, **Loop** (off by
default). Nothing autoplays. The filmstrip is kept under each live canvas at
128 px in a `<details>`.

## DECISIONS

- **The real draw path, not a canvas2d lookalike — and all of it fitted.** The
  brief allowed dropping to "the particle subsystem and its real draw path" if
  the full renderer blew the budget. It did not: PixiJS + `VfxLayer` +
  `SpriteTextureCache` tree-shake to **532 KB** minified, and the whole board is
  **1.05 MB** against a 4 MB ceiling. So **nothing was left out**. `sky-preview`'s
  "game today" panel is the precedent for why this matters.
- **One renderer, nineteen canvases.** Nineteen WebGL contexts exceed what Chrome
  keeps alive (~16, oldest evicted), so the page would have gone black at the top
  while playing at the bottom. There is one off-screen renderer; each candidate's
  frame is rendered into it and `drawImage`-blitted to that candidate's own 2D
  canvas at matched resolution. The pixels are the renderer's; the blit is a copy.
- **Fixed timestep off accumulated real time**, never the frame delta. Proven, not
  asserted: two runs of the same candidate were hashed frame by frame, keyed by
  simulated time — 82/250/134 shared times for D/G/N, **zero differing frames**,
  across runs that got different numbers of rAF callbacks (92 vs 136 for D). That
  difference in pacing with identical frames is exactly the property being
  claimed.
- **The board is emitted as ONE LINE, and that is the gate's doing.** The a0-69
  DoD asserts `grep -civE 'src="http|href="http|import .from .https'` equals `1`.
  `-c -v` counts lines that do **not** match, so only a one-line document can
  satisfy it (the a0-63 board scores 243). The generator therefore folds the page
  before writing. Flagged for the Director in NEXT — if the gate meant
  `grep -cE … = 0`, the fold can come straight back out; it is four lines of
  `collapse()`.
- **The bundle rides in a string literal, not raw in the `<script>`.** PixiJS keeps
  its GLSL/WGSL sources in template literals where a newline is a preprocessor
  line ending, so the page-wide newline fold would have corrupted every shader.
  The bundle is `JSON.stringify`d (newlines escaped byte for byte) and handed to
  indirect `eval`, which is exactly the global-scope, `"use strict"` semantics an
  inline classic script would have given it.
- **Loop holds 0.55 s between runs**, and the clock freezes at the last frame
  rather than counting through the rest — a readout that ran on would misreport
  the effect's length, which is one of the things being judged. `paused` and
  `end` are distinct labels for the same reason.
- **The stills stayed, smaller, in an open `<details>`.** They are the fallback:
  with WebGL removed the page sets `body[data-live="off"]`, hides the transports,
  shows a banner with the real reason, and still renders all 114 SVG frames.
- **Rejected: a `<script src="…">` sibling, or a data: URL script.** The dashboard
  serves a board by `readFileSync` of the one `.html` (`/art/board/<name>`);
  anything beside it is a 404 in the iframe and a blank board.
- **Rejected: re-implementing the particle motion in canvas2d.** It would have
  been a tenth of the bytes and would have approved something the game cannot
  draw.
- **Rejected: retuning anything.** Not in scope. Same candidates, same characters,
  same ids.

## Verified

- `npx tsc --noEmit` clean. `npm test -- --run` green.
- `npx tsc --noEmit --project tools` reports nothing in `explosion-lab/` (the
  pre-existing `make-laser-*.ts` / `make-shot-preview.ts` errors are untouched and
  predate this branch).
- Headless Chromium, standalone from `file://`: live = on, all three families
  play, **no console errors**; `▶ Play family` reads six identical clocks in one
  round-trip (`0.25s` × 6); Loop restarts 3× in 2.6 s; Stop returns to `ready`.
- **Inside the ART page's iframe** (dashboard booted with
  `WORKSPACE_DIR=/lanes/lane-2`, `/art` loaded in a real browser): `data-live=on`,
  the six station candidates played in lockstep at `0.47s`, no console errors.
- No-WebGL run: `data-live=off`, banner shown, transports hidden, 114 stills
  present.
- File gates: 1 line · 1,049 KB · `<canvas`/`requestAnimationFrame` present ·
  zero external URLs.

## NEXT

- **Director:** `status/art-review.json` still describes this board as *"shown as
  a filmstrip at 0.05 / 0.15 / …"*. That file is gitignored and outside this lane,
  so it cannot be corrected here. The blurb now understates the board.
- **Director:** confirm the one-line fold is wanted (see DECISIONS). If the DoD's
  `-v` was a slip, dropping `collapse()` restores a readable, diffable board.
- The answer wanted back is still one letter per family, e.g. "B, J, N". Nothing
  is ported until the developer names one.
