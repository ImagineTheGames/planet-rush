/**
 * The viewport cull (a1-12). OWNER: Platform Engineer.
 *
 * a1-10 §4.1 measured it and a1-11 re-measured it after the pooling landed: the
 * renderer submitted the whole arena every frame — 200 rocks to show 75 on a
 * desktop window, and 200 to show **6** on a landscape phone. This file is the
 * test that fails without the fix, and it is written around the one rule the fix
 * rests on:
 *
 *   **Cull on visibility, never on existence.**
 *
 * So every layer gets the pair, not the half: a body wholly off screen must not
 * be submitted, *and* a body straddling the edge of the window must be. The
 * second half is the one that matters — a cull that drops a rock the moment its
 * centre crosses the boundary makes the field pop at the screen edge, which is
 * the bug this change is most likely to introduce and the reason the frozen-scene
 * goldens are the alarm on it.
 *
 * Headless, like the rest of the render suite: Pixi builds the scene graph with
 * no WebGL, so what is asserted is exactly what the renderer hands the GPU.
 */
import { describe, it, expect } from 'vitest';
import { Container } from 'pixi.js';
import { ShipClass } from '@shared/types';
import { createWorld, damageStation } from '../sim';
import type { Asteroid, OreChunk, Projectile, World } from '../sim';
import { TURRET_MAX_TIER } from '../sim/constants';
import { asteroidSprite } from '../art/asteroids';
import { shieldSprite, turretSprite, type TurretState } from '../art/buildings';
import { shipSprite } from '../art/ships';
import { SHOT_MAX_TIER, shotSprite } from '../art/vfx/shots';
import { Renderer } from './index';
import { CULL_SLOP, RENDER_EXTENT, cullBox, segmentTouchesBox, touchesBox, writeVisibleWorld } from './cull';
import type { Viewport } from '@platform/camera';

/** A modest window, so "off screen" is a short distance away and the fixtures
 *  below stay readable. Nothing here depends on the size. */
const VIEW: Viewport = { width: 800, height: 600, originX: 0, originY: 0 };

/**
 * A world with one ship, parked at a known point, so the visible rectangle is
 * exactly `centre ± half the viewport` and every fixture can be written as an
 * offset from the screen edge rather than as an absolute world coordinate.
 */
const CENTRE = { x: 1000, y: 1000 };

function world(): World {
  const w = createWorld({ seed: 3, players: [{ id: 0, shipClass: ShipClass.Vanguard }] });
  w.ships[0]!.pos = { x: CENTRE.x, y: CENTRE.y };
  // The eight-station ring and its rocks are scenery for other suites; each case
  // below stocks the one layer it is about.
  w.asteroids.length = 0;
  w.chunks.length = 0;
  return w;
}

/** The right-hand edge of the visible rectangle, in world units. */
const RIGHT_EDGE = CENTRE.x + VIEW.width / 2;

function rock(id: number, x: number, y: number, radius: number): Asteroid {
  return { id, pos: { x, y }, radius, ore: 8, maxOre: 8, crackStage: 0, mineBuffer: 0 };
}

function chunk(id: number, x: number, y: number, radius: number): OreChunk {
  return { id, pos: { x, y }, vel: { x: 0, y: 0 }, amount: 1, radius };
}

function shot(id: number, x: number, y: number, radius: number): Projectile {
  return {
    id,
    active: true,
    owner: 0,
    pos: { x, y },
    vel: { x: 0, y: 0 },
    damage: 1,
    mineYield: 0,
    radius,
    life: 1,
  };
}

function drawn(stage: Container, label: string): Container[] {
  const node = stage.getChildByLabel(label, true);
  if (!node) throw new Error(`render layer '${label}' is missing from the stage`);
  return (node as Container).children.filter((c) => c.visible) as Container[];
}

function render(w: World, viewport: Viewport = VIEW): Container {
  const stage = new Container();
  new Renderer(stage, viewport).draw(w, { cameraTarget: 0, muzzles: [] });
  return stage;
}

// ---------------------------------------------------------------------------
// The rule, layer by layer
// ---------------------------------------------------------------------------

describe('an entity off screen is not submitted; one straddling the edge is', () => {
  it('rocks — the layer the cull exists for', () => {
    const w = world();
    const radius = 40;
    // Three rocks: one in the middle of the window, one whose centre is past the
    // right edge but whose body crosses it, and one clear of the window entirely.
    w.asteroids.push(
      rock(1, CENTRE.x, CENTRE.y, radius),
      rock(2, RIGHT_EDGE + radius / 2, CENTRE.y, radius),
      rock(3, RIGHT_EDGE + radius * 10, CENTRE.y, radius),
    );

    const visible = drawn(render(w), 'asteroids');

    expect(visible).toHaveLength(2);
    expect(visible.map((s) => s.x).sort((a, b) => a - b)).toEqual([CENTRE.x, RIGHT_EDGE + radius / 2]);
  });

  it('rocks — a whole field of them collapses to what the window holds', () => {
    const w = world();
    // Two hundred rocks in a line marching away from the camera: exactly the
    // shape a1-10 measured, and the count that made the phone the tighter gate.
    for (let i = 0; i < 200; i++) w.asteroids.push(rock(i, CENTRE.x + i * 60, CENTRE.y, 30));

    const visible = drawn(render(w), 'asteroids');

    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(20); // 400 units of window at 60 apart
    // Every rock still has a slot to come back to; none of them is destroyed.
    expect(w.asteroids).toHaveLength(200);
  });

  it('ore chunks', () => {
    const w = world();
    const radius = 6;
    w.chunks.push(
      chunk(1, CENTRE.x, CENTRE.y, radius),
      chunk(2, RIGHT_EDGE, CENTRE.y, radius), // dead on the boundary
      chunk(3, RIGHT_EDGE + radius * 20, CENTRE.y, radius),
    );

    expect(drawn(render(w), 'chunks')).toHaveLength(2);
  });

  it('shots — a round in flight toward the edge is visible', () => {
    const w = world();
    const radius = 4;
    w.projectiles.push(
      shot(1, CENTRE.x, CENTRE.y, radius),
      shot(2, RIGHT_EDGE + radius / 2, CENTRE.y, radius), // half out, still drawn
      shot(3, RIGHT_EDGE + radius * 50, CENTRE.y, radius),
    );

    expect(drawn(render(w), 'shots')).toHaveLength(2);
  });

  it('ships — a rival across the map costs nothing, one at the edge draws', () => {
    const w = createWorld({
      seed: 3,
      players: [0, 1, 2].map((id) => ({ id, shipClass: ShipClass.Vanguard })),
    });
    const viewer = w.ships[0]!;
    viewer.pos = { x: CENTRE.x, y: CENTRE.y };
    const edge = w.ships[1]!;
    const far = w.ships[2]!;
    edge.pos = { x: RIGHT_EDGE + edge.radius / 2, y: CENTRE.y };
    far.pos = { x: RIGHT_EDGE + far.radius * 40, y: CENTRE.y };

    const visible = drawn(render(w), 'ships');

    // The camera target is centred by construction, so it is always one of them.
    expect(visible).toHaveLength(2);
    expect(visible.map((s) => s.x)).toContain(viewer.pos.x);
    expect(visible.map((s) => s.x)).toContain(edge.pos.x);
  });

  it('muzzle flashes — a flash fired from off screen at something on screen draws', () => {
    const w = world();
    const stage = new Container();
    const r = new Renderer(stage, VIEW);

    r.draw(w, {
      cameraTarget: 0,
      muzzles: [
        // Fired from well outside the window, ending inside it: the line crosses
        // the screen and must be drawn. Culling on the muzzle's ORIGIN would drop
        // it, which is why the test is the segment and not the point.
        { from: { x: CENTRE.x - 4000, y: CENTRE.y }, to: CENTRE, color: 0x4dc3ff, hit: CENTRE },
        // Entirely off screen, both ends: nothing to draw.
        {
          from: { x: CENTRE.x - 4000, y: CENTRE.y - 4000 },
          to: { x: CENTRE.x - 3800, y: CENTRE.y - 4000 },
          color: 0x4dc3ff,
          hit: null,
        },
      ],
    });

    expect(drawn(stage, 'muzzles')).toHaveLength(1);
    expect(drawn(stage, 'impacts')).toHaveLength(1);
  });

  it('turrets and the station they stand on', () => {
    const w = createWorld({
      seed: 7,
      players: Array.from({ length: 8 }, (_, id) => ({ id, shipClass: ShipClass.Vanguard })),
    });
    // Parked at its own home: the viewer's station is on screen, and the seven
    // others are spread around a 2400-unit ring, which no 800×600 window reaches.
    const home = w.stations[0]!;
    w.ships[0]!.pos = { x: home.pos.x, y: home.pos.y };

    const stage = render(w);

    expect(drawn(stage, 'stations').length).toBeGreaterThan(0);
    expect(drawn(stage, 'stations').length).toBeLessThan(w.stations.length * 2); // body + overlay each
    // The home's own atmosphere is drawn; nobody else's ever is (it is the deposit
    // affordance), so this layer is the one station that can be on screen at all.
    expect(drawn(stage, 'atmosphere')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// What the cull must NOT change
// ---------------------------------------------------------------------------

describe('the cull is the window, not the fog', () => {
  it('still rings a wounded rival that is on screen but far outside the retired sensor range', () => {
    // GDD §2.2 as amended (a0-05): station health is not fog. The bug that
    // amendment fixed was a ring blanked at 180 units — a fifth of the way across
    // a 1080p window — so a rival you could SEE drew nothing. The cull must not
    // reintroduce it by another door: at 250 units the rival is well past the
    // retired gate and still plainly on screen, and its ring must be drawn.
    const RETIRED_SENSOR_RANGE = 180;
    const w = createWorld({
      seed: 7,
      players: Array.from({ length: 8 }, (_, id) => ({ id, shipClass: ShipClass.Vanguard })),
    });
    const rival = w.stations[4]!;
    rival.spawnProtect = 0;
    damageStation(w, rival, 40);
    w.ships[0]!.pos = { x: rival.pos.x, y: rival.pos.y - 250 };
    expect(250).toBeGreaterThan(RETIRED_SENSOR_RANGE);

    const overlay = render(w).getChildByLabel('station-overlay-4', true);
    expect(overlay).not.toBeNull();
    expect(overlay!.visible).toBe(true);
  });

  it('brings a rock back the moment the camera pans to it — hidden, never destroyed', () => {
    const w = world();
    const radius = 40;
    w.asteroids.push(rock(1, CENTRE.x + 2000, CENTRE.y, radius));

    const stage = new Container();
    const r = new Renderer(stage, VIEW);

    r.draw(w, { cameraTarget: 0, muzzles: [] });
    expect(drawn(stage, 'asteroids')).toHaveLength(0);

    // Fly to it. Same renderer, same frame budget, no rebuild.
    w.ships[0]!.pos = { x: CENTRE.x + 2000, y: CENTRE.y };
    r.draw(w, { cameraTarget: 0, muzzles: [] });
    expect(drawn(stage, 'asteroids')).toHaveLength(1);
  });

  it('tracks a viewport that changes under it (resize, URL bar, fullscreen)', () => {
    const w = world();
    for (let i = 0; i < 60; i++) w.asteroids.push(rock(i, CENTRE.x + i * 40, CENTRE.y, 20));

    const stage = new Container();
    const r = new Renderer(stage, VIEW);
    r.draw(w, { cameraTarget: 0, muzzles: [] });
    const narrow = drawn(stage, 'asteroids').length;

    // A wider window shows more of the same field, on the same renderer — the
    // cull reads the live viewport, not one it captured at construction.
    r.setViewport({ width: 1600, height: 600, originX: 0, originY: 0 });
    r.draw(w, { cameraTarget: 0, muzzles: [] });
    expect(drawn(stage, 'asteroids').length).toBeGreaterThan(narrow);
  });

  it('reports the same rectangle it culled against', () => {
    const w = world();
    const r = new Renderer(new Container(), VIEW);
    r.draw(w, { cameraTarget: 0, muzzles: [] });

    // One notion of "on screen" in this layer, and this is it — the debug seam
    // (`?debug=1`) and the cull read the same box.
    expect(r.visibleWorld).toEqual({
      left: CENTRE.x - VIEW.width / 2,
      right: CENTRE.x + VIEW.width / 2,
      top: CENTRE.y - VIEW.height / 2,
      bottom: CENTRE.y + VIEW.height / 2,
    });
  });
});

// ---------------------------------------------------------------------------
// The arithmetic, on its own
// ---------------------------------------------------------------------------

describe('cull geometry', () => {
  it('inverts the camera offset, origin and all', () => {
    const box = cullBox();
    // A phone with the URL bar taking the top 80 px: the canvas is bigger than
    // the visible region, and the visible region starts partway into it.
    const vp: Viewport = { width: 844, height: 390, originX: 12, originY: 80 };
    writeVisibleWorld(box, { x: -600, y: -400 }, vp);

    expect(box.left).toBe(612);
    expect(box.top).toBe(480);
    expect(box.right).toBe(612 + 844);
    expect(box.bottom).toBe(480 + 390);
  });

  it('counts a body grazing the boundary as visible', () => {
    const box = { left: 0, right: 100, top: 0, bottom: 100 };
    expect(touchesBox(box, 110, 50, 10)).toBe(true); // exactly touching
    expect(touchesBox(box, 110, 50, 9.9)).toBe(false); // a hair clear
    expect(touchesBox(box, -10, -10, 15)).toBe(true); // diagonal corner overlap
  });

  it('keeps a segment that crosses the box and drops one that misses it', () => {
    const box = { left: 0, right: 100, top: 0, bottom: 100 };
    expect(segmentTouchesBox(box, -50, 50, 150, 50, 1)).toBe(true); // straight through
    expect(segmentTouchesBox(box, -50, -50, -10, -10, 1)).toBe(false); // clear of it
    expect(segmentTouchesBox(box, 50, -12, 50, -1, 2)).toBe(true); // stroke reaches in
    expect(segmentTouchesBox(box, 50, -12, 50, -3, 2)).toBe(false); // stops just short
  });
});

// ---------------------------------------------------------------------------
// The pads, against the art they are pads for
// ---------------------------------------------------------------------------

describe('RENDER_EXTENT bounds every look its layer can wear', () => {
  /** Every extent must be an upper bound, or the cull clips at the screen edge —
   *  which is the one failure mode that shows on screen rather than in a number. */
  const bounds = (actual: number, declared: number, what: string): void => {
    expect(actual, `${what} art reaches ${actual}, past the ${declared} the cull pads by`).toBeLessThanOrEqual(
      declared,
    );
  };

  it('rocks', () => {
    let widest = 0;
    for (let seed = 0; seed < 64; seed++) {
      for (let crackStage = 0; crackStage <= 2; crackStage++) {
        for (const richness of [0, 0.5, 1]) {
          widest = Math.max(widest, asteroidSprite({ seed, crackStage, richness }).extent);
        }
      }
    }
    bounds(widest, RENDER_EXTENT.rock, 'asteroid');
  });

  it('turrets, at every owner, tier and telegraph state', () => {
    let widest = 0;
    const states: TurretState[] = ['idle', 'tracking', 'firing', 'building'];
    for (let playerId = 0; playerId < 8; playerId++) {
      for (let tier = 0; tier <= TURRET_MAX_TIER; tier++) {
        for (const state of states) {
          widest = Math.max(widest, turretSprite({ playerId, state, tier }).extent);
        }
      }
    }
    bounds(widest, RENDER_EXTENT.turret, 'turret');
  });

  it('shots, at every family and DAMAGE rung', () => {
    let widest = 0;
    for (const family of ['own', 'enemy'] as const) {
      for (let tier = 0; tier <= SHOT_MAX_TIER; tier++) {
        widest = Math.max(widest, shotSprite(family, tier).extent);
      }
    }
    bounds(widest, RENDER_EXTENT.shot, 'shot');
  });

  it('hulls, across the roster', () => {
    let widest = 0;
    for (const shipClass of Object.values(ShipClass)) {
      widest = Math.max(widest, shipSprite({ shipClass, playerId: 0 }).extent);
    }
    bounds(widest, RENDER_EXTENT.ship, 'ship');
  });

  it('shield bubbles, at every strength and stack position', () => {
    let widest = 0;
    for (const strength of ['full', 'weakened', 'failing'] as const) {
      for (let stackIndex = 0; stackIndex < 2; stackIndex++) {
        widest = Math.max(widest, shieldSprite({ playerId: 0, strength, stackIndex, gauge: false }).extent);
      }
    }
    bounds(widest, RENDER_EXTENT.shield, 'shield');
  });

  it('ore chunks are drawn at exactly their collision radius', () => {
    const w = world();
    const radius = 6;
    w.chunks.push(chunk(1, CENTRE.x, CENTRE.y, radius));

    const [g] = drawn(render(w), 'chunks');
    // `makeUnitChunk` is a unit circle scaled by the radius, so its art reaches
    // exactly the collider and `RENDER_EXTENT.chunk` is 1 by construction.
    expect(g!.getLocalBounds().width * g!.scale.x).toBeCloseTo(2 * radius * RENDER_EXTENT.chunk, 6);
  });

  it('pads by the bake margin, so a hairline on the boundary is never clipped', () => {
    // The pooled layers bake a margin of transparent texels around the declared
    // extent (`index.ts` BAKE_MARGIN) and scale by the nominal size, so the drawn
    // quad is that fraction wider than the art. The cull must pad by at least it.
    expect(CULL_SLOP).toBeGreaterThanOrEqual(1.08);
  });
});
