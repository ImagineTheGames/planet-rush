# spikes/atlas-pooling — does the texture pooling in `src/art/atlas.ts` pay?

The instrument behind `docs/atlas-pooling-measured.md` (brief a1-10). Read the
doc for the numbers and the decision; this file is only how to take the reading
again.

```sh
node spikes/atlas-pooling/run.mjs                      # measure, print the table
node spikes/atlas-pooling/run.mjs --json out.json      # …and keep the raw payload
node spikes/atlas-pooling/run.mjs --headed             # watch it draw
npx tsc --noEmit --project spikes/atlas-pooling        # it is typechecked, on its own
```

It starts the Vite **dev** server on port 5183, opens `bench.html` in Chromium
with the vsync cap off, and waits for the page to hand back `window.__atlasBench`.
Nothing here is part of the production build: `vite.config.ts` has a single
implicit `index.html` entry and this directory adds no second one.

## What it measures, and how much of it travels

Two numbers come out and they are not equally portable.

**Draw calls per frame** is architecture. It is counted by patching
`WebGL2RenderingContext.prototype.draw*` before any context exists, so it is the
real submission count, and it is the same number on a workstation, on integrated
graphics and on a phone.

**Frame time** is *this box*. The rig prints the GPU string in its first line and
the doc never quotes a millisecond without it. On a machine with no GPU that
string reads `SwiftShader` and the milliseconds are a software rasteriser's, not
a gate.

Three method notes, each of which was a wrong reading first:

- **vsync off** (`--disable-gpu-vsync --disable-frame-rate-limit`). With it on,
  every path that fits inside 16.67 ms reports 16.67 ms and the comparison says
  nothing at all.
- **An empty-stage floor scenario.** Every path pays the same clear+present at
  1280×800. Quoting raw medians flatters whichever path is closest to that
  floor; the column that decides anything is the median with the floor removed.
- **Interleaved rounds, first discarded.** Scenarios run in order, three times,
  and the reported median is the median of the per-round medians — so a warming
  machine cannot hand the win to whichever path happened to run last, and one
  scheduler hiccup cannot decide the comparison.

## The paths it compares

`src/render/index.ts` is not un-pooled: every hot path already key-guards its
geometry, so a steady frame writes transforms and rebuilds only on a look change.
The question is how that same pooled look reaches the GPU.

| scenario | what it is |
|---|---|
| `floor:empty` | the shared clear+present, so the rest can be quoted net of it |
| `rocks:graphics` | one `Graphics` per rock, own `GraphicsContext` — **what ships** |
| `rocks:sprites` | one `Sprite` per rock over a few pooled textures — **what `atlas.ts` keys** |
| `rocks:contexts` | one `Graphics` per rock, `GraphicsContext` pooled by look key |
| `rocks:graphics+cull` | what ships, with off-screen rocks skipped |
| `rocks:sprites+cull` | the pooled path, likewise |
| `rocks:graphics+batch` | what ships, forced into the batcher (`batchMode: 'batch'`) |
| `turrets:*`, `shots:*` | the same A/B on the next two densest layers |

and, separately from the A/B, the **shipped `Renderer`** on the full GDD §4.3
stress scene, run twice — once normally and once with `setReduceVfx(true)` — so
the report can answer the question that outranks the micro-benchmark: when the
auto-reducer engages, how much frame does it actually buy back?

The captured frame deltas are replayed through the real `VfxAutoQuality` from
`src/platform/vfx-quality.ts`, not eyeballed against 30 fps, so "would it engage"
is answered by the state machine that actually ships.
