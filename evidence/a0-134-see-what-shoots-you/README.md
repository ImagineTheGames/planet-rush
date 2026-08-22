# a0-134 — the phone is being shot by a ship its screen does not draw

a0-131 put two real clients in one match for the first time and came back with a
disagreement it recorded as **failed**:

> **at the shipped VIEW 1× the phone player is being shot by an attacker its
> screen does not draw.**

Everything here re-stages that moment. The rig is a0-131's — the same profiles
(**HOST** desktop 1280×800 dpr2 pointer, **JOINER** phone 798×384 dpr2 touch),
the same two browser contexts against one room over real WebSockets, the same
local fleet (`tests/net/local-fleet.ts`), the same `frame()`/`note()` discipline,
and the same *measured* approach in the match (seven clicks at the left edge two
seconds apart, then one short hop). `lib.mjs` and `plates.mjs` **import** a0-131's
own modules rather than copying them, because a re-stage measured against a new
ruler is not a re-stage.

**Exactly one thing differs, and it is the finding: the joiner never touches its
VIEW control.** a0-131 had to press it twice for the attacker to be drawn.
Nothing here presses it. Whatever the phone shows is what the shipped default
gives a player who has touched nothing.

Two bundles are photographed through that one recipe:

| label | bundle |
|---|---|
| `before` | `origin/main` at `e1f0261f` — the tree a0-131 failed |
| `after`  | this branch |

No capture passes `?freeze=1` (`src/main.ts` sets `buildBadge.visible =
!flags.freeze`, so a frozen frame is one with the stamp deliberately hidden) and
no capture passes `?debug=1` (it nulls the main menu and the lobby, so there is
no online path at all). The build stamp is in the corner of every frame.

`measure.mjs` is the one thing here that *does* pass `?debug=1`, and it takes no
photographs: it reads `window.__viewStage`, whose `world()` returns
`renderer.visibleWorld` — the very rectangle the cull culls against. The finding
is a comparison between that rectangle and a weapon range, so neither half is
arithmetic written in the evidence.

## How to re-run it

```
# the fleet, once
LOCAL_FLEET=serve LOCAL_FLEET_PORT=8991 LOCAL_FLEET_EDGE_PORT=8992 \
  npx vite-node tests/net/local-fleet.ts &

# the two bundles, each pointed at that fleet
git worktree add /tmp/a0134-before origin/main
ln -s "$PWD/node_modules" /tmp/a0134-before/node_modules
(cd /tmp/a0134-before && VITE_ALLOCATOR_URL=http://127.0.0.1:8991 npx vite build --outDir dist-a0134-before)
VITE_ALLOCATOR_URL=http://127.0.0.1:8991 npx vite build --outDir dist-a0134-after

npx vite preview --outDir /tmp/a0134-before/dist-a0134-before --port 4319 --strictPort &
npx vite preview --outDir dist-a0134-after --port 4320 --strictPort &

# the numbers
BASE=http://localhost:4319 node evidence/a0-134-see-what-shoots-you/measure.mjs before
BASE=http://localhost:4320 node evidence/a0-134-see-what-shoots-you/measure.mjs after

# the photographs
A0_131_BASE=http://localhost:4319 LABEL=before node evidence/a0-134-see-what-shoots-you/capture-together.mjs
A0_131_BASE=http://localhost:4320 LABEL=after  node evidence/a0-134-see-what-shoots-you/capture-together.mjs
node evidence/a0-134-see-what-shoots-you/plates.mjs
```

`shots/` holds the specimens the plates are cut from and the JSON readbacks
beside them. Plates are composed nearest-neighbour and halved by dropping every
other pixel; nothing is resampled and nothing is annotated. Captions are here, as
words, rather than burnt into a picture.

## What came back

### 1. The extents, off the two bundles (`shots/view-extents-{before,after}.json`)

`renderer.visibleWorld`, read through `__viewStage`. `half-short` is half the
SHORT axis of that rectangle in world units — how far the camera draws toward its
nearest edge, and therefore the only number the sightline can be tested against,
because the camera centres the ship. The bar it has to clear is
**`WEAPON_RANGE` 260 + `SHIP_RADIUS` 16 = 276**.

| profile | CSS px | before: VIEW / world / half-short | after: VIEW / world / half-short |
|---|---|---|---|
| desktop (a0-131 HOST)   | 1280×800  | 1×   1280×800  **400** ✓ | 1×   1280×800  **400** ✓ |
| qa-phone (a0-131 JOINER)| 798×384   | 1×   798×384   **192** ✗ | 1.5× 1197×576  **288** ✓ |
| iphone landscape        | 844×390   | 1×   844×390   **195** ✗ | 1.5× 1266×585  **292.5** ✓ |
| iphone portrait         | 390×844   | 1×   844×390   **195** ✗ | 1.5× 1266×585  **292.5** ✓ |
| pixel landscape         | 915×412   | 1×   915×412   **206** ✗ | 1.5× 1373×618  **309** ✓ |
| iphone-se portrait      | 375×667   | 1×   667×375   **187.5** ✗ | 1.5× 1001×563 **281.3** ✓ |
| small landscape         | 568×320   | 1×   568×320   **160** ✗ | 2×   1136×640  **320** ✓ |
| ultrawide 21:9          | 2560×1080 | 1×   2560×1080 **540** ✓ | 1×   2560×1080 **540** ✓ |
| ultrawide 32:9          | 3840×1080 | 1×   3840×1080 **540** ✓ | 1×   3840×1080 **540** ✓ |

Every touch profile failed and only the two desktops and the two ultrawides
passed. Note the two portrait rows: the landscape lock hands the camera a
LANDSCAPE logical frame, so a phone held either way is the same screen and gets
the same answer — which is what tying the floor to `min(width, height)` buys.

**Nothing widened that did not have to.** The desktop and both ultrawides are
byte-identical rows before and after. Range is untouched and stays absolute at
260 for every one of them, so no screen here can reach further than any other —
the 32:9 half of this brief, answered by not doing anything to range.

### 2. The pair, re-staged (`images/a0-134-*`)

The recipe reproduced its geometry across both runs: `V-04-close-burst-12` is
`MATCH 1:41` on the before run and `MATCH 1:39` on the after run, with the two
ships in the same places. Read off the host frame — which is at `VIEW 1×`, where
one world unit is one CSS pixel, and the specimens are dpr 2 — the standoff is
**≈420 world units**, the same standoff a0-131 measured at 416.

`a0-134-the-pair-restaged-V-04-close-burst-12.png`, four panes:

- **top-left — BEFORE, the phone, `VIEW 1×`.** Its own station centred, its own
  hull, `HOME 92/100`, a red vignette on all four edges, and **no attacker
  anywhere on the glass**. No arrow, no marker, no nameplate. This is a0-131's
  sentence, photographed again on `origin/main`.
- **top-right — BEFORE, the desktop, same instant.** Both ships: its own at
  `1/50` and `P2` at `5/50`. It has drawn both throughout.
- **bottom-left — AFTER, the phone.** The reading is `VIEW 1.5×` **with nobody
  having pressed the control** — the rung it booted at — and the attacker's hull
  bar `8/50` is drawn at the left. Same match clock, same standoff, drawn.
- **bottom-right — AFTER, the desktop, same instant.** Unchanged: `1×`, both
  ships, exactly as the top-right pane.

`a0-134-the-view-chip-nobody-pressed-V-04-close-burst-12.png` is the top-right
corner of the two phone frames at 2×: `1×` beside `1.5×`. Two glyphs, and no
thumb anywhere near either of them.

### One thing this evidence does NOT claim

At the photographed instant the two ships are ≈420 units apart, which is **beyond
`WEAPON_RANGE` (260)** — the exchange that took the joiner's hull to `5/50` and
its station to `92/100` happened closer in, and what the phone could not draw is
the ship that had just shot it and was still sitting there. The property the fix
establishes is the tighter one: **inside 276 units, where a shot can actually be
fired, the shooter is on the glass.** That the after frame draws an attacker at
420 as well is a consequence of the rung, not of the property — 1.5× on a 798 px
phone buys ±598 units across — and it is stated that way round rather than
claimed as the property holding at 420.
