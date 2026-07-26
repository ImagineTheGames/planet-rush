/**
 * tests/sim/turret-parity.test.ts — the PARITY PRINCIPLE, as a registry-driven
 * test. OWNER: Gameplay Engineer (parity field report v0.2.2; GDD §2.9, §2.5).
 *
 * The field report — *"enemies have laser turrets, I have no way to build them"*
 * — is, at root, a parity claim: a thing on the field the player cannot field
 * back. The sim's answer (GDD §2.9) is structural: **bots file the same orders a
 * human does.** A bot builds a turret through `placeOrder('turret')`; so does the
 * player. A bot climbs the turret ladder through the same order on a full ring;
 * so does the player. There is no order verb, and no capability behind one, that
 * a bot can reach and a player cannot — because both speak the one ratified
 * vocabulary: `BuildItem` and `UpgradeTrack`.
 *
 * This suite makes that a *contract with teeth*. The catalogues below are
 * **exhaustive `Record`s over the shared unions**, so the day someone adds a new
 * buildable/upgradable — a new `BuildItem`, a new `UpgradeTrack`, a new turret Mk
 * — this test fails to COMPILE until a player order path is registered for it. A
 * bot-only capability cannot slip in: it has nowhere to hide from an exhaustive
 * map, and every entry in that map is proven to be player-producible at runtime.
 * The next bot-only capability fails CI here, by construction.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass, UpgradeTrack } from '@shared/types';
import type { BuildItem } from '@shared/types';
import {
  CORE_HP,
  TICK_DT,
  TURRET,
  TURRET_MAX_TIER,
  buyUpgrade,
  createWorld,
  damagePlanet,
  isDocked,
  placeOrder,
  planetOf,
  shipOf,
  step,
  turretTier,
  turretUpgradeTarget,
  type Planet,
  type Ship,
  type World,
} from '../../src/sim';

// --- fixtures --------------------------------------------------------------

const LOCAL = 0;
const ENEMY = 1;
const players = [
  { id: LOCAL, shipClass: ShipClass.Vanguard },
  { id: ENEMY, shipClass: ShipClass.Vanguard },
];

interface Ctx {
  world: World;
  ship: Ship;
  planet: Planet;
}

/** A docked, well-funded player at a live planet — the state in which every
 *  wheel order is legal, so a refusal here means the *path* is broken, not the
 *  setup. Each `who` gets its own isolated fixture. */
function dockedPlayer(who: number): Ctx {
  const world = createWorld({ seed: 3, players, asteroidCount: 0 });
  world.asteroids = [];
  const ship = shipOf(world, who)!;
  const planet = planetOf(world, who)!;
  ship.spawnProtect = 0;
  planet.spawnProtect = 0;
  ship.cargo = 0;
  ship.banked = 9999;
  expect(isDocked(ship, planet)).toBe(true);
  return { world, ship, planet };
}

// ---------------------------------------------------------------------------
// The registry: every fieldable capability ↦ the player order path that yields it
// ---------------------------------------------------------------------------
//
// These are exhaustive over the ratified unions. Add a member to `BuildItem` or
// `UpgradeTrack` in `@shared/types` and this file stops compiling until the new
// capability is given a player path below — which is the whole point.

/** A player order path that MUST produce its capability from a valid setup.
 *  Returns nothing; it asserts `'ok'` (or the capability's presence) itself. */
type PlayerPath = (ctx: Ctx) => void;

/** Every Build & Upgrade wheel order, and the player path that fields it. */
const BUILD_PATHS: Record<BuildItem, PlayerPath> = {
  // The field report's subject: the player builds a turret with the SAME call a
  // bot uses. (Its tier ladder gets its own reachability sweep below.)
  turret: ({ world, ship }) => expect(placeOrder(world, ship, 'turret')).toBe('ok'),
  shield: ({ world, ship }) => expect(placeOrder(world, ship, 'shield')).toBe('ok'),
  repair: ({ world, ship, planet }) => {
    damagePlanet(world, planet, 10); // a channel needs a wound to close
    expect(placeOrder(world, ship, 'repair')).toBe('ok');
  },
  bank: ({ world, ship }) => {
    ship.cargo = 1; // a deposit needs something in the hold
    expect(placeOrder(world, ship, 'bank')).toBe('ok');
  },
};

/** Every ship-upgrade track, and the player path that buys it. */
const UPGRADE_PATHS: Record<UpgradeTrack, PlayerPath> = {
  [UpgradeTrack.Power]: ({ world, ship }) => expect(buyUpgrade(world, ship, UpgradeTrack.Power)).toBe('ok'),
  [UpgradeTrack.Speed]: ({ world, ship }) => expect(buyUpgrade(world, ship, UpgradeTrack.Speed)).toBe('ok'),
  [UpgradeTrack.Engine]: ({ world, ship }) => expect(buyUpgrade(world, ship, UpgradeTrack.Engine)).toBe('ok'),
  [UpgradeTrack.Cargo]: ({ world, ship }) => expect(buyUpgrade(world, ship, UpgradeTrack.Cargo)).toBe('ok'),
  [UpgradeTrack.Hull]: ({ world, ship }) => expect(buyUpgrade(world, ship, UpgradeTrack.Hull)).toBe('ok'),
};

// ---------------------------------------------------------------------------
// The parity assertions
// ---------------------------------------------------------------------------

describe('parity — every wheel order a bot can file, a player can file', () => {
  it('produces every BuildItem through a player order path', () => {
    for (const item of Object.keys(BUILD_PATHS) as BuildItem[]) {
      BUILD_PATHS[item](dockedPlayer(LOCAL));
    }
  });

  it('buys every ship-upgrade track through a player order path', () => {
    for (const track of Object.keys(UPGRADE_PATHS) as UpgradeTrack[]) {
      UPGRADE_PATHS[track](dockedPlayer(LOCAL));
    }
  });
});

describe('parity — the turret tier ladder is reachable end to end by a player', () => {
  it('a player can climb the whole ring through the top of the ladder', () => {
    const { world, ship, planet } = dockedPlayer(LOCAL);

    // Fill the ring the real way, so the TURRET wedge flips to its upgrade state.
    for (let i = 0; i < TURRET.capPerPlanet; i++) expect(placeOrder(world, ship, 'turret')).toBe('ok');
    const cap = Math.ceil(TURRET.buildTime / TICK_DT) + 2;
    for (let t = 0; t < cap && planet.turrets.length < TURRET.capPerPlanet; t++) step(world, []);
    expect(planet.turrets.length).toBe(TURRET.capPerPlanet);

    // Keep filing the SAME 'turret' order until the ladder is exhausted. The
    // upgrade targets the weakest turret first (breadth before depth), so the
    // ring climbs Mk by Mk; every step is exactly +1 (`applyTurretTier`), so
    // reaching the top means every intermediate tier was occupied on the way.
    let guard = 0;
    let orders = 0;
    while (turretUpgradeTarget(planet) !== null) {
      expect(placeOrder(world, ship, 'turret')).toBe('ok');
      orders++;
      expect(guard++).toBeLessThan(200); // the ladder is finite — this must halt
    }
    // The whole ring reached the top of whatever ladder is configured, in exactly
    // one order per Mk per turret.
    expect(planet.turrets.every((t) => turretTier(t) === TURRET_MAX_TIER)).toBe(true);
    expect(orders).toBe(TURRET.capPerPlanet * TURRET_MAX_TIER);
    expect(placeOrder(world, ship, 'turret')).toBe('cap-reached'); // nothing left to field
  });
});

describe('parity — the enemy fields nothing through an order the player cannot', () => {
  it('the same placeOrder that arms the enemy arms the player, identically', () => {
    // The literal field-report scenario: a bot enemy builds a "laser turret".
    const enemy = dockedPlayer(ENEMY);
    expect(placeOrder(enemy.world, enemy.ship, 'turret')).toBe('ok');
    expect(enemy.planet.builds.some((b) => b.kind === 'turret')).toBe(true);

    // The player builds the very same hardware, through the very same call — the
    // one order interface both a human and a bot file through (GDD §2.9).
    const local = dockedPlayer(LOCAL);
    expect(placeOrder(local.world, local.ship, 'turret')).toBe('ok');
    expect(local.planet.builds.some((b) => b.kind === 'turret')).toBe(true);
  });

  it('a naked, un-upgraded core is exactly CORE_HP — the fixture is honest', () => {
    // A guard that the parity setups are not accidentally trivial: the planet the
    // orders act on is a real, full-health home, not a pre-broken stub.
    expect(dockedPlayer(LOCAL).planet.coreHp).toBe(CORE_HP);
  });
});
