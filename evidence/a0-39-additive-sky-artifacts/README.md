# a0-39 — the additive skies render as artifacts, not as nebulae

*Owner: Art Agent. Branch `agent/art/a0-39-additive-sky-artifacts`.*

> *"the maps have visual artifacts, its not the bloom, look at this other one as
> well its the nebulas that are fucked"* … *"i played on compass and the bloom
> was correct"*

## The instrument

| file | what it is |
|---|---|
| `sky-rig.html` + `sky-rig.ts` | the shipped `VoidBackdrop`, **alone**, per map, at 1280×800 over that map's real arena bounds. No ships, no rocks, no HUD — the report is about the sky, and anything else in the frame is something for the eye to blame instead. A `starless` flag hides the three star layers, which is what makes a ring count possible at all (a star's core is white at alpha 0.88, so on a frame with stars in it the brightest pixel and every hard edge is a star). |
| `shoot.mjs` | drives it: two PNGs per map (`<map>-<sky>.png`, `<map>-<sky>-skyonly.png`) and `rings-<label>.json` |
| `ring-profile.mjs` | the measurement the brief asks for — a 720-ray rotational radial profile of one blob, and the radii of its steps |

```sh
node evidence/a0-39-additive-sky-artifacts/shoot.mjs before
node evidence/a0-39-additive-sky-artifacts/ring-profile.mjs \
  evidence/a0-39-additive-sky-artifacts/frames/before/line-deepEmber-skyonly.png 110 472 240
```
