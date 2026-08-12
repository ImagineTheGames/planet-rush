# n10-01 — the lobby list route (working note)

**Branch:** `agent/netcode/n10-01-lobby-list-route` · **Owner:** Netcode Engineer
**Spec:** `docs/lobby-browser-plan.md` (a0-26). This brief is §1's server half;
the browse screen is part 2 and belongs to the UI lane.

---

## BUILT

Six commits, in the order the plan needs them.

1. **`feat: a ticket says what it was allocated to do`** — Milestone A.
   `TicketClaims.intent: 'create' | 'join'`; `POST /rooms` signs `create`,
   `POST /rooms/:code/join` signs `join`; a Machine holding a `join`-intent
   ticket for a code it does not host refuses with `room-gone` instead of opening
   a room. Absent reads as create; an unknown word fails closed; no ticket secret
   (solo / self-hosted) is byte-identical to before.
   *Files:* `src/net/ticket.ts`, `allocator/allocator.ts`, `server/match-server.ts`,
   `server/room.ts` (`JoinRejection`), `src/net/ticket.test.ts`,
   `tests/server/ticket-enforcement.test.ts`.
2. **`feat: a room says whether it may be found`** — B1–B3. `lobbyChoice.listed`
   → `MatchRoom.listed` (creator-only, lobby-phase only) → `roomLoads()` →
   `HeartbeatRoom.listed` → `Room.listed`. Public by default; **absent means
   listed** everywhere, so a public room spends no heartbeat bytes and a
   pre-a0-26 Machine keeps listing.
   *Files:* `src/net/transport.ts`, `src/net/wire.ts`, `server/room.ts`,
   `server/match-server.ts`, `server/heartbeat.ts`, `allocator/registry.ts`,
   `allocator/index.ts`, `tests/server/room-listed.test.ts`.
3. **`feat: GET /rooms — the list, and a row you can join without a code`** —
   B4/B5 plus the developer's two refinements. `allocator/listing.ts` (the two
   derived tokens), `Allocator.rooms(now)`, `Allocator.joinListing(id, now)`,
   `GET /rooms` → `{ rooms, asOf }`, `POST /listings/:id/join`.
   *Tests:* `tests/allocator/room-list.test.ts` (33 cases, injected clock).
4. **`feat: the client's read of the list, and its tap`** — B6.
   `src/net/lobby-list.ts`: `readLobbyList` (null for every failure, drops a bad
   row not the listing) and `joinListing`. `chooseInLobby` gains `listed`.
   *Tests:* `src/net/lobby-list.test.ts` (22 cases).
5. **`test: the route against a live allocator, stale row and all`** —
   `tests/net/lobby-list-route.test.ts`, 7 cases on the `local-fleet` fixture
   (two real MatchServers, real tickets, a Fly-shaped edge, a real allocator
   process, real authenticated heartbeats). The fixture gained `beat()`.
6. **`docs: measure the shipped route on the wire, for D5`** —
   `spikes/lobby-browser/measure-list-route.ts` + `measured-n10-01.txt`.

**Gates:** `npx tsc --noEmit` clean; `npm test -- --run` green.

---

## THE NUMBER THE DEVELOPER ASKED FOR (D5)

Measured on the shipped route over a real socket, deployed fleet at its 12-room
ceiling, bytes counted in **both** directions (`measured-n10-01.txt`):

> **One idle browsing player costs the allocator 12 requests and ~21 kB per
> minute** at the 5 s poll — and **zero** while their tab is hidden or they are
> not on the BROWSE segment.

A classroom of thirty is **6 req/s** and ~36 MB/hour. Not one byte reaches a
gameserver, so browsing cannot cost a live match a frame and cannot fill a
Machine. **No capacity was bought; D5 is still the developer's call.**

Two of the plan's estimates were off and are corrected in the commit and the
capture, because a stale estimate is a trap for whoever sizes this next:

| | plan (a0-26) | measured (n10-01) |
|---|---|---|
| full 12-room listing | 1331 B | **1364 B** body, **1743 B** round trip |
| building one listing (12 rooms) | ~0.3 µs | **60 µs** |
| building one listing (120 rooms) | ~1.0 µs | **488 µs** |

The build cost is two HMACs per room — the price of a row that is joinable
without a code. Still three orders of magnitude under the poll interval, and the
constraint is still request count, so **nothing was optimised for it**. If it
ever matters the plan's own lever is F1 (`ETag` + `304`), which removes the body
*and* the build, not just the hashing.

---

## DECISIONS (and what was rejected)

### How a row names a room — the brief's question 3

A row carries **two derived tokens** instead of the code
(`allocator/listing.ts`), both an HMAC of the code under the allocator's secret:

- `id` — the **join handle**, what `POST /listings/:id/join` takes;
- `owner` — the **owner id** the row shows (6 chars against a code's 4, from the
  same legible deck, so it cannot be typed into the keypad as one).

**Why not the code in a different field.** A code is unbounded authority: it
works from anywhere, for the room's whole life, after the host flips PRIVATE and
after RUSH!, and anyone who reads it off a stream can type it in. A handle is
exactly the authority a browse row actually confers — *join this room while it is
publicly open* — and it is resolved against the current listing, so it stops
working the instant the room stops being listed. That is a real difference in
what is published, not a rename.

**What it is not.** It is a courtesy, not secrecy, and `listing.ts` says so in
those words (Trap 7): anyone who can read the list can join every room in it.
What the handle buys is that the browse payload is not a code-harvesting feed and
a screenshot of the list hands nobody a code.

**Derived, never stored.** No handle table. The registry stays what its header
says it is, a cache holding nothing a heartbeat cannot restate; a restarted
allocator mints the same handles one beat later, and a second instance sharing
the secret agrees without sharing state. Pinned by a test.

**On "owner id".** The game has **no accounts and no names on the wire** (plan
§4: nothing carries them to the ad), so there is no durable identity to publish.
The tag names *this claim's host*, is stable for the room's life, and dies with
it. It does not pretend to be more than that, in the code or in this note.

### Rejected

- **A handle that is the owner tag** (one token doing both jobs). Cheaper by ten
  lines, and it would put the join key on screen. Two derivations keep the
  visible token off the wire as a key.
- **A stored handle table / a second registry.** The plan rejects a stateful
  service for the list and the same argument kills a handle table: it is state a
  heartbeat cannot restate, and it would break across an allocator restart.
- **Extending `ResolveFailure` with `room-full`.** `src/ui/online-copy.ts` keys a
  `Record<ResolveFailure, …>` off that union, and it is not my file to edit.
  `ListingJoinFailure` is a **superset** instead — the entry screen's copy stays
  total, and the browse screen adds the one line it needs.
- **Listing rooms whose Machine does not advertise seats.** `roomInfo` answers
  those "joinable" because the Machine backstops the dial; a *row* has no
  backstop and would be promising seats nobody counted. Silence excludes here and
  admits there — Trap 1's two questions, two answers.
- **Recomputing anything.** `players` is humans, `joinableSeats` is free *and*
  open, both straight off the ad (Traps 2, 3, 4).

### The staleness rules, split by ownership

§3's five card rules are the **screen's** (never blank, stamp the age, `CLOSED`
for one cycle, a sentence for an empty list, keep rows through a failed refresh)
and land with part 2. What this brief owed them is the route's half, and all of
it is in:

- `readLobbyList` → `null` for every failure, so a caller *can* keep its last
  good listing instead of blanking;
- an empty listing is `{rooms: [], asOf}` and distinguishable from a failure, so
  the screen can say the sentence;
- `asOf` published — and **documented as the allocator's clock, not the
  client's**. An age stamp must be measured from local receipt time, or a device
  with a wrong clock reads a fresh list as minutes stale. Part 2 must not
  subtract `asOf` from `Date.now()`.
- the refusal path: 404 the claim is gone (or has gone private), 409 the claim is
  there and the seat was taken, and `room-gone` at the Machine for the room that
  died inside the last heartbeat. Three different facts, three different answers.

### A dying Machine

Handled by the registry's own prune-on-read: a Machine that stops beating drops
out of the list on exactly the clock that stops new rooms being placed on it, so
the list can never be more wrong than the allocator itself. A graceful
`POST /deregister` drops it instantly, so a rolled deploy shows no ghost row.
Both pinned. Inside the liveness window a row can still be tapped, and the
Machine-level refusal is what makes that honest rather than quiet.

---

## NEXT

Nothing here is blocked. What is deliberately **not** in this branch:

- **The browse screen** (Milestone D) — `src/ui/`, part 2, not my files.
- **A4's copy.** `room-gone` and `room-full` need a sentence in
  `src/ui/online-copy.ts`, which the UI lane owns. Until then a refusal reaches
  the player through the existing generic path — it is honest and it is not
  worded. **Part 2 must land the two lines.**
- **The PRIVATE toggle's control** — `lobbyChoice.listed` and
  `chooseInLobby({listed})` are wired and tested end to end; the lobby row that
  flips them is the UI lane's.
- **The HOST door's hint.** §2 is explicit: with a public default, the hint
  *"Start a new game and get a code for friends to join"* is lying by omission.
  Not my file; flagged in the PR.
- **Milestone C (abundance / bots on the ad)** — D6, unanswered. Not built.
- **Milestone F (`ETag`/`304`)** — not needed; see the numbers above.
- **The map on the wire** — a live bug, its own brief (D6).

### One fixture caveat, so nobody rediscovers it

In `local-fleet`, `session.close()` does **not** reach the Machine: the client's
TCP close is not propagated upstream by the fixture's Fly-shaped edge. The tests
use `session.leave()`, which reaches the same room state — `vacate` in the lobby
phase frees the seat and clears its token identically, whatever the departure
was. Anyone writing a "the host closed the tab" test against this fixture should
use `leave()` and know why.
