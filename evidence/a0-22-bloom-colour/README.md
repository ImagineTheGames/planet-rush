# a0-22 — the blooms lost their colours, and the reason is a rule

> *"the bloom is still messed up, still doesnt match our mockups and if you notice
> our mockups had different colored blooms these are all 1 color there are no
> stars in them…"* — the developer, from live play.

Two claims, and they have different answers.

| | |
|---|---|
| **"these are all 1 color"** | **True, and it was not a bug.** Every star ink was `hullSteel`, `hullLight` or white, and `starFieldSprite` drew each halo in its star's own colour. The rule that did it was written above `STAR_LAYERS`: *steel value ramp only … never by hue*. It obeyed style-guide §1; the compositor page the developer picked from did not. Nobody noticed the two disagreed. |
| **"there are no stars in them"** | **Measured false of the blooms.** 36 bloomed stars on a 1440×900 screenful, **0 of them without a core**, and the core is the brightest pixel in every one — standing **33 / 91 / 183** luma above its own halo on `deep` / `mid` / `near`. The round things in that frame that genuinely have no star are **2–100× bigger**. |

Everything below is measured on the served bundles, `0f8fd05` (main) against this
branch, desktop 1440×900 at dpr 2, `?debug=1&freeze=1`, same seed, same pinned
tick — the a0-18 and a1-07 conditions, so the three rounds are comparable.

---

## 1. Is there a star in a bloom? Yes, in every one — `probe-star-in-bloom.mjs`

Two instruments, because *"is it submitted"* and *"is it painted"* are different
questions:

- the a0-18 **geometry read-back** — every fill a live `void-stars-*` `Graphics`
  submitted, grouped by centre, now carrying each fill's **colour**;
- the **pixels**: the void screenshotted **alone** (every world layer hidden, so
  no rock can be mistaken for a star or sit on top of one), sampled at each
  bloomed star's own centre and in both halo annuli.

`star-in-bloom.shipped.json` · `star-in-bloom.tinted.json`

| build `0f8fd05`, octagon | bloomed on screen | halo Ø css px | core Ø device px | core peak Y′ | core − halo | cores below Δ1 |
|---|---|---|---|---|---|---|
| `deep` | 25 | 5.95 | 2.77 | 41.7 | **+33.4** | **0 / 25** |
| `mid` | 10 | 7.57 | 3.51 | 112.3 | **+90.6** | **0 / 10** |
| `near` | 1 | 11.83 | 5.50 | 230.0 | **+182.7** | **0 / 1** |

## 2. What in the frame *does* have no star — `plates/plate-size-ladder.png`

Same instruments, same frame, everything round and soft in it, by size:

```
   6.0 px   bloom halo, deep      ← has a star, Y′ 41.7,  +33.4 over its own halo
   7.6 px   bloom halo, mid       ← has a star, Y′ 112.3, +90.6
  11.8 px   bloom halo, near      ← has a star, Y′ 230.0, +182.7
  38.3 px   sky disc, median      ← NO STAR, by construction. 1004 of them on The Oval
  62.7 px   asteroid              ← NO STAR. It is a rock (measured by a1-07)
 659.2 px   sky disc, largest     ← NO STAR. The reef's base wash
```

A bloom is the **smallest** thing on that list and the **only** one with a star
in it. This does not say what the developer was looking at — nothing here
measures perception — but it does say this: **whatever had no star in it was not
a bloom.** a1-07 had already found the same shape of answer once, when the soft
grey discs of *that* round measured out as the asteroids.

## 3. What changed, and what it cost — `plates/plate-orbs-*.png`

The bloomed stars the read-back located, cut identically from both builds at **8×
nearest neighbour with no amplification**, shipped above and this branch below.
The first cell of `plate-orbs-octagon.png` is the round in one image: a white
halo becomes a cyan one, and the white star inside it does not move.

`plates/plate-mockup-vs-now.png` puts the compositor's four bloom colours against
the three that ship, each swatch composited **at a bloom's own alpha** rather
than at full value. Two of the four are RESERVED and are drawn struck through
with the rule that bars them:

- **signal yellow** — no carve-out at any alpha (§2.2 clause 3), and
  `compliance.ts` fails it on role `material` today;
- **threat red** — the §2.2 sky ceiling is `0.06`; a bloom's inner ring is
  `0.042`–`0.147`, over it on every layer.

Neither is Art's to grant. The compositor page (`space-backdrop.html`) is the
developer's own file and has **never been in this repo** — a0-07 ratified off it
without committing it — so its four colours here are the a0-22 brief's
measurement of it, and the plate says so on its face.

## 4. The goldens — `diff-goldens.mjs`, `plate-goldens.mjs`

Four tables, all through one instrument, because a re-baseline cannot be
attributed from one comparison: `golden-diffs.branch-vs-head.json` (what this
branch moved) · `golden-diffs.noise-floor.json` (two regenerations of one build)
· `golden-diffs.main-drift.json` (main's committed bytes against main
regenerated here) · `golden-diffs.main-vs-branch-regenerated.json` (the two
builds regenerated side by side, which is this branch's own contribution with the
container held constant).

**Five baselines moved, and every moved pixel is a bloom halo.** The plates cut
the bounding box of everything that changed out of both frames; the difference
row is the only amplified thing on them.

| baseline | pixels moved | of | mean ΔY′ |
|---|---|---|---|
| `desktop-frozen` | 187 | 1,024,000 | +1.67 |
| `desktop-frozen-teams` | 187 | 1,024,000 | +1.67 |
| `phone-landscape-frozen` | 34 | 329,160 | +2.06 |
| `phone-landscape-frozen-teams` | 34 | 329,160 | +2.06 |
| `phone-portrait-frozen-teams` | 34 | 329,160 | +2.08 |

### The noise floor is a calibrated zero, and the other 39 baselines are a finding

Two independent captures of the same build came back **byte-identical on 44 of
44** — so nothing below is capture noise.

Against that zero: **35 of main's 44 committed baselines do not reproduce from
main's own code in this container.** That is pre-existing and none of it is the
backdrop. The clearest one is `desktop-hud-top`, where **98.8%** of the frame
differs at peak Δ 137: the committed baseline reads **`TOTAL`** where the build
draws **`ORE`**. Four wheel plates differ at peak Δ 224; both pause plates at
1.2–1.9%. It is under `maxDiffPixelRatio`'s 1% budget in pixelmatch's perceptual
counting, which is why CI has stayed green over it.

**So this branch re-baselines only what it moved.** The other 39 keep main's
committed bytes, because adopting them here would fold another lane's
un-baselined change into an Art PR and hide it. Isolating this branch's own
contribution needed a third comparison — main regenerated in this container
against this branch regenerated in it — and it splits cleanly into the bloom tint
(mean ΔRGB ≈ `[−3, +3, +6]`, i.e. cyan replacing white) and the **build badge**,
a 38×8 px box carrying the commit sha, which differs on every commit and always
has.

---

## Running it

```sh
# main's bundle on 4923, this branch's on 4922
npx vite preview --outDir /tmp/dist-a0-22-shipped --port 4923 --strictPort &
npm run build && npx vite preview --port 4922 --strictPort &

node evidence/a0-22-bloom-colour/probe-star-in-bloom.mjs 4923 shipped
node evidence/a0-22-bloom-colour/probe-star-in-bloom.mjs 4922 tinted
node evidence/a0-22-bloom-colour/shoot-and-plate.mjs 4923 4922
node evidence/a0-22-bloom-colour/diff-goldens.mjs git:HEAD tests/mobile/goldens.spec.ts-snapshots branch-vs-head
node evidence/a0-22-bloom-colour/plate-goldens.mjs
```

Nothing in `src/` is touched by any of it: the stage is reached through Pixi's own
devtools hook (`__PIXI_APP_INIT__`), set from a Playwright init script before any
page script runs, so the same files measure the served bundle of any commit.
