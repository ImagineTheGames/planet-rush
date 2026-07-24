/**
 * Build & Upgrade wheel input (GDD §2.5, §2.4). Two things worth pinning:
 *
 *  1. **The angle convention agrees with the wheel that is drawn.** This module
 *     cannot import `src/ui` (the UI depends on `@platform`, so that edge would
 *     be a cycle), so the same twelve-o'clock-clockwise math exists in both
 *     places. A test *can* import both, so the sweep below is what stops them
 *     drifting: if `segmentIndexAt` and `segmentAtDirection` ever disagree about
 *     a direction, a player buys a shield when they pressed TURRET.
 *  2. **A press spends exactly once.** One-shot draining is the rule
 *     `BuildOrderAction` states, and this is the only place it can be broken.
 */
import { describe, it, expect } from 'vitest';
import {
  WheelInput,
  hitPanel,
  hitWheel,
  segmentIndexAt,
  INNER_FRACTION,
  PANEL_ROWS_TOP,
} from './wheel-input';
import { WHEEL_ORDER, segmentAtDirection } from '../ui';

const WHEEL = { centerX: 200, centerY: 150, radius: 100, segments: WHEEL_ORDER.length };
const PANEL = { centerX: 200, centerY: 150, width: 300, height: 212, rowHeight: 30, rows: 4 };
/** UPGRADE SHIP — the one segment that opens a screen instead of spending. */
const UPGRADE_SEGMENT = WHEEL_ORDER.indexOf('upgrade');

describe('segmentIndexAt — the same wheel the UI draws', () => {
  it('agrees with src/ui segmentAtDirection over a full sweep', () => {
    for (let deg = 0; deg < 360; deg += 1) {
      const rad = (deg * Math.PI) / 180;
      const dx = Math.cos(rad);
      const dy = Math.sin(rad);
      const index = segmentIndexAt(dx, dy, WHEEL_ORDER.length);
      expect(index).not.toBeNull();
      expect(WHEEL_ORDER[index as number]).toBe(segmentAtDirection(dx, dy));
    }
  });

  it('puts segment 0 at twelve o\'clock (screen space is y-down)', () => {
    expect(segmentIndexAt(0, -1, 5)).toBe(0);
  });

  it('selects nothing inside the deadzone — dead centre cancels', () => {
    expect(segmentIndexAt(0, 0, 5)).toBeNull();
    expect(segmentIndexAt(0.1, 0.1, 5, 0.25)).toBeNull();
  });
});

describe('hitWheel', () => {
  it('reads a press outside the outer ring as a dismissal', () => {
    expect(hitWheel(200, 150 - 120, WHEEL).kind).toBe('outside');
  });

  it('reads the hub as a miss, never as a purchase', () => {
    expect(hitWheel(200, 150, WHEEL).kind).toBe('hub');
    const justInside = WHEEL.radius * INNER_FRACTION - 1;
    expect(hitWheel(200, 150 - justInside, WHEEL).kind).toBe('hub');
  });

  it('lands a press on the ring on the segment drawn there', () => {
    const r = WHEEL.radius * 0.7;
    const hit = hitWheel(200, 150 - r, WHEEL);
    expect(hit).toEqual({ kind: 'segment', index: 0 });
  });
});

describe('hitPanel', () => {
  it('maps a press onto the row it landed on', () => {
    const top = PANEL.centerY - PANEL.height / 2;
    for (let i = 0; i < PANEL.rows; i++) {
      const y = top + PANEL_ROWS_TOP + i * PANEL.rowHeight + 5;
      expect(hitPanel(PANEL.centerX, y, PANEL)).toEqual({ kind: 'row', index: i });
    }
  });

  it('reads the chrome above the rows as a miss', () => {
    const top = PANEL.centerY - PANEL.height / 2;
    expect(hitPanel(PANEL.centerX, top + 4, PANEL).kind).toBe('chrome');
  });

  it('reads a press off the panel as "back to the wheel"', () => {
    expect(hitPanel(PANEL.centerX - 400, PANEL.centerY, PANEL).kind).toBe('outside');
  });
});

describe('WheelInput — opening at your own planet, and only there', () => {
  it('opens and closes on the build action, panel and all', () => {
    const w = new WheelInput();
    expect(w.open).toBe(false);
    w.toggle();
    expect(w.open).toBe(true);
    w.openPanel();
    expect(w.panelOpen).toBe(true);
    w.toggle();
    expect(w.open).toBe(false);
    expect(w.panelOpen).toBe(false);
  });

  it('closes itself the moment the planet stops being available (GDD §2.5)', () => {
    const w = new WheelInput();
    w.toggle();
    w.setAvailable(false);
    expect(w.open).toBe(false);
  });

  it('ignores presses while closed, so they fall through to the sticks', () => {
    const w = new WheelInput();
    expect(w.press(200, 150, WHEEL, PANEL, UPGRADE_SEGMENT)).toBe(false);
  });
});

describe('WheelInput — a press spends exactly once', () => {
  it('drains the bought segment one-shot', () => {
    const w = new WheelInput();
    w.toggle();
    const r = WHEEL.radius * 0.7;
    expect(w.press(200, 150 - r, WHEEL, PANEL, UPGRADE_SEGMENT)).toBe(true);
    expect(w.takeSegment()).toBe(0);
    expect(w.takeSegment()).toBeNull();
  });

  it('opens the panel instead of spending on the UPGRADE SHIP segment', () => {
    const w = new WheelInput();
    w.toggle();
    const angle = (2 * Math.PI * UPGRADE_SEGMENT) / WHEEL_ORDER.length;
    const r = WHEEL.radius * 0.7;
    w.press(200 + Math.sin(angle) * r, 150 - Math.cos(angle) * r, WHEEL, PANEL, UPGRADE_SEGMENT);
    expect(w.takeSegment()).toBeNull();
    expect(w.panelOpen).toBe(true);
  });

  it('drains a bought upgrade row one-shot', () => {
    const w = new WheelInput();
    w.toggle();
    w.openPanel();
    const top = PANEL.centerY - PANEL.height / 2;
    w.press(PANEL.centerX, top + PANEL_ROWS_TOP + 2 * PANEL.rowHeight + 5, WHEEL, PANEL, UPGRADE_SEGMENT);
    expect(w.takeRow()).toBe(2);
    expect(w.takeRow()).toBeNull();
  });

  it('backs out of the panel on a press beside it, without buying', () => {
    const w = new WheelInput();
    w.toggle();
    w.openPanel();
    w.press(PANEL.centerX - 400, PANEL.centerY, WHEEL, PANEL, UPGRADE_SEGMENT);
    expect(w.panelOpen).toBe(false);
    expect(w.open).toBe(true);
    expect(w.takeRow()).toBeNull();
  });

  it('dismisses on a press outside the wheel, without buying', () => {
    const w = new WheelInput();
    w.toggle();
    w.press(200, 150 - WHEEL.radius - 20, WHEEL, PANEL, UPGRADE_SEGMENT);
    expect(w.open).toBe(false);
    expect(w.takeSegment()).toBeNull();
  });
});

describe('WheelInput — the gamepad path (GDD §2.4)', () => {
  it('needs a confirm: pointing a stick buys nothing', () => {
    const w = new WheelInput();
    w.toggle();
    w.aim(0, -1, WHEEL_ORDER.length);
    expect(w.selection).toBe(0);
    expect(w.takeSegment()).toBeNull();
    w.confirm(UPGRADE_SEGMENT);
    expect(w.takeSegment()).toBe(0);
  });

  it('reaches the same segment a click on that wedge would', () => {
    const w = new WheelInput();
    w.toggle();
    const angle = (2 * Math.PI * 1) / WHEEL_ORDER.length;
    w.aim(Math.sin(angle), -Math.cos(angle), WHEEL_ORDER.length);
    w.confirm(UPGRADE_SEGMENT);
    expect(w.takeSegment()).toBe(1);
  });

  it('does not select from a resting stick', () => {
    const w = new WheelInput();
    w.toggle();
    w.aim(0.05, 0.05, WHEEL_ORDER.length);
    expect(w.selection).toBeNull();
    w.confirm(UPGRADE_SEGMENT);
    expect(w.takeSegment()).toBeNull();
  });
});
