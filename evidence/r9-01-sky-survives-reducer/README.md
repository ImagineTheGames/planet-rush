# r9-01 — the sky survives the reducer

**Claim.** On `dd1d3f5` a whole sky left the frame mid-match when `VfxAutoQuality`
engaged. On `7a90b22` it does not — it stays on the stage for the life of the
match, and what a throttled *build* gets is a thinner sky rather than no sky.

Two runs, one box, one throttle, back to back. In each, two arenas in parallel:
**oval** (`plasmaReef`, the subject) and **line** (`deepEmber`, the control that
never left). The control is the point: without it, "the reef left" is equally
well explained by the box, the bundle or the harness.

## What was run

```
npx vite build                                                   # -> dist        (7a90b22)
git worktree add /tmp/r9-01-before dd1d3f5 && npx vite build …   # -> the before bundle
npx vite preview --outDir <each> --host 127.0.0.1 --port …
node evidence/r9-01-sky-survives-reducer/probe-sky-survives.mjs 4288 4287
npx vite-node evidence/r9-01-sky-survives-reducer/make-thinned-reef-figure.ts
```

45 s per build, polled once a second — a1-07's 40 s plus a margin, because the
bug needed 8.3 s to appear and evidence should outlast the claim it makes.

## The result

| build | arena | sky at t+1s | sky at t+45s | dropped | reduce-VFX engaged |
|---|---|---|---|---|---|
| `dd1d3f5` before | **oval** | `plasmaReef` | **— gone** | **t+6.1 s** | t+6.1 s |
| `dd1d3f5` before | line (control) | `deepEmber` | `deepEmber` | never | t+6.7 s |
| `7a90b22` after | **oval** | `plasmaReef` | **`plasmaReef`** | **never — every one of 45 polls** | t+18 s |
| `7a90b22` after | line (control) | `deepEmber` | `deepEmber` | never | t+18.9 s |

Full per-second series in `measurements.json`.

## How the reducer's own state is read, with no debug seam added

`drawAtmosphere` rebuilds the owned station's halo as **rings alone** when
`reduceVfx` is on. `atmosphereHaloSprite` is **53** shapes full and **13**
reduced, and `drawSprite` plays one instruction per shape — so the live
`atmosphere-*` Graphics' instruction count *is* the tier, readable from the same
poll as the sky. That is what makes the *after* run mean anything: before the
fix, "the reef is gone" was itself the proof the reducer had engaged; after the
fix the sky no longer answers that question, so something else has to.

The CPU is throttled deliberately (CDP `Emulation.setCPUThrottlingRate`, 8×,
applied at t+3 s — **after** boot, so every case boots at full speed with its sky
up and is then throttled while a player is looking at it). a1-07 got the same
engage for free from a loaded box; "for free" is not repeatable.

## Frames

- `../images/r9-01-before-oval-t45s.png` — The Oval on `dd1d3f5`, 45 s in: Floor
  and stars, **no reef anywhere in the frame**. Build stamp `dd1d3f5`.
- `../images/r9-01-after-oval-t45s.png` — the same arena, same wave, same match
  clock (±1 s), on `7a90b22`: the reef's cyan clots are across the frame. Build
  stamp `7a90b22`.
- `../images/r9-01-before-line-t45s.png` / `-after-` — the control, indistinguishable
  in both: Deep Ember's warm bodies at the rim. The fix changed nothing for a sky
  that never left.
- `../images/r9-01-plasma-reef-full.png` / `-reduced.png` — what the *thinned* reef
  looks like (density 1 → 0.45, 1336 → 608 shapes over a phone screen on The
  Oval's field). A true composite with real additive accumulation, not an SVG
  approximation. The live probe cannot show this: under the pin, a sky already on
  the stage never changes density, so `reducedDensity` only applies to a sky built
  while the tier is already throttled.

## One honest caveat

The fps in these runs (1.2–3.7) is a software-GL box under WSL2 at 1440×900 @2×,
not a phone. It is a legitimate throttled device for the purpose — the reducer's
only input is frame deltas — but no frame-rate claim should be read off these
numbers, and the before/after fps difference is run-order noise, not the fix.
