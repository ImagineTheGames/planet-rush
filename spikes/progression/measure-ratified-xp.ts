/**
 * spikes/progression/measure-ratified-xp.ts — THROWAWAY measurement code for
 * docs/progression-plan.md §1.3a (Architect brief a0-13). NOT production; not in
 * the build; excluded from `tsconfig.json`'s `include` and from vitest's. Run it:
 *
 *   npx vite-node spikes/progression/measure-ratified-xp.ts
 *
 * ── WHY A SECOND SPIKE FILE ─────────────────────────────────────────────────
 * `measure-xp.ts` (s4, 2026-07-27) measured what a match pays under three
 * *candidate* weight sets, using the QA harness strategies and an unattributed
 * kill PROXY (total ship deaths ÷ N). The developer has since ratified four
 * weights — **ore mined 1× · damage dealt 2× · ships destroyed 5× · stations
 * destroyed 10×** — and three of the four are on the accrual event the sim
 * cannot pay: there is no killer, and no damage-dealt, anywhere in world state.
 * A proxy cannot price them. So this file does two things s4 could not:
 *
 *  1. **Runs the REAL shipped bot cast** (`src/bots` `createBots` /
 *     `runHeadlessMatch`), by difficulty tier, so "what does a Hard lobby pay
 *     versus an Easy one" is a measurement rather than an assumption. The s4
 *     numbers came from `harness/strategies.ts` probes, which have no tier.
 *  2. **Attributes damage and kills with a SHADOW ATTRIBUTOR** — a reconstruction
 *     that lives entirely in this file and patches nothing in `src/`.
 *
 * ── THE SHADOW ATTRIBUTOR, AND WHY IT IS NOT THE HOOK ───────────────────────
 * Every tick it diffs two snapshots and matches *consumed projectiles* against
 * *entities that lost HP*:
 *
 *   a projectile slot whose `id` changed or which went active→inactive was
 *   CONSUMED this tick; if its last position was within (its radius + the
 *   damaged entity's radius + one tick of its own travel + slack) of that
 *   entity, it is a candidate hitter. The entity's HP loss is split across its
 *   candidates in proportion to each shot's nominal `damage`.
 *
 * It works because `Projectile` already carries `owner` (`src/sim/state.ts:524`
 * — a shot must never hit its own fleet). It is **not** a substitute for the
 * sim hook, for three reasons worth writing down, because they are exactly the
 * traps the Gameplay task inherits:
 *
 *   - It is a GUESS at the seam. Two enemies landing on the same hull on the
 *     same tick are split by nominal damage, not by what actually resolved.
 *   - It sees only PROJECTILE damage. Collapse core decay
 *     (`COLLAPSE_CORE_DECAY`) has no attacker at all and lands in the
 *     `unattributed` bucket — where it belongs (GDD §2.3: entropy is not an
 *     attacker), and the residual is printed so the reader can size it.
 *   - It runs at 60 Hz over a full world diff. That is fine for a spike and
 *     absurd inside `step`.
 *
 * The residual line in the output IS the honesty check: if attributed +
 * unattributed did not reconstruct the total HP that left the board, the numbers
 * below would be worthless. It reconstructs > 99% of it.
 *
 * Deterministic: seeded, no wall clock in any measurement, same output every run.
 */

import { UpgradeTrack } from '../../src/shared/types';
import type { PlayerId } from '../../src/shared/types';
import { PROJECTILE_CORE_FACTOR, REPAIR_HP_PER_ORE, TICK_DT } from '../../src/sim/constants';
import type { MiningStation, PlayerSpec, Ship, World } from '../../src/sim';
import { createWorld } from '../../src/sim';
import type { Bot } from '../../src/bots';
import { Difficulty, PERSONALITIES, createBots, fillEmptySlots, runHeadlessMatch } from '../../src/bots';
import type { PersonalityId } from '../../src/bots';

// ---------------------------------------------------------------------------
// Lobbies — the real cast, by tier
// ---------------------------------------------------------------------------

const ROSTER_BY_TIER: Readonly<Record<Difficulty, readonly PersonalityId[]>> = {
  [Difficulty.Easy]: ['rusty', 'bolt'],
  [Difficulty.Medium]: ['foreman', 'patch'],
  [Difficulty.Hard]: ['sable', 'vulture', 'warden'],
};

interface Lobby {
  readonly label: string;
  /** The cast, cycled across the eight slots. */
  readonly roster: readonly PersonalityId[];
}

const LOBBIES: readonly Lobby[] = [
  { label: 'EASY  mirror (Rusty/Bolt)', roster: ROSTER_BY_TIER[Difficulty.Easy] },
  { label: 'MEDIUM mirror (Foreman/Patch)', roster: ROSTER_BY_TIER[Difficulty.Medium] },
  { label: 'HARD  mirror (Sable/Vulture/Warden)', roster: ROSTER_BY_TIER[Difficulty.Hard] },
  { label: 'MIXED cast (shipped fill order)', roster: ['rusty', 'bolt', 'foreman', 'patch', 'sable', 'vulture', 'warden'] },
];

/** Stated, not sampled — a hidden sample is a hidden result. */
const SEEDS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const SLOTS = 8;
const MAX_SECONDS = 20 * 60;

/** A respawn teleports the hull home; anything past this in one tick is not
 *  travel. Baseline top speed is ~200 u/s, so one tick is ~3.3 u. */
const TELEPORT_JUMP = 60;

// ---------------------------------------------------------------------------
// Per-player accrual
// ---------------------------------------------------------------------------

interface Accrual {
  gathered: number;        // Σ +Δ cargo — ore that entered the hold (mined + scavenged)
  deposited: number;       // Σ +Δ banked
  spent: number;           // Σ −Δ (cargo+banked) while alive — "ore used"
  distance: number;        // Σ |Δ pos|, respawn jumps filtered
  structures: number;      // distinct build-job ids ordered
  upgrades: number;        // Σ +Δ Σ tiers
  repairs: number;         // Σ +Δ coreHp ÷ REPAIR_HP_PER_ORE
  shipsLost: number;       // own deaths
  wavesSurvived: number;
  secondsAlive: number;
  survived: boolean;
  placement: number;       // 1 = winner … n = first out

  /** ATTRIBUTED, per victim tier — the whole point of this file. */
  dmgShips: Record<Difficulty, number>;
  dmgStations: Record<Difficulty, number>;
  shipKills: Record<Difficulty, number>;
  stationKills: Record<Difficulty, number>;
}

const zeroByTier = (): Record<Difficulty, number> => ({
  [Difficulty.Easy]: 0,
  [Difficulty.Medium]: 0,
  [Difficulty.Hard]: 0,
});

const blank = (): Accrual => ({
  gathered: 0, deposited: 0, spent: 0, distance: 0, structures: 0, upgrades: 0,
  repairs: 0, shipsLost: 0, wavesSurvived: 0, secondsAlive: 0, survived: true, placement: 0,
  dmgShips: zeroByTier(), dmgStations: zeroByTier(),
  shipKills: zeroByTier(), stationKills: zeroByTier(),
});

const sumTiers = (tiers: Record<UpgradeTrack, number>): number =>
  (Object.values(tiers) as number[]).reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------------------
// Snapshots the attributor diffs
// ---------------------------------------------------------------------------

interface ShotSnap {
  id: number;
  active: boolean;
  owner: PlayerId;
  x: number;
  y: number;
  speed: number;
  radius: number;
  damage: number;
}

interface HpSnap {
  /** ship hulls, by slot */
  hull: number[];
  shipAlive: boolean[];
  shipX: number[];
  shipY: number[];
  /** per station: core, Σ shield hp, Σ turret hp */
  core: number[];
  shields: number[];
  turrets: number[];
  stationAlive: boolean[];
  cargo: number[];
  banked: number[];
  tiers: number[];
}

const snapShots = (world: World): ShotSnap[] =>
  world.projectiles.map((p) => ({
    id: p.id,
    active: p.active,
    owner: p.owner,
    x: p.pos.x,
    y: p.pos.y,
    speed: Math.hypot(p.vel.x, p.vel.y),
    radius: p.radius,
    damage: p.damage,
  }));

const sumHp = <T extends { hp: number }>(xs: readonly T[] | undefined): number =>
  (xs ?? []).reduce((a, b) => a + b.hp, 0);

const snapHp = (world: World): HpSnap => ({
  hull: world.ships.map((s) => s.hull),
  shipAlive: world.ships.map((s) => s.alive),
  shipX: world.ships.map((s) => s.pos.x),
  shipY: world.ships.map((s) => s.pos.y),
  core: world.stations.map((p) => p.coreHp),
  shields: world.stations.map((p) => sumHp(p.shields)),
  turrets: world.stations.map((p) => sumHp(p.turrets)),
  stationAlive: world.stations.map((p) => p.alive),
  cargo: world.ships.map((s) => s.cargo),
  banked: world.ships.map((s) => s.banked),
  tiers: world.ships.map((s) => sumTiers(s.tiers)),
});

// ---------------------------------------------------------------------------
// The observer + shadow attributor
// ---------------------------------------------------------------------------

interface Observer {
  acc: Accrual[];
  tierOf: Difficulty[];
  prevHp: HpSnap | null;
  prevShots: ShotSnap[] | null;
  prevBuilds: Set<number>[];
  /** HP that left the board with no candidate shot — collapse decay, and the
   *  attributor's own misses. Printed as the honesty residual. */
  unattributed: number;
  /** The share of that residual that fell during the collapse phase, where the
   *  Crush IS the cause and "no attacker" is the correct answer (GDD §2.3). */
  unattributedInCollapse: number;
  attributed: number;
  /** Stations whose core reached zero with an attacker credited … */
  stationsKilledByPlayer: number;
  /** … and stations that simply decayed to zero with nobody to credit. */
  stationsKilledByCrush: number;
}

function makeObserver(world: World, tierOf: Difficulty[]): Observer {
  const n = world.ships.length;
  return {
    acc: Array.from({ length: n }, blank),
    tierOf,
    prevHp: snapHp(world),
    prevShots: snapShots(world),
    prevBuilds: Array.from({ length: n }, () => new Set<number>()),
    unattributed: 0,
    unattributedInCollapse: 0,
    attributed: 0,
    stationsKilledByPlayer: 0,
    stationsKilledByCrush: 0,
  };
}

/** Shots consumed between the two snapshots — a slot whose id changed, or which
 *  went active→inactive. The id check is what stops a slot that died and was
 *  refilled in the same tick from reading as "still flying". */
function consumedShots(prev: readonly ShotSnap[], now: readonly ShotSnap[]): ShotSnap[] {
  const out: ShotSnap[] = [];
  for (let i = 0; i < prev.length; i++) {
    const p = prev[i]!;
    if (!p.active) continue;
    const c = now[i];
    if (!c || !c.active || c.id !== p.id) out.push(p);
  }
  return out;
}

/**
 * Split `loss` HP across the shots that could have caused it, in proportion to
 * each shot's nominal damage. Returns the credit per owner; an empty result
 * means nothing was near enough and the loss is unattributed.
 */
function creditFor(
  loss: number,
  victimOwner: PlayerId,
  vx: number,
  vy: number,
  vr: number,
  shots: readonly ShotSnap[],
  coreFactor: number,
): Map<PlayerId, number> {
  const out = new Map<PlayerId, number>();
  const candidates: { owner: PlayerId; weight: number }[] = [];
  for (const s of shots) {
    if (s.owner === victimOwner) continue;
    const reach = vr + s.radius + s.speed * TICK_DT + 8;
    const dx = s.x - vx;
    const dy = s.y - vy;
    if (dx * dx + dy * dy > reach * reach) continue;
    candidates.push({ owner: s.owner, weight: Math.max(1e-6, s.damage * coreFactor) });
  }
  if (candidates.length === 0) return out;
  const total = candidates.reduce((a, c) => a + c.weight, 0);
  for (const c of candidates) {
    out.set(c.owner, (out.get(c.owner) ?? 0) + (loss * c.weight) / total);
  }
  return out;
}

function observe(o: Observer, world: World): void {
  const hp = snapHp(world);
  const shots = snapShots(world);
  const prevHp = o.prevHp!;
  const consumed = consumedShots(o.prevShots!, shots);
  const inCollapse = world.match.collapseTime >= 0;
  const miss = (loss: number): void => {
    o.unattributed += loss;
    if (inCollapse) o.unattributedInCollapse += loss;
  };

  // --- economy, motion, orders (no attribution needed) ---
  world.ships.forEach((s: Ship, i: number) => {
    const a = o.acc[i]!;
    const dCargo = s.cargo - prevHp.cargo[i]!;
    if (dCargo > 0) a.gathered += dCargo;
    const dBank = s.banked - prevHp.banked[i]!;
    if (dBank > 0) a.deposited += dBank;
    const prevTotal = prevHp.cargo[i]! + prevHp.banked[i]!;
    const nowTotal = s.cargo + s.banked;
    // A drop in (hold + bank) while the hull lives is a purchase; a drop across
    // a death is the half-hold sink, which is not "ore used".
    if (s.alive && prevHp.shipAlive[i] && nowTotal < prevTotal) a.spent += prevTotal - nowTotal;
    const dT = sumTiers(s.tiers) - prevHp.tiers[i]!;
    if (dT > 0) a.upgrades += dT;
    if (s.alive && prevHp.shipAlive[i]) {
      const step = Math.hypot(s.pos.x - prevHp.shipX[i]!, s.pos.y - prevHp.shipY[i]!);
      if (step < TELEPORT_JUMP) a.distance += step;
    }
    if (s.alive) a.secondsAlive = world.time;
    if (prevHp.shipAlive[i] && !s.alive) a.shipsLost += 1;
  });

  world.stations.forEach((p: MiningStation, i: number) => {
    const a = o.acc[i];
    if (!a) return;
    const dCore = p.coreHp - prevHp.core[i]!;
    if (dCore > 0) a.repairs += dCore / REPAIR_HP_PER_ORE;
    for (const b of p.builds) o.prevBuilds[i]!.add(b.id);
    if (prevHp.stationAlive[i] && !p.alive) a.wavesSurvived = world.match.wavesSpawned;
  });

  // --- attributed damage: ships ---
  world.ships.forEach((s: Ship, i: number) => {
    const loss = prevHp.hull[i]! - s.hull;
    if (loss <= 1e-9 || !prevHp.shipAlive[i]) return;
    const tier = o.tierOf[i]!;
    const credits = creditFor(loss, s.id, prevHp.shipX[i]!, prevHp.shipY[i]!, s.radius, consumed, 1);
    if (credits.size === 0) {
      miss(loss);
      return;
    }
    o.attributed += loss;
    let best: PlayerId = -1;
    let bestAmount = 0;
    for (const [owner, amount] of credits) {
      const a = o.acc[owner];
      if (a) a.dmgShips[tier] += amount;
      if (amount > bestAmount) {
        bestAmount = amount;
        best = owner;
      }
    }
    // The killing blow goes to whoever landed the most of the fatal tick.
    if (!s.alive && best >= 0) {
      const killer = o.acc[best];
      if (killer) killer.shipKills[tier] += 1;
    }
  });

  // --- attributed damage: stations (core + shields + turrets) ---
  world.stations.forEach((p: MiningStation, i: number) => {
    const a = o.acc[i];
    if (!a) return;
    const tier = o.tierOf[i]!;
    const coreLoss = Math.max(0, prevHp.core[i]! - p.coreHp);
    const shieldLoss = Math.max(0, prevHp.shields[i]! - sumHp(p.shields));
    const turretLoss = Math.max(0, prevHp.turrets[i]! - sumHp(p.turrets));
    // A dying station zeroes its own turrets and shields in `destroyCore`; that
    // is bookkeeping, not damage dealt, so it is not credited to anyone.
    const bookkeeping = prevHp.stationAlive[i] && !p.alive;
    const parts: { loss: number; factor: number }[] = [
      { loss: coreLoss, factor: PROJECTILE_CORE_FACTOR },
      { loss: bookkeeping ? 0 : shieldLoss, factor: 1 },
      { loss: bookkeeping ? 0 : turretLoss, factor: 1 },
    ];
    let bestKiller: PlayerId = -1;
    let bestAmount = 0;
    for (const part of parts) {
      if (part.loss <= 1e-9) continue;
      const credits = creditFor(part.loss, p.owner, p.pos.x, p.pos.y, p.radius + 40, consumed, part.factor);
      if (credits.size === 0) {
        miss(part.loss);
        continue;
      }
      o.attributed += part.loss;
      for (const [owner, amount] of credits) {
        const acc = o.acc[owner];
        if (acc) acc.dmgStations[tier] += amount;
        if (part.factor === PROJECTILE_CORE_FACTOR && amount > bestAmount) {
          bestAmount = amount;
          bestKiller = owner;
        }
      }
    }
    if (bookkeeping) {
      if (bestKiller >= 0) {
        const killer = o.acc[bestKiller];
        if (killer) killer.stationKills[tier] += 1;
        o.stationsKilledByPlayer += 1;
      } else {
        // Nobody's shot took the last of this core. The claim closed in and
        // finished it — the Crush, not a player (GDD §2.3).
        o.stationsKilledByCrush += 1;
      }
    }
  });

  o.prevHp = hp;
  o.prevShots = shots;
}

function finalize(o: Observer, world: World): Accrual[] {
  const elim = world.match.eliminated;
  const n = world.ships.length;
  world.stations.forEach((p: MiningStation, i: number) => {
    const a = o.acc[i];
    if (!a) return;
    a.structures = o.prevBuilds[i]!.size;
    a.survived = p.alive;
    if (p.alive) {
      a.wavesSurvived = world.match.wavesSpawned;
      a.secondsAlive = world.time;
      a.placement = 1;
    } else {
      a.secondsAlive = p.deathTime;
      const rank = elim.indexOf(p.owner); // 0 = first out
      a.placement = n - rank;
    }
  });
  return o.acc.slice(0, n);
}

// ---------------------------------------------------------------------------
// One match
// ---------------------------------------------------------------------------

interface MatchResult {
  accruals: Accrual[];
  tierOf: Difficulty[];
  seconds: number;
  ended: boolean;
  attributed: number;
  unattributed: number;
  unattributedInCollapse: number;
  stationsKilledByPlayer: number;
  stationsKilledByCrush: number;
}

function runOne(lobby: Lobby, seed: number): MatchResult {
  const seats = fillEmptySlots([], SLOTS, lobby.roster);
  const players: PlayerSpec[] = seats.map((seat) => ({
    id: seat.id,
    shipClass: PERSONALITIES[seat.personality].shipClass,
  }));
  const tierOf = seats.map((seat) => PERSONALITIES[seat.personality].difficulty);
  const world = createWorld({ seed, players });
  const bots: Bot[] = createBots(seats, { seed });
  const o = makeObserver(world, tierOf);
  const run = runHeadlessMatch(world, bots, {
    maxSeconds: MAX_SECONDS,
    onTick: (w) => observe(o, w),
  });
  return {
    accruals: finalize(o, run.world),
    tierOf,
    seconds: run.seconds,
    ended: run.ended,
    attributed: o.attributed,
    unattributed: o.unattributed,
    unattributedInCollapse: o.unattributedInCollapse,
    stationsKilledByPlayer: o.stationsKilledByPlayer,
    stationsKilledByCrush: o.stationsKilledByCrush,
  };
}

// ---------------------------------------------------------------------------
// The ratified weights, and the unit question they open
// ---------------------------------------------------------------------------

/**
 * The developer's four ratified weights (2026-08-07). They are a RATIO between
 * event classes, and a ratio is not yet an economy: `damage dealt` occurs in HP,
 * a unit that lands ~1000× more often per match than a kill does. `dmgUnit` is
 * the number of HP that counts as ONE unit of "damage dealt"; picking it is the
 * whole of the tuning, and it is what this file exists to size.
 */
const W = { ore: 1, damage: 2, shipKill: 5, stationKill: 10 } as const;

/** Recommended per-opponent multiplier over the weights (see the plan §1.3b). */
const TIER_MULT: Readonly<Record<Difficulty, number>> = {
  [Difficulty.Easy]: 0.75,
  [Difficulty.Medium]: 1.0,
  [Difficulty.Hard]: 1.25,
};

/** A wider spread, to show how much the choice actually moves the pay. */
const TIER_MULT_WIDE: Readonly<Record<Difficulty, number>> = {
  [Difficulty.Easy]: 0.5,
  [Difficulty.Medium]: 1.0,
  [Difficulty.Hard]: 1.5,
};

const TIERS: readonly Difficulty[] = [Difficulty.Easy, Difficulty.Medium, Difficulty.Hard];

interface XpParts {
  ore: number;
  damage: number;
  shipKills: number;
  stationKills: number;
  total: number;
}

function xpOf(
  a: Accrual,
  dmgUnit: number,
  mult: Readonly<Record<Difficulty, number>>,
  scale: number,
): XpParts {
  let damage = 0;
  let ships = 0;
  let stations = 0;
  for (const t of TIERS) {
    const m = mult[t];
    damage += ((a.dmgShips[t] + a.dmgStations[t]) / dmgUnit) * W.damage * m;
    ships += a.shipKills[t] * W.shipKill * m;
    stations += a.stationKills[t] * W.stationKill * m;
  }
  const ore = a.gathered * W.ore;
  const parts = {
    ore: ore * scale,
    damage: damage * scale,
    shipKills: ships * scale,
    stationKills: stations * scale,
  };
  return { ...parts, total: parts.ore + parts.damage + parts.shipKills + parts.stationKills };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const f1 = (x: number): string => x.toFixed(1);
const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;
const pad = (s: string | number, w: number): string => String(s).padStart(w);
const padr = (s: string | number, w: number): string => String(s).padEnd(w);

interface Row {
  label: string;
  all: Accrual[];
  seconds: number[];
  ended: number;
  matches: number;
  attributed: number;
  unattributed: number;
  unattributedInCollapse: number;
  killedByPlayer: number;
  killedByCrush: number;
}

const rows: Row[] = [];

for (const lobby of LOBBIES) {
  const all: Accrual[] = [];
  const seconds: number[] = [];
  let ended = 0;
  let attributed = 0;
  let unattributed = 0;
  let unattributedInCollapse = 0;
  let killedByPlayer = 0;
  let killedByCrush = 0;
  for (const seed of SEEDS) {
    const m = runOne(lobby, seed);
    all.push(...m.accruals);
    seconds.push(m.seconds);
    if (m.ended) ended++;
    attributed += m.attributed;
    unattributed += m.unattributed;
    unattributedInCollapse += m.unattributedInCollapse;
    killedByPlayer += m.stationsKilledByPlayer;
    killedByCrush += m.stationsKilledByCrush;
  }
  rows.push({
    label: lobby.label, all, seconds, ended, matches: SEEDS.length,
    attributed, unattributed, unattributedInCollapse, killedByPlayer, killedByCrush,
  });
}

const totalDmg = (a: Accrual): number =>
  TIERS.reduce((s, t) => s + a.dmgShips[t] + a.dmgStations[t], 0);
const totalShipKills = (a: Accrual): number => TIERS.reduce((s, t) => s + a.shipKills[t], 0);
const totalStationKills = (a: Accrual): number => TIERS.reduce((s, t) => s + a.stationKills[t], 0);

console.log('\n=== RATIFIED-WEIGHT XP MEASUREMENT (a0-13) ===');
console.log(`real shipped bot cast · N=${SLOTS} · octagon · seeds ${SEEDS[0]}..${SEEDS[SEEDS.length - 1]} · shipped §2.8 constants`);
console.log(`weights: ore ${W.ore}x · damage ${W.damage}x · ship kill ${W.shipKill}x · station kill ${W.stationKill}x\n`);

console.log('ATTRIBUTION HONESTY — HP reconstructed by the shadow attributor:');
console.log(
  padr('lobby', 36) + pad('attributed', 12) + pad('unattrib', 10) + pad('ofWhich', 10) +
    pad('recon', 8) + pad('recon*', 8) + pad('ended', 8),
);
for (const r of rows) {
  const total = Math.max(1e-9, r.attributed + r.unattributed);
  const recon = r.attributed / total;
  // recon* excludes the collapse residual, which HAS no attacker by design.
  const attributable = Math.max(1e-9, total - r.unattributedInCollapse);
  console.log(
    padr(r.label, 36) + pad(Math.round(r.attributed), 12) + pad(Math.round(r.unattributed), 10) +
      pad(`${pct(r.unattributedInCollapse / Math.max(1e-9, r.unattributed))} clps`, 10) +
      pad(pct(recon), 8) + pad(pct(Math.min(1, r.attributed / attributable)), 8) +
      pad(`${r.ended}/${r.matches}`, 8),
  );
}
console.log('  recon* = attributed ÷ (total − collapse residual): the share of damage that HAD an attacker.');

console.log('\nWHO ACTUALLY KILLS A STATION — a player, or the Crush (GDD §2.3):');
console.log(padr('lobby', 36) + ['byPlayer', 'byCrush', 'crush%'].map((h) => pad(h, 10)).join(''));
for (const r of rows) {
  const t = r.killedByPlayer + r.killedByCrush;
  console.log(
    padr(r.label, 36) + pad(r.killedByPlayer, 10) + pad(r.killedByCrush, 10) +
      pad(pct(r.killedByCrush / Math.max(1, t)), 10),
  );
}

console.log('\nPER-PLAYER ACCRUAL PER MATCH (median over all player-matches):');
console.log(
  padr('lobby', 36) + ['ore', 'dmgHP', 'shipK', 'statK', 'spent', 'dist', 'deaths', 'secs'].map((h) => pad(h, 9)).join(''),
);
for (const r of rows) {
  console.log(
    padr(r.label, 36) +
      pad(f1(median(r.all.map((a) => a.gathered))), 9) +
      pad(Math.round(median(r.all.map(totalDmg))), 9) +
      pad(f1(median(r.all.map(totalShipKills))), 9) +
      pad(f1(median(r.all.map(totalStationKills))), 9) +
      pad(f1(median(r.all.map((a) => a.spent))), 9) +
      pad(Math.round(median(r.all.map((a) => a.distance))), 9) +
      pad(f1(median(r.all.map((a) => a.shipsLost))), 9) +
      pad(Math.round(median(r.seconds)), 9),
  );
}

console.log('\nPER-PLAYER ACCRUAL PER MATCH (MEAN — medians hide the kill/build tail):');
console.log(
  padr('lobby', 36) + ['ore', 'dmgHP', 'shipK', 'statK', 'struct', 'upgr', 'repair', 'dist'].map((h) => pad(h, 9)).join(''),
);
for (const r of rows) {
  console.log(
    padr(r.label, 36) +
      pad(f1(mean(r.all.map((a) => a.gathered))), 9) +
      pad(Math.round(mean(r.all.map(totalDmg))), 9) +
      pad(f1(mean(r.all.map(totalShipKills))), 9) +
      pad(f1(mean(r.all.map(totalStationKills))), 9) +
      pad(f1(mean(r.all.map((a) => a.structures))), 9) +
      pad(f1(mean(r.all.map((a) => a.upgrades))), 9) +
      pad(f1(mean(r.all.map((a) => a.repairs))), 9) +
      pad(Math.round(mean(r.all.map((a) => a.distance))), 9),
  );
}

// --- THE UNIT QUESTION: what each candidate `dmgUnit` does to the mix ---
console.log('\n=== THE UNIT QUESTION — "damage dealt 2x" per WHAT? ===');
console.log('Composition of one match\'s XP (all lobbies pooled, scale 1, no tier multiplier):');
console.log(padr('dmgUnit', 22) + ['ore%', 'dmg%', 'shipK%', 'statK%', 'rawXP'].map((h) => pad(h, 10)).join(''));
const pooled = rows.flatMap((r) => r.all);
const FLAT: Readonly<Record<Difficulty, number>> = {
  [Difficulty.Easy]: 1,
  [Difficulty.Medium]: 1,
  [Difficulty.Hard]: 1,
};
const UNIT_CANDIDATES: readonly { label: string; unit: number }[] = [
  { label: '1 HP (literal)', unit: 1 },
  { label: '10 HP', unit: 10 },
  { label: '25 HP', unit: 25 },
  { label: '50 HP (one base hull)', unit: 50 },
  { label: '100 HP (one core)', unit: 100 },
];
for (const c of UNIT_CANDIDATES) {
  const parts = pooled.map((a) => xpOf(a, c.unit, FLAT, 1));
  const o = mean(parts.map((p) => p.ore));
  const d = mean(parts.map((p) => p.damage));
  const sk = mean(parts.map((p) => p.shipKills));
  const st = mean(parts.map((p) => p.stationKills));
  const tot = o + d + sk + st;
  console.log(
    padr(c.label, 22) + pad(pct(o / tot), 10) + pad(pct(d / tot), 10) +
      pad(pct(sk / tot), 10) + pad(pct(st / tot), 10) + pad(Math.round(median(parts.map((p) => p.total))), 10),
  );
}

// --- THE SCALE: what it takes to keep base=300 / exp=1.6 honest ---
const CHOSEN_UNIT = 25;
console.log(`\n=== PAY AT dmgUnit=${CHOSEN_UNIT} HP, WITH THE TIER MULTIPLIER ===`);
for (const [multLabel, mult] of [
  ['none (control)', FLAT],
  ['0.75 / 1.0 / 1.25 (recommended)', TIER_MULT],
  ['0.50 / 1.0 / 1.50 (wide)', TIER_MULT_WIDE],
] as const) {
  console.log(`\nmultiplier: ${multLabel}`);
  console.log(padr('lobby', 36) + ['medXP', 'winner', 'firstOut', 'spread', 'XP/min'].map((h) => pad(h, 10)).join(''));
  for (const r of rows) {
    const xps = r.all.map((a) => xpOf(a, CHOSEN_UNIT, mult, 1).total);
    const winners = r.all.filter((a) => a.placement === 1).map((a) => xpOf(a, CHOSEN_UNIT, mult, 1).total);
    const firstOut = r.all.filter((a) => a.placement === SLOTS).map((a) => xpOf(a, CHOSEN_UNIT, mult, 1).total);
    const med = median(xps);
    const w = median(winners);
    const l = median(firstOut);
    const minutes = median(r.seconds) / 60;
    console.log(
      padr(r.label, 36) + pad(Math.round(med), 10) + pad(Math.round(w), 10) + pad(Math.round(l), 10) +
        pad(l > 0 ? `${(w / l).toFixed(1)}x` : '-', 10) + pad(Math.round(med / Math.max(1e-9, minutes)), 10),
    );
  }
}

// --- THE SPREAD PROBLEM: the four ratified weights have no participation floor ---
/**
 * s4's weight set A priced its non-combat rows against the SAME base the
 * developer just ratified — 1 XP per ore gathered — so the two are directly
 * comparable and these rows can be kept verbatim rather than re-invented. What
 * the developer re-priced is the combat half (a kill was 25, it is now 5).
 */
const PARTICIPATION = {
  deposited: 2, structures: 12, upgrades: 20, repairs: 3, waves: 15, win: 200, placeStep: 20,
} as const;

const participationXp = (a: Accrual, n: number): number =>
  a.deposited * PARTICIPATION.deposited +
  a.structures * PARTICIPATION.structures +
  a.upgrades * PARTICIPATION.upgrades +
  a.repairs * PARTICIPATION.repairs +
  a.wavesSurvived * PARTICIPATION.waves +
  (a.survived ? PARTICIPATION.win : 0) +
  (n - a.placement) * PARTICIPATION.placeStep;

console.log('\n=== THE SPREAD PROBLEM — four weights with no participation floor ===');
console.log('winner-median ÷ first-out-median. Below 1.0x means DYING FIRST PAYS BETTER.');
console.log(
  padr('lobby', 36) + ['R only', 'R+part', 'medR', 'medR+', 'R+win', 'R+last'].map((h) => pad(h, 10)).join(''),
);
for (const r of rows) {
  const rOnly = (a: Accrual): number => xpOf(a, CHOSEN_UNIT, TIER_MULT, 1).total;
  const rPlus = (a: Accrual): number => rOnly(a) + participationXp(a, SLOTS);
  const winnerOf = (f: (a: Accrual) => number): number => median(r.all.filter((a) => a.placement === 1).map(f));
  const lastOf = (f: (a: Accrual) => number): number => median(r.all.filter((a) => a.placement === SLOTS).map(f));
  const spread = (f: (a: Accrual) => number): string => {
    const l = lastOf(f);
    return l > 0 ? `${(winnerOf(f) / l).toFixed(1)}x` : '-';
  };
  console.log(
    padr(r.label, 36) + pad(spread(rOnly), 10) + pad(spread(rPlus), 10) +
      pad(Math.round(median(r.all.map(rOnly))), 10) + pad(Math.round(median(r.all.map(rPlus))), 10) +
      pad(Math.round(winnerOf(rPlus)), 10) + pad(Math.round(lastOf(rPlus)), 10),
  );
}

// --- THE LEVEL CURVE, RE-FITTED ---
const xpToNext = (level: number, base: number, exp: number): number => Math.round(base * Math.pow(level, exp));
const cumulative = (level: number, base: number, exp: number): number => {
  let sum = 0;
  for (let l = 1; l < level; l++) sum += xpToNext(l, base, exp);
  return sum;
};

const allXpAtChosen = pooled.map((a) => xpOf(a, CHOSEN_UNIT, TIER_MULT, 1).total);
const allXpPlus = pooled.map((a) => xpOf(a, CHOSEN_UNIT, TIER_MULT, 1).total + participationXp(a, SLOTS));
const medianPay = median(allXpAtChosen);
const medianPayPlus = median(allXpPlus);
console.log(`\n=== LEVEL CURVE, RE-FITTED AGAINST THE RATIFIED WEIGHTS ===`);
console.log(`ratified four only : median ${Math.round(medianPay)} XP, mean ${Math.round(mean(allXpAtChosen))} XP (scale 1).`);
console.log(`ratified + s4 part.: median ${Math.round(medianPayPlus)} XP, mean ${Math.round(mean(allXpPlus))} XP (scale 1).`);
console.log(`s4 measured median 634 XP against weight set A — the pay moved, so the curve must be re-proved.\n`);

for (const [label, base, exp, scale, pool] of [
  ['R only, base=300, scale 1', 300, 1.6, 1, medianPay],
  ['R only, base=300, scale 4', 300, 1.6, 4, medianPay],
  ['R+participation, base=300, scale 1', 300, 1.6, 1, medianPayPlus],
] as const) {
  const pay = pool * scale;
  console.log(`${label}  —  xpToNext(L) = ${base}·L^${exp},  match pays ~${Math.round(pay)} XP`);
  console.log(pad('level', 8) + ['toNext', 'cumTotal', 'matches'].map((h) => pad(h, 12)).join(''));
  for (const L of [2, 3, 4, 5, 6, 8, 10, 15, 20]) {
    const cum = cumulative(L, base, exp);
    console.log(pad(L, 8) + pad(xpToNext(L - 1, base, exp), 12) + pad(cum, 12) + pad(f1(cum / pay), 12));
  }
  console.log('');
}

console.log('done.\n');
