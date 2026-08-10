# n6-01 — the CONNECTION LOST overlay was never installed

Branch: `agent/netcode/n6-01-install-link-loss-view`

## The finding, restated from the wiring side

`src/net/link-loss-view.ts` was complete, unit-green and merged. `installLinkLossView`
appeared **once** in `src/` — its own definition (line 231). `main.ts` never called
`pollLink`, `linkShown`, `linkHidden`, `reconnect` or `leave` either, and nothing
anywhere in `src/` listened for `visibilitychange`. So the *whole* disconnect-honesty
feature was dark, not just its overlay:

- the watchdog never sampled → **the freeze in `session.sendInput` never engaged**
  (it reads `watch.frozen`, which only moves inside `pollLink`);
- the backgrounded-tab diagnosis (`linkShown`) could never run;
- RECONNECT / ABANDON existed as session methods with no caller.

`tests/net/disconnect-honesty.test.ts` was green the whole time: it drives
`pollLink` itself. That is exactly the hole the brief names — a unit test cannot
prove a wire.

## BUILT

- `src/net/link-loss-attach.ts` (new) — the wire: installs the overlay, points
  RECONNECT at `session.reconnect()` and ABANDON at `session.leave()`, folds
  `visibilitychange` into the watchdog, and returns a `poll()` for the frame loop.
  Structural session type, same shape as `./playtest-log-attach`.
- `src/net/index.ts` — barrel export + the header paragraph saying why the file exists.
- `src/main.ts` — `attachLinkLoss({session, dom: document, page: document, onMenu:
  exitToMenu})` on the online boot path, `linkLoss?.poll()` once per rendered frame
  beside `syncPause()`.

## DECISIONS

- **Match-scoped, not front-door-scoped.** Rejected polling from `startSessionLog`'s
  250 ms timer (which spans the whole connection, lobby included): a lobby is
  *legitimately* silent — `server/room.ts` `refreshLobbyPings` re-broadcasts only when
  a rounded ping actually moves, and the client's ping probe rides `sendInput`, which
  the lobby never calls. Polling there crosses `SILENCE_FLOOR_MS` (2.5 s) on a healthy
  room and throws CONNECTION LOST over a lobby nobody left. Silence is only a signal
  where a frame every 33 ms is the promise.
- **Poll on render, not on the sim step.** The sim step is the thing that stops (the
  freeze), so a watchdog hung on it sleeps through the loss it exists to catch.
- **A separate module, not inline in `main.ts`.** Same precedent as
  `playtest-log-attach`; keeps the net logic (visibility, button→session mapping) in
  the lane that owns it and leaves `main.ts` with an install and a poll.
- **The overlay's design is untouched** — brief §"what must not change".
- **BACK TO MENU is the caller's callback** (`exitToMenu`), because leaving the match
  is a screen decision this lane does not own.

## NEXT

- Evidence: live-stage spec that boots the real bundle, puts two browsers in one
  online room, kills the link and asserts the overlay + its buttons.
- Report plainly what a player now sees and what each button does.
