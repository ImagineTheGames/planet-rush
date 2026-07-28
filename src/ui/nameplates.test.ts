/**
 * Nameplate model tests (field request v0.2.1, GDD §2.9, style-guide §2 / §3).
 * The load-bearing contracts, straight from the field request:
 *
 *  - **Who gets a label:** every live ship and every owned (live) station; a dead
 *    ship and a destroyed station (a wreck — no longer owned) get none; un-owned
 *    hostiles are never named.
 *  - **The local ship's own label is optional-off** and defaults off, while the
 *    local STATION is still labelled.
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
  resolveDifficultySuffix,
  fallbackName,
  NAMEPLATE_FULL_ALPHA,
  NAMEPLATE_FADE_ALPHA,
  NAMEPLATE_MAX_CHARS,
} from './nameplates';
import type { DifficultyTable, Nameable, NameTable } from './nameplates';

/** A live enemy SHIP at owner 3 — the labelled baseline each test perturbs. */
function ship(over: Partial<Nameable> = {}): Nameable {
  return { owner: 3, kind: 'ship', alive: true, pos: { x: 100, y: 100 }, radius: 12, ...over };
}
/** A live OWNED station at owner 3. */
function station(over: Partial<Nameable> = {}): Nameable {
  return { owner: 3, kind: 'station', alive: true, pos: { x: 400, y: 400 }, radius: 40, ...over };
}

/** Names indexed by slot — local player 0 named "YOU", a couple of bots named. */
const NAMES: NameTable = ['YOU', 'Rusty', 'Bolt', 'Warden'];

/** Difficulty table mirroring {@link NAMES}: slot 0 is the HUMAN (left empty, no
 *  suffix), the bot seats each carry their tier. */
const DIFFS: DifficultyTable = [undefined, 'easy', 'medium', 'hard'];

describe('who gets a label', () => {
  it('labels a live enemy ship', () => {
    expect(nameplateGetsLabel(ship())).toBe(true);
  });

  it('labels a live owned station', () => {
    expect(nameplateGetsLabel(station())).toBe(true);
  });

  it('never labels a dead ship', () => {
    expect(nameplateGetsLabel(ship({ alive: false }))).toBe(false);
  });

  it('never labels a destroyed station (a wreck is no longer owned)', () => {
    expect(nameplateGetsLabel(station({ alive: false }))).toBe(false);
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

  it('always labels the local player’s own STATION (no local flag on a station)', () => {
    expect(nameplateGetsLabel(station({ owner: 0 }))).toBe(true);
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

describe('difficulty suffix (field request v0.2.2)', () => {
  it('shows a bot’s tier as a parenthesised, upper-cased metadata suffix', () => {
    expect(resolveDifficultySuffix(DIFFS, 1)).toBe('(EASY)');
    expect(resolveDifficultySuffix(DIFFS, 2)).toBe('(MEDIUM)');
    expect(resolveDifficultySuffix(DIFFS, 3)).toBe('(HARD)');
  });

  it('gives a HUMAN seat no suffix (slot left empty in the table)', () => {
    expect(resolveDifficultySuffix(DIFFS, 0)).toBe('');
  });

  it('gives a slot the table doesn’t name no suffix', () => {
    expect(resolveDifficultySuffix(DIFFS, 5)).toBe('');
    expect(resolveDifficultySuffix([], 1)).toBe('');
    expect(resolveDifficultySuffix(['  '], 0)).toBe('');
  });

  it('never suffixes an un-owned hostile', () => {
    expect(resolveDifficultySuffix(DIFFS, -1)).toBe('');
  });

  it('carries the suffix onto a bot’s SHIP and its STATION plate, per difficulty', () => {
    const [botShip] = nameplateModel([ship({ owner: 3 })], NAMES, {}, DIFFS);
    const [botStation] = nameplateModel([station({ owner: 1 })], NAMES, {}, DIFFS);
    expect(botShip!.suffix).toBe('(HARD)');
    expect(botStation!.suffix).toBe('(EASY)');
  });

  it('never suffixes a human’s own STATION label', () => {
    const [humanStation] = nameplateModel([station({ owner: 0 })], NAMES, {}, DIFFS);
    expect(humanStation!.suffix).toBe('');
  });

  it('emits an empty suffix when no difficulty table is fed (back-compat)', () => {
    const [plate] = nameplateModel([ship({ owner: 3 })], NAMES);
    expect(plate!.suffix).toBe('');
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
        station({ owner: 1, pos: { x: 30, y: 40 }, radius: 40 }),
        ship({ owner: 0, local: true }), // suppressed by default
        ship({ owner: 2, alive: false }), // dead → dropped
      ],
      NAMES,
    );
    expect(plates.map((p) => ({ owner: p.owner, kind: p.kind, text: p.text }))).toEqual([
      { owner: 1, kind: 'ship', text: 'Rusty' },
      { owner: 1, kind: 'station', text: 'Rusty' },
    ]);
    expect(plates[0]!.x).toBe(10);
    expect(plates[0]!.y).toBe(20);
    expect(plates[0]!.radius).toBe(12);
  });

  it('marks only the local ship’s label local (when shown), never a station’s', () => {
    const [shipPlate, stationPlate] = nameplateModel(
      [ship({ owner: 0, local: true }), station({ owner: 0 })],
      NAMES,
      { showOwnShipLabel: true },
    );
    expect(shipPlate!.local).toBe(true);
    expect(stationPlate!.local).toBe(false);
  });
});
