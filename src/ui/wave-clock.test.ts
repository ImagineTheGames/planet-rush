/**
 * Asteroid-wave clock tests (GDD §2.2, §2.3). The clock names the wave, counts
 * down to the next, and shows match time — derived purely from time + the
 * ratified wave constants, so it can never drift from the sim's metronome.
 */
import { describe, it, expect } from 'vitest';
import { computeWaveClock, formatClock, WAVE_NAMES } from './wave-clock';
import { WAVE_COUNT, WAVE_INTERVAL_S } from '../sim/constants';

describe('computeWaveClock (GDD §2.3)', () => {
  it('is wave 1, named, at match start', () => {
    const c = computeWaveClock(0);
    expect(c.wave).toBe(1);
    expect(c.waveCount).toBe(WAVE_COUNT);
    expect(c.name).toBe(WAVE_NAMES[0]);
    expect(c.isFinalWave).toBe(false);
  });

  it('counts down to the next wave within the first interval', () => {
    const c = computeWaveClock(10);
    expect(c.wave).toBe(1);
    expect(c.countdownToNext).toBeCloseTo(WAVE_INTERVAL_S - 10, 6);
    expect(c.matchTime).toBe(10);
  });

  it('advances to wave 2 exactly at the first interval boundary', () => {
    const c = computeWaveClock(WAVE_INTERVAL_S);
    expect(c.wave).toBe(2);
    expect(c.countdownToNext).toBeCloseTo(WAVE_INTERVAL_S, 6);
  });

  it('reaches the final wave and reports no next wave (GDD §2.3 collapse-bound)', () => {
    const c = computeWaveClock(WAVE_INTERVAL_S * (WAVE_COUNT - 1));
    expect(c.wave).toBe(WAVE_COUNT);
    expect(c.isFinalWave).toBe(true);
    expect(c.countdownToNext).toBeNull();
  });

  it('caps the wave number at WAVE_COUNT even long after the last wave', () => {
    const c = computeWaveClock(WAVE_INTERVAL_S * (WAVE_COUNT + 3));
    expect(c.wave).toBe(WAVE_COUNT);
    expect(c.isFinalWave).toBe(true);
  });

  it('clamps negative time to match start (defensive)', () => {
    const c = computeWaveClock(-5);
    expect(c.wave).toBe(1);
    expect(c.matchTime).toBe(0);
  });
});

describe('formatClock', () => {
  it('formats seconds as m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(9)).toBe('0:09');
    expect(formatClock(75)).toBe('1:15');
    expect(formatClock(150)).toBe('2:30');
  });

  it('rounds up so a pending countdown never reads 0:00 early', () => {
    expect(formatClock(0.1)).toBe('0:01');
    expect(formatClock(59.4)).toBe('1:00');
  });

  it('clamps negatives to 0:00', () => {
    expect(formatClock(-3)).toBe('0:00');
  });
});
