# a0-50 — the title gate, photographed

The screen makes one claim: **the main menu is genuinely behind the door.** Not a
picture of a menu painted on a leaf — the real `MainMenuView`, revealed through a
hole in the overlay standing in front of it.

That claim can only be photographed, and — this is the whole point of the pair
below — **the way it fails cannot be.** A doorway that has been painted shut
looks exactly like a doorway right up until the leaves part.

Regenerate the lot from one build, nothing staged:

```
npm run build && npx vite preview --port 4195 --strictPort &
node evidence/a0-50-title-gate/shoot.mjs
```

## The four beats — `after-*`

The shipped screen. One press at the centre, then five frames off one clock, so
the screenshots' own cost cannot drift the beats apart.

| | Frame | What it shows |
|---|---|---|
| 1 | `after-1-sealed.png` | The wordmark **stamped into the leaves** — `GAME_NAME` split across them, hazard stripes on the meeting edge, the lock seated in its bored pocket. |
| 2 | `after-2-turning.png` | The rotor has thrown its 135°. **Nothing else has moved**: beat 1 owns the screen alone, which is what stops the sequence reading as a page transition. |
| 3 | `after-3-parting.png` | **The claim.** Through the parting leaves you can read *"Objective, Bots, Ships, Systems,"* — the CODEX plate's own sub-line, on the Pixi menu, behind the door. |
| 4 | `after-4-entering.png` | The frame grows until its opening clears the viewport, so the hull leaves through the edges rather than dissolving. |
| 5 | `after-5-through.png` | The menu, whole. The overlay is inert; nothing was rebuilt, revealed or faded in. |

`gate-off.png` is the same boot with `?gate=0` — the flag the automated suites
take. No door, and the menu underneath is untouched: identical to the baseline
every golden in `tests/mobile/goldens.spec.ts-snapshots` was taken against.

## The failure, put back — `before-*`

`before-*` is the same build with the defect restored **at runtime**: the overlay
root repainted in the ground colour, which is what shipped until this brief's
last commit. Same build, same press, same clock — the only variable is the one
being shown.

**Compare `before-3-parting.png` with `after-3-parting.png`.** The leaves part
onto a black slot. Everything else on the screen is correct, and stays correct:
the lock turns, the frame grows, the hull leaves through the edges, and the menu
arrives on time in `before-5-through.png`. Only the one frame that carries the
claim is wrong.

Beats 1 and 2 are **indistinguishable between the two passes**, which is the
finding rather than a caveat. It is why this shipped: sealed is the state anyone
would think to photograph, and sealed is the state where the leaves cover the
defect.

## The handset — `phone-*`

390×844 and 844×390, dpr 3, touch.

A phone held **portrait** gets a game rotated +90°, so the player turns the
handset (`src/platform/orientation.ts`, the landscape lock). The gate is DOM and
does not ride that rotation for free, and it did not take it until this brief:
`phone-portrait-sealed.png` shows the overlay under the same transform the Pixi
root takes, and `phone-portrait-parting.png` shows the real menu — PLAY, CODEX,
SETTINGS, HANGAR — through the opening, in the orientation the game is in.

`phone-landscape-*.png` is the identity case: no rotation, and the same screen
the desktop gets.

**What it looked like before**, photographed on the same handset: every
measurement on this screen is viewport-relative, and rotating a root does not
change what `vw` and `vh` mean. The lock is `min(148px, 17vh)` and in portrait
`vh` is the LONG side, so the rotor simply sat at its pixel cap while the door
shrank under it — two thirds the height of the door it is bolted through, a
clearance that ate the whole leaf, and both words clipped through the middle. The
fix is two parts, and it needs both: the root takes the lock's transform, and
every unit on the screen is read against the LOGICAL viewport through
`--pr-gate-vw` / `--pr-gate-vh` rather than against the physical window.

### Why no unit test saw it

The punch is `destination-out` on the canvas (`paintSky`), so it erases the
canvas. `skyCoversPoint` — the predicate the brief names, held by
`title-gate.test.ts`'s *"the doorway is a hole, not a fade"* — asserts that
geometry, and it was **right the entire time**. The overlay root sat behind the
canvas, inside the overlay, painted opaque, and no canvas predicate can reach it.

Trap 1 is not *"is the punch a ring"*. It is *"is the doorway a hole all the way
through"*, and the test that now says so by name is
*"is a hole through the whole overlay, not only through the canvas"*.
