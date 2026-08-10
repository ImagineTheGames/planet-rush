/**
 * src/art/backdrop-reducer.test.ts — the sky survives the reducer. OWNER: Art Agent.
 *
 * **r9-01.** On the served build `dd1d3f5`, two live boots ran side by side on
 * one box for 40 s, polling the Pixi scene graph once a second. The Oval booted
 * **with** `void-nebula-plasmaReef` on the stage, held it for three polls, and at
 * **t+8.3 s the layer was gone** — it never came back. Line, the control on the
 * same box under the same load, kept `void-nebula-deepEmber` for the full 40 s.
 * The mechanism was one line in `VoidBackdrop.configure`:
 *
 *     const density = this.reduced ? this.nebula.reducedDensity : 1;
 *     const drawSky = this.nebula.id !== 'none' && density > 0;
 *
 * and Plasma Reef declared `reducedDensity: 0`. So `VfxAutoQuality` engaging —
 * three sustained seconds under 30 fps, which is a *warm laptop*, not a broken
 * one — deleted a whole sky out of the frame in one frame.
 *
 * `backdrop.test.ts` measures geometry and is deliberately DOM-free. This file is
 * the other half: it drives the real {@link VoidBackdrop} through real Pixi
 * containers and asserts about **what is on the stage**, which is the only place
 * the defect was ever visible. Every test here fails on the code as it stood.
 *
 * The two rules under test, and why they are two:
 *
 *  1. **The floor** ({@link SKY_REDUCED_FLOOR}) — a throttled sky is thinner,
 *     never absent. Without it, a device that boots *already* throttled (the
 *     manual reduce-VFX setting is on from frame one) would fly The Oval with no
 *     reef at all, which is a quieter version of the same loss.
 *  2. **The pin** — the tier is read once, when the sky goes on the stage. Without
 *     it, the floor alone still steps the sky from 22 wisps to 10 in one frame,
 *     mid-match, in front of a player; and because a sky's element count seeds
 *     its own layout, several of the six do not merely thin at a lower density —
 *     they *re-scatter*, so the whole sky would change at once. The pin makes the
 *     transition land before the match instead of during it.
 */

import { describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import {
  MAP_NEBULA,
  NEBULAE,
  NEBULA_IDS,
  SKY_REDUCED_FLOOR,
  VoidBackdrop,
  reducedSkyDensity,
  type MapId,
  type NebulaId,
} from './backdrop';

/** A phone viewport over the widest arena in the set — The Oval's own numbers. */
const VIEW = { w: 844, h: 390 } as const;
const BOUNDS = { w: 3200, h: 2000 } as const;

/** Every `void-nebula-*` child on the stage, by sky id — the exact read the live
 *  probe takes off the scene graph, so the unit test and the evidence agree on
 *  what "the sky is on the stage" means. */
function skyLayers(b: VoidBackdrop): NebulaId[] {
  return (b.view.children as Container[])
    .map((c) => c.label ?? '')
    .filter((l) => l.startsWith('void-nebula-'))
    .map((l) => l.replace('void-nebula-', '') as NebulaId);
}

/** Boot a backdrop on a map and draw one frame's worth of configure. */
function boot(mapId: MapId, reduced = false): VoidBackdrop {
  const b = new VoidBackdrop();
  b.setMap(mapId);
  if (reduced) b.setReduceVfx(true);
  b.configure(BOUNDS.w, BOUNDS.h, VIEW.w, VIEW.h);
  return b;
}

describe('the reducer may thin a sky and may never take it off the stage', () => {
  /**
   * The failing-without-the-fix test the brief asks for, in the shape the live
   * boot found the bug in: build the sky, then throttle, then keep going.
   */
  it('keeps the sky on the stage when the reducer engages mid-match', () => {
    const oval = boot('oval');
    expect(skyLayers(oval), 'The Oval boots with its reef').toEqual(['plasmaReef']);

    // t+8.3s on the real box: VfxAutoQuality engages. The renderer calls this
    // every frame and then configures every frame — that is the whole event.
    oval.setReduceVfx(true);
    for (let frame = 0; frame < 120; frame++) oval.configure(BOUNDS.w, BOUNDS.h, VIEW.w, VIEW.h);

    expect(skyLayers(oval), 'and it is still there two seconds later').toEqual(['plasmaReef']);
  });

  it('holds every sky through the engage, not just the one that was measured', () => {
    // a1-07 watched two arenas. The other four were never measured over time, so
    // they are asserted here rather than assumed.
    for (const [mapId, nebulaId] of Object.entries(MAP_NEBULA) as [MapId, NebulaId][]) {
      const b = boot(mapId);
      const before = skyLayers(b);
      b.setReduceVfx(true);
      b.configure(BOUNDS.w, BOUNDS.h, VIEW.w, VIEW.h);
      expect(skyLayers(b), `${mapId} (${nebulaId}) survives the engage`).toEqual(before);
      // None is the only empty one, and it is empty at both tiers — a sky that was
      // never there, not one that left.
      expect(before, `${mapId} carries ${nebulaId}`).toEqual(nebulaId === 'none' ? [] : [nebulaId]);
    }
  });

  it('does not even rebuild when the tier flips — the pin is the rebuild key', () => {
    // The rebuild was itself a defect: destroying and re-baking every layer's
    // geometry at the exact moment frames are already bad is a hitch on top of a
    // stall. Identity of the Graphics objects is the assertion — nothing was
    // discarded and replayed.
    const oval = boot('oval');
    const before = [...oval.view.children];
    oval.setReduceVfx(true);
    oval.configure(BOUNDS.w, BOUNDS.h, VIEW.w, VIEW.h);
    oval.setReduceVfx(false);
    oval.configure(BOUNDS.w, BOUNDS.h, VIEW.w, VIEW.h);
    expect(oval.view.children).toEqual(before);
  });

  it('survives a resize while throttled — the reflow rebuilds the same sky', () => {
    // A mobile URL-bar reflow rebuilds the backdrop for its own reasons. Under the
    // old code that rebuild read the live tier and was a second way to lose the
    // layer, so the pin has to outlive a genuine rebuild, not just a no-op frame.
    const oval = boot('oval');
    const d = oval.skyDensity;
    oval.setReduceVfx(true);
    oval.configure(BOUNDS.w, BOUNDS.h, VIEW.w, VIEW.h - 60);
    expect(skyLayers(oval), 'still a reef after the reflow').toEqual(['plasmaReef']);
    expect(oval.skyDensity, 'and at the density it was committed to').toBe(d);
  });
});

describe('what a throttled boot gets: a thinner sky, never an absent one', () => {
  it('builds the reduced density when the tier is already on at build time', () => {
    const oval = boot('oval', true);
    expect(skyLayers(oval), 'a throttled boot still has a reef').toEqual(['plasmaReef']);
    expect(oval.skyDensity).toBe(reducedSkyDensity(NEBULAE.plasmaReef));
    expect(oval.skyDensity).toBeGreaterThanOrEqual(SKY_REDUCED_FLOOR);
  });

  it('gives every map a sky at both tiers (except the one whose sky is none)', () => {
    for (const [mapId, nebulaId] of Object.entries(MAP_NEBULA) as [MapId, NebulaId][]) {
      const want = nebulaId === 'none' ? [] : [nebulaId];
      expect(skyLayers(boot(mapId, false)), `${mapId} at full VFX`).toEqual(want);
      expect(skyLayers(boot(mapId, true)), `${mapId} throttled`).toEqual(want);
    }
  });

  it('pins full density at full VFX, so nothing about the ratified look moves', () => {
    for (const id of NEBULA_IDS) {
      const map = (Object.keys(MAP_NEBULA) as MapId[]).find((m) => MAP_NEBULA[m] === id)!;
      expect(boot(map).skyDensity, `${id} unthrottled`).toBe(1);
    }
  });
});

describe('the pin is released by a new sky, not by the tier', () => {
  it('lets the next map read the current tier', () => {
    const b = boot('oval');
    expect(b.skyDensity).toBe(1);

    // Throttled, then the match ends and the player picks Line. Nobody is looking
    // at the new sky yet, so it is entitled to boot thin.
    b.setReduceVfx(true);
    b.setMap('line');
    b.configure(BOUNDS.w, BOUNDS.h, VIEW.w, VIEW.h);
    expect(skyLayers(b)).toEqual(['deepEmber']);
    expect(b.skyDensity).toBe(reducedSkyDensity(NEBULAE.deepEmber));
  });

  it('does not release on a same-map setMap (the renderer calls it every frame)', () => {
    const b = boot('oval');
    b.setReduceVfx(true);
    for (let frame = 0; frame < 60; frame++) {
      b.setMap('oval');
      b.configure(BOUNDS.w, BOUNDS.h, VIEW.w, VIEW.h);
    }
    expect(b.skyDensity, 'still the density it booted with').toBe(1);
    expect(skyLayers(b)).toEqual(['plasmaReef']);
  });

  it('releases on destroy — a torn-down stage has nobody looking at it', () => {
    const b = boot('oval');
    b.setReduceVfx(true);
    b.destroy();
    expect(skyLayers(b)).toEqual([]);
    b.configure(BOUNDS.w, BOUNDS.h, VIEW.w, VIEW.h);
    expect(skyLayers(b), 'and it comes back thin, not missing').toEqual(['plasmaReef']);
    expect(b.skyDensity).toBe(reducedSkyDensity(NEBULAE.plasmaReef));
  });
});
