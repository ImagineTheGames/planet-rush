# a0-07b — the sky reads as stuck to the camera

The developer, from live play, with a screenshot of the match:

> *"the parallax effect is kind of broken, those bloom as moving with the ship on
> the front layer, they are supposed to be attached to stars..."*

Nothing was screen-locked in code. The distant skies drifted at parallax **0.05**,
exactly **half** the farthest star layer's 0.10, and a discrete clot that falls
that far behind the field it is drawn among is not read as *further than the
stars* — it is read as *not part of them*, and the only other plane a cockpit view
offers is the glass. The fix is one number: `SKY_PARALLAX = 0.085`, just behind
the deep star layer, still strictly slower than it.

| | per screen-width flown (844 u) | against the deep star layer |
|---|---|---|
| sky 0.05 (reported) | 42 px | slips 42 px behind — half the field's own travel |
| **sky 0.085 (now)** | **72 px** | **slips 12 px behind** |
| stars, deep 0.10 | 84 px | — |

## The frames

Motion, so a still cannot carry it. Both figures are the same shape: three camera
positions along one straight flight, the old build above the new one.

| file | what |
|---|---|
| `1-strip-plasmaReef-before-vs-after.png` | deterministic. Plasma Reef on The Oval — the most object-like sky |
| `1-strip-deepEmber-before-vs-after.png` | deterministic. Deep Ember on The Line — one of the sparse ones |
| `3-live-plasmaReef-before-vs-after.png` | the same flight through the **real shipped renderer**, sim running |
| `3-live-deepEmber-before-vs-after.png` | likewise |
| `2-live-*.png` | the individual live frames the two composites are built from |

**The dashed ring is the whole trick.** It is drawn *into the deep star layer*, at
the tracked clot's position in the first frame — so it is a fixed point in the
star field, marking where the stars say that clot should still be. Each
deterministic figure then repeats its three frames zoomed 2.4× on that ring, with
the crop anchored to the ring: anything drifting out of the middle of those crops
is drifting away from the star field. On Deep Ember the old build's ember has left
its ring entirely by the third frame; the new build's is still under it.

Each deterministic frame also carries a **control**: the fraction of the visible
window the sky paints at all. The two rows necessarily draw a differently *sized*
field (`coverSpan` grows with the parallax, so a faster layer has somewhere to
move to), which means they cannot show the same clots — so "did the sky get
denser?" has to be answerable, and the number says it did not (reef ~50% in both
rows, ember ~38%).

## Rerunning it

```sh
# the deterministic figure — no server needed
npx vite-node evidence/a0-07b-sky-parallax/render-parallax-strip.ts

# the goldens, on a port nobody else on this box is holding
npx playwright test --config evidence/a0-07b-sky-parallax/playwright.a007b.config.ts \
  tests/mobile/goldens.spec.ts --update-snapshots

# the live flight — needs THIS branch on one port and origin/main on another
node evidence/a0-07b-sky-parallax/verify-served-build.mjs 4272
node evidence/a0-07b-sky-parallax/verify-served-build.mjs 4273 --before
node evidence/a0-07b-sky-parallax/shoot-live-flight.mjs 4272 4273
```

`playwright.config.ts` pins the preview to **4173** with `reuseExistingServer`,
and several lanes share this box: a suite that reuses somebody else's server
shoots somebody else's bundle and comes back looking correct (a3-01). Hence the
private ports, and hence `verify-served-build.mjs`, which reads the served
JavaScript back and asserts the parallax in it — `SKY_PARALLAX=.085` present and
the five inlined `parallax:.05` gone, or exactly the reverse under `--before`.

Baselines are **deleted** before regenerating, never merely updated:
`--update-snapshots` on Playwright 1.49.1 refuses to rewrite a baseline whose
diff is under `maxDiffPixelRatio`, and a parallax change moves the void by a few
dozen px — well inside that trap (r5-01, a3-01).
