/**
 * Planet render tests (GDD §2.1, §2.2, §2.5, §2.7). The eight homes are the
 * thing M2 is about, and three of their properties are contracts rather than
 * decoration:
 *
 *  1. **Every slot's home is drawn**, and the layer is *pooled* — a second frame
 *     must not grow the tree (GDD §4.3: zero per-frame allocation).
 *  2. **Fog is drawn.** A rival's damage ring appears only from inside sensor
 *     range (GDD §2.2, "scouted, not broadcast"); your own home always shows.
 *  3. **A wreck stays on the map** and reads as one (GDD §2.7).
 *
 * Headless, like the muzzle tests: Pixi builds Graphics geometry with no WebGL, so
 * the assertions are about the container tree the renderer maintains.
 */
import { describe, it, expect } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { ShipClass } from '@shared/types';
import { Renderer } from './index';
import { createWorld, damagePlanet, placeOrder, SENSOR_RANGE } from '../sim';
import type { World } from '../sim';

const VIEW = { width: 800, height: 600, originX: 0, originY: 0 };

function arena(slots = 8): World {
  return createWorld({
    seed: 7,
    players: Array.from({ length: slots }, (_, id) => ({ id, shipClass: ShipClass.Vanguard })),
  });
}

function planetLayer(stage: Container): Container {
  const layer = stage.getChildByLabel('planets', true);
  if (!layer) throw new Error('planets layer missing');
  return layer as Container;
}

/** Whether a labelled Graphics has any geometry this frame. `clear()` empties
 *  the instruction list, so "nothing was drawn" is exactly zero instructions. */
function drewSomething(stage: Container, label: string): boolean {
  const node = stage.getChildByLabel(label, true);
  if (!node) return false;
  return (node as Graphics).context.instructions.length > 0;
}

describe('planets are on screen at all (the M2 integration gap)', () => {
  it('draws a body for every slot in an eight-planet ring', () => {
    const stage = new Container();
    const r = new Renderer(stage, VIEW);
    const world = arena();

    r.draw(world, { cameraTarget: 0, muzzles: [] });

    for (let i = 0; i < 8; i++) {
      expect(drewSomething(stage, `planet-${i}`)).toBe(true);
    }
  });

  it('is pooled: a second frame reuses the same children', () => {
    const stage = new Container();
    const r = new Renderer(stage, VIEW);
    const world = arena();

    r.draw(world, { cameraTarget: 0, muzzles: [] });
    const after = planetLayer(stage).children.length;
    r.draw(world, { cameraTarget: 0, muzzles: [] });
    r.draw(world, { cameraTarget: 0, muzzles: [] });

    expect(planetLayer(stage).children.length).toBe(after);
  });

  it('puts each body at its planet\'s world position', () => {
    const stage = new Container();
    const r = new Renderer(stage, VIEW);
    const world = arena();

    r.draw(world, { cameraTarget: 0, muzzles: [] });

    const body = stage.getChildByLabel('planet-3', true) as Graphics;
    expect(body.x).toBe(world.planets[3]!.pos.x);
    expect(body.y).toBe(world.planets[3]!.pos.y);
  });
});

describe('the damage ring is scouted, not broadcast (GDD §2.2)', () => {
  it('shows a wounded rival only from inside sensor range', () => {
    const stage = new Container();
    const r = new Renderer(stage, VIEW);
    const world = arena();
    const rival = world.planets[4]!;
    rival.spawnProtect = 0;
    damagePlanet(world, rival, 40);

    // Viewer parked at its own home, half the map away: nothing to read.
    r.draw(world, { cameraTarget: 0, muzzles: [] });
    expect(drewSomething(stage, 'planet-overlay-4')).toBe(false);

    // Fly to it — the ring is information you earn by scouting.
    const viewer = world.ships[0]!;
    viewer.pos.x = rival.pos.x;
    viewer.pos.y = rival.pos.y - (SENSOR_RANGE + rival.radius) * 0.5;
    r.draw(world, { cameraTarget: 0, muzzles: [] });
    expect(drewSomething(stage, 'planet-overlay-4')).toBe(true);
  });

  it('always shows your own home, at any distance', () => {
    const stage = new Container();
    const r = new Renderer(stage, VIEW);
    const world = arena();
    const home = world.planets[0]!;
    home.spawnProtect = 0;
    damagePlanet(world, home, 30);
    // Deep in the field, nowhere near home — the alarm's whole scenario.
    world.ships[0]!.pos.x = world.bounds.width / 2;
    world.ships[0]!.pos.y = world.bounds.height / 2;

    r.draw(world, { cameraTarget: 0, muzzles: [] });

    expect(drewSomething(stage, 'planet-overlay-0')).toBe(true);
  });

  it('draws no ring on an untouched core — a full core says nothing', () => {
    const stage = new Container();
    const r = new Renderer(stage, VIEW);

    r.draw(arena(), { cameraTarget: 0, muzzles: [] });

    expect(drewSomething(stage, 'planet-overlay-0')).toBe(false);
  });
});

describe('the atmosphere halo is the deposit affordance (p4-12, GDD §2.3)', () => {
  const haloFor = (stage: Container, index: number): Graphics | null =>
    stage.getChildByLabel(`atmosphere-${index}`, true) as Graphics | null;

  it('rings your OWN home and no rival — the halo is where you can deposit', () => {
    const stage = new Container();
    const r = new Renderer(stage, VIEW);

    r.draw(arena(), { cameraTarget: 0, muzzles: [] });

    // Own planet has a visible halo; every rival planet has none drawn.
    const own = haloFor(stage, 0);
    expect(own).not.toBeNull();
    expect(own!.visible).toBe(true);
    for (let i = 1; i < 8; i++) expect(haloFor(stage, i)).toBeNull();
  });

  it('is pooled: a second frame reuses the same halo child', () => {
    const stage = new Container();
    const r = new Renderer(stage, VIEW);
    const world = arena();

    r.draw(world, { cameraTarget: 0, muzzles: [] });
    const first = haloFor(stage, 0);
    const layer = stage.getChildByLabel('atmosphere', true) as Container;
    const before = layer.children.length;
    r.draw(world, { cameraTarget: 0, muzzles: [] });

    expect(haloFor(stage, 0)).toBe(first); // same instance, not rebuilt
    expect(layer.children.length).toBe(before);
  });

  it('brightens while ore is actually flowing home', () => {
    const stage = new Container();
    const r = new Renderer(stage, VIEW);
    const world = arena();
    const home = world.planets[0]!;
    const ship = world.ships[0]!;
    // Park the ship inside its own atmosphere so `world.time` is the only thing
    // differing between the two frames — the brighten must come from the cargo.
    ship.pos = { x: home.pos.x, y: home.pos.y };

    ship.cargo = 0;
    r.draw(world, { cameraTarget: 0, muzzles: [] });
    const idle = haloFor(stage, 0)!.alpha;

    ship.cargo = 5;
    r.draw(world, { cameraTarget: 0, muzzles: [] });
    const flowing = haloFor(stage, 0)!.alpha;

    expect(flowing).toBeGreaterThan(idle);
  });
});

describe('construction is visible (GDD §2.5)', () => {
  it('draws a progress arc while a turret assembles', () => {
    const stage = new Container();
    const r = new Renderer(stage, VIEW);
    const world = arena();
    expect(placeOrder(world, world.ships[0]!, 'turret')).toBe('ok');

    r.draw(world, { cameraTarget: 0, muzzles: [] });

    expect(drewSomething(stage, 'planet-overlay-0')).toBe(true);
    expect(world.planets[0]!.builds).toHaveLength(1);
  });
});

describe('a wreck stays on the map (GDD §2.7)', () => {
  it('redraws the body once the core is gone, and keeps drawing it', () => {
    const stage = new Container();
    const r = new Renderer(stage, VIEW);
    const world = arena();
    const doomed = world.planets[2]!;

    r.draw(world, { cameraTarget: 0, muzzles: [] });
    const before = planetLayer(stage).children.length;

    doomed.spawnProtect = 0;
    damagePlanet(world, doomed, doomed.maxCoreHp);
    expect(doomed.alive).toBe(false);

    r.draw(world, { cameraTarget: 0, muzzles: [] });

    // Still drawn, still the same pooled child — the wreck does not leave.
    expect(drewSomething(stage, 'planet-2')).toBe(true);
    expect(planetLayer(stage).children.length).toBe(before);
  });
});
