/**
 * src/ui/menu-backdrop.test.ts — the sky behind the menus, headless.
 *
 * Three claims, and each one is a thing that fails SILENTLY if it breaks:
 *
 *  - **it is the real void.** A second star field painted in CSS or in a local
 *    `Graphics` would look approximately right and drift from the game's own sky
 *    forever after — the exact disagreement between instrument and game that made
 *    the bloom take five rounds. So the sky on the stage is asserted to be a
 *    `VoidBackdrop` sky, by the layer labels the backdrop itself writes.
 *  - **it is BAKED.** A menu backdrop that quietly stops caching is pixel-identical
 *    and 2.33 blended screenfuls a frame more expensive (a0-75's counted fill) —
 *    which is precisely the failure mode a0-75 was reported as, one screen over.
 *  - **it is cropped to the screen.** The parallax layers are provisioned to cover
 *    a roaming camera, so the natural bake is ~7× the texture for no extra pixel
 *    on the glass.
 *
 * Pixi's scene graph is headless up to rasterisation, so all of this runs with no
 * canvas — the same discipline `src/art/backdrop-fill.test.ts` uses on the same
 * object.
 */

import { describe, expect, it } from 'vitest';
import type { Container } from 'pixi.js';
import { MAP_NEBULA, VoidBackdrop } from '../art/backdrop';
import {
  MENU_BAKE_MAX_TEXELS,
  menuSkyEnabled,
  MENU_SKY,
  MENU_SKY_MAP,
  MenuBackdrop,
  menuBakeResolution,
} from './menu-backdrop';

/** The developer's screenshot viewport, and the ultrawide the brief names. */
const PHONE = { w: 798, h: 384 };
const ULTRAWIDE = { w: 3440, h: 1440 };

const labels = (c: Container): string[] => c.children.map((k) => (k as Container).label ?? '');

describe('the sky the menus fly under', () => {
  it('is a NAMED sky, looked up in the map registry rather than left to the default', () => {
    // `MENU_SKY_MAP` is DERIVED from `MENU_SKY`, so this is not a tautology: it
    // fails the moment no map in `MAP_NEBULA` carries the menu's sky any more, at
    // which point the lookup falls back to the first map and the front of the
    // game would quietly fly under whatever that map's sky happens to be.
    expect(MAP_NEBULA[MENU_SKY_MAP]).toBe(MENU_SKY);
  });

  it('is not `none` — which is exactly what the default would have given it', () => {
    // `VoidBackdrop` starts on the default map, and the default map's sky is
    // `none`. A menu that simply took the default would have shipped stars on a
    // ground and no sky at all, which is not what was asked for.
    expect(MAP_NEBULA.octagon).toBe('none');
    expect(MENU_SKY).not.toBe('none');
  });

  it('puts the REAL void on the stage — the game\'s own layers, not a second field', () => {
    const backdrop = new MenuBackdrop();
    backdrop.resize(PHONE.w, PHONE.h);
    // One `VoidBackdrop.view` under the wrapper, carrying the backdrop's own
    // layer labels: the ground, the star layers, and the map's sky.
    const view = backdrop.children[0] as Container;
    expect(view.label).toBe('void-backdrop');
    const names = labels(view);
    expect(names).toContain('void-ground');
    expect(names.filter((n) => n.startsWith('void-stars-')).length).toBeGreaterThan(0);
    expect(names).toContain(`void-nebula-${MENU_SKY}`);
    expect(backdrop.nebulaId).toBe(MENU_SKY);
    backdrop.destroy();
  });

  it('builds the same layers the MATCH builds, one for one', () => {
    // The claim "one star field" in the module header, asserted rather than
    // asserted-in-a-comment: the menu's stage is the match's stage for the same
    // sky, so nothing here can drift from the game.
    const menu = new MenuBackdrop();
    menu.resize(PHONE.w, PHONE.h);
    const match = new VoidBackdrop();
    match.setMap(MENU_SKY_MAP);
    match.configure(PHONE.w, PHONE.h, PHONE.w, PHONE.h);
    expect(labels(menu.children[0] as Container)).toEqual(labels(match.view));
    menu.destroy();
    match.destroy();
  });
});

describe('a menu is static, so the void is a still frame', () => {
  for (const vp of [PHONE, ULTRAWIDE]) {
    it(`bakes once at ${vp.w}x${vp.h} and blits thereafter`, () => {
      const backdrop = new MenuBackdrop(1);
      expect(backdrop.baked).toBe(false);
      backdrop.resize(vp.w, vp.h);
      expect(backdrop.baked).toBe(true);
      backdrop.destroy();
    });

    it(`crops the bake to the SCREEN at ${vp.w}x${vp.h}, not to the parallax field`, () => {
      const backdrop = new MenuBackdrop(1);
      backdrop.resize(vp.w, vp.h);
      // `cacheAsTexture` sizes its texture from `getLocalBounds()`, which honours
      // `boundsArea`. Without it the field — provisioned to cover a roaming
      // camera — would be several screens across in each axis.
      const bounds = backdrop.getLocalBounds();
      expect(bounds.width).toBeCloseTo(vp.w, 5);
      expect(bounds.height).toBeCloseTo(vp.h, 5);
      backdrop.destroy();
    });
  }

  it('re-bakes on a resize and does NOT re-bake on a no-op', () => {
    const backdrop = new MenuBackdrop(1);
    backdrop.resize(PHONE.w, PHONE.h);
    const first = backdrop.getLocalBounds().width;
    // Same size again: the shell calls `resize` from `relayout()`, which fires on
    // every `visualViewport` twitch a mobile URL bar produces. Re-baking there
    // would be a render-to-texture per scroll event.
    backdrop.resize(PHONE.w, PHONE.h);
    expect(backdrop.getLocalBounds().width).toBe(first);
    // A real change: the bake must follow, or the menu blits a stale-sized screen.
    backdrop.resize(ULTRAWIDE.w, ULTRAWIDE.h);
    expect(backdrop.getLocalBounds().width).toBeCloseTo(ULTRAWIDE.w, 5);
    expect(backdrop.baked).toBe(true);
    backdrop.destroy();
  });

  it('drops the bake before it destroys, so a dragged window does not leak', () => {
    // A cached render group holds a POOLED render texture. Destroying the
    // container with the cache still on leaves that texture in the pool keyed to
    // a render group that no longer exists — a0-75 hit exactly this on the match
    // backdrop, and a resize storm is what turns it into a leak.
    const backdrop = new MenuBackdrop(1);
    for (let w = 800; w < 812; w++) backdrop.resize(w, 400);
    expect(backdrop.baked).toBe(true);
    backdrop.destroy();
    expect(backdrop.baked).toBe(false);
  });

  it('survives a zero-extent viewport rather than baking a backwards texture', () => {
    const backdrop = new MenuBackdrop(1);
    backdrop.resize(0, 0);
    expect(backdrop.baked).toBe(false);
    backdrop.destroy();
  });
});

describe('the bake resolution is a memory budget, not a look', () => {
  it('bakes a phone at its FULL device resolution — the budget does not bite there', () => {
    // 798×384 at dpr 3 is 2.76 Mtexels, inside the ceiling, so nothing is given up
    // on the device whose screenshot started this brief.
    expect(PHONE.w * PHONE.h * 3 * 3).toBeLessThan(MENU_BAKE_MAX_TEXELS);
    expect(menuBakeResolution(PHONE.w, PHONE.h, 3)).toBe(3);
  });

  it('holds the ceiling on a large viewport instead of spending 79 MB on a background', () => {
    // An ultrawide at dpr 2 is 19.8 Mtexels — 79 MB of RGBA behind a settings
    // panel. The bake gives up resolution, which this content cannot show, rather
    // than memory, which every device can.
    const res = menuBakeResolution(ULTRAWIDE.w, ULTRAWIDE.h, 2);
    expect(res).toBeLessThan(2);
    expect(ULTRAWIDE.w * ULTRAWIDE.h * res * res).toBeLessThanOrEqual(MENU_BAKE_MAX_TEXELS + 1);
  });

  it('never asks for MORE than the device gives', () => {
    // A small window on a dpr-1 desktop is far inside the budget, and baking a
    // background at 2× the screen it is drawn on buys nothing.
    expect(menuBakeResolution(1280, 800, 1)).toBe(1);
  });

  it('stops falling at a quarter — past that the budget is deciding the look', () => {
    expect(menuBakeResolution(100_000, 100_000, 2)).toBe(0.25);
  });
});

describe('the ?sky=0 lever', () => {
  it('is ON by default, and off only for the exact flag', () => {
    // Default on: a player never types this, so the product answer is the one a
    // bare URL gives.
    expect(menuSkyEnabled('')).toBe(true);
    expect(menuSkyEnabled('?gate=0&debug=1')).toBe(true);
    expect(menuSkyEnabled('?sky=1')).toBe(true);
    expect(menuSkyEnabled('?sky=0')).toBe(false);
    expect(menuSkyEnabled('sky=0')).toBe(false);
    expect(menuSkyEnabled('?gate=0&sky=0')).toBe(false);
  });
});
