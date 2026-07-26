/**
 * src/platform/haptics.test.ts — the vibration vocabulary and its gates.
 *
 * Runs headless in the `node` vitest env: the core takes its capabilities by
 * injection, so we drive a spy `vibrate`, a fake `storage`, a manual visibility
 * flag and a hand-cranked clock — never a real `navigator`.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createHaptics,
  createBrowserHaptics,
  HAPTIC_PATTERNS,
  HAPTICS_STORAGE_KEY,
  DEATH_QUIET_MS,
  type HapticKind,
  type HapticsDeps,
} from './haptics';

/** A fake storage seam backed by a plain map, matching the platform contract. */
function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    get: (k: string) => map.get(k) ?? null,
    set: (k: string, v: string) => void map.set(k, v),
    map,
  };
}

/** Build the core with sensible test defaults; override any dep per case. A
 *  mutable `clock`/`hidden` handle is returned so a test can advance time or hide
 *  the tab mid-flight. */
function harness(over: Partial<HapticsDeps> = {}) {
  const vibrate = vi.fn();
  const storage = over.storage ?? fakeStorage();
  const state = { hidden: false, ms: 0 };
  const haptics = createHaptics({
    vibrate,
    isHidden: () => state.hidden,
    storage,
    now: () => state.ms,
    ...over,
  });
  return { haptics, vibrate, storage, state };
}

const KINDS: HapticKind[] = ['tap', 'confirm', 'hit', 'alarm', 'death'];

describe('haptic vocabulary → navigator.vibrate', () => {
  it('fires each kind with exactly its table pattern when supported & enabled', () => {
    for (const kind of KINDS) {
      const { haptics, vibrate } = harness();
      haptics.haptic(kind);
      expect(vibrate).toHaveBeenCalledTimes(1);
      const expected = HAPTIC_PATTERNS[kind];
      // Array patterns are copied to a mutable array before firing; assert value
      // equality, and that it is not the frozen table array itself.
      const arg = vibrate.mock.calls[0]![0];
      if (typeof expected === 'number') {
        expect(arg).toBe(expected);
      } else {
        expect(arg).toEqual([...expected]);
        expect(arg).not.toBe(expected); // a defensive copy, never the shared table
      }
    }
  });

  it('confirm is a short double (buzz–pause–buzz)', () => {
    const { haptics, vibrate } = harness();
    haptics.haptic('confirm');
    const arg = vibrate.mock.calls[0]![0] as number[];
    expect(Array.isArray(arg)).toBe(true);
    expect(arg.length).toBe(3); // two buzzes around one pause
  });

  it('tap is the lightest event', () => {
    // The whole point of `tap` is that it barely registers — lighter than a hit.
    expect(HAPTIC_PATTERNS.tap).toBeLessThan(HAPTIC_PATTERNS.hit as number);
  });
});

describe('the enabled toggle', () => {
  it('defaults ON where supported, with nothing stored', () => {
    const { haptics } = harness();
    expect(haptics.isSupported()).toBe(true);
    expect(haptics.isEnabled()).toBe(true);
  });

  it('toggle OFF → zero calls', () => {
    const { haptics, vibrate } = harness();
    haptics.setEnabled(false);
    for (const kind of KINDS) haptics.haptic(kind);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('persists the choice through the storage seam', () => {
    const storage = fakeStorage();
    const { haptics } = harness({ storage });
    haptics.setEnabled(false);
    expect(storage.get(HAPTICS_STORAGE_KEY)).toBe('off');
    haptics.setEnabled(true);
    expect(storage.get(HAPTICS_STORAGE_KEY)).toBe('on');
  });

  it('reads a stored OFF back on construction (default overridden)', () => {
    const storage = fakeStorage({ [HAPTICS_STORAGE_KEY]: 'off' });
    const { haptics, vibrate } = harness({ storage });
    expect(haptics.isEnabled()).toBe(false);
    haptics.haptic('tap');
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('a stored ON survives even on an unsupported device (choice is not lost)', () => {
    const storage = fakeStorage({ [HAPTICS_STORAGE_KEY]: 'on' });
    const { haptics } = harness({ vibrate: null, storage });
    expect(haptics.isSupported()).toBe(false);
    expect(haptics.isEnabled()).toBe(true); // preference preserved…
    // …but it still never buzzes — see the unsupported suite below.
  });
});

describe('unsupported devices (desktop, iOS Safari)', () => {
  it('report unsupported and default the toggle OFF', () => {
    const { haptics } = harness({ vibrate: null });
    expect(haptics.isSupported()).toBe(false);
    expect(haptics.isEnabled()).toBe(false); // no motor → nothing to default on
  });

  it('every kind is a zero-call, zero-error no-op', () => {
    const { haptics } = harness({ vibrate: null });
    for (const kind of KINDS) {
      expect(() => haptics.haptic(kind)).not.toThrow();
    }
    // There is no vibrate spy to assert on (it's null) — the contract is simply
    // that nothing threw and nothing was called. Prove enabling can't wake it:
    haptics.setEnabled(true);
    expect(() => haptics.haptic('alarm')).not.toThrow();
  });
});

describe('the tab-hidden gate', () => {
  it('stays silent while hidden, resumes when visible again', () => {
    const { haptics, vibrate, state } = harness();
    state.hidden = true;
    haptics.haptic('hit');
    expect(vibrate).not.toHaveBeenCalled();

    state.hidden = false;
    haptics.haptic('hit');
    expect(vibrate).toHaveBeenCalledTimes(1);
  });
});

describe('death: the buzz, then the three-second hush', () => {
  it('death fires its pattern immediately', () => {
    const { haptics, vibrate } = harness();
    haptics.haptic('death');
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate.mock.calls[0]![0]).toEqual([...(HAPTIC_PATTERNS.death as number[])]);
  });

  it('suppresses every other event for DEATH_QUIET_MS, then resumes', () => {
    const { haptics, vibrate, state } = harness();
    haptics.haptic('death'); // opens the quiet window at t=0
    vibrate.mockClear();

    // Just before the window closes: still silent.
    state.ms = DEATH_QUIET_MS - 1;
    haptics.haptic('hit');
    haptics.haptic('alarm');
    haptics.haptic('tap');
    expect(vibrate).not.toHaveBeenCalled();

    // At/after the window: the motor is back.
    state.ms = DEATH_QUIET_MS;
    haptics.haptic('hit');
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('a second death during the hush re-fires and re-opens the window', () => {
    // Death cancels an ongoing pattern by replacing it — a fresh death is always
    // allowed through, even inside its own quiet window.
    const { haptics, vibrate, state } = harness();
    haptics.haptic('death');
    state.ms = 500;
    haptics.haptic('death');
    expect(vibrate).toHaveBeenCalledTimes(2);

    // The window now runs from the *second* death.
    vibrate.mockClear();
    state.ms = 500 + DEATH_QUIET_MS - 1;
    haptics.haptic('hit');
    expect(vibrate).not.toHaveBeenCalled();
  });
});

describe('createBrowserHaptics (feature detection)', () => {
  it('is unsupported when navigator has no vibrate, and never throws', () => {
    const storage = fakeStorage();
    // In the node test env there is no `navigator.vibrate`, so the browser factory
    // must detect absence and degrade to a silent no-op.
    const haptics = createBrowserHaptics(storage);
    expect(haptics.isSupported()).toBe(false);
    expect(() => haptics.haptic('tap')).not.toThrow();
  });
});
