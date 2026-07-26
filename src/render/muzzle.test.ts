/**
 * Muzzle-flash render tests (GDD §4.1; §2.6). The sim's `muzzleFlashes` read
 * model publishes each firing turret's flash geometry — origin, direction, the
 * aimed hit and its clamped length — and the renderer must draw the line ending
 * at that hit (never through the struck object) with a pooled plasma impact glow
 * riding the hit point. A clean miss runs full range with no glow.
 *
 * These drive the renderer with plain `MuzzleView`s (the render-layer contract),
 * no WebGL: Pixi builds Graphics geometry headlessly, so we assert on the
 * container tree the renderer maintains.
 */
import { describe, it, expect } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { ShipClass } from '@shared/types';
import { Renderer, type MuzzleView } from './index';
import { createWorld } from '../sim';

// A one-ship world is enough scenery for the muzzle layer; the flash itself is
// supplied through the RenderView, independent of world contents.
function world() {
  return createWorld({ seed: 1, players: [{ id: 0, shipClass: ShipClass.Vanguard }] });
}

function impactLayer(stage: Container): Container {
  const layer = stage.getChildByLabel('impacts', true);
  if (!layer) throw new Error('impacts layer missing');
  return layer as Container;
}

function muzzleLayer(stage: Container): Container {
  const layer = stage.getChildByLabel('muzzles', true);
  if (!layer) throw new Error('muzzles layer missing');
  return layer as Container;
}

function visibleChildren(layer: Container): Graphics[] {
  return layer.children.filter((c) => c.visible) as Graphics[];
}

describe('muzzle-flash impact glow (§2.6 clamp)', () => {
  it('draws a pooled plasma glow at the hit point when the flash strikes', () => {
    const stage = new Container();
    const r = new Renderer(stage, { width: 800, height: 600, originX: 0, originY: 0 });
    const hit = { x: 950, y: 900 };
    const muzzle: MuzzleView = { from: { x: 900, y: 900 }, to: hit, color: 0x4dc3ff, hit };

    r.draw(world(), { cameraTarget: 0, muzzles: [muzzle] });

    const glows = visibleChildren(impactLayer(stage));
    expect(glows).toHaveLength(1);
    // The glow rides the hit point exactly — the end of the clamped flash.
    expect(glows[0]!.x).toBe(hit.x);
    expect(glows[0]!.y).toBe(hit.y);
    // And the flash line itself is drawn (one visible segment).
    expect(visibleChildren(muzzleLayer(stage))).toHaveLength(1);
  });

  it('draws no glow on a clean miss (hit === null, full-range flash)', () => {
    const stage = new Container();
    const r = new Renderer(stage, { width: 800, height: 600, originX: 0, originY: 0 });
    const muzzle: MuzzleView = {
      from: { x: 900, y: 900 },
      to: { x: 1160, y: 900 }, // full range, nothing struck
      color: 0x4dc3ff,
      hit: null,
    };

    r.draw(world(), { cameraTarget: 0, muzzles: [muzzle] });

    expect(visibleChildren(impactLayer(stage))).toHaveLength(0);
    // The flash line still draws to its full-range endpoint.
    expect(visibleChildren(muzzleLayer(stage))).toHaveLength(1);
  });

  it('hides the glow again once the flash stops hitting (pool reuse)', () => {
    const stage = new Container();
    const r = new Renderer(stage, { width: 800, height: 600, originX: 0, originY: 0 });
    const hit = { x: 950, y: 900 };

    r.draw(world(), {
      cameraTarget: 0,
      muzzles: [{ from: { x: 900, y: 900 }, to: hit, color: 0x4dc3ff, hit }],
    });
    expect(visibleChildren(impactLayer(stage))).toHaveLength(1);

    // Next frame: nothing firing → no flashes, no glows, but the pooled
    // Graphics is retained (hidden, not destroyed).
    r.draw(world(), { cameraTarget: 0, muzzles: [] });
    const layer = impactLayer(stage);
    expect(visibleChildren(layer)).toHaveLength(0);
    expect(layer.children.length).toBeGreaterThanOrEqual(1); // kept for reuse
  });

  it('glows only for the flashes that hit when several fire at once', () => {
    const stage = new Container();
    const r = new Renderer(stage, { width: 800, height: 600, originX: 0, originY: 0 });
    const hitA = { x: 950, y: 900 };
    const hitC = { x: 900, y: 950 };
    const muzzles: MuzzleView[] = [
      { from: { x: 900, y: 900 }, to: hitA, color: 0x4dc3ff, hit: hitA },
      { from: { x: 900, y: 900 }, to: { x: 1160, y: 900 }, color: 0x4dc3ff, hit: null },
      { from: { x: 900, y: 900 }, to: hitC, color: 0x4dc3ff, hit: hitC },
    ];

    r.draw(world(), { cameraTarget: 0, muzzles });

    const glows = visibleChildren(impactLayer(stage));
    expect(glows).toHaveLength(2);
    expect(visibleChildren(muzzleLayer(stage))).toHaveLength(3);
  });
});
