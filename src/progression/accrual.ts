/**
 * src/progression/accrual.ts — what one match earned, observed. OWNER: UI
 * Engineer (brief `docs/briefs/pr-04-accrual-and-xp.md`; plan
 * `docs/progression-plan.md` §1.1, §1.3a–d, §5 Task PR-4).
 *
 * One finished match becomes one {@link MatchAccrual} per seat: the counts the
 * end-of-match summary shows, and the counts `./xp` prices. Nothing here decides
 * what a count is *worth* — that is `./xp`, deliberately a separate module so a
 * weight can be re-tuned (QA owns them from m10) without touching the arithmetic
 * that produced the counts.
 *
 * **Read-only over the world, and outside determinism.** This module never
 * writes a single field of `World`, and the simulation never reads it back — the
 * same discipline as `src/sim/ore-ledger.ts` and `src/sim/combat-credit.ts`
 * (GDD §4.8). It is not a sim module, it is a *spectator*: hand it the world each
 * tick and it keeps a tally beside the match.
 *
 * Two halves, and the split is the whole design:
 *
 *  - **The free half — world deltas.** Ore into the hold, ore banked, ore spent,
 *    distance flown, structures ordered, upgrade tiers bought, core HP patched,
 *    own deaths. The sim keeps no per-player counters (plan Trap 2), so these are
 *    *observed*, by diffing the world between two looks at it.
 *  - **The credited half — `world.credit`.** Damage dealt, ships destroyed,
 *    stations destroyed. These are **read off pr-02's ledger, never recomputed.**
 *    A spike once reconstructed them from projectile geometry at 60 Hz over a
 *    full world diff (`spikes/progression/measure-ratified-xp.ts`), and that is
 *    exactly what does not belong in the client: it was a measurement device with
 *    a stated residual, and the shipped answer is the sim telling us who did it.
 *
 * **The trap this file is written around: observe the AUTHORITATIVE world.**
 * Online, the client runs a predicted world ahead of the server's and rewinds it
 * when a snapshot disagrees (`src/net/`). A predicted tick that is later
 * corrected would double-count every positive delta in it. So:
 *
 *  1. The caller feeds this observer the **server's** world online, never the
 *     predicted one. That is a wiring rule this module cannot enforce, and pr-05
 *     owns the wiring.
 *  2. What this module *can* enforce, it does: {@link AccrualObserver.observe} is
 *     **idempotent for the newest tick and revisable for it**. A tick re-delivered
 *     unchanged adds nothing; a tick re-delivered with *different* content (the
 *     reconcile) has the previous window rolled back before the corrected one is
 *     applied, so every unit of ore is counted exactly once. A world older than
 *     that is ignored rather than silently rewound — one window of history is
 *     what an observer holding one snapshot can honestly undo.
 *
 * **The tier buckets, and their honest limit.** The three opponent-facing rows
 * are multiplied by the *opponent's* difficulty (plan §1.3b), so each unit of
 * damage has to know whose hull it landed on. pr-02's ledger totals damage by
 * **attacker** and carries no victim dimension — but it does carry
 * `lastDamageAt[victim][attacker]`, the per-pair clock, and `lastHitBy[victim]`,
 * the killing blow. So the pairing is *read out of the ledger*, not
 * reconstructed: an attacker's damage in a window is split across exactly the
 * victims the ledger says they hit in that window. Fed every tick — or every
 * authoritative snapshot — the common case is exact: one attacker, one victim,
 * one tier. The ambiguous case (one attacker landing damage on two victims inside
 * a single window) is apportioned by the victims' own observed HP loss, and the
 * fallbacks past that are named at `pairVictims` below. A victim-bucketed damage
 * row on the ledger itself would make this exact in every case; that is a
 * `src/sim/` change for the Gameplay lane to weigh, not one this lane may make.
 */

import type { PlayerId } from '@shared/types';
import { Difficulty } from '../bots';
import { REPAIR_HP_PER_ORE, stationOf, type MiningStation, type World } from '../sim';

// ---------------------------------------------------------------------------
// The shape
// ---------------------------------------------------------------------------

/** The order every `Record<Difficulty, number>` here is built and iterated in.
 *  Fixed, so no total can ever depend on key insertion order (brief test 6 —
 *  determinism, GDD §4.8). */
export const TIER_ORDER: readonly Difficulty[] = [Difficulty.Easy, Difficulty.Medium, Difficulty.Hard];

/** A fresh all-zero per-tier bucket. */
export const zeroByTier = (): Record<Difficulty, number> => ({
  [Difficulty.Easy]: 0,
  [Difficulty.Medium]: 0,
  [Difficulty.Hard]: 0,
});

/** Sum of a per-tier bucket, in {@link TIER_ORDER}. */
export const totalByTier = (r: Record<Difficulty, number>): number =>
  TIER_ORDER.reduce((sum, t) => sum + r[t], 0);

/**
 * One player's whole match, in counts. Every field is a *measurement* — what
 * happened — never a score; `./xp` turns this into XP and is the only place a
 * weight appears.
 */
export interface MatchAccrual {
  /** The seat this belongs to. */
  readonly slot: PlayerId;
  /** Seats in the lobby — the denominator the placement rungs are counted from
   *  (`slots − placement` players outlasted). Not in the brief's sketch; a
   *  placement row cannot be priced without it (plan §1.3d, "20 / rung"). */
  readonly slots: number;

  /** Σ positive Δ`ship.cargo` — ore that entered the hold, **mined AND
   *  scavenged**. GDD §2.7 is explicit that "ore is ore": the sim does not tag a
   *  chunk with where it came from, and paying scavenged ore less would make
   *  Vulture — the wreck scavenger — the worst-paid character in the game (plan
   *  §1.1). Deliberate; do not "fix" it. */
  oreMined: number;
  /** Σ positive Δ`ship.banked`. */
  oreBanked: number;
  /** Σ negative Δ(`cargo` + `banked`) **while the hull and the home both live** —
   *  a purchase. The half-hold sink at a ship death and the bank a dying station
   *  scatters as wreck debris are losses, not spending, and neither appears
   *  here. */
  oreUsed: number;
  /** Σ |Δ`ship.pos`|, with respawn teleports filtered. */
  distance: number;
  /** Own deaths + 1 — the hulls this match cost you. Never pays XP: paying for it
   *  rewards dying, and charging for it punishes the free-respawn design
   *  (GDD §2.7, plan §6.2). */
  shipsUsed: number;
  /** Distinct `BuildJob.id`s seen queued at your own station. */
  structures: number;
  /** Σ positive Δ Σ`ship.tiers` — upgrade tiers bought, across all four tracks. */
  upgrades: number;
  /** Σ positive Δ`station.coreHp` ÷ `REPAIR_HP_PER_ORE` — reactor patches.
   *  Fractional when a patch lands on a nearly-full core and the last few HP are
   *  clamped away. */
  repairs: number;
  /** `match.wavesSpawned` when your home died, or at the end if it survived. */
  wavesSurvived: number;
  /** 1 = winner … `slots` = first out. */
  placement: number;
  /** Whether this seat is on the winning side (team-aware). */
  won: boolean;
  /** Seconds this seat was *in* the match: their home's death time, or the whole
   *  match if it never died. */
  seconds: number;

  /** HP dealt to enemy ships and enemy station property, by the **victim's**
   *  difficulty tier (plan §1.3b). Read off `world.credit`, never recomputed. */
  damageDealt: Record<Difficulty, number>;
  /** Killing blows landed on enemy hulls, by the victim's tier. */
  shipKills: Record<Difficulty, number>;
  /** Killing blows landed on enemy cores, by the victim's tier. A core the Crush
   *  finished has no killer and credits nobody — measured at 100% of station
   *  deaths in an Easy bot lobby (plan §1.3c(2)). Zero is the honest answer
   *  there, and the summary renders it `—` rather than as a guess. */
  stationKills: Record<Difficulty, number>;
}

// ---------------------------------------------------------------------------
// The running tally — the half a window of observation can add to
// ---------------------------------------------------------------------------

/** Everything a window of observation accumulates. The rest of a
 *  {@link MatchAccrual} (placement, waves, seconds, won) is read off the finished
 *  world at `finalize`, so it keeps no running total and cannot drift. */
interface Tally {
  oreMined: number;
  oreBanked: number;
  oreUsed: number;
  distance: number;
  deaths: number;
  upgrades: number;
  repairs: number;
  damageDealt: Record<Difficulty, number>;
  shipKills: Record<Difficulty, number>;
  stationKills: Record<Difficulty, number>;
}

const blankTally = (): Tally => ({
  oreMined: 0,
  oreBanked: 0,
  oreUsed: 0,
  distance: 0,
  deaths: 0,
  upgrades: 0,
  repairs: 0,
  damageDealt: zeroByTier(),
  shipKills: zeroByTier(),
  stationKills: zeroByTier(),
});

/** `dst += src · sign`, field for field. The `-1` case is the rollback of a
 *  superseded window — see the reconcile path in `observe`. */
function addTally(dst: Tally, src: Tally, sign: 1 | -1): void {
  dst.oreMined += sign * src.oreMined;
  dst.oreBanked += sign * src.oreBanked;
  dst.oreUsed += sign * src.oreUsed;
  dst.distance += sign * src.distance;
  dst.deaths += sign * src.deaths;
  dst.upgrades += sign * src.upgrades;
  dst.repairs += sign * src.repairs;
  for (const t of TIER_ORDER) {
    dst.damageDealt[t] += sign * src.damageDealt[t];
    dst.shipKills[t] += sign * src.shipKills[t];
    dst.stationKills[t] += sign * src.stationKills[t];
  }
}

// ---------------------------------------------------------------------------
// Snapshots — the only state this observer keeps
// ---------------------------------------------------------------------------

/** Everything one look at the world must remember in order to diff the next one.
 *  Numbers only: no references into the world, so a world mutated in place —
 *  which is exactly what `step` does — can never corrupt the previous look. */
interface Snapshot {
  time: number;
  tick: number;
  cargo: number[];
  banked: number[];
  tierSum: number[];
  x: number[];
  y: number[];
  shipAlive: boolean[];
  hull: number[];
  coreHp: number[];
  /** core + shields + turrets + satellites — the "station property" HP pool the
   *  2× damage weight is paid on, and the filter that tells a hit on a home from
   *  a hit on a hull. */
  stationHp: number[];
  stationAlive: boolean[];
  wavesSpawned: number;
  dealtToShips: number[];
  dealtToStations: number[];
  shipKills: number[];
  stationKills: number[];
}

const sumHp = (xs: readonly { hp: number }[] | undefined): number =>
  (xs ?? []).reduce((sum, x) => sum + x.hp, 0);

const sumTiers = (tiers: Record<string, number>): number =>
  (Object.values(tiers) as number[]).reduce((a, b) => a + b, 0);

const stationProperty = (p: MiningStation | null): number =>
  p ? p.coreHp + sumHp(p.shields) + sumHp(p.turrets) + sumHp(p.satellites) : 0;

function snapshot(world: World, slots: number): Snapshot {
  const credit = world.credit;
  const zeros = (): number[] => new Array<number>(slots).fill(0);
  const snap: Snapshot = {
    time: world.time,
    tick: world.tick,
    cargo: zeros(),
    banked: zeros(),
    tierSum: zeros(),
    x: zeros(),
    y: zeros(),
    shipAlive: new Array<boolean>(slots).fill(false),
    hull: zeros(),
    coreHp: zeros(),
    stationHp: zeros(),
    stationAlive: new Array<boolean>(slots).fill(false),
    wavesSpawned: world.match.wavesSpawned,
    dealtToShips: zeros(),
    dealtToStations: zeros(),
    shipKills: zeros(),
    stationKills: zeros(),
  };
  for (const ship of world.ships) {
    const i = ship.id;
    if (i < 0 || i >= slots) continue;
    snap.cargo[i] = ship.cargo;
    snap.banked[i] = ship.banked;
    snap.tierSum[i] = sumTiers(ship.tiers);
    snap.x[i] = ship.pos.x;
    snap.y[i] = ship.pos.y;
    snap.shipAlive[i] = ship.alive;
    snap.hull[i] = ship.hull;
  }
  for (let i = 0; i < slots; i++) {
    const station = stationOf(world, i);
    snap.coreHp[i] = station?.coreHp ?? 0;
    snap.stationHp[i] = stationProperty(station);
    snap.stationAlive[i] = station?.alive ?? false;
    if (credit) {
      snap.dealtToShips[i] = credit.dealtToShips[i] ?? 0;
      snap.dealtToStations[i] = credit.dealtToStations[i] ?? 0;
      snap.shipKills[i] = credit.shipKills[i] ?? 0;
      snap.stationKills[i] = credit.stationKills[i] ?? 0;
    }
  }
  return snap;
}

// ---------------------------------------------------------------------------
// The observer
// ---------------------------------------------------------------------------

/**
 * The fastest anything on the board travels, units per second, with generous
 * headroom over `BASE_SPEED` (260) and every class and upgrade multiplier above
 * it. Only the order of magnitude matters: this separates a window of flying from
 * a respawn teleport home, which is hundreds of units in no time at all.
 */
const MAX_TRAVEL_SPEED = 600;

/**
 * The largest step in one observation window that still counts as travel. Scales
 * with the window, so a 20 Hz snapshot stream is never mistaken for a teleport,
 * with a floor of 60 units — the per-tick value the plan's own measurements were
 * taken at, kept so this module reproduces them.
 */
const jumpLimit = (dt: number): number => Math.max(60, MAX_TRAVEL_SPEED * Math.max(0, dt));

/** One window of observation, kept whole so it can be rolled back whole. */
interface Window {
  /** Per-slot deltas this window added. */
  tally: Tally[];
  /** Build-job ids this window was the first to see, by slot. */
  builds: Set<number>[];
  /** Victims each attacker landed damage on in this window, by attacker slot. */
  victims: Set<PlayerId>[];
  /** Seats whose home died in this window, and the wave count at that moment. */
  homeDeaths: { slot: PlayerId; waves: number }[];
  /** The snapshot this window was measured FROM. */
  from: Snapshot;
}

/** A live observation of one match. Created at match start, fed the world, and
 *  asked for the answer at teardown. */
export interface AccrualObserver {
  /**
   * Fold one look at the world into the tally.
   *
   * **Feed this the authoritative world** — the server's online, the local one
   * offline (module header). Re-delivering the newest tick is safe: its window is
   * rolled back and re-measured from the corrected world. Anything older is
   * ignored.
   */
  observe(world: World): void;
  /** The finished accrual, one per seat, indexed by slot. Pure: it mutates
   *  neither the world nor the observer, and may be called as often as you like
   *  (the summary sequence reads it every frame). */
  finalize(world: World): MatchAccrual[];
}

/**
 * Start observing a match.
 *
 * `tiers[slot]` is the difficulty an opponent in that seat is *scored* at:
 * `PERSONALITIES[id].difficulty` for a bot, and `HUMAN_TIER` (`./xp`) for a
 * person. It is lobby knowledge — local, deterministic, and impossible to spoof,
 * because nothing about a bot's difficulty ever arrives over a wire (plan
 * §1.3b). A seat with no tier given reads as Medium, the neutral ×1.0 rung.
 */
export function createAccrualObserver(world: World, tiers: readonly Difficulty[]): AccrualObserver {
  const slots = Math.max(world.ships.length, tiers.length);
  const tierOf = (slot: PlayerId): Difficulty => tiers[slot] ?? Difficulty.Medium;

  const total: Tally[] = Array.from({ length: slots }, blankTally);
  const builds: Set<number>[] = Array.from({ length: slots }, () => new Set<number>());
  /** Everyone each attacker has landed damage on so far — the third step of
   *  `pairVictims`, and cheap to keep. */
  const damaged: Set<PlayerId>[] = Array.from({ length: slots }, () => new Set<PlayerId>());
  /** `match.wavesSpawned` when this seat's home died, or -1 while it lives. */
  const wavesAtHomeDeath: number[] = new Array<number>(slots).fill(-1);
  let from = snapshot(world, slots);
  let last: Window | null = null;

  /**
   * Victims to charge one attacker's window of damage to.
   *
   * The candidate set comes from the LEDGER — `lastDamageAt[victim][attacker]`,
   * stamped inside this window — so this is a read, never a reconstruction
   * (brief test 2). Four steps, most specific first, each firing only when the
   * one above it found nothing:
   *
   *  1. Ledger pairs whose matching HP pool visibly dropped — the exact answer,
   *     and the only step that fires when the observer is fed every tick.
   *  2. Ledger pairs, unfiltered — the pool moved out of sight (a hull that
   *     respawned inside a coarse window, a shield that regenerated over it).
   *  3. Everyone this attacker has damaged earlier in the match.
   *  4. Every other seat — the last resort, split evenly rather than guessing a
   *     tier.
   */
  const pairVictims = (
    live: World,
    attacker: PlayerId,
    losses: readonly number[],
  ): PlayerId[] => {
    const credit = live.credit;
    const flagged: PlayerId[] = [];
    for (let v = 0; v < slots; v++) {
      if (v === attacker) continue;
      if ((credit?.lastDamageAt[v]?.[attacker] ?? -1) > from.time) flagged.push(v);
    }
    const withLoss = flagged.filter((v) => (losses[v] ?? 0) > 1e-9);
    if (withLoss.length > 0) return withLoss;
    if (flagged.length > 0) return flagged;
    const previously = [...damaged[attacker]!].sort((a, b) => a - b);
    if (previously.length > 0) return previously;
    const everyone: PlayerId[] = [];
    for (let v = 0; v < slots; v++) if (v !== attacker) everyone.push(v);
    return everyone;
  };

  /** Seats whose body went alive → dead in this window with `attacker` recorded
   *  as the last enemy to hit them (`CombatCredit.lastHitBy`). */
  const victimsThatDied = (
    live: World,
    attacker: PlayerId,
    was: readonly boolean[],
    now: readonly boolean[],
  ): PlayerId[] => {
    const credit = live.credit;
    const out: PlayerId[] = [];
    for (let v = 0; v < slots; v++) {
      if (v === attacker || !was[v] || now[v]) continue;
      if ((credit?.lastHitBy[v] ?? null) === attacker) out.push(v);
    }
    return out;
  };

  /** Split `amount` across `victims` in proportion to `losses` — or evenly when
   *  the losses carry no signal — and bank each share under the victim's tier. */
  const spread = (
    bucket: Record<Difficulty, number>,
    amount: number,
    victims: readonly PlayerId[],
    losses: readonly number[],
  ): void => {
    if (amount <= 0 || victims.length === 0) return;
    if (victims.length === 1) {
      bucket[tierOf(victims[0]!)] += amount;
      return;
    }
    const weights = victims.map((v) => Math.max(0, losses[v] ?? 0));
    const sum = weights.reduce((a, b) => a + b, 0);
    victims.forEach((v, i) => {
      bucket[tierOf(v)] += sum > 1e-9 ? (amount * weights[i]!) / sum : amount / victims.length;
    });
  };

  const measure = (live: World, now: Snapshot): Window => {
    const tally: Tally[] = Array.from({ length: slots }, blankTally);
    const fresh: Set<number>[] = Array.from({ length: slots }, () => new Set<number>());
    const victims: Set<PlayerId>[] = Array.from({ length: slots }, () => new Set<PlayerId>());
    const homeDeaths: { slot: PlayerId; waves: number }[] = [];
    const limit = jumpLimit(now.time - from.time);

    // --- the free half: world deltas -----------------------------------------
    for (const ship of live.ships) {
      const i = ship.id;
      const t = tally[i];
      if (!t) continue;
      const wasAlive = from.shipAlive[i]!;
      const dCargo = now.cargo[i]! - from.cargo[i]!;
      if (dCargo > 0) t.oreMined += dCargo;
      const dBank = now.banked[i]! - from.banked[i]!;
      if (dBank > 0) t.oreBanked += dBank;

      // A drop in (hold + bank) is a PURCHASE only while the hull and the home
      // both live. Across a ship death it is the half-hold sink (GDD §2.3); across
      // a home's death it is the bank scattering as wreck debris
      // (`scatterWreckDebris`). Both are losses, not spending (brief test 5).
      const homeLives = from.stationAlive[i]! && now.stationAlive[i]!;
      const heldNow = now.cargo[i]! + now.banked[i]!;
      const heldBefore = from.cargo[i]! + from.banked[i]!;
      if (ship.alive && wasAlive && homeLives && heldNow < heldBefore) t.oreUsed += heldBefore - heldNow;

      const dTiers = now.tierSum[i]! - from.tierSum[i]!;
      if (dTiers > 0) t.upgrades += dTiers;

      // Respawn is not travel (brief test 4): the hull must be alive at both ends
      // of the window, and the step one a ship could actually have flown.
      if (ship.alive && wasAlive) {
        const step = Math.hypot(now.x[i]! - from.x[i]!, now.y[i]! - from.y[i]!);
        if (step < limit) t.distance += step;
      }
      if (wasAlive && !ship.alive) t.deaths += 1;
    }

    for (let i = 0; i < slots; i++) {
      const t = tally[i];
      const station = stationOf(live, i);
      if (!t || !station) continue;
      const dCore = now.coreHp[i]! - from.coreHp[i]!;
      if (dCore > 0) t.repairs += dCore / REPAIR_HP_PER_ORE;
      for (const job of station.builds) if (!builds[i]!.has(job.id)) fresh[i]!.add(job.id);
      // Waves survived is the count at YOUR death, not at the match's end
      // (plan §1.1) — a player knocked out in wave 2 did not survive wave 5.
      if (from.stationAlive[i]! && !now.stationAlive[i]!) {
        homeDeaths.push({ slot: i, waves: now.wavesSpawned });
      }
    }

    // --- the credited half: read off pr-02's ledger ---------------------------
    // Damage and kills are NOT recomputed here (brief test 2). The victim of each
    // window's damage is read from the ledger's own per-pair clock; the HP pools
    // below only apportion between victims the ledger has already named.
    const hullLoss: number[] = new Array<number>(slots).fill(0);
    const homeLoss: number[] = new Array<number>(slots).fill(0);
    for (let v = 0; v < slots; v++) {
      hullLoss[v] = Math.max(0, from.hull[v]! - now.hull[v]!);
      // A dying station zeroes its own turrets, shields and core as bookkeeping;
      // that is not damage anybody dealt, so it must not weight the split.
      const homeDied = from.stationAlive[v]! && !now.stationAlive[v]!;
      homeLoss[v] = homeDied ? 0 : Math.max(0, from.stationHp[v]! - now.stationHp[v]!);
    }

    for (let a = 0; a < slots; a++) {
      const t = tally[a];
      if (!t) continue;
      const dShips = now.dealtToShips[a]! - from.dealtToShips[a]!;
      if (dShips > 0) {
        const hit = pairVictims(live, a, hullLoss);
        spread(t.damageDealt, dShips, hit, hullLoss);
        for (const v of hit) victims[a]!.add(v);
      }
      const dStations = now.dealtToStations[a]! - from.dealtToStations[a]!;
      if (dStations > 0) {
        const hit = pairVictims(live, a, homeLoss);
        spread(t.damageDealt, dStations, hit, homeLoss);
        for (const v of hit) victims[a]!.add(v);
      }

      // A killing blow: the ledger says how many, and `lastHitBy` on a body that
      // died in this window says whose it was. There is no fallback to an earlier
      // hit — that is the guess the honesty rule forbids (plan §1.5).
      const dShipKills = now.shipKills[a]! - from.shipKills[a]!;
      if (dShipKills > 0) {
        const dead = victimsThatDied(live, a, from.shipAlive, now.shipAlive);
        spread(t.shipKills, dShipKills, dead.length > 0 ? dead : pairVictims(live, a, hullLoss), hullLoss);
      }
      const dStationKills = now.stationKills[a]! - from.stationKills[a]!;
      if (dStationKills > 0) {
        const dead = victimsThatDied(live, a, from.stationAlive, now.stationAlive);
        spread(t.stationKills, dStationKills, dead.length > 0 ? dead : pairVictims(live, a, homeLoss), homeLoss);
      }
    }

    return { tally, builds: fresh, victims, homeDeaths, from };
  };

  const apply = (window: Window, sign: 1 | -1): void => {
    for (let i = 0; i < slots; i++) {
      addTally(total[i]!, window.tally[i]!, sign);
      for (const id of window.builds[i]!) {
        if (sign === 1) builds[i]!.add(id);
        else builds[i]!.delete(id);
      }
      for (const v of window.victims[i]!) {
        if (sign === 1) damaged[i]!.add(v);
        else damaged[i]!.delete(v);
      }
    }
    for (const death of window.homeDeaths) {
      wavesAtHomeDeath[death.slot] = sign === 1 ? death.waves : -1;
    }
  };

  return {
    observe(live: World): void {
      // Older than the look we already folded in: ignore it. One window is all
      // the history an observer holding one snapshot can honestly undo.
      if (live.tick < from.tick) return;
      if (live.tick === from.tick && live.time <= from.time) {
        // The same instant, delivered again — the reconcile. Roll the last window
        // back and re-measure it from where it started, so a corrected tick lands
        // exactly once and an identical one changes nothing at all.
        if (last === null) return;
        apply(last, -1);
        from = last.from;
        last = null;
      }
      const now = snapshot(live, slots);
      const window = measure(live, now);
      apply(window, 1);
      last = window;
      from = now;
    },

    finalize(live: World): MatchAccrual[] {
      const out: MatchAccrual[] = [];
      const eliminated = live.match.eliminated;
      const winner = live.match.winner;
      const winningTeam = live.match.winningTeam ?? null;
      const n = Math.min(slots, live.ships.length);
      for (let i = 0; i < n; i++) {
        const t = total[i]!;
        const station = stationOf(live, i);
        const ship = live.ships.find((s) => s.id === i);
        const alive = station?.alive ?? false;
        const rank = eliminated.indexOf(i); // 0 = first out
        const won =
          winningTeam !== null && ship?.team !== undefined ? ship.team === winningTeam : winner === i;
        out.push({
          slot: i,
          slots: n,
          oreMined: t.oreMined,
          oreBanked: t.oreBanked,
          oreUsed: t.oreUsed,
          distance: t.distance,
          shipsUsed: t.deaths + 1,
          structures: builds[i]!.size,
          upgrades: t.upgrades,
          repairs: t.repairs,
          wavesSurvived: wavesAtHomeDeath[i]! >= 0 ? wavesAtHomeDeath[i]! : live.match.wavesSpawned,
          placement: alive || rank < 0 ? 1 : n - rank,
          won,
          seconds: alive ? live.time : Math.max(0, station?.deathTime ?? live.time),
          damageDealt: { ...t.damageDealt },
          shipKills: { ...t.shipKills },
          stationKills: { ...t.stationKills },
        });
      }
      return out;
    },
  };
}
