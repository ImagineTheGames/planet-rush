# a1-05 — an evidence round against the LIVE deployment

`evidence/manifest.json` held 138 items, three of them from this month, while
roughly twenty features merged in two days with CI green. This round adds **22
attested items**, every one of them shot against the build a player actually
loads:

> **https://imaginethegames.github.io/planet-rush/** — served sha **`7e175ac`**
> (GitHub Pages deployment of 2026-08-09T21:48Z, still the served build when the
> round closed).

Not a lane checkout and not `vite preview`. LESSONS §1 is about four feature sets
that merged green and were never wired into the boot path at all; only the served
bundle can answer that question. Each shot re-reads the sha off the page it just
photographed (`window.__planetRush.build.sha` under `?debug=1`, `./version.json`
on a clean boot), and most frames carry the build badge in the corner, so an item
can never be attributed to a bundle it did not come from.

**The deployment moves.** The round opened on `13faad7` and `7e175ac` landed
about forty minutes in. Everything here was re-shot on `7e175ac`; nothing in the
manifest names two builds.

## The score

| verdict | n |
| --- | --- |
| verified | 18 |
| **failed** | **2** |
| inconclusive | 2 |

**The red:** the wave clock counts to **150 s**, the baseline, while the lobby
that configured the match says `YIELD · SCARCE` — whose interval is 180 s. Seen
on the solo path, on a local-reverted room and in a real online match on the
fly.io gameserver, always summing to ~151 s
(`a1-05-wave-clock-counts-150-not-180`, `a1-05-wave-clock-150-in-an-online-match-too`).

**The two I could not settle:**

- `a1-05-sky-parallax-not-camera-locked` — the backdrop provably travels with the
  ship (219 px best re-alignment per 844 units flown; a zero shift is 4× worse),
  so nothing is glued to the glass. But the arena the boot builds paints almost
  no sky (2.4% of the region carries any luminance at all between 4 and 20), so
  I could not show a sky clot riding *with the far stars* as opposed to ahead of
  them. Unproven, not passed.
- `a1-05-clean-boot-typeerror` — one uncaught
  `TypeError: Cannot read properties of null (reading 'clear')` per clean-boot
  capture session, from a Pixi `Graphics.clear()` on the shipped bundle. Nothing
  visible broke. A scripted walk of the same path, with and without screenshots,
  logged zero. Recorded with its stack rather than swept up.

## Rerunning it

```sh
node evidence/a1-05-live-round/capture.mjs            # all shots, or name them
node evidence/a1-05-live-round/measure.mjs            # parallax, ring arcs, the flash, the ground colour
node evidence/a1-05-live-round/compose.mjs            # the two composited figures
node evidence/a1-05-live-round/_entries.mjs           # append/refresh this round's manifest items
node evidence/a1-05-live-round/probe-clean-boot-error.mjs
```

`A1_05_BASE_URL` overrides the target if the round ever needs pointing at a
preview — but the whole point of this one is that it was not.

## Files

| file | what |
| --- | --- |
| `capture.mjs` | the camera: every shot, the device profile it used and the input it drove |
| `readback.json` | what the client reported at each shutter — seat numbers, wedge paints, XP rows, alarm counters, page errors |
| `measure.mjs` / `measurements.json` | the pixel arithmetic: flight parallax, ring arc fractions, the full-hold flash, the backdrop's modal colour |
| `compose.mjs` | builds `a1-05-hold-flash-figure.png` and `a1-05-station-health-figure.png` from captured crops — nearest-neighbour only, no colour invented |
| `_entries.mjs` | this round's 22 attestations, and the one-shot that appends them |
| `clean-boot-errors.json` | the failed reproduction of the clean-boot TypeError |

Images live in `evidence/images/a1-05-*.png`, beside every other shot in the
gallery — the manifest has one image directory and this round did not change that.

## Two things worth knowing before extending this

- **`?debug=1` and a clean boot are different clients.** `?debug=1` skips the
  menu into an OFFLINE match and installs the staging seams
  (`__pressStage`, `__endScreenStage`, `__stationHealthStage`, …). A clean boot
  has the main menu, the doors, the lobby and the hangar, and none of those
  seams — not even `__alarmStage`, which `boot()` installs and so does not exist
  until the match is up. Anything about the lobby has to be driven with real
  clicks at the points the client reports drawing.
- **`__planetRush.damageCore()` is not an alarm test.** It writes the core
  through the sim's own damage function but creates no *engagement*, so the alarm
  state machine never sees a siege: the core went 100 → 0 with `active:false`,
  `sounds:0`. The `alarm-own-station` entry in `readback.json` is that rejected
  attempt, kept so nobody repeats it. The real test is to abandon home and let a
  bot come — 88.5 s, on this build.
