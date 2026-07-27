/**
 * spikes/progression/measure-xp.ts — THROWAWAY measurement code for
 * docs/progression-plan.md (Architect spike s4). NOT production; not in the
 * build; excluded from tsconfig/vitest include. Run it with:
 *
 *   npx vite-node spikes/progression/measure-xp.ts
 *
 * It answers the one thing the progression plan must MEASURE, not invent
 * (brief §1): with today's §2.8 constants, what does a real headless match pay
 * a player in accrual events — ore gathered, ore deposited, structures built,
 * ship upgrades bought, core repairs, waves survived, placement — and what does
 * that convert to in XP under candidate weight sets?
 *
 * It reuses the shipped QA harness (harness/match.ts) UNMODIFIED, exactly as the
 * s1 variable-slots spike does. The harness hands every tick to an `onTick`
 * hook and hands back the finished `World`; this spike observes per-player
 * accrual by DIFFING world state each tick — because the sim tracks no
 * per-player counters (only the match-wide ore ledger, `src/sim/ore-ledger.ts`).
 *
 * The one thing it CANNOT observe: who killed whom. `killShip`/`damageShip`
 * (`src/sim/damage.ts`) take no attacker, and `main.ts:1390` says so outright —
 * "the sim tracks no killer." So kills are reported as a match-wide ship-death
 * count (measurable) and split across players as an ESTIMATE, flagged as needing
 * a sim attribution hook before kill-XP can be per-player real. See the doc §1.
 *
 * Everything is seeded and deterministic; re-running prints the same numbers.
 */

import { ShipClass, UpgradeTrack } from '../../src/shared/types';
import { REPAIR_HP_PER_ORE } from '../../src/sim/constants';
import type { World } from '../../src/sim';
import { runMatch, seedRange, mirrorLineup, roundRobinLineup, type SlotSpec } from '../../harness/match';
import type { StrategyId } from '../../harness/strategies';

// ---------------------------------------------------------------------------
// Per-player accrual, observed by diffing the world each tick
// ---------------------------------------------------------------------------

interface Accrual {
  gathered: number;      // Σ positive Δ ship.cargo  — ore mined + scavenged into the hold
  deposited: number;     // Σ positive Δ ship.banked — ore banked (atmosphere drain / BANK)
  structures: number;    // distinct build-job ids seen — every turret/shield ORDER
  upgrades: number;      // Σ positive Δ (sum of ship.tiers) — ship upgrade tiers bought
  repairs: number;       // Σ positive Δ planet.coreHp / 15 — discrete core repairs
  wavesSurvived: number; // world.match.wavesSpawned at elimination (or final, if survived)
  survivedSeconds: number;
  survived: boolean;
  placement: number;     // 1 = winner, 2 = runner-up, … (from elimination order)
}

interface Observer {
  prevCargo: number[];
  prevBanked: number[];
  prevTiers: number[];
  prevCore: number[];
  prevAlive: boolean[];
  buildIds: Set<number>[];
  acc: Accrual[];
}

const sumTiers = (tiers: Record<UpgradeTrack, number>): number =>
  (Object.values(tiers) as number[]).reduce((a, b) => a + b, 0);

function makeObserver(world: World): Observer {
  const n = world.ships.length;
  const blank = (): Accrual => ({
    gathered: 0, deposited: 0, structures: 0, upgrades: 0, repairs: 0,
    wavesSurvived: 0, survivedSeconds: 0, survived: true, placement: 0,
  });
  return {
    prevCargo: world.ships.map((s) => s.cargo),
    prevBanked: world.ships.map((s) => s.banked),
    prevTiers: world.ships.map((s) => sumTiers(s.tiers)),
    prevCore: world.planets.map((p) => p.coreHp),
    prevAlive: world.planets.map((p) => p.alive),
    buildIds: Array.from({ length: n }, () => new Set<number>()),
    acc: Array.from({ length: n }, blank),
  };
}

/** Called after every step. Accumulates the per-player deltas. */
function observe(o: Observer, world: World): void {
  world.ships.forEach((s, i) => {
    const a = o.acc[i]!;
    const dCargo = s.cargo - o.prevCargo[i]!;
    if (dCargo > 0) a.gathered += dCargo;
    const dBank = s.banked - o.prevBanked[i]!;
    if (dBank > 0) a.deposited += dBank;
    const t = sumTiers(s.tiers);
    const dT = t - o.prevTiers[i]!;
    if (dT > 0) a.upgrades += dT;
    o.prevCargo[i] = s.cargo;
    o.prevBanked[i] = s.banked;
    o.prevTiers[i] = t;
  });
  // Planets are index-aligned to ships in a dense FFA roster (owner === id === i).
  world.planets.forEach((p, i) => {
    const a = o.acc[i];
    if (!a) return;
    const dCore = p.coreHp - o.prevCore[i]!;
    if (dCore > 0) a.repairs += dCore / REPAIR_HP_PER_ORE;
    for (const b of p.builds) o.buildIds[i]!.add(b.id);
    // Capture waves-survived the instant a core dies.
    if (o.prevAlive[i] && !p.alive) a.wavesSurvived = world.match.wavesSpawned;
    o.prevCore[i] = p.coreHp;
    o.prevAlive[i] = p.alive;
  });
}

/** Finalize once the match is over: structures, placement, survival. */
function finalize(o: Observer, world: World): Accrual[] {
  const elimOrder = world.match.eliminated; // first death = worst placement
  const n = world.ships.length;
  world.planets.forEach((p, i) => {
    const a = o.acc[i];
    if (!a) return;
    a.structures = o.buildIds[i]!.size;
    a.survived = p.alive;
    a.survivedSeconds = p.alive ? world.time : p.deathTime;
    if (p.alive) a.wavesSurvived = world.match.wavesSpawned;
    // Placement: winner is 1. Eliminated players rank by REVERSE death order
    // (last to die = best among the dead). elimOrder[0] is the first out.
    if (p.alive) {
      a.placement = 1;
    } else {
      const deathRank = elimOrder.indexOf(p.owner); // 0 = first out
      a.placement = n - deathRank; // first out → n, last out → 2 (winner takes 1)
    }
  });
  return o.acc.slice(0, n);
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

interface MatchAccrual {
  accruals: Accrual[];
  shipDeaths: number; // match-wide ship deaths (unattributed) — the kill proxy
  seconds: number;
  winner: number | null;
}

function runOne(lineup: readonly SlotSpec[], seed: number): MatchAccrual {
  let observer: Observer | null = null;
  let shipDeaths = 0;
  let prevShipAlive: boolean[] | null = null;
  const result = runMatch(
    { seed, lineup },
    {
      onTick: (world) => {
        if (!observer) observer = makeObserver(world);
        // Count ship deaths (alive → not alive) as the match-wide kill proxy.
        if (prevShipAlive) {
          world.ships.forEach((s, i) => {
            if (prevShipAlive![i] && !s.alive) shipDeaths++;
          });
        }
        prevShipAlive = world.ships.map((s) => s.alive);
        observe(observer, world);
      },
    },
  );
  const world = result.world;
  const accruals = observer ? finalize(observer, world) : [];
  return { accruals, shipDeaths, seconds: result.seconds, winner: result.winner };
}

// ---------------------------------------------------------------------------
// Weight sets — XP per unit of each accrual event
// ---------------------------------------------------------------------------

interface Weights {
  name: string;
  gathered: number;   // per ore
  deposited: number;  // per ore
  structures: number; // per turret/shield ordered
  upgrades: number;   // per ship-upgrade tier
  repairs: number;    // per core repair
  kill: number;       // per estimated kill
  waveSurvived: number; // per wave survived
  win: number;        // flat, winner only
  placeStep: number;  // per placement rung above last (n - placement)
}

const WEIGHT_SETS: Weights[] = [
  // A — Economy-forward: the triangle's mine/build side pays; kills a bonus.
  { name: 'A economy', gathered: 1, deposited: 2, structures: 12, upgrades: 20, repairs: 3, kill: 25, waveSurvived: 15, win: 200, placeStep: 20 },
  // B — Combat-forward: kills and survival dominate; economy a trickle.
  { name: 'B combat', gathered: 0.4, deposited: 1, structures: 8, upgrades: 12, repairs: 2, kill: 60, waveSurvived: 25, win: 300, placeStep: 30 },
  // C — Participation-flat: everyone leaves with something; small spread.
  { name: 'C flat', gathered: 1, deposited: 1.5, structures: 10, upgrades: 15, repairs: 4, kill: 20, waveSurvived: 30, win: 120, placeStep: 12 },
];

function xpOf(a: Accrual, estKills: number, w: Weights, n: number): number {
  return Math.round(
    a.gathered * w.gathered +
    a.deposited * w.deposited +
    a.structures * w.structures +
    a.upgrades * w.upgrades +
    a.repairs * w.repairs +
    estKills * w.kill +
    a.wavesSurvived * w.waveSurvived +
    (a.survived ? w.win : 0) +
    (n - a.placement) * w.placeStep,
  );
}

// ---------------------------------------------------------------------------
// Reporting helpers
// ---------------------------------------------------------------------------

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const f1 = (x: number): string => x.toFixed(1);
const pad = (s: string | number, w: number): string => String(s).padStart(w);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const SEEDS = seedRange(24, 1);

// Three representative 8-player lobbies (harness strategies stand in for the
// shipped bot trees, exactly as the netcode + variable-slots spikes do).
const MIX: readonly { strategy: StrategyId; shipClass: ShipClass }[] = [
  { strategy: 'miner', shipClass: ShipClass.Excavator },
  { strategy: 'turtle', shipClass: ShipClass.Hauler },
  { strategy: 'rusher', shipClass: ShipClass.Interceptor },
  { strategy: 'raider', shipClass: ShipClass.Vanguard },
];

const LOBBIES: { name: string; make: (seed: number) => SlotSpec[] }[] = [
  { name: 'mirror miner (passive)', make: () => mirrorLineup('miner', ShipClass.Excavator) },
  { name: 'mirror turtle (builder)', make: () => mirrorLineup('turtle', ShipClass.Hauler) },
  { name: 'mirror raider (aggressive)', make: () => mirrorLineup('raider', ShipClass.Vanguard) },
  { name: 'round-robin mix (lobby-like)', make: (seed) => roundRobinLineup(MIX, seed % MIX.length) },
];

interface Row {
  lobby: string;
  all: Accrual[];
  estKillsPer: number;
  seconds: number[];
}

const rows: Row[] = [];

for (const lobby of LOBBIES) {
  const all: Accrual[] = [];
  const seconds: number[] = [];
  let totalDeaths = 0;
  let players = 0;
  for (const seed of SEEDS) {
    const m = runOne(lobby.make(seed), seed);
    all.push(...m.accruals);
    seconds.push(m.seconds);
    totalDeaths += m.shipDeaths;
    players += m.accruals.length;
  }
  rows.push({ lobby: lobby.name, all, estKillsPer: totalDeaths / players, seconds });
}

console.log('\n=== PROGRESSION XP MEASUREMENT (spike s4) ===');
console.log(`seeds ${SEEDS[0]}..${SEEDS[SEEDS.length - 1]}, N=8, octagon, shipped §2.8 constants\n`);

// Per-lobby accrual medians (one row = one player's whole match).
console.log('Per-player accrual per match (median over all player-matches):');
console.log(
  ['lobby', 'gathered', 'deposit', 'struct', 'upgr', 'repair', 'waves', 'estKill', 'secs'].map((h, i) => pad(h, i === 0 ? 28 : 8)).join(''),
);
for (const r of rows) {
  console.log(
    pad(r.lobby, 28) +
      pad(f1(median(r.all.map((a) => a.gathered))), 8) +
      pad(f1(median(r.all.map((a) => a.deposited))), 8) +
      pad(f1(median(r.all.map((a) => a.structures))), 8) +
      pad(f1(median(r.all.map((a) => a.upgrades))), 8) +
      pad(f1(median(r.all.map((a) => a.repairs))), 8) +
      pad(f1(median(r.all.map((a) => a.wavesSurvived))), 8) +
      pad(f1(r.estKillsPer), 8) +
      pad(Math.round(median(r.seconds)), 8),
  );
}

// Means too — medians hide the build/repair tail (passive probes rarely build,
// so their median is 0 while a turtle's mean is not).
console.log('\nPer-player accrual per match (MEAN over all player-matches):');
console.log(
  ['lobby', 'gathered', 'deposit', 'struct', 'upgr', 'repair', 'waves'].map((h, i) => pad(h, i === 0 ? 28 : 9)).join(''),
);
for (const r of rows) {
  console.log(
    pad(r.lobby, 28) +
      pad(f1(mean(r.all.map((a) => a.gathered))), 9) +
      pad(f1(mean(r.all.map((a) => a.deposited))), 9) +
      pad(f1(mean(r.all.map((a) => a.structures))), 9) +
      pad(f1(mean(r.all.map((a) => a.upgrades))), 9) +
      pad(f1(mean(r.all.map((a) => a.repairs))), 9) +
      pad(f1(mean(r.all.map((a) => a.wavesSurvived))), 9),
  );
}

// XP under each weight set — median player, winner, and first-out.
for (const w of WEIGHT_SETS) {
  console.log(`\nXP per match — weight set "${w.name}"  (median / winner-median / first-out-median):`);
  console.log(['lobby', 'median', 'winner', 'firstOut', 'spread'].map((h, i) => pad(h, i === 0 ? 28 : 10)).join(''));
  for (const r of rows) {
    const n = 8;
    const xps = r.all.map((a) => xpOf(a, r.estKillsPer, w, n));
    const winners = r.all.filter((a) => a.placement === 1).map((a) => xpOf(a, r.estKillsPer, w, n));
    const firstOut = r.all.filter((a) => a.placement === n).map((a) => xpOf(a, r.estKillsPer, w, n));
    const med = median(xps);
    const win = median(winners);
    const lose = median(firstOut);
    console.log(
      pad(r.lobby, 28) +
        pad(Math.round(med), 10) +
        pad(Math.round(win), 10) +
        pad(Math.round(lose), 10) +
        pad(win && lose ? `${(win / Math.max(1, lose)).toFixed(1)}x` : '-', 10),
    );
  }
}

// Grand median XP across all lobbies (the "typical match pays" anchor).
for (const w of WEIGHT_SETS) {
  const allXp = rows.flatMap((r) => r.all.map((a) => xpOf(a, r.estKillsPer, w, 8)));
  console.log(`\n"${w.name}": typical match pays median ${Math.round(median(allXp))} XP, mean ${Math.round(mean(allXp))} XP (all player-matches).`);
}

// ---------------------------------------------------------------------------
// Level curve — early levels fast, pace tunable by one exponent + base
// ---------------------------------------------------------------------------

/** XP required to go FROM level L TO L+1. Early levels cheap; smooth ramp. */
function xpToNext(level: number, base: number, exp: number): number {
  return Math.round(base * Math.pow(level, exp));
}
function cumulativeToReach(level: number, base: number, exp: number): number {
  let sum = 0;
  for (let l = 1; l < level; l++) sum += xpToNext(l, base, exp);
  return sum;
}

console.log('\n=== LEVEL CURVE (early-fast, one base + one exponent, both TUNABLE) ===');
const BASE = 300;
const EXP = 1.6;
console.log(`xpToNext(L) = ${BASE} · L^${EXP}\n`);
console.log(['level', 'toNext', 'cumTotal', '@600XP/match'].map((h, i) => pad(h, i === 0 ? 8 : 14)).join(''));
// Anchor "matches to reach" on the grand median of weight set C (steady middle).
const anchorXp = 600;
for (const L of [2, 3, 4, 5, 6, 8, 10, 15, 20]) {
  const cum = cumulativeToReach(L, BASE, EXP);
  console.log(pad(L, 8) + pad(xpToNext(L - 1, BASE, EXP), 14) + pad(cum, 14) + pad(f1(cum / anchorXp), 14));
}
console.log('\n(@600XP/match = cumulative matches to reach that level at ~600 XP/match.)');
console.log('done.\n');
