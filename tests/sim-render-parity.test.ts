/**
 * tests/sim-render-parity.test.ts — you can only be blocked by what you can see.
 * OWNER: Platform Engineer.
 *
 * ── WHY THIS TEST IS PERMANENT ──────────────────────────────────────────────
 * A live build shipped an *invisible blocking volume*: a player flew into
 * something solid beside their station that the renderer never drew, with an
 * enemy just out of reach behind it. Root cause (agent/platform/m2-invisible-
 * blocker): the simulation clamps every ship inside `world.bounds` — the arena
 * wall is as solid as a station — but the render layer only *read* the bounds for
 * the camera and never drew them. The play-field edge was a wall you crash into
 * and cannot see. Stations are pinned right against that wall (`createWorld`
 * clamps them to `halfMin − radius`), so "the invisible thing beside my station"
 * was the undrawn boundary the station sits on.
 *
 * The class of bug is "you can hit what you cannot see", and it must never ship
 * again. This test is the guard, in two halves:
 *
 *  1. **Every collidable entity type the world can spawn** — ship, asteroid, ore
 *     chunk, station, turret, shield, turret projectile — is rendered as a
 *     *visible* display object whose drawn size is within 2× of its collision
 *     radius. A new collider added without a sprite (or drawn far smaller than it
 *     collides) fails here.
 *  2. **The arena boundary** — the wall the sim clamps ships against — is drawn.
 *     Removing its render (the exact regression that produced the report) fails
 *     here.
 *
 * Headless, like the other render tests (src/render/*.test.ts): Pixi builds
 * Graphics geometry with no WebGL, so the assertions read the container tree and
 * each node's local bounds — what the renderer actually put on stage.
 * ────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { ShipClass } from '@shared/types';
import { Renderer } from '@render/index';
import { RENDER_EXTENT, reachOf } from '@render/cull';
import { CHUNK, PROJECTILE, SHIELD, TURRET, createWorld, turretMountPos } from '../src/sim';
import type { OreChunk, Projectile, Shield, Turret, World } from '../src/sim';

/**
 * A window big enough to contain the whole arena, so nothing is culled.
 *
 * This suite asks a question about **entity types**: does every collidable family
 * the world can spawn get a visible display object of about the right size? Since
 * a1-12 the renderer submits only what the camera is showing (`src/render/cull.ts`),
 * so a 1200×900 window would answer that question only for the families that
 * happen to have a member near ship 0 — a ring of eight stations 2400 units
 * across does not — and a genuinely undrawn collider family would hide behind
 * "well, it was off screen".
 *
 * The bug this file is permanent for is unaffected by the cull, and it is worth
 * saying why rather than only asserting it: the camera centres the local ship, so
 * anything that ship can *collide* with is within one ship radius of the centre of
 * the window and therefore drawn. "You can hit what you cannot see" needs the two
 * to be reachable at once; the cull only ever hides what is further away than the
 * player can touch. The cull's own visibility pairs live in `src/render/cull.test.ts`.
 */
const VIEW = { width: 6000, height: 6000, originX: 0, originY: 0 };

/**
 * A world holding **one of every collidable entity type** (GDD §4.1 — every
 * colliding body is a circle; the arena bounds are the one non-circular wall).
 * Ships, asteroids and stations come from `createWorld`; a turret, a shield, an
 * ore chunk and a live turret projectile are seated on/around station 0 as the
 * plain data the sim spawns them as, so the renderer sees exactly what a real
 * match would hand it.
 */
function worldWithEveryCollidable(): World {
  const world = createWorld({
    seed: 1,
    players: Array.from({ length: 8 }, (_, id) => ({ id, shipClass: ShipClass.Vanguard })),
  });

  const station = world.stations[0]!;
  // Clear spawn protection so nothing about the draw path is gated by it.
  station.spawnProtect = 0;
  for (const s of world.ships) s.spawnProtect = 0;

  const mount = turretMountPos(station, 0);
  const turret: Turret = {
    id: world.nextEntityId++,
    owner: station.owner,
    slot: 0,
    pos: { x: mount.x, y: mount.y },
    radius: TURRET.radius,
    hp: TURRET.hp,
    maxHp: TURRET.hp,
    angle: station.angle,
    cooldown: 0,
    targetId: null,
  };
  station.turrets.push(turret);

  const shield: Shield = { id: world.nextEntityId++, hp: SHIELD.hp, maxHp: SHIELD.hp, radius: SHIELD.radius };
  station.shields.push(shield);

  const chunk: OreChunk = {
    id: world.nextEntityId++,
    pos: { x: station.pos.x - 200, y: station.pos.y },
    vel: { x: 0, y: 0 },
    amount: CHUNK.ore,
    radius: CHUNK.radius,
  };
  world.chunks.push(chunk);

  const projectile: Projectile = {
    id: world.nextEntityId++,
    active: true,
    owner: station.owner,
    pos: { x: station.pos.x - 120, y: station.pos.y },
    vel: { x: 0, y: 0 },
    damage: PROJECTILE.damage,
    radius: PROJECTILE.radius,
    life: PROJECTILE.life,
  };
  world.projectiles.push(projectile);

  return world;
}

function render(world: World): Container {
  const stage = new Container();
  const r = new Renderer(stage, VIEW);
  r.draw(world, { cameraTarget: 0, muzzles: [] });
  return stage;
}

/** The layer container the renderer labels for this collider family. */
function layer(stage: Container, label: string): Container {
  const node = stage.getChildByLabel(label, true);
  if (!node) throw new Error(`render layer '${label}' is missing from the stage`);
  return node as Container;
}

/** The visible pooled graphic drawn at world position (x, y), or null. Pooled
 *  graphics carry their entity's world coordinates in `.x/.y`, so a collider is
 *  matched to its sprite by position. */
function spriteAt(container: Container, x: number, y: number): Graphics | null {
  for (const child of container.children as Graphics[]) {
    if (!child.visible) continue;
    if (Math.hypot(child.x - x, child.y - y) < 1) return child;
  }
  return null;
}

/** Drawn size (larger of width/height) of a graphic in world units: local
 *  geometry bounds times the per-frame scale the renderer sized it with. */
function drawnSize(g: Graphics): number {
  const b = g.getLocalBounds();
  return Math.max(b.width * Math.abs(g.scale.x), b.height * Math.abs(g.scale.y));
}

/** The parity contract for one collider: a *visible* sprite exists, and its
 *  drawn size is within 2× (either way) of the collision diameter — so a body is
 *  never drawn much smaller than it collides ("hit what you can't see") nor left
 *  off the stage entirely.
 *
 *  `maxSize` overrides the upper bound for the one family whose sprite is not a
 *  body-sized blob; see {@link expectVisibleAtLeast} and the projectile case. */
function expectParity(name: string, g: Graphics | null, collisionRadius: number, maxSize?: number): void {
  expectVisibleAtLeast(name, g, collisionRadius);
  const diameter = 2 * collisionRadius;
  const size = drawnSize(g!);
  const ceiling = maxSize ?? 2 * diameter;
  const how = maxSize === undefined ? `2× its collision diameter ${diameter}` : `its declared cull reach ${ceiling.toFixed(1)}`;
  expect(size, `${name}: drawn size ${size.toFixed(1)} exceeds ${how}`).toBeLessThanOrEqual(ceiling);
}

/** The half of the parity contract this file is **permanent** for: a collider
 *  has a visible sprite on the stage, and it is not drawn so much smaller than
 *  it collides that a player can hit what they cannot see. Every family asserts
 *  this half, unconditionally — the shipped bug was an undrawn collider, and no
 *  art direction is allowed to relax it. */
function expectVisibleAtLeast(name: string, g: Graphics | null, collisionRadius: number): void {
  expect(g, `${name}: no visible sprite on stage for a collidable body`).not.toBeNull();
  const diameter = 2 * collisionRadius;
  const size = drawnSize(g!);
  expect(size, `${name}: drawn size ${size.toFixed(1)} is smaller than half its collision diameter ${diameter}`).toBeGreaterThanOrEqual(0.5 * diameter);
}

describe('sim/render parity — every collidable entity type is drawn to size', () => {
  it('ships (GDD §2.1)', () => {
    const world = worldWithEveryCollidable();
    const ships = layer(render(world), 'ships');
    for (const s of world.ships) {
      if (!s.alive) continue;
      expectParity(`ship ${s.id}`, spriteAt(ships, s.pos.x, s.pos.y), s.radius);
    }
  });

  it('asteroids (GDD §2.3)', () => {
    const world = worldWithEveryCollidable();
    const asteroids = layer(render(world), 'asteroids');
    expect(world.asteroids.length).toBeGreaterThan(0);
    for (const a of world.asteroids) {
      expectParity(`asteroid ${a.id}`, spriteAt(asteroids, a.pos.x, a.pos.y), a.radius);
    }
  });

  it('ore chunks (GDD §2.3 — scavengeable debris is a contested collidable)', () => {
    const world = worldWithEveryCollidable();
    const chunks = layer(render(world), 'chunks');
    expect(world.chunks.length).toBeGreaterThan(0);
    for (const c of world.chunks) {
      expectParity(`chunk ${c.id}`, spriteAt(chunks, c.pos.x, c.pos.y), c.radius);
    }
  });

  it('stations (GDD §2.1 — solid homes; you dock at your world, not through it)', () => {
    const world = worldWithEveryCollidable();
    const stage = render(world);
    for (let i = 0; i < world.stations.length; i++) {
      const body = stage.getChildByLabel(`station-${i}`, true) as Graphics | null;
      expect(body, `station ${i}: no body drawn`).not.toBeNull();
      expect(body!.visible).toBe(true);
      expectParity(`station ${i}`, body, world.stations[i]!.radius);
    }
  });

  it('turrets (GDD §2.6 — a shot target in its own right)', () => {
    const world = worldWithEveryCollidable();
    const turrets = layer(render(world), 'turrets');
    let count = 0;
    for (const p of world.stations) {
      for (const t of p.turrets) {
        if (t.hp <= 0) continue;
        count++;
        expectParity(`turret ${t.id}`, spriteAt(turrets, t.pos.x, t.pos.y), t.radius);
      }
    }
    expect(count).toBeGreaterThan(0);
  });

  it('shields (GDD §2.5 — the bubble that stands in front of the core)', () => {
    const world = worldWithEveryCollidable();
    const stage = render(world);
    for (let i = 0; i < world.stations.length; i++) {
      const station = world.stations[i]!;
      const up = station.shields.find((s) => s.hp > 1e-9);
      if (!up) continue;
      // The bubble is drawn into the station's live overlay; with a full core and
      // no construction, the overlay is the shield ring and nothing else.
      const overlay = stage.getChildByLabel(`station-overlay-${i}`, true) as Graphics | null;
      expect(overlay, `station ${i}: shield up but no overlay drawn`).not.toBeNull();
      expect(overlay!.context.instructions.length, `station ${i}: shield overlay drew nothing`).toBeGreaterThan(0);
      expectParity(`shield on station ${i}`, overlay, up.radius);
    }
  });

  /**
   * The one family whose upper bound is not `2× the collision diameter`, and the
   * reason is a ratified art ruling rather than a slipped sprite.
   *
   * A shot used to be two concentric circles, and a disc drawn at ~1.2 radii sat
   * inside 2× its collider comfortably. Since a0-46 it is a PIERCE laser bolt:
   * a blunt head at the collision radius with a trail of light running ~6.8 radii
   * out behind it, turned onto the direction of travel. The head is the body; the
   * trail is exhaust, and no one expects to collide with it — the same convention
   * every laser bolt in every shooter uses.
   *
   * Two things follow, and only the second is a change to this file's contract:
   *
   *  - **The lower bound is untouched.** `expectVisibleAtLeast` still runs, so the
   *    shipped bug this file is permanent for — a collider with no sprite, or one
   *    drawn too small to see — still fails here for projectiles exactly as it
   *    does for every other family. That half is not negotiable and is not what
   *    this case relaxes.
   *  - **The upper bound becomes the cull reach instead of the collider.**
   *    `2 × collisionRadius` cannot express "a body plus a trail", and the sprite
   *    bakes into a SQUARE quad (`SpriteDef.extent` is one half-extent), so the
   *    measured box is the bolt's LENGTH on both axes — 63 units against a
   *    collision diameter of 8. The ceiling that is actually meaningful for a
   *    shot is the one the renderer already commits to: `RENDER_EXTENT.shot`, the
   *    reach `drawShots` culls by. A sprite larger than its own declared reach is
   *    a real bug — it clips against the screen edge while the cull thinks it is
   *    safely off — and this assertion catches it, which the old ceiling did not.
   *
   * So the ceiling moved from "2× the collider" to "never bigger than what it
   * told the cull". A regression that doubled the bolt still fails; an undrawn
   * shot still fails. OWNER (Platform Engineer): this is the one line of your
   * gate a0-46 changes, and it is called out in the PR for your review.
   */
  it('turret projectiles (GDD §4.1 — pooled shots, a body with a trail)', () => {
    const world = worldWithEveryCollidable();
    const shots = layer(render(world), 'shots');
    const live = world.projectiles.filter((p) => p.active);
    expect(live.length).toBeGreaterThan(0);
    for (const p of live) {
      // The declared cull reach is a half-extent; the drawn size is a diameter.
      const reach = 2 * reachOf(p.radius, RENDER_EXTENT.shot);
      expectParity(`projectile ${p.id}`, spriteAt(shots, p.pos.x, p.pos.y), p.radius, reach);
    }
  });
});

describe('sim/render parity — the arena boundary is a drawn wall, not an invisible one', () => {
  it('draws the play-field edge the sim clamps ships against (the shipped bug)', () => {
    const world = worldWithEveryCollidable();
    const stage = render(world);

    const boundary = stage.getChildByLabel('boundary-wall', true) as Graphics | null;
    expect(boundary, 'the arena boundary — a blocking volume — is not drawn').not.toBeNull();
    expect(boundary!.visible).toBe(true);
    expect(boundary!.context.instructions.length, 'the boundary drew no geometry').toBeGreaterThan(0);

    // It frames the actual play bounds, so the wall reads where the wall is.
    const b = boundary!.getLocalBounds();
    expect(b.width).toBeGreaterThanOrEqual(world.bounds.width * 0.9);
    expect(b.height).toBeGreaterThanOrEqual(world.bounds.height * 0.9);
  });

  it('is pooled: extra frames neither grow the tree nor redraw the static wall', () => {
    const world = worldWithEveryCollidable();
    const stage = new Container();
    const r = new Renderer(stage, VIEW);
    r.draw(world, { cameraTarget: 0, muzzles: [] });
    const boundaryLayer = layer(stage, 'boundary');
    const after = boundaryLayer.children.length;
    r.draw(world, { cameraTarget: 0, muzzles: [] });
    r.draw(world, { cameraTarget: 0, muzzles: [] });
    expect(boundaryLayer.children.length).toBe(after);
  });
});
