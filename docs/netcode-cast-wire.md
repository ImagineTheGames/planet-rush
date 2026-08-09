# The cast on the wire — how a chosen character reaches the room

*Netcode Engineer, a0-06b. Companion to `docs/design-amendments.md` (a0-06, GDD
§2.1 amended 2026-08-07) and `docs/netcode-teams-wire.md`, whose shape this
follows because it is the same class of bug. Written against
`agent/netcode/a0-06b-wire-botPersonalities`.*

---

## 1. The report, and what it was not

a0-06 answered two developer reports at once:

> *"how about for bots we are able to select their personality instead of
> EASY/MEDIUM/HARD and it shows the difficulty next to their personality"*

and, earlier, *"I chose HARD and got other difficulties."* The fix was to delete
the control that could disagree with the cast: the lobby seat stores **one**
thing, a character, and the tier chip beside it is derived from that character
and is not a button. A mismatch stopped being unlikely and became
unrepresentable.

Offline, that is the whole story — `lobbyRosterCast` → `MatchBootConfig.cast` →
`fillEmptySlots`, in process, exact.

Online it was not. The bug survived on the transport, and it survived **looking
green**, which is the part worth writing down. `LobbyChoiceMessage` carried
`botDifficulties` and no character row, so `server/room.ts` `castFor` re-derived
a character from the tier:

```ts
const tier = rosterAt(wanted);              // 'hard' → ['sable','vulture','warden']
const pick = tier[index % tier.length];     // …one of three, by index
```

**Three characters share the Hard tier and one tier names all three.** So a host
who filled seven seats with Wardens, Sables and Vultures sent seven `'hard'`s,
and the room built a cast from its own index arithmetic. Same tiers, different
names:

| seat | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| host picked | warden | warden | sable | vulture | warden | sable | vulture |
| room seated (before) | sable | vulture | warden | sable | vulture | warden | sable |

Every test passed, because every test asserted `botDifficulty === 'hard'` — which
was true, and was never the claim. That is the trap this brief leaves behind for
anyone touching the cast again: **assert on names; the tier assertion is what
passes on the bug.**

## 2. The chain, and the link that was open

```
lobby seat (one character; the tier is DERIVED)   src/ui/lobby.ts
  → [OFFLINE] lobbyRosterCast → MatchBootConfig.cast → fillEmptySlots   (a0-06, exact)
  → [ONLINE]  lobbyChoice.botDifficulties                               ← the tier only
              lobbyChoice.botPersonalities        src/net/transport.ts  ← WAS OPEN
       → parseBotPersonalities                    src/net/wire.ts
       → Room.botPersonalities                    server/room.ts
       → castFor(botIndex) → seatBot → createBot
       → matchStart.slots[].personality           src/net/transport.ts  ← WAS OPEN
```

Two links, not one. The first carries the pick **in**; the second carries the
result **back out**, because the roster that ends the lobby named the hull and the
side and said nothing at all about who was in the ship — so a client had no way to
name the cast authority built, and named its own lobby's guess. For the host those
agreed by luck. For a joiner, whose lobby never authored a cast at all, they did
not.

## 3. The decision: which store is authoritative

The brief's sharpest requirement is that two rows which can disagree are exactly
what a0-06 existed to delete, so one of them must win.

**The character row wins, and the tier is derived from it.**

Concretely, in `castFor`, three answers in a fixed order:

1. `botPersonalities[index]` — **the host's pick**. The tier is then taken from
   `PERSONALITIES[character].difficulty` in `seatBot`, and `botDifficulties[index]`
   is *never read for that seat*.
2. `botDifficulties[index]` — a character of that tier, by index. Verbatim the
   pre-a0-06b behaviour, kept for clients that still speak only tiers.
3. Roster order, so a lobby that says nothing still gets the full seven.

The property this buys is stronger than "the server validates that they match": a
seat that names a character has **one** source of truth, because the other one is
not consulted. There is no reconciliation step to get wrong, and no way for a
future edit to start blending them.

### What was rejected, and why

- **Validate-and-refuse** (drop the whole `lobbyChoice` when the tier and the
  character disagree). It converts a benign client bug — a stale tier row beside a
  fresh cast — into the host losing their cast *and* their hull, on a message
  where every other malformed field is dropped rather than refused. It also makes
  the wire's contract "send two consistent things" instead of "send one thing".
- **Delete `botDifficulties` from the wire.** Tempting, and wrong twice over: the
  tier is still *shown* (that is the ratified design — shown, not chosen), and an
  older client that sends only tiers must keep getting a sane room. Deleting the
  row would have made every pre-a0-06b client's cast fall to roster order
  regardless of what it asked for.
- **Sending one row of `{character, tier}` pairs.** Cleaner on paper; it breaks
  every existing client at once, for a field the server derives anyway.

### Why they cannot slide against each other

Both rows are built on the client from the *same* filter over the *same* seats —
`botDifficulties` maps `PERSONALITIES[seat.character].difficulty` over the bot
seats, `botPersonalities` maps `seat.personality` over the same ones, and both are
gated by the same `isBotSeat`. Same length, same order, by construction rather
than by convention. That matters because the failure mode of a misaligned pair is
not a crash — it is seat 5's character quietly arriving at seat 2, which is the
same off-by-one `parseSeatStates` already refuses whole arrays to avoid.

## 4. What an old client gets

A client that sends `botDifficulties` and no `botPersonalities` gets **today's
behaviour, unchanged**: the right tier in every bot seat, and a character of that
tier chosen by index. That is a legal cast, and it is the best answer available to
a sender that never named one. A client that sends neither gets roster order —
also unchanged.

The fallback is **per seat, not wholesale**. A cast naming three characters in a
room that seats five bots resolves the first three by name and the last two by
whatever the tier row or the roster has to offer. A whole-array fallback would
have thrown away a partial pick in silence.

## 5. Hostile input

`parseBotPersonalities` is on the same footing as every other array on this
surface: at most `MAX_PLAYERS` entries, rejected **whole** rather than per-entry
(a dropped entry shifts every seat after it), and dropped rather than refused, so
a malformed cast never costs its sender the hull riding the same message.

Membership is tested against `ROSTER` — an **array**, with `includes`. a0-06
shipped the client-side form of this guard as `chosen in PERSONALITIES`;
`PERSONALITIES` is an object literal, so `in` walks the prototype chain and
`constructor`, `toString`, `valueOf`, `hasOwnProperty` and `__proto__` all passed
a check meant to admit seven strings. Seating one yields a bot whose personality
row is a *function*, and `createBot` then reads `.shipClass` off it. On the client
that was unreachable, because every cast came from locally authored seats. **Here
it is the front door**, and the sender is whoever is holding the socket.

## 6. Duplicates, and why they are load-bearing

Eight seats, seven characters, and only three of them Hard. The developer's own
balanced 4v4 of Hard bots therefore needs a fourth Hard character that does not
exist — so a repeat is not an edge case, it is the ordinary way to author a
symmetric match. `castFor` indexes; it does not de-duplicate. Two Wardens in is
two Wardens seated, in two distinct seats, flying two Excavators.

## 7. Cost

Zero on the streamed snapshot. `botPersonalities` rides `lobbyChoice`, which is
sent on change while a lobby is on screen and never once a match is live;
`matchStart.slots[].personality` rides RUSH! exactly once. Both are static match
config, and static match config never touches the 30 Hz path (spike §S2, Trap 7 —
the same rule teams were wired under).

Seven ids of at most seven characters each: under 80 bytes of JSON on a message
that already carries a hull, a fire mode, eight seat states and eight team
numbers.

## 8. What is proven, and where

- `tests/server/room-cast.test.ts` — the room, through the real wire parser:
  exact names; two Wardens in, two out; the old-client fallback byte-for-byte; a
  short cast falling back per seat; a guest unable to re-cast the room; same seed
  + same lobby → identical snapshot bytes twice, and a different cast on the same
  seed diverging (so that determinism claim is not vacuous).
- `tests/net/online-cast.test.ts` — the same claim over a real socket, with the
  real lobby model driven the way `src/main.ts` `sendChoice` drives it. Writes
  `evidence/a0-06b-online-cast/readback.json`.
- `src/net/wire.test.ts` — round trip with repeats, the roster as the allow-list,
  and a malformed cast dropped whole.

Verified failing without the fix: with `castFor`'s new branch disabled, 8 of the
10 room-level cases go red. The two that stay green are the fallback cases, which
is correct — they do not depend on the branch.

## 9. Still open

`src/ui/lobby-flow.ts` `choiceFor` builds the same `lobbyChoice` for the flow
model and still sends tiers alone; `src/ui/lobby.ts` `applyLobbySlots` still
re-derives a name from `LobbySlot.botDifficulty` rather than reading the
`botPersonality` the room now publishes beside it. Both are UI's files. Neither
costs correctness on the shipped online path — the room seats the host's cast
either way — but until they land, a *guest's* roster still shows its own guess at
the names rather than the room's answer.
