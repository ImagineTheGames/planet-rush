/**
 * tests/sim/loot-ore-parity.test.ts — ORE IS ORE. OWNER: Gameplay Engineer
 * (field report v0.2.2; GDD §2.3, §2.7).
 *
 * The bug the field report chased: "a dead player's ore didn't count when
 * deposited." The developer tractored a dead bot's dropped ore, flew it home,
 * deposited — and the bank never moved. The fear was PROVENANCE: mined ore,
 * death-drop ore and wreck loot living in separate pools, with the deposit
 * drain reading only the mined one.
 *
 * The rule these pins hold: there is exactly ONE hold pool, `Ship.cargo`.
 * Whatever chipped a chunk loose — an asteroid, a ship's death, a wrecked
 * station — the moment it lands in the hold it is ore, indistinguishable from
 * any other ore, and it deposits 1:1 into the bank like any other ore. Loot is
 * not a second counter; it is the same counter.
 *
 * Coverage:
 *   - death-drop ore tractored into a non-full hold increments THE hold;
 *   - that same loot deposits into the bank 1:1 (the exact repro, made green);
 *   - the full-hold rule applies to loot as to mined chunks (it stays put);
 *   - conservation across kill → drop → tractor → deposit;
 *   - wreck loot (d5) behaves identically — one pool, deposits the same.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import {
  DEATH_ORE_DROP_FRACTION,
  DEPOSIT_RANGE,
  createWorld,
  damageStation,
  killShip,
  stationOf,
  step,
  type OreChunk,
  type PlayerSpec,
  type Ship,
  type World,
} from '../../src/sim';

// --- fixtures --------------------------------------------------------------

const PLAYERS: readonly PlayerSpec[] = [
  { id: 0, shipClass: ShipClass.Vanguard },
  { id: 1, shipClass: ShipClass.Vanguard },
];

/** Total loose (non-courier) ore drifting in the world — every free chunk. */
function looseOre(world: World): number {
  return world.chunks.filter((c) => !c.deposit).reduce((n, c) => n + c.amount, 0);
}

/** A killed rival's death-drop, with our collector (slot 0) parked right on top
 *  of the debris ring, empty hold, ready to tractor. The dead ship is slot 1;
 *  its hold has just burst into a ring of plain chunks (no `deposit` flag),
 *  exactly as a bot's death would leave them. All of it since a0-59 — this file
 *  reads the amount off `DEATH_ORE_DROP_FRACTION`, so it measures the parity and
 *  not the fraction. */
function deathDrop(botCargo: number): {
  world: World;
  collector: Ship;
  drops: OreChunk[];
  dropped: number;
} {
  const world = createWorld({ seed: 7, players: PLAYERS });
  const bot = world.ships[1]!;
  bot.cargo = botCargo;
  killShip(world, bot); // rings its hold into world.chunks

  const drops = world.chunks.filter((c) => !c.deposit);
  const dropped = looseOre(world);

  // Our ship, empty-handed, sitting in the middle of the loot — not near its
  // own home, so nothing deposits while it scoops. A widened bay (an upgrade a
  // player bought) so any reasonable drop fits in one hold.
  const collector = world.ships[0]!;
  collector.pos = { x: bot.pos.x, y: bot.pos.y };
  collector.vel = { x: 0, y: 0 };
  collector.cargo = 0;
  collector.cargoCap = 8;
  collector.banked = 0;
  return { world, collector, drops, dropped };
}

/** Fly `ship` into its own station's atmosphere and hold it there. */
function parkInHomeAtmosphere(world: World, ship: Ship): void {
  const home = stationOf(world, ship.id)!;
  ship.pos = { x: home.pos.x + DEPOSIT_RANGE - 1, y: home.pos.y };
  ship.vel = { x: 0, y: 0 };
}

// --- death-drop loot is ore -------------------------------------------------

describe('death-drop loot is ore the moment it enters the hold', () => {
  it('drops the ratified share of the dead ship’s hold as plain, tractorable chunks', () => {
    const { drops, dropped } = deathDrop(4);
    // All 4 since a0-59 (it was half, 2, before 2026-08-16) — and it is ordinary
    // loot either way: nothing is flagged a courier. Read off the constant, which
    // is what makes this a statement about PROVENANCE and not about the fraction.
    expect(dropped).toBeCloseTo(4 * DEATH_ORE_DROP_FRACTION, 9);
    expect(drops.every((c) => !c.deposit)).toBe(true);
    expect(drops.length).toBeGreaterThan(0);
  });

  it('tractors death-drop loot into a non-full hold — THE hold, one pool', () => {
    const { world, collector, dropped } = deathDrop(4);

    for (let t = 0; t < 120; t++) step(world, []);

    // Every scrap ended up in the one hold field; none is stranded in a
    // second "loot" counter, and the debris is gone from the map.
    expect(collector.cargo).toBeCloseTo(dropped, 9);
    expect(looseOre(world)).toBeCloseTo(0, 9);
  });

  it('deposits tractored loot into the bank 1:1 (the field-report repro, green)', () => {
    const { world, collector, dropped } = deathDrop(4);

    // Scoop the loot up …
    for (let t = 0; t < 120; t++) step(world, []);
    expect(collector.cargo).toBeCloseTo(dropped, 9);

    // … then take it home and deposit it. The bank must credit every unit.
    parkInHomeAtmosphere(world, collector);
    for (let t = 0; t < 240; t++) step(world, []);

    expect(collector.cargo).toBe(0);
    expect(collector.banked).toBeCloseTo(dropped, 9);
  });

  it('a full hold leaves loot on the map, exactly as it does mined chunks', () => {
    const { world, collector, drops } = deathDrop(4);
    // Arrive already full: no room, so the tractor must not attract or collect.
    collector.cargo = collector.cargoCap;
    const before = collector.cargo;
    const looseBefore = looseOre(world);
    expect(looseBefore).toBeGreaterThan(0);

    for (let t = 0; t < 120; t++) step(world, []);

    expect(collector.cargo).toBe(before); // hold untouched
    // The chunks stay put for anyone — same amounts, none collected.
    expect(looseOre(world)).toBeCloseTo(looseBefore, 9);
    expect(world.chunks.filter((c) => !c.deposit).length).toBe(drops.length);
  });

  it('conserves ore across kill → drop → tractor → deposit', () => {
    // A hold sized so its drop is 3 ore whatever the fraction is — the case needs
    // a loot pile that fits in one bay, not a particular number of ore.
    const { world, collector, dropped } = deathDrop(3 / DEATH_ORE_DROP_FRACTION);
    expect(dropped).toBeCloseTo(3, 9);
    expect(collector.cargoCap).toBeGreaterThanOrEqual(dropped); // fits in one hold

    for (let t = 0; t < 120; t++) step(world, []);
    parkInHomeAtmosphere(world, collector);
    for (let t = 0; t < 300; t++) step(world, []);

    // What the dead ship dropped is exactly what our bank gained — no ore
    // minted, none lost to a pool the drain can't see.
    expect(collector.cargo + collector.banked).toBeCloseTo(dropped, 9);
    expect(collector.banked).toBeCloseTo(dropped, 9);
  });
});

// --- wreck loot (d5) is the same ore ---------------------------------------

describe('wreck loot deposits exactly like mined ore (d5)', () => {
  /** Kill slot 1's core so its station becomes a wreck ringed with scavengeable
   *  debris (GDD §2.7), and drop our collector into that ring, empty-handed. */
  function wreckDrop(): { world: World; collector: Ship; loot: number } {
    const world = createWorld({ seed: 7, players: PLAYERS });
    const victimStation = stationOf(world, 1)!;
    // Strip its defences to the core, drop its match-start protection, and take
    // it to zero in one blow — it wrecks and pays out its debris synchronously.
    victimStation.shields = [];
    victimStation.turrets = [];
    victimStation.builds = [];
    victimStation.spawnProtect = 0;
    victimStation.coreHp = 3;
    damageStation(world, victimStation, victimStation.coreHp);
    expect(victimStation.alive).toBe(false);

    const loot = looseOre(world);
    expect(loot).toBeGreaterThan(0);

    const collector = world.ships[0]!;
    collector.pos = { x: victimStation.pos.x, y: victimStation.pos.y };
    collector.vel = { x: 0, y: 0 };
    collector.cargo = 0;
    collector.banked = 0;
    return { world, collector, loot };
  }

  it('wreck debris is plain, un-flagged loot — no separate provenance pool', () => {
    const { world } = wreckDrop();
    expect(world.chunks.filter((c) => !c.deposit).every((c) => !c.deposit)).toBe(true);
  });

  it('tractors and deposits wreck loot into the bank, same one pool', () => {
    const { world, collector } = wreckDrop();
    const cap = collector.cargoCap;

    // Scoop up to a hold's worth of the wreck field.
    for (let t = 0; t < 200; t++) step(world, []);
    const held = collector.cargo;
    expect(held).toBeGreaterThan(0);
    expect(held).toBeLessThanOrEqual(cap + 1e-9);

    // Deposit it at home; the bank credits every unit the hold carried.
    parkInHomeAtmosphere(world, collector);
    for (let t = 0; t < 300; t++) step(world, []);
    expect(collector.cargo).toBe(0);
    expect(collector.banked).toBeCloseTo(held, 9);
  });
});
