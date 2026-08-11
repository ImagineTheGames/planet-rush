# The lobby browser — JOIN gets a second mode (Spike a0-26)

**Owner:** Architect. **Status:** PLAN — decisions proposed, not built.
**Brief:** a0-26. **GDD:** §2.1 (the slot model), §4.2 (rooms advertise their
configuration), §4.8 risk 6 (a dead server costs a session, never the game).
**Companions:** `docs/hosting-plan.md` (the fleet), `docs/server-capacity.md`
(what a room costs), `docs/variable-slots-plan.md` (the room advertisement this
builds on), `docs/region-picker.md` + `docs/lobby-ping.md` (measured latency),
`docs/netcode-spike.md` (the measure-don't-guess discipline).
**Measurement code:** `spikes/lobby-browser/measure-listing.ts` — run
`npx vite-node spikes/lobby-browser/measure-listing.ts`; captured output in
`spikes/lobby-browser/measured-a0-26.txt`. **Every number below comes from
there**, against the shipped `InMemoryRoomRegistry`, `Allocator`, `MatchServer`
and `MatchRoom`, on an injected clock.

The developer's ask, verbatim:

> *"we need a lobby browser so that joining has 2 mores, code and browse a list of
> lobbies"*

`a1-13` drove the code path end to end on the live build: the host got room `B7GW`
and the guest typed `B-7-G-W` on the drawn keypad. **That path works, is
evidenced, and stays.** This document decides what browsing costs beside it.

---

## DECISION (up front)

**Nine calls, in the order they bind.** Everything below is engineering and is
decided here, *except* the six put to the developer in the last section — of
which the three the brief names are **D1 (the privacy default)**, **D3 (the
staleness behaviour)** and **D5 (the one that spends money)**.

1. **The allocator lists; nobody publishes anything new.** The registry already
   *learns* every room from the heartbeats each Machine sends
   (`allocator/registry.ts`), and the allocator already answers one room's
   advertisement on `GET /rooms/:code`. The browser is **one new read route** —
   `GET /rooms` — over state that exists today. No new service, no new store, no
   new failure mode. §1.
2. **A listing is built from heartbeat-confirmed rooms only.** Rooms known only
   through a reservation lease (the boot gap) are **excluded**: measured, a lease
   advertises `joinable: true` with no occupancy at all for up to 15 s, whether or
   not the Machine ever comes up. §1, §3.
3. **Publishing is the room's own flag, and it defaults to on.** The heartbeat
   gains `listed?: boolean`; the lobby gains a PRIVATE toggle that rides
   `lobbyChoice` exactly as `mode` and `abundance` do. **The default is a
   developer decision (D1)** — the recommendation is *listed*, and the cost of
   that recommendation is stated plainly in §2. It is not free.
4. **A dead row must be refused, not silently re-created — and that fix lands
   BEFORE the browser.** Measured: a room swept one beat ago is still listed, and
   tapping it is *not* an error. `Allocator.join` signs a ticket and
   `MatchServer.openRoom` **creates the code again**, so the player lands alone in
   a brand-new room wearing the row they tapped. The fix is one signed ticket
   claim — `intent: 'create' | 'join'` — and a guard. §3, Milestone A.
5. **The list never blanks and always says how old it is.** Last-good rows stay
   on screen through a refresh; the card carries `UPDATED 3s AGO`; a room that
   has gone reads `CLOSED` for one cycle and then leaves. `a1-13` proved players
   will sit watching a card — so the card is never allowed to be silent. §3.
6. **A row shows what the ad actually knows: humans, open seats, mode, and the
   region with its measured ping.** It shows **no map** — measured, `mapId` never
   crosses the wire at all — and no abundance until the ad carries one. §4.
7. **JOIN gains two modes; the four doors do not become five.** CAMPAIGN / SOLO /
   HOST / JOIN is untouched (a0-15, ratified after a rollback). The JOIN screen
   grows a two-segment switch, `BROWSE` / `CODE`, and the keypad it has today is
   the CODE segment, unchanged. §5.
8. **Listing traffic is allocator-only and is bounded by request count, not
   bytes.** A full listing of the deployed fleet is **1331 bytes**; one browser at
   a 5 s poll is **12 requests/min, ~16 kB/min**; building a 120-room listing
   costs the allocator **~1.0 µs**. It never touches a gameserver, so a busy
   browser cannot degrade a live match. §6.
9. **The browser must not resurrect a reason to keep an empty online room
   alive.** a0-11 stands, character for character: a room whose only human is the
   host boots locally at RUSH! and is released, and an abandoned lobby is swept
   at once. Nothing here holds a room open so it can be browsed. Trap 9.

---

## MEASUREMENTS

All from `spikes/lobby-browser/measure-listing.ts`.

### 1. The staleness envelope — how old is a listed fact?

| Constant | Value | Where |
|---|---|---|
| Heartbeat interval | **5 000 ms** | `server/heartbeat.ts` `DEFAULT_HEARTBEAT_INTERVAL_MS` |
| Registry liveness window | **15 000 ms** | `allocator/registry.ts` `DEFAULT_LIVENESS_MS` |
| Reservation lease TTL | **15 000 ms** | `allocator/registry.ts` `DEFAULT_RESERVATION_TTL_MS` |

**(a) A seat fills between beats.** The Machine knows at once; the allocator does
not hear until the next heartbeat.

```
t+0ms      joinableSeats=7 joinable=true
t+4999ms   joinableSeats=7 joinable=true   <- WRONG for up to one interval
t+5000ms   joinableSeats=0 joinable=false
```

**(b) The Machine dies at t+0.** Its rooms stay listed for the whole liveness
window, then vanish on the same clock that stops new rooms being placed on it:

```
t+  5000ms   listed=YES
t+ 10000ms   listed=YES
t+ 15000ms   listed=YES
t+ 15001ms   listed=no
```

**(c) The boot gap.** A room known only through its lease advertises itself as
joinable with **no occupancy fields at all**:

```
t+1000ms   {"code":"CCCC","machine":"m3","region":"iad","size":4,"mode":"ffa","joinable":true}
t+15001ms  null
```

**The envelope, as the player experiences it:**

- **Occupancy** is stale by up to `heartbeat (5 s) + client poll`. At a 5 s poll
  that is **10 s**.
- **Existence** is stale by up to `liveness (15 s)` when the *Machine* dies, and
  by up to `heartbeat (5 s)` when the *room* dies (an abandoned lobby is swept on
  the next `MatchServer.update`, measured below).
- A room in its **boot gap** is knowable but not measurable for up to 15 s.

### 2. Tapping a dead row — measured, and worse than a bad row

The host opens a room and closes the tab while still in the lobby. Lobby-phase
disconnect grants **no grace** (`server/room.ts` `vacate` — grace holds mid-match
seats only), so the room is garbage on the next sweep:

```
room YK8D opened by one host, no bots seated (a0-11: a new room is EMPTY)
    heartbeat says: {"code":"YK8D","players":1,"size":8,"mode":"ffa","joinableSeats":7}
the host closes the tab in the LOBBY:
    heartbeat says: []   <- the room is swept at once
```

The allocator has not heard yet, and inside that one beat:

```
the allocator still lists it: {"code":"YK8D",…,"joinableSeats":7,"joinable":true}
    allocator.join() → ticket signed: YES (no refusal)
    MatchServer join → welcome{you:0, room:YK8D}, room now: {"code":"YK8D","players":1,…}
after the next beat drops it: allocator.join() → not-found (HTTP 404)
    window in which a dead row is silently re-created: 0..5000ms
    (and 0..15000ms for a room that never booted at all)
```

**Nothing refuses. Nothing errors.** `MatchServer.openRoom` creates a room on an
unknown code — *and that is load-bearing*, because it is how HOST works: the
allocator mints the code, the host's join is what brings the room into existence.
So the same mechanism that makes hosting work makes a dead listing silently
resurrect as an empty room the player is alone in.

This is a **pre-existing bug on the code path** — type a code whose room ended
four seconds ago and you get the same empty room — but it is *rare* there,
because a code is something a human read out loud. A browser hands the player a
tappable list of exactly these. **It multiplies the bug's frequency by making
dead rooms discoverable.**

### 3. What a listing weighs, and what an idle browser costs

Codes are 4 characters, occupancy varies, `DEFAULT_MAX_ROOMS` is 6 per Machine
(`docs/server-capacity.md`):

| fleet | rooms | all rooms | joinable only | bytes/room |
|---|---|---|---|---|
| one Machine, full | 6 | 671 B | 449 B (4) | 112 B |
| **the deployed fleet, full** | **12** | **1331 B** | **887 B (8)** | **111 B** |
| 10 Machines, full | 60 | 6611 B | 4391 B (40) | 110 B |
| 20 Machines, full | 120 | 13271 B | 8811 B (80) | 111 B |

One browser sitting open:

| poll | requests/min | bytes/min (full fleet) | bytes/hour |
|---|---|---|---|
| 2 s | 30 | 39 930 | 2.4 MB |
| **5 s** | **12** | **15 972** | **0.96 MB** |
| 10 s | 6 | 7 986 | 0.48 MB |

Building one, from state the allocator already holds in memory:

```
 2 Machines ×  6 rooms =  12 rooms → 0.3 µs per listing built
20 Machines ×  6 rooms = 120 rooms → 1.0 µs per listing built
```

The alternative for scale — no list route, the client reads each row with the
**existing** `GET /rooms/:code` — is **12 requests per refresh instead of 1**,
i.e. **144 allocator requests/min per open browser** at a 5 s poll. That is the
design this rejects.

### 4. What a row can honestly say today

What the heartbeat carries about a lobby-phase room (host + 3 bots authored):

```
{"code":"XKWK","players":1,"size":8,"mode":"ffa","joinableSeats":4}
```

What `matchStart` carries — the whole static match config (GDD §4.2):

```
keys = type, tick, seed, you, slots, asteroidCount, abundance
```

And after RUSH!, the same room's ad: `{"code":"XKWK","players":1,"size":4,…}` —
**`size` compacted from 8 to 4**, because a0-11's `startMatch` fields humans plus
host-set bots and renumbers the survivors.

| Column the brief asks for | On the ad? | Where it comes from |
|---|---|---|
| players / slots | **YES** | `Room.players` (humans) + `Room.size` |
| joinable seats | **YES** | `Room.joinableSeats` (already a0-11-aware) |
| mode (FFA / TEAMS) | **YES** | `Room.mode`, set by `lobbyChoice.mode` |
| region | **YES** | `RoomInfo.region`, from the host Machine's view |
| measured ping | **YES**, per REGION | `src/net/region-probe.ts` |
| abundance (YIELD) | **NO** | `lobbyChoice.abundance` reaches the room, not the ad |
| **map / arena** | **NO** | **`mapId` never crosses the wire at all** |

### 5. The map finding — stated exactly, because it is bigger than this brief

`mapId` does not appear in `server/` or `src/net/` outside tests.
`server/room.ts` calls `createWorld({seed, players, bounds?, asteroidCount?,
abundance})` with **no `mapId`**, `MatchStartMessage` carries none, and so
`beginPredicting` (`src/net/session.ts`) omits it too. Both sides therefore build
`getMap(undefined)` — the default — **and agree**, which is why nothing crashes
and no golden moved.

But MAP SELECT is a *client-local* choice: `main.ts` reads it from storage
(`MAP_STORAGE_KEY`), passes it to `bootOfflineMatch` and to the renderer as the
backdrop sky (a0-07/a1-07), and online it reaches **nothing else**. An online
host who picks the diamond arena flies the default board under a diamond sky, and
a guest sees whatever sky *their own* storage last held.

That is the same shape of bug as n5-01 (the YIELD chip that never reached the
economy) and the m10 teams-wire (the TEAMS lobby that built a free-for-all). **It
is not this brief's to fix and it does not block the browser** — but a browser row
cannot print a map until the map is on the wire, and the Director should brief it
on its own. See D6.

---

## §1 — WHO LISTS A ROOM

### The seam, named

**The allocator holds the registry; each gameserver publishes by heartbeat. Both
are already true, and neither moves.**

```
  MatchRoom.joinableSeats / .size / .mode      (server/room.ts — the truth)
        │
        └─ MatchServer.roomLoads()             (server/match-server.ts)
              │  POST /fleet/heartbeat, every 5 s, HMAC-signed, FULL STATE
              ▼
        InMemoryRoomRegistry.observe()         (allocator/registry.ts — a CACHE)
              │
              ├─ GET /rooms/:code  → Allocator.roomInfo()   [ships today]
              └─ GET /rooms        → Allocator.rooms()      [THE ONE NEW THING]
```

`allocator/registry.ts`'s own header states the design and it is the reason this
is cheap: *"This is a cache, not a database… An allocator that restarts holds
nothing, and yet comes back whole within one heartbeat interval."* A list route
inherits that property for free — restart the allocator and the browser is empty
for one beat, then correct.

### The three alternatives, and why each is rejected

| Alternative | Why not |
|---|---|
| **A second registry service** (Redis, a rooms DB) | The registry interface already exists for exactly this day (`RoomRegistry` is an interface *on purpose*, per its header). But nothing about a *list* needs shared state that a heartbeat cannot restate — and `docs/hosting-plan.md` is explicit that the launch footprint carries no stateful service. Adding one to draw a list is the tail wagging the fleet. |
| **Each gameserver serves its own list**, client fans out | The client would need every Machine's address, which the socket-hop pin exists to *avoid* handing it (`docs/hosting-plan.md` Task 13), and would put listing traffic on the gameservers — the processes running the sim. Rejected on both counts. |
| **Push**: Machines POST rooms to a list endpoint as they change | A second write path with a second consistency story, next to a heartbeat that already carries full state every 5 s. The heartbeat is *state, not a delta*, which is precisely what makes a list from it self-healing. |

### What the list route excludes, and why

- **Lease-only rooms (the boot gap).** Measured §1(c): a lease says
  `joinable: true` with no occupancy for up to 15 s, and it says it whether or not
  the Machine ever boots. Listing that is the single largest generator of ghost
  rows. The creator reaches their own room by ticket, not by browsing, so nothing
  is lost. **Cost: a freshly hosted room takes up to one heartbeat (5 s) to appear
  in other players' browsers** — which is correct, because that is also how long
  it takes to be real.
- **Rooms with `joinable === false`.** Full, live or ended. `RoomInfo.joinable`
  already computes this and is the field the code path's preview reads.
- **Rooms whose ad says `listed: false`** — the privacy flag, §2.

### The failure mode when a Machine dies mid-match

Measured §1(b). A Machine that dies without deregistering keeps its rooms in the
registry for the **15 s liveness window**, so for up to 15 s the browser offers
rooms that are gone. Three things make that survivable, and one of them has to be
built:

1. **It is the same window that governs placement.** `registry.machines(now)`
   prunes on read, so a dead Machine's rooms leave the list on exactly the clock
   that stops new rooms being placed on it. The browser cannot be *more* wrong
   than the allocator itself is.
2. **A graceful shutdown is instant.** `POST /deregister` (M10) forgets the
   Machine at once, so a rolled deploy — the common case — never shows a stale
   row (`docs/hosting-plan.md`: cordon, drain to `rooms: 0`, roll).
3. **A tap inside the window must be refused, not answered.** Today it is
   answered: the allocator signs a ticket to a Machine that is not there, the
   socket dial fails, and the player watches the connect trace stall
   (`src/net/connect-trace.ts` `STALL_MS = 5000`). That is survivable — the trace
   narrates and the copy exists — but §3's `intent` claim is what makes the *room
   dead* case honest, and this case reuses its refusal copy.

---

## §2 — PRIVACY: does creating a room now mean publishing it?

**This is the sharpest call in the brief, and it is D1 — the developer's.** What
follows is the argument on both sides, the recommendation, and its price.

### What "private" is worth today, measured

A code-joined room is private *by knowing the code*. How private is that?

- `CODE_ALPHABET` is 32 characters, `CODE_LENGTH` is 4 (`src/net/room-code.ts`),
  so the space is **32⁴ = 1 048 576** codes.
- `POST /rooms/:code/join` carries **no authentication and no rate limit** — the
  allocator has neither (grep `allocator/index.ts`: the fleet *write* routes are
  HMAC-authenticated; the client's allocate and join are not, and need not be).
- With the deployed fleet's ceiling of 12 rooms live, a blind guess hits about
  **1 in 87 000**. A scanner at 100 requests/second walks the whole space in under
  3 hours and expects a hit in roughly **15 minutes**.

So today's privacy is **real but thin**: it stops a passer-by, not an adversary.
That matters because it sets the honest size of what a browser gives away.

### What listing actually publishes

**Listing a room publishes its code.** The listing response has to carry the code
— it is the join key — so any client that can read the JSON can read every listed
room's code. A row that does not *print* the code is a UI courtesy that keeps the
browse screen from being a code-harvesting screen; it is **not** secrecy, and the
plan must not pretend otherwise (Trap 7).

That is the whole cost of publishing, stated in one line: *a listed room is a
room anyone can walk into, and its code is public.*

### The argument for public-by-default

The developer has already ruled that **"creating a room should start with all
slots OPEN and no bots"** (a0-11, folded into GDD §2.1). A room that exists is a
room whose seats the host deliberately left open for people. And a0-11's other
half is the sharp end: **a room whose only human is the host boots locally at
RUSH! and is released** (GDD §4.2). So today, a host who opens a room and cannot
reach anyone does not get a smaller online match — they get a solo match and a
quiet notice. **The browser is the mechanism that stops an open room quietly
becoming a solo one.** An open room nobody can find is the failure a0-11 documents
the fallback for.

That is an argument, not the developer's word, and the brief says so.

### The argument against

- **It changes what HOST means without changing what HOST says.** The door's hint
  is *"Start a new game and get a code for friends to join."* A host reads that,
  presses it, and — under a public default — has also opened the room to
  strangers. If the default is public, **that hint must change** (§5), or the
  screen is lying by omission.
- **It removes the only privacy the game has** for the host who wanted friends
  only, and replaces it with a toggle they must notice.
- **A classroom is the primary audience** (GDD §4.4, §4.8). Six students in one
  room passing a code around are *served* by a code; a public list mostly adds a
  way for the wrong lobby to get joined.

### Recommendation

**Public by default, with a PRIVATE toggle in the lobby.** Concretely:

- `HeartbeatRoom` gains `listed?: boolean`; absent reads as `true` (a pre-a0-26
  Machine keeps listing, which is the additive discipline every wire field in this
  repo already follows).
- `MatchRoom` gains a `listed` flag, settable from `lobbyChoice.listed`,
  **creator-only**, lobby-phase only — the same seam `mode` and `abundance` ride,
  for the same reason and with the same failure when it is missing.
- The lobby gains a **`CLAIM · PUBLIC / PRIVATE`** control beside the mode and
  YIELD rows. It is a *word*, not an icon, per §4.7's interface voice.
- The HOST door's hint changes to name both facts, e.g. *"Start a game others can
  find, or share the code."* (63-char budget, `tests/mobile/voice-copy-fit.spec.ts`
  — the SOLO hint is the one label that has actually overflowed.)

**Its price, stated:** a host who wanted friends-only must find and flip a
control, and until they do, a stranger can take a seat their friend was going to
take. Against that, the alternative default (opt-in publish) has a price too, and
it is worse for the thing the developer asked for: **an opt-in list is an empty
list**, and an empty browser on the first tap is a feature that reads as broken.

**The middle option, if the developer wants one:** publish by default but
**auto-unlist a room the moment its host presses RUSH! or the room leaves the
lobby phase** — which `joinableSeats === 0` already achieves for free — *and* add
a PRIVATE toggle. That is the recommendation above; there is no third mechanism
to invent.

---

## §3 — STALENESS: what the list says, and what a dead row does

> *"A listed room that is full, started, or gone is worse than no list."* — the brief.

### The rule

**A listing is a photograph with a timestamp on it, and it says so.** Nothing in
this design tries to make the list live; a socket per browsing player is a
gameplay-path cost for a menu, and the allocator is deliberately *not* in the
gameplay path (`allocator/index.ts` header). Instead the list is honest about its
age.

### What the card does, in five rules

1. **The list never blanks.** A refresh replaces rows in place; the last good
   listing stays on screen until a new one lands. A spinner over an empty screen
   is the failure `a1-13` caught on the connect card — a player sitting watching
   a card that says nothing.
2. **The card stamps its own age.** `UPDATED 3s AGO`, ticking, from the `asOf`
   the route returns. When the age exceeds two poll intervals the stamp turns to
   the failure register (`LAST SEEN 24s AGO`, threat red per style-guide §2) —
   the same discipline `region-probe.ts` rule 1 sets: **absent, never flattering.**
3. **A row that has gone reads `CLOSED` for one cycle, then leaves.** A row that
   silently disappears under a thumb is a mis-tap generator. One cycle of an
   inert, un-tappable row is the cheapest fix and needs no new state.
4. **An empty list is a sentence, not a void.** `NO OPEN CLAIMS RIGHT NOW. HOST
   one, or type a code.` — it names the doors that work, exactly as
   `ENTRY_ERRORS.full` names SOLO. A player must never be able to reach a blank
   rectangle.
5. **A failed refresh keeps the rows and says so**, and never bounces the player
   back to the doors. `readLobbyList` returns `null` for every failure — the same
   one-value doctrine `readRoomAdvert` documents, because a *preview decides
   nothing*.

### And what happens when they tap a dead one

**Today: nothing good, measured (§2 above).** The room is re-created empty and
the player waits alone in a lobby that looked populated.

**The fix — one signed claim, and it must land before the browser ships:**

The ticket already carries `{room, machine, size, mode}` and the Machine already
reads it (`MatchServer.roomOptionsFromTicket`). Add **`intent: 'create' |
'join'`**:

- `POST /rooms` (allocate) signs `intent: 'create'`.
- `POST /rooms/:code/join` signs `intent: 'join'`.
- A join bearing a **`join`-intent** ticket for a code this Machine does not host
  is **refused** with a new `JoinRejection` — `room-gone` — instead of opening a
  room. A `create`-intent ticket behaves exactly as today.
- **Absent `intent` reads as `create`**, so a pre-a0-26 client and the
  no-ticket-secret self-hosted path are byte-identical to today.

That fix is worth more than the browser it unblocks: it closes the same hole on
the **code path**, where typing a code whose room ended four seconds ago currently
opens an empty room instead of saying `No claim with that code`
(`ENTRY_ERRORS.unknown`, which already exists and already says the right thing).

**What the player sees when a tap is refused:** back to the list, with a line on
the row's former position and an immediate refresh — never back to the doors, and
never a modal. `resolveFailureMessage` (`src/ui/online-copy.ts`) already owns the
mapping from an allocator failure to a sentence; `room-gone` joins it.

---

## §4 — WHAT A ROW SHOWS

### The row

```
  ┌────────────────────────────────────────────────────────┐
  │  2 PLAYERS      4 SEATS OPEN      TEAMS      IAD 38ms   │
  └────────────────────────────────────────────────────────┘
```

Four facts, each of which the ad actually measures (§4 of the measurements):

- **`2 PLAYERS`** — `Room.players`, which counts **humans**. Not "2/8": the
  denominator is a trap (Trap 2, Trap 4).
- **`4 SEATS OPEN`** — `Room.joinableSeats`, which is already a0-11-aware (free
  **and** open; a seat the host shut or put a bot in is not one). **Never
  recompute it as `size − players`** — bots and closed seats make that wrong.
- **`TEAMS` / `FFA`** — `Room.mode`.
- **`IAD 38ms`** — `RoomInfo.region`, with the round trip **this client timed**
  against that region (`src/net/region-probe.ts`). `—` when unmeasured; **never
  `0ms`** (region-probe rule 1: *"an unprobed region reads as the best server in
  the fleet"* is the flattering lie this repo already refuses).

### The region column, at one region and at two

Only `iad` is deployed (`docs/hosting-plan.md` Task 11). A per-row region column
that says `IAD` on every row is noise. So:

- **While `GET /regions` returns one region**, the measured ping is a **single
  line above the list** — `IAD · 38ms` — and no row carries a region.
- **The moment it returns two**, the region moves into the row.

That is not a special case; it is exactly the rule `region-probe.ts` already
keeps (rule 4: *"the one-region launch configuration keeps the picker suppressed
by count, not by a flag"*). One code path, one condition, and a second region
lights the column with no new work.

### What the row does NOT show, and what it would take

| Wanted | Blocked by | Cost to unblock |
|---|---|---|
| **Map / arena** | `mapId` is not on the wire *anywhere* (§5 of the measurements) | Its own brief: thread `mapId` through `lobbyChoice` → `MatchRoom` → `createWorld` → `matchStart` → `beginPredicting`, then onto the heartbeat. **This is a live bug independent of the browser.** D6. |
| **Abundance (YIELD)** | The room knows it (`matchAbundance`); the ad does not carry it | Small: `HeartbeatRoom.abundance?`, `Room.abundance?`, `RoomInfo.abundance?`. ~10 lines plus tests. Recommended — YIELD is the most match-shaping thing a host picks. Milestone C. |
| **Bots in the room** | The ad cannot distinguish bot seats from closed ones (`size` − `joinableSeats` − `players` is bots **or** closed) | `HeartbeatRoom.bots?`, counted from the room's `seatStates`. Note the subtlety: **in the lobby phase no bot is seated yet** (a0-11 — `startMatch` seats them), so the number is the host's *authored* bot count, and the row must word it as such. D6. |
| **Host name / player names** | Nothing carries them to the ad, and publishing them is a privacy decision of its own | Out of scope. Not recommended. |

---

## §5 — WHERE IT LIVES IN THE DOORS

### The four doors do not move

CAMPAIGN / SOLO / HOST / JOIN is ratified after a rollback (a0-15): *"you took
this too far, its too complicated, you can switch it back to how it was CAMPAIGN,
SOLO, HOST, JOIN… its way too complex for new players to understand."*
`src/ui/lobby-entry.ts` carries that ratification in its header and
`voice-door-labels.test.ts` pins the words. **This plan adds no door, renames no
door, and reorders no door.**

### JOIN grows a second mode

`EntryScreen` is `'home' | 'join'` today. It becomes `'home' | 'join'` still —
the join *screen* gains a two-segment switch at the top:

```
        ┌─────────────┬─────────────┐
        │   BROWSE    │    CODE     │        <- two segments, one selected
        └─────────────┴─────────────┘
   BROWSE: the list (§3, §4)      CODE: the keypad that ships today, untouched
```

- **The keypad is not touched.** `typeEntryCode`, `eraseEntryCode`,
  `canSubmitJoin`, `submitJoin`, `KEYPAD_KEYS`, the 8×4 landscape shape and every
  string stay exactly as they are. The CODE segment *is* today's join screen.
- **BACK still goes to the doors** from either segment, and still drops what was
  typed (`backToDoors`).
- **`entryLive` still governs both.** A tap on a row while an attempt is in flight
  is a no-op, exactly as a second tap on HOST is — this is what stops a
  double-tap opening two rooms, and the list must inherit it rather than
  reinventing it.

**Which segment JOIN lands on is D2.** The recommendation: **BROWSE on the first
visit, then whichever the player used last**, persisted through
`platform.storage` exactly as the map pick is (`MAP_STORAGE_KEY`). Rationale: a
player who has a code is one tap from the keypad and will only pay that tap once;
a player who has *no* code has nothing to do on the keypad at all, and landing
them there is the failure the developer is asking to fix. Cost: one storage key,
and one extra tap for the friend-with-a-code on their very first join.

### One thing the browse screen may not become

**It may not become a fifth door.** No BROWSE button on the home screen, no
"quick join" that skips the list, no auto-join-the-best-room. The home screen
answers *how do you get in*; the JOIN screen answers *which room*. That
separation is what a0-15 rolled back to.

---

## §6 — COST

### What it spends

**Listing traffic hits the allocator only.** Not one byte reaches a gameserver, so
a hundred browsers idling cannot cost a live match a frame — the property
`allocator/index.ts` names in its header (*"the allocator is not in the gameplay
path"*) and this design keeps.

Measured (§3 of the measurements), for the deployed 2-Machine fleet at its
6-rooms-per-Machine ceiling:

- **1331 bytes** per full listing; **887 bytes** filtered to joinable rooms.
- **12 requests/min, ~16 kB/min, ~0.96 MB/hour** per open browser at a 5 s poll.
- **~1.0 µs** of allocator CPU to build a 120-room listing — five orders of
  magnitude below the poll interval. **Bytes and CPU are not the constraint.**

**The constraint is request count**, because the allocator is one
`shared-cpu-1x` (6.25% of a core, `docs/hosting-plan.md`) and every poll is a
TLS-terminated HTTP round trip through Fly's edge. A classroom of 30 browsers at
a 5 s poll is **6 requests/second** — comfortable, and the number to keep an eye
on, not the kilobytes.

### How it is bounded — four rules, all client-side and all cheap

1. **One request per refresh, never a fan-out.** The rejected design (`GET
   /rooms/:code` per row) is 12× the requests today and grows with the fleet.
2. **Poll only while the BROWSE segment is on screen.** Leaving JOIN stops the
   timer. Not a heuristic — a lifecycle.
3. **Suspend on a hidden tab.** `document.visibilityState !== 'visible'` stops the
   timer and a resume triggers one immediate refresh. The "idle browser" the brief
   asks about is overwhelmingly a *backgrounded* one, and this takes its steady
   cost to **zero**.
4. **Keep the request "simple", so it never preflights.** The game runs from
   GitHub Pages and every allocator call is cross-origin. A `GET` with no custom
   headers is a CORS-simple request and skips the `OPTIONS` preflight; adding one
   custom header **doubles the request count** for nothing. (Trap 11.)

**Optional hardening, if 6 req/s ever looks like a number:** an `ETag` over the
listing with `304 Not Modified` on an unchanged registry. Rooms change rarely
relative to a 5 s poll, so most polls become a 304 with no body. Cheap, standard,
and no new dependency — but **not needed to ship**, and it should not be built on
speculation.

### What it does *not* spend, and the one thing it might

- **No new Machine, no new app, no new secret.** The route lives in the process
  that is already always-on and already exactly one.
- **No gameserver cost at all.**
- **But it may pull forward a sizing decision that is already open.** A browser
  makes an open room *findable*, so more rooms stay open and fill. The fleet
  advertises **6 rooms per Machine, 12 total** (`docs/server-capacity.md`), and
  `server-capacity.md` §3 already recommends moving to `shared-cpu-2x` / 512 MB
  (**12 rooms per Machine, +$1.40/month for 2.1× the rooms**) — *"a deploy
  decision and it is not made here."* The browser is the feature most likely to
  make that ceiling bind. **Named, priced, and put to the developer as D5.**

---

## RECOMMENDED ARCHITECTURE

```
server/room.ts        MatchRoom.listed (creator-only, lobby-phase, default true)
                      + optional: .abundance already there, .botSeats countable
        │
server/match-server.ts  roomLoads() adds { listed, abundance?, bots? }
        │  POST /fleet/heartbeat (unchanged transport, additive fields)
        ▼
allocator/registry.ts   Room gains listed?/abundance?/bots? (all optional)
allocator/allocator.ts  NEW: rooms(now): RoomListing[]  — heartbeat-confirmed
                             rooms only, joinable && listed, no leases
allocator/index.ts      NEW: GET /rooms → { rooms, asOf }   (POST /rooms unchanged)
        │  one CORS-simple GET, ~1.3 kB, polled at 5 s
        ▼
src/net/lobby-list.ts   NEW: readLobbyList(config) → RoomListing[] | null
                        (decides nothing; `null` for every failure — the
                         readRoomAdvert doctrine)
        │
src/ui/lobby-browser.ts NEW: the pure model — rows, age stamp, empty line,
src/ui/lobby-browser-view.ts   CLOSED state, selection. DOM-free like every
src/ui/lobby-entry.ts   model in the directory.
                        + the BROWSE / CODE segment switch. Keypad untouched.
        │
src/net/ticket.ts       NEW claim: intent: 'create' | 'join'  (absent = create)
server/match-server.ts  a 'join'-intent ticket for an unhosted code is refused
                        with JoinRejection 'room-gone', never openRoom()'d
```

**Every new wire field is optional and every absent value reads as today's
behaviour.** That is the repo's standing additive discipline (`LobbySlot.state`,
`MatchStartMessage.you`, `Room.size`, `Room.mode` all shipped this way) and it is
what lets these milestones land in any order without a lockstep deploy.

---

## TASK LIST (needs-ordered, TDD — the safety fix first, the UI last)

Each step names the owning agent and the test that must be **red before the code
and green after**. Steps within a milestone are ordered by need.

### Milestone A — the dead-row refusal (Netcode Engineer) — **BLOCKS THE BROWSER**

> This closes a bug that exists today on the code path, and the browser
> multiplies it. It ships first, alone, and is verifiable without any UI.

- **A1.** `src/net/ticket.ts`: add `intent?: 'create' | 'join'` to the signed
  claims.
  *Test (`src/net/ticket.test.ts`):* a ticket signed with `intent: 'join'`
  verifies and round-trips the claim; a ticket signed **without** one verifies and
  reads `undefined`. Tampering with `intent` fails the HMAC.
- **A2.** `allocator/allocator.ts`: `allocate()` signs `intent: 'create'`;
  `join()` signs `intent: 'join'`.
  *Test:* `verifyTicket` on each allocation's ticket reads the expected intent.
  The `Allocation` response shape is otherwise **byte-identical** (assert the
  JSON keys).
- **A3.** `server/match-server.ts`: a join whose ticket carries `intent: 'join'`
  for a code `this.rooms` does not hold is **refused**, not opened. New
  `JoinRejection` value `'room-gone'`.
  *Test (`tests/server/ticket-enforcement.test.ts`):* (i) join with a
  `join`-intent ticket for an unknown code → `joinError: room-gone`, and
  `server.roomLoads()` is still `[]` — **no room was created**; (ii) the same with
  a `create`-intent ticket → a room opens, exactly as today; (iii) with
  `ticketSecret` unset, both behave as today (the self-hosted path has no
  allocator to sign an intent).
- **A4.** `src/ui/online-copy.ts` + `src/ui/lobby-entry.ts`: `room-gone` maps to
  a sentence. Recommended wording, reusing the existing register: **`That claim
  has closed. Pick another, or press SOLO.`**
  *Test (`src/ui/lobby-entry.test.ts`):* the mapping exists and
  `voice-door-labels.test.ts`'s rule still holds — the line names a door that is
  actually on the screen.
- **A5.** Regression on the **code** path: typing a code whose room was swept one
  beat ago now says `No claim with that code` (or A4's line), and does **not**
  open an empty room.
  *Test:* `tests/net/` end-to-end over `tests/net/local-fleet.ts`, driving the
  sequence `spikes/lobby-browser/measure-listing.ts` §2 reproduces.

### Milestone B — the listing (Netcode Engineer)

- **B1.** `allocator/registry.ts`: `Room` gains `listed?: boolean`.
  *Test (`allocator/registry.test.ts` or `tests/net/`):* a heartbeat carrying
  `listed: false` round-trips; one omitting it reads `undefined`.
- **B2.** `server/room.ts`: `MatchRoom.listed` — settable from
  `lobbyChoice.listed`, **creator-only, lobby-phase only**, default per D1.
  *Test (`tests/server/`):* the creator flips it and the next `roomLoads()`
  carries it; a **joiner's** `lobbyChoice.listed` is ignored; a flip once the
  room is `live` is ignored.
- **B3.** `server/match-server.ts` `roomLoads()` carries `listed`.
  *Test:* `tests/server/heartbeat.test.ts` — the body shape.
- **B4.** `allocator/allocator.ts`: `rooms(now): RoomListing[]`. Heartbeat-
  confirmed rooms **only** (no leases), filtered to `joinable && listed !==
  false`, each carrying `{code, region, size, mode, players, joinableSeats}`.
  *Test:* (i) a lease-only room is **absent** from the list but still answers
  `roomInfo`; (ii) a full room is absent; (iii) a `listed: false` room is absent;
  (iv) a Machine 15 001 ms past its last beat contributes nothing — assert
  against the injected clock, **never `Date.now()`**.
- **B5.** `allocator/index.ts`: `GET /rooms` → `{ rooms, asOf }`. `POST /rooms`
  untouched; a `PUT` still `methodNotAllowed`.
  *Test:* over a real socket, as the existing allocator route tests do. Assert
  the CORS grant rides the response and that **no custom request header is
  needed** (Trap 11).
- **B6.** `src/net/lobby-list.ts`: `readLobbyList(config)`. `null` on 404, on a
  thrown fetch, on non-JSON, on a malformed body — one value for all of them.
  *Test (`src/net/lobby-list.test.ts`):* each failure path, and a happy path that
  drops a malformed row rather than the whole listing.

### Milestone C — what the row can say (Netcode Engineer) — optional, per D6

- **C1.** `HeartbeatRoom.abundance?` → `Room.abundance?` → `RoomInfo.abundance?`
  → `RoomListing.abundance?`.
  *Test:* a room whose host set `YIELD · RICH` advertises `rich`; a room that was
  never told advertises `scarce` (`DEFAULT_ABUNDANCE`, the ratified product
  default — **not** `standard`, which is the n5-01 bug).
- **C2.** `HeartbeatRoom.bots?`, counted from the room's authored seat states.
  *Test:* a lobby where the host authored 3 bot seats advertises `bots: 3`
  **before** RUSH!, when no bot is seated yet.

### Milestone D — the browse screen (UI Engineer)

- **D1.** `src/ui/lobby-browser.ts` — the pure model. Rows, selection, the age
  stamp, the `CLOSED` one-cycle state, the empty-list sentence.
  *Test:* (i) rows render from a listing; (ii) a listing that omits a previously
  present room marks it `CLOSED` for one cycle and drops it on the next; (iii) an
  empty listing yields the sentence, never an empty array on screen; (iv) a
  failed refresh keeps the previous rows and ages the stamp; (v) the stamp
  crosses into the failure register past two intervals.
- **D2.** `src/ui/lobby-entry.ts` — the `BROWSE` / `CODE` segment. The keypad
  path is **unchanged**.
  *Test:* (i) every existing `lobby-entry.test.ts` case still passes untouched —
  this is the regression gate; (ii) the segment switch is dead while
  `entryLive` is false; (iii) BACK from either segment reaches the doors;
  (iv) `DOOR_OPTIONS` is still four entries in `DOOR_ORDER`
  (`voice-door-labels.test.ts` already asserts the words).
- **D3.** `src/ui/lobby-browser-view.ts` + `lobby-geometry.ts` rows. Landscape
  first; the row must fit the phone's short axis. Golden re-baseline as the UI
  lane does.
  *Test:* the copy-fit measurement (`tests/mobile/voice-copy-fit.spec.ts`
  pattern) — a row's label budget is measured in the booted page, not assumed.
  The SOLO hint is the standing proof that this overflows silently.
- **D4.** Tapping a row produces the **same `EntryIntent`** a typed code does
  (`{door: 'join', room, online: true}`), so the transport, the connect trace and
  every failure path are shared with the code path and nothing is reimplemented.
  *Test:* a tap and a typed code produce identical intents for the same room.
- **D5.** The poll lifecycle: on entering BROWSE, on a visible tab, stopped
  otherwise, one immediate refresh on resume.
  *Test:* a fake clock and a fake visibility source — no timers in the test.

### Milestone E — the measured ping (UI + Netcode)

- **E1.** The browse screen reads `GET /regions` once on open and runs
  `region-probe` (`src/net/region-probe.ts`) — **reused, not reimplemented**.
- **E2.** One region → one line above the list. Two or more → the region moves
  into the row.
  *Test:* a one-region fleet draws no per-row region; a two-region fleet does;
  an unmeasured region prints `—` and **never `0ms`**.

### Milestone F — hardening (Netcode Engineer, only if needed)

- **F1.** `ETag` / `304` on `GET /rooms`. Build only if the request rate is
  observed to matter; §6 says it does not yet.

### Not in this plan, and briefed separately

- **The map on the wire.** `mapId` reaching `MatchRoom` → `createWorld` →
  `matchStart` → `beginPredicting` → the heartbeat. It is a live bug on its own
  (MAP SELECT is decorative online) and it is the *only* thing standing between a
  row and a MAP column. See D6.

---

## TRAPS (the ones that bite an implementer who skims)

1. **Do not list lease-only rooms.** `Allocator.roomInfo` answers for the boot
   gap on purpose (a joiner must reach a room before its first heartbeat). A
   *list* must not — a lease says `joinable: true` with no occupancy for 15 s and
   is the biggest ghost-row generator there is. Two different questions, two
   different answers; the code paths must not be shared.
2. **`size` compacts at RUSH!.** Measured: a room advertising `size: 8` in its
   lobby advertises `size: 4` once started, because `startMatch` fields humans
   plus host-set bots and renumbers the survivors (a0-11). A row that prints "of
   8" is printing a lobby number; never carry it across the phase boundary.
3. **Never recompute `joinableSeats`.** It is *free **and** open* — a seat the
   host shut or put a bot in is not one (`server/room.ts`, a0-11). `size −
   players` is wrong for every room the host has shaped, which is most of them.
4. **`Room.players` counts humans, not participants.** A row reading "1 PLAYER"
   for a room whose host authored seven bots is honest about humans and silent
   about the match. If that matters, it is C2 (`bots` on the ad) — do not infer it
   from arithmetic (see Trap 3).
5. **The listing decides nothing.** `readRoomAdvert`'s header states the doctrine
   and it applies double here: *"the allocate/join round trip remains the only
   authority on whether a player gets in."* A browser that refuses a join locally
   is a second, weaker gate saying the same thing worse — and it will be wrong,
   because it is up to 10 s stale.
6. **Never print `0 ms`.** An unmeasured region is `—`. `region-probe.ts` rule 1
   exists because `0ms` reads as *the best server in the fleet*, and the lobby's
   per-seat ping already refuses the same lie.
7. **Listing a room publishes its code.** The row not printing it is a UI
   courtesy, not secrecy — the JSON carries it because the code is the join key.
   Do not write copy that promises otherwise.
8. **Four doors.** No BROWSE on the home screen, no quick-join, no
   auto-matchmake. a0-15 was a rollback; the next over-complication of the entry
   flow is the second one.
9. **The browser must not keep an empty room alive.** a0-11 stands: an abandoned
   lobby is swept at once and a room whose only human is the host reverts local at
   RUSH! and is released. Do **not** add "but it is listed" as a reason to hold a
   room open, do **not** extend the sweep, and do **not** re-create a room to
   honour a stale row (which is exactly what happens today — Milestone A).
10. **`GET /rooms` and `POST /rooms` are the same path.** `route()` in
    `allocator/index.ts` dispatches on pathname *then* method; the new GET branch
    must sit beside the POST, and a `PUT` must still get `methodNotAllowed`.
11. **Keep the poll CORS-simple.** The game is served from GitHub Pages; the
    allocator is a different origin. A plain `GET` with no custom headers skips
    the preflight. Adding one custom header turns every poll into **two**
    requests — doubling the only cost this feature actually has (§6).
12. **Never `Date.now()` in a registry test.** Every method on `RoomRegistry`
    takes `now`; the whole staleness envelope is testable exactly because of it.
    The spike is the worked example.
13. **Additive wire fields only.** `listed`, `abundance`, `bots`, `intent` — all
    optional, all absent-reads-as-today. A pre-a0-26 Machine must keep listing and
    a pre-a0-26 client must keep joining.

---

## DECISIONS FOR THE DEVELOPER

Six calls. Each has a recommendation and its price; the Director briefs the build
from what is picked.

### D1 — Does creating a room now mean publishing it? *(the sharpest call)*

| Option | What it costs |
|---|---|
| **(a) Public by default, PRIVATE toggle in the lobby** *(recommended)* | A host who wanted friends-only must notice and flip a control; until they do, a stranger can take the seat their friend was coming for. The HOST door's hint must change to say both things. **And a listed room's code is public** — see Trap 7. |
| (b) Private by default, PUBLISH toggle | The browser is empty on the first tap, which reads as broken, and the feature only works for players who already know it exists. It also does nothing for a0-11's real problem — an open room nobody can find quietly becoming a solo match. |
| (c) Always public, no toggle | Simplest to build and one fewer control on a lobby that already has mode, YIELD, map, ship and eight seat rows. But it removes the only privacy the game has with no way back, and the code path's implicit privacy is a thing players are already using. |

**Recommendation: (a).** The argument for the default is the developer's own
ruling that *"creating a room should start with all slots OPEN and no bots"* — a
room that exists is a room whose seats were left open for people — plus a0-11's
consequence that an unfindable open room becomes a solo match at RUSH!. **That is
an argument, not the developer's word, which is why this is here.**

Money: none. Build: one optional wire field, one lobby control, one hint rewrite.

### D2 — Which mode does JOIN land on?

| Option | What it costs |
|---|---|
| **BROWSE first, then remember the last used** *(recommended)* | One extra tap, once, for the player whose friend just read them a code. One storage key. |
| CODE first (today's behaviour), BROWSE one tap away | The player with no code — the one this feature is for — lands on a keypad they cannot use. |
| Always BROWSE | A friend-with-a-code pays the extra tap every single time. |

**Recommendation: BROWSE first, then remembered**, persisted exactly as the map
pick already is. Money: none.

### D3 — The staleness behaviour, and the refusal that goes with it

**Recommendation: build Milestone A (the `intent` ticket claim) BEFORE the
browser.** Measured, a tap on a room that died within the last 5 s currently
**creates an empty room** the player then sits alone in — no error, no
explanation. That is `a1-13`'s "sitting watching a card", generated on purpose by
a list of tappable rooms.

The alternative — ship the browser first and accept it — is a real option and
costs nothing to build. Its price is that the first thing the feature reliably
produces is the exact confusing failure the brief says is *"worse than no list."*

Money: none. Build: one signed claim, one guard, one sentence of copy — and it
fixes the code path too.

### D4 — The refresh cadence

**Recommendation: 5 s, suspended on a hidden tab, one request per refresh.**
Measured cost: **12 requests/min and ~16 kB/min** per browser that is actually on
screen; **zero** while backgrounded. A 2 s poll is 2.5× the requests for a
staleness improvement that is bounded below by the 5 s heartbeat anyway — **the
list cannot be fresher than the heartbeat that feeds it**, so a poll faster than
5 s buys nothing at all.

Money: negligible (§6) — but it is the one number to watch, and it is requests,
not bytes.

### D5 — Does the browser change the fleet sizing? *(this one spends money)*

The fleet advertises **6 rooms per Machine, 12 in total**
(`docs/server-capacity.md`). A browser makes open rooms findable, so more of them
fill instead of reverting to solo — the ceiling binds sooner. `server-capacity.md`
§3 already recommends, and explicitly leaves to the developer, a move to
**`shared-cpu-2x` / 512 MB: 12 rooms per Machine for +$1.40/month across the two
Machines** ($0.23 per room against $0.40, and 2.1× the rooms for 22% more money).

**Recommendation: do not pre-buy it.** Ship the browser on today's guest and
watch `/health` (`rooms`, `loopLagMs`). The upgrade is a `fly.gameserver.toml`
change and a roll, so it is an afternoon whenever the ceiling is actually
reached. **But if a classroom session is planned before that can be observed, buy
it first** — a full fleet refuses room creation with `no-capacity` (HTTP 503), and
the browser is the feature that makes a full fleet likely.

Money: **$1.40/month**, the developer's call, already priced in
`docs/server-capacity.md` §3.

### D6 — Which columns is a row allowed to grow?

| Column | Recommendation | Cost |
|---|---|---|
| **Abundance (YIELD)** | **Yes** — Milestone C1 | ~10 lines plus tests. It is the most match-shaping thing a host picks, and the room already knows it. |
| **Bots** | **Developer's call** | Milestone C2. Cheap, but note the wording trap: before RUSH! no bot is seated, so the number is the host's *authored* bot count, not a bot in a chair. |
| **Map / arena** | **Yes, but as its own brief — not this one** | **`mapId` never crosses the wire at all** (measured). MAP SELECT is decorative online today: an online host who picks the diamond arena flies the default board under a diamond sky. That is a live bug of the same family as n5-01 and the m10 teams-wire, it is worth fixing for its own sake, and a MAP column is free once it is fixed. |

---

## APPENDIX — reproducing every number here

```sh
npx vite-node spikes/lobby-browser/measure-listing.ts     # all four sections
npx tsc --noEmit --project spikes/lobby-browser           # the spike typechecks
```

Captured output: `spikes/lobby-browser/measured-a0-26.txt`. The spike imports the
shipped `InMemoryRoomRegistry`, `Allocator`, `MatchServer` and `MatchRoom` and
drives them on an injected clock; it adds nothing to `src/`, is excluded from the
build and from the root `tsconfig.json`, and re-running it prints the same numbers
every time.
