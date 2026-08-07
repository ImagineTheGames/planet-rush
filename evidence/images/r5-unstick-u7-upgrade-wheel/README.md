# r5-01 — the four upgrade-wheel goldens, re-shot against merged main

Why these moved, why every pixel that moved is text, and why the usual command
for moving them **would not have moved them at all**.

## What changed under them

Nothing in `upgrade-wheel-view.ts` or `wheel-stack.ts`. What moved is the **body
font fallback**, which main changed in `a1-01` (`bb054ad`):

    FONT_BODY: 'Oxanium, "DejaVu Sans Mono", monospace'
            -> 'Oxanium, "Liberation Mono", monospace'

This branch carried u7-02's hand-spelled copy of the old stack in
`build-wheel-view.ts`; the merge took a1-01's repair, which deletes the private
copies and reads `./typography` instead. The upgrade wheel draws its numerals
through that same constant, so its baselines moved with it.

Neither ratified face (Oxanium, Audiowide) has ever actually loaded — a1-01 found
there is no `@font-face` in `index.html` and no font file in `assets/` — so every
screen draws in the *fallback*, and the fallback is what these baselines encode.
Confirmed on this container:

    $ fc-match "DejaVu Sans Mono"  ->  wqy-zenhei.ttc: "WenQuanYi Zen Hei Mono"   # NOT present
    $ fc-match "Liberation Mono"   ->  LiberationMono-Regular.ttf                  # present

So the old baselines were shot in WenQuanYi Zen Hei Mono and the new ones in
Liberation Mono.

## Why they had to be re-shot even though they PASSED

The full merged suite was green — **117 passed** — these four included. That is
the problem, not the reassurance. Measured with the gate's own comparator
(`playwright-core/lib/third_party/pixelmatch.js`, via
`evidence/measure-golden-diff.mjs`) at zero tolerance:

| baseline                        | frame     | differing px | of total | gate      |
|---------------------------------|-----------|--------------|----------|-----------|
| `desktop-upgrade-wheel`         | 1280×800  | 5,413        | 0.53 %   | under 1 % |
| `desktop-upgrade-wheel-short`   | 1280×800  | 4,584        | 0.45 %   | under 1 % |
| `phone-landscape-upgrade-wheel` | 844×390   | 2,156        | 0.66 %   | under 1 % |
| `phone-portrait-upgrade-wheel`  | 390×844   | 2,128        | 0.65 %   | under 1 % |

Every one sits under `maxDiffPixelRatio: 0.01` — a1-01's documented trap, where a
screen with sparse body text stays inside the 1 % tolerance and nobody notices
until a text-dense one blows through it. Left alone these four would have gone on
encoding a font the code no longer asks for, spending **half to two-thirds of the
tolerance budget on a known difference** and leaving almost none for the
regression the gate exists to catch.

## ⚠️ `--update-snapshots` did NOT re-shoot them

Worth its own heading, because it generalises past this branch. On Playwright
**1.49.1**, `--update-snapshots` rewrites only baselines whose comparison
*fails*. Run against these four:

    $ npx playwright test ... -g "UPGRADE WHEEL" --update-snapshots
    4 passed
    $ git status --short tests/mobile/goldens.spec.ts-snapshots/
    (nothing)

**Zero bytes rewritten.** To that flag a stale-but-passing baseline is a correct
one, so the command everybody reaches for to refresh baselines is a no-op on
exactly the class of staleness that matters. r2-01's build-wheel goldens changed
enough to fail and so were rewritten; anything sitting under tolerance silently
would not be.

The remedy used here: **`rm` the four PNGs first**, then run
`--update-snapshots`, so Playwright regenerates them as *missing* ("A snapshot
doesn't exist at …, writing actual") rather than diffing them as *matching*.

## Which bundle these pixels came from

The lanes on this box share `PREVIEW_PORT = 4173` with
`reuseExistingServer: !CI`, so a lane's suite will happily shoot goldens against
a **sibling lane's bundle** and pass. While this work ran, port 4173 was held by
`/lanes/lane-3` serving `{"sha": "369d7a6"}` — not this branch.

These four were shot on a private port (4193, `reuseExistingServer: false`) and
the served build was checked against HEAD before every capture:

    $ curl -s http://localhost:4193/version.json  ->  {"sha": "1b8764e", ...}
    $ git rev-parse --short HEAD                  ->  1b8764e

## What is in here

`before-*.png` — the baseline as committed at `e9e66c4`, WenQuanYi.
`after-*.png`  — the baseline as committed now, Liberation Mono. These are the
                 bytes in `tests/mobile/goldens.spec.ts-snapshots/`.
`diff-*.png`   — red where the pixel changed, grey where it did not.

## Eyes on all four — what I checked and what I found

Read the `diff-*.png` first: **every red pixel is text, and only text.** The
wheel's arcs, ring, hub disc and dividers, the plate fills, the planet, the
asteroids, the FIRE button ring, the onboarding banner's background, the minimap
and the HP bar are all grey — unchanged. No control moved, vanished or appeared.

- **desktop-upgrade-wheel** (99 ore banked). Four wedges reading: WEAPON with
  `DAMAGE ○○○` / `SPEED ○○` and **`OPEN ▸`** in the cost slot (the sub-wheel
  signpost, not a price); HULL `50 → 60` / **`3/99`** in signal yellow / `○○○`;
  ENGINE `100% → 115%` / `3/99` / `○○○`; CARGO below. Hub reads `99` over
  `VANGUARD`, `BACK · ESC`. The desktop controls strip is present — `WASD
  Thrust`, `Mouse Aim`, `Left mouse Fire / Mine`, `E Build & Upgrade`.
- **desktop-upgrade-wheel-short** (1 ore banked). The same frame with the half it
  exists to prove: HULL and ENGINE both read **`3/1` in threat red**, their names
  dimmed, hub reads `1`. Both sides of the style-guide §2.1 cost-colour carve-out
  stay visible across the pair — the reason there are two desktop baselines.
- **phone-landscape-upgrade-wheel** (844×390, dpr 3). The compact stat line
  holds: `50·60` and `100%·115%` unspaced, `BACK` without the `· ESC` desk
  affordance, touch FIRE button present and the controls strip correctly absent.
  The wheel still fits its 140 px radius — the derived-metrics claim this
  baseline exists to prove, and the densest text on any wheel in the game.
- **phone-portrait-upgrade-wheel** (390×844, held portrait, dpr 3). The game root
  is rotated 90° by the landscape lock and the wheel comes through it intact, all
  four wedges legible including CARGO's `2/99`. This is the PR #93 regression
  guard and it still guards.

The HUD's own numerals (`TOTAL 99`, `NEXT 2:28`, `MATCH 0:02`, `100/100`) also
show red. That is correct: a1-01 put `hud.ts` on the same shared constant, so the
HUD and the wheel change face together — the entire point of deleting the private
copies. The onboarding banner's prose does **not** show red; it is not drawn
through `FONT_BODY`.

Still visible and still deliberate: the onboarding prompt covers the bottom
(CARGO) wedge's cost line, on both wheels, because the prompt sits at 0.72 of
viewport height. **u7-07 owns that fix** and has it in flight. Two lanes fixing
one thing is how a lane loses work.

## Stability

Re-shot, then deleted and re-shot a **second** time from a fresh build, and the
two captures compared directly:

    IDENTICAL  desktop-upgrade-wheel-desktop-linux          (d534227a90b7c998)
    IDENTICAL  desktop-upgrade-wheel-short-desktop-linux    (d766017970cf12b6)
    IDENTICAL  phone-landscape-upgrade-wheel-iphone-linux   (b3f43536bd80105e)
    IDENTICAL  phone-portrait-upgrade-wheel-iphone-linux    (b835459138b9fc49)

Byte-for-byte identical, 0 differing pixels — a stronger statement than a
zero-tolerance re-run, which only shows the comparator is satisfied. These
reproduce exactly in this container, so they gate rather than drift.

## Not re-shot, on purpose

`evidence/images/u7-gantry-upgrade-wheel/` — the 18-frame before/after set for
the deliverable itself — is left alone. Its *before* side was built from
`125d27b` in a throwaway worktree so the pair differs by this feature and nothing
else. Re-shooting only the *after* half would make it differ by the feature **and**
the font, destroying the controlled comparison it exists to be. Those frames
illustrate a design decision; they are not gates.
