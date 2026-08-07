# a2-03 — facilities: THE CUTTERHEAD · working notes

Branch: `agent/art/a2-03-planets-biomes` · from `c2d401f` (main).

Working note, not evidence. The DoD, the PR body and QA attestation are the record.

## The pick

Developer, **2026-08-07T16:53Z: `D — The Cutterhead`**, from
`docs/art-direction/facility-concepts-r2.html`. D beat E (Hopper Yard) and F (Open Cut).

Round 1 (`facility-concepts.html`) is **denied history** — DENY ALL 2026-08-06T01:31:49Z,
*"none of these look like a mining space station"*. Nothing here is sourced from it.

## BUILT

- `2d0963a` — the generator. `src/art/stations.ts` rewritten; `src/art/wrecks.ts`
  rebuilt on it; `palette.ts`, `catalogue.ts`, `atlas.ts`, contact sheet, tests.
  **Plus `src/render/index.ts`** — see THE FINDING below.
- `04c8c2e` — five goldens re-baselined, plus `evidence/a2-03-cutterhead/`
  (private-port playwright config + `verify-served-build.mjs`).

## THE FINDING — read this first, it is the biggest thing in the brief

**`stationSprite()` was not what the game drew.** `src/render/index.ts`
`stationBody()` hand-drew the home from three `Graphics` discs in hexes that are
in no palette (`0x2f4a63` ocean, `0x2a3038` wreck, `0x1a1f26` dead core) and a
plain stroke for the beacon ring. The art pipeline's station generators were
reviewed, catalogued, contact-sheeted and palette-audited — and the player saw
something else, which no audit could reach because `compliance.ts` walks the
sprite IR and this was never a sprite.

So the facility board's whole verdict was being passed on art nobody shipped.
`stationBody()` now calls `stationSprite` / `stationWreckSprite` /
`beaconRingSprite` through `drawSprite`, the same verb turrets and hulls use.

`src/render/index.ts` is the Platform Engineer's file. The edit is one block,
flagged in the commit message and the PR body. **Without it the DoD is
unreachable** — an art-only change moves no golden, because no golden was ever
showing the art.

## DECISIONS

- **The claim rock is `rockBody` `#484E57` (L77), not the board's `#5A626B` (L97).**
  The two boards disagree with each other: `scene-gallery.html` inks rock at
  `#454E59` L77 and a3-01 moved the whole rock family there three days ago
  (merged, PR #308). Drawing this facility's claim 20 luma off every asteroid in
  the field would split the rock family and re-open the gate a3-01 just closed.
  Rejected: matching D's hex. Said with numbers in the PR.
- **One new shade, and it is exact.** `hullWell = shade(hullSteel, 0.72)` =
  `#2D3239`, which is the board's recess hex **channel-for-channel** — unlike the
  rock hexes, this one is on the ramp. Deleted `oceanSteel`/`oceanDeep` with the
  ocean; `oceanDeep` was byte-identical to `hullDark` anyway.
- **The board's `#939BA5` did not become a token.** It is a composite —
  `hullSteel + hullLight @0.55`, the lug's lit plate — and the probe proves it
  arises from the ramp rather than being authored. Rejected: a `hullSheen` token
  for something two existing tokens already make.
- **Ownership reaches the body.** `stationSprite` takes a `playerId` and the atlas
  key gained the owner, so a rig is per-owner (≤8 textures a match, built once).
  Without it the board's ownership card is unbuildable and ownership is one ring.
- **The derelict is a palette map, not a second drawing.** `#bD` and `#bDd`
  differ by a substitution table and a damage mask, so the generator does too.
  That is what makes a wreck recognisably *that* station.
- **The wreck may now carry role `ore`.** The board's derelict spills a split
  hopper on purpose — *"the only yellow left is ore, which is why anyone comes"* —
  and GDD §2.7/§2.1 make derelicts lootable. `generators.test.ts` asserted no ore
  role at all; that was right when the debris field carried every scrap. Role
  `core` staying absent is the absolute part and is now asserted on its own.
- **The derelict lost its hazard tape** rather than keeping a `danger`-role shape.
  A wreck carries no danger vocabulary at all (§8), and nothing is being loaded.
- **Seams are chordal, not radial.** First pass drew them radially and the reactor
  read as a sunburst. A vein in rock does not point at anything.
- **Turret bodies are NOT drawn into the station.** The board's live card shows
  four turrets seated on four lugs; those are sim entities that slide around the
  rim (`turretOrbitPos`). The body draws the eight **seats**, and the real turret
  sprites sit on them.
- **Extent 1.95.** The spoil boom's truss ends at 1.68 R and its tailings drift to
  ~1.85. The arm leaving the circle is the anti-planetoid mark; it gets the room.

## The golden traps — both were live, both were paid

1. **Shared port.** `playwright.config.ts` pins 4173 with `reuseExistingServer`.
   Shot on **4291** via `evidence/a2-03-cutterhead/playwright.a2-03.config.ts`,
   with `verify-served-build.mjs` reading the bundle back first. That script also
   had to learn that `vite preview` binds `localhost` → `::1` only in this
   container while Node's `fetch` prefers the A record: it now tries `localhost`,
   `127.0.0.1` and `[::1]`. A flaky verifier is worse than none.
2. **Sub-tolerance staleness.** `--update-snapshots` only rewrites a baseline whose
   diff **exceeds** `maxDiffPixelRatio` (0.01). The station is ~1.26% of a
   1280×800 frame and mostly under the ring stack, so `desktop-frozen` **passed
   against a baseline of the old planetoid**. Fixed by deleting the whole snapshot
   directory and regenerating.

## What re-baselined, and what deliberately did not

A from-scratch regeneration rewrote all 31 goldens. Only **five** are committed:

    desktop-frozen                strong-diff bbox [660,325]-[810,517] / 1280x800
    desktop-frozen-teams          strong-diff bbox [660,325]-[810,517] / 1280x800
    phone-landscape-frozen        strong-diff bbox [443,120]-[591,312] / 844x390
    phone-landscape-frozen-teams  strong-diff bbox [443,120]-[591,312] / 844x390
    phone-portrait-frozen-teams   strong-diff bbox [ 77,443]-[269,591] / 390x844

Every one of those boxes is the station and nothing else.

The other 26 are **menu screens** (title, settings, doors, codex, lobby,
pause-confirm, end-of-match, eliminated) whose diffs are **horizontal text drift
across every label**, bounding-box the full frame, with no station in them — a
font-metrics difference between this container and whatever shot the committed
baselines. `desktop-build-wheel` and `desktop-pause` show max channel delta 6 and
9 (pure antialiasing), which proves text *can* match here, so the drift is
screen-specific and not mine. They were reverted. **Flagged to QA** — someone
should work out why Audiowide/Oxanium tracking differs per box before the next
menu brief re-baselines 26 files by accident.

## Measured, against the board

`evidence/a2-03-cutterhead/probe-facility-palette.mjs` shoots D's live-at-rest
card and this branch's `stationSprite()` through the same SVG→Chromium path at
the same scale, and histograms both:

| token | board share | sprite share |
|---|---|---|
| `hullSteel` | 12.88% | 15.48% |
| `decalInk` | 12.36% | 12.90% |
| `hullShadow` | 9.91% | 11.09% |
| `hullDark` | 7.85% | 6.91% |
| `signalYellow` | 5.14% | 4.57% |
| `hullLight` | 3.91% | 3.41% |
| `coreHot` | 1.37% | 1.31% |
| `hullWell` | 1.02% | 1.13% |

Every measured sprite colour is a token or a two-token composite — the three
non-token entries resolve to `rockBody + coreHot @0.25`, `hullShadow + oreDeep
@0.25` and `hullSteel + hullLight @0.55`, each within 1/255. The board's own
histogram carries the same class of composite (`#7C7E70`, `#737466`).

The LIVE column in the readback sits ~20/255 toward plasma on every sample: the
frozen home has **two shield generators standing**, and a shield is a translucent
plasma bubble over the whole body. That is the shield doing its job. Do not read
the live column as palette drift — it was nearly read that way here.

## NEXT

- PR against main.
- GDD §5.4 still says the home is a planetoid with steel-blue oceans and
  patina continents. The pick supersedes that in fact. `style-guide.md` §5 has
  moved and carries a note; **GDD is the Director's file** — proposed as an
  amendment in the PR, not edited here.
- The 26 menu goldens' text drift is QA's to chase (above).
