/**
 * Contextual touch-button unit tests (docs/input-parity.md, GDD §2.4). The BOOST
 * button is a hold; the PING button is a tap-or-drag resolved on release. Pure
 * geometry/state — rects and pointer samples in, hold flags and a device-neutral
 * PingRequest out — so it runs headless, and the sim never sees a device or a button.
 */
import { describe, it, expect } from 'vitest';
import { TouchButtons, PING_TAP_MAX_PX } from './touch-buttons';
import type { Rect } from './layout-registry';

const BOOST: Rect = { x: 100, y: 500, width: 72, height: 72 }; // centre ~ (136, 536)
const PING: Rect = { x: 800, y: 400, width: 72, height: 72 }; // centre ~ (836, 436)

function sample(id: number, x: number, y: number): { id: number; x: number; y: number } {
  return { id, x, y };
}

function armed(): TouchButtons {
  const b = new TouchButtons();
  b.setRects(BOOST, PING);
  return b;
}

describe('TouchButtons — BOOST (hold)', () => {
  it('a press inside the BOOST rect holds boost until release', () => {
    const b = armed();
    expect(b.tryPress(sample(1, 136, 536))).toBe('boost');
    expect(b.boostHeld).toBe(true);
    b.onUp(1);
    expect(b.boostHeld).toBe(false);
  });

  it('ignores a second touch on the button while it is already held', () => {
    const b = armed();
    b.tryPress(sample(1, 136, 536));
    expect(b.tryPress(sample(2, 140, 540))).toBe(null); // button already owned
    b.onUp(2); // the wrong id must not release the hold
    expect(b.boostHeld).toBe(true);
    b.onUp(1);
    expect(b.boostHeld).toBe(false);
  });
});

describe('TouchButtons — PING (tap or drag)', () => {
  it('a bare tap pings your own position (tap = true, zero direction)', () => {
    const b = armed();
    expect(b.tryPress(sample(1, 836, 436))).toBe('ping');
    expect(b.pingPressed).toBe(true);
    b.onUp(1);
    const ping = b.takePing();
    expect(ping).toEqual({ tap: true, dir: { x: 0, y: 0 } });
    expect(b.pingPressed).toBe(false);
  });

  it('a wobble under the tap threshold still reads as a tap', () => {
    const b = armed();
    b.tryPress(sample(1, 836, 436));
    b.onMove(sample(1, 836 + PING_TAP_MAX_PX - 2, 436)); // just under the threshold
    b.onUp(1);
    expect(b.takePing()?.tap).toBe(true);
  });

  it('a drag past the threshold pings the (unit) drag direction', () => {
    const b = armed();
    b.tryPress(sample(1, 836, 436));
    b.onMove(sample(1, 836 - 80, 436)); // drag left
    b.onUp(1);
    const ping = b.takePing();
    expect(ping?.tap).toBe(false);
    expect(ping?.dir.x).toBeCloseTo(-1, 6);
    expect(ping?.dir.y).toBeCloseTo(0, 6);
  });

  it('takePing is one-shot — a second drain is null', () => {
    const b = armed();
    b.tryPress(sample(1, 836, 436));
    b.onUp(1);
    expect(b.takePing()).not.toBe(null);
    expect(b.takePing()).toBe(null);
  });
});

describe('TouchButtons — routing + clear', () => {
  it('a press on neither button is not claimed (the sticks get it)', () => {
    const b = armed();
    expect(b.tryPress(sample(1, 400, 300))).toBe(null);
    expect(b.boostHeld).toBe(false);
    expect(b.pingPressed).toBe(false);
  });

  it('null rects (desktop / hidden) claim nothing', () => {
    const b = new TouchButtons();
    b.setRects(null, null);
    expect(b.tryPress(sample(1, 136, 536))).toBe(null);
    expect(b.tryPress(sample(2, 836, 436))).toBe(null);
  });

  it('clear() drops a held boost and discards a half-made ping', () => {
    const b = armed();
    b.tryPress(sample(1, 136, 536)); // boost held
    b.tryPress(sample(2, 836, 436)); // ping in progress
    b.clear();
    expect(b.boostHeld).toBe(false);
    expect(b.pingPressed).toBe(false);
    b.onUp(2);
    expect(b.takePing()).toBe(null); // the interrupted ping never fires
  });

  it('PING and BOOST are independent pointers', () => {
    const b = armed();
    b.tryPress(sample(1, 136, 536)); // boost
    b.tryPress(sample(2, 836, 436)); // ping
    expect(b.boostHeld).toBe(true);
    expect(b.pingPressed).toBe(true);
    b.onUp(1);
    expect(b.boostHeld).toBe(false);
    expect(b.pingPressed).toBe(true); // ping unaffected by boost release
  });
});
