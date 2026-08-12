# a1-16 — evidence for the performance gate's two halves

Captured on this lane's box: a container with **no GPU**
(`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`),
against `agent/platform/a1-16-perf-gate-in-ci` on top of `main` at `d99e9cc`.

The conclusions rest on the draw-call and submitted-entity columns, never on the
milliseconds. See `docs/perf-gate.md` §2 for why.

| file | what it shows |
|---|---|
| `green-local.txt` | The new CI gate passing. 10.8 draw calls / 173 submitted on desktop; 9.1 / 11 on the landscape phone. 18.7 s. |
| `red-cull-disabled.txt` | **The gate catching a real regression.** `touchesBox()` in `src/render/cull.ts` forced to `return true` — the cull stops culling — then reverted. All three tests red at 32.15 draw calls and 660 submitted on **both** screens: a1-11's post-pooling, pre-cull number, and the whole arena. Not just "a number moved" — the exact pre-a1-12 shape. |
| `red-threshold-tightened.txt` | The same gate red with no source edit at all: `PERF_BUDGET_SCALE=0.5`. That knob is permanent and `Math.min(1, …)`, so it can only ever tighten. |
| `frame-time-measure-only.txt` | The **manual** half, run here without `PERF_GATE=1`. 20.0 fps desktop, 8.6 fps landscape phone. These numbers are the reason that half stays manual: they are a software rasteriser filling 2532×1170 px, and they say nothing about a phone in either direction. Every line prints `measure-only (PERF_GATE unset)` so it cannot be pasted as a gate result. |
| `sim-half-ci.txt` | The sim half, which already ran and was already honest: 0.123 ms mean per tick, 4.9% of its share of a 60 fps frame, and 2× entities costing 1.88× the time. |

**Not in this directory, because this box cannot produce it:** a `PERF_GATE=1`
run. That is the developer's laptop and the developer's phone, and
`docs/perf-gate.md` §4 says when it is owed.
