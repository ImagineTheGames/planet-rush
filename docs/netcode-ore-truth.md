# Ore Truth — the FULL-hold blip, and the "stolen ore" report

**Owner:** Netcode Engineer · **GDD:** §2.3, §4.2 · **Source:** developer playtest,
phone, gru, room SNA4 · **Status:** one bug found and fixed, one report answered

Two ore findings came out of one session. They are not the same fault, but they
have the same author: a client that was allowed to invent ore.

Everything below is reproducible:

```
npx vitest run src/net/ore-authority   # both halves: the wire blip, and the theft ledger
```

---

## 1. BUG — the hold that read FULL

> *"Picked up ore, HUD briefly showed hold FULL, then corrected to the real amount."*

### Measured

One 1-ore chunk, one 2-slot hold, a 150 ms wire, nothing else in the world. The
client's `Ship.cargo` — the number `src/ui/hud.ts` draws — frame by frame:

```
frame  client tick  server tick   client hold   server hold   chunks (client / server)
  12       17           12           0.000         0.000            1 / 1
  13       18           13           1.000         0.000            1 / 1     ← replay loots it
  15       20           15           2.000         0.000            1 / 1     ← FULL. 1 ore, 2.000 held
  22       27           22           2.000         1.000            1 / 0     ← authority collects
  40       45           40           2.000         1.000            1 / 0     ← pinned at the cap
```

The chunk count is the tell: the client's field never loses the chunk it has
already been paid for. One ore in the world, two in the hold, and it stays that
way.

### Why

`PredictedMatch.reconcile` rewinds, overwrites with authority, and replays the
unacknowledged ticks. A rewind restores the world's *scalars* — tick, time, RNG,
entity counter — and `world.chunks` is not among them. The M10 ore-flight fix
made that deliberate: `thawClocks` puts the chunk field back **exactly as the
replay found it**, because a courier's flight is a presentation the player
watched at one frame per predicted tick, and letting the replay fly it again is
what made *"ore goes super fast to base online."*

So the replay tractors a chunk into the hold, and then the chunk is handed back
to the field. The ore it paid is not handed back. At 30 Hz snapshots and 150 ms
that is five re-loots per snapshot, each one clamped by `cargoCap` — which is
why it reads as exactly FULL rather than as a runaway number.

And nothing corrects it. `server/room.ts` `syncEconomy` is change-detected: a
wallet that has not moved sends nothing. Authority's statement arrives only when
authority's *own* hold moves, so between real pickups the invented ore has the
screen to itself.

### The rule now

The hold and the chunk field are one accounting system, so the reconcile treats
them as one: **the replay's wallet work is discarded exactly as its chunk work
is.** That is sound for the reason `settleShots` already gives — every tick a
replay re-runs was predicted once already, and its earnings are in the hold
already.

What is left is one writer per source (`src/net/prediction.ts`
`settleWallet` / `holdInflow`):

| flow | owner | why |
| --- | --- | --- |
| ore **into** the hold (tractor) | **authority** | the chunk field is frozen out of the replay, so it runs on authority's clock anyway — the two sides collect the same chunk at very nearly the same moment. Predicting it wins the player almost nothing and pays twice: collect a tick early and authority's statement double-counts it; collect a tick late and the client adds a unit authority already counted, with no statement coming to fix it. |
| ore **out of** the hold (the atmosphere drain, an order's price) | **the player** | both run a lead ahead of the tick being stated — their thrusters put them in the atmosphere, their thumb pressed BUILD. A hold that waited a round trip to fall would take the banking beat and the build wheel with it. |
| the bank | **the player**, re-anchored | every direction of it is drain or spend, both of which lead. |
| upgrade tiers | **authority**, outright | there is no "since then" on a number bought once. |

Authority's statement is applied as `held − what has left the hold since that
tick`, measured against a trail of the player's own predicted ticks. A client
that agrees with authority therefore moves by exactly nothing, which is the same
property `holdHull` gives the health bar: nothing to blend, because nothing is
racing.

The cost, stated plainly: for one one-way trip (~75 ms at this wire) the chunk
has visibly gone into the ship and the number has not moved yet. That is the
same trade the hull already makes, and it is paid in the honest direction — the
client is briefly behind, never ahead.

A transport that never states a wallet is left exactly as it was: offline and
loopback, prediction *is* authority, and the hold is the client's alone.

---

## 2. INVESTIGATE — "an enemy stole my ore from my live ship"

> GDD §2.3 has no live-ship ore theft: ore drops on death, loose chunks are
> anyone's. The question was which of two things actually happened.

**Verdict: (a), plus the bug above making it look worse than it was. There is no
(b) — no wire or sim path debits a live hold.**

### The sim cannot do it

`src/sim/ore-ledger.ts` records every ore movement in the game as a running sum,
and `oreResidual` proves the books balance each tick. Against it:

- **Every write to `Ship.cargo` in the simulation**, exhaustively: the tractor
  collecting a loose chunk (`step.ts` `updateChunks`); the atmosphere drain into
  the ship's own bank (`updateDeposits`); the dock-BANK order, same thing all at
  once (`buildings.ts` `placeOrder`); an order's price (`spendOre`, hold first
  then bank); death (`damage.ts` `killShip`); respawn (`step.ts`); and the clamp
  to `cargoCap` when tiers change (`upgrades.ts` `refreshDerivedStats`). Four of
  those are the player's own doing, two are dying, one is arithmetic. **No path
  moves ore from one live ship to another** — there is nothing to disable,
  because there is nothing there.
- An enemy parked hull-to-hull on a loaded ship for four seconds takes nothing:
  `looted`, `deposited` and `spent` all stay at zero, and the hold reads 2 on
  every one of 240 ticks.
- On death, the hold bursts as debris **into the field**, not to the killer, who
  is handed exactly nothing. Whoever reaches it first gets it, like any loose
  chunk. *(Amended 2026-08-16, a0-59 — this read "half the hold" when written;
  `DEATH_ORE_DROP_FRACTION` is now 1, so the whole hold reaches the field. The
  finding is unaffected: the point is that the drop goes to the FIELD and not to
  the killer, and that is unchanged. It does mean twice as much ore is in the
  contested-pickup case this document describes.)*

### What it looked like instead

A loose chunk between two ships goes to **whichever ship is nearer to it, with
room in its hold** — the tractor picks the nearest eligible ship every tick
(`updateChunks`). Ore the player had just chipped off a rock, floating a moment
before it reached them, is legally the enemy's if the enemy is closer. In the
ledger that is a `looted` line against the rival with the player's own hold
untouched, which is precisely how it can be told apart from a debit.

Add the bug in part 1 — a hold reading FULL that then dropped to its real value
the moment authority spoke — and the pilot's seat gets: *ore I could see was
mine, gone, with an enemy on screen.* Both halves are now closed: the hold no
longer inflates, and the ore that visibly reaches the ship is the ore the count
goes up by.

### Back to the developer — one presentation question

Contested chunks are working as designed, but they read as theft, and that is
worth a decision rather than a shrug. The tractor pulls a chunk toward the
nearest eligible ship for a while *before* it arrives, so a player watches ore
drift toward them and then hook away to a rival who was a few units closer. The
rule is fine; the tell is missing. That is a call for the developer and the
render/UI lanes, not a netcode change — flagging it, not fixing it.
