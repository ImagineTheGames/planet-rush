/**
 * The style guide's one *hard*, numeric art requirement, as a test (§4):
 *
 * > Each of the four silhouettes must be unambiguously distinguishable from the
 * > other three at **24×24 px**, in flat steel `#7E8894` with player colour
 * > removed.
 *
 * "Unambiguously distinguishable" is made measurable as Jaccard overlap of the
 * rasterized masses (./raster): 1.0 is the same shape, 0.0 shares no pixel. The
 * ceiling below is set with headroom over the worst pair the current hulls
 * produce, so an accidental convergence trips it long before a player would be
 * confused — and a *deliberate* redraw that pushes past it is a conversation
 * with the Director, which is exactly what a frozen contract should force.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import { asciiMask, coverage, jaccard, rasterize } from './raster';
import { HULLS, SHIP_CLASSES, shipHulkSprite, shipSilhouette, shipSprite } from './ships';
import { IDENTITY_COLORS, PALETTE, playerColor } from './palette';
import { spriteColors } from './shapes';

/** The size the rule is written at. Not a knob. */
const READ_SIZE = 24;

/** Max tolerated overlap between any two hulls at 24px. */
const MAX_OVERLAP = 0.6;

describe('ship silhouettes (style-guide §4)', () => {
  const masks = SHIP_CLASSES.map((c) => ({ shipClass: c, mask: rasterize(shipSilhouette(c), READ_SIZE) }));

  it('ships exactly four hulls — four classes, and no others (GDD §2.11)', () => {
    expect(SHIP_CLASSES).toHaveLength(4);
    expect(Object.keys(HULLS).sort()).toEqual(
      [ShipClass.Interceptor, ShipClass.Vanguard, ShipClass.Excavator, ShipClass.Hauler].sort(),
    );
  });

  it('is unambiguously distinguishable from every other hull at 24px', () => {
    for (let i = 0; i < masks.length; i++) {
      for (let j = i + 1; j < masks.length; j++) {
        const a = masks[i]!;
        const b = masks[j]!;
        const overlap = jaccard(a.mask, b.mask);
        expect(
          overlap,
          `${a.shipClass} vs ${b.shipClass} overlap ${overlap.toFixed(3)} at ${READ_SIZE}px\n` +
            `${asciiMask(a.mask)}\n---\n${asciiMask(b.mask)}`,
        ).toBeLessThan(MAX_OVERLAP);
      }
    }
  });

  it('carries enough mass at 24px to be seen, and not so much it is a blob', () => {
    for (const { shipClass, mask } of masks) {
      const c = coverage(mask);
      expect(c, `${shipClass} coverage ${c.toFixed(3)}`).toBeGreaterThan(0.08);
      expect(c, `${shipClass} coverage ${c.toFixed(3)}`).toBeLessThan(0.55);
    }
  });

  it('is drawn in flat hull steel and nothing else — the shape carries the read', () => {
    for (const c of SHIP_CLASSES) {
      expect(spriteColors(shipSilhouette(c))).toEqual([PALETTE.hullSteel]);
    }
  });

  it('survives greyscale: the silhouette is the same geometry the livery is built on', () => {
    for (const c of SHIP_CLASSES) {
      const plates = HULLS[c].plates.length;
      expect(shipSilhouette(c).shapes).toHaveLength(plates);
    }
  });
});

describe('ship liveries (style-guide §3)', () => {
  it('keeps every hull steel — a livery is a palette swap, never a repaint', () => {
    for (const c of SHIP_CLASSES) {
      for (let slot = 0; slot < 8; slot++) {
        const def = shipSprite({ shipClass: c, playerId: slot });
        const plateShapes = def.shapes.filter((s) => s.role === 'material' && s.fill);
        expect(plateShapes.some((s) => s.fill!.color === PALETTE.hullSteel)).toBe(true);
        // No material shape may wear an identity colour.
        for (const s of plateShapes) expect(IDENTITY_COLORS.has(s.fill!.color)).toBe(false);
      }
    }
  });

  it('paints identity trim in this player’s colour, and only there', () => {
    for (let slot = 0; slot < 8; slot++) {
      const def = shipSprite({ shipClass: ShipClass.Vanguard, playerId: slot });
      const identity = def.shapes.filter((s) => s.role === 'identity');
      expect(identity.length).toBeGreaterThan(0);
      for (const s of identity) {
        expect(s.fill?.color ?? s.stroke?.color).toBe(playerColor(slot));
      }
    }
  });

  it('gives every ship its number decal — identity never depends on colour alone', () => {
    // The decal is drawn in `decalInk` strokes; every hull must carry some.
    for (const c of SHIP_CLASSES) {
      for (let slot = 0; slot < 8; slot++) {
        const def = shipSprite({ shipClass: c, playerId: slot });
        const strokes = def.shapes.filter((s) => s.stroke && s.path.kind === 'poly' && !s.path.closed);
        expect(strokes.length, `${c} P${slot + 1} has no decal strokes`).toBeGreaterThanOrEqual(2);
      }
    }
    // Slots wearing different digits produce different sprites: "1" is two
    // segments, "8" is seven, so the shape count itself differs.
    const p1 = shipSprite({ shipClass: ShipClass.Hauler, playerId: 0 });
    const p8 = shipSprite({ shipClass: ShipClass.Hauler, playerId: 7 });
    expect(p1).not.toEqual(p8);
  });

  it('marks spawn protection with a plasma shell that does not hide the ship', () => {
    const plain = shipSprite({ shipClass: ShipClass.Interceptor, playerId: 0 });
    const shielded = shipSprite({ shipClass: ShipClass.Interceptor, playerId: 0, spawnProtected: true });
    expect(shielded.shapes.length).toBe(plain.shapes.length + 2);
    // The shell is behind the hull (drawn first) and translucent, so the ship
    // still reads through it — a tell, not a mask (GDD §2.1).
    const shell = shielded.shapes[0]!;
    expect(shell.role).toBe('energy');
    expect(shell.fill?.alpha ?? 1).toBeLessThan(0.3);
    expect(shielded.name).toContain('protected');
  });

  it('is deterministic — same options, deep-equal sprite', () => {
    for (const c of SHIP_CLASSES) {
      expect(shipSprite({ shipClass: c, playerId: 3 })).toEqual(shipSprite({ shipClass: c, playerId: 3 }));
      expect(shipSilhouette(c)).toEqual(shipSilhouette(c));
      expect(shipHulkSprite(c)).toEqual(shipHulkSprite(c));
    }
  });

  it('wraps out-of-range slots rather than throwing — a renderer never crashes on a bad id', () => {
    expect(shipSprite({ shipClass: ShipClass.Vanguard, playerId: 8 }).shapes.length).toBeGreaterThan(0);
    expect(playerColor(8)).toBe(playerColor(0));
    expect(playerColor(-1)).toBe(playerColor(7));
  });

  it('drops all identity from a hulk — the player is gone from it', () => {
    for (const c of SHIP_CLASSES) {
      for (const color of spriteColors(shipHulkSprite(c))) {
        expect(IDENTITY_COLORS.has(color)).toBe(false);
      }
    }
  });
});
