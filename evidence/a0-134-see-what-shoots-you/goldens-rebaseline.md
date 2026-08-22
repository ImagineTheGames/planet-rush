# a0-134 — golden re-baseline: ten frames, one cause

The sightline floor moves the **camera** on every touch profile (`src/ui/viewport.ts`
§3), so every golden that has world behind it on a phone had to be rebaked. This
note is what moved, why, and — as importantly — what did **not**.

## What was run

The merged tree is the branch tree (`git merge-base --is-ancestor origin/main
HEAD` holds at `e1f0261f`), so no merge was needed before baking.

```
npm run build
npx vite preview --outDir dist --port 4194 --strictPort &
PREVIEW_PORT=4194 npm run test:mobile -- goldens --update-snapshots
```

`50 passed`, no failures, **10 baselines rewritten**.

### The trap this hit first, written down so the next re-baseline does not pay for it

The first attempt was the one-liner — `PREVIEW_PORT=4194 npm run test:mobile --
goldens --update-snapshots`, letting Playwright's own `webServer` run
`npm run build && npm run preview`. It printed the build's chunk-size warnings,
ran for 33 minutes, reported **45 passed and rewrote nothing** — and `dist/` was
still dated six hours earlier, from before this branch existed. It had compared
the OLD bundle against the OLD baselines, which is a green run that means
nothing, and the only tell was that `phone-landscape-frozen` passed *unchanged*:
a 1.5× camera cannot land inside `maxDiffPixelRatio: 0.01`.

So: **build `dist` yourself, serve it yourself on a private port, and probe it
before trusting it.** `reuseExistingServer: !CI` then attaches to a server you
know the provenance of. The probe is one line —
`window.__viewStage.zoom()` must read `1.5` at 844×390 and `1` at 1280×800 —
and it was run against this bundle before a single baseline was written:

```
844x390  dpr3    zoom 1.5   world 1266x585
915x412  dpr2.6  zoom 1.5   world 1372.5x618
1280x800 dpr1    zoom 1     world 1280x800
```

(The private port is not optional either, for the reason `playwright.config.ts`
gives in its own header: several lanes share this box, and `reuseExistingServer`
on the default 4173 will silently bake another lane's pixels into this branch.)

## Re-baselined: 10 frames, every one of them a phone frame with world in it

`Δpx` is pixels whose RGB changed, against the frame's own total.

| golden | size | Δpx | why it moved |
|---|---|---:|---|
| `phone-landscape-frozen` | 844×390 | 216 092 (65.6 %) | the camera. `VIEW 1×` → `VIEW 1.5×`, and the world behind the HUD is the same arena drawn two-thirds the size. |
| `phone-landscape-frozen-teams` | 844×390 | 216 312 (65.7 %) | the same, on the two-sided scene. Side labels and colours untouched. |
| `phone-portrait-frozen-teams` | 390×844 | 216 308 (65.7 %) | the same again, through the orientation lock — the landscape lock hands the camera a landscape logical frame, so a held-portrait phone gets the same rung. |
| `phone-landscape-hud-top` | 844×96 | 50 374 (62.2 %) | the top band. **The chrome in it is pixel-identical** — `ORE 3`, the pause chip, `WAVE 1/5 · Outer Drift`, `NEXT 2:28`, `MATCH 0:02`, `100/100 HOME` all land where they landed. What changed is the world showing between them, and the `VIEW` readout's value. |
| `phone-landscape-thumb-band` | 844×168 | 90 432 (63.8 %) | the bottom band. Same story: the sticks, the FIRE column and the build button are HUD metrics (`hudMetrics`), which the camera does not touch; the world behind them is what moved. |
| `phone-landscape-build-wheel` | 844×390 | 201 057 (61.1 %) | the wheel is drawn at the same size in the same place — every cost, `4/4 BUILT`, `2/2 BUILT`, `FULL`, `OPEN ▸` unchanged — with a wider world behind it and `VIEW 1.5×`. |
| `phone-landscape-build-wheel-touch` | 844×390 | 200 415 (60.9 %) | the same frame with the wedge under a thumb; the wedge highlight is unchanged. |
| `phone-portrait-build-wheel` | 390×844 | 201 053 (61.1 %) | the same, through the lock. |
| `phone-landscape-upgrade-wheel` | 844×390 | 200 980 (61.1 %) | the upgrade wheel, same story; the stat line and the tier costs are unchanged. |
| `phone-portrait-upgrade-wheel` | 390×844 | 200 977 (61.1 %) | the same, through the lock. |

Every one was opened and read at full size before committing, and the top band
was read against its predecessor side by side — which is where the "the chrome is
identical" claim above comes from rather than from a hope.

## NOT re-baselined, and that is the argument

- **All 24 desktop baselines.** The desktop's short axis is 800 world units,
  which already clears the sightline's 552 with room to spare, so its ladder is
  the shipped one and its rung is still `1×`. The client that could already see
  both ships in a0-131 is not moved by the fix for the one that could not — and
  the golden suite is where that claim is checked rather than asserted.
- **Every phone front screen** — title, settings, doors, codex, lobby, ship
  select, map select, pause, end-of-match, in both orientations. They draw the
  menu backdrop, not the camera, so a camera change cannot reach them. All 16 of
  them passed untouched, which is the negative control for "did this leak
  anywhere it should not have".

## No tolerance was touched

`GOLDEN` in `tests/mobile/goldens.spec.ts` is `maxDiffPixelRatio: 0.01` before
and after; the spec file is byte-identical to its committed state. These frames
were not squeezed under a threshold — at 60 %+ they are nowhere near one, which
is the honest shape of a camera change and the reason the re-baseline is
unavoidable rather than optional.

## One flag, stated rather than absorbed

`tests/mobile/` is QA's directory. Ten baseline PNGs in it are rewritten here
because the brief's Definition of Done asks for exactly that ("goldens rebaked
from the merged tree if this moves the camera"), and because leaving them stale
would put six shards of the merge gate red. No spec, no config and no tolerance
in that directory is touched.
