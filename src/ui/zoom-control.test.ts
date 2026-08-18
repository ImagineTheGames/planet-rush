/**
 * src/ui/zoom-control.test.ts — the zoom-out button, on touch (a0-74).
 *
 * The placement claim is the one worth pinning mechanically: the control declares
 * `top-right`, and a declared anchor is a promise the layout registry checks. So
 * this drives the registry's OWN resolver (`@platform/layout-registry`
 * `resolveAnchor` / `rectContains`) at every profile in the device matrix rather
 * than restating the arithmetic.
 */
import { describe, it, expect } from 'vitest';
import { Container, Rectangle, Sprite, Texture, TextureSource } from 'pixi.js';
import { rectContains, resolveAnchor } from '@platform/layout-registry';
import type { Viewport } from '@platform/camera';
import { ShipClass } from '@shared/types';
import { Renderer } from '@render/index';
import { createWorld } from '../sim';
import { TELL, TellQueue } from '../art/tells';
import { SpriteTextureCache } from '../art/textures';
import { VfxField } from '../art/vfx/field';
import { VfxLayer } from '../art/vfx/layer';
import { TOUCH_TARGET_MIN, HUD_PAD, stationChromeHeight } from './hud-geometry';
import { hudMetrics } from './instrument';
import {
  ZOOM_CONTROL_ANCHOR,
  ZOOM_CONTROL_HEIGHT,
  hitZoomControl,
  showZoomControl,
  zoomControlBounds,
  zoomControlLabel,
} from './zoom-control';
import { cameraScale, VIEW_ZOOM_STEPS } from './viewport';

/** The matrix, landscape-locked, including the shortest profile the HUD claims to
 *  run on (GDD §4.3) — which is the one that decided the placement. */
const PROFILES = [
  { name: '568x320 (shortest)', width: 568, height: 320 },
  { name: '798x384 (the report\'s phone)', width: 798, height: 384 },
  { name: '844x390 (iPhone landscape)', width: 844, height: 390 },
  { name: '915x412 (Pixel landscape)', width: 915, height: 412 },
  { name: '1280x800 (desktop control)', width: 1280, height: 800 },
] as const;

describe('the zoom control is on touch and nowhere else', () => {
  it('is not drawn off touch — desktop already has the wide view', () => {
    expect(showZoomControl(false)).toBe(false);
    for (const p of PROFILES) {
      expect(zoomControlBounds(p.width, p.height, false)).toBeNull();
    }
  });

  it('is drawn on touch at every profile', () => {
    expect(showZoomControl(true)).toBe(true);
    for (const p of PROFILES) {
      expect(zoomControlBounds(p.width, p.height, true)).not.toBeNull();
    }
  });
});

describe('where it sits', () => {
  it('stays inside its declared top-right anchor at every profile', () => {
    for (const p of PROFILES) {
      const rect = zoomControlBounds(p.width, p.height, true)!;
      const zone = resolveAnchor(ZOOM_CONTROL_ANCHOR, { width: p.width, height: p.height });
      expect({ profile: p.name, ok: rectContains(zone, rect) }).toEqual({
        profile: p.name,
        ok: true,
      });
    }
  });

  it('sits under the HOME cluster and never on it', () => {
    for (const p of PROFILES) {
      const rect = zoomControlBounds(p.width, p.height, true)!;
      const m = hudMetrics(p.width, p.height);
      const homeBottom = HUD_PAD + stationChromeHeight(m.scale);
      expect({ profile: p.name, clear: rect.y >= homeBottom }).toEqual({
        profile: p.name,
        clear: true,
      });
      // Right-aligned on the same margin HOME is, so the two read as one column.
      expect(rect.x + rect.width).toBe(p.width - HUD_PAD);
    }
  });

  it('clears the wave clock, which is what the same row could not do', () => {
    // The measurement that chose the placement. `top-center` is the clock's
    // declared zone (GDD §2.2), and on the shortest profile a control beside HOME
    // would have had 38 px of gap to live in.
    for (const p of PROFILES) {
      const rect = zoomControlBounds(p.width, p.height, true)!;
      const clock = resolveAnchor({ region: 'top-center' }, { width: p.width, height: p.height });
      expect({ profile: p.name, clear: rect.x >= clock.x + clock.width }).toEqual({
        profile: p.name,
        clear: true,
      });
    }
  });

  it('gives up its gap rather than its size when the band is short', () => {
    // 568×320 is the profile that decided the clamp: the preferred gap would push
    // the control 4 px past the `top-right` zone floor, so it takes less air —
    // and keeps every one of its 48 px.
    const short = zoomControlBounds(568, 320, true)!;
    const roomy = zoomControlBounds(844, 390, true)!;
    const m = hudMetrics(568, 320);
    const preferred = HUD_PAD + stationChromeHeight(m.scale) + 6;
    expect(short.y).toBeLessThan(preferred);
    expect(short.height).toBe(roomy.height);
    expect(short.height).toBe(TOUCH_TARGET_MIN);
  });

  it('keeps the platform touch floor, unscaled, even on the smallest screen', () => {
    // Every other HUD metric shrinks with the frame; a thumb does not.
    expect(ZOOM_CONTROL_HEIGHT).toBe(TOUCH_TARGET_MIN);
    for (const p of PROFILES) {
      const rect = zoomControlBounds(p.width, p.height, true)!;
      expect(rect.height).toBe(TOUCH_TARGET_MIN);
      expect(rect.width).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN);
    }
  });
});

describe('what it says, and what it takes', () => {
  it('reads VIEW over the live rung', () => {
    expect(zoomControlLabel(1)).toEqual({ caption: 'VIEW', value: '1×' });
    expect(zoomControlLabel(1.5)).toEqual({ caption: 'VIEW', value: '1.5×' });
    expect(zoomControlLabel(2)).toEqual({ caption: 'VIEW', value: '2×' });
    // Every rung on the ladder has a label — a new rung cannot ship unnamed.
    for (const step of VIEW_ZOOM_STEPS) {
      expect(zoomControlLabel(step).value).toMatch(/^\d+(\.\d+)?×$/);
    }
  });

  it('takes a press inside it, on every edge, and refuses one outside', () => {
    const rect = zoomControlBounds(844, 390, true)!;
    const { x, y, width: w, height: h } = rect;
    for (const [px, py] of [
      [x + w / 2, y + h / 2],
      [x, y],
      [x + w, y + h],
      [x, y + h],
      [x + w, y],
    ] as const) {
      expect(hitZoomControl(px, py, rect)).toBe(true);
    }
    for (const [px, py] of [
      [x - 1, y + h / 2],
      [x + w + 1, y + h / 2],
      [x + w / 2, y - 1],
      [x + w / 2, y + h + 1],
    ] as const) {
      expect(hitZoomControl(px, py, rect)).toBe(false);
    }
  });

  it('refuses every press when there is no control drawn', () => {
    expect(hitZoomControl(10, 10, null)).toBe(false);
    expect(hitZoomControl(10, 10, { x: 0, y: 0, width: 0, height: 0 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The world the control zooms (a0-80)
// ---------------------------------------------------------------------------

/**
 * The control turns a rung; what the rung is *for* is that the picture gets
 * wider. Everything drawn in world units has to come with it, and the developer
 * found one thing that did not:
 *
 * > *"when the screen is 1.5x or 2 the thrusters draw In the wrong place"*
 *
 * The thruster was only the effect they happened to be watching. The whole VFX
 * field — impacts, ore pickups, shield hits, the station-death burst — hung off
 * `gameRoot` as a SIBLING of the renderer's world container and chased the
 * camera by writing its own position from `projectToScreen` each frame. That
 * carried the camera's offset and dropped its scale, so at 1× the two spaces
 * coincided and at 1.5× and 2× every particle landed at a fraction of the
 * distance to the emitter it came off.
 *
 * These live here, beside the control that exposes the rungs, because the claim
 * under test is the control's: *what this button does to the view, the effects
 * do too*. The seam it drives is the renderer's `addWorldLayer`, and the arithmetic
 * end of the rung is `./viewport`'s `cameraScale` — both imported rather than
 * restated, so a change to either fails here instead of drifting past.
 *
 * Asserted as RELATIONSHIPS, never pixel constants (LESSONS §26): a particle is
 * where the renderer says its world point is, and the gap between a particle and
 * its emitter scales by exactly the rung. Both hold at 1× on the broken code —
 * which is why the bug shipped — and only the fix holds at 1.5× and 2×.
 */

/** A window big enough to hold the whole arena at every rung, so the cull never
 *  decides the outcome of a placement question. (`../render/pooling.test.ts`
 *  takes the cull out of the picture the same way, for the same reason.) */
const VFX_VIEW: Viewport = { width: 6000, height: 6000, originX: 0, originY: 0 };

/** A baker that returns a correctly-sized blank — the production `generateTexture`
 *  contract minus the raster, which is all a placement assertion needs. */
function blankBaker() {
  return {
    generateTexture(options: { target: Container; frame?: Rectangle; resolution?: number }): Texture {
      const frame = options.frame ?? new Rectangle(0, 0, 1, 1);
      return new Texture({
        source: new TextureSource({
          width: Math.max(1, Math.round(frame.width)),
          height: Math.max(1, Math.round(frame.height)),
          resolution: options.resolution ?? 1,
        }),
      });
    },
  };
}

/** One ship, one seat — enough world for a camera to centre on and a thruster to
 *  fire from. */
function vfxWorld() {
  return createWorld({ seed: 7, players: [{ id: 0, shipClass: ShipClass.Vanguard }] });
}

/** The particles the layer actually drew this frame, with the world point each
 *  one was drawn FOR. Reading the sprite tree is the point: it is what the GPU
 *  gets, not what the pool intended. */
function drawnParticles(layer: VfxLayer): { sprite: Sprite; world: { x: number; y: number } }[] {
  const out: { sprite: Sprite; world: { x: number; y: number } }[] = [];
  const walk = (node: Container): void => {
    for (const child of node.children) {
      if (child instanceof Sprite) {
        if (child.visible) out.push({ sprite: child, world: { x: child.x, y: child.y } });
      } else if (child instanceof Container) {
        walk(child);
      }
    }
  };
  walk(layer);
  return out;
}

/**
 * A booted client's world, at one rung, with a thruster burning on the camera
 * ship — the shipped wiring end to end: the renderer adopts the layer, the field
 * consumes a real `TELL.thrust` off the tell queue, and the layer draws the pool.
 */
function burnThruster(step: number) {
  const world = vfxWorld();
  const ship = world.ships[0]!;
  const stage = new Container();
  const baker = blankBaker();
  const renderer = new Renderer(stage, VFX_VIEW, { baker, resolution: 1 });
  const layer = new VfxLayer(new SpriteTextureCache(baker, 1));
  // The fix: the effects are a child of the world, not a sibling of it.
  renderer.addWorldLayer(layer);

  const field = new VfxField({ seed: 7 });
  const tells = new TellQueue();
  // The angle is the exhaust direction, which only steers where the plume
  // scatters — the placement claim below holds whichever way the ship is pointed.
  tells.push(TELL.thrust, ship.pos.x, ship.pos.y, ship.angle, 1, ship.id);
  field.consume(tells);
  field.update(1 / 60);

  renderer.setCameraScale(cameraScale(step));
  renderer.draw(world, { cameraTarget: ship.id, muzzles: [] });
  layer.draw(field.pool);

  return { renderer, layer, ship, particles: drawnParticles(layer) };
}

/** Where the renderer says a world point is on screen this frame. */
function projected(renderer: Renderer, world: { x: number; y: number }) {
  return renderer.projectToScreen(world, { x: 0, y: 0 });
}

/** Where PixiJS will actually put a sprite — the parent chain, resolved. */
function onScreen(sprite: Sprite) {
  const p = sprite.getGlobalPosition();
  return { x: p.x, y: p.y };
}

describe('the world the control zooms', () => {
  it('effects ride the camera scale', () => {
    for (const step of VIEW_ZOOM_STEPS) {
      const { renderer, ship, particles } = burnThruster(step);
      const scale = cameraScale(step);
      // A thruster at full throttle emits; if it did not, the rest asserts nothing.
      expect({ step, burning: particles.length > 0 }).toEqual({ step, burning: true });

      const emitter = projected(renderer, ship.pos);
      for (const { sprite, world } of particles) {
        // 1. The particle is drawn where the renderer says its world point IS.
        //    Two independent routes to one number — Pixi's parent chain and the
        //    renderer's own projection — so a layer carrying a transform of its
        //    own (which is how this broke) parts them.
        const at = onScreen(sprite);
        const want = projected(renderer, world);
        expect(at.x).toBeCloseTo(want.x, 6);
        expect(at.y).toBeCloseTo(want.y, 6);

        // 2. ...and so the gap between a particle and the emitter it came off
        //    shrinks by exactly the rung, which is the developer's report stated
        //    as arithmetic. No pixel constant: the world distance is whatever the
        //    emitter scattered, and the screen distance is that times the scale.
        const worldGap = Math.hypot(world.x - ship.pos.x, world.y - ship.pos.y);
        const screenGap = Math.hypot(at.x - emitter.x, at.y - emitter.y);
        expect(screenGap).toBeCloseTo(worldGap * scale, 4);
      }
    }
  });

  it('lands the effect on its emitter at every rung, not a fraction of the way there', () => {
    // The failure the developer could see: at 1.5× and 2× the burst was nowhere
    // near the ship. A thruster plume is emitted within a ship's own length of
    // the hull, so on screen it must stay within that same length SCALED — which
    // it cannot be if the layer is drawing at 1:1 inside a shrunken world.
    const REACH = 64; // world units the plume may trail behind the hull
    for (const step of VIEW_ZOOM_STEPS) {
      const { renderer, ship, particles } = burnThruster(step);
      const emitter = projected(renderer, ship.pos);
      const worst = Math.max(
        ...particles.map(({ sprite }) => {
          const at = onScreen(sprite);
          return Math.hypot(at.x - emitter.x, at.y - emitter.y);
        }),
      );
      expect({ step, onTheShip: worst <= REACH * cameraScale(step) }).toEqual({
        step,
        onTheShip: true,
      });
    }
  });

  it('floats the screen overlays off a SIZE the camera has scaled, not a world one', () => {
    // The second crossing of the same seam, found by sweeping the class rather
    // than the report (a0-80). A point and a length both cross world → screen, and
    // a0-74 carried only the point: the health bar, the nameplate and the lock
    // reticle each hang clear of an entity by a radius their contracts declare in
    // SCREEN px (`@ui/healthbar` `Combatant.radius`, `@ui/nameplates-view`,
    // `@ui/tap-markers`), and `main.ts` was handing them `ship.radius` — the same
    // number only while the camera was 1:1. `projectLength` is the length half of
    // `projectToScreen`, off the same live transform, so the two cannot disagree.
    for (const step of VIEW_ZOOM_STEPS) {
      const { renderer, ship } = burnThruster(step);
      const hull = ship.radius;
      // Two world points one hull-radius apart ARE the gap an over-ship bar has to
      // clear; projecting both and measuring is the long way round to the number
      // `projectLength` returns, so agreeing is the whole claim.
      const centre = projected(renderer, ship.pos);
      const rim = projected(renderer, { x: ship.pos.x + hull, y: ship.pos.y });
      expect(renderer.projectLength(hull)).toBeCloseTo(Math.hypot(rim.x - centre.x, rim.y - centre.y), 6);
      // ...and it is the rung, so a ship drawn half size gets half the clearance
      // instead of a bar floating a whole hull above it.
      expect(renderer.projectLength(hull)).toBeCloseTo(hull * cameraScale(step), 6);
    }
  });

  it('is why the effects are PARENTED to the world and not positioned beside it', () => {
    // The wiring this replaced, reconstructed: a layer hung beside the world
    // container and offset each frame from the camera read-back. It is exact at
    // 1× — which is why it shipped — and off by the whole of the zoom at every
    // other rung, in a world coordinate's proportion. That is a second owner of
    // one transform disagreeing with the first, so the fix is parentage; a scale
    // multiply at emission would just be the same two owners again.
    for (const step of VIEW_ZOOM_STEPS) {
      const { renderer, ship, particles } = burnThruster(step);
      const scale = cameraScale(step);
      const origin = projected(renderer, { x: 0, y: 0 }); // what the old code wrote
      const { world } = particles[0]!;
      const parked = { x: origin.x + world.x, y: origin.y + world.y };
      const correct = projected(renderer, world);
      const miss = Math.hypot(parked.x - correct.x, parked.y - correct.y);
      // |P| · (1 − s): nothing at 1×, half the distance from the arena origin at 2×.
      expect(miss).toBeCloseTo(Math.hypot(world.x, world.y) * (1 - scale), 4);
      expect(step === 1 ? miss : miss > ship.radius).toBe(step === 1 ? 0 : true);
    }
  });
});
