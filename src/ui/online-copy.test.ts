/**
 * src/ui/online-copy.test.ts — the net-reason → player-words mapping, headless.
 *
 * The contract the M3 brief is emphatic about: three allocator failures produce
 * three *different* messages calling for three *different* actions (never one
 * "connection failed"), and a lost server is not a lost connection. Both are pure
 * lookups, so both are asserted here without a socket.
 */

import { describe, it, expect } from 'vitest';
import type { ResolveFailure } from '../net/allocator-client';
import type { StopReason } from '../net/reconnect';
import {
  CROSS_REGION_PING_WARN_MS,
  crossRegionWarning,
  listingFailureMessage,
  reconnectEndedCopy,
  regionPickerVisible,
  resolveFailureCopy,
  resolveFailureMessage,
  type RegionInfo,
} from './online-copy';
import type { ListingJoinFailure } from '../net/lobby-list';

const ALL_FAILURES: readonly ResolveFailure[] = ['no-capacity', 'not-found', 'network', 'bad-response'];
const ALL_STOPS: readonly StopReason[] = ['room-gone', 'grace-elapsed'];

describe('three failures, three different messages', () => {
  it('gives every failure a non-empty, code-free sentence', () => {
    for (const reason of ALL_FAILURES) {
      const copy = resolveFailureCopy(reason);
      expect(copy.message.length, `${reason} has words`).toBeGreaterThan(0);
      // A message the player can act on never leaks the raw reason token.
      expect(copy.message.toLowerCase()).not.toContain(reason);
    }
  });

  it('never collapses two failures into the same words', () => {
    const messages = ALL_FAILURES.map((r) => resolveFailureMessage(r));
    expect(new Set(messages).size, 'all four messages are distinct').toBe(messages.length);
  });

  it('sorts the failures into the two actions they call for', () => {
    // A wrong code is fixed by editing it; the rest are worth a straight retry.
    expect(resolveFailureCopy('not-found').action).toBe('edit-code');
    expect(resolveFailureCopy('no-capacity').action).toBe('retry');
    expect(resolveFailureCopy('network').action).toBe('retry');
    expect(resolveFailureCopy('bad-response').action).toBe('retry');
  });

  it('names the right cause: full fleet vs missing room vs no reach', () => {
    expect(resolveFailureMessage('no-capacity')).toMatch(/full/i);
    expect(resolveFailureMessage('not-found')).toMatch(/code/i);
    expect(resolveFailureMessage('network')).toMatch(/reach|connection/i);
    // Offline still points at the door that works (§4.8 risk 6).
    expect(resolveFailureMessage('network')).toMatch(/SOLO/i);
  });
});

describe('a lost server is not a lost connection', () => {
  it('gives each terminal reason its own distinct copy', () => {
    const gone = reconnectEndedCopy('room-gone');
    const away = reconnectEndedCopy('grace-elapsed');
    expect(gone.headline).not.toBe(away.headline);
    expect(gone.detail).not.toBe(away.detail);
  });

  it('says "lost the server" for a dead room and "away too long" for a spent grace', () => {
    expect(reconnectEndedCopy('room-gone').detail).toMatch(/lost the server/i);
    expect(reconnectEndedCopy('grace-elapsed').detail).toMatch(/away too long/i);
  });

  it('covers every StopReason with non-empty words', () => {
    for (const reason of ALL_STOPS) {
      const copy = reconnectEndedCopy(reason);
      expect(copy.headline.length).toBeGreaterThan(0);
      expect(copy.detail.length).toBeGreaterThan(0);
    }
  });
});

describe('region — modelled, suppressed at one region', () => {
  const one: RegionInfo[] = [{ id: 'iad', label: 'US East', pingMs: 20 }];
  const two: RegionInfo[] = [
    { id: 'iad', label: 'US East', pingMs: 20 },
    { id: 'fra', label: 'Europe', pingMs: 180 },
  ];

  it('hides the picker for a single region (launch config)', () => {
    expect(regionPickerVisible(one)).toBe(false);
    expect(regionPickerVisible([])).toBe(false);
  });

  it('shows the picker the moment a second region is configured', () => {
    expect(regionPickerVisible(two)).toBe(true);
  });

  it('warns only across regions, and only for a slow hop', () => {
    // One region: nothing to compare, so no warning even at a high ping.
    expect(crossRegionWarning([{ id: 'iad', label: 'US East', pingMs: 999 }], 'iad')).toBe('');
    // Two regions: a comfortable ping is silent…
    expect(crossRegionWarning(two, 'iad')).toBe('');
    // …a slow hop warns.
    const warn = crossRegionWarning(two, 'fra');
    expect(warn).toMatch(/slow hop|lag/i);
    expect(warn).toContain('180');
  });

  it('stays silent when the selected region has no measured ping', () => {
    const unmeasured: RegionInfo[] = [
      { id: 'iad', label: 'US East', pingMs: 20 },
      { id: 'fra', label: 'Europe', pingMs: null },
    ];
    expect(crossRegionWarning(unmeasured, 'fra')).toBe('');
  });

  it('exposes a tunable threshold with a sane default', () => {
    expect(CROSS_REGION_PING_WARN_MS).toBeGreaterThan(0);
  });
});

describe('a browse row that could not be joined (u17-01)', () => {
  const FAILURES: readonly ListingJoinFailure[] = [
    'no-capacity',
    'not-found',
    'network',
    'bad-response',
    'room-full',
  ];

  it('has a sentence for every way a row join can fail', () => {
    for (const reason of FAILURES) {
      expect(listingFailureMessage(reason).length, reason).toBeGreaterThan(0);
    }
  });

  it('says something DIFFERENT for a 404 than the keypad does', () => {
    // Same status code, two different facts: on the code path a 404 means "check
    // what you typed"; on a row the player typed nothing, and the claim is gone.
    expect(listingFailureMessage('not-found')).not.toBe(resolveFailureMessage('not-found'));
    expect(listingFailureMessage('not-found')).toMatch(/closed/i);
    expect(listingFailureMessage('room-full')).toMatch(/filled up/i);
  });

  it('shares the lines that are about the CONNECTION, not the room', () => {
    // A fleet that is full and a fetch that never landed say nothing about which
    // room was asked for, so they say what they already say everywhere else.
    for (const reason of ['no-capacity', 'network', 'bad-response'] as const) {
      expect(listingFailureMessage(reason)).toBe(resolveFailureMessage(reason));
    }
  });
});
