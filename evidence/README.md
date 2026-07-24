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
