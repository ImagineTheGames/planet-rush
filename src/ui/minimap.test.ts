/**
 * Minimap tests (GDD §2.2 minimap bottom-right, §2.4 ping). The contracts:
 *  - the map hugs the bottom-right corner and stays inside its anchor zone;
 *  - world→map projection preserves the arena aspect and clamps to the map;
 *  - blips carry identity colour and mark the local player — but never HP;
 *  - the ping has a deterministic, match-time-driven pulse that expires.
 */
import { describe, it, expect } from 'vitest';
import {
  minimapSize,
  minimapBounds,
  projectToMinimap,
  minimapModel,
  pingAge,
  pingExpired,
  pingPulse,
  pingMarker,
  MINIMAP_MIN,
  MINIMAP_MAX,
  MINIMAP_MARGIN,
  PING_TTL,
  PING_MIN_RADIUS,
  PING_MAX_RADIUS,
} from './minimap';
import type { Arena } from './minimap';
import { resolveAnchor, DEFAULT_STRIP_HEIGHT } from '@platform/layout-registry';
import { PLAYER_COLORS } from '@render/index';

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const ARENA: Arena = { width: 1920, height: 1920 };

describe('minimap — size and placement (GDD §2.2 bottom-right)', () => {
  it('clamps its side length between the min and max on any device', () => {
    expect(minimapSize({ width: 200, height: 200 })).toBe(MINIMAP_MIN);
    expect(minimapSize({ width: 4000, height: 4000 })).toBe(MINIMAP_MAX);
    const phone = minimapSize(PHONE);
    expect(phone).toBeGreaterThanOrEqual(MINIMAP_MIN);
    expect(phone).toBeLessThanOrEqual(MINIMAP_MAX);
  });

  it('hugs the bottom-right corner, inset by the HUD margin', () => {
    const r = minimapBounds(DESKTOP);
    expect(r.x + r.width).toBeCloseTo(DESKTOP.width - MINIMAP_MARGIN, 5);
    // Lifted above the controls strip along the very bottom.
    expect(r.y + r.height).toBeCloseTo(
      DESKTOP.height - MINIMAP_MARGIN - DEFAULT_STRIP_HEIGHT,
      5,
    );
  });

  it('sits inside its declared `bottom-right` anchor zone on a phone', () => {
    // The same assertion QA's layout contract makes: drawn rect ⊆ declared zone.
    const zone = resolveAnchor({ region: 'bottom-right', margin: MINIMAP_MARGIN }, PHONE);
    const r = minimapBounds(PHONE);
    expect(r.x).toBeGreaterThanOrEqual(zone.x - 0.001);
    expect(r.y).toBeGreaterThanOrEqual(zone.y - 0.001);
    expect(r.x + r.width).toBeLessThanOrEqual(zone.x + zone.width + 0.001);
    expect(r.y + r.height).toBeLessThanOrEqual(zone.y + zone.height + 0.001);
  });
});

describe('minimap — world→map projection', () => {
  const rect = { x: 100, y: 100, width: 120, height: 120 };

  it('maps the arena centre to the map centre', () => {
    const p = projectToMinimap({ x: 960, y: 960 }, ARENA, rect);
    expect(p.x).toBeCloseTo(160, 5);
    expect(p.y).toBeCloseTo(160, 5);
  });

  it('maps the arena corners to the map corners (square arena, square map)', () => {
    expect(projectToMinimap({ x: 0, y: 0 }, ARENA, rect)).toEqual({ x: 100, y: 100 });
    const far = projectToMinimap({ x: 1920, y: 1920 }, ARENA, rect);
    expect(far.x).toBeCloseTo(220, 5);
    expect(far.y).toBeCloseTo(220, 5);
  });

  it('clamps a point outside the arena onto the map edge, never past it', () => {
    const p = projectToMinimap({ x: 5000, y: -5000 }, ARENA, rect);
    expect(p.x).toBeCloseTo(rect.x + rect.width, 5); // clamped to right edge
    expect(p.y).toBeCloseTo(rect.y, 5); // clamped to top edge
  });

  it('preserves aspect ratio, letterboxing a wide arena inside a square map', () => {
    const wide: Arena = { width: 2000, height: 1000 }; // 2:1
    const p = projectToMinimap({ x: 0, y: 0 }, wide, rect);
    // Width fills the map; height is letterboxed, so y is inset from the top.
    expect(p.x).toBeCloseTo(rect.x, 5);
    expect(p.y).toBeGreaterThan(rect.y + 1);
  });
});

describe('minimap — blips carry identity, never HP (GDD §2.2, §2.11)', () => {
  it('colours each blip by owner and marks the local player', () => {
    const model = minimapModel({
      viewport: DESKTOP,
      arena: ARENA,
      self: 2,
      planets: [
        { owner: 2, pos: { x: 100, y: 100 } },
        { owner: 5, pos: { x: 1800, y: 1800 } },
      ],
      ships: [{ owner: 2, pos: { x: 960, y: 960 } }],
      now: 0,
    });
    expect(model.planets[0]!.color).toBe(PLAYER_COLORS[2]);
    expect(model.planets[0]!.isSelf).toBe(true);
    expect(model.planets[1]!.color).toBe(PLAYER_COLORS[5]);
    expect(model.planets[1]!.isSelf).toBe(false);
    expect(model.ships[0]!.isSelf).toBe(true);
    // A blip is position + identity only — there is no HP field to leak.
    expect(model.planets[0]!).not.toHaveProperty('coreHp');
    expect(model.planets[0]!).not.toHaveProperty('hp');
  });

  it('flags a dead entity as a wreck without dropping it from the map', () => {
    const model = minimapModel({
      viewport: DESKTOP,
      arena: ARENA,
      self: 0,
      planets: [{ owner: 1, pos: { x: 0, y: 0 }, alive: false }],
      ships: [],
      now: 0,
    });
    expect(model.planets[0]!.alive).toBe(false);
  });
});

describe('minimap — the ping (GDD §2.4)', () => {
  const rect = { x: 0, y: 0, width: 100, height: 100 };

  it('ages from its drop time and expires after the TTL', () => {
    const ping = { at: { x: 0, y: 0 }, time: 10 };
    expect(pingAge(ping, 12)).toBeCloseTo(2, 5);
    expect(pingExpired(ping, 12)).toBe(false);
    expect(pingExpired(ping, 10 + PING_TTL)).toBe(true);
    // A ping from the future (clock skew / replay rewind) is not yet live.
    expect(pingExpired(ping, 9)).toBe(true);
  });

  it('pulses an expanding ring that fades over its life', () => {
    const young = pingPulse(0.001); // just born, start of a pulse
    expect(young.radius).toBeGreaterThanOrEqual(PING_MIN_RADIUS);
    expect(young.radius).toBeLessThan(PING_MAX_RADIUS);
    expect(young.alpha).toBeGreaterThan(0);
    // At expiry it is fully faded and gives nothing to draw.
    expect(pingPulse(PING_TTL).alpha).toBe(0);
    expect(pingPulse(-1).alpha).toBe(0);
  });

  it('projects a live ping onto the minimap and returns null once expired', () => {
    const arena: Arena = { width: 100, height: 100 };
    const live = pingMarker({ at: { x: 50, y: 50 }, time: 0 }, 1, arena, rect);
    expect(live).not.toBeNull();
    expect(live!.x).toBeCloseTo(50, 5);
    expect(live!.y).toBeCloseTo(50, 5);
    expect(pingMarker({ at: { x: 50, y: 50 }, time: 0 }, PING_TTL + 1, arena, rect)).toBeNull();
    expect(pingMarker(undefined, 1, arena, rect)).toBeNull();
  });

  it('colours the ping in the pinging player\'s identity colour when known', () => {
    const arena: Arena = { width: 100, height: 100 };
    const mine = pingMarker({ at: { x: 50, y: 50 }, time: 0, by: 4 }, 0.5, arena, rect);
    expect(mine!.color).toBe(PLAYER_COLORS[4]);
  });

  it('wires the ping into the full model', () => {
    const model = minimapModel({
      viewport: DESKTOP,
      arena: ARENA,
      self: 0,
      planets: [],
      ships: [],
      ping: { at: { x: 960, y: 960 }, time: 0 },
      now: 0.5,
    });
    expect(model.ping).not.toBeNull();
    expect(model.ping!.alpha).toBeGreaterThan(0);
  });
});
