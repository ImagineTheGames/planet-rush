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

Build under glass: **`4bb8a15`**.

## What the gallery proves — and what it does not

**Verified (10):** desktop boot; landscape-phone boot; the live HUD (ore
squares + counting wave clock + controls strip), with 2× close-ups of the ore
readout and the controls strip; the idle touch affordances and the left stick
engaged under a thumb; the ROTATE overlay in portrait (iOS-Safari capability
profile); and the frozen golden scene on both desktop and phone.

**Inconclusive (1):** portrait on stock lock-capable Chromium — the overlay is
correctly *absent* there, so that shot documents the gate rather than the
overlay. The overlay itself is proven by `rotate-overlay-portrait-ios`.

### The four M2 re-tag gates all FAILED — features merged, client not wired

The post-retraction gate asked for verified evidence of the **8-planet ring**,
the **Build wheel open with costs**, a **turret mid-construction**, and the
**alarm arrow**. None are visible in the shipped client (`4bb8a15`):

| Gate | Shot | Result |
| --- | --- | --- |
| 8-planet ring on screen | `planet-ring` | **failed** — only asteroids + ship render |
| Build wheel open w/ costs | `build-wheel-open` | **failed** — no wheel/segments/costs after holding E |
| Turret mid-construction | `turret-under-construction` | **failed** — no turret, no planet to mount on |
| Alarm arrow | `alarm-arrow` | **failed** — no alarm frame/arrow after 2 min idle |

Root cause is visible in the code, not just the pixels: `src/render/index.ts`
draws only ships, asteroids, ore chunks and beams (no planet/turret path), and
`main.ts`'s `feedHud()` never sets any planet-HP, wheel, or alarm field — so
those HUD surfaces sit at their hidden defaults. The sim *does* build the ring
and simulate turrets/alarms; the client simply never renders them. This matches
the retraction on `06b5c31` ("features merged but never wired into the client").

**These four gates do not pass. M2 should not be re-tagged on this build.**
