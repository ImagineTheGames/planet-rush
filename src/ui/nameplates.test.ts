/**
 * Nameplate model tests (field request v0.2.1, GDD §2.9, style-guide §2 / §3).
 * The load-bearing contracts, straight from the field request:
 *
 *  - **Who gets a label:** every live ship and every owned (live) planet; a dead
 *    ship and a destroyed planet (a wreck — no longer owned) get none; un-owned
 *    hostiles are never named.
 *  - **The local ship's own label is optional-off** and defaults off, while the
 *    local PLANET is still labelled.
 *  - **What text:** the lobby/room name for a slot, falling back to a `P{n}` tag
 *    when a slot has no name — identity never vanishes.
 *  - **Which colour:** the owner's identity colour from the ratified roster, never
 *    signal yellow / threat red (RESERVED).
 *  - **Fade under clutter:** a label over a damaged or fighting entity fades so it
 *    never competes with the health bar.
 */
import { describe, it, expect } from 'vitest';
import { PALETTE, PLAYER_COLORS } from '@render/index';
import {
  nameplateModel,
  nameplateGetsLabel,
  resolveName,
  fallbackName,
  NAMEPLATE_FULL_ALPHA,
  NAMEPLATE_FADE_ALPHA,
  NAMEPLATE_MAX_CHARS,
} from './nameplates';
import type { Nameable, NameTable } from './nameplates';

/** A live enemy SHIP at owner 3 — the labelled baseline each test perturbs. */
function ship(over: Partial<Nameable> = {}): Nameable {
  return { owner: 3, kind: 'ship', alive: true, pos: { x: 100, y: 100 }, radius: 12, ...over };
}
/** A live OWNED planet at owner 3. */
function planet(over: Partial<Nameable> = {}): Nameable {
  return { owner: 3, kind: 'planet', alive: true, pos: { x: 400, y: 400 }, radius: 40, ...over };
}

/** Names indexed by slot — local player 0 named "YOU", a couple of bots named. */
const NAMES: NameTable = ['YOU', 'Rusty', 'Bolt', 'Warden'];

describe('who gets a label', () => {
  it('labels a live enemy ship', () => {
    expect(nameplateGetsLabel(ship())).toBe(true);
  });

  it('labels a live owned planet', () => {
    expect(nameplateGetsLabel(planet())).toBe(true);
  });

  it('never labels a dead ship', () => {
    expect(nameplateGetsLabel(ship({ alive: false }))).toBe(false);
  });

  it('never labels a destroyed planet (a wreck is no longer owned)', () => {
    expect(nameplateGetsLabel(planet({ alive: false }))).toBe(false);
  });

  it('never labels an un-owned hostile wave unit', () => {
    expect(nameplateGetsLabel(ship({ owner: -1 }))).toBe(false);
  });

  it('suppresses the local ship’s own label by default', () => {
    expect(nameplateGetsLabel(ship({ owner: 0, local: true }))).toBe(false);
  });

  it('shows the local ship’s own label when the setting opts in', () => {
    expect(nameplateGetsLabel(ship({ owner: 0, local: true }), { showOwnShipLabel: true })).toBe(true);
  });

  it('always labels the local player’s own PLANET (no local flag on a planet)', () => {
    expect(nameplateGetsLabel(planet({ owner: 0 }))).toBe(true);
  });
});

describe('what text (the name table)', () => {
  it('shows a bot’s personality name from its slot', () => {
    expect(resolveName(NAMES, 1)).toBe('Rusty');
    expect(resolveName(NAMES, 3)).toBe('Warden');
  });

  it('shows the local player’s lobby name from slot 0', () => {
    expect(resolveName(NAMES, 0)).toBe('YOU');
  });

  it('falls back to a P{n} tag when a slot has no name', () => {
    expect(resolveName(NAMES, 5)).toBe('P6'); // 1-based, like the hull decal
    expect(fallbackName(4)).toBe('P5');
  });

  it('falls back for a blank / whitespace-only name too', () => {
    expect(resolveName(['   ', ''], 0)).toBe('P1');
    expect(resolveName(['   ', ''], 1)).toBe('P2');
  });

  it('truncates an over-long name with an ellipsis', () => {
    const long = 'A-Very-Long-Callsign-Indeed';
    const shown = resolveName([long], 0);
    expect(shown.length).toBe(NAMEPLATE_MAX_CHARS);
    expect(shown.endsWith('…')).toBe(true);
  });
});

describe('which colour (identity, never RESERVED)', () => {
  it('tints a label the owner’s identity colour', () => {
    const [plate] = nameplateModel([ship({ owner: 2 })], NAMES);
    expect(plate!.color).toBe(PLAYER_COLORS[2]);
  });

  it('never uses signal yellow or threat red', () => {
    for (let slot = 0; slot < PLAYER_COLORS.length; slot++) {
      const [plate] = nameplateModel([ship({ owner: slot })], NAMES);
      expect(plate!.color).not.toBe(PALETTE.signalYellow);
      expect(plate!.color).not.toBe(PALETTE.threatRed);
    }
  });
});

describe('fade under combat clutter', () => {
  it('draws a calm label at full opacity', () => {
    const [plate] = nameplateModel([ship()], NAMES);
    expect(plate!.alpha).toBeCloseTo(NAMEPLATE_FULL_ALPHA, 5);
  });

  it('fades a label over a fighting entity', () => {
    const [plate] = nameplateModel([ship({ inCombat: true })], NAMES);
    expect(plate!.alpha).toBeCloseTo(NAMEPLATE_FADE_ALPHA, 5);
  });

  it('fades a label over a damaged entity (a health bar is up)', () => {
    const [plate] = nameplateModel([ship({ hpFraction: 0.5 })], NAMES);
    expect(plate!.alpha).toBeCloseTo(NAMEPLATE_FADE_ALPHA, 5);
  });
});

describe('the whole frame', () => {
  it('emits one plate per labelled entity, passing screen position through', () => {
    const plates = nameplateModel(
      [
        ship({ owner: 1, pos: { x: 10, y: 20 }, radius: 12 }),
        planet({ owner: 1, pos: { x: 30, y: 40 }, radius: 40 }),
        ship({ owner: 0, local: true }), // suppressed by default
        ship({ owner: 2, alive: false }), // dead → dropped
      ],
      NAMES,
    );
    expect(plates.map((p) => ({ owner: p.owner, kind: p.kind, text: p.text }))).toEqual([
      { owner: 1, kind: 'ship', text: 'Rusty' },
      { owner: 1, kind: 'planet', text: 'Rusty' },
    ]);
    expect(plates[0]!.x).toBe(10);
    expect(plates[0]!.y).toBe(20);
    expect(plates[0]!.radius).toBe(12);
  });

  it('marks only the local ship’s label local (when shown), never a planet’s', () => {
    const [shipPlate, planetPlate] = nameplateModel(
      [ship({ owner: 0, local: true }), planet({ owner: 0 })],
      NAMES,
      { showOwnShipLabel: true },
    );
    expect(shipPlate!.local).toBe(true);
    expect(planetPlate!.local).toBe(false);
  });
});
