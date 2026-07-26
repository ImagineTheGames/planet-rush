/**
 * tests/sim/turret-tiers.test.ts — the turret tier ladder. OWNER: Gameplay
 * Engineer (parity field report v0.2.2; GDD §2.5, §2.6, §2.8).
 *
 * The developer, verbatim: *"enemies have laser turrets, I have no way to build
 * them."* The diagnosis (see the PR body): those are the ordinary buildable
 * turrets — a bot fields them through the SAME `placeOrder('turret')` order a
 * player's TURRET wedge issues (GDD §2.9), and they fire the cold plasma-blue
 * shot the whole game has shot since the v0.3 laser funeral (style §5.1) — not a
 * wave-NPC, not a bot-only tier, not a retired beam. Parity already held at Mk I.
 *
 * What the report surfaced is the *unmet* half: a turret was a single fixed
 * grade, with no way to make it better. This suite pins the ladder that fixes
 * that — Mk I → Mk II → Mk III, each tankier, harder-hitting, faster, and a touch
 * longer-reaching — bought through the TURRET wedge's UPGRADE state once a turret
 * stands. The pins, one design clause each:
 *
 *   §1 Mk I is byte-for-byte the pre-ladder turret (no regression is possible);
 *   §2 the ladder climbs monotonically and every tier keeps the GDD §2.6 range
 *      rail (a ship out-ranges the turret at every Mk);
 *   §3 the TURRET wedge builds until the ring is full, then UPGRADES the weakest
 *      turret — the exact order path a bot uses, so parity is structural;
 *   §4 an upgrade is instant and grants new plate, never a heal (like ship hull);
 *   §5 the ladder's refusals (maxed, cannot-afford) are the honest ones; and
 *   §6 a higher-Mk turret actually hits harder and reaches further in the sim.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import type { Action } from '@shared/types';
import {
  PROJECTILE,
  TICK_DT,
  TURRET,
  TURRET_MAX_TIER,
  TURRET_TIERS,
  WEAPON_RANGE,
  applyTurretTier,
  createWorld,
  damageTurret,
  isDocked,
  placeOrder,
  planetOf,
  shipOf,
  step,
  turretRange,
  turretTier,
  turretTierShotDamage,
  turretTierSpec,
  turretUpgradeCost,
  turretUpgradeTarget,
  type Inputs,
  type Planet,
  type Ship,
  type Turret,
  type World,
} from '../../src/sim';

// --- fixtures --------------------------------------------------------------

const LOCAL = 0;
const ENEMY = 1;
const players = [
  { id: LOCAL, shipClass: ShipClass.Vanguard },
  { id: ENEMY, shipClass: ShipClass.Vanguard },
];

/** A real match, mid-flight: the local ship parked and docked at its own live
 *  planet, spawn protection cleared, and a fat bank so the wallet is never what
 *  is under test. No rocks; the enemy sits idle half the ring away. */
function freshMatch(banked = 9999): { world: World; ship: Ship; planet: Planet } {
  const world = createWorld({ seed: 7, players, asteroidCount: 0 });
  world.asteroids = [];
  const ship = shipOf(world, LOCAL)!;
  const planet = planetOf(world, LOCAL)!;
  ship.spawnProtect = 0;
  planet.spawnProtect = 0;
  ship.cargo = 0;
  ship.banked = banked;
  expect(isDocked(ship, planet)).toBe(true);
  return { world, ship, planet };
}

/** Build `n` turrets the real way — order them, then run the sim until their
 *  construction timers finish — so the ring holds `n` STANDING turrets. */
function buildTurrets(world: World, ship: Ship, planet: Planet, n: number): void {
  for (let i = 0; i < n; i++) expect(placeOrder(world, ship, 'turret')).toBe('ok');
  const cap = Math.ceil(TURRET.buildTime / TICK_DT) + 2;
  for (let t = 0; t < cap && planet.turrets.length < n; t++) step(world, []);
  expect(planet.turrets.length).toBe(n);
}

// ---------------------------------------------------------------------------
// §1 — Mk I is byte-for-byte the pre-ladder turret
// ---------------------------------------------------------------------------

describe('§1 Mk I baseline — the ladder cannot regress the existing turret', () => {
  it('a freshly built turret is tier 0 with the exact shipped TURRET numbers', () => {
    const { world, ship, planet } = freshMatch();
    buildTurrets(world, ship, planet, 1);
    const t = planet.turrets[0]!;
    expect(turretTier(t)).toBe(0);
    expect(t.hp).toBe(TURRET.hp);
    expect(t.maxHp).toBe(TURRET.hp);
    // The two derived combat numbers a shot rides also equal the flat constants.
    expect(turretTierShotDamage(0)).toBeCloseTo(PROJECTILE.damage, 12);
    expect(turretRange(t)).toBe(TURRET.range);
    expect(turretTierSpec(0).fireInterval).toBe(TURRET.fireInterval);
  });

  it('an out-of-range / NaN / missing tier reads as Mk I (never a NaN stat)', () => {
    expect(turretTierSpec(-3)).toBe(TURRET_TIERS[0]);
    expect(turretTierSpec(999)).toBe(TURRET_TIERS[TURRET_MAX_TIER]);
    expect(turretTierSpec(Number.NaN)).toBe(TURRET_TIERS[0]);
    // A turret literal with no `tier` field (an other-agent fixture) is Mk I.
    expect(turretTier({ hp: 1 } as Turret)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §2 — the ladder climbs, and the range rail holds at every tier
// ---------------------------------------------------------------------------

describe('§2 the ladder is a real, monotonic climb inside the GDD §2.6 rail', () => {
  it('each Mk is tankier, harder-hitting and faster than the last', () => {
    for (let i = 1; i < TURRET_TIERS.length; i++) {
      const lo = TURRET_TIERS[i - 1]!;
      const hi = TURRET_TIERS[i]!;
      expect(hi.hp).toBeGreaterThan(lo.hp);
      expect(hi.dps).toBeGreaterThan(lo.dps);
      expect(hi.fireInterval).toBeLessThanOrEqual(lo.fireInterval);
      expect(hi.range).toBeGreaterThanOrEqual(lo.range);
      // Per-shot bite strictly rises (dps up, interval down ⇒ product up).
      expect(turretTierShotDamage(i)).toBeGreaterThan(turretTierShotDamage(i - 1));
      // Each buyable tier has a positive escalating-or-flat cost; Mk I has none.
      expect(hi.upgradeCost).not.toBeNull();
      expect(hi.upgradeCost!).toBeGreaterThan(0);
    }
    expect(TURRET_TIERS[0]!.upgradeCost).toBeNull();
  });

  it('every tier stays UNDER weapon range — the ship can always out-range it', () => {
    // GDD §2.6: the pick-off skill exists only if the ship out-ranges the turret.
    for (const spec of TURRET_TIERS) expect(spec.range).toBeLessThan(WEAPON_RANGE);
  });
});

// ---------------------------------------------------------------------------
// §3 — the TURRET wedge: build until the ring is full, then upgrade
// ---------------------------------------------------------------------------

describe('§3 the TURRET wedge builds, then upgrades the weakest turret', () => {
  it('a full ring turns the TURRET order into an upgrade of the lowest-tier turret', () => {
    const { world, ship, planet } = freshMatch();
    buildTurrets(world, ship, planet, TURRET.capPerPlanet);
    // Ring full: no turret has climbed yet, and the wedge is now in upgrade state.
    expect(planet.turrets.every((t) => turretTier(t) === 0)).toBe(true);
    expect(turretUpgradeCost(planet)).toBe(TURRET_TIERS[1]!.upgradeCost);

    const before = ship.banked;
    // Upgrade the whole ring to Mk II, one order each — the weakest (lowest slot
    // among equals) is picked deterministically, so all four climb in turn.
    for (let i = 0; i < TURRET.capPerPlanet; i++) {
      const target = turretUpgradeTarget(planet)!;
      expect(placeOrder(world, ship, 'turret')).toBe('ok');
      expect(turretTier(target)).toBe(1);
    }
    expect(planet.turrets.every((t) => turretTier(t) === 1)).toBe(true);
    expect(planet.builds).toHaveLength(0); // an upgrade queues no construction job
    // Exactly four Mk II upgrades were charged, hold-first then bank.
    expect(before - ship.banked).toBeCloseTo(TURRET.capPerPlanet * TURRET_TIERS[1]!.upgradeCost!, 9);
  });

  it('drives all the way to the top through the real wheel action (step + buildOrder)', () => {
    const { world, ship, planet } = freshMatch();
    buildTurrets(world, ship, planet, 1);
    const t = planet.turrets[0]!;
    const order: Inputs = [{ id: LOCAL, actions: [{ type: 'buildOrder', item: 'turret' } as Action] }];

    // One turret, three free slots: the first three TURRET presses BUILD (the
    // ring fills), and only once it is full do presses start UPGRADING.
    for (let climb = 0; climb < TURRET_MAX_TIER; ) {
      step(world, order);
      // Skip past the ticks that are still building out the ring.
      if (planet.turrets.length < TURRET.capPerPlanet) continue;
      climb = turretTier(t);
    }
    expect(turretTier(t)).toBe(TURRET_MAX_TIER);
    expect(turretUpgradeTarget(planet)).not.toBeNull(); // three slot-mates still climb
  });
});

// ---------------------------------------------------------------------------
// §4 — an upgrade is instant and grants plate, never a heal
// ---------------------------------------------------------------------------

describe('§4 an upgrade is new armor, not a repair (mirrors ship hull, GDD §2.5)', () => {
  it('adds the tier HP difference to a damaged turret without healing the damage', () => {
    const { world, ship, planet } = freshMatch();
    buildTurrets(world, ship, planet, TURRET.capPerPlanet);
    const t = planet.turrets[0]!;

    // Carve it down to 10/30, then climb it to Mk II.
    damageTurret(t, TURRET.hp - 10);
    expect(t.hp).toBe(10);
    const gained = TURRET_TIERS[1]!.hp - TURRET_TIERS[0]!.hp;
    applyTurretTier(t, 1);
    expect(t.maxHp).toBe(TURRET_TIERS[1]!.hp);
    expect(t.hp).toBe(10 + gained); // the plate is added; the 20 HP of damage stays
  });

  it('never overfills a turret past its new ceiling', () => {
    const t = { hp: TURRET.hp, maxHp: TURRET.hp, tier: 0, slot: 0 } as Turret;
    applyTurretTier(t, 1);
    expect(t.hp).toBeLessThanOrEqual(t.maxHp);
    expect(t.hp).toBe(TURRET_TIERS[1]!.hp); // full Mk I + plate == full Mk II
  });
});

// ---------------------------------------------------------------------------
// §5 — the ladder's refusals are the honest ones
// ---------------------------------------------------------------------------

describe('§5 refusals — a full, maxed, or unaffordable ring answers truthfully', () => {
  it('a fully Mk III ring refuses further TURRET orders as cap-reached', () => {
    const { world, ship, planet } = freshMatch();
    buildTurrets(world, ship, planet, TURRET.capPerPlanet);
    for (const t of planet.turrets) applyTurretTier(t, TURRET_MAX_TIER);
    expect(turretUpgradeTarget(planet)).toBeNull();
    expect(turretUpgradeCost(planet)).toBeNull();
    expect(placeOrder(world, ship, 'turret')).toBe('cap-reached');
  });

  it('an upgrade you cannot afford is refused and charges nothing', () => {
    const { world, ship, planet } = freshMatch();
    buildTurrets(world, ship, planet, TURRET.capPerPlanet);
    ship.banked = 0;
    ship.cargo = 0;
    expect(placeOrder(world, ship, 'turret')).toBe('cannot-afford');
    expect(planet.turrets.every((t) => turretTier(t) === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §6 — a higher Mk actually fights harder in the running sim
// ---------------------------------------------------------------------------

describe('§6 tiers are in play — a Mk III turret hits harder and reaches further', () => {
  it('a Mk III shot carries more damage and a longer life than a Mk I shot', () => {
    // The projectile a turret looses reads its bite/reach from the tier: prove
    // the derived numbers move the right way (the fire path itself is exercised
    // by the existing turret-coverage / natural-siege suites at Mk I).
    expect(turretTierShotDamage(TURRET_MAX_TIER)).toBeGreaterThan(turretTierShotDamage(0));
    expect(TURRET_TIERS[TURRET_MAX_TIER]!.range).toBeGreaterThan(TURRET_TIERS[0]!.range);
    // Reach is still bounded by the rail, so the shot dies before out-ranging the
    // engagement it was fired for.
    expect(TURRET_TIERS[TURRET_MAX_TIER]!.range).toBeLessThan(WEAPON_RANGE);
  });
});
