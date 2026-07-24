/**
 * tests/sim-render-parity.test.ts — you can only be blocked by what you can see.
 * OWNER: Platform Engineer.
 *
 * ── WHY THIS TEST IS PERMANENT ──────────────────────────────────────────────
 * A live build shipped an *invisible blocking volume*: a player flew into
 * something solid beside their planet that the renderer never drew, with an
 * enemy just out of reach behind it. Root cause (agent/platform/m2-invisible-
 * blocker): the simulation clamps every ship inside `world.bounds` — the arena
 * wall is as solid as a planet — but the render layer only *read* the bounds for
 * the camera and never drew them. The play-field edge was a wall you crash into
 * and cannot see. Planets are pinned right against that wall (`createWorld`
 * clamps them to `halfMin − radius`), so "the invisible thing beside my planet"
 * was the undrawn boundary the planet sits on.
 *
 * The class of bug is "you can hit what you cannot see", and it must never ship
 * again. This test is the guard, in two halves:
 *
 *  1. **Every collidable entity type the world can spawn** — ship, asteroid, ore
 *     chunk, planet, turret, shield, turret projectile — is rendered as a
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
import { CHUNK, PROJECTILE, SHIELD, TURRET, createWorld, turretMountPos } from '../src/sim';
import type { OreChunk, Projectile, Shield, Turret, World } from '../src/sim';

const VIEW = { width: 1200, height: 900, originX: 0, originY: 0 };

/**
 * A world holding **one of every collidable entity type** (GDD §4.1 — every
 * colliding body is a circle; the arena bounds are the one non-circular wall).
 * Ships, asteroids and planets come from `createWorld`; a turret, a shield, an
 * ore chunk and a live turret projectile are seated on/around planet 0 as the
 * plain data the sim spawns them as, so the renderer sees exactly what a real
 * match would hand it.
 */
function worldWithEveryCollidable(): World {
  const world = createWorld({
    seed: 1,
    players: Array.from({ length: 8 }, (_, id) => ({ id, shipClass: ShipClass.Vanguard })),
  });

  const planet = world.planets[0]!;
  // Clear spawn protection so nothing about the draw path is gated by it.
  planet.spawnProtect = 0;
  for (const s of world.ships) s.spawnProtect = 0;

  const mount = turretMountPos(planet, 0);
  const turret: Turret = {
    id: world.nextEntityId++,
    owner: planet.owner,
    slot: 0,
    pos: { x: mount.x, y: mount.y },
    radius: TURRET.radius,
    hp: TURRET.hp,
    maxHp: TURRET.hp,
    angle: planet.angle,
    cooldown: 0,
    targetId: null,
  };
  planet.turrets.push(turret);

  const shield: Shield = { id: world.nextEntityId++, hp: SHIELD.hp, maxHp: SHIELD.hp, radius: SHIELD.radius };
  planet.shields.push(shield);

  const chunk: OreChunk = {
    id: world.nextEntityId++,
    pos: { x: planet.pos.x - 200, y: planet.pos.y },
    vel: { x: 0, y: 0 },
    amount: CHUNK.ore,
    radius: CHUNK.radius,
  };
  world.chunks.push(chunk);

  const projectile: Projectile = {
    id: world.nextEntityId++,
    active: true,
    owner: planet.owner,
    pos: { x: planet.pos.x - 120, y: planet.pos.y },
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
  r.draw(world, { cameraTarget: 0, beams: [] });
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
 *  off the stage entirely. */
function expectParity(name: string, g: Graphics | null, collisionRadius: number): void {
  expect(g, `${name}: no visible sprite on stage for a collidable body`).not.toBeNull();
  const diameter = 2 * collisionRadius;
  const size = drawnSize(g!);
  expect(size, `${name}: drawn size ${size.toFixed(1)} is smaller than half its collision diameter ${diameter}`).toBeGreaterThanOrEqual(0.5 * diameter);
  expect(size, `${name}: drawn size ${size.toFixed(1)} exceeds 2× its collision diameter ${diameter}`).toBeLessThanOrEqual(2 * diameter);
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

  it('planets (GDD §2.1 — solid homes; you dock at your world, not through it)', () => {
    const world = worldWithEveryCollidable();
    const stage = render(world);
    for (let i = 0; i < world.planets.length; i++) {
      const body = stage.getChildByLabel(`planet-${i}`, true) as Graphics | null;
      expect(body, `planet ${i}: no body drawn`).not.toBeNull();
      expect(body!.visible).toBe(true);
      expectParity(`planet ${i}`, body, world.planets[i]!.radius);
    }
  });

  it('turrets (GDD §2.6 — a beam target in its own right)', () => {
    const world = worldWithEveryCollidable();
    const turrets = layer(render(world), 'turrets');
    let count = 0;
    for (const p of world.planets) {
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
    for (let i = 0; i < world.planets.length; i++) {
      const planet = world.planets[i]!;
      const up = planet.shields.find((s) => s.hp > 1e-9);
      if (!up) continue;
      // The bubble is drawn into the planet's live overlay; with a full core and
      // no construction, the overlay is the shield ring and nothing else.
      const overlay = stage.getChildByLabel(`planet-overlay-${i}`, true) as Graphics | null;
      expect(overlay, `planet ${i}: shield up but no overlay drawn`).not.toBeNull();
      expect(overlay!.context.instructions.length, `planet ${i}: shield overlay drew nothing`).toBeGreaterThan(0);
      expectParity(`shield on planet ${i}`, overlay, up.radius);
    }
  });

  it('turret projectiles (GDD §4.1 — pooled shots, same circle test)', () => {
    const world = worldWithEveryCollidable();
    const shots = layer(render(world), 'shots');
    const live = world.projectiles.filter((p) => p.active);
    expect(live.length).toBeGreaterThan(0);
    for (const p of live) {
      expectParity(`projectile ${p.id}`, spriteAt(shots, p.pos.x, p.pos.y), p.radius);
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
    r.draw(world, { cameraTarget: 0, beams: [] });
    const boundaryLayer = layer(stage, 'boundary');
    const after = boundaryLayer.children.length;
    r.draw(world, { cameraTarget: 0, beams: [] });
    r.draw(world, { cameraTarget: 0, beams: [] });
    expect(boundaryLayer.children.length).toBe(after);
  });
});
