# a0-11-open-rooms-start-empty-and-stay-offline.md — working notes (netcode)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

Branch: `agent/netcode/a0-11-empty-rooms-and-offline-revert`.

## BUILT

All four commits are pushed. `npx tsc --noEmit` clean; `npx vitest run` 4038/4038
green after merging `origin/main` (f7d06b0).

- **`ed7930c` — GDD §2.1 + §4.2.** The amended sentences, marked *(amended
  2026-08-07)*. §2.1: a new room seeds every non-host slot OPEN; **N counts
  humans plus bots**; RUSH! refused below two with a reason; bots fill the slots
  the host set to `bot` **and only those**. §4.2 takes the transport half — a
  room whose only human is the host boots locally and is released, decided at
  RUSH!, and cannot be rejoined.
- **`5583afd` — Part 1, the three seat states, end to end.**
  - `src/ui/lobby.ts`: `isBotSeat` is exactly `'bot'`; new `isParticipant`
    (`human | bot`) is the single predicate behind N, the team tally, the side
    roster and the RUSH gate; `createLobby` seeds an online room OPEN and empty;
    an unclaimed OPEN seat resolves to `closed` in the `MatchConfig`;
    `startRefusal()` + `denseSeatIndex()` + `lobbyWireSeats()` are new.
  - Wire (`src/net/transport.ts`, `wire.ts`, `session.ts`):
    `LobbyChoiceMessage.seats`, `LobbySlot.state`, `MatchStartMessage.you` — all
    three optional, so a pre-a0-11 peer is unchanged.
  - `server/room.ts`: `startMatch` fields humans + host-set BOT seats only, then
    **compacts and renumbers** the survivors (`compactRoster`) so the sim's
    roster stays dense; `ServerSocket.reseat` tells each connection its new seat;
    closed/bot seats are neither joinable nor advertised as joinable; the
    trailing `broadcastLobby()` at the end of `startMatch` is gone.
  - Tests: the brief's 1, 2 and 3 plus wire/dense-index guards; server tests now
    author the roster the way the client does (`tests/server/seat-bots.ts`); the
    capacity and fleet-density harnesses too.
- **`3b945d6` — Part 2, the local revert.** `src/net/local-revert.ts` (decision,
  release, cost note, tell copy) and `src/net/local-revert-view.ts` (the DOM
  one-liner). Wired at `openLobby.onTick` → `revertToLocal()` in `src/main.ts`,
  and `boot()` drops the session on `chosen.local`. Tests 4, 5 and 6 in
  `tests/net/local-revert.test.ts` against a real `MatchServer` over real sockets.
- **`b6e61ca` — the refusal on screen + evidence.** `lobby-view.ts` `hintText`
  draws `startRefusal` in the strip beside RUSH!. Both captures in
  `evidence/a0-11-open-rooms/`, taken against the shipped allocator + match
  server by reusing `tests/live-stage-online/online-fleet.ts`.

## DECISIONS

- **The SOLO lobby still opens on the bot cast; the ONLINE room starts empty.**
  The developer's report is about *"creating a room to play online"*. Offline
  there is no wire for a joiner, so an OPEN seat would be a chair nobody could
  ever take — and the file already said so in two places (`openToJoin` was false
  offline, `seatSlotState` resolved an open seat to a bot offline). Rejected the
  alternative (empty everywhere) because it makes PLAY SOLO un-RUSHable until the
  player taps seats, which nobody asked for. Stated in the PR body.
- **N counts humans plus bots** — the brief's recommended reading, taken. Folded
  into §2.1 as an amendment rather than a footnote, because the old sentence
  ("non-closed slots") counted the same thing *only* while an open slot always
  became a bot.
- **The server compacts its roster at RUSH!, and that is the hard part.** An
  unclaimed seat must bring no ship, but `RoomConfig.slots` documents a ratified
  invariant — "no sparse id ever enters the sim" (spike Trap 6) — and
  `createWorld` keys `stations[owner]` by array index. Rejected: (a) leaving the
  server auto-filling (the exact screen/room disagreement the brief names); (b) a
  parallel `slot.sim` id (audit every one of 25 `slot.player` uses for wire-vs-sim
  and get one wrong). Renumbering at RUSH! is safe *precisely there*: input
  queues, order ids, arrivals, fog and wallets are all still empty, because none
  of them exists until the world does. A minute later it would be a migration.
- **The trap that came with it:** `startMatch` used to end with `broadcastLobby()`,
  and after compaction that broadcast is indexed by the NEW numbering while every
  client still holds the old one. It painted bots onto seats that no longer
  existed (caught by `tests/net/online-lobby-flow.test.ts` reading 4 participants
  where there were 3). Removed — `matchStart` already carries the roster, per
  recipient, in the numbering its own world is built from.
- **The tell is DOM, not Pixi**, following `link-loss-view` / `connect-trace-view`.
  First capture showed it covering the wave banner's NEXT/MATCH clocks; moved to
  `top:5.5rem` and re-shot.
- **The refusal copy is short on purpose.** The first draft
  ("NEEDS 2 — WAIT FOR A CREWMATE OR SET A SLOT TO BOT") does not fit the footer's
  hint strip, and `lobby-view` draws the hint only if it fits — so a long refusal
  is *not drawn at all*, i.e. the dead button it was written to replace. Now
  "NEEDS 2 — ADD A BOT OR WAIT", registered in `tests/mobile/voice-copy-fit.spec.ts`.
- **Files outside the stated ownership, and why.** The brief directs the work at
  `src/ui/lobby.ts` by name; `lobby-flow.ts`, `lobby-view.ts`, `ui/index.ts` and
  `src/main.ts` follow from it (the send, the drawn reason, the exports, the boot
  decision). Flagged in the PR body for the Director. No `src/sim`, `src/render`
  or `src/bots` file was touched.
- **a0-06 collision:** it owns *which character sits in a `bot` seat*; this owns
  the seat's occupant state. `withCast` still calls `castForEmptySeat` — only its
  index changed (bot-seat order, not empty-seat order). a0-06 was not on
  `origin/main` at f7d06b0, so nothing collided; if it lands first, the merge
  point is `withCast` and `botDifficulties`.
- **The 4173 trap, again.** The first golden run "passed" against another lane's
  bundle (served sha 6ee54b8 vs HEAD b6e61ca). Re-ran on a private port 4191 with
  `reuseExistingServer: false`; the served sha was then this branch's. Both
  desktop lobby goldens pass on this lane's own bundle.

## NEXT

Nothing blocking. Open items, all named in the PR body:

1. **The offline boot does not take the lobby's chosen bot characters.**
   `bootOfflineMatch` seats the cast through `fillEmptySlots`, not through the
   lobby's `personality` picks, so a reverted match can seat different characters
   from the ones the roster previewed. **Pre-existing** (it is the same call PLAY
   SOLO has always made) and deliberately not widened here; it is a0-06's ground.
2. **A locally-booted match uses this client's own `MATCH_SEED`**, because no
   server ever minted one for it. The *authored* match — arena, size, sides,
   hulls, abundance — is identical, and test 6 pins that the two builders agree
   given a seed. Worth saying plainly rather than claiming "same seed".
3. **The solo lobby's state column now reads BOT** on the seven cast rows. The
   desktop lobby goldens still pass at their 1% tolerance; a rebaseline is QA's
   call, not this lane's.
