/**
 * Reduce-VFX render tests (GDD §4.3, risk 5). When the platform's auto-reducer
 * engages on a sustained frame-rate drop, the renderer sheds the decorative VFX
 * (the plasma impact glow) to buy back frame time — but the load-bearing tells
 * (the muzzle-flash line itself) keep drawing. Toggling the flag must be reversible
 * frame-to-frame with no teardown, using the same pooled Graphics.
 */
import { describe, it, expect } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { ShipClass } from '@shared/types';
import { Renderer, type MuzzleView } from './index';
import { createWorld } from '../sim';

function world() {
  return createWorld({ seed: 1, players: [{ id: 0, shipClass: ShipClass.Vanguard }] });
}

function layer(stage: Container, label: string): Container {
  const l = stage.getChildByLabel(label, true);
  if (!l) throw new Error(`${label} layer missing`);
  return l as Container;
}

function visible(l: Container): Graphics[] {
  return l.children.filter((c) => c.visible) as Graphics[];
}

/**
 * A flash that strikes, placed relative to the camera target's own ship.
 *
 * Since a1-12 the renderer submits only what the window contains, and the camera
 * centres the target ship — so a flash at a fixed world point tests the cull, not
 * the reducer. Anchoring it to the ship keeps every case below about the one
 * thing it is for: which VFX the reducer sheds and which it must never shed.
 */
function hittingMuzzleIn(w: ReturnType<typeof world>): MuzzleView {
  const ship = w.ships[0]!;
  const from = { x: ship.pos.x, y: ship.pos.y };
  const hit = { x: ship.pos.x + 50, y: ship.pos.y };
  return { from, to: hit, color: 0x4dc3ff, hit };
}

describe('Renderer.setReduceVfx', () => {
  it('drops the impact glow but keeps the flash line when reduced', () => {
    const stage = new Container();
    const r = new Renderer(stage, { width: 800, height: 600, originX: 0, originY: 0 });
    r.setReduceVfx(true);
    const w = world();

    r.draw(w, { cameraTarget: 0, muzzles: [hittingMuzzleIn(w)] });

    expect(visible(layer(stage, 'impacts'))).toHaveLength(0); // glow shed
    expect(visible(layer(stage, 'muzzles'))).toHaveLength(1); // tell kept
  });

  it('is reversible frame-to-frame (glow returns when VFX are restored)', () => {
    const stage = new Container();
    const r = new Renderer(stage, { width: 800, height: 600, originX: 0, originY: 0 });

    const w = world();
    const flash = hittingMuzzleIn(w);

    // Full VFX: glow present.
    r.draw(w, { cameraTarget: 0, muzzles: [flash] });
    expect(visible(layer(stage, 'impacts'))).toHaveLength(1);

    // Reduce: glow gone.
    r.setReduceVfx(true);
    r.draw(w, { cameraTarget: 0, muzzles: [flash] });
    expect(visible(layer(stage, 'impacts'))).toHaveLength(0);

    // Restore: glow back, from the retained pool (not re-created wholesale).
    r.setReduceVfx(false);
    r.draw(w, { cameraTarget: 0, muzzles: [flash] });
    expect(visible(layer(stage, 'impacts'))).toHaveLength(1);
  });

  it('defaults to full VFX (glow drawn) with no explicit toggle', () => {
    const stage = new Container();
    const r = new Renderer(stage, { width: 800, height: 600, originX: 0, originY: 0 });
    const w = world();
    r.draw(w, { cameraTarget: 0, muzzles: [hittingMuzzleIn(w)] });
    expect(visible(layer(stage, 'impacts'))).toHaveLength(1);
  });
});
