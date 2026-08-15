# a0-52 — "i had 2 ore and was able to build a turret"

Reported 2026-08-15, build `c48a893`. `TURRET.cost` is 3.

**The finding: no underpay exists in the simulation. The report is a legibility
bug — two different numbers on screen are both captioned `ORE`.**

## What is here

- `probe.mjs` — three runs against the real sim, printing the new ore journal
  (`src/sim/ore-journal`) line by line. `npx vite-node evidence/a0-52-ore-underpay/probe.mjs`
- `probe-output.txt` — its output on this branch, so a reader can check the claim
  without running anything.

## How the sim was cleared

`spendOre` refuses anything it cannot pay for, and the tests added by this brief
drive every priced wedge to exactly `cost - 1` in each of the three ways a wallet
can hold it, then run 1200 ticks of a four-seat match with every wallet swept to
a hair under a turret every 40 ticks. Nothing is ever sold short
(`src/sim/buildings.test.ts` — *never leaves a negative balance*).

That was not enough on its own, and this is the load-bearing part: **`spendOre`
clamps a negative balance to zero two lines after it spends.** A player who
underpaid and a player who spent their last ore therefore land on the *same*
number — exactly `0`, which is what the screenshot after the build shows. So the
balance is now read **before** that clamp, and a negative one is written to the
journal as an `overdraft` line with the raw number in it. Empty on every path
above. Had a0-52 been real, that line is what the log would carry.

## Which reading the evidence supports

The brief's innocent explanation is that `2 → 4` on the CARGO wedge is the hold
CAPACITY, not a balance — run **A** in the probe, which ends on `0 ORE` and
`1 / 4 BUILT` exactly as the screenshot does.

But the arithmetic of the two screenshots does not close on it by itself: the
Upgrade wheel's hub reads `4`, and `4 − 2` is 2, which does not buy a 3-ore
turret. Ore arrived between the two shots. That points at the reading that
explains the literal *"2"* and needs no misread stat at all — run **B**:

> The top-left `ORE` readout is the **bank alone** (GDD §2.2, flagged in a0-03:
> *"the Build wheel's hub prints hold + bank under a caption that also reads
> `ORE`, so the two can differ on screen at once"*). A player with 1 in the hold
> and 2 in the bank is looking at a `2`, holding a spendable `3`. And mined ore
> lands in the **hold** — so the number they are watching does not move while
> they earn the ore that pays for the turret.

Both readings are the same defect wearing different clothes: a number the player
reads as their ore is not their ore. **Flagged for the developer; which one to
change is the UI's call, not this lane's.**

## The other thing this turned up

A build the server **refused** rolled the ghost turret back and kept the ore. No
correction was coming — a refused order does not move the server's wallet, and
the server stays quiet about a wallet that has not moved. The player went on
holding less than they had, on a wheel that then refused purchases they could
afford. Opposite sign to the report, which is why nobody ever filed it: nobody
reports ore they never noticed was missing. Fixed on this branch, and proved by
`src/net/prediction.test.ts` — *refused build*.
