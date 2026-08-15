/**
 * src/art/vfx/shots.test.ts — the shot is a LASER, and it points where it is going.
 *
 * The shot used to be two concentric circles. A round projectile carries no
 * direction, so a still frame could not say which way a shot was travelling or
 * who fired it. a0-46 replaced it with the developer's own pick out of
 * `assets/preview/laser-lab.html` — PIERCE — and this file holds that shape to
 * the four things the ruling actually said, by name:
 *
 *  - **longer than it is wide** — the assertion a ball cannot satisfy;
 *  - **points along its own velocity** — asserted through the RENDERER, because a
 *    perfect laser drawn at rotation 0 is the bug this gate exists for
 *    (LESSONS §26: assert the relationship, not the value);
 *  - **colour is the side, girth is the rung** — a relationship no per-value
 *    assertion can see, since four correct colour constants would satisfy a value
 *    test while the retired per-rung ladder still varied by tier;
 *  - **a higher rung is wider at the head and longer at the tail** — both
 *    channels, and the body's half-thickness held still.
 *
 * The palette rules the old ramp was held to are kept below unchanged: no rung
 * spends a reserved hue, enemy fire stays in the threat-red family, and every
 * colour is on the allow-list. Those never depended on the shape.
 */

import { describe, it, expect } from 'vitest';
import { Container } from 'pixi.js';
import { ShipClass } from '@shared/types';
import { ALLOWED_COLORS, DERIVED, PALETTE } from '../palette';
import { RED_FAMILY, YELLOW_FAMILY, auditSprite } from '../compliance';
import type { SpriteDef } from '../shapes';
import { createWorld } from '../../sim';
import type { Projectile, World } from '../../sim';
import { Renderer } from '../../render';
import type { Viewport } from '@platform/camera';
import {
  BOLT_BODY_HALF_WIDTH,
  SHOT_FAMILIES,
  SHOT_MAX_TIER,
  SHOT_SIDE_COLOR,
  SHOT_SPRITE_EXTENT,
  SHOT_TIERS,
  boltGeometry,
  clampShotTier,
  shotSprite,
} from './shots';

// ---------------------------------------------------------------------------
// Measuring the painted bolt
// ---------------------------------------------------------------------------

interface Box {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

const EMPTY: Box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };

/**
 * The box the sprite's paths actually occupy, in unit space, over the shapes and
 * the region a caller cares about.
 *
 * `xMax` clips the walk to everything at or behind a given x — the probe the
 * aspect gate uses to measure the TRAIL without the head in the way. A point is
 * kept only if it is inside the clip, and a circle is kept only if its whole
 * span is, so a shape straddling the boundary cannot half-count.
 */
function paintedBox(def: SpriteDef, xMax = Infinity): Box {
  let { x0, x1, y0, y1 } = EMPTY;
  const add = (x: number, y: number): void => {
    if (x > xMax) return;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  };
  for (const shape of def.shapes) {
    if (shape.path.kind === 'circle') {
      const { cx, cy, r } = shape.path;
      if (cx + r > xMax) continue;
      add(cx - r, cy - r);
      add(cx + r, cy + r);
    } else {
      const p = shape.path.points;
      for (let i = 0; i < p.length; i += 2) add(p[i]!, p[i + 1]!);
    }
  }
  return { x0, x1, y0, y1 };
}

const width = (b: Box): number => b.x1 - b.x0;
const height = (b: Box): number => b.y1 - b.y0;

/** Every colour the sprite paints, in draw order. */
const colorsOf = (def: SpriteDef): number[] => def.shapes.map((s) => s.fill!.color);

/** The colours the sprite paints that are NOT the hot core — i.e. the body: the
 *  sheath, the head and both blooms. The core is deliberately the same on both
 *  sides (heat has no allegiance), so it is excluded from the side test. */
const bodyColorsOf = (def: SpriteDef): number[] =>
  colorsOf(def).filter((c) => c !== DERIVED.boltCore);

// ---------------------------------------------------------------------------
// The gates
// ---------------------------------------------------------------------------

describe('the PIERCE laser bolt', () => {
  /**
   * **The whole point of the brief.** A ball scores exactly 1.0 on every measure
   * below; the shot this replaced was two concentric circles and did.
   *
   * The ratio is the bolt's full painted length against **the thickness of the
   * line it is drawn as**, measured over the far half of the tail so the head is
   * not in the shot. That is the honest reading of "longer than it is wide" for
   * this shape, and it is deliberately not the full sprite's bounding box:
   * the ruling says a high rung is *"almost like a ball with a trail"* and gives
   * the top rung a round head bloom of radius `headHw × 2.3`, so the whole-sprite
   * box narrows from 5.34× at Mk I to 2.65× at Mk IV **by design**. Measuring
   * the line instead reports the thing the rung is supposed to move — and it
   * climbs, 5.34 → 7.67, because the tail grows while the line stays a hairline.
   *
   * The second assertion pins the whole-sprite box too, at a floor no round
   * sprite can reach, so "ball with a trail" can never become "ball".
   */
  it('longer than it is wide', () => {
    for (const family of SHOT_FAMILIES) {
      for (const tier of SHOT_TIERS) {
        const def = shotSprite(family, tier);
        const { back } = boltGeometry(tier);
        const whole = paintedBox(def);
        // The far half of the tail: everything behind the mid-point of the trail,
        // which is well behind where the head's taper begins at every rung.
        const trail = paintedBox(def, back / 2);
        const along = width(whole);
        const across = height(trail);

        expect(across, `${family} Mk ${tier + 1}: nothing painted behind the head`).toBeGreaterThan(0);
        expect(
          along / across,
          `${family} Mk ${tier + 1}: ${along.toFixed(2)} long against a ${across.toFixed(2)}-thick line`,
        ).toBeGreaterThanOrEqual(4);

        // ...and the sprite as a whole is nowhere near round, at any rung.
        expect(width(whole) / height(whole)).toBeGreaterThan(2.5);
      }
    }
  });

  /**
   * The bolt is authored pointing +x, so it is only a laser if the renderer turns
   * it onto the shot's velocity. This asserts the RENDERER's wiring rather than
   * the sprite: a flawless bolt drawn at rotation 0 is a lance pointing east
   * regardless of where it is going, and it is exactly the half of this change
   * most likely to be left out.
   *
   * The expectation is computed from each projectile's own `vel` (LESSONS §26 —
   * the relationship, not the value), and the four directions are distinct, so a
   * renderer that hard-codes any single angle fails on three of them.
   */
  it('points along its own velocity', () => {
    const w = shotWorld([
      { x: 1, y: 0 }, // due east — the one direction an unrotated sprite gets right
      { x: 0, y: 1 },
      { x: -3, y: 0 },
      { x: -2, y: -2 },
    ]);
    const sprites = drawnShots(render(w));
    expect(sprites).toHaveLength(w.projectiles.length);

    for (let i = 0; i < sprites.length; i++) {
      const p = w.projectiles[i]!;
      expect(sprites[i]!.rotation, `shot ${i} travelling (${p.vel.x}, ${p.vel.y})`).toBeCloseTo(
        Math.atan2(p.vel.y, p.vel.x),
        10,
      );
    }
    // Four velocities, four distinct headings — nothing constant can pass.
    expect(new Set(sprites.map((s) => s.rotation)).size).toBe(4);
  });

  /**
   * The ruling: *"all friendlies should have that same blue and all enemies
   * red... even in team mode... in ffa its all red obviously"*. A teammate's fire
   * is friendly fire and reads as yours; what separates the rungs is girth and
   * length, never hue.
   *
   * This is a relationship no per-value assertion can see. The retired
   * `SHOT_TIER_COLORS` ladder had four correct, allow-listed, non-yellow, in-family
   * colours per side — every value test in this file passed on it — and it was
   * still wrong, because the *tier* moved the colour. Comparing rung against rung
   * is the only check that catches that.
   */
  it('colour is the side, girth is the rung', () => {
    for (const family of SHOT_FAMILIES) {
      const base = bodyColorsOf(shotSprite(family, 0));
      for (const tier of SHOT_TIERS) {
        // Two rungs of the SAME family paint the same body colour.
        expect(bodyColorsOf(shotSprite(family, tier)), `${family} Mk ${tier + 1} vs Mk I`).toEqual(base);
      }
      expect(new Set(base)).toEqual(new Set([SHOT_SIDE_COLOR[family]]));
    }

    for (const tier of SHOT_TIERS) {
      // Two families at the SAME rung do not.
      const own = new Set(bodyColorsOf(shotSprite('own', tier)));
      const enemy = new Set(bodyColorsOf(shotSprite('enemy', tier)));
      for (const c of own) expect(enemy.has(c), `Mk ${tier + 1}: ${hex(c)} on both sides`).toBe(false);
    }

    // The hot core is the exception, and it is deliberate: heat has no
    // allegiance, so both sides run the same near-white core inside their sheath.
    for (const tier of SHOT_TIERS) {
      for (const family of SHOT_FAMILIES) {
        expect(colorsOf(shotSprite(family, tier))).toContain(DERIVED.boltCore);
      }
    }
  });

  /**
   * *"add some girth that comes from the tip... so mk iv looks like almost like a
   * ball with a trail"* + *"make the trails length also be influenced by the mk's,
   * mk iv uses what it has now and we decrease down to mk 1"*.
   *
   * Two channels carry the rung on purpose — in a close firefight you read the
   * head, in a burst strung across the screen you read the trail — so a ramp that
   * moves only one of them is a failure, and so is one that thickens the BODY,
   * because a thicker body stops being a trail. All three are asserted here, on
   * the sprite's own painted geometry as well as on the declared numbers.
   */
  it('a higher rung is wider at the head and longer at the tail', () => {
    for (let tier = 1; tier <= SHOT_MAX_TIER; tier++) {
      const lower = boltGeometry(tier - 1);
      const upper = boltGeometry(tier);
      expect(upper.headHalfWidth, `Mk ${tier + 1} head`).toBeGreaterThan(lower.headHalfWidth);
      expect(upper.trailLength, `Mk ${tier + 1} tail`).toBeGreaterThan(lower.trailLength);
      // The body does NOT thicken — this is the one that must hold still.
      expect(upper.bodyHalfWidth).toBe(lower.bodyHalfWidth);
      // And the tail grows BACKWARDS out of a tip that never moves, so a rung
      // change cannot slide the bolt along its own firing line.
      expect(upper.fwd).toBe(lower.fwd);
    }
    expect(boltGeometry(0).bodyHalfWidth).toBe(BOLT_BODY_HALF_WIDTH);

    // The same three claims, measured off the painted sprite rather than the
    // constants behind it — so a shape that stops honouring the ramp fails here
    // even if the ramp itself is still monotonic.
    for (const family of SHOT_FAMILIES) {
      for (let tier = 1; tier <= SHOT_MAX_TIER; tier++) {
        const lower = shotSprite(family, tier - 1);
        const upper = shotSprite(family, tier);
        expect(headWidthOf(upper)).toBeGreaterThan(headWidthOf(lower));
        expect(paintedBox(upper).x0).toBeLessThan(paintedBox(lower).x0);
        expect(trailWidthOf(upper)).toBeCloseTo(trailWidthOf(lower), 6);
      }
    }
  });

  // -------------------------------------------------------------------------
  // The rules that never depended on the shape
  // -------------------------------------------------------------------------

  it('has a base plus three upgrade rungs', () => {
    expect(SHOT_MAX_TIER).toBe(3);
    expect(SHOT_TIERS).toEqual([0, 1, 2, 3]);
  });

  it('starts each family at its own side hue — whose shot stays instant', () => {
    expect(SHOT_SIDE_COLOR.own).toBe(PALETTE.plasma);
    expect(SHOT_SIDE_COLOR.enemy).toBe(PALETTE.threatRed);
  });

  it('bakes a palette-clean sprite for every rung', () => {
    for (const family of SHOT_FAMILIES) {
      for (const tier of SHOT_TIERS) {
        const def = shotSprite(family, tier);
        expect(auditSprite(def)).toEqual([]);
        const role = family === 'own' ? 'energy' : 'danger';
        expect(def.shapes.every((s) => s.role === role)).toBe(true);
        for (const c of colorsOf(def)) expect(ALLOWED_COLORS.has(c)).toBe(true);
      }
    }
  });

  it('never spends signal yellow, and keeps enemy fire in the threat-red family', () => {
    for (const tier of SHOT_TIERS) {
      for (const family of SHOT_FAMILIES) {
        for (const c of colorsOf(shotSprite(family, tier))) expect(YELLOW_FAMILY.has(c)).toBe(false);
      }
      expect(RED_FAMILY.has(SHOT_SIDE_COLOR.enemy)).toBe(true);
      expect(RED_FAMILY.has(SHOT_SIDE_COLOR.own)).toBe(false);
      // ...and the core, which both sides share, is not a red the enemy owns.
      expect(RED_FAMILY.has(DERIVED.boltCore)).toBe(false);
    }
  });

  it('clamps a missing/over-max/NaN tier to the nearest rung', () => {
    expect(clampShotTier(-3)).toBe(0);
    expect(clampShotTier(99)).toBe(SHOT_MAX_TIER);
    expect(clampShotTier(Number.NaN)).toBe(0);
    expect(clampShotTier(2.9)).toBe(2);
    // A shot far past the top ladder still draws as the fiercest rung, never crashes.
    expect(shotSprite('enemy', 42)).toEqual(shotSprite('enemy', SHOT_MAX_TIER));
  });

  it('declares an extent that bounds every rung — the number the cull pads by', () => {
    for (const family of SHOT_FAMILIES) {
      for (const tier of SHOT_TIERS) {
        const def = shotSprite(family, tier);
        const box = paintedBox(def);
        expect(def.extent).toBeLessThanOrEqual(SHOT_SPRITE_EXTENT);
        for (const v of [box.x0, box.x1, box.y0, box.y1]) {
          expect(Math.abs(v)).toBeLessThanOrEqual(def.extent);
        }
      }
    }
    expect(SHOT_SPRITE_EXTENT).toBeCloseTo(11.672, 3);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const hex = (n: number): string => '#' + n.toString(16).padStart(6, '0');

/** The painted width across the head — the sprite's height at the tip end. */
function headWidthOf(def: SpriteDef): number {
  const whole = paintedBox(def);
  return height(whole);
}

/** The painted width across the trail, behind the head. */
function trailWidthOf(def: SpriteDef): number {
  const tier = Number(def.name.slice(def.name.lastIndexOf(':') + 1));
  return height(paintedBox(def, boltGeometry(tier).back / 2));
}

const VIEW: Viewport = { width: 800, height: 600, originX: 0, originY: 0 };
const CENTRE = { x: 1000, y: 1000 };

/** A world holding one shot per velocity, all of them parked at the viewer so
 *  every one is on screen and the slot order is the projectile order. */
function shotWorld(velocities: readonly { x: number; y: number }[]): World {
  const w = createWorld({ seed: 3, players: [{ id: 0, shipClass: ShipClass.Vanguard }] });
  w.ships[0]!.pos = { x: CENTRE.x, y: CENTRE.y };
  w.asteroids.length = 0;
  w.chunks.length = 0;
  velocities.forEach((vel, i) => {
    const p: Projectile = {
      id: i,
      active: true,
      owner: 0,
      pos: { x: CENTRE.x, y: CENTRE.y },
      vel: { ...vel },
      damage: 1,
      radius: 4,
      life: 1,
    };
    w.projectiles.push(p);
  });
  return w;
}

function render(w: World): Container {
  const stage = new Container();
  new Renderer(stage, VIEW).draw(w, { cameraTarget: 0, muzzles: [] });
  return stage;
}

function drawnShots(stage: Container): Container[] {
  const node = stage.getChildByLabel('shots', true);
  if (!node) throw new Error("render layer 'shots' is missing from the stage");
  return (node as Container).children.filter((c) => c.visible) as Container[];
}
