# a0-42 — in TEAMS, the fog lifts where your teammates are

> *"when playing on a team the fog of war should lift where your team mates are it
> should be like as if you were there...."* — the developer, 2026-08-13

Every frame here is the real preview bundle (`npx vite build` → `vite preview`),
booted `?debug=1&freeze=1&sides=2` so the world is pinned and the frame is
deterministic. The scene is staged through `window.__teamFogStage`
(`src/main.ts`, ?debug=1 only), which writes plain sim data — a ship's position,
its side, `alive` — and calls the sim's own `updateSensory`. **It makes no fog
decision**: every dot and every disc below is drawn by the shipped pipeline, so
the seam cannot fake what it is evidence for.

Re-run: `node evidence/a0-42-team-shared-fog/capture.mjs --mode=evidence --port=P`
against a preview server on port P. `fog-state.json` is the numbers the script
recorded beside each frame — the sim's own read (`__teamFogStage.state()`) and
what the minimap layer actually DREW (`__minimapStage.state()`).

## The scene

A 2v2 (`planet-rush:matchSize=4`, the size control the lobby writes) so the
viewer has exactly ONE teammate and every far disc is unambiguously theirs. The
viewer (P1, blue) is held at their own home on the right. The teammate is posted
at the opposite point of the ring, **1332 world units clear of the nearest edge
of any disc the viewer projects** (`allyClearance`), with a rival parked 364
units from them — inside their ship sensor (520) and nothing else's.

The minimap is opened with the real `M` toggle, because the overlay is where the
fog is legible at 1280×800. It is toggled shut and open again before each shot:
the minimap's content is a cached texture rebuilt every `MINIMAP_REDRAW_TICKS`
sim ticks **or on a state change**, and a frozen world never advances a tick — so
without the toggle the picture would keep showing the first rebuild while the
numbers moved underneath it. (That is a property of `?freeze=1`, not of this
change; the goldens rebuild once at boot and are correct.)

## The four frames

| frame | what changed | coverage discs | ship dots | station dots | ore dots |
|---|---|---|---|---|---|
| `1-fog-ally-not-yours.png` | the staged ship is on the **enemy's** side | 2 | 0 | 1 | 5 |
| `2-lifted-ally-is-yours.png` | **only** that ship's allegiance — nothing moved | 4 | 2 | 3 | 13 |
| `3-remembered-ally-scouted-ore.png` | the teammate flew a distant field and came home | 4 | 2 | 3 | **23** |
| `4-collapse-teammate-dead.png` | the teammate's ship died | 3 | **0** | 3 | 23 |

**1 → 2 is the feature, at one tick, in one world.** Nothing moves between these
two frames: the same ship stands in the same place, and the only difference is
whether `sameSide` says it is yours. Dark half → lifted half, with the teammate's
ship, the **rival under their sensor** (the viewer has no coverage within 1332
units of it), and the teammate's home all on the map.

**3 is the half that live dots cannot buy.** The teammate crosses a field, the
sim's own memory pass folds it into *their* record, and they fly home. The ore
count goes 13 → 23 and those ten rocks are drawn in the remembered dimming with
**nobody's live coverage on them** — the ally's discs are back at their post.
This is the difference between "as if you were there" and a camera feed.

**4 is the live/remembered split holding across a side.** The tick their ship
dies their disc is gone (4 → 3), the rival that was only under it drops (2 → 0
ship dots), and the geography stays (23 ore, 3 stations — including the enemy
home at the left, now dim: remembered, not sensed). A teammate's coverage is
never remembered as live dots.

## FFA did not move — measured, not tolerated

`--mode=control` shoots the two frozen golden scenes with nothing staged. Run
once against a build of `origin/main` (`6f92b74`) and once against this branch,
on the same box, same GPU, same deterministic frozen tick:

```
node evidence/a0-42-team-shared-fog/pixel-diff.mjs main-frozen-ffa-desktop.png   branch-frozen-ffa-desktop.png
node evidence/a0-42-team-shared-fog/pixel-diff.mjs main-frozen-teams-desktop.png branch-frozen-teams-desktop.png
```

| scene | pixels differing (exact byte compare) | where |
|---|---|---|
| frozen **FFA**, desktop 1280×800 | **0 / 1 024 000** | — |
| frozen **FFA**, phone landscape 844×390@3 | **0 / 2 962 440** | — |
| frozen **TEAMS**, desktop | 7 753 (0.757%) | x 1128..1259, y 675..747 |
| frozen **TEAMS**, phone landscape | 20 632 (0.696%) | the same corner at dpr 3 |

FFA is **zero pixels**, not "within tolerance" — the union collapses to self and
the frame is byte-identical. The teams frame moved, and the bounding box of every
moved pixel is **inside the minimap rect** (docked at x 1120..1268, y 600..748):
the change is the fog and nothing else on the screen.

`pixel-diff.mjs` counts any byte difference, which is the right tool for two
builds on one box and the wrong one across boxes — Playwright's comparator
applies a per-channel threshold first. Against the committed baselines, through
that comparator, `desktop-frozen-teams` was **10 142 / 10 240** differing pixels,
i.e. 99% of the 1% tolerance budget, versus **7 363** for the unchanged FFA
`desktop-frozen` on the same box. The teams baselines were therefore re-shot
(they were passing, but with 1% of the budget left, which is a red waiting for a
loaded runner); the FFA baselines were not touched.
