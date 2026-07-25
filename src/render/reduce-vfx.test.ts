/**
 * Reduce-VFX render tests (GDD §4.3, risk 5). When the platform's auto-reducer
 * engages on a sustained frame-rate drop, the renderer sheds the decorative VFX
 * (the plasma impact glow) to buy back frame time — but the load-bearing tells
 * (the beam line itself) keep drawing. Toggling the flag must be reversible
 * frame-to-frame with no teardown, using the same pooled Graphics.
 */
import { describe, it, expect } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { ShipClass } from '@shared/types';
import { Renderer, type BeamView } from './index';
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

const hit = { x: 950, y: 900 };
const hittingBeam: BeamView = { from: { x: 900, y: 900 }, to: hit, color: 0x4dc3ff, hit };

describe('Renderer.setReduceVfx', () => {
  it('drops the impact glow but keeps the beam line when reduced', () => {
    const stage = new Container();
    const r = new Renderer(stage, { width: 800, height: 600, originX: 0, originY: 0 });
    r.setReduceVfx(true);

    r.draw(world(), { cameraTarget: 0, beams: [hittingBeam] });

    expect(visible(layer(stage, 'impacts'))).toHaveLength(0); // glow shed
    expect(visible(layer(stage, 'beams'))).toHaveLength(1); // tell kept
  });

  it('is reversible frame-to-frame (glow returns when VFX are restored)', () => {
    const stage = new Container();
    const r = new Renderer(stage, { width: 800, height: 600, originX: 0, originY: 0 });

    // Full VFX: glow present.
    r.draw(world(), { cameraTarget: 0, beams: [hittingBeam] });
    expect(visible(layer(stage, 'impacts'))).toHaveLength(1);

    // Reduce: glow gone.
    r.setReduceVfx(true);
    r.draw(world(), { cameraTarget: 0, beams: [hittingBeam] });
    expect(visible(layer(stage, 'impacts'))).toHaveLength(0);

    // Restore: glow back, from the retained pool (not re-created wholesale).
    r.setReduceVfx(false);
    r.draw(world(), { cameraTarget: 0, beams: [hittingBeam] });
    expect(visible(layer(stage, 'impacts'))).toHaveLength(1);
  });

  it('defaults to full VFX (glow drawn) with no explicit toggle', () => {
    const stage = new Container();
    const r = new Renderer(stage, { width: 800, height: 600, originX: 0, originY: 0 });
    r.draw(world(), { cameraTarget: 0, beams: [hittingBeam] });
    expect(visible(layer(stage, 'impacts'))).toHaveLength(1);
  });
});
