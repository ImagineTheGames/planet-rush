# p1-06 — the level badge, and the absence around it

The developer, 2026-08-07, verbatim:

> *"we can show the LEVEL but not XP (and show it only in the lobby)."*

The brief's evidence line asks for **two frames of the same seat**: a lobby row
carrying the badge, and an in-match nameplate at that seat carrying none. *"The
pair is the ruling, shown."* Four more frames make the pair readable and keep it
from being a lucky crop.

Every frame is the **real booted client** at **844×390 dpr 3** — a landscape
phone, the orientation this screen is locked to and the width the roster row's
chips are tightest at. The lobby is reached with real presses (PLAY → PLAY SOLO),
never by calling a seam, and the career is written into
`planet-rush:profile` through the shipped shape before boot, so the number in the
picture is one `loadProfile` produced rather than one this script typed.

Reproduce: `node evidence/p1-06-lobby-level-badge/capture.mjs` (after `npm run
build`). Read-backs are in `frames.json`.

| # | Frame | What it shows |
|---|---|---|
| 1 | `1-lobby-roster.png` | The whole roster at a **level 7** career. `LVL 7` sits on `P1 YOU`'s row, in the trailing chip. **Seven bot rows carry `EASY` / `MEDIUM` / `HARD` in that same chip and no level at all.** |
| 2 | `2-in-match-nameplates.png` | **The same seat, after RUSH!** The lobby is gone (`__lobby.visible === false`), the station and ship nameplates read `YOU`, and there is no level and no XP anywhere on the HUD, the bars or the plates. This is the absence at the moment GDD §2.2's fog rule applies. |
| 3 | `3-your-row-crop.png` | The badged row at the size it is drawn: `TAKEN │ P1 YOU ★ │ LVL 7`. The chip is ~54 px — see the note below about why that matters. |
| 4 | `4-a-bot-row-crop.png` | The identical crop one row down: `BOT │ P4 Foreman │ MEDIUM │ ?`. **The same chip, a different occupant** — the clearest single picture of "the badge is yours and nobody else's". |
| 5 | `5-lobby-at-level-2.png` | The same roster with a level-2 career. The number moves with the profile; it is not a constant baked into the view. |
| 6 | `6-frozen-scene-no-levels.png` | The frozen debug world (`?debug=1&freeze=1`) — a match reached with **no lobby anywhere near it**, with the same level-7 profile on disk. Still no level, still no XP. |

## Read-backs, from the client itself

`__lobby.levelBadges` — the words the roster actually drew, one per seat — reads
the same in every lobby frame:

```
level 7 career : ["LVL 7", null, null, null, null, null, null, null]
level 2 career : ["LVL 2", null, null, null, null, null, null, null]
after RUSH!    : lobby.visible === false
```

One badge, on seat 0, which is this client's seat. Seven nulls.

## The honest note: a full-frame golden cannot see this chip

The badge is a ~54 × 48 px chip on a 2532 × 1170 frame. The mobile goldens
compare whole frames at `maxDiffPixelRatio: 0.01`, which is ~29 600 pixels of
slack — an order of magnitude more than the badge occupies. **The five lobby
baselines therefore passed unchanged against a build that had just added it.**

That is not a golden being wrong; it is a golden being the wrong instrument for a
chip this size. Both halves were fixed rather than one:

- the five lobby baselines were **re-generated**, so what ships as the picture of
  this screen is the screen that ships;
- a **tight golden over the badge's own bounds** was added
  (`tests/mobile/goldens.spec.ts`), where the chip is most of the frame and the
  1% tolerance is antialiasing slack again rather than a blind spot.

The guarantee that the badge appears **nowhere else** is not a picture at all —
it is `src/ui/level-badge.test.ts`, which asserts the absence over `nameplates`,
`nameplates-view`, `hud` and `chrome`, and over `nameplateModel` and
`endOfMatchModel`, with the developer's sentence quoted in the test names.
