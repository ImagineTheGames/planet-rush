/**
 * src/ui/pause-menu.test.ts — the pause menu's contract, pinned. OWNER: UI Engineer.
 *
 * Three things the developer ratification (p10) turns on, asserted headless:
 *
 *  1. **Pause semantics are the transport's.** The offline/online distinction is a
 *     single `pausable` flag routed through {@link shouldFreezeSim}. The
 *     networked-`false` path — overlay up, sim still running — is built and tested
 *     NOW, before the networked transport that supplies it exists (developer §2).
 *  2. **EXIT is never one tap.** The state machine puts a "Leave the match?"
 *     confirm between the menu and leaving, and STAY is the emphasised default, so
 *     one stray tap cannot kill a match (developer §1).
 *  3. **Back-one-level is one gesture.** ESC / the corner button `toggle` opens
 *     and then steps back a level at a time, never skipping straight out.
 */
import { describe, it, expect } from 'vitest';
import { resolveAnchor } from '@platform/layout-registry';
import type { Viewport } from '@platform/layout-registry';
import {
  PAUSE_BUTTON_ANCHOR,
  PAUSE_BUTTON_ID,
  PAUSE_ID,
  isPauseOpen,
  nextPauseScreen,
  pauseButtonRect,
  pauseButtonVisible,
  pauseButtons,
  pauseHitTest,
  pauseLayout,
  pauseMenuModel,
  shouldFreezeSim,
} from './pause-menu';
import type { PauseScreen } from './pause-menu';

const SCREENS: readonly PauseScreen[] = ['closed', 'menu', 'settings', 'confirm'];

describe('shouldFreezeSim — the transport owns pause (developer §2)', () => {
  it('OFFLINE (pausable): the sim freezes whenever an overlay is up', () => {
    expect(shouldFreezeSim('menu', true)).toBe(true);
    expect(shouldFreezeSim('settings', true)).toBe(true);
    expect(shouldFreezeSim('confirm', true)).toBe(true);
  });

  it('OFFLINE (pausable): a closed overlay never freezes the sim', () => {
    expect(shouldFreezeSim('closed', true)).toBe(false);
  });

  it('NETWORKED (not pausable): the overlay can be up over a RUNNING sim — the flag path built before the transport exists', () => {
    // The whole networked-false branch: an eight-way match cannot stop for one
    // player, so no pause screen ever freezes the sim.
    for (const screen of SCREENS) {
      expect(shouldFreezeSim(screen, false)).toBe(false);
    }
  });

  it('freeze is exactly (overlay up AND pausable) — nothing else', () => {
    for (const screen of SCREENS) {
      for (const pausable of [true, false]) {
        expect(shouldFreezeSim(screen, pausable)).toBe(isPauseOpen(screen) && pausable);
      }
    }
  });
});

describe('nextPauseScreen — the state machine', () => {
  it('toggle opens from closed and steps back one level from each open screen', () => {
    expect(nextPauseScreen('closed', 'toggle')).toBe('menu');
    expect(nextPauseScreen('menu', 'toggle')).toBe('closed');
    expect(nextPauseScreen('settings', 'toggle')).toBe('menu');
    expect(nextPauseScreen('confirm', 'toggle')).toBe('menu');
  });

  it('resume closes from anywhere', () => {
    for (const screen of SCREENS) expect(nextPauseScreen(screen, 'resume')).toBe('closed');
  });

  it('SETTINGS round-trips: menu → settings → menu', () => {
    const toSettings = nextPauseScreen('menu', 'openSettings');
    expect(toSettings).toBe('settings');
    expect(nextPauseScreen(toSettings, 'closeSettings')).toBe('menu');
  });

  it('EXIT is two steps: menu → confirm → (leave handled by wiring); STAY backs out', () => {
    const toConfirm = nextPauseScreen('menu', 'requestExit');
    expect(toConfirm).toBe('confirm');
    expect(nextPauseScreen(toConfirm, 'cancelExit')).toBe('menu');
  });

  it('is total — an action that does not apply to a screen is a no-op', () => {
    // requestExit only from the menu; openSettings only from the menu; etc.
    expect(nextPauseScreen('closed', 'openSettings')).toBe('closed');
    expect(nextPauseScreen('settings', 'requestExit')).toBe('settings');
    expect(nextPauseScreen('confirm', 'openSettings')).toBe('confirm');
    expect(nextPauseScreen('closed', 'cancelExit')).toBe('closed');
    // Doubled presses never wedge it.
    expect(nextPauseScreen(nextPauseScreen('menu', 'requestExit'), 'requestExit')).toBe('confirm');
  });

  it('there is no direct menu → leave: you cannot exit without passing through confirm', () => {
    // The safety property, stated directly: no single action from `menu` yields a
    // "leaving" state; the only route to leaving runs through `confirm`.
    const from = nextPauseScreen('menu', 'requestExit');
    expect(from).toBe('confirm'); // the mandatory intermediate screen
  });
});

describe('pauseMenuModel + buttons', () => {
  it('the menu offers RESUME / SETTINGS / EXIT TO MENU, RESUME first and primary', () => {
    const model = pauseMenuModel('menu');
    expect(model.headline).toBe('PAUSED');
    expect(model.buttons.map((b) => b.id)).toEqual(['resume', 'settings', 'exit']);
    expect(model.buttons[0]!.primary).toBe(true); // RESUME is the safe default
    expect(model.buttons.find((b) => b.id === 'exit')!.primary).toBe(false);
  });

  it('the confirm asks the question and makes STAY the emphasised default (developer §1)', () => {
    const model = pauseMenuModel('confirm');
    expect(model.headline).toBe('LEAVE THE MATCH?');
    expect(model.buttons.map((b) => b.id)).toEqual(['leave', 'stay']);
    const stay = model.buttons.find((b) => b.id === 'stay')!;
    const leave = model.buttons.find((b) => b.id === 'leave')!;
    expect(stay.primary).toBe(true); // the eye lands on staying
    expect(leave.primary).toBe(false);
  });

  it('closed and settings draw no pause buttons of their own', () => {
    expect(pauseButtons('closed')).toEqual([]);
    expect(pauseButtons('settings')).toEqual([]);
    expect(pauseMenuModel('closed').buttons).toEqual([]);
    expect(pauseMenuModel('settings').buttons).toEqual([]);
  });
});

describe('pauseLayout + pauseHitTest', () => {
  const viewport: Viewport = { width: 1000, height: 600 };

  it('places one rect per button, in order, all inside the content box', () => {
    const ids = pauseButtons('menu');
    const layout = pauseLayout(viewport, ids.length);
    expect(layout.buttons).toHaveLength(3);
    for (const r of layout.buttons) {
      expect(r.x).toBeGreaterThanOrEqual(layout.content.x);
      expect(r.x + r.width).toBeLessThanOrEqual(layout.content.x + layout.content.width + 0.001);
    }
  });

  it('routes a tap on a button rect to that button, and misses to null', () => {
    const ids = pauseButtons('menu');
    const layout = pauseLayout(viewport, ids.length);
    const exitRect = layout.buttons[2]!;
    const cx = exitRect.x + exitRect.width / 2;
    const cy = exitRect.y + exitRect.height / 2;
    expect(pauseHitTest(layout, cx, cy, ids)).toEqual({ kind: 'exit' });
    // A tap between the headline and the buttons hits nothing.
    expect(pauseHitTest(layout, layout.content.x + 1, layout.content.y + 1, ids)).toBeNull();
  });

  it('the confirm layout maps its two rects to leave/stay in order', () => {
    const ids = pauseButtons('confirm');
    const layout = pauseLayout(viewport, ids.length);
    const leave = layout.buttons[0]!;
    const stay = layout.buttons[1]!;
    expect(pauseHitTest(layout, leave.x + 1, leave.y + 1, ids)).toEqual({ kind: 'leave' });
    expect(pauseHitTest(layout, stay.x + 1, stay.y + 1, ids)).toEqual({ kind: 'stay' });
  });
});

describe('the touch pause affordance', () => {
  it('is shown on touch only while the match owns the screen', () => {
    expect(pauseButtonVisible({ isTouch: true, available: true })).toBe(true);
    expect(pauseButtonVisible({ isTouch: true, available: false })).toBe(false);
    expect(pauseButtonVisible({ isTouch: false, available: true })).toBe(false);
    expect(pauseButtonVisible({ isTouch: false, available: false })).toBe(false);
  });

  it('sits in the top band, clear of the top-left ore total', () => {
    const rect = pauseButtonRect({ width: 900, height: 420 });
    // Inset from the LEFT past the ore readout, hard against the top.
    expect(rect.x).toBeGreaterThan(16);
    expect(rect.y).toBe(16);
    expect(rect.width).toBe(40);
    expect(rect.height).toBe(40);
  });

  it('declares stable ids and registry-accepted anchors', () => {
    expect(PAUSE_ID).toBe('pause-menu');
    expect(PAUSE_BUTTON_ID).toBe('pause-button');
    const zone = resolveAnchor(PAUSE_BUTTON_ANCHOR, { width: 844, height: 390 });
    expect(zone).toEqual({ x: 0, y: 0, width: 844, height: 390 });
  });
});
