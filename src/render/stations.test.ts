/**
 * Station render tests (GDD §2.1, §2.2, §2.5, §2.7). The eight homes are the
 * thing M2 is about, and three of their properties are contracts rather than
 * decoration:
 *
 *  1. **Every slot's home is drawn**, and the layer is *pooled* — a second frame
 *     must not grow the tree (GDD §4.3: zero per-frame allocation).
 *  2. **Health is always drawn.** Every station's damage ring reads true at every
 *     range, own or rival (GDD §2.2, amended 2026-08-07 — a0-05). It used to be
 *     gated on sensor range, and that gate is what the developer reported as a
 *     glitch: out of range the ring vanished and the owner-colour beacon ring
 *     under it made a wounded home look untouched.
 *  3. **A wreck stays on the map** and reads as one (GDD §2.7).
 *
 * Headless, like the muzzle tests: Pixi builds Graphics geometry with no WebGL, so
 * the assertions are about the container tree the renderer maintains.
 */
import { describe, it, expect } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { ShipClass } from '@shared/types';
import { Renderer } from './index';
import { createWorld, damageStation, placeOrder } from '../sim';
import type { World } from '../sim';

const VIEW = { width: 800, height: 600, originX: 0, originY: 0 };

/**
 * A window big enough to contain the whole arena, so nothing is culled.
 *
 * Since a1-12 the renderer submits only what is on screen, which makes "is this
 * drawn?" two questions instead of one: *is the rule right* (fog, ownership,
 * wreck persistence) and *is it in the window*. The cases below are about the
 * first, so they are shot through a window where the second is never in play —
 * `./cull.test.ts` owns the second and nothing else asserts it here.
 *
 * The default arena is 2400×2400 (`sim/maps.ts`), and the camera centres the
 * target ship, so 6000 clears it from any spawn.
 */
const ARENA_VIEW = { width: 6000, height: 6000, originX: 0, originY: 0 };

function arena(slots = 8): World {
  return createWorld({
    seed: 7,
    players: Array.from({ length: slots }, (_, id) => ({ id, shipClass: ShipClass.Vanguard })),
  });
}

function stationLayer(stage: Container): Container {
  const layer = stage.getChildByLabel('stations', true);
  if (!layer) throw new Error('stations layer missing');
  return layer as Container;
}

/** Whether a labelled Graphics has any geometry this frame. `clear()` empties
 *  the instruction list, so "nothing was drawn" is exactly zero instructions. */
function drewSomething(stage: Container, label: string): boolean {
  return instructionCount(stage, label) > 0;
}

/** How many draw instructions a labelled Graphics holds this frame — the p11
 *  gauge adds one segment (the red fill) on top of the owner-colour base. */
function instructionCount(stage: Container, label: string): number {
  const node = stage.getChildByLabel(label, true);
  if (!node) return 0;
  return (node as Graphics).context.instructions.length;
}

describe('stations are on screen at all (the M2 integration gap)', () => {
  it('draws a body for every slot in an eight-station ring', () => {
    const stage = new Container();
    const r = new Renderer(stage, ARENA_VIEW);
    const world = arena();

    r.draw(world, { cameraTarget: 0, muzzles: [] });

    for (let i = 0; i < 8; i++) {
      expect(drewSomething(stage, `station-${i}`)).toBe(true);
    }
  });

  it('is pooled: a second frame reuses the same children', () => {
    const stage = new Container();
    const r = new Renderer(stage, VIEW);
    const world = arena();

    r.draw(world, { cameraTarget: 0, muzzles: [] });
    const after = stationLayer(stage).children.length;
    r.draw(world, { cameraTarget: 0, muzzles: [] });
    r.draw(world, { cameraTarget: 0, muzzles: [] });

    expect(stationLayer(stage).children.length).toBe(after);
  });

  it('puts each body at its station\'s world position', () => {
    const stage = new Container();
    const r = new Renderer(stage, ARENA_VIEW);
    const world = arena();

    r.draw(world, { cameraTarget: 0, muzzles: [] });

    const body = stage.getChildByLabel('station-3', true) as Graphics;
    expect(body.x).toBe(world.stations[3]!.pos.x);
    expect(body.y).toBe(world.stations[3]!.pos.y);
  });
});

describe('station health is always visible (GDD §2.2, amended 2026-08-07)', () => {
  /** The retired `SENSOR_RANGE` — 2× the 90-unit shield radius. Written out
   *  rather than imported, because the constant is gone and the point of these
   *  cases is that the number no longer does anything. */
  const RETIRED_SENSOR_RANGE = 180;

  it('shows a wounded rival from across the map — the frame that was lying', () => {
    const stage = new Container();
    const r = new Renderer(stage, ARENA_VIEW);
    const world = arena();
    const rival = world.stations[4]!;
    rival.spawnProtect = 0;
    damageStation(world, rival, 40);

    // Viewer parked at its own home, half the map away — far outside the radius
    // that used to blank this ring entirely.
    const viewer = world.ships[0]!;
    expect(Math.hypot(rival.pos.x - viewer.pos.x, rival.pos.y - viewer.pos.y)).toBeGreaterThan(
      RETIRED_SENSOR_RANGE,
    );
    r.draw(world, { cameraTarget: 0, muzzles: [] });
    expect(drewSomething(stage, 'station-overlay-4')).toBe(true);
  });

  it('reads the same near and far — same ring, same fill', () => {
    const stage = new Container();
    const r = new Renderer(stage, ARENA_VIEW);
    const world = arena();
    const rival = world.stations[4]!;
    const healthy = world.stations[2]!;
    rival.spawnProtect = 0;
    damageStation(world, rival, 40);

    const viewer = world.ships[0]!;

    // Long range: the developer's complaint, the frame that used to lie.
    viewer.pos.x = rival.pos.x;
    viewer.pos.y = rival.pos.y - RETIRED_SENSOR_RANGE * 12;
    r.draw(world, { cameraTarget: 0, muzzles: [] });
    const far = instructionCount(stage, 'station-overlay-4');
    // …and, from that same eye, an undamaged home draws strictly less: the
    // wounded one carries the extra threat-red segment. Unknown state and healthy
    // state are no longer the same picture (LESSONS §20).
    expect(far).toBeGreaterThan(instructionCount(stage, 'station-overlay-2'));
    expect(healthy.coreHp).toBe(healthy.maxCoreHp);

    // Close range: byte-for-byte the same ring. The camera is translate-only, so
    // a world-unit ring is the same size on screen either way.
    viewer.pos.y = rival.pos.y - (RETIRED_SENSOR_RANGE + rival.radius) * 0.5;
    r.draw(world, { cameraTarget: 0, muzzles: [] });
    expect(instructionCount(stage, 'station-overlay-4')).toBe(far);
  });

  it('always shows your own home, at any distance', () => {
    const stage = new Container();
    const r = new Renderer(stage, ARENA_VIEW);
    const world = arena();
    const home = world.stations[0]!;
    home.spawnProtect = 0;
    damageStation(world, home, 30);
    // Deep in the field, nowhere near home — the alarm's whole scenario.
    world.ships[0]!.pos.x = world.bounds.width / 2;
    world.ships[0]!.pos.y = world.bounds.height / 2;

    r.draw(world, { cameraTarget: 0, muzzles: [] });

    expect(drewSomething(stage, 'station-overlay-0')).toBe(true);
  });

  it('rings an untouched core whole in the owner colour, filling red only once hurt (p11)', () => {
    const stage = new Container();
    const r = new Renderer(stage, VIEW);
    const world = arena();

    // Ratified p11: health is the owner's colour, whole — the base ring is always
    // drawn, and a full core carries no red. So an untouched own home shows its
    // ring (unlike the old grammar, where a full core drew nothing).
    r.draw(world, { cameraTarget: 0, muzzles: [] });
    const whole = instructionCount(stage, 'station-overlay-0');
    expect(whole).toBeGreaterThan(0);

    // Wound it: the red fill is an *added* segment over the same base ring, so
    // "how much is gone" grows on top of "your colour, whole".
    world.stations[0]!.spawnProtect = 0;
    damageStation(world, world.stations[0]!, 30);
    r.draw(world, { cameraTarget: 0, muzzles: [] });
    expect(instructionCount(stage, 'station-overlay-0')).toBeGreaterThan(whole);
  });
});

describe('the atmosphere halo is the deposit affordance (p4-12, GDD §2.3)', () => {
  const haloFor = (stage: Container, index: number): Graphics | null =>
    stage.getChildByLabel(`atmosphere-${index}`, true) as Graphics | null;

  it('rings your OWN home and no rival — the halo is where you can deposit', () => {
    const stage = new Container();
    const r = new Renderer(stage, VIEW);

    r.draw(arena(), { cameraTarget: 0, muzzles: [] });

    // Own station has a visible halo; every rival station has none drawn.
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
    const home = world.stations[0]!;
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

    expect(drewSomething(stage, 'station-overlay-0')).toBe(true);
    expect(world.stations[0]!.builds).toHaveLength(1);
  });
});

describe('a wreck stays on the map (GDD §2.7)', () => {
  it('redraws the body once the core is gone, and keeps drawing it', () => {
    const stage = new Container();
    const r = new Renderer(stage, ARENA_VIEW);
    const world = arena();
    const doomed = world.stations[2]!;

    r.draw(world, { cameraTarget: 0, muzzles: [] });
    const before = stationLayer(stage).children.length;

    doomed.spawnProtect = 0;
    damageStation(world, doomed, doomed.maxCoreHp);
    expect(doomed.alive).toBe(false);

    r.draw(world, { cameraTarget: 0, muzzles: [] });

    // Still drawn, still the same pooled child — the wreck does not leave.
    expect(drewSomething(stage, 'station-2')).toBe(true);
    expect(stationLayer(stage).children.length).toBe(before);
  });
});
