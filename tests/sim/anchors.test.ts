/**
 * tests/sim/anchors.test.ts — safe arrival geometry, the belt half of the
 * bot-home-rim wedge fix. OWNER: Gameplay Engineer (developer report p14).
 *
 * The report photographed a bot pinned against its OWN station's ring: a ship
 * given an *arrival point* — a place it is told to fly to and stop — at or inside
 * a solid body's collision radius wedges, because it thrusts forever into
 * geometry it can never reach. `clampAnchorOutside` is the single geometry rule
 * that keeps every arrival point a pilot can be given OUTSIDE
 * `bodyRadius + SHIP_RADIUS + margin`, so the ship parks *next to* a body instead
 * of *inside* it. "Fix the class, not the case": one clamp, every state.
 *
 * These pins nail the rule to the floor per arrival-point *shape* a bot uses
 * (deposit approach, defend post, repair park, satellite tend — all reducing to
 * "a point relative to a body"), the degenerate centre case the report caught
 * (`arrive(station.pos)`), and the determinism the sim lives or dies by.
 */

import { describe, it, expect } from 'vitest';
import type { Vec2 } from '@shared/types';
import { ANCHOR_MARGIN, SHIP_RADIUS, STATION, clampAnchorOutside, safeAnchorRadius } from '../../src/sim';

/** Centre-to-centre distance between two points. */
function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const STATION_R = STATION.radius; // 64 — the report's body

describe('safeAnchorRadius — the one "how far out is safe" number', () => {
  it('is bodyRadius + SHIP_RADIUS + margin (a ship stopped there clears the surface)', () => {
    expect(safeAnchorRadius(STATION_R)).toBe(STATION_R + SHIP_RADIUS + ANCHOR_MARGIN);
  });

  it('honours a caller-supplied margin', () => {
    expect(safeAnchorRadius(STATION_R, 40)).toBe(STATION_R + SHIP_RADIUS + 40);
  });

  it('a ship parked at the radius clears the body surface by exactly `margin`', () => {
    // Surface-to-hull gap = centre distance − bodyRadius − SHIP_RADIUS.
    const gap = safeAnchorRadius(STATION_R) - STATION_R - SHIP_RADIUS;
    expect(gap).toBe(ANCHOR_MARGIN);
    expect(gap).toBeGreaterThan(0); // never touching — the whole point
  });
});

describe('clampAnchorOutside — pushes any arrival point off the body', () => {
  const center: Vec2 = { x: 1000, y: 1000 };

  it('leaves a point already outside the safe radius untouched (in value)', () => {
    const anchor: Vec2 = { x: 1000 + safeAnchorRadius(STATION_R) + 50, y: 1000 };
    const out = clampAnchorOutside(anchor, center, STATION_R);
    expect(out.x).toBeCloseTo(anchor.x, 9);
    expect(out.y).toBeCloseTo(anchor.y, 9);
  });

  it('pushes a point INSIDE the collision radius out to exactly the safe radius', () => {
    // The report's class: an anchor deep inside the station body.
    const anchor: Vec2 = { x: 1000 + 10, y: 1000 };
    const out = clampAnchorOutside(anchor, center, STATION_R);
    expect(dist(out, center)).toBeCloseTo(safeAnchorRadius(STATION_R), 6);
  });

  it('preserves the anchor bearing while pushing it out (radial clamp, no rotation)', () => {
    const anchor: Vec2 = { x: 1000 + 12, y: 1000 + 16 }; // bearing atan2(16,12)
    const out = clampAnchorOutside(anchor, center, STATION_R);
    const bearingIn = Math.atan2(anchor.y - center.y, anchor.x - center.x);
    const bearingOut = Math.atan2(out.y - center.y, out.x - center.x);
    expect(bearingOut).toBeCloseTo(bearingIn, 9);
    expect(dist(out, center)).toBeCloseTo(safeAnchorRadius(STATION_R), 6);
  });

  it('the exact screenshot: arrive(station.pos) — anchor ON the centre — is pushed out via fallbackDir', () => {
    const anchor: Vec2 = { x: 1000, y: 1000 }; // dead centre, no direction of its own
    const fallbackDir: Vec2 = { x: 0, y: -1 }; // e.g. the ship's bearing from the station
    const out = clampAnchorOutside(anchor, center, STATION_R, ANCHOR_MARGIN, fallbackDir);
    expect(dist(out, center)).toBeCloseTo(safeAnchorRadius(STATION_R), 6);
    // Pushed straight along the fallback heading.
    expect(out.x).toBeCloseTo(1000, 6);
    expect(out.y).toBeCloseTo(1000 - safeAnchorRadius(STATION_R), 6);
  });

  it('anchor on the centre with a degenerate fallbackDir falls back to +x (never NaN)', () => {
    const out = clampAnchorOutside({ x: 1000, y: 1000 }, center, STATION_R, ANCHOR_MARGIN, { x: 0, y: 0 });
    expect(Number.isFinite(out.x)).toBe(true);
    expect(Number.isFinite(out.y)).toBe(true);
    expect(dist(out, center)).toBeCloseTo(safeAnchorRadius(STATION_R), 6);
    expect(out.x).toBeCloseTo(1000 + safeAnchorRadius(STATION_R), 6);
    expect(out.y).toBeCloseTo(1000, 6);
  });

  it('returns a fresh Vec2 — never aliases the input (callers may mutate freely)', () => {
    const anchor: Vec2 = { x: 5000, y: 5000 };
    const out = clampAnchorOutside(anchor, center, STATION_R);
    expect(out).not.toBe(anchor);
  });
});

describe('every arrival-point shape a bot uses lands OUTSIDE the collision radius', () => {
  // Each state gives the pilot a point relative to a body; the report demands
  // that every one of them clear `safeAnchorRadius`. We take the worst input a
  // state could produce (the point AT the body centre / surface) and prove the
  // clamp still parks the ship clear.
  const station: Vec2 = { x: 2048, y: 2048 };
  const cases: ReadonlyArray<{ state: string; body: Vec2; bodyR: number; want: Vec2 }> = [
    { state: 'deposit approach (arrive at own station)', body: station, bodyR: STATION_R, want: station },
    { state: 'defend post (hold the station ring)', body: station, bodyR: STATION_R, want: { x: station.x + 20, y: station.y } },
    { state: 'repair park (dock onto the core)', body: station, bodyR: STATION_R, want: { x: station.x, y: station.y + 5 } },
    // Satellite tend: a smaller body (a radar dish) the bot escorts.
    { state: 'satellite tend (escort the dish)', body: { x: 2200, y: 2100 }, bodyR: 24, want: { x: 2200, y: 2100 } },
  ];

  for (const c of cases) {
    it(`${c.state}: clamped point clears bodyRadius + SHIP_RADIUS + margin`, () => {
      const out = clampAnchorOutside(c.want, c.body, c.bodyR);
      const surfaceGap = dist(out, c.body) - c.bodyR - SHIP_RADIUS;
      expect(surfaceGap).toBeGreaterThanOrEqual(ANCHOR_MARGIN - 1e-6);
    });
  }
});

describe('determinism (GDD §4.8) — same inputs, byte-identical point', () => {
  it('is a pure function of its arguments — repeated calls agree exactly', () => {
    const center: Vec2 = { x: 777, y: 333 };
    const anchor: Vec2 = { x: 780, y: 330 };
    const a = clampAnchorOutside(anchor, center, STATION_R);
    const b = clampAnchorOutside(anchor, center, STATION_R);
    expect(a).toEqual(b);
    // No RNG, no clock, no hidden state — the input object is not mutated either.
    expect(anchor).toEqual({ x: 780, y: 330 });
  });
});
