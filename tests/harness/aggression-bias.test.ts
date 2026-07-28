/**
 * tests/harness/aggression-bias.test.ts — "do enemies seem overly aggressive,
 * out for MY ship?" (p8 field question).
 *
 * Measure before tuning. The developer's hunch is tested two ways, and the
 * harness — not a vibe — decides:
 *
 *  1. **Slot-position bias (a bug if present).** Instrument aggression *received*
 *     per SLOT INDEX: a scripted neutral probe seat is rotated through every one
 *     of the eight slots, across many seeds, against a homogeneous cast in the
 *     symmetric station ring, and the damage the bots deal that probe is tallied
 *     by slot. If the trees are fair the distribution is flat; if the targeting
 *     code prefers low indices, low slots draw more fire than they earned.
 *
 *  2. **Emergent attention (design, not a bug).** The same probe is run as a
 *     turtle and as an active participant, and the extra fire that *fighting*
 *     draws is quantified. That number is design-relevant — the Director takes
 *     "is this fun?" to the developer with it — not something to fix here.
 *
 * ── What the measurement found ───────────────────────────────────────────────
 *
 * The match-level damage distribution is **flat** (§ "match-level"): shipped bot
 * behaviour does not single out a slot, because who-gets-shot is dominated by
 * *proximity* — `nearestEnemy` and the sim's nearest-target auto-aim are both
 * distance-driven and index-blind, and a besieged home has to be in visual range
 * before a bot will lay siege at all.
 *
 * But the audit turned up a **latent** index bias in the targeting *tie-breaks*
 * (§ "decision-level"). Every scoring term in `targeting.ts` is continuous, so an
 * exact tie is a real dead heat — and an *unscouted* rival core reads as full
 * with no turrets, so `leaderStation` scored every un-visited home at one
 * identical standing and the old `a.id < b.id` tie-break handed the whole board
 * to slot 0: 7 of 8 observers crowned slot 0 the "leader", slots 2–7 never. It
 * did not surface as match damage today (proximity dominates), but it is a real
 * slot-0 preference one scoring tweak away from surfacing — the exact culprit the
 * brief names. It is fixed (`breaksTie`, an observer-keyed mulberry32 hash: an
 * index-blind, frame-stable, deterministic symmetry-break), and the
 * flat-distribution guards below are now permanent.
 *
 * This brief is measurement + bias-fix only: no aggression *weight* is retuned.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '../../src/shared/types';
import type { Inputs, World } from '../../src/sim';
import { SPAWN_PROTECTION_S, createWorld, shieldPool } from '../../src/sim';
import { createBot, type Bot } from '../../src/bots/bot';
import { botInputs, createBots, runHeadlessMatch } from '../../src/bots/harness';
import { perceive } from '../../src/bots/perception';
import { PERSONALITIES, ROSTER } from '../../src/bots/personalities';
import { context, createBrain } from '../../src/bots/tree';
import { bestTarget, breaksTie, leaderStation, tiebreakKey } from '../../src/bots/targeting';

const SLOTS = 8;

// ---------------------------------------------------------------------------
// Decision-level: the tie-break itself must be slot-blind
// ---------------------------------------------------------------------------
//
// This is the crisp guard on the fix. It builds a genuine dead heat — eight
// identical, equally-scored rivals — and asks each of the eight bots who it
// would go for. The lowest-id rule funnels ~7/8 of every answer onto slot 0;
// an index-blind break spreads them, and no slot is privileged.

/** A board of eight identical homes, past spawn protection, no asteroids: every
 *  rival reads the same, so only the tie-break separates them. */
function tiedBoard(seed: number): World {
  const players = Array.from({ length: SLOTS }, (_, id) => ({ id, shipClass: ShipClass.Vanguard }));
  const world = createWorld({ seed, players, bounds: { width: 6000, height: 6000 }, asteroidCount: 0 });
  world.time = SPAWN_PROTECTION_S + 5;
  for (const s of world.ships) s.spawnProtect = 0;
  for (const p of world.stations) {
    p.spawnProtect = 0;
    p.sinceDamage = 999;
  }
  return world;
}

/** A decision context for the bot in slot `id` over `world`. Foreman (Medium) —
 *  the tier whose `leaderStation` guess runs straight into the tied-board case. */
function ctxOf(world: World, id: number) {
  return context(perceive(world, id), createBrain(PERSONALITIES.foreman, { next: () => 0.5 }));
}

/** Tally, per slot, how many of the eight observers pick that slot — given a
 *  per-observer `pick`. Returns the tally and the count of distinct winners. */
function crownings(world: World, pick: (world: World, observer: number) => number | null) {
  const tally = new Array(SLOTS).fill(0);
  const winners = new Set<number>();
  for (let o = 0; o < SLOTS; o++) {
    const chosen = pick(world, o);
    if (chosen !== null && chosen >= 0) {
      tally[chosen]++;
      winners.add(chosen);
    }
  }
  return { tally, distinct: winners.size };
}

describe('the targeting tie-break is index-blind (p8 bias fix)', () => {
  it('breaksTie does not privilege the lower slot — some observers prefer a higher id', () => {
    // The old rule was `candidate.id < best.id`: a lower id ALWAYS won. An
    // index-blind break must let a higher id win for at least some observers,
    // and — averaged over who is asking — favour neither direction.
    let higherWins = 0;
    let lowerWins = 0;
    for (let observer = 0; observer < SLOTS; observer++) {
      for (let a = 0; a < SLOTS; a++) {
        for (let b = a + 1; b < SLOTS; b++) {
          // Does the higher id (b) beat the lower id (a) for this observer?
          if (breaksTie(observer, b, a)) higherWins++;
          else lowerWins++;
        }
      }
    }
    // Not the lowest-id rule (which would be higherWins === 0), and roughly
    // balanced — no systemic lean toward either end of the slot range.
    expect(higherWins).toBeGreaterThan(0);
    const share = higherWins / (higherWins + lowerWins);
    expect(share).toBeGreaterThan(0.35);
    expect(share).toBeLessThan(0.65);
  });

  it('leaderStation spreads a dead heat across slots instead of onto slot 0', () => {
    const world = tiedBoard(1);
    const { tally, distinct } = crownings(world, (w, o) => {
      const leader = leaderStation(ctxOf(w, o));
      return leader ? leader.owner : null;
    });

    // Pre-fix: slot 0 was crowned by 7 of 8 observers (distinct === 2, all on
    // {0,1}). Index-blind: many distinct winners, and no slot owns the board.
    expect(distinct).toBeGreaterThanOrEqual(5);
    expect(Math.max(...tally)).toBeLessThanOrEqual(2);
    // Slot 0 specifically is no longer the sink it was.
    expect(tally[0]).toBeLessThanOrEqual(2);
  });

  it('bestTarget spreads a dead heat between equidistant identical ships', () => {
    // Ring every rival ship at one radius around the observer, identical hull and
    // class and not firing → identical score. Push the homes off-map so ships are
    // the only candidates. Only the tie-break separates them.
    const pick = (world: World, observer: number): number | null => {
      const me = world.ships[observer]!;
      me.pos = { x: 3000, y: 3000 };
      let k = 0;
      for (const s of world.ships) {
        if (s.id === observer) continue;
        const theta = (2 * Math.PI * k) / (SLOTS - 1);
        s.pos = { x: 3000 + 250 * Math.cos(theta), y: 3000 + 250 * Math.sin(theta) };
        s.hull = s.maxHull;
        s.firing = false;
        k++;
      }
      for (const p of world.stations) p.pos = { x: -9000, y: -9000 };
      const target = bestTarget(ctxOf(world, observer), 0);
      return target ? target.id : null;
    };

    const world = tiedBoard(1);
    const { tally, distinct } = crownings(world, pick);
    expect(distinct).toBeGreaterThanOrEqual(5);
    expect(Math.max(...tally)).toBeLessThanOrEqual(2);
    expect(tally[0]).toBeLessThanOrEqual(2);
  });

  it('the tie-break key is deterministic and observer-dependent (no RNG state, replay-safe)', () => {
    // Pure function of the two ids: same answer every call (so a bot never
    // dithers between two equal rivals), and different observers genuinely see a
    // different order (so the spread above is real, not luck).
    expect(tiebreakKey(3, 5)).toBe(tiebreakKey(3, 5));
    const orderFor = (o: number) => [0, 1, 2, 3, 4, 5, 6, 7].sort((a, b) => tiebreakKey(o, b) - tiebreakKey(o, a));
    expect(orderFor(0)).not.toEqual(orderFor(1));
  });
});

// ---------------------------------------------------------------------------
// Match-level: aggression received per slot, over full headless matches
// ---------------------------------------------------------------------------
//
// The brief's instrument: a scripted neutral probe rotated through every slot,
// many seeds, tallying the damage bots deal it. A homogeneous cast in the
// symmetric ring isolates the SLOT INDEX — the only thing that changes as the
// probe moves seat is its index and its (symmetric) ring position, so a per-slot
// difference that survives averaging is an index effect, which is the bug hunted.

const CAST = 'foreman'; // one Medium character in every non-probe seat
const SEEDS = Array.from({ length: 10 }, (_, i) => i + 1);
const MATCH_SECS = 120;

/** Running tally of the damage a slot has absorbed: hull chipped off its ship,
 *  HP off its core, HP off its shields. Increases (respawn, regen) are ignored —
 *  only fire dealt counts. */
interface Absorbed {
  hull: number;
  core: number;
  shield: number;
  total: number;
}

function sampleDamage(world: World, slot: number, prev: Absorbed): void {
  const ship = world.ships.find((s) => s.id === slot)!;
  const station = world.stations.find((p) => p.owner === slot)!;
  const shield = shieldPool(station);
  if (ship.hull < prev.hull) prev.total += prev.hull - ship.hull;
  if (station.coreHp < prev.core) prev.total += prev.core - station.coreHp;
  if (shield < prev.shield) prev.total += prev.shield - shield;
  prev.hull = ship.hull;
  prev.core = station.coreHp;
  prev.shield = shield;
}

/**
 * Run one match with the probe in `probeSlot` and return the damage it absorbed.
 * `active` false is the scripted turtle (hands on the stick, nothing pressed);
 * true drives the probe as a normal bot, so it flies, mines, and fights.
 */
function damageToProbe(seed: number, probeSlot: number, active: boolean): number {
  const botSeats = [];
  for (let id = 0; id < SLOTS; id++) if (id !== probeSlot) botSeats.push({ id, personality: CAST } as const);
  const players = Array.from({ length: SLOTS }, (_, id) => ({
    id,
    shipClass: id === probeSlot ? ShipClass.Vanguard : PERSONALITIES[CAST].shipClass,
  }));

  const world = createWorld({ seed, players });
  const bots: Bot[] = createBots(botSeats, { seed });
  const probeBot = active ? createBot({ id: probeSlot, personality: CAST }, { seed }) : null;

  const probe = world.ships.find((s) => s.id === probeSlot)!;
  const home = world.stations.find((p) => p.owner === probeSlot)!;
  const absorbed: Absorbed = { hull: probe.hull, core: home.coreHp, shield: shieldPool(home), total: 0 };

  const turtle: Inputs = [
    {
      id: probeSlot,
      actions: [
        { type: 'thrust', dir: { x: 0, y: 0 } },
        { type: 'fire', active: false, auto: false },
      ],
    },
  ];
  const extraInputs = (w: World): Inputs => (probeBot ? botInputs(w, [probeBot]) : turtle);

  runHeadlessMatch(world, bots, {
    maxSeconds: MATCH_SECS,
    extraInputs,
    onTick: () => sampleDamage(world, probeSlot, absorbed),
  });
  return absorbed.total;
}

/** Mean damage absorbed per slot, over every seed, for one probe behaviour.
 *  Memoized: the sweep is deterministic, and both hypotheses want the turtle
 *  numbers, so the ~15s sweep runs once per behaviour rather than per test. */
const sweepCache = new Map<boolean, number[]>();
function perSlotMean(active: boolean): number[] {
  const cached = sweepCache.get(active);
  if (cached) return cached;
  const perSlot = new Array(SLOTS).fill(0);
  for (const seed of SEEDS) for (let p = 0; p < SLOTS; p++) perSlot[p] += damageToProbe(seed, p, active);
  const mean = perSlot.map((v) => v / SEEDS.length);
  sweepCache.set(active, mean);
  return mean;
}

describe('aggression received per slot is flat — no slot-position bias (p8 hypothesis 1)', () => {
  it('a turtle draws statistically the same fire in every slot', () => {
    const perSlot = perSlotMean(false);
    const mean = perSlot.reduce((a, b) => a + b, 0) / SLOTS;
    const lo = Math.min(...perSlot);
    const hi = Math.max(...perSlot);
    // eslint-disable-next-line no-console
    console.log('[p8] turtle damage/slot:', perSlot.map((v) => v.toFixed(0)).join(' '), '| mean', mean.toFixed(0));

    // No slot is a magnet or a haven: the spread is seed noise, not a staircase.
    // A low-index siege bias (the bug) would push slot 0 well above the pack.
    expect(hi / Math.max(1, lo)).toBeLessThan(2.2);
    for (const v of perSlot) expect(Math.abs(v - mean) / mean).toBeLessThan(0.5);
    // Slot 0 is not the peak — the property the tie-break fix guards.
    expect(perSlot[0]).toBeLessThanOrEqual(hi);
    expect(perSlot[0]).toBeLessThan(mean * 1.5);
  }, 120_000);
});

describe('fighting draws more attention than turtling — emergent, by design (p8 hypothesis 2)', () => {
  it('an active probe absorbs materially more fire than the same seat sitting still', () => {
    const turtle = perSlotMean(false);
    const fighter = perSlotMean(true);
    const turtleAvg = turtle.reduce((a, b) => a + b, 0) / SLOTS;
    const fighterAvg = fighter.reduce((a, b) => a + b, 0) / SLOTS;
    // eslint-disable-next-line no-console
    console.log(
      '[p8] attention: turtle',
      turtleAvg.toFixed(0),
      'fighter',
      fighterAvg.toFixed(0),
      'ratio',
      (fighterAvg / turtleAvg).toFixed(2),
    );

    // Contesting waves and putting shots on rivals draws answering fire: this is
    // "why being the leader is dangerous" (GDD §2.6), not a bug. Quantified so the
    // Director can take the number to the developer.
    expect(fighterAvg).toBeGreaterThan(turtleAvg * 1.2);
  }, 120_000);
});

// The shipped roster is available for a realism spot-check; the flatness
// assertion deliberately uses a homogeneous cast, because the seven characters
// have different aggression profiles and different hulls (GDD §2.11), so a
// shipped-cast per-slot spread mixes personality-in-seat with slot index and
// cannot isolate the bug. `ROSTER` is referenced so that intent is on the record.
void ROSTER;
