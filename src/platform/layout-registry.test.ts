/**
 * src/platform/layout-registry.test.ts — the LAYOUT REGISTRY contract.
 *
 * Two things this proves (the brief's Vitest asks): the **registry shape** — an
 * element registers `{ id, anchor, bounds }`, entries refresh per frame, and the
 * read-only `__planetRush` hook exposes frozen snapshots — and that the anchor
 * vocabulary resolves to the zones documented in the file header, so
 * `withinAnchor` is a real, executable "it appears where it's supposed to" check.
 *
 * Pure and DOM-free (the registry never touches a browser global; the hook takes
 * an injectable target), so it runs in the `node` vitest environment.
 */

import { describe, it, expect } from 'vitest';
import {
  LayoutRegistry,
  resolveAnchor,
  rectContains,
  parseDebugFlags,
  installLayoutHook,
  isLayoutContributor,
  DEFAULT_STRIP_HEIGHT,
  type Rect,
  type Viewport,
  type LayoutEntry,
  type HookTarget,
  type PlanetRushDebug,
} from './layout-registry';

const VP: Viewport = { width: 1200, height: 800 };

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

// ---------------------------------------------------------------------------
// Registry shape
// ---------------------------------------------------------------------------

describe('LayoutRegistry — shape', () => {
  it('stores id + anchor + bounds and returns them via get/entries', () => {
    const reg = new LayoutRegistry();
    reg.beginFrame();
    reg.register('ore-hud', { region: 'top-left', margin: 16 }, rect(16, 16, 120, 40));

    const entry = reg.get('ore-hud');
    expect(entry).toBeDefined();
    expect(entry!.id).toBe('ore-hud');
    expect(entry!.anchor).toEqual({ region: 'top-left', margin: 16 });
    expect(entry!.bounds).toEqual({ x: 16, y: 16, width: 120, height: 40 });
    expect(reg.entries()).toHaveLength(1);
  });

  it('copies bounds — mutating the caller\'s rect after register does not leak in', () => {
    const reg = new LayoutRegistry();
    reg.beginFrame();
    const scratch = rect(0, 0, 10, 10);
    reg.register('a', { region: 'center' }, scratch);
    scratch.x = 999; // caller reuses the scratch rect for the next element
    expect(reg.get('a')!.bounds.x).toBe(0);
  });

  it('defaults a missing margin to 0', () => {
    const reg = new LayoutRegistry();
    reg.beginFrame();
    reg.register('a', { region: 'center' }, rect(0, 0, 1, 1));
    expect(reg.get('a')!.anchor.margin).toBe(0);
  });

  it('updates an element in place across frames (id is stable)', () => {
    const reg = new LayoutRegistry();
    reg.beginFrame();
    reg.register('ship-local', { region: 'center' }, rect(100, 100, 32, 32));
    reg.beginFrame();
    reg.register('ship-local', { region: 'center' }, rect(200, 200, 32, 32));
    expect(reg.entries()).toHaveLength(1);
    expect(reg.get('ship-local')!.bounds.x).toBe(200);
  });

  it('drops elements not re-registered this frame (per-frame refresh)', () => {
    const reg = new LayoutRegistry();
    reg.beginFrame();
    reg.register('fire-button', { region: 'right-half-bottom' }, rect(0, 0, 84, 84));
    expect(reg.get('fire-button')).toBeDefined();

    // Next frame: the FIRE button isn't drawn (Manual mode) → not re-registered.
    reg.beginFrame();
    expect(reg.get('fire-button')).toBeUndefined();
    expect(reg.entries()).toHaveLength(0);
  });

  it('clear() empties the registry', () => {
    const reg = new LayoutRegistry();
    reg.beginFrame();
    reg.register('a', { region: 'center' }, rect(0, 0, 1, 1));
    reg.clear();
    expect(reg.entries()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Anchor resolution — the documented vocabulary
// ---------------------------------------------------------------------------

describe('resolveAnchor — the ratified anchor vocabulary', () => {
  it('top-left is the top-left corner zone, inset by the margin', () => {
    const z = resolveAnchor({ region: 'top-left', margin: 16 }, VP);
    // left ∩ top zone = [0,W/2]×[0,H/3], inset 16 on the left+top screen edges.
    expect(z).toEqual({ x: 16, y: 16, width: 1200 / 2 - 16, height: 800 / 3 - 16 });
  });

  it('top-center spans the centre third and insets all four edges', () => {
    const z = resolveAnchor({ region: 'top-center', margin: 10 }, VP);
    expect(z.x).toBeCloseTo(1200 / 3 + 10);
    expect(z.y).toBe(10);
    expect(z.width).toBeCloseTo(1200 / 3 - 20);
    expect(z.height).toBeCloseTo(800 / 3 - 20);
  });

  it('bottom-strip is a full-width band of stripHeight along the bottom', () => {
    const z = resolveAnchor({ region: 'bottom-strip' }, VP, { stripHeight: 50 });
    expect(z).toEqual({ x: 0, y: 800 - 50, width: 1200, height: 50 });
  });

  it('bottom-strip defaults to DEFAULT_STRIP_HEIGHT', () => {
    const z = resolveAnchor({ region: 'bottom-strip' }, VP);
    expect(z.height).toBe(DEFAULT_STRIP_HEIGHT);
    expect(z.y).toBe(800 - DEFAULT_STRIP_HEIGHT);
  });

  it('right-half-bottom is the bottom of the right half', () => {
    const z = resolveAnchor({ region: 'right-half-bottom' }, VP);
    expect(z).toEqual({ x: 600, y: 400, width: 600, height: 400 });
  });

  it('center is the middle third on both axes', () => {
    const z = resolveAnchor({ region: 'center' }, VP);
    expect(z.x).toBeCloseTo(400);
    expect(z.y).toBeCloseTo(800 / 3);
    expect(z.width).toBeCloseTo(400);
    expect(z.height).toBeCloseTo(800 / 3);
  });

  it('full is the whole viewport', () => {
    expect(resolveAnchor({ region: 'full' }, VP)).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
  });

  it('never returns a negative extent when the margin exceeds the zone', () => {
    const z = resolveAnchor({ region: 'center', margin: 10000 }, VP);
    expect(z.width).toBe(0);
    expect(z.height).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// withinAnchor — the executable "it appears there"
// ---------------------------------------------------------------------------

describe('rectContains / withinAnchor', () => {
  it('accepts a rect inside the zone and rejects one straddling the edge', () => {
    const zone = rect(0, 0, 100, 100);
    expect(rectContains(zone, rect(10, 10, 20, 20))).toBe(true);
    expect(rectContains(zone, rect(90, 90, 20, 20))).toBe(false);
  });

  it('allows sub-pixel tolerance so rounding never trips a check', () => {
    const zone = rect(0, 0, 100, 100);
    expect(rectContains(zone, rect(-0.3, 0, 100, 100))).toBe(true); // within 0.5 slop
    expect(rectContains(zone, rect(-2, 0, 100, 100))).toBe(false);
  });

  it('flags an element that drifts out of its declared anchor', () => {
    const reg = new LayoutRegistry();
    reg.beginFrame();
    // A wave clock correctly in the top-centre zone…
    reg.register('wave-clock', { region: 'top-center' }, rect(560, 20, 80, 50));
    expect(reg.withinAnchor('wave-clock', VP)).toBe(true);

    // …and one that has drifted into the bottom-left (the positional bug class).
    reg.beginFrame();
    reg.register('wave-clock', { region: 'top-center' }, rect(20, 700, 80, 50));
    expect(reg.withinAnchor('wave-clock', VP)).toBe(false);
  });

  it('returns undefined for an id not registered this frame', () => {
    const reg = new LayoutRegistry();
    reg.beginFrame();
    expect(reg.withinAnchor('nope', VP)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Debug flags
// ---------------------------------------------------------------------------

describe('parseDebugFlags', () => {
  it('reads ?debug=1', () => {
    expect(parseDebugFlags('?debug=1')).toEqual({ debug: true, freeze: false });
  });
  it('reads ?debug=1&freeze=1', () => {
    expect(parseDebugFlags('?debug=1&freeze=1')).toEqual({ debug: true, freeze: true });
  });
  it('gates freeze behind debug — ?freeze=1 alone does nothing', () => {
    expect(parseDebugFlags('?freeze=1')).toEqual({ debug: false, freeze: false });
  });
  it('tolerates a missing leading ? and an empty string', () => {
    expect(parseDebugFlags('debug=1')).toEqual({ debug: true, freeze: false });
    expect(parseDebugFlags('')).toEqual({ debug: false, freeze: false });
  });
});

// ---------------------------------------------------------------------------
// The read-only debug hook
// ---------------------------------------------------------------------------

describe('installLayoutHook — read-only window.__planetRush', () => {
  function setup() {
    const reg = new LayoutRegistry();
    const state = {
      registry: reg,
      viewport: () => VP,
      frozen: () => false,
      freezeTick: () => null as number | null,
      worldHash: () => null as string | null,
    };
    const target: HookTarget = {};
    installLayoutHook(state, target);
    return { reg, state, target };
  }

  it('installs a frozen surface at __planetRush', () => {
    const { target } = setup();
    expect(target.__planetRush).toBeDefined();
    expect(Object.isFrozen(target.__planetRush)).toBe(true);
  });

  it('exposes the current frame\'s entries as deep-frozen snapshots', () => {
    const { reg, target } = setup();
    reg.beginFrame();
    reg.register('ore-hud', { region: 'top-left', margin: 16 }, rect(16, 16, 100, 40));

    const layout = target.__planetRush!.layout;
    expect(layout).toHaveLength(1);
    const e = layout[0]!;
    expect(e.id).toBe('ore-hud');
    expect(Object.isFrozen(e)).toBe(true);
    expect(Object.isFrozen(e.bounds)).toBe(true);
    expect(Object.isFrozen(e.anchor)).toBe(true);
  });

  it('reading the hook cannot mutate registry state', () => {
    const { reg, target } = setup();
    reg.beginFrame();
    reg.register('a', { region: 'center' }, rect(1, 2, 3, 4));

    const snap = target.__planetRush!.layout[0]!;
    expect(() => {
      (snap.bounds as Rect).x = 999;
    }).toThrow(); // frozen — strict mode throws on write

    // The registry's own copy is untouched regardless.
    expect(reg.get('a')!.bounds.x).toBe(1);
  });

  it('resolveAnchor and viewport read live host state', () => {
    const { target } = setup();
    const zone = target.__planetRush!.resolveAnchor({ region: 'full' });
    expect(zone).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
    expect(target.__planetRush!.viewport).toEqual(VP);
  });

  it('placement() reports per-element in-zone truth', () => {
    const { reg, target } = setup();
    reg.beginFrame();
    reg.register('good', { region: 'top-center' }, rect(560, 20, 80, 50));
    reg.register('bad', { region: 'top-center' }, rect(10, 700, 80, 50));
    const placement = target.__planetRush!.placement();
    expect(placement).toContainEqual({ id: 'good', ok: true });
    expect(placement).toContainEqual({ id: 'bad', ok: false });
  });

  it('surfaces freeze status read live from the host', () => {
    const reg = new LayoutRegistry();
    let frozen = false;
    const target: HookTarget = {};
    installLayoutHook(
      {
        registry: reg,
        viewport: () => VP,
        frozen: () => frozen,
        freezeTick: () => (frozen ? 120 : null),
        worldHash: () => (frozen ? 'deadbeef' : null),
      },
      target,
    );
    expect(target.__planetRush!.frozen).toBe(false);
    expect(target.__planetRush!.worldHash).toBeNull();
    frozen = true;
    expect(target.__planetRush!.frozen).toBe(true);
    expect(target.__planetRush!.freezeTick).toBe(120);
    expect(target.__planetRush!.worldHash).toBe('deadbeef');
  });

  // Co-tenancy with the camera debug hook (src/platform/debug-hook.ts). Under
  // `?debug=1` BOTH instruments share window.__planetRush; the camera hook is
  // installed first, READ-ONLY (defineProperty, non-writable/non-configurable).
  // A plain re-assign would throw in strict mode and abort boot — this pins the
  // additive install that avoids it.
  it('extends an existing read-only __planetRush without clobbering or throwing', () => {
    const reg = new LayoutRegistry();
    reg.beginFrame();
    reg.register('ore-hud', { region: 'top-left', margin: 16 }, rect(16, 16, 100, 40));

    // Stand in for the camera hook: a read-only handle to a live-updated object
    // whose `viewport` is the camera's {w,h} shape (distinct from layout's).
    const cameraState = { shipScreen: { x: 5, y: 7 }, viewport: { w: 844, h: 390 }, fps: 60 };
    const target: Record<string, unknown> = {};
    Object.defineProperty(target, '__planetRush', {
      value: cameraState,
      writable: false,
      configurable: false,
      enumerable: true,
    });

    // The layout hook must NOT throw here (the boot-aborting bug), and must merge.
    expect(() =>
      installLayoutHook(
        {
          registry: reg,
          viewport: () => VP,
          frozen: () => false,
          freezeTick: () => null,
          worldHash: () => null,
        },
        target as unknown as HookTarget,
      ),
    ).not.toThrow();

    // Same shared object; the camera hook's keys are intact (viewport is the
    // {w,h} shape it owns, not overwritten by layout's Viewport getter)…
    expect(target.__planetRush).toBe(cameraState);
    expect((target.__planetRush as unknown as typeof cameraState).viewport).toEqual({ w: 844, h: 390 });
    expect((target.__planetRush as unknown as typeof cameraState).shipScreen).toEqual({ x: 5, y: 7 });
    // …and the layout surface's own keys are now additively present.
    const merged = target.__planetRush as unknown as PlanetRushDebug;
    expect(merged.layout).toHaveLength(1);
    expect(merged.layout[0]!.id).toBe('ore-hud');
    expect(merged.resolveAnchor({ region: 'full' })).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
  });
});

// ---------------------------------------------------------------------------
// The UI coordination seam
// ---------------------------------------------------------------------------

describe('isLayoutContributor', () => {
  it('detects a public describeLayout() method', () => {
    const contributor = { describeLayout: (_vp: Viewport): LayoutEntry[] => [] };
    expect(isLayoutContributor(contributor)).toBe(true);
  });
  it('rejects objects without the seam', () => {
    expect(isLayoutContributor({})).toBe(false);
    expect(isLayoutContributor(null)).toBe(false);
    expect(isLayoutContributor('describeLayout')).toBe(false);
  });
});
