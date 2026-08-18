# a0-79 — the menus need room, and a sky behind them

> *"the buttons currently expand to fill the screen on mobile. can we reduce that
> so we have more empty space on the sides..."*
>
> *"I'd like to see a space background on every menu screen (the main title
> screen already has it, id like it to persist throughout)"*

Two asks, both done. `evidence/a0-79-menus/audit.txt` is the long form; every
number below is re-runnable from `evidence/a0-79-menus/README.md`.

| | 798×384, before | 798×384, after |
| --- | --- | --- |
| the main menu | `evidence/a0-79-menus/frames/798x384-landscape-phone/before-menu.png` | `.../after-menu.png` |

---

## 1. The margin — the cap could not bite

```ts
const columnWidth = Math.min(COLUMN.title, frame.band.width);
```

`Math.min` picks the smaller. On a desktop that is the absolute 800 and the
plates stay a column; on a phone it is the **band** — 752px at the developer's
own 798×384 — so the cap never bit and the plates took everything. Measured on
the shipped bundle: **23px of field, 2.88% of the screen each side.** That is
the screenshot.

### The proportion is not a taste — it is the handoff's own

`src/ui/gantry.ts` grows a proportional ceiling beside the absolute one:

```ts
MENU_COLUMN_SHARE = COLUMN.title / referenceBandWidth = 800 / 1192 = 0.671
```

The ratified handoff draws an **800px column in a 1192px band**. Using the
design's own ratio has two consequences and both are the point:

1. **the reference desktop is unchanged to the pixel** — 1192 × 0.671 = 800 =
   `COLUMN.title`. This is a ceiling, not a redesign, and it keeps the rule
   `frameMetrics` already keeps: a derivation must reproduce its own sample.
2. **every narrower screen reads the same proportion of field the handoff
   draws** — 18.75% a side on the desktop, 18.4% on the phone.

A floor (`MENU_COLUMN_MIN = 448` reference px, scaled by `plateScale`) stops it
descending where the constraint reverses: below that width a screen gives up
**field**, never **words**. That number is measured too — it is the narrowest
column the widest thing the front of the game puts in one still fits at a
phone's plate scale, and `main-menu.test.ts` re-measures it against the repo's
own advance tables, so copy that outgrows it fails loudly rather than
overflowing a bevel on somebody's phone.

### The numbers, from the shipped bundles

Field beside the main-menu plates, % of viewport, **each side**:

| viewport | before | after |
| --- | --- | --- |
| **798×384** (the screenshot) | 2.88% | **18.38%** |
| 390×844 held portrait (844×390 logical) | 2.84% | **18.35%** |
| 1280×720 (the handoff) | 18.75% | 18.75% — *unchanged* |
| 3440×1440 | 38.37% | 38.37% — *unchanged* |

Labels still fit: the tightest is HANGAR's sub-line, needing 305px in the 427px
the phone plate now gives it.

**Portrait, the opposite constraint the brief asked about:** at a genuinely
narrow portrait logical viewport (390 wide — reachable on a desktop window,
since the landscape lock only rotates on mobile) the floor holds and the column
is the whole band, 3.33% a side, exactly as before. Nothing was taken from it.

> **Pre-existing, flagged, not fixed here:** at 390 wide, HANGAR's sub-line
> already overflows its plate by 19px on `main` — the band itself is too narrow
> for that copy. a0-79 does not move that case in either direction. It is a
> copy/type question, not a margin one.

### One seam, four screens

Each screen names its own absolute column; the proportion is decided in exactly
one place (`menuColumnWidth` / `menuColumnBand`).

- **Main menu** — 1 column, 800 absolute. Phone 752 → 505.
- **Settings** — the ceiling goes on the **grid**, not a column: `centeredGrid`
  splits the band between its columns, so with two columns the band's own half
  (372px) was already the narrower cap and capping a column alone changed
  nothing. On the 798×384 phone the **floor wins and the rows do not move** —
  the measured answer, not an omission: a column there is 372px holding content
  that measures 345px. 27px of slack, and this does not spend them. At 844×390
  there is room: 2.84% → 4.03%. Desktop unchanged.
- **Hangar** — 1 column, 1140 absolute. Phone 752 → 505, desktop 1140 → 800.
  Nothing is cut; the panes reflow and the screen reads as a deliberate column
  instead of a stretched panel.
- **Codex** — **2 content columns**, because its article is a *scrolling body of
  text*: narrowing it does not reflow, it pushes paragraphs off the bottom.
  Measured on the shipped bundle, a one-column floor took the 798×384 article
  from "fits the band" to "cut mid-sentence", so the codex keeps its band on a
  phone. The ceiling does its work where the codex's real drift was: **3352px of
  article on an ultrawide → 1140** (`frames/3440x1440-ultrawide/before-codex.png`
  is one line of body text running three metres).

---

## 2. The sky — the real void, baked once

`VoidBackdrop` belonged to the match renderer, so the game's own sky vanished the
moment a player left the title gate.

`src/ui/menu-backdrop.ts` drives the **real** `VoidBackdrop` through its real API
(`setMap` / `configure` / `update` / `destroy`). **Not** a second star field in
CSS or in a local `Graphics`: one field, one set of numbers, one thing to fix
when the design moves. A second one would build the instrument-vs-game
disagreement that cost the bloom five rounds into the product on purpose.

The sky is **named** — Patina Drift, the hue the title gate's own wash is painted
in — and pinned to the map registry by a test. It had to be named: the default
map is `octagon`, and `octagon`'s sky is `none`.

The five screens in the menu shell stop painting their own full-screen ground
when the shell says the void is behind them (`setVoidBehind`). The **default is
still "paint it"**: `SettingsView` has two homes, and over the pause overlay its
0.96 scrim is doing real work against a live match.

---

## 3. What the menu backdrop costs per frame — measured

**Coordinated with a0-75, whose numbers are read rather than re-derived.** a0-75
measured the void at **2.33 blended screenfuls per frame** after its own
sky-cache fix, 61–95% of a live-match frame. That is the bill for a sky that
*moves*.

A menu has no camera, so this takes the still frame the brief authorises:
`configure` and `update` run **once per resize**, and the assembled void is baked
(`cacheAsTexture`, the same mechanism `screen-cache.ts` already uses on every
menu screen) and blitted. Per frame: **one opaque textured quad.**

`boundsArea` crops the bake to the **screen** — the parallax field is ~2.6× the
viewport in each axis, so an uncropped bake would be ~7× the texture for no extra
pixel. `MENU_BAKE_MAX_TEXELS` (4 Mtexels = 16 MB) is a memory budget in a0-75's
own shape: a phone at dpr 3 bakes at full device resolution; only a very large or
dense viewport gives up resolution (~0.9 of CSS on an ultrawide at dpr 2) rather
than 79 MB.

One bundle, `?sky=0` vs `?sky=1`, three alternated passes back to back, live
match sampled in the same run as the denominator:

| viewport | device px | sky=0 | sky=1 | **backdrop** | match | menu/match |
| --- | --- | --- | --- | --- | --- | --- |
| phone 798×384 | 1.23 Mpx | 22.5 ms | 36.0 ms | **+13.5 ms** | 135 ms | **0.27×** |
| desktop 1280×720 | 0.92 Mpx | 16.1 ms | 26.6 ms | **+10.5 ms** | 167 ms | **0.16×** |
| ultrawide 3440×1440 | 4.95 Mpx | 85.7 ms | 151.1 ms | **+65.4 ms** | 653 ms | **0.23×** |

**How to read it.** This box has no GPU (SwiftShader), so not one of those
milliseconds is the developer's. Two things travel:

1. the cost is **linear in pixels at 11.0 / 11.4 / 13.2 ms per megapixel** across
   a 5.4× range of viewport — the signature of exactly **one screenful of fill**,
   arrived at from the other end from the design claim;
2. **menu/match is 0.16×–0.27×** against the 4× ceiling
   `tests/mobile/menu-frame-cost.spec.ts` gates on. The static front door costs a
   quarter of the running game, at every viewport measured, with the sky on.

The +1 screenful is inherent: showing a background behind a translucent
foreground costs a second screenful. A *live* void would have cost 2.33 of them
and would have scaled with a0-75's per-pixel bill every frame; this pays it once
per resize.

---

## Not in this branch

- **The HUD.** a0-74 is binding it to a content box on ultrawides. Nothing here
  touches `hud-geometry.ts` or the layout registry.
- **The lobby, ship select, map select, end-of-match.** They live in a different
  shell and carry the same `Math.min(COLUMN.title, …)` shape at
  `end-of-match.ts:722` and `lobby-geometry.ts:2010`. Obvious next surface;
  widening the diff into a0-74's neighbourhood in the same week is how two lanes
  collide.
- **The title gate's own canvas star field.** It is a DOM overlay that seals over
  everything, and the ask was for the sky to persist *past* it, which it now does.

Found and fixed on the way past, one line, because the teardown list was right
there: `hangarView` was added to the shell root at a0-14 and never removed or
destroyed with the rest.

## Held by

- `src/ui/main-menu.test.ts` — **`the plates leave the edges alone on a phone`**,
  6 assertions, *relationships* not pixel counts (LESSONS §26).
- `src/ui/menu-backdrop.test.ts` — 16 tests: it is the real void (same layers as
  the match, one for one), it is baked, the bake is cropped to the screen, it
  re-bakes on a resize and not on a no-op, and it releases its pooled texture
  before it destroys.
- Goldens re-baselined in the container, eyes on every image.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
