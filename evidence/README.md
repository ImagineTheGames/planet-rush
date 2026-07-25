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
