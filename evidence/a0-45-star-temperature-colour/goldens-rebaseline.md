# a0-45 — the golden re-baseline, image by image

**43 of the 50 baselines** in `tests/mobile/goldens.spec.ts` were rewritten.
Every one of the 43 was read at size before it was committed, and each is
accounted for below. The other 7 are byte-identical and were not touched.

## The method (a0-41's, because the trap is the same)

**A change under the tolerance cannot fail a golden, and therefore cannot
re-baseline one either.** `GOLDEN` is `maxDiffPixelRatio: 0.01`, and Playwright
counts a pixel as different only when its YIQ delta exceeds `35215 × threshold²`
— at the default `threshold: 0.2`, a per-pixel luma difference of **52.8 of
255**. A star field is a wash of small, faint marks: a0-44 measured its own halo
correction at **0.000%** by that rule. So a re-baseline run at the shipped
tolerance can rewrite nothing and report success.

Two consequences, both a0-41's:

1. `--update-snapshots` ran at **`maxDiffPixelRatio: 0`**, so every frame that
   differs by a single pixel is rewritten and `git status` is the complete list.
   (Playwright 1.49 only writes a snapshot when the comparison *fails*, so the
   tolerance is the gate on re-baselining too — `-u` alone would have rewritten
   nothing here. Every number in the table below is under 1%.)
2. The tolerance edit is **not committed**. It is the right number — it exists
   for font/GPU antialiasing — and `tests/mobile/goldens.spec.ts` is
   byte-identical to `main` on this branch; `git status` on it is clean.

**Private port.** The run used
`evidence/a0-45-star-temperature-colour/playwright.a045.config.ts`: port 4245,
own build, `reuseExistingServer: false`. The committed config pins 4173 with
`reuseExistingServer: !CI` and the lanes share this box, so re-baselining against
whichever lane started `vite preview` first would bake another lane's pixels into
this branch. (The 4173 server *was* this lane's when checked. Doing it anyway,
because a re-baseline that depends on which lane booted first is not evidence.)

**Test timeout 900 s, not 60.** This box runs other lanes' vitest suites, and
under that load `browserContext.newPage` alone was measured over 60 s here — it
cost a first attempt four frames to a fixture timeout with no pixels captured,
which is the failure mode `tests/reports/golden-retry-and-the-31x-runner-q9.md`
already documents. The run itself took 10.8 min, 50 passed, 100 project-skipped.

**`origin/main` was merged first.** a0-47's thruster trail and a0-48's ambient
bed landed while this branch was open; re-baselining before the merge would have
written frames that no longer exist the moment the PR merges.

## What this PR inherits, stated rather than smuggled

A golden is a whole frame, so re-baselining for a0-45 necessarily adopts
everything that has moved since each frame was last written — and the baselines
in `main` were last written at build `2d4cfa4`. `golden-delta.mjs` prices the
whole move (committed baseline → this working tree) by Playwright's own rule;
what it cannot do is split that number by cause, so the split below was made by
looking at where the pixels are (`bbox` per frame) and then at the frames.

Three things ride along, none of them a0-45's:

1. **The build-hash watermark**, bottom-left of every screen: `2d4cfa4*` →
   `d9121ab*`. It is 4–6 gate pixels and it is in all 43.
2. **The CODEX subtitle on the title screen**: `Bots, Ships, Systems, Strategy`
   → `Objective, Bots, Ships, Systems, Strategy`. A codex content change from
   another brief, never re-baselined because 853 gate pixels is 0.083% of a
   1280×800 frame and the gate is 1%.
3. **The settings defaults**: `FIRE MODE · MANUAL` → `AUTO-AIM` and
   `CONTROLS · KEYBOARD + MOUSE` → `TAP COMMANDER`. This is **a0-30's default**,
   not an artefact of this container: `readControlScheme` returns
   `DEFAULT_CONTROL_SCHEME` ("Tap Commander, everywhere") for an absent key, and
   the fire mode defaults the same way, so it reads the same on a desktop
   profile as on a phone. Checked in `src/main.ts` rather than assumed, because
   a device-sniffed value would have meant this box was writing pixels CI does
   not render.

None of the three is a regression, and all three are in the *chrome*, not the
play field. They are listed here so that nobody has to rediscover why a settings
screen moved in a star-colour PR.

## What a0-45 itself does to a frame

Every frame that shows the play field: the star points, their halos and their
diffraction crosses go from a grey value ramp (`hullSteel` / `hullLight` / white,
with two `BLOOM_TINTS` accents) to the design's temperature colours — 78%
blue-white, 22% amber, one colour per star across all three of its marks — and
every cross drops from α 0.2427–0.2728 to a flat **0.1056**, under its own halo's
0.2016, at stroke width 0.7 instead of 0.5.

**It is 0.37%–0.91% of a frame by the gate, and 80–95% of it by any-pixel.** That
gap is the whole character of the change: it touches almost every pixel of the
sky and it moves almost none of them far. Which is exactly why it could never
have re-baselined itself at the shipped tolerance, and why the developer could
still see it.

## The numbers

`golden-delta.txt`, in full, is the committed output of:

```sh
node evidence/a0-45-star-temperature-colour/golden-delta.mjs \
  > evidence/a0-45-star-temperature-colour/golden-delta.txt
```

**No frame is over the gate.** The largest is `desktop-sky-coalsack` at
**0.909%** against the 1% the suite fails at, and the largest any-pixel figure is
`desktop-hud-footer` at 95.23% — a strip that is almost entirely sky.

## Image by image

Grouped by what is actually in the frame; every one was opened and looked at.

### The play field — 22 frames, and this is where a0-45 lives

`desktop-sky-coalsack` (0.909%), `desktop-sky-deep-ember` (0.809%),
`desktop-sky-plasma-reef` (0.736%), `desktop-frozen` (0.771%),
`desktop-frozen-teams` (0.791%), `desktop-hud-top` (0.632%),
`desktop-hud-footer` (0.366%), `desktop-build-wheel` (0.707%),
`desktop-build-wheel-hover` (0.707%), `desktop-build-wheel-short` (0.707%),
`desktop-upgrade-wheel` (0.509%), `desktop-upgrade-wheel-short` (0.509%),
`phone-landscape-frozen` (0.575%), `phone-landscape-frozen-teams` (0.776%),
`phone-landscape-hud-top` (0.459%), `phone-landscape-thumb-band` (0.535%),
`phone-landscape-build-wheel` (0.491%), `phone-landscape-build-wheel-touch`
(0.491%), `phone-landscape-upgrade-wheel` (0.491%),
`phone-portrait-build-wheel` (0.530%), `phone-portrait-upgrade-wheel` (0.530%),
`phone-portrait-frozen-teams` (0.774%).

What changed, in all of them: **the sky is a two-temperature star field.** The
three `desktop-sky-*` frames are the ones to look at — Coalsack's dust lane now
occludes coloured stars, Deep Ember's warm blobs sit over a field that is warm in
22% of its own points, and Plasma Reef's additive cyan sits over one that is
78% blue-white. In every one of them the crosses have receded into their halos:
what used to read as a field of crosshairs now reads as a field of glows with
flares inside them.

What did **not** change, checked frame by frame because it is the risk: ore
yellow is still the only yellow on the screen and still unmistakable; the owner
rings, the beacon, the team labels and the damage tells all still read; the
asteroids and the station still out-value the sky (no halo reaches the rock body
at Y′ 77.4). The thruster trail is a0-47's, and it is present.

### Chrome over a hidden or absent field — 21 frames

`desktop-codex`, `desktop-doors`, `desktop-lobby`, `desktop-lobby-teams`,
`desktop-map-select`, `desktop-ship-select`, `desktop-end-of-match`,
`desktop-title`, `desktop-settings`, `phone-landscape-codex`,
`phone-landscape-doors`, `phone-landscape-lobby`, `phone-landscape-lobby-teams`,
`phone-landscape-map-select`, `phone-landscape-ship-select`,
`phone-landscape-title`, `phone-landscape-settings`, `phone-portrait-codex`,
`phone-portrait-lobby`, `phone-portrait-title`, `phone-portrait-settings`.

These carry **no a0-45 pixels at all** — the menu screens draw their own chrome
over the field. Each one moved for one or more of the three inherited reasons
above, and nothing else:

- **the watermark only** (4–6 gate px, bbox in the bottom-left corner):
  `desktop-doors`, `desktop-lobby`, `desktop-lobby-teams`, `desktop-map-select`,
  `desktop-ship-select`, `desktop-codex` (6 px), and their phone equivalents.
- **the watermark + the codex subtitle**: the three `*-title` frames
  (`desktop-title` 853 gate px, bbox 10,370 → 627,784).
- **the watermark + the settings defaults**: the three `*-settings` frames
  (`desktop-settings` 1670 gate px, bbox 10,217 → 940,784).
- **the watermark + a0-47's trail on the frozen scene behind the panel**:
  `desktop-end-of-match` (42 gate px).

### The 7 that did not move at all

`desktop-pause`, `desktop-pause-confirm`, `desktop-lobby-level-badge`,
`phone-landscape-pause`, `phone-landscape-lobby-level-badge`,
`phone-portrait-pause`, `phone-portrait-eliminated`. Full-screen overlays with no
watermark visible; byte-identical, and left alone.

## If CI disagrees

The re-baseline is a separate commit for exactly this reason. If the golden shard
reddens, drop that one commit: nothing else in the PR depends on it, and the
change is under the gate on every frame, so the suite passes against the *old*
baselines too.
