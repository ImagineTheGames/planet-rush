# Teams on the wire — how a side reaches the simulation

*Netcode Engineer, m10. Companion to `docs/variable-slots-plan.md` Task C4 and
`docs/netcode-audit.md`. Written against `agent/netcode/m10-teams-wire`.*

---

## 1. The report, and what it was not

> *"I played in teams mode but everyone attacked me and I could attack everyone.
> Also impossible to know who is on your team."* — developer, tested **offline**.

The first job was not to wire anything. It was to find out whether this was a
regression of the p14 sim work (which QA verified in a 2v2) or a mode that never
got wiring at all.

It is the second, and nothing in `src/sim` was wrong. Every rule the report
complains about was already built and already tested
(`src/sim/teams-identity.test.ts` pins all four):

- `areEnemies` / `canDamage` read `team`, not just self;
- auto-aim and turrets never lock a teammate;
- friendly fire is off by construction;
- teammates take contiguous home slots on every map.

All four are functions of one number — `Ship.team` — and **nothing ever wrote
it**. Both world-build paths dropped the lobby's assignment on the floor, so every
ship defaulted to its own side. Teams-of-one *is* free-for-all. Every symptom in
the report follows from that single missing hop, which is why the sim tests were
green the whole time.

## 2. The chain, and the two links that were open

```
lobby (mode + per-seat team)
  → MatchConfig                    src/ui/lobby.ts  lobbyMatchConfig
  → [OFFLINE]  dense roster        src/sim/match-config.ts  configToPlayers
       → bootOfflineMatch          src/platform/match-boot.ts      ← WAS OPEN
       → LocalLoopback → createWorld
  → [ONLINE]   lobbyChoice.mode/.teams   src/net/transport.ts      ← WAS OPEN
       → MatchRoom.applyTeamConfig  server/room.ts
       → lobbyState / matchStart / createWorld
  → Ship.team → areEnemies         src/sim/allegiance.ts
```

**Offline.** `bootOfflineMatch` built its roster from the bot seating alone — a
hull per seat and nothing else. The lobby's `MatchConfig` never left the lobby.
`main.ts` said so in a comment ("their offline world-build wiring is Task C4 —
Netcode"), and that is the hole. `MatchBootConfig` now takes a `teams` table in
the sim's **dense** player order and stamps `team` onto the roster — team only, so
a bot keeps its character's silhouette (style-guide §4).

**Online.** `lobbyChoice` carried a hull, a fire mode and the bots' difficulties.
It carried no match shape at all, so a room was permanently whatever mode the
allocator was told at CREATE — and the client never tells it, so: always FFA. Every
seat kept the `team = player` it was constructed with, for the life of the room.
The message now carries the host's `mode` and per-**slot** `teams`, both
creator-only and both bounded at the wire; `MatchRoom.applyTeamConfig` folds them
into its seats, where `lobbyState`, `matchStart` and `createWorld` were already
waiting for them.

Two orders, on purpose, and they are not interchangeable:

| | indexed by | used by |
|---|---|---|
| `lobbyWireTeams` | physical slot 0..7, closed included | the server's seats (`slot.player`) |
| `lobbyRosterTeams` | dense 0..N-1, closed dropped | the world the client builds itself |

Collapsing them into one function is how a sparse lobby id `{0,2,5}` gets into the
sim (spike Trap 6).

**And the taps.** `seatTeamChip` and `mode` folded the model and re-rendered
without sending anything, in *both* dispatchers. An online host could watch their
own roster split into two sides while the room stayed FFA underneath them.

Allegiance remains static match config throughout: it rides the low-frequency
lobby message and costs the streamed snapshot **zero bytes** (spike §S2, Trap 7).

## 3. The second half of the report — reading who is on your side

> *"Impossible to know who is on your team."*

Colour was never going to answer this and never could: the eight identity colours
are per-**slot** (style-guide §3.1, ratified), so a side owns no hue of its own.
The lobby's answer was a bare `A` on a 30 px chip — a legend nobody was given —
and it did not exist in the match at all.

Ratified: **colour alone is insufficient.** So the side says its name. `TEAM A` /
`TEAM B`, in words, beside the name on every nameplate in TEAMS, and the same
string on the lobby chip, from one formatter (`teamName`, `src/ui/lobby.ts`) so the
roster and the battlefield teach one vocabulary. FFA draws exactly what it always
did — teams-of-one has no side worth naming.

The label reads the **live world's** `ship.team`, not the lobby's copy of it: the
number a player reads over a hull is the number `areEnemies` acts on, so a
nameplate cannot claim an allegiance the simulation disagrees with.

## 4. The gate — `online-teams`

Riding the next QA evidence round, on the live fleet. Two clients, one room.

1. **Author a 2v2 in the lobby.** Host: flip MODE to TEAMS, then tap the team
   chips until the two humans read `TEAM A` and the two bots read `TEAM B`.
   *Watch the guest's screen*: the split must appear there without a reload — it
   comes back down the authoritative `lobbyState`, not from the guest's own model.
2. **RUSH!, then screenshot a nameplate.** Every ship and every owned station
   carries `NAME TEAM A` / `NAME TEAM B` next to the name, in the owner's identity
   colour, one step dimmer than the name. **This is the capture the gate wants.**
   Under `?debug=1` the drawn labels are readable back through
   `Hud.debugNameplates()` (`DrawnNameplate.teamLabel`), so a live-stage spec can
   assert the drawn string rather than eyeball it.
3. **Fly into your teammate and hold fire.** Nothing happens: no lock, no hull
   loss, no hit spark. Fly at their station and hold fire: the reactor does not
   move, and *your ally's under-attack alarm never rings* — `canDamage` refuses the
   hit outright, so there is no damage for the alarm to hear.
4. **Fly through your teammate at an enemy behind them.** The shot passes through
   the ally and bites the enemy — friendly fire off is a *pass-through*, not a
   blocked shot.
5. **Look at the spawn.** Your teammate's home is on the arc next to yours, not
   across the board.
6. **Paste the log.** COPY LOG as usual; the excerpt the gate wants is zero
   friendly-damage events over the match.

The headless half of 3–6 is already green and does not need the round:
`tests/net/online-teams.test.ts` plays the whole 2v2 through a real
`MatchServer` and prints a friendly-damage ledger (with an FFA control that
bleeds, so the zero is not a stuck instrument);
`tests/net/online-lobby-flow.test.ts` runs a 2v2 over real sockets with two real
clients; `tests/net/offline-teams-boot.test.ts` reproduces and closes the offline
report through the current unified lobby. What the round adds is the one thing
this lane cannot produce — a browser, and therefore the screenshot.

## 5. Known-open, named rather than left to be discovered

- **Bots still perceive allies as targets.** `src/bots/perception.ts` filters only
  the bot's own ship and station out of its view, not its side, so a bot in TEAMS
  will *aim* at a teammate. Nothing is damaged (the shot passes through — §2), but
  the behaviour is visible and it contradicts GDD §2.9's "a bot never targets an
  ally." One filter, in the Bot Engineer's lane, not this one. **A teams match
  with bots on both sides will look wrong before it plays wrong.**
- **The landscape phone spends its lobby ping to read its sides.** The word
  `TEAM A` needs a chip of 64 px where the bare letter needed 30, and on a 221 px
  landscape-phone row `teamChipRect` clamps that chip strictly right of centre —
  so its left edge, the edge the ping measures against, moves in to the centre pad
  whatever the constant says. No chip wide enough to hold the word leaves a 56 px
  `· 245ms` room on that row: the two ratified features want the same 50 px and
  only one can have them. The label wins — it answers the reported bug and is
  ratified for **both** form factors, and the ping already owns a graceful way to
  lose (`pingFits` drops the number rather than drawing it under a chip). The cost,
  bounded: on a landscape phone **in TEAMS**, a human seat's roster ping is now
  dropped at every name length instead of only near-maximum ones. FFA on the same
  phone is untouched, and every wider form factor still draws a full-length
  callsign *and* its number in TEAMS. `tests/net/lobby-ping-fit.test.ts` records
  the new boundary (it was written to fail loudly on exactly this change, and did).
  **Director's call if the number should be bought back**: dropping the `· `
  separator, or the `ms` unit, on a row this narrow returns 16–24 px, which is
  enough — but that is a change to a merged feature's presentation, so this lane
  left it alone rather than redesigning it in a teams brief.
- **Abundance is still not threaded offline.** It rides the same `MatchConfig`
  seam and is the other half of Task C4: a player who picks RICH in a solo lobby
  still gets the SCARCE default. Out of this brief's scope, so it is left where it
  was — but it is now the *only* thing left on that seam.
- **`MatchStartMessage` carries no `mapId` or `abundance`.** An online room builds
  the sim default arena; the lobby's arena pick is offline-only. Pre-existing, and
  noted in `src/ui/lobby-flow.ts` where the map tap is folded.
