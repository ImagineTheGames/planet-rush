# evidence/ — Planet Rush proof gallery (through M2)

Owned by the QA Manager. Every image here was captured against the **real
preview build** (`npm run build && vite preview` on :4173) with headless
Chromium, then **looked at** and attested in `manifest.json`. Attestations
describe what is *visible*, never what the code claims. A `failed` verdict with
a clear description is a real result, not a gap in the gallery.

- **Images:** `images/*.png`
- **Attestations + verdicts:** `manifest.json`
  (`{ id, title, area, image, capturedAt, buildSha, attestation, verdict }`)
- **Camera:** `capture.mjs` — `node evidence/capture.mjs [shot-id ...]`
  (drives each scene, sets the device profile / URL / any input, then shoots).

Build under glass: **`c97f60a`** (M2 wired in — PR #40, `m2-wire-the-war`).

## What the gallery proves — and what it does not

**Verified (10, boot/HUD/touch/golden):** desktop boot; landscape-phone boot;
the live HUD (ore squares + counting wave clock + controls strip), with 2×
close-ups of the ore readout and the controls strip; the idle touch affordances
and the left stick engaged under a thumb; the ROTATE overlay in portrait
(iOS-Safari capability profile); and the frozen golden scene on both desktop and
phone. (These were shot on `4bb8a15`; the surfaces are unchanged.)

**Inconclusive (1):** portrait on stock lock-capable Chromium — the overlay is
correctly *absent* there, so that shot documents the gate rather than the
overlay. The overlay itself is proven by `rotate-overlay-portrait-ios`.

### The four M2 re-tag gates now all PASS — refreshed on the wired build

The first gallery pass (PR #42) honestly attested these four FAILED on `4bb8a15`,
because the render/HUD wiring had not merged. It has now (PR #40), and a fresh
capture on `c97f60a` shows the war on screen:

| Gate | Shot | Result |
| --- | --- | --- |
| 8-planet ring on screen | `planet-ring` | **verified** — 8 owner-coloured planets ring the central field (3600×2000 frame) |
| Build wheel open w/ costs | `build-wheel-open` | **verified** — 5 wedges; costs 3/5/1; ore hub; SPEND tooltip |
| Turret mid-construction | `turret-construction` | **verified** — plasma progress arc on the home planet; ORE 3→0 |
| Alarm arrow | `alarm-arrow` | **verified** — red frame + "under attack" banner + edge arrow home, mid-siege |

Notes on the two that needed real work to *see*:

- **planet-ring** — the follow-camera renders 1:1 and holds the local ship
  centred, so a normal frame shows only the home planet. The ring is real; a
  3600×2000 viewport is just wide enough to frame all eight.
- **alarm-arrow** — offline the seven rivals are live bots, so the old "no
  attacker" caveat is gone. Abandoning your home (hold A, thrust into the field)
  draws a bot onto the undefended core within ~13 s; the shutter is gated on the
  sim's tick counter (`__planetRush.ticks`), so the frame lands inside a genuine
  siege with home off-screen and the arrow pointing to it.

**All four gates pass on `c97f60a`. They no longer block the M2 re-tag.**

## Evidence round 2 — the five field-reported combat bugs (build `1c72d85`)

The developer played build `5254cfe` and reported five bugs; fix briefs m2-10..13
were meant to kill them. I captured four proof shots on the **live** `1c72d85`
preview and looked at every pixel. **Only one of the four is dead.**

| Field bug | Shot | Verdict |
| --- | --- | --- |
| Invisible enemy lasers | `enemy-beam-visible` | **failed** — no enemy beam ever draws, even point-blank |
| Turret never visibly fired | `turret-firing` | **failed** — no muzzle flash / projectile; turret never seen to engage |
| Build button vanished after building | `build-button-after-build` | **verified** — button survives the whole cycle, still hittable |
| Missing enemy health bars | `enemy-healthbars` | **failed** — no HP bar over any non-local ship, even one taking damage |

**Headline: three of the four "fixes" are green in unit tests but were never
wired into the shipped client (`src/main.ts`), so they do not reach the screen.**
The sim/UI machinery is correct and unit-tested; the last one-function wiring
step in each was left as a "handoff to Platform" that never landed. What I saw:

- **enemy-beam-visible / turret-firing** — the client's beam feed
  (`main.ts` `currentBeams()`) draws **only the local player's** beam; the
  `combatBeams(world)` selector that would surface every ship's and turret's
  beam is never consumed. In the shot, my *own* ship's beam renders perfectly
  (blue line, clamped to its hit, cyan impact glow) right beside enemy ships in
  a live firefight that draw **nothing** — the render path works; it is simply
  never fed enemy shots. The turret's muzzle flash rides that same dead feed.
- **enemy-healthbars** — the HUD's health-bar layer exists but `main.ts`
  `feedHud()` never fills `hudFrame.combatants`, so it is permanently starved.
  In the shot a bot is being cut by my beam (unmistakably in combat) with no bar.
- **build-button-after-build** — genuinely fixed: on a landscape phone the
  plasma BUILD button is still present and hittable after a turret finishes
  building (tapping it closes the wheel; the layout registry keeps its
  `build-button` entry through the whole cycle).

Staging note: these are emergent live-combat scenes, not frozen goldens. The
`combat-siege` / `core-siege` shots in `capture.mjs` drive a real siege — build a
turret, fly out to draw a bot chase back to home, open fire — under a wide
follow-camera frame; the four committed images are the clearest crops of those
runs. Re-running will vary in detail (live bots) but not in the verdict: across
~16 captured frames at many ticks, no enemy beam, enemy health bar, or turret
muzzle/shot ever appeared, while the local beam always did.

**Three gates FAIL on `1c72d85`. The field bugs are not dead — the two
one-function `main.ts` wiring gaps (beam feed, combatants feed) need to close.**

## Evidence round 3 — re-verify after the wiring landed (build `0a3a313`)

m2-15 / m2-16 closed the two `main.ts` wiring gaps (PRs #60, #61) and shipped
deterministic `?debug=1&freeze=1` staging seams. I rebuilt HEAD of `main`
(`0a3a313`, clean tree) and re-staged the three failures through those seams —
`capture-round3.mjs`, not the flaky live-siege kite — then looked at every pixel
and read the instrument back.

| Field bug | Shot | Verdict |
| --- | --- | --- |
| Invisible enemy lasers | `enemy-beam-visible` | **verified** — a non-local beam draws, clamped to its hit |
| Turret never visibly fired | `turret-firing` | **verified** — a turret muzzle beam rises from the turret to a hit-dot |
| Missing enemy health bars | `enemy-healthbars` | **verified** — a two-part HP bar sits over a bot staged to 40% hull |

What I saw and how it was staged:

- **enemy-beam-visible / enemy-healthbars** — one 1900×1100 frame
  (`combat-staged.png`, zoom `combat-staged-zoom.png`). `damageEnemy(0.4)` parks
  a bot beside the centred local ship, `stageCombat()` gives that bot a beam.
  On screen: a cyan (non-local) beam ending on a hit-dot, and a two-part HP bar
  (~40% cyan fill + grey) above the bot. `__planetRush.beams` = two beams, both
  `shooter:1`; `__healthbarStage.bars()` = a `fraction:0.4` bar for `owner:1`.
  The local ship is not firing, so the beam is provably not mine.
- **turret-firing** — `turret-muzzle.png` (full 8-planet ring at 3600×2000) /
  `turret-muzzle-zoom.png`. `stageCombat()` mounts a live-muzzle turret on a
  rival planet; the follow-camera frames it. On screen: a vertical cyan muzzle
  beam from the turret body on the planet rim to a hit-dot. `__planetRush.beams`
  carries the `source:'turret'` record whose projected endpoints match the drawn
  beam. Honest scope: the staged turret is a rival's — but the bug was that *no*
  turret muzzle rendered, and friendly turrets draw through the same
  `combatBeams(world)` path now proven here.

No page errors in any capture. `build-button-after-build` was already verified in
round 2 and its `main.ts` path is unchanged, so it stands.

**All three gates PASS on `0a3a313`. This is the final combat-visibility gate for
the v0.1 classroom tag.**

## Evidence round 4 — the three v0.1 field reports (build `b65d6d5`)

The developer played v0.1 and reported three faults: the home planet against the
map edge, no main menu at boot, and turrets that should orbit the rim to face
threats. p1-01..03 (PRs #63 world-margin, #64 main-menu-wiring, #65 turret-orbit)
fix them. I rebuilt HEAD of `main` (`b65d6d5`, clean tree) and staged each tell on
the **live** preview — `capture-round4.mjs` — then looked at every pixel and read
the instrument back.

| Field report | Shot | Verdict |
| --- | --- | --- |
| No main menu at boot | `main-menu-at-boot` | **verified** — a CLEAN boot lands on the PLANET RUSH menu; PLAY builds the match |
| Home planet against the edge | `planet-clear-of-edge` | **verified** — ~260u of clear space between the home ring and the steel wall |
| Turrets don't face threats | `turret-orbit-facing` | **verified** — the turret slid ~180° around the rim to face its attacker, then settled |

What I saw and how it was staged:

- **main-menu-at-boot** — a clean boot at `/` (NO `?debug=1`, which would skip the
  menu). On screen: the `PLANET RUSH` wordmark over a plasma `PLAY` and a steel
  `SETTINGS` button, and **no match behind it** — no HUD, ship, or planets. The
  `?debug=1` match instrument `__planetRush` is absent and the menu seam reads
  `matchStarted:false`. I then pressed PLAY myself: the menu tore down and
  `matchStarted` flipped true — PLAY, not boot, starts the match.
- **planet-clear-of-edge** — `?debug=1&freeze=1`, a wide 2600×1600 follow-camera on
  the home planet (blue beacon ring, world 1968,1200). A bright vertical steel
  arena wall (the +x boundary at world x≈2400) runs down the right with a wide
  empty band between it and the ring — the planet is nowhere near the wall, and
  nothing hugs the boundary.
- **turret-orbit-facing** — live `?debug=1`. The home turret is born on the planet's
  EAST (wall-side) mount. Built it (ORE 3→0), then parked a live attacker on the
  WEST rim via `__healthbarStage.damageEnemy(0.5)`, held in the 240u range. On
  screen (crop `turret-orbit-facing-zoom.png`): the turret has slid to the planet's
  WEST rim, beside the attacker (teal ship + a 50% health bar), facing it. The
  muzzle world-origin read back moved from the east mount `(2123,1250)` to the west
  rim `(1964,1206)` and then held `(1964,1203-1204)` across 7 samples — settled, not
  thrashing.

Honest scope on the **two-attacker** clause: a genuine live two-bot siege on the
home turret could not be reproduced — across dense polling of a core-abandon run
AND a kite-them-home run the home turret fired **zero** frames, because the offline
bots never crossed within its 240u range. The one-bot `damageEnemy` seam is the
only in-client way to put an attacker in reach, so the shot stages one controlled
attacker; the "settles instead of thrashing" property is attested via the observed
single-target settle (a fixed rim angle held with no oscillation), not a
two-simultaneous-attacker frame, which is out of reach of the booted client here.

**All three v0.1 field reports are dead on `b65d6d5`.** No page errors in any
capture.

---

## Round 7 — the four maps and the picker, on the live build (`a5dd0b0`)

`capture-round7.mjs` — the map update (v0.2 gate). Five verified items, all on
the LIVE preview bundle at build `a5dd0b0` (clean, no page errors):

- **map-picker** — a CLEAN boot (no `?debug`, so the front-door menu is reached)
  on an emulated landscape phone (844×390, dpr 3, touch). All four map cards on
  the PLAY screen: **The Ring** preselected (cyan border), **The Compass**, **The
  Oval**, **Double Diamond** wearing its **VETERAN** tag. Each card's glyph
  matches its layout.
- **map-octagon / map-compass / map-oval / map-diamond** — one in-match wide shot
  per map under `?debug=1&freeze=1`, the map chosen the way the game chooses it
  (the picker's `planet-rush:mapId` localStorage key, seeded before boot). Each is
  cropped wall-to-wall from an oversized viewport; the on-screen planets match the
  shipped registry (`src/sim/maps.ts`) to **0.0 units** (logged self-check), so the
  live board IS the ratified layout. Octagon: 8 planets, one circle, exact 45°
  gaps. Compass: 4 corners + 4 edge midpoints. Oval: 8 on a wide equal-chord
  ellipse rim. Diamond: outer + inner diamonds, local player on an OUTER home.
- The **p1-09 home-field invariant** rides in a companion `*-fields.png` crop per
  map: octagon's shows all 8 field clusters in exact 8-fold rotational symmetry;
  the varying-radius maps show two planets at different centre-distances each
  carrying the same inboard field — congruent by construction, unfair in ground
  (diamond) but never in ore.

No page errors in any capture.

---

## Round 8 — ore HUD split + far-side turret coverage, on the live build (`dc7e2ac`)

`capture-round8.mjs` — the two v0.1.3 field reports, gating the patch after v0.2.
All items on the LIVE preview bundle at build `dc7e2ac` (clean, no page errors):

- **ore-hud-under-ship / ore-hud-deposit** — the split ore HUD on a desktop boot
  (`?debug=1`, 1280×800), driven through `window.__oreHudStage`. MINING: `mine(5)`
  while the boot bank is 3 → FIVE filled yellow squares drawn **under the ship**
  (screen centre, `y=423` below the ship) and the top-left reading **`TOTAL 3`** —
  two DISTINCT numbers, both matching the sim readout (`hold.filled=5`, `total()=3`).
  DOCKING: `dock(6)` at home → the sim auto-drains the hold; the captured mid-frame
  shows **one** filled square + five empties under the ship with an ore courier in
  flight, and the top-left risen to **`TOTAL 7`** (`hold.filled=1`, `total()=7`,
  `readout cargo≈1.97 / banked≈7.03`). The held count DRAINS while the TOTAL RISES:
  the field rule, on a real boot.
- **turret-far-side-engage / turret-far-side-context** — a turret built on the home
  planet's EAST mount (slot 0), then an attacker parked due WEST (the FAR side) via
  `__healthbarStage.damageEnemy`. The turret SLID ~180° around the planet body to
  the WEST rim and sits on the attacker there (grey disc at the planet's left edge,
  teal attacker just left of it). `window.__planetRush.beams` confirms the muzzle
  settling from the east/NE mount (`origin x≈2080`) to the west rim (`origin x=1964`)
  with its endpoint further west (`x≈1907`) — a beam **entirely west of the planet's
  west edge (`x=1994`), clean of the core** — held to 1–2 distinct rim positions
  (no thrash) and recurring across frames (fire interval 0.5 s, no idle gap). The
  planet's red under-attack alarm confirms the threat is real.
  - **Honest boundary:** no debug seam parks TWO simultaneous attackers around one
    turreted planet, so the two-attacker priority SPLIT (§3/§4 of the fix) is NOT
    reproducible as live pixels — it is proven by `tests/sim/turret-coverage.test.ts`.
    This round verifies with pixels + instrument the far-side reach-and-fire, the
    exact behaviour the developer reported missing.

No page errors in any capture.

---

## Round 9 — the projectile era, v0.2 report wave, on the live build (`de2fa64`)

`capture-round9.mjs` — the six v0.2 gates. All on the LIVE preview bundle at
build `de2fa64` (clean, no page errors). **4 of 6 verified; 2 inconclusive
because the instrumentation this build ships cannot exercise them — the tag
should wait on those two.**

**Verified:**
- **projectile-dodge** — LIVE, past the 10 s spawn-protection window. A three-frame
  composite: a red projectile MID-GAP between the ship and a still enemy (travel
  time, not hitscan; ship-vs-ship fire draws no beam); a red shot flying east into
  empty space the enemy has left (a miss); and the local ship's BLUE mining beam
  drawn as a line to a rock it strikes (`__planetRush.beams` source `ship`,
  origin→hit) — mining is STILL a beam. Data: a still target loses hull under fire
  while a moving target barely does across ~70 shots — dodging is real.
- **upgrade-wheel** — the radial UPGRADE wheel (`__upgradeWheelStage.openUpgrade`):
  BEAM 10→13 (4), ENGINE 100%→115% (3), CARGO 2→4 (2), HULL 50→60 (3) around a
  `999 / VANGUARD` hub — same wheel language as the Build wheel.
- **wheel-cycle-robust** — Build ×16 + Upgrade ×16 open/close cycles, `interactive()`
  true after every one (0 failures, frame-synced), wheel still opens fully after.
- **map-in-lobby** — clean-boot lobby in one screen: 8 roster slots + the hull
  picker + the arena row (Ring / Compass / Oval / Double Diamond·VETERAN) + RUSH!.
  No separate picker step.

Also confirmed in passing: the **top-right hull readout is gone** — top-right now
carries only the HOME core-HP bar.

**Inconclusive (instrumentation gaps — not defects):**
- **damage-all-classes** — the player's own projectiles are shown dropping an enemy
  hull bar 0.98→0.78, so hits register — but only for owner 1 (the Hauler). The
  `__healthbarStage.damageEnemy` seam always targets owner 1 and force-revives it,
  so the other three classes cannot be brought under player fire, and placeholder
  ships are identical triangles (class not pixel-readable). Needs a seam to damage
  an arbitrary-owner enemy (and/or class-distinct art).
- **repair-core-works** — the REPAIR CORE wedge is present in the Build wheel but
  greyed on a full (frozen) core. No debug seam damages the local core, and there
  is NO coreHp readback for the "captioned numbers" (HP rising) the gate asks for.
  Needs a core-damage seam + a coreHp readback.

No page errors in any capture.
