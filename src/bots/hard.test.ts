/**
 * src/bots/hard.test.ts — the Hard tier's scoring function (GDD §2.9).
 *
 * > **Hard** … evaluates targets by *threat, proximity, and opportunity* — it
 * > punishes whoever it can profitably punish (the miner far from home, the
 * > planet whose alarm went unanswered, the wreck nobody is guarding).
 *
 * Each named term gets a test that moves *only* that term and asserts it moved
 * the score the right way, and then one test asserts the sentence as a whole:
 * given a wounded rival caught in the open and a healthy one sitting on its own
 * turrets, a Hard bot goes for the one it can profitably punish.
 *
 * The fog tests are the important ones. A scoring function is exactly where a
 * bot would cheat if it were going to — "this core is at 12%, go" — so two of
 * these assert the opposite: an unscouted core's *real* HP does not move the
 * score by a single float, and a target that cannot be hurt is worth nothing.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import { SPAWN_PROTECTION_S, createWorld, type World } from '../sim';
import { perceive } from './perception';
import type { PerceivedPlanet, PerceivedShip } from './perception';
import { PERSONALITIES } from './personalities';
import { bestTarget, scorePlanet, scoreShip } from './targeting';
import { context, createBrain } from './tree';
import type { BotCtx } from './tree';

/** Four homes, no rocks, and none of the opening-seconds special cases: no
 *  spawn protection, no match-start alarm, and the clock past the protected
 *  window so cores are crackable. */
function board(): World {
  const world = createWorld({
    seed: 9,
    players: [
      { id: 0, shipClass: ShipClass.Vanguard },
      { id: 1, shipClass: ShipClass.Vanguard },
      { id: 2, shipClass: ShipClass.Vanguard },
      { id: 3, shipClass: ShipClass.Vanguard },
    ],
    bounds: { width: 4000, height: 4000 },
    asteroidCount: 0,
  });
  world.time = SPAWN_PROTECTION_S + 5;
  for (const ship of world.ships) ship.spawnProtect = 0;
  for (const planet of world.planets) {
    planet.spawnProtect = 0;
    planet.sinceDamage = 999;
  }
  return world;
}

/** A Hard bot's decision context over this board. Sable by default — the
 *  opportunist raider, whose weights lean hardest on the term under test. */
function ctxOf(world: World, id = 0, personality: keyof typeof PERSONALITIES = 'sable'): BotCtx {
  const brain = createBrain(PERSONALITIES[personality], { next: () => 0.5 });
  return context(perceive(world, id), brain);
}

/** The perceived rival with this slot id, which must be in view. */
function seen(ctx: BotCtx, id: number): PerceivedShip {
  const ship = ctx.view.ships.find((s) => s.id === id);
  expect(ship, `slot ${id} should be in view`).toBeDefined();
  return ship!;
}

/** The perceived home of this slot. */
function home(ctx: BotCtx, owner: number): PerceivedPlanet {
  const planet = ctx.view.planets.find((p) => p.owner === owner);
  expect(planet, `planet ${owner} should be in view`).toBeDefined();
  return planet!;
}

describe('Hard — proximity', () => {
  it('prefers the target it can reach: nearer scores higher, all else equal', () => {
    const world = board();
    world.ships[0]!.pos = { x: 2000, y: 2000 };
    // Two identical rivals on the same bearing, one twice as far out.
    world.ships[1]!.pos = { x: 2200, y: 2000 };
    world.ships[2]!.pos = { x: 2600, y: 2000 };
    for (const ship of world.ships) ship.hull = ship.maxHull;

    const ctx = ctxOf(world);
    const near = scoreShip(ctx, seen(ctx, 1));
    const far = scoreShip(ctx, seen(ctx, 2));

    expect(near.proximity).toBeGreaterThan(far.proximity);
    expect(near.score).toBeGreaterThan(far.score);
  });
});

describe('Hard — opportunity', () => {
  it('reads the hull bar: a wounded rival is a better target than a fresh one', () => {
    const world = board();
    world.ships[0]!.pos = { x: 2000, y: 2000 };
    world.ships[1]!.pos = { x: 2200, y: 2000 };
    world.ships[2]!.pos = { x: 2000, y: 2200 };
    world.ships[1]!.hull = world.ships[1]!.maxHull * 0.15;
    world.ships[2]!.hull = world.ships[2]!.maxHull;

    const ctx = ctxOf(world);
    expect(scoreShip(ctx, seen(ctx, 1)).opportunity).toBeGreaterThan(
      scoreShip(ctx, seen(ctx, 2)).opportunity,
    );
  });

  it('punishes the miner far from home — the sentence, as arithmetic', () => {
    const world = board();
    world.ships[0]!.pos = { x: 2000, y: 2000 };

    // The rival sits in one place for both readings, 200 units off the bot's
    // nose — so proximity, hull and class are pinned and the *only* thing that
    // moves is how far it is from its own front door. Where that door is is
    // public knowledge at any range (GDD §2.2 — the beacon ring).
    const rival = world.ships[1]!;
    const theirHome = world.planets.find((p) => p.owner === 1)!;
    rival.pos = { x: 2200, y: 2000 };

    theirHome.pos = { x: 2240, y: 2000 }; // parked on its own doorstep
    const atHome = scoreShip(ctxOf(world), seen(ctxOf(world), 1)).opportunity;

    theirHome.pos = { x: 2200, y: 1300 }; // caught in the open, a long trip out
    const inTheOpen = scoreShip(ctxOf(world), seen(ctxOf(world), 1)).opportunity;

    expect(inTheOpen).toBeGreaterThan(atHome);
  });

  it('is worth nothing to shoot something that cannot be hurt', () => {
    const world = board();
    world.ships[0]!.pos = { x: 2000, y: 2000 };
    world.ships[1]!.pos = { x: 2150, y: 2000 };
    world.ships[1]!.spawnProtect = SPAWN_PROTECTION_S;

    const ctx = ctxOf(world);
    const scored = scoreShip(ctx, seen(ctx, 1));
    expect(scored.opportunity).toBe(0);
    expect(scored.score).toBe(0);
    expect(bestTarget(ctx, 0)).toBeNull();
  });
});

describe('Hard — threat', () => {
  it("rises for a rival that is over this bot's own house", () => {
    const world = board();
    const myHome = world.planets.find((p) => p.owner === 0)!.pos;
    world.ships[0]!.pos = { x: myHome.x + 200, y: myHome.y };

    // On the doorstep…
    world.ships[1]!.pos = { x: myHome.x + 90, y: myHome.y };
    const atMyHouse = scoreShip(ctxOf(world), seen(ctxOf(world), 1)).threat;

    // …and the same rival, the same distance from the bot, pointing away.
    world.ships[1]!.pos = { x: myHome.x + 400, y: myHome.y };
    const outThere = scoreShip(ctxOf(world), seen(ctxOf(world), 1)).threat;

    expect(atMyHouse).toBeGreaterThan(outThere);
  });

  it('rises for a lit beam — the loudest tell in the game (GDD §2.2)', () => {
    const world = board();
    world.ships[0]!.pos = { x: 2000, y: 2000 };
    world.ships[1]!.pos = { x: 2200, y: 2000 };

    const quiet = scoreShip(ctxOf(world), seen(ctxOf(world), 1)).threat;
    world.ships[1]!.beam = { origin: { x: 0, y: 0 }, dir: { x: 1, y: 0 }, hitPoint: null, length: 260 };
    const firing = scoreShip(ctxOf(world), seen(ctxOf(world), 1)).threat;

    expect(firing).toBeGreaterThan(quiet);
  });
});

describe('Hard — the fog holds inside the scoring function', () => {
  it('scores an unscouted home identically whatever its core is really at', () => {
    const world = board();
    const target = world.planets.find((p) => p.owner === 2)!;
    // Well outside sensor range: the damage ring is not drawn (GDD §2.2).
    world.ships[0]!.pos = { x: target.pos.x + 700, y: target.pos.y };

    const healthy = scorePlanet(ctxOf(world), home(ctxOf(world), 2));
    target.coreHp = 3; // one beam-second from dead, and invisible from here
    const dying = scorePlanet(ctxOf(world), home(ctxOf(world), 2));

    expect(dying).toEqual(healthy);
  });

  it('acts on it the moment it has been scouted — which is the trip', () => {
    const world = board();
    const target = world.planets.find((p) => p.owner === 2)!;
    target.coreHp = target.maxCoreHp * 0.15;

    // Parked on the surface: inside sensor range, so the ring is readable.
    world.ships[0]!.pos = { x: target.pos.x + target.radius + 40, y: target.pos.y };
    const scouted = scorePlanet(ctxOf(world), home(ctxOf(world), 2));

    // The same wounded core, seen from outside sensor range.
    world.ships[0]!.pos = { x: target.pos.x + 700, y: target.pos.y };
    const rumour = scorePlanet(ctxOf(world), home(ctxOf(world), 2));

    expect(scouted.opportunity).toBeGreaterThan(rumour.opportunity);
  });

  it('never offers a wreck as a target — there is no core left to kill', () => {
    const world = board();
    const dead = world.planets.find((p) => p.owner === 2)!;
    world.ships[0]!.pos = { x: dead.pos.x + 200, y: dead.pos.y };
    dead.alive = false;
    dead.coreHp = 0;
    // Everyone else out of the picture.
    for (const ship of world.ships) if (ship.id !== 0) ship.alive = false;

    const ctx = ctxOf(world);
    expect(scorePlanet(ctx, home(ctx, 2)).score).toBe(0);
    expect(bestTarget(ctx, 0)?.id).not.toBe(2);
  });
});

describe('Hard — the sentence, executed', () => {
  it('takes the wounded rival in the open over the healthy one on its turrets', () => {
    const world = board();
    world.ships[0]!.pos = { x: 2000, y: 2000 };

    // The punishable one: hurt, and a long way from its own front door.
    world.ships[1]!.pos = { x: 2250, y: 2000 };
    world.ships[1]!.hull = world.ships[1]!.maxHull * 0.2;

    // The one to leave alone: whole, and sitting on its own planet.
    const theirHome = world.planets.find((p) => p.owner === 3)!.pos;
    world.ships[3]!.pos = { x: theirHome.x + 30, y: theirHome.y };
    world.ships[3]!.hull = world.ships[3]!.maxHull;
    world.ships[2]!.alive = false;

    const ctx = ctxOf(world);
    const target = bestTarget(ctx, 0);
    expect(target).not.toBeNull();
    expect(target!.kind).toBe('ship');
    expect(target!.id).toBe(1);
  });

  it('gives two Hard characters different answers on the same board', () => {
    const world = board();
    const myHome = world.planets.find((p) => p.owner === 0)!.pos;
    world.ships[0]!.pos = { x: myHome.x + 150, y: myHome.y };

    // One rival loitering over this bot's own house (threat), one wounded and
    // exposed on the far side of the field (opportunity).
    world.ships[1]!.pos = { x: myHome.x + 260, y: myHome.y };
    world.ships[1]!.hull = world.ships[1]!.maxHull;
    world.ships[2]!.pos = { x: myHome.x + 600, y: myHome.y + 200 };
    world.ships[2]!.hull = world.ships[2]!.maxHull * 0.15;
    world.ships[3]!.alive = false;

    // Warden's homebody 1.0 leans on threat; Sable's opportunism 0.9 leans on
    // opportunity. Same tree, same board, different rival goes down.
    expect(bestTarget(ctxOf(world, 0, 'warden'), 0)?.id).toBe(1);
    expect(bestTarget(ctxOf(world, 0, 'sable'), 0)?.id).toBe(2);
  });
});
