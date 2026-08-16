/**
 * src/sim/ore-ledger.ts — the economy's conscience. OWNER: Gameplay Engineer.
 *
 * Every unit of ore that moves in a match is recorded here, so a match-wide
 * invariant can prove the economy conserves EXACTLY. This is the class-killer for
 * the loot-regression pattern (p2c): three times a dead player's ore has stopped
 * counting, and three times unit tests stayed green because the leak was on a
 * play path they never took. A per-flow ledger asserted every tick of a full
 * natural match catches ANY future black hole, whatever path it hides on
 * (`tests/harness/ore-conservation.test.ts`).
 *
 * IT HAS SINCE PAID OFF THE OTHER WAY (a0-08, 2026-08-08). The report came a
 * fourth time — "sometimes picked up ore from dead ships dont count" — and this
 * ledger answered it in an afternoon: conservation HELD, exactly, through every
 * reproduction, so nothing was leaking and no rule needed touching. What varied
 * was only how much of a wreck a hold could accept (empty takes all, full takes
 * NOTHING and pulls nothing, one slot takes one), and none of it was visible.
 * The fix was a pair of render tells, not a sim rule (`Ship.lootTake` /
 * `lootBlocked`, GDD §2.3). Read the ledger BEFORE changing the economy: proving
 * there is no black hole is as valuable as finding one, and it points the search
 * at what the player could actually see.
 *
 * Determinism (GDD §4.8): pure running sums over operations the sim already does,
 * no RNG, no clock. The ledger is *write-only accounting* — the sim never reads
 * it to make a decision, so a world with a ledger and a world without one step
 * identically. `hashState` (harness) enumerates the fields it fingerprints and
 * does not include the ledger, so accounting can never perturb a determinism hash.
 *
 * The field is OPTIONAL on `World`: the shipped `createWorld` always attaches one,
 * but the hand-built worlds other lanes construct (net snapshots, bot fixtures,
 * `@platform/freeze`) omit it, and {@link ledgerAdd} no-ops when it is absent — so
 * the accounting never breaks a foreign world nor a test literal.
 */
import type { World } from './state';

/**
 * Cumulative ore accounting for one match. Sources add ore to the live economy,
 * sinks remove it, and the transfers move it between live buckets without changing
 * the total. Conservation (see {@link expectedLiveOre}): at every tick,
 *   liveOre === seeded + injected + debrisFloor − spent − deathLoss − capLoss − dust.
 */
export interface OreLedger {
  // --- Sources: ore entering the live economy ---
  /** Live ore present the instant the world finished building: the opening rock,
   *  wave 1's commons, every ship's starting bank, and any derelict debris. The
   *  t0 baseline, captured once in `createWorld`. */
  seeded: number;
  /** Rock delivered by a wave AFTER world-build (`spawnWave` during a `step`). */
  injected: number;
  /** The wreck-debris floor (`WRECK.baseDebrisOre`) minted when a core dies during
   *  the match — ore conjured from nothing to guarantee a wreck is worth looting. */
  debrisFloor: number;

  // --- Transfers: ore moving between live buckets (conserve liveOre) ---
  /** Rock chipped into mined chunks (asteroid ore → chunk). */
  mined: number;
  /** Ore burst into chunks by a death drop or a wreck (hold/bank → chunk). */
  dropped: number;
  /** Chunk ore tractored into a hold (chunk → cargo) — the LOOT step the developer
   *  keeps losing. */
  looted: number;
  /** Hold ore moved to the safe bank (cargo → banked), by the atmosphere drain or
   *  a dock-bank order. */
  deposited: number;

  // --- Sinks: ore leaving the live economy for good ---
  /** Ore paid for upgrades, buildings and repairs (`spendOre`). */
  spent: number;
  /** The share of a hold destroyed rather than dropped when a ship dies
   *  (`killShip`: `1 − DEATH_ORE_DROP_FRACTION` of the hold, plus — since a0-58 —
   *  the sub-chunk remainder the drop could not mint as whole `CHUNK.ore` pieces).
   *
   *  **Normally 0 since a0-59** (2026-08-16): the developer withdrew the half-burn
   *  and a destroyed ship now drops its entire hold, so `1 − 1 = 0` and a whole
   *  hold leaves no remainder. The bucket is deliberately NOT retired. It is the
   *  named sink for anything a drop cannot lay down, both terms above are driven
   *  off TUNABLE constants, and a ledger with no sink for a flow cannot conserve
   *  the day that flow returns — a zero term costs nothing, an absent one costs
   *  the invariant. */
  deathLoss: number;
  /** Banked ore a wreck could not lay down as debris, lost with the station
   *  (`scatterWreckDebris`): the excess beyond `WRECK.maxDebrisChunks`, and — since
   *  a0-58 — the sub-chunk remainder below one whole `CHUNK.ore` piece. */
  capLoss: number;
  /** Ore too fine to become a chunk, destroyed where it was mined (a0-58): the
   *  sub-`CHUNK.ore` tail left in an asteroid's `mineBuffer` when the rock runs
   *  out. Rock ore is scaled to hit an exact field yield, so a rock rarely holds a
   *  whole number of ore and its last scrap cannot be minted as a whole chunk —
   *  and a fractional chunk is ore a hold can hold but no readout can show
   *  (`chipAsteroid`). Recorded rather than silently dropped, so the residual
   *  below stays exactly zero. */
  dust: number;
}

/** A fresh, all-zero ledger. */
export function makeLedger(): OreLedger {
  return {
    seeded: 0,
    injected: 0,
    debrisFloor: 0,
    mined: 0,
    dropped: 0,
    looted: 0,
    deposited: 0,
    spent: 0,
    deathLoss: 0,
    capLoss: 0,
    dust: 0,
  };
}

/**
 * Add `amount` to one ledger bucket, if this world keeps a ledger. Every ore
 * mutation in the sim funnels its delta through here; worlds without a ledger
 * (foreign lanes, test fixtures) silently skip the accounting. Never let `amount`
 * be negative for a monotonic bucket — these are cumulative totals, not balances.
 */
export function ledgerAdd(world: World, bucket: keyof OreLedger, amount: number): void {
  const l = world.ledger;
  if (l) l[bucket] += amount;
}

/**
 * Ore currently live in the economy — the quantity the ledger must conserve:
 *  - unmined rock, INCLUDING the fractional `mineBuffer` that has left `ore` but
 *    not yet formed a whole chunk (invisible to a naive rock+chunk sum, so a
 *    tick sampled mid-mine would look short without it);
 *  - loose chunks that are real ore — NOT deposit couriers, whose ore already
 *    reached the bank (counting them would double the amount in flight);
 *  - every ship's hold and bank.
 */
export function liveOre(world: World): number {
  let ore = 0;
  for (const a of world.asteroids) ore += a.ore + a.mineBuffer;
  for (const c of world.chunks) if (!c.deposit) ore += c.amount;
  for (const s of world.ships) ore += s.cargo + s.banked;
  return ore;
}

/** Sources minus sinks: what {@link liveOre} MUST equal at every tick if no ore
 *  has leaked off the ledger. */
export function expectedLiveOre(world: World): number {
  const l = world.ledger ?? makeLedger();
  return l.seeded + l.injected + l.debrisFloor - l.spent - l.deathLoss - l.capLoss - l.dust;
}

/** The conservation residual — 0 (within float tolerance) iff the economy
 *  balances. A nonzero value is an ore black hole (ore vanished) or a leak the
 *  other way (ore minted off the books): the loot-regression alarm. */
export function oreResidual(world: World): number {
  return liveOre(world) - expectedLiveOre(world);
}
