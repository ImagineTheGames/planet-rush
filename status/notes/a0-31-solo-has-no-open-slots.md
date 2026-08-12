# a0-31-solo-has-no-open-slots.md — working notes (UI)

Scratch memory for THIS brief, across retries and resumes. Keep it current as you
work; a future you reads it first. This is a working note, not evidence — "done"
is still the DoD, the PR and QA's attestation, never a line written here.

Branch: `agent/ui/a0-31-solo-no-open-slots`.

## BUILT

`npx tsc --noEmit` clean; `npm test -- --run` 5227/5227 green (two files needed
updating — see DECISIONS); the evidence capture passes and its images are in the
tree.

- **`5751616` — the test, RED first (LESSONS §24).** Three tests in
  `src/ui/lobby.test.ts`, all failing against the shipped lobby: the solo ring
  reached OPEN; a solo row drew OPEN; and a seat *stored* as open in a solo lobby
  read open everywhere (row, count, `MatchConfig`). The online half was green in
  the same test from the first run, which is the point — a0-11 is ratified and
  this brief narrows solo only.
- **`5da4870` — the fix.** `src/ui/lobby.ts`:
  - `SOLO_SEAT_STATE_CYCLE = ['bot','closed']`, and `seatStateCycle(state)` hands
    out the ring *this* lobby is on. `cycleSeatState` asks for the ring instead of
    naming one.
  - `occupantOf(state, seat)` — the one seam the rule lives behind: in solo a seat
    stored as OPEN reads BOT. Routed through it: `seatView` (state, label, name,
    isBot, openToJoin, ping, host/level), `nameFor`, `castNames`, `withCast`,
    `botDifficulties`, `activeSeats`, `denseSeatIndex`, `sideRosterOf`,
    `lobbyMatchConfig`, `lobbyWireSeats`, `cycleSeatCharacter`.
  - Both derive from `state.online` and nothing else.
  - Exported from `src/ui/index.ts` (`occupantOf`, `seatStateCycle`).
  - A fourth unit test pins the derivation itself (`seatStateCycle(solo)` vs
    `seatStateCycle(online)`, and solo's ring ⊂ the online ring).
- **`src/ui/lobby-view.ts`** — doc only. The control is model-driven
  (`seat.stateLabel`), so solo is one rung fewer to *read* and no change to draw;
  said so where the next person will look.
- **The evidence** — `evidence/a0-31-solo-no-open-slots/`: `capture.spec.ts` +
  its own `playwright.config.ts` (private port 4196, private `dist-a0-31`, never
  reuses a preview), two PNGs, `readback.json`, `README.md`. Real presses through
  the front door (PLAY → doors → PLAY SOLO); labels read off `window.__lobby.
  seatStates` after EVERY press, so `everSeenLabels` is `[BOT, CLOSED, TAKEN]` for
  the whole session rather than for two still frames. `ringWalked` is
  `[CLOSED, BOT, CLOSED]` — three presses, two rungs.

## DECISIONS

- **One seam, not a second flag.** `occupantOf(state, seat)` reads
  `state.online` — the same flag `createLobby` seeds seats from (`:1098`) and
  `openToJoin` is drawn from. Rejected: a `solo: boolean` on `LobbyState`, and a
  local `!state.room` test — both are a second copy of a value that already
  exists, which is exactly the u13-01 / g6-01 failure the brief names.
- **Resolve on READ, do not rewrite the stored seat.** Considered having
  `withCast` rewrite a solo `open` occupant to `bot` so every reader would work
  untouched. Rejected: `withCast` republishes *derived* fields, and a function
  that quietly edits authored state is a trap; and a state handed straight to
  `lobbyModel` (a test, a restored profile) would never pass through it. Reading
  through one function is the version that cannot be bypassed.
- **`castNames` and `lobbyMatchConfig` now read `seat.character`, not
  `seat.personality`.** `personality` is `character` gated by bot-ness, already
  computed — i.e. a copy, and the copy is what a stale solo `open` seat would be
  wrong in. `lobbyMatchConfig` was already reading `character` for the *tier* on
  the same object, so this makes the two halves agree rather than introducing
  anything.
- **Two tests elsewhere encoded the three-rung ring; both are updated in place,
  and both were already fragile.**
  - `src/ui/lobby-flow.test.ts` — "one full lap returns to the start" counted
    `SEAT_STATE_CYCLE.length`. It now asks `seatStateCycle(lobby)` for the lap
    length, and `nextRung` takes the lobby. Its "a CLOSED row's body re-opens the
    seat" assertion now expects `ring[0]` — BOT in solo. That is the same rule
    (the body edits what the row shows) with one rung fewer.
  - `tests/net/offline-teams-boot.test.ts` — the fixture named `closed` tapped
    **twice** and passed only because the old solo OPEN rung was dropped from the
    world exactly as a closed seat is. One tap now, plus an assertion that the
    seat really is closed. Test-only, in another agent's directory, called out in
    the PR body.
- **Nothing changed for online.** a0-11 is ratified. The online ring, the empty
  room, `lobbyWireSeats`, `applyLobbySlots` and the all-bot local revert are all
  untouched — `occupantOf` is the identity function when `online` is true.
- **`u17-01`'s browse screen:** a solo lobby was never listable (the SOLO door
  opens with `online: false` and no room — it never reaches the allocator), and
  now it also has no open seat to advertise, so `joinableSeats > 0` could not be
  true of one even if it did. Stated in the PR body, as the brief asks.

## NEXT

- Nothing outstanding. PR open; DoD commands all run green locally
  (`tsc --noEmit`, `npm test -- --run`, the `cycleSeatState` grep on FETCH_HEAD).
- If a future brief moves the *default* seat state in solo (e.g. "open on a
  smaller cast"), change `createLobby`'s seed — the ring and the read seam follow
  from `online` and need no edit.
