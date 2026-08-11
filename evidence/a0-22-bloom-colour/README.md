# a0-22 — the blooms lost their colours, and the reason is a rule

> *"the bloom is still messed up, still doesnt match our mockups and if you notice
> our mockups had different colored blooms these are all 1 color there are no
> stars in them…"* — the developer, from live play.

Two claims, and they have different answers.

| | |
|---|---|
| **"these are all 1 color"** | **True, and it was not a bug.** Every star ink was `hullSteel`, `hullLight` or white, and `starFieldSprite` drew each halo in its star's own colour. The rule that did it was written above `STAR_LAYERS`: *steel value ramp only … never by hue*. It obeyed style-guide §1; the compositor page the developer picked from did not. Nobody noticed the two disagreed. |
| **"there are no stars in them"** | **Measured false of the blooms.** 36 bloomed stars on a 1440×900 screenful, **0 of them without a core**, and the core is the brightest pixel in every one — standing **33 / 91 / 183** luma above its own halo on `deep` / `mid` / `near`. The round things in that frame that genuinely have no star are **2–100× bigger**. |

Everything below is measured on the served bundles, main against this branch,
desktop 1440×900 at dpr 2, `?debug=1&freeze=1`, same seed, same pinned
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

**Re-measured for r12-01**, the merge that brought `u14-01`'s self-hosted
Audiowide and Oxanium onto this branch. Everything in this section is now
measured against `origin/main` at `94f9483` — real typefaces, `a0-21`'s arc chord
— because the numbers below were originally taken against a main that drew in
fallback type, and a re-baseline justified against the wrong main is not
justified at all.

Five tables, all through one instrument, because a re-baseline cannot be
attributed from one comparison:

| table | what it compares |
|---|---|
| `golden-diffs.branch-vs-main.json` | this branch's **committed** baselines against main's |
| `golden-diffs.noise-floor.json` | two independent regenerations of one source |
| `golden-diffs.main-drift.json` | main's committed bytes against **main regenerated here** |
| `golden-diffs.main-vs-branch-regenerated.json` | the two builds regenerated side by side, container held constant |
| `golden-diffs.committed-vs-regenerated.json` | what is committed, against a fresh regeneration of the merge commit |

### The noise floor, and the one thing in this repo that can never reproduce

Two independent regenerations of the same source differ on **21 of 44** — and
**every differing pixel, in all 21, lies inside a 38×8 px box in a screen
corner.** Not one pixel moves anywhere else.

That box is the **build badge**. `vite.config.ts` stamps the short git sha into
`__BUILD_INFO__` at config load, so a frame carrying it changes whenever the
commit does. The consequence is worth stating plainly because it bounds what any
golden in this repo can promise:

> **No baseline here can ever be byte-exact with the commit that carries it.**
> Committing a freshly-shot golden changes HEAD, which changes the badge. The
> honest standard is `maxDiffPixelRatio` plus "no unexplained change" — not byte
> equality, which is unattainable by construction.

Outside that box the renderer is **deterministic to the byte**.

### The container is a match for CI, on exactly the frames being re-baselined

Main's own source, regenerated here, against main's committed bytes:
**23 of 44 byte-identical**, and the 21 that differ are badge-only again.

**All five of the frozen plates this branch re-baselines are among the 23** —
byte-for-byte, with the self-hosted faces in frame. That is the permission slip
for writing a baseline at all (the a0-14b / a0-05b precedent: a baseline shot on
a box that renders differently from CI is wrong everywhere except that box).

It is also a marked improvement on what this file reported before the merge —
**35 of 44 drifting, `desktop-hud-top` at 98.8%** with the committed baseline
reading `TOTAL` where the build drew `ORE`. `u14-01` re-baselined all 44 and
cleared it. Nothing is left of that finding but the badge.

### Five re-baselined — and every moved pixel is a disc, not a glyph

| baseline | pixels moved | of | mean ΔY′ | clusters | widest |
|---|---|---|---|---|---|
| `desktop-frozen` | 187 | 1,024,000 | +1.67 | 4 | 11 px |
| `desktop-frozen-teams` | 187 | 1,024,000 | +1.67 | 4 | 11 px |
| `phone-landscape-frozen` | 34 | 329,160 | +2.06 | 1 | 7 px |
| `phone-landscape-frozen-teams` | 34 | 329,160 | +2.06 | 1 | 7 px |
| `phone-portrait-frozen-teams` | 34 | 329,160 | +2.08 | 1 | 7 px |

The **clusters** column is new, and the merge is why. A bounding box cannot tell
a bloom from a word: `desktop-frozen`'s box is **1068×125** and crosses two
nameplate rows, which post-merge are drawn in real Oxanium for the first time. So
the moved pixels are flood-filled into 8-connected runs instead. Four runs, none
wider than **11 px** — discs. A HUD word is not 11 px long.

`plates/golden-*.png` cuts that box out of both frames, main above and this
branch below, difference beneath at ×10 — the only amplified thing on the plate,
and it says so on its face. Every one was looked at. **On desktop the difference
row is four isolated blue points and nothing else**: no entity, no HUD, no text,
no panel. On the phone plates it is one star whose grey halo becomes teal while
its white core stays put — the difference row is a *ring with a dark centre*,
which is the round in one image.

And what is committed reproduces: a fresh regeneration of the merge commit from
a clean worktree returns **all five byte-identical**.

### The tint moves 18 baselines, not 5 — the other 13 keep main's bytes

With the container held constant, **39 of 44 move, and every one is either the
build badge (21) or the bloom tint (18)**. Nothing else in the suite moves at
all. Of the 18 the tint reaches, five are the merge's conflict set and are
re-baselined here. **The other 13 are left on main's committed bytes:**

| baselines | moved | of frame | signature |
|---|---|---|---|
| `desktop-build-wheel`, `-short`, `desktop-upgrade-wheel`, `-short` | 213 | 0.02% | ΔRGB `[−9.3, −1.5, +2.6]` |
| `desktop-pause`, `desktop-pause-confirm` | 117 | 0.01% | ΔRGB `[0, 0, +1.0]` |
| `phone-landscape/portrait build+upgrade wheel` (4) | 104 | 0.03% | ΔRGB `[−3.2, +3.4, +7.6]` |
| `phone-landscape-hud-top` | 34 | 0.04% | ΔRGB `[−3.0, +3.2, +6.0]` |
| `phone-landscape-pause`, `phone-portrait-pause` | 9 | 0.00% | ΔRGB `[0, 0, +1.0]` |

**This corrects a sentence this file used to carry.** It said the baselines left
alone were "none of it the backdrop". Thirteen of them *are* the backdrop. Before
the merge that was invisible — buried inside the 35-frame drift `u14-01` has
since cleared — and it is visible now only because main's bytes finally
reproduce. Said here rather than left to be discovered.

They are not re-baselined, and that is a judgement rather than an oversight:
r12-01 scopes this rescue to the five that collide, all thirteen clear the 1%
budget by 25× or better, and re-baselining them would re-stamp thirteen build
badges to buy a fidelity the badge takes straight back. **Widening it is the
Director's call.**

---

## Running it

```sh
# main's bundle on 4923, this branch's on 4922
npx vite preview --outDir /tmp/dist-a0-22-shipped --port 4923 --strictPort &
npm run build && npx vite preview --port 4922 --strictPort &

node evidence/a0-22-bloom-colour/probe-star-in-bloom.mjs 4923 shipped
node evidence/a0-22-bloom-colour/probe-star-in-bloom.mjs 4922 tinted
node evidence/a0-22-bloom-colour/shoot-and-plate.mjs 4923 4922
node evidence/a0-22-bloom-colour/diff-goldens.mjs git:origin/main tests/mobile/goldens.spec.ts-snapshots branch-vs-main
node evidence/a0-22-bloom-colour/plate-goldens.mjs origin/main
```

Nothing in `src/` is touched by any of it: the stage is reached through Pixi's own
devtools hook (`__PIXI_APP_INIT__`), set from a Playwright init script before any
page script runs, so the same files measure the served bundle of any commit.
