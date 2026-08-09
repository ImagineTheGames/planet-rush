# Planet Rush — design handoff: station look & space backdrop

You are picking up the mining-station look and the space backdrop. The game repo is
**public**, so every URL below can be fetched directly.

---

## READ FIRST — the board on `main` is out of date

`docs/art-direction/facility-concepts-r2.html` on `main` still draws **four turrets into
every station body** and labels them (`TURRET on the rim`, `TURRET on the corner cut`,
`ANCHOR LUG + TURRET`). The developer removed those on 2026-08-07:

> *"an ammendment to the new mining station, we dont need the turrets on it, those will be
> built externally as it already is...."*

The correction lives in **PR #313**, deliberately held until it rebases onto the new station
art. **Do not source turret geometry from the board on `main`.**

---

## 1 · Fetch these

**The facility board — visual truth for stations.** Concept **D · THE CUTTERHEAD** is the
ratified pick. Round 1 was denied in full — *"none of these look like a mining space
station"* — and round 2 exists because of that sentence.

- `https://raw.githubusercontent.com/ImagineTheGames/planet-rush/main/docs/art-direction/facility-concepts-r2.html`
- Corrected (no hull turrets, DEFEND card rewritten), on the PR branch:
  `https://raw.githubusercontent.com/ImagineTheGames/planet-rush/agent/art/a2-04-no-hull-turrets/docs/art-direction/facility-concepts-r2.html`

**The shipped station generator** — what the game actually draws. Procedural, seeded, no
binary assets. Landed on `main` in PR #312.

- `https://raw.githubusercontent.com/ImagineTheGames/planet-rush/main/src/art/stations.ts`

**Palette, tone and style.** Cold Vacuum. Every colour derives from here; the board invents
no palette.

- `https://raw.githubusercontent.com/ImagineTheGames/planet-rush/main/src/art/tokens.ts`
- `https://raw.githubusercontent.com/ImagineTheGames/planet-rush/main/src/art/palette.ts`
- `https://raw.githubusercontent.com/ImagineTheGames/planet-rush/main/docs/style-guide.md`
- `https://raw.githubusercontent.com/ImagineTheGames/planet-rush/main/GDD.md` (tone is §4.7,
  amended to clean modern sci-fi; silhouette rule is §2.11)

**Other boards for context:** `concept-boards.html`, `concept-round2.html`,
`cold-vacuum-elements-r2.html`, `scene-gallery.html`, `ship-classes.html`, `ui-mockup.html`,
`GAP-ANALYSIS.md` — same `docs/art-direction/` directory.

---

## 2 · Already decided — do not re-open

### Backdrop, ratified 2026-08-07

| Axis | Decision |
|---|---|
| Ground | `#010204` — "Floor", replacing the shipped `#0d1015` |
| Bloom rule | **Seeded scatter** — any magnitude, chosen by seed. Not a brightness threshold. |
| Bloom intensity | **Subtle** — the lowest of three shown. Do not raise it. |
| Nebulae | All six ship, **one per map**, including NONE as a legitimate assignment. |

The six: **NONE** (darker, nothing else) · **Coalsack** (occluding dust — stars go missing
behind it, no additive blend) · **Iron Veil** (rust band, low density) · **Patina Drift**
(wispy teal, from the palette's own green) · **Plasma Reef** (clotted cyan — brightest and
most expensive) · **Deep Ember** (sparse, low alpha, felt at the frame edges).

### Station

- **D · The Cutterhead** is the ratified silhouette — a bore head, not a planetoid.
- **No turrets on the hull.** Eight bare anchor lugs with an owner keyway. The gun that
  stands on a lug is a separate bought, capped, destructible building (GDD §2.5, §2.6). A
  station with none built must not look armed, or the silhouette lies about state.
- Ownership readable at any zoom; a derelict variant exists.

---

## 3 · Constraints — these are not style opinions

- **Never change a ship's silhouette.** GDD §2.11 and style-guide §4: *"a silhouette on the
  minimap is information."* Colour, livery, decals, trim, engine glow are free. Outline,
  proportions and class-identifying geometry are not.
- **Never ship binary art.** Everything is procedural, deterministic and seeded through
  `src/art` generators — same seed, same frame.
- **Keep the load-bearing colours readable:** owner ring `#4dc3ff`, threat red `#b23a3a`,
  signal yellow `#f2d24b`. A backdrop that eats the owner ring is disqualified however good
  it looks. Worst case to beat: Floor under Plasma Reef — cyan additive light over a cyan
  ring.
- **Judge at 390 px landscape.** The game is landscape-locked on phones; that is the screen
  the art must survive.
- **Respect the per-frame budget and `VfxAutoQuality`.** An option that only survives on
  desktop must say so next to itself.

---

## 4 · Already measured — do not re-argue

Floor is **better** for rock legibility than the shipped ground, not worse. A darker ground
raises contrast for anything lighter than it:

```
rockBody #484e57  vs shipped #0d1015 :  2.27 : 1
rockBody #484e57  vs Floor   #010204 :  2.47 : 1   (8.9% more contrast)
```

Space is black and the asteroids are grey. Do not add rim lighting or a contrast floor to
compensate for a problem that does not exist.
