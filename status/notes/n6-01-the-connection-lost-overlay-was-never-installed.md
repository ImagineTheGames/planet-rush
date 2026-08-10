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

`tests/net/disconnect-honesty.test.ts` was green the whole time: it drives `pollLink`
itself. That is exactly the hole the brief names — a unit test cannot prove a wire.

## BUILT (all committed on the branch)

1. `fix(n6-01): install the CONNECTION LOST overlay on the match's boot`
   - `src/net/link-loss-attach.ts` (new) — installs the overlay, points RECONNECT at
     `session.reconnect()` and ABANDON at `session.leave()`, folds `visibilitychange`
     into the watchdog, returns `poll()` for the frame loop. Structural session type,
     same shape as `./playtest-log-attach`.
   - `src/net/index.ts` — barrel export + a header paragraph saying why it exists.
   - `src/main.ts` — `attachLinkLoss({session, dom: document, page: document, onMenu:
     exitToMenu})` on the online boot path; `linkLoss?.poll()` per rendered frame
     beside `syncPause()`.
2. `test(n6-01): prove the wire in the shipped bundle, not in a stub`
   - `tests/live-stage/link-loss.spec.ts` + `playwright.link-loss.config.ts` (ports
     4176 / 8795 / 8796; `npm run test:link-loss-evidence`).
   - `tests/net/fly-edge.ts` gains `gag(on)` / `?gag=1` — stops delivery from the
     Machines **without closing anything** (a `pause()`, so it is reversible and
     lossless). That is the developer's silent death, reproduced with no client code
     involved.
   - `src/net/link-loss-attach.test.ts` — the button→session mapping against a real
     `LinkWatch`; its header states that it cannot be the proof.
   - Dark-matter allowlist: dropped the three entries that are no longer dark,
     re-triaged the two that remain; `docs/dark-matter-scan.md` marked FIXED.
3. `fix(n6-01): make hide() actually hide — the scrim outranked its own \`hidden\``
   - **A real bug only the real install could find.** `#pr-link-loss{display:flex}`
     beats the UA's `[hidden]{display:none}` on specificity, so `LinkLossView.hide()`
     set a flag and nothing else: a player whose link came back stayed under a
     full-viewport `pointer-events:auto` scrim with a stale RECONNECTING… card. One
     rule added (`#pr-link-loss[hidden]{display:none}`), no design change; asserted in
     the view's unit test and watched by the live-stage run.

## Evidence actually run in this lane

- `npx tsc --noEmit` — clean.
- `npm test -- --run` — 275 files, 4792 tests, green.
- `npm run dark-matter:check` — no new dark exports; reports the three as now-called.
- `npm run test:link-loss-evidence` — **green, 4 consecutive full runs** (build +
  fleet + two browsers each). Two earlier failures happened immediately after a
  hand-run fleet was torn down and did not recur; `press()` now names the card on
  screen if a button is ever missing, so a repeat says what state it was in.
- Screenshots committed: `link-loss-{lost,abandoned,recovered}-evidence.png`.

## DECISIONS

- **Match-scoped, not front-door-scoped.** Rejected polling from `startSessionLog`'s
  250 ms timer (which spans the whole connection, lobby included): a lobby is
  *legitimately* silent — `server/room.ts` `refreshLobbyPings` re-broadcasts only when
  a rounded ping actually moves, and the client's ping probe rides `sendInput`, which
  the lobby never calls. Polling there crosses `SILENCE_FLOOR_MS` (2.5 s) on a healthy
  room and throws CONNECTION LOST over a lobby nobody left.
- **Poll on render, not on the sim step.** The sim step is the thing that stops (the
  freeze), so a watchdog hung on it sleeps through the loss it exists to catch.
- **A separate module, not inline in `main.ts`** — precedent: `playtest-log-attach`.
- **The overlay's design is untouched** (brief §"what must not change"). The one CSS
  line added is not a restyle: it makes `hide()` do what its own name says.
- **The live-stage spec presses with `page.mouse.click` at the button's drawn point**,
  not `locator.click()`. The countdown rewrites the card once a second, so every
  button element is replaced; Playwright's actionability check wants one element to
  stay attached for its whole sequence and loses that race under a live match's frame
  load. A player's click does not care which element object is under the pixel.
- **Rejected**: per-connection gagging at the edge (the fixture would have to know a
  client's ticket); `force: true` clicks (weaker than a real mouse click);
  `context.setOffline` (fires `onclose`, so it reproduces the case that always
  worked rather than the reported one).

## What a player sees now

- Link dies mid-match → within ~2.5 s the world freezes and a full-screen scrim says
  **RECONNECTING… / "no server data for 4s — reclaiming your seat, 56s of grace
  left."** with **ABANDON MATCH**. The client spends its one automatic reclaim
  attempt inside the same poll that detects the loss, which is why this card, and not
  CONNECTION LOST, is the usual first thing seen.
- Link returns inside grace → the seat, ship, cargo and upgrades come back and the
  overlay takes itself down. Nothing is pressed.
- **ABANDON MATCH** → `session.leave()` — a stated leave, seat freed now rather than
  held for a minute — then the card turns threat-red: *MATCH ABANDONED — your seat is
  a bot's now*, with **BACK TO MENU**, which exits to the real main menu.
- **RECONNECT · 38s** is drawn on the card where nothing is dialling (`phase: 'lost'`)
  and calls the same `session.reconnect()` the automatic attempt uses. Honoured, not a
  lie — but note that because the auto-redial is spent the instant a loss is detected,
  that card is reached only when a dial could not be *started*. Worth the Director's
  eye: it may want to be a `RETRY` on the RECONNECTING… card instead. Not changed
  here — that is a design call on a surface this brief says not to redesign.

## NEXT

- PR open; nothing blocking.
- Not in CI: the live-stage online configs are manual evidence runs (CI runs
  typecheck / vitest / dark-matter / build / mobile only). Same status as
  `connect-trace` and `build-badge-online`.
