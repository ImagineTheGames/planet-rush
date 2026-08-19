# a0-98 — the same corner button, on the screens a0-97 did not have to look at

**The question.** `src/net/playtest-log-button` is a DOM button, `position:fixed` in
the bottom-right at `z-index:2147483647` — the largest the platform has. `src/main.ts`
raises it from four places. a0-97's guard covers two of them (the pause paths), and
that was the whole of its brief. This capture takes the other two, and the one state
that can arrive on any screen without being asked for: a session that has dropped.

**The method is a0-97's, and it is the part of that PR worth reusing more than the
fix.** Never reason about the stack from source — a0-28 proved that lies here, when a
button at the maximum z-index spent a milestone painted under a `::backdrop`. Instead:
build the bundle a player gets, drive it through its own front door, and at the point
the CLIENT ITSELF reports drawing each control, ask the browser
`document.elementFromPoint` what a press would actually hit. A collision is proved
when the answer is the log button.

## What is here

| file | what it is |
| --- | --- |
| `probe.ts` | the shared question. Harvests every control the client reports drawing — generically, from every live-stage seam — and asks the browser what is on top of each. Distinguishes **drawn** from **live**, and **clear** from **not probed**. |
| `1-offline-screens.spec.ts` | the shipped OFFLINE artifact: the boot-failure screen, the doors, both join modes and their refusals, the lobby, an offline match, the pause menu. |
| `2-online-disconnect.spec.ts` | the shipped ONLINE bundle behind a real allocator and a real match server, with the wire really cut — plus the room list's own refusal, and a **press proof** at the covered control's own point. |
| `playwright.config.ts` | the offline capture. Own port; builds and previews the repo's real pipeline. |
| `playwright.online.config.ts` | the online capture. Borrows the fleet `tests/live-stage-online/online-fleet.ts` stands up. |
| `table.mjs` | turns the JSON into the PR's cross-product table, so the table and the numbers cannot drift. |
| `shots/broken/`, `shots/fixed/` | both stages: frames, per-state JSON, and the press proofs. |

## Running it

```sh
A0_98_STAGE=broken npx playwright test --config evidence/a0-98-corner-collisions-everywhere-else/playwright.config.ts
A0_98_STAGE=broken npx playwright test --config evidence/a0-98-corner-collisions-everywhere-else/playwright.online.config.ts
node evidence/a0-98-corner-collisions-everywhere-else/table.mjs broken
```

The online config needs ports 8791 / 8792 / 4174 and cannot run beside the online
live-stage suite — they are the same fleet. Neither capture is part of CI, like the
rest of `tests/live-stage`.

## The instrument this needed, and why it ships

`window.__planetRush.layout` (`src/platform/layout-registry.ts`) already knows what is
drawn in every corner — but it is built only under `?debug=1`, and `?debug=1` skips the
menu, the doors and the lobby, so it cannot be read on any screen reached through the
front door and cannot be read in an online match at all.

That is the same wall `installPauseStage` and `installAlarmStage` hit, and `main.ts`
states the ratified answer at both call sites: ship the read-only seam on **both**
boots, pure readback, computing nothing until `read()` is called. `installCornerStage`
follows it, and runs the EXISTING `refreshLayout` into a throwaway registry — so it
reports the frame the client drew and never a second opinion about it.

## Two things this capture found by accident

1. **The CONNECTION LOST card is invisible on a phone.** It is DOM appended to `body`,
   a sibling of the game root; on touch that root is fullscreen, and the top layer
   outranks every z-index. At `RECONNECT NOW`'s own reported centre on a 798×384 touch
   boot, `elementFromPoint` answers `CANVAS#app`, and `phone-798x384-online-match-severed.png`
   shows a live HUD with no card on it. That is a0-28's mechanism happening to
   `src/net/link-loss-view`; the log affordance survives it only because a0-28 taught
   *it* to re-home into `document.fullscreenElement`. **Netcode's lane, not fixed here** —
   but it is the reason the corner collision is a touch bug and not a desktop one.
2. **The boot-error RETRY is below the fold on a 798×384 phone.** Its own reported
   point is y≈486 in a 384-tall viewport, so the probe could not reach it without
   scrolling. Recorded as a gap and re-probed scrolled, not counted as a pass.
