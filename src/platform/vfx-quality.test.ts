/**
 * Reduce-VFX auto-engage tests (GDD §4.3, risk 5). The trigger must fire on a
 * *sustained* drop below the 30 fps floor — never on a spike — and must show
 * **hysteresis**: once engaged it holds through the ~40 fps no-man's-land between
 * the floor and the release rate, so a device sitting near the floor doesn't
 * flap VFX on and off. Driven by frame deltas, so it verifies headless.
 */
import { describe, it, expect } from 'vitest';
import { VfxAutoQuality, DEFAULT_VFX_QUALITY } from './vfx-quality';

/** Feed `seconds` of frames at a steady `fps`; returns the final `reduced` flag. */
function feed(q: VfxAutoQuality, fps: number, seconds: number): boolean {
  const dt = 1 / fps;
  let out = q.reduced;
  for (let t = 0; t < seconds; t += dt) out = q.sample(dt);
  return out;
}

describe('VfxAutoQuality — sustained-drop trigger', () => {
  it('starts with VFX on (not reduced)', () => {
    expect(new VfxAutoQuality().reduced).toBe(false);
  });

  it('does NOT reduce on a healthy 60 fps stream', () => {
    const q = new VfxAutoQuality();
    expect(feed(q, 60, 10)).toBe(false);
  });

  it('engages after a sustained drop below the 30 fps floor', () => {
    const q = new VfxAutoQuality();
    // Under the sustain window it must not have engaged yet…
    expect(feed(q, 20, DEFAULT_VFX_QUALITY.engageSustainSeconds * 0.5)).toBe(false);
    // …but once the window is exceeded it engages.
    expect(feed(q, 20, DEFAULT_VFX_QUALITY.engageSustainSeconds)).toBe(true);
  });

  it('ignores a single slow spike (a GC pause / tab thaw is not a drop)', () => {
    const q = new VfxAutoQuality();
    feed(q, 60, 5); // healthy
    q.sample(0.2); // one 5 fps frame — a spike
    expect(q.reduced).toBe(false);
    // And it recovers cleanly on the next healthy frames.
    expect(feed(q, 60, 2)).toBe(false);
  });

  it('ignores absurd deltas (a backgrounded tab handing back multi-second frames)', () => {
    const q = new VfxAutoQuality();
    const before = q.reduced;
    expect(q.sample(4)).toBe(before); // >1s → ignored entirely
    expect(q.sample(0)).toBe(before); // non-positive → ignored
    expect(q.sample(-1)).toBe(before);
    expect(q.smoothedFps).toBeNull(); // no real sample ever landed
  });
});

describe('VfxAutoQuality — hysteresis (engage low, release high)', () => {
  it('holds reduced through the floor-to-release band (does not flap at ~40 fps)', () => {
    const q = new VfxAutoQuality();
    feed(q, 20, 5); // engage
    expect(q.reduced).toBe(true);
    // 40 fps is above the 30 fps floor but below the 50 fps release — the gap.
    // A plain threshold would toggle here; hysteresis must not.
    expect(feed(q, 40, 10)).toBe(true);
  });

  it('releases only after recovery clears the higher release rate', () => {
    const q = new VfxAutoQuality();
    feed(q, 20, 5);
    expect(q.reduced).toBe(true);
    // Back to a healthy 60 fps for well past the release window → VFX return.
    expect(feed(q, 60, 6)).toBe(false);
  });

  it('a brief recovery that does not clear the release window keeps it reduced', () => {
    const q = new VfxAutoQuality();
    feed(q, 20, 5);
    expect(q.reduced).toBe(true);
    // A short blip of good frames, shorter than the release sustain window.
    expect(feed(q, 60, DEFAULT_VFX_QUALITY.releaseSustainSeconds * 0.25)).toBe(true);
  });

  it('reset returns to the initial VFX-on state', () => {
    const q = new VfxAutoQuality();
    feed(q, 20, 5);
    expect(q.reduced).toBe(true);
    q.reset();
    expect(q.reduced).toBe(false);
    expect(q.smoothedFps).toBeNull();
  });
});
