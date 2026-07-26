/**
 * src/ui/tap-markers.test.ts — the Tap Commander order-marker decision (developer
 * §4). Proves which markers exist for a given standing order and that every one
 * wears the player's identity colour; the animation (spin, pulse, arrival fade) is
 * the view's, exercised on a real boot by the live-stage spec.
 */
import { describe, it, expect } from 'vitest';
import { tapMarkersModel } from './tap-markers';
import type { TapMarkerInput } from './tap-markers';
import { playerColor } from './planet-hp';

const base: TapMarkerInput = {
  owner: 0,
  waypoint: null,
  lock: null,
  firing: false,
  shipX: 400,
  shipY: 300,
};

describe('tapMarkersModel', () => {
  it('draws nothing with no standing order (the sticks scheme feeds all-empty)', () => {
    const m = tapMarkersModel(base);
    expect(m.reticle).toBeNull();
    expect(m.waypoint).toBeNull();
    expect(m.intent).toBeNull();
  });

  it('a waypoint order draws a waypoint marker at the tapped point, no reticle', () => {
    const m = tapMarkersModel({ ...base, waypoint: { x: 120, y: 80 } });
    expect(m.waypoint).toEqual({ x: 120, y: 80, color: playerColor(0) });
    expect(m.reticle).toBeNull();
    expect(m.intent).toBeNull();
  });

  it('a lock draws a reticle riding the target (centre + radius), no waypoint', () => {
    const m = tapMarkersModel({ ...base, lock: { x: 500, y: 260, radius: 18 } });
    expect(m.reticle).toEqual({ x: 500, y: 260, radius: 18, color: playerColor(0) });
    expect(m.waypoint).toBeNull();
  });

  it('a lock alone draws NO line of intent — a selection is not an engagement', () => {
    const m = tapMarkersModel({ ...base, lock: { x: 500, y: 260, radius: 18 }, firing: false });
    expect(m.reticle).not.toBeNull();
    expect(m.intent).toBeNull();
  });

  it('firing on a lock draws the line of intent from ship to target', () => {
    const m = tapMarkersModel({ ...base, lock: { x: 500, y: 260, radius: 18 }, firing: true });
    expect(m.intent).toEqual({ fromX: 400, fromY: 300, toX: 500, toY: 260, color: playerColor(0) });
  });

  it('firing with no lock draws no line of intent (nothing to fire on)', () => {
    const m = tapMarkersModel({ ...base, firing: true });
    expect(m.intent).toBeNull();
  });

  it('every marker wears the owner identity colour, so trim/bar/name/marker agree', () => {
    const owner = 3;
    const m = tapMarkersModel({
      ...base,
      owner,
      waypoint: { x: 10, y: 10 },
      lock: { x: 20, y: 20, radius: 5 },
      firing: true,
    });
    const color = playerColor(owner);
    expect(m.waypoint!.color).toBe(color);
    expect(m.reticle!.color).toBe(color);
    expect(m.intent!.color).toBe(color);
  });

  it('a waypoint and a lock never coexist in one order, but the model draws both if fed', () => {
    // The pilot holds exactly one order, so the wiring feeds only one of these at a
    // time; the model itself is a pure pass-through and would draw whatever it gets.
    const m = tapMarkersModel({
      ...base,
      waypoint: { x: 1, y: 2 },
      lock: { x: 3, y: 4, radius: 6 },
    });
    expect(m.waypoint).not.toBeNull();
    expect(m.reticle).not.toBeNull();
  });
});
