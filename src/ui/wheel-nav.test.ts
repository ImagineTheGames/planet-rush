/**
 * src/ui/wheel-nav.test.ts — the wheel BACK cycle (field report v0.2.4).
 *
 * The field bug was "no way to go back up a level" from a build wheel. The fix is
 * a hub-tap / ESC that pops exactly one level; these tests walk the whole cycle —
 * drill build → upgrade → weapon, then BACK-BACK-BACK to closed — against the pure
 * model, the headless twin of the real-input e2e cycle.
 */

import { describe, expect, it } from 'vitest';
import {
  WHEEL_LEVELS,
  hubBack,
  wheelBack,
  wheelDepth,
  wheelLevel,
  type WheelLevel,
} from './wheel-nav';

describe('the level stack', () => {
  it('runs shut → deepest, so drilling steps up and BACK steps down one order', () => {
    expect(WHEEL_LEVELS).toEqual(['closed', 'build', 'upgrade', 'weapon']);
    expect(wheelDepth('closed')).toBe(0);
    expect(wheelDepth('weapon')).toBe(3);
  });

  it('derives the level from the three bits of screen state the client holds', () => {
    expect(wheelLevel(false, false, false)).toBe('closed');
    expect(wheelLevel(true, false, false)).toBe('build');
    expect(wheelLevel(true, true, false)).toBe('upgrade');
    expect(wheelLevel(true, true, true)).toBe('weapon');
    // weaponOpen is meaningless without the panel — a defensive derivation still
    // lands on `build`, never a phantom weapon level.
    expect(wheelLevel(true, false, true)).toBe('build');
  });
});

describe('BACK pops exactly one level (the hub tap / ESC)', () => {
  it('weapon → upgrade → build → closed, one step each', () => {
    expect(wheelBack('weapon')).toBe('upgrade');
    expect(wheelBack('upgrade')).toBe('build');
    expect(wheelBack('build')).toBe('closed');
    expect(wheelBack('closed')).toBe('closed'); // bottoms out, never underflows
  });

  it('BACK-BACK-BACK from the deepest level lands shut (the field report cycle)', () => {
    let level: WheelLevel = 'weapon';
    const trail: WheelLevel[] = [level];
    for (let i = 0; i < 3; i++) {
      level = wheelBack(level);
      trail.push(level);
    }
    expect(trail).toEqual(['weapon', 'upgrade', 'build', 'closed']);
  });
});

describe('the hub BACK descriptor', () => {
  it('says CLOSE at the top level (there is no wheel above the Build wheel)', () => {
    const hub = hubBack('build');
    expect(hub).not.toBeNull();
    expect(hub!.label).toBe('CLOSE');
    expect(hub!.to).toBe('closed');
    expect(hub!.closes).toBe(true);
  });

  it('says BACK at every deeper level, and names where a press lands', () => {
    expect(hubBack('upgrade')).toEqual({ label: 'BACK', to: 'build', closes: false });
    expect(hubBack('weapon')).toEqual({ label: 'BACK', to: 'upgrade', closes: false });
  });

  it('has no hub on a closed wheel — nothing to press', () => {
    expect(hubBack('closed')).toBeNull();
  });
});
