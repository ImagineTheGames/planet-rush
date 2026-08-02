/**
 * The ping model (ping.ts) — the three rules that keep a number beside a name
 * honest. OWNER: Netcode Engineer (ratified developer: "show ping next to each
 * player in the lobby").
 *
 * What is actually being defended here is not arithmetic. It is the difference
 * between "no measurement" and "a good measurement": every path that has no round
 * trip — a bot, an empty seat, a lobby the server has not probed yet, an offline
 * match — must produce *nothing*, because the alternative shipping value is `0ms`,
 * and `0ms` next to Vulture would read as the best connection in the room.
 */
import { describe, it, expect } from 'vitest';
import {
  PING_FAIR_MS,
  PING_GOOD_MS,
  formatPing,
  gradePing,
  pingReadout,
  seatPing,
} from './ping';

describe('gradePing — the three bands (ratified: green <100, amber <200, red above)', () => {
  it('grades a fast connection green', () => {
    expect(gradePing(0)).toBe('good');
    expect(gradePing(45)).toBe('good');
    expect(gradePing(PING_GOOD_MS - 1)).toBe('good');
  });

  it('grades a middling one amber', () => {
    expect(gradePing(PING_GOOD_MS)).toBe('fair');
    expect(gradePing(150)).toBe('fair');
    expect(gradePing(PING_FAIR_MS - 1)).toBe('fair');
  });

  it('grades a bad one red, with no ceiling above it', () => {
    expect(gradePing(PING_FAIR_MS)).toBe('poor');
    expect(gradePing(245)).toBe('poor');
    expect(gradePing(4_000)).toBe('poor');
  });

  it('puts each threshold in the WORSE band — a number the player reads as "one\n' +
    '     hundred" is never shown in the band below it', () => {
    expect(gradePing(PING_GOOD_MS)).not.toBe('good');
    expect(gradePing(PING_FAIR_MS)).not.toBe('fair');
  });
});

describe('formatPing — one place the unit is spelled', () => {
  it('rounds to whole milliseconds and attaches the unit with no space', () => {
    expect(formatPing(245)).toBe('245ms');
    expect(formatPing(99.4)).toBe('99ms');
    expect(formatPing(99.6)).toBe('100ms');
  });
});

describe('pingReadout — a measurement, or nothing at all', () => {
  it('carries the number, the words and the band together', () => {
    expect(pingReadout(245)).toEqual({ ms: 245, label: '245ms', grade: 'poor' });
    expect(pingReadout(42)).toEqual({ ms: 42, label: '42ms', grade: 'good' });
  });

  it('grades the SAME integer it prints — a 99.6ms sample reads 100ms and is\n' +
    '     graded as 100ms, never green under an amber label', () => {
    const readout = pingReadout(99.6);
    expect(readout?.label).toBe('100ms');
    expect(readout?.grade).toBe('fair');
  });

  it('returns nothing for anything that is not a measurement', () => {
    expect(pingReadout(null)).toBeNull();
    expect(pingReadout(undefined)).toBeNull();
    expect(pingReadout(Number.NaN)).toBeNull();
    expect(pingReadout(Number.POSITIVE_INFINITY)).toBeNull();
    // A negative round trip is a clock that moved, not a fast connection.
    expect(pingReadout(-1)).toBeNull();
  });

  it('does show a genuine zero — a loopback-fast link is a measurement', () => {
    expect(pingReadout(0)).toEqual({ ms: 0, label: '0ms', grade: 'good' });
  });
});

describe('seatPing — who is allowed a number', () => {
  it('gives a measured human seat its readout', () => {
    expect(seatPing({ isBot: false, rtt: 245 })?.label).toBe('245ms');
  });

  it('NEVER gives a bot one — not even when the wire carried a number', () => {
    expect(seatPing({ isBot: true, rtt: 12 })).toBeNull();
    expect(seatPing({ isBot: true })).toBeNull();
    expect(seatPing({ isBot: true, rtt: 0 })).toBeNull();
  });

  it('gives an unmeasured human seat nothing — a lobby that just opened shows no\n' +
    '     ping for anyone, rather than a room full of 0ms', () => {
    expect(seatPing({ isBot: false })).toBeNull();
    expect(seatPing({ isBot: false, rtt: null })).toBeNull();
  });
});
