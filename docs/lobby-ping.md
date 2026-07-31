# The ping, shown to the person whose connection it is

**Owner:** Netcode Engineer. **Status:** shipped (M10, `agent/netcode/m10-lobby-ping`).
**Ratified by the developer:**

> 1. The server measures per-socket RTT already (telemetry era) — publish it per seat
>    in `lobbyState` (rounded ms, updated ~2 s cadence). Bots show no ping (they're
>    inside the sim, showing 0 ms would be a lie worth avoiding).
> 2. Lobby renders it next to each HUMAN player's name: "reivi · 245 ms",
>    colour-graded (green <100, amber <200, red above). Both form factors.
> 3. In-match too, minimal: the player's OWN ping in a corner of the HUD (small,
>    mono, no box) — the session log already samples it; show the same number.

Companions: `docs/netcode-spike.md` (the day-0 wire measurements), `docs/netcode-audit.md`
(the M10 audit that found three shipped-but-invisible netcode features),
`docs/playtest-log.md` (the log this shares its number with).

---

## 1. The finding behind it

The round trip was never missing. `src/net/telemetry.ts` has measured it from a real
`input → ackSeq` loop since the reconcile-feel brief, and three consumers were already
built on it: the adaptive jitter buffer (`RemoteInterpolator.resize`), the prediction
lead budget (`Predictor.setLeadBudget`), and the order-ledger TTL. Every one of those
is an **instrument reading an instrument**. Not one of them put the number in front of
the player, which is the same shape of miss the M10 audit found in the smoothing work:
built, correct, shipped, and never reaching the screen.

## 2. What the wire carries

`LobbySlot.rtt?: number` — rounded milliseconds, on the lobby broadcast only.

It costs the streamed snapshot **zero bytes**, which is the rule this repo keeps for
anything that is not per-tick truth (spike §S2, Trap 7). The roster is a
low-frequency, text message that is already re-sent on every lobby change; ping rides
it, and is re-sent on a cadence:

| Rule | Value | Why |
|---|---|---|
| Sweep interval | `LOBBY_PING_INTERVAL_MS` = 2 000 ms | The ratified cadence, matched to the probe below so a broadcast never carries a sample older than one probe. |
| Sent when | a rounded number **moved** | A still lobby sends nothing at all; the change detection is the same discipline `Slot.wallet` uses for the economy channel. |
| Phase | lobby only | Once the match is live nobody is reading a roster, and the client's own ping comes from its own telemetry. |

**Absent, never zero.** A seat with no measurement carries no field. The failure this
forbids is the flattering one: `0 ms` on an unprobed seat reads as the best connection
in the room.

## 3. The measurement

`server/ws.ts` `RttProbe` — a sequenced RFC 6455 ping/pong, deliberately **separate
from the 20 s keepalive**, because the two ask different questions on different clocks:
"is this socket alive?" and "what number do I put next to this player's name?"

- **Sequenced** (4-byte BE payload; RFC 6455 §5.5.3 makes the pong echo it verbatim).
  A late pong timed against a fresh ping would report a round trip nobody made —
  flattering exactly the connection that is failing.
- **Abandoned after `RTT_STALE_AFTER_MS`** (3 probes) so one lost pong cannot wedge the
  measurement forever; the late answer is then a stale sequence and is dropped.
- **Goes stale.** A socket that has not answered for that long reports `null`, not the
  last good number it ever had. A stale ping on screen is worse than a blank.
- **Never hangs up.** Liveness is the keepalive's job. A player on a bad link loses
  their *number*, never their seat.

Cost: a 2-byte ping out and a 6-byte masked pong back, twice a second — about 4 B/s per
socket against a snapshot stream of ~15 KB/s.

## 4. The model both surfaces share

`src/net/ping.ts` is dependency-free — no palette, no Pixi, no DOM — so the lobby row,
the in-match stamp and the server all agree on what "amber" means.

```
gradePing:  < 100 ms  good  ·  < 200 ms  fair  ·  ≥ 200 ms  poor
```

Thresholds land in the **worse** band (exactly 100 ms is already amber), so a number a
player reads as "one hundred" is never shown in the band below it. The model returns a
*word*; the two views map it onto the Cold Vacuum palette (`PING_GRADE_COLORS` in
`./ping-badge`): patina, signal yellow, threat red. No seventh hue (style-guide §1).

**A bot has no ping** — the rule lives in `seatPing`, so no view can forget it, and it
holds even if a wire slot arrives carrying a number for a bot seat.

## 5. Where it is drawn

| Surface | Where | Fed by |
|---|---|---|
| Lobby roster row | beside the name, `· 245ms`, graded (`src/ui/lobby-view`) | `LobbySlot.rtt` → `applyLobbySlots` → `LobbySeat.rtt` → `LobbySeatView.ping` |
| In-match corner | one mono line above the build stamp, bottom-left (`src/net/ping-badge`) | `NetTelemetry.hudRttMs` |

The in-match number is **the same one the session log prints**: `hudRttMs` is the last
finalized second's mean RTT — the `rtt` column of a pasted log — not the sub-second
live reading, which is equally true and flickers by tens of milliseconds every frame.
The live value is used only before the first second rolls over, so a fresh match shows
a number within a frame or two instead of a blank corner.

It draws nothing offline (no wire to time), nothing under `?freeze=1` (a golden
screenshot cannot contain a number that changes with the weather), and nothing once the
socket closes.

A long player name that would push the number under the roster's trailing chips drops
the number instead: a roster that overlaps itself is worse than one row without a ping.

### The row's width, and the one place it runs out

"Both form factors" is a claim about the **221px roster row on a phone in landscape**
(the lobby lays the eight seats out as two columns of four there), not about the 693px
one on the desktop. The number is kept only if it fits *whole* in the space before the
row's trailing furniture — `pingFits` in `src/net/ping.ts`, measured against the chips
the row **actually draws**:

| Row | Content edge | Full-length (12-char) callsign keeps its ping? |
|---|---|---|
| Human, FFA | the row's right edge — a human seat has no trailing chip at all (the tier chip is a bot control) | yes, every form factor |
| Human, TEAMS | the side chip, 90px in | yes, except the landscape phone |
| Landscape phone, TEAMS | 90px in on a 221px row | only up to ~8 characters |

This was measured, not assumed. An earlier revision reserved a flat **120px** at the
row's right edge; the chips reserve at most 90, and a human FFA seat reserves none — so
on the phone that over-reservation was wider than the space a full-length callsign left,
and an ordinary name silently cost the player their ping on the form factor most likely
to need one. Reserving space for furniture that never appears on a ping-bearing row is
the bug; `pingFits` against the real content edge is the fix.

The remaining gap is genuine width, not arithmetic: a landscape phone in TEAMS has
~108px for a name and a number, and a near-maximum callsign spends it. That boundary is
asserted in `tests/net/lobby-ping-fit.test.ts` rather than left to be discovered, so
widening the row would fail the test loudly instead of drifting. **Director:** if the
phone's TEAMS row should keep the number at any name length, the call is a design one —
right-aligning the ping into the dead space beside the side chip, or shortening the name
on that row — and neither is a change this lane makes unilaterally.

## 6. What is tested

| Claim | Test |
|---|---|
| The bands, the rounding, and "no measurement draws nothing" | `src/net/ping.test.ts` |
| A bot never gets a number, from either direction | `src/net/ping.test.ts`, `tests/net/lobby-ping-model.test.ts` |
| A late/lost/stale pong measures nothing | `tests/server/ws.test.ts` |
| `lobbyState` carries rtt per human seat, rounded; cadence; silence when still; live-match silence; a socket that cannot measure | `tests/server/lobby-ping.test.ts` |
| The wire → row path, including a seat that changes hands to a bot | `tests/net/lobby-ping-model.test.ts` |
| The corner stacks clear of the build stamp and the controls strip | `src/net/ping-badge.test.ts` |
| The number fits its row on both form factors, in both modes — and is dropped, never overlapped, where it cannot | `tests/net/lobby-ping-fit.test.ts` |
| The HUD number is the log's number | `src/net/telemetry.test.ts` |
