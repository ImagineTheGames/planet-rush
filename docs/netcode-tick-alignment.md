# The constant correction — where it came from, and what is left

**Owner:** Netcode Engineer. **Status:** shipped (M10, `agent/netcode/m10-tick-alignment`).
**Ordered by the developer**, from a live playtest log (build `3d7cc6a`, ~250 ms
RTT, desktop; identical feel on mobile):

> corr 0.3–0.6 u with corrMax ~1.0–1.2 nearly **every** sampled second in flight;
> mispred 3–13 %; lead 12–19 ticks tracking RTT; snap 0, resync 0.
>
> *"A CONSTANT small correction is systematic, not stochastic. Prime suspect:
> input-tick misalignment — the client predicts an input at its lead tick, the
> server applies it at a different tick (arrival), so every prediction drifts by
> the difference and reconciliation pays it back every snapshot."*

The brief's reasoning is right, and the brief's suspect is half right. This
document is what the instrument said, in the order it said it.

Companions: `docs/netcode-audit.md` (the M10 audit this follows), `docs/netcode-spike.md`
(the day-0 wire measurements), `docs/playtest-log.md` (how a session is handed back).
Permanent acceptance runs: `tests/net/latency-feel.test.ts`.

---

## 1. The instrument, before any fix

Nothing in the system could see the suspected fault. A client knows the tick it
*predicted* an input at; the server knows the tick it *ran* it at; neither knows
the other's number, and the difference between them is exactly the quantity in
question. So the ack now carries both halves:

| Piece | Where |
|---|---|
| `SnapshotMessage.ackTick` — the sim tick `ackSeq` was simulated at | `src/net/transport.ts`, `src/net/wire.ts` (4 B on the snapshot frame header, `WIRE_VERSION` 2) |
| `slot.ackTick`, written from the tick actually being run | `server/room.ts` `inputsFor` |
| `ReconcileReport.appliedDelta` = `ackTick − predictedTick(ackSeq)` | `src/net/prediction.ts` |
| `appliedDeltaMean / Max / Samples`, per second | `src/net/telemetry.ts` |
| `align` / `alignMax` / `alignN` in a pasted log | `src/net/playtest-log-attach.ts` |

An ack that cannot be compared reports **null, never 0** — "aligned" and "not
measured" are different findings, and averaging them together would hide the exact
second a stall happened.

**Its first verdict, on the developer's condition:** once the client's lead covers
the wire, **every input runs at exactly the tick it was predicted for** — `align
0.00/0t`, on a clean wire, all match (`src/net/prediction.test.ts`, "reads zero
while the server is running each input at the tick it was predicted for"). Input-tick
misalignment was not what the developer was feeling. Something else was.

## 2. What it was: the wire's own precision

Reproduced the developer's capture in the latency harness on a **zero-latency,
zero-loss** wire, with alignment measured at a flat zero:

```
  0 ms, clean — 0 retransmit stalls injected
    client 0: corr 0.51/1.26u  mispred 2%  snaps 0  lead 2/2t   (580 recon)
```

Half a unit of correction on every snapshot with *no wire in the way at all*. That
is not a disagreement about physics — it is the wire telling the client something
slightly untrue, thirty times a second, and reconciliation dutifully steering to it.

Positions and velocities streamed as **whole world units**. A client whose physics
were perfect still landed up to half a unit from the number authority sent: in two
axes, a mean of 0.38 u and a worst case of 0.71 u, with velocity rounding (a whole
unit per second, replayed across a round trip's worth of ticks) supplying the rest.
The developer's capture, almost exactly.

The same two bytes now carry **eighths of a unit** (`POS_SCALE`, `src/net/snapshot.ts`).
Zero extra bandwidth; the fixed-point step lives entirely between encode and decode,
so no consumer changed. Eight and not sixteen because range is what precision costs:
an `i16` at 8 reaches 4095.9 u against the widest shipping arena's 3200 (28 %
headroom), where 16 would put the ceiling *inside* the oval map and clamp a ship to
the wall. `snapshot.test.ts` pins that relationship against `MAPS`, so a wider map
fails the build instead of teleporting a ship.

## 3. And then alignment *was* the fault — on a lossy wire

With the floor fixed, the instrument attributed what remained: on a 2 % loss wire
the residual correction tracked `appliedDelta` (align **3.4 ticks mean, 21 peak** at
250 ms). Three faults, all in how authority files what the wire brings it.

**a) A retransmit burst collapsed to one message.** A TCP stall delivers thirty or
forty inputs at once, all naming ticks already simulated, all re-filed onto the same
`simTick + 1` — where `InputQueue`'s first-wins rule queued the oldest and refused
the rest as duplicates. Measured over one 20-second run at 250 ms / 2 % loss:

```
verdicts: late 650, queued 603, duplicate 582        (of ~1200 messages)
```

**48 % of everything the player pressed, discarded** — and the message that survived
was the *oldest* of the backlog, so the ship was steered by the stalest stick in it.
A collision now **merges** (`InputQueue.coalesce`): the newest stick reading wins (a
stick is a *state*), and every one-shot order in the burst survives (an order is an
*event*, and a dropped one is a purchase that silently did nothing).

**b) A tick with nothing filed ran with a neutral intent.** `step()` gives a ship
with no input row no thrust, no aim and no trigger — right for an empty seat, wrong
for a human whose 16 ms of input is merely in the air. The authoritative ship
stopped accelerating on every tick the wire lost while the predicting client, which
knew perfectly well what was pressed, kept flying. A human seat now holds its last
stick for up to `INTENT_HOLD_TICKS` (15, ~250 ms) with orders stripped, and coasts
after that — a ship must not fly on a dead player's last press (GDD §4.2 gives that
seat to a bot).

**c) The client was lying about its own clock.** `sendInput` stamped strictly
*increasing* ticks, because the predicted clock is not monotonic (a lead trim rewinds
it) and a re-used tick number used to be dropped as a duplicate — ~4 % of all input
on a real socket. That cure had its own disease, invisible until `ackTick` existed to
name it: the tick on the wire then differed from the tick the client predicted at, so
authority ran the press where the client's replay never put it. **Up to 15 ticks of
misalignment on a loss-free wire.** Merging makes the monotonic hack unnecessary, so
the client stamps the truth again.

## 4. Before and after

Latency harness, 20-second two-client match, same seed, same wire
(`npx vitest run tests/net/latency-feel.test.ts`):

| Wire | Before | After |
|---|---|---|
| 0 ms, clean | corr **0.51/1.26 u**, mispred 2 % | corr **0.07/0.16 u**, mispred 0 %, align 0.00/0t |
| 150 ms ±30 ms, 2 % loss | corr **0.61/1.98 u**, mispred 11 % | corr **0.18/0.96 u**, mispred 0 %, align 0.23/13t |
| 250 ms ±30 ms, 2 % loss | corr **0.71/1.76 u**, mispred 21 % | corr **0.42/1.12 u**, mispred 1 %, align 0.56/15t |

And the gate the brief asks for — **steady-state straight-line flight at 250 ms**,
±30 ms jitter, no loss, which is the developer's own reported condition:

```
  250 ms ±30 ms, no loss — straight-line flight — 0 retransmit stalls injected
    client 0: corr 0.06/0.14u  mispred 0%  snaps 0  lead 17/19t  align 0.05/2t  (269 recon)
    client 1: corr 0.06/0.15u  mispred 0%  snaps 0  lead 17/20t  align 0.04/2t  (270 recon)
```

Against the report's **0.3–0.6 u with corrMax 1.0–1.2**: an eighth of the mean, a
tenth of the peak, and no mispredictions at all. 0.06 u is the wire's new
quantization floor — it is what "prediction is right" looks like when the only
remaining error is the last bit of the number.

## 5. The named thresholds this adds

Exported constants in `tests/net/latency-feel.test.ts`, each with the paragraph that
justifies it, so moving one is a visible diff on a named number.

| Threshold | Value | What it means |
|---|---|---|
| `STEADY_CORRECTION_UNITS` | 0.15 u | Mean correction in steady straight-line flight. "~0" is the wire's own precision (~0.05 u) with room for a jitter draw. A regression to whole-unit streaming lands 3× over it. |
| `STEADY_PEAK_CORRECTION_UNITS` | 0.25 u | Not one reconcile in five seconds of flight may reach a quarter of a unit — the report's `corrMax 1.0–1.2` line, answered. |
| `STEADY_ALIGNMENT_TICKS` | 0.5 t | Mean input-tick misalignment in steady flight. The run reports 0.05. |
| `STEADY_PEAK_ALIGNMENT_TICKS` | 2 t | A tick or two is a jitter draw; more is authority filing input where the client never predicted it. |
| `POS_SCALE` | 8 (⅛ u) | `src/net/snapshot.ts` — the wire's precision, and the floor under every prediction error there is. |
| `MAX_WIRE_COORD` | 4095.9 u | The range that precision costs, pinned against the map catalogue. |
| `INTENT_HOLD_TICKS` | 15 (~250 ms) | `server/room.ts` — how long a seat's last stick stands in for the ticks the wire loses. |
| `JOURNAL_CAPACITY` | 200 | `src/net/action-journal.ts` — the action-event ring behind a pasted log. |

The gate also asserts `result.droppedInputs === 0`: authority may re-file a late
message, and may merge a collision, but it may not throw a press away.

## 6. What a pasted log says now

Two additions to `docs/playtest-log.md`'s format, both aimed at the next report.

Per-second, on the existing `net sample` line: **`align` / `alignMax` / `alignN`**.
A log showing `align 0` says the two clocks agree and any correction beside it is
not a misalignment; a log showing `align 6/31` says the presses are landing late and
everything predicted on them is standing at the wrong instant.

Per event, new (`src/net/action-journal.ts`): the echo machinery in discrete lines,
because a player reporting *"I tapped twice and got three turrets"* or *"my shot
didn't come out"* is describing an event, and an average of thirty reconciles is the
wrong instrument for one.

```
volley  tick=1180 inFlight=2
order   tick=1181 id=524292 verb=buildOrder what=turret
echo    tick=1200 id=524292 outcome=adopt waited=19
expiry  tick=1290 id=524293 what=shield waited=90
```

`adopt` is the happy path; `refused` and `unknown` are the two mismatches; `expiry`
is a prediction authority never answered at all — one is a lost message, a run of
them is a wire that is not carrying orders.

## 7. What is left, honestly

**A stall longer than the client's lead cannot be aligned.** At 2 % loss the harness
injects retransmits worth ~750 ms; input held that long *is* old when it arrives, and
authority's only choices are to run it late (misaligned) or discard it (a limp ship).
It now runs it late, merged, with the stick held across the gap — which is why the
250 ms / 2 % run still reports `align 0.56/15t` and corr 0.42 u rather than the
0.06 u of a loss-free wire. Closing that would mean raising the lead budget to cover
the worst stall, i.e. paying ~750 ms of input latency on every press for the sake of
the occasional one — the ratchet the M10 audit removed on purpose. The right trade is
the one that is there: **be exact when the wire is clean, and degrade in a way that
is measured rather than silent.**

**The startup second is not steady state.** The first second of a match has a resync
or two while the client's clock arrives at a server already running, and shows `align
5–6/12t` while the lead climbs from nothing. The gate measures from the second second
on, deliberately and in writing.

**Whole-match verification is still the harness's.** These numbers come from a
virtual clock and a modelled wire (deterministic, seeded, TCP-shaped loss). The live
fleet's own confirmation is a playtest paste with the new `align` column in it —
which is the point of §6.
