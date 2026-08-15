# a0-46 — the gates fail on `main` (§24)

A gate that passes on the code it is supposed to be gating is not a gate. Before
claiming either assertion, both were run against `main` at `c48a893` in a clean
worktree (`git worktree add /tmp/a046-main main`), with **this branch's
`src/art/vfx/shots.test.ts` copied in unchanged**.

    Test Files  1 failed (1)
         Tests  7 failed | 3 passed (10)

Seven of ten fail. Five of those fail on a missing symbol — `boltGeometry`,
`SHOT_SIDE_COLOR` and `SHOT_SPRITE_EXTENT` do not exist on `main` — which is a
compile failure, not evidence. So each of the three named gates was reduced to
the thing it actually claims and re-run on `main`'s own code.

## `points along its own velocity` — SUBSTANTIVE FAIL

The gate renders four projectiles with distinct velocities through the real
`Renderer` and reads the rotation off the shot layer. On `main`:

    AssertionError: shot 1 travelling (0, 1):
      expected +0 to be close to 1.5707963267948966,
      received difference is 1.5707963267948966, but expected 5e-11

Every shot comes back at rotation `+0`. This is the whole of the failure and it
is the correct one: `drawShots` sets `s.x`, `s.y` and `scale` and never touches
rotation, which was fine for a circle. Confirmed structurally as well —

    $ grep -rn "atan2" src/render/index.ts      # on main
    NO atan2 IN src/render/index.ts ON MAIN

## `colour is the side, girth is the rung` — SUBSTANTIVE FAIL

    AssertionError: own Mk 2 vs Mk I:
      expected [ 7196415, 7196415 ] to deeply equal [ 5096447, 5096447 ]

`7196415` is `#6dceff` (`DERIVED.shotOwn1`); `5096447` is `#4dc3ff`
(`PALETTE.plasma`). Two rungs of the same family paint different body colours on
`main` — which is exactly the retired ladder, caught by the exact comparison the
brief asked for. Note that `main`'s four colours are all allow-listed, all
non-yellow, and all correctly in-family: **every per-value assertion in the old
test file passed on them.** Only rung-against-rung sees it.

## `longer than it is wide` — SUBSTANTIVE FAIL

This one failed on `main` through the missing `boltGeometry` import, so it was
re-run as a standalone probe (`/tmp/a046-main/probe.ts`) against `main`'s own
`shotSprite`, measuring the painted box of its two concentric circles:

    main Mk 1: painted 2.000 × 2.000  aspect 1.000  — gate wants >= 4.00 : FAIL
    main Mk 2: painted 2.320 × 2.320  aspect 1.000  — gate wants >= 4.00 : FAIL
    main Mk 3: painted 2.640 × 2.640  aspect 1.000  — gate wants >= 4.00 : FAIL
    main Mk 4: painted 2.960 × 2.960  aspect 1.000  — gate wants >= 4.00 : FAIL

Exactly 1.000 at every rung, which is what a ball is. The gate's own probe —
"the thickness of the line, measured over the far half of the tail" — is not
even well-defined on `main`'s sprite, because there is no tail: the round sprite
has no paint behind its own centre that is not also beside it. The gate's first
assertion (`nothing painted behind the head`) is what would fire.

## What this does not prove

The other four gates in the file (palette cleanliness, the yellow/red reserved
rules, the tier clamp, the extent bound) are *not* new and are not claimed to
fail on `main` — they are the surviving half of the old suite, kept because they
never depended on the shape.
