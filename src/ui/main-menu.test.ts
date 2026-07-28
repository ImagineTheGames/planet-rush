/**
 * src/ui/main-menu.test.ts — the main-menu model, headless.
 *
 * The screen decides two things: what its buttons say, and where a tap lands.
 * Both are pure functions of a viewport, so the whole of the front door is
 * asserted here with no Pixi and no canvas — the same discipline as the rest of
 * `src/ui/`. The *wiring* (a clean boot opens this, PLAY builds the world) is the
 * live-stage suite's job (`tests/live-stage/main-menu.spec.ts`), because the M2
 * lesson is that a menu can be model-green and still never reached.
 */

import { describe, it, expect } from 'vitest';
import {
  MAIN_MENU_BUTTON_HEIGHT,
  MAIN_MENU_BUTTON_HEIGHT_TOUCH,
  MAIN_MENU_ITEMS,
  MAIN_MENU_TITLE,
  mainMenuHitTest,
  mainMenuLayout,
  mainMenuModel,
} from './main-menu';
import type { Rect } from '@platform/layout-registry';
import { MENU_COLUMN_MAX } from './menu-geometry';

const VIEWPORT = { width: 1280, height: 720 };
const center = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

describe('the model', () => {
  it('shows the wordmark and exactly PLAY, CODEX then SETTINGS', () => {
    const model = mainMenuModel();
    expect(model.title).toBe(MAIN_MENU_TITLE);
    expect(model.buttons.map((b) => b.label)).toEqual(['PLAY', 'CODEX', 'SETTINGS']);
  });

  it('marks PLAY as the primary action and CODEX/SETTINGS as secondary', () => {
    const [play, codex, settings] = mainMenuModel().buttons;
    expect(play?.primary).toBe(true);
    // CODEX and SETTINGS are doors that come back — secondary, but fully active
    // (never gray): the gray-means-disabled theme rule (GDD §2.10 point 4).
    expect(codex?.primary).toBe(false);
    expect(settings?.primary).toBe(false);
  });

  it('keeps the item list, the model and the hit test in the same order', () => {
    // The three walk one list — a re-order can never mis-route a tap.
    expect(MAIN_MENU_ITEMS.map((i) => i.kind)).toEqual(['play', 'codex', 'settings']);
  });
});

describe('layout', () => {
  it('places the title band and one rect per button, inside the viewport', () => {
    const layout = mainMenuLayout(VIEWPORT);
    expect(layout.buttons).toHaveLength(MAIN_MENU_ITEMS.length);
    for (const rect of [layout.title, ...layout.buttons]) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(VIEWPORT.width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(VIEWPORT.height);
    }
  });

  it('caps the button column instead of stretching it across a wide desktop', () => {
    const layout = mainMenuLayout({ width: 1920, height: 1080 });
    for (const rect of layout.buttons) {
      expect(rect.width).toBeLessThanOrEqual(MENU_COLUMN_MAX);
    }
  });

  it('gives touch a taller button than a pointer', () => {
    const desktop = mainMenuLayout(VIEWPORT, { isTouch: false });
    const touch = mainMenuLayout(VIEWPORT, { isTouch: true });
    // Both fit the band, so the cap — not the compression — decides the height.
    expect(desktop.buttons[0]?.height).toBe(MAIN_MENU_BUTTON_HEIGHT);
    expect(touch.buttons[0]?.height).toBe(MAIN_MENU_BUTTON_HEIGHT_TOUCH);
  });

  it('stacks the buttons below the title, inside the content box', () => {
    // The arena picker used to reserve a band here; it moved into the lobby (p2),
    // so the menu is just the wordmark and its two buttons.
    const layout = mainMenuLayout(VIEWPORT);
    expect(layout.buttons[0]!.y).toBeGreaterThanOrEqual(layout.title.y + layout.title.height);
    expect(layout.buttons[1]!.y).toBeGreaterThan(layout.buttons[0]!.y);
    expect(layout.buttons[1]!.y + layout.buttons[1]!.height).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it('insets the content by the safe area', () => {
    const insets = { top: 40, bottom: 20, left: 30, right: 30 };
    const layout = mainMenuLayout(VIEWPORT, { insets });
    // The content box starts past the inset + the page margin, never at 0.
    expect(layout.content.x).toBeGreaterThanOrEqual(insets.left);
    expect(layout.content.y).toBeGreaterThanOrEqual(insets.top);
  });

  it('yields zero-extent buttons on a comically small viewport rather than a backwards rect', () => {
    const layout = mainMenuLayout({ width: 4, height: 4 });
    for (const rect of layout.buttons) {
      expect(rect.width).toBeGreaterThanOrEqual(0);
      expect(rect.height).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('hit test', () => {
  it('lands a tap on the button under it', () => {
    const layout = mainMenuLayout(VIEWPORT);
    expect(mainMenuHitTest(layout, center(layout.buttons[0]!).x, center(layout.buttons[0]!).y)).toBe('play');
    expect(mainMenuHitTest(layout, center(layout.buttons[1]!).x, center(layout.buttons[1]!).y)).toBe(
      'codex',
    );
    expect(mainMenuHitTest(layout, center(layout.buttons[2]!).x, center(layout.buttons[2]!).y)).toBe(
      'settings',
    );
  });

  it('is null off every button', () => {
    const layout = mainMenuLayout(VIEWPORT);
    // The title band is a label, not a control.
    expect(mainMenuHitTest(layout, center(layout.title).x, center(layout.title).y)).toBeNull();
    // Off-screen entirely.
    expect(mainMenuHitTest(layout, -5, -5)).toBeNull();
  });

  it('never hits a button squeezed to nothing (invisible ⇒ untappable)', () => {
    const layout = mainMenuLayout({ width: 4, height: 4 });
    for (const rect of layout.buttons) {
      expect(mainMenuHitTest(layout, center(rect).x, center(rect).y)).toBeNull();
    }
  });
});
