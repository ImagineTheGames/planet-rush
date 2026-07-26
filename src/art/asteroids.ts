/**
 * src/art/asteroids.ts — the economy, drawn. OWNER: Art & Audio Agent.
 *
 * Style-guide §6 gives asteroids two jobs, and both are mechanical:
 *
 * > **Asteroids are the economy, so they crack visibly across three stages**
 * > and let a player judge a payout before committing mining time. Ore veins are
 * > the only yellow on an asteroid; the rock body is neutral steel-grey mineral.
 *
 * The second half is the one people forget. Mining time is the scarcest thing in
 * the game (GDD §2.3 — a minute mining is a minute not defending), so a player
 * standing off a rock must be able to *see the payout* before spending it. That
 * is why vein count scales with ore richness here: a fat rock is visibly veined,
 * a poor one is nearly bare, and the read is available at a glance from across
 * the field.
 *
 * Crack stages are sprite swaps at damage thresholds (GDD §4.1), so this module
 * emits three distinct sprites per rock rather than one animated shape:
 *
 *  - **Stage 0** — intact: solid body, full veins.
 *  - **Stage 1** — fissured: a fracture across the body, a chip missing, veins
 *    thinning as the ore comes out.
 *  - **Stage 2** — spent: the body splits into pieces with a dark gap between
 *    them, and only vein traces remain. It is visibly about to burst.
 *
 * Every rock is seeded (ratified `mulberry32`), so `asteroidSprite(id, stage)`
 * is byte-identical across client, server and replay (GDD §4.1).
 */

import { mulberry32 } from '@shared/types';
import { DERIVED, PALETTE } from './palette';
import {
  blob,
  circle,
  fill,
  poly,
  polyline,
  round,
  sprite,
  stroke,
  type Shape,
  type SpriteDef,
} from './shapes';

/** The three visible mining stages (style-guide §6). */
export const CRACK_STAGES = 3;

/** Everything a rock's look depends on. All of it is sim state the renderer has. */
export interface AsteroidSpriteOptions {
  /** The asteroid's entity id — the only randomness source. Same id, same rock. */
  readonly seed: number;
  /** 0 intact · 1 fissured · 2 spent (`Asteroid.crackStage`). */
  readonly crackStage: number;
  /**
   * Ore remaining as a fraction of what it spawned with, 0..1. Drives vein
   * count, which is how a player judges a payout before committing mining time.
   */
  readonly richness?: number;
}

function rockRng(seed: number, salt: number) {
  return mulberry32(((seed * 0x27d4eb2d) ^ (salt * 0x165667b1)) >>> 0);
}

/**
 * The rock's outline: an irregular 10–13-gon, never a circle.
 *
 * **Normalised to fit inside the unit circle.** The unit radius is the sim's
 * collision radius, and a rock whose art bulges past it would show mineral the
 * mining shot passes straight through — "why didn't that hit?" is a bug the
 * art can cause on its own, so the art doesn't claim mass the sim won't back.
 */
export function asteroidOutline(seed: number): number[] {
  const rng = rockRng(seed, 1);
  const verts = 10 + Math.floor(rng.next() * 4);
  const phase = rng.next() * Math.PI * 2;
  const jitter: number[] = [];
  for (let i = 0; i < verts; i++) jitter.push(0.82 + rng.next() * 0.3);
  const raw = blob(0, 0, verts, (i, a) => jitter[i]! * (1 + Math.sin(a * 2 + phase) * 0.06));
  let max = 0;
  for (let i = 0; i < raw.length; i += 2) max = Math.max(max, Math.hypot(raw[i]!, raw[i + 1]!));
  const k = max > 0 ? 1 / max : 1;
  return raw.map((n) => round(n * k));
}

/** Ore veins: short forked polylines across the body. More ore ⇒ more veins. */
function veins(seed: number, richness: number): Shape[] {
  const rng = rockRng(seed, 2);
  const count = Math.max(0, Math.round(richness * 5));
  const out: Shape[] = [];
  const ink = stroke(PALETTE.signalYellow, 0.09, 'ore', 0.95);
  const under = stroke(DERIVED.oreDeep, 0.14, 'ore', 0.8);
  for (let i = 0; i < count; i++) {
    const a = rng.next() * Math.PI * 2;
    const d = rng.next() * 0.42;
    const cx = Math.cos(a) * d;
    const cy = Math.sin(a) * d;
    const dir = rng.next() * Math.PI * 2;
    const len = 0.22 + rng.next() * 0.3;
    const bend = (rng.next() - 0.5) * 1.1;
    const pts = [
      round(cx - Math.cos(dir) * len * 0.5),
      round(cy - Math.sin(dir) * len * 0.5),
      round(cx + Math.cos(dir + bend) * len * 0.15),
      round(cy + Math.sin(dir + bend) * len * 0.15),
      round(cx + Math.cos(dir) * len * 0.5),
      round(cy + Math.sin(dir) * len * 0.5),
    ];
    out.push(polyline(pts, under), polyline(pts, ink));
  }
  return out;
}

/**
 * The body's radius at an arbitrary angle, read back off the outline. Cracks
 * and craters are placed against *this* rather than against a nominal radius of
 * 1 — a rock is an irregular polygon, and detail that assumes a circle spills
 * off the short side of it into empty space.
 */
function outlineRadiusAt(outline: readonly number[], angle: number): number {
  const n = outline.length / 2;
  // Vertices are evenly spaced in angle by construction (`blob`), so the
  // bracketing pair is an index, not a search.
  const t = ((angle / (Math.PI * 2)) % 1 + 1) % 1;
  const f = t * n;
  const i = Math.floor(f) % n;
  const j = (i + 1) % n;
  const k = f - Math.floor(f);
  const r = (idx: number): number => Math.hypot(outline[idx * 2]!, outline[idx * 2 + 1]!);
  return r(i) * (1 - k) + r(j) * k;
}

/** Fracture lines, added stage by stage so damage accumulates visibly. */
function fissures(seed: number, stage: number, outline: readonly number[]): Shape[] {
  if (stage <= 0) return [];
  const rng = rockRng(seed, 3);
  const ink = stroke(DERIVED.rockFissure, 0.07, 'material', 0.95);
  const out: Shape[] = [];
  for (let i = 0; i < stage * 2; i++) {
    const a = rng.next() * Math.PI * 2;
    const across = a + Math.PI * (0.6 + rng.next() * 0.8);
    // Stop just short of the rim so a crack reads as splitting the rock rather
    // than as a line drawn across the vacuum behind it.
    const r0 = outlineRadiusAt(outline, a) * (0.82 + rng.next() * 0.1);
    const r1 = outlineRadiusAt(outline, across) * (0.82 + rng.next() * 0.1);
    const kink = (rng.next() - 0.5) * 0.5;
    out.push(
      polyline(
        [
          round(Math.cos(a) * r0),
          round(Math.sin(a) * r0),
          round(kink),
          round(-kink),
          round(Math.cos(across) * r1),
          round(Math.sin(across) * r1),
        ],
        ink,
      ),
    );
  }
  return out;
}

/**
 * One rock at one crack stage. Unit radius = the sim's collision radius, so the
 * renderer scales by `Asteroid.radius` and nothing else.
 */
export function asteroidSprite(options: AsteroidSpriteOptions): SpriteDef {
  const stage = Math.max(0, Math.min(CRACK_STAGES - 1, Math.trunc(options.crackStage)));
  // Richness defaults to "as full as this stage implies", so a caller that only
  // knows the stage still gets an honest payout read.
  const richness = options.richness ?? 1 - stage / CRACK_STAGES;
  const outline = asteroidOutline(options.seed);
  const rng = rockRng(options.seed, 4);

  const body = fill(DERIVED.rockBody, 'material');
  const facet = fill(DERIVED.rockShadow, 'material', 0.8);
  const rim = stroke(DERIVED.rockFissure, 0.05, 'material', 0.9);

  const shapes: Shape[] = [];

  if (stage < 2) {
    shapes.push(poly(outline, body), poly(outline, rim));
  } else {
    // Spent: the body has split. Two pieces, pulled apart along a seam, with
    // Vacuum showing through — the "about to burst" read (GDD §2.3).
    const gap = 0.15;
    const half = (sign: number): number[] => {
      const pts: number[] = [];
      for (let i = 0; i < outline.length; i += 2) {
        const x = outline[i]!;
        const y = outline[i + 1]!;
        // Vertices on the seam belong to both halves, so neither piece loses its
        // flat face and the split reads as one rock in two bits.
        if (sign > 0 ? y >= -0.02 : y <= 0.02) pts.push(round(x), round(y + sign * gap));
      }
      return pts.length >= 6 ? pts : [];
    };
    for (const sign of [1, -1]) {
      const p = half(sign);
      if (p.length) shapes.push(poly(p, body), poly(p, rim));
    }
  }

  // Craters: the same steel-grey, shaded — mass, not decoration. Sized and
  // placed against the outline so none of them hangs off the rim.
  const craters = stage === 0 ? 3 : 2;
  for (let i = 0; i < craters; i++) {
    const a = rng.next() * Math.PI * 2;
    const rim = outlineRadiusAt(outline, a);
    const r = round(rim * (0.1 + rng.next() * 0.14));
    const d = round((0.15 + rng.next() * 0.42) * (rim - r));
    shapes.push(circle(round(Math.cos(a) * d), round(Math.sin(a) * d), r, facet));
  }

  // At stage 2 the split *is* the damage read, so no crack lines are drawn over
  // it — two pieces with vacuum between them says "spent" more plainly than
  // linework across a body that is no longer whole.
  shapes.push(...fissures(options.seed, stage === 2 ? 0 : stage, outline), ...veins(options.seed, richness));

  return sprite(
    `asteroid/${options.seed}/s${stage}/r${Math.round(richness * 10)}`,
    1,
    shapes,
  );
}

/**
 * A loose ore chunk (GDD §2.3): the thing your mining shot knocks out of a rock and
 * your tractor pulls in. Unambiguously ore — signal yellow, no other colour on
 * it — because it is the payoff the whole triangle turns on.
 */
export function oreChunkSprite(seed = 0): SpriteDef {
  const rng = rockRng(seed, 5);
  const phase = rng.next() * Math.PI * 2;
  const body = blob(0, 0, 7, (_, a) => 0.5 + Math.sin(a * 2 + phase) * 0.09 + rng.next() * 0.08);
  // A halo, so a loose chunk is findable against Vacuum from outside tractor
  // range — the thing the whole triangle is played for should never be missed.
  return sprite(`ore/chunk/${seed}`, 1.05, [
    circle(0, 0, 0.98, fill(PALETTE.signalYellow, 'ore', 0.1)),
    circle(0, 0, 0.72, fill(PALETTE.signalYellow, 'ore', 0.16)),
    poly(body, fill(PALETTE.signalYellow, 'ore')),
    // A shadowed lower-right facet and a lit upper-left one: the chunk reads as
    // a solid nugget rather than a flat yellow dot at any size.
    poly(body.map((n) => round(n * 0.62 + 0.14)), fill(DERIVED.oreDeep, 'ore', 0.9)),
    poly(body.map((n) => round(n * 0.34 - 0.16)), fill(DERIVED.coreHot, 'ore', 0.9)),
  ]);
}
