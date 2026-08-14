/**
 * evidence/a0-45-star-temperature-colour/shoot.ts — the before/after plates.
 * OWNER: Art Agent.
 *
 * ```sh
 * npx vite-node evidence/a0-45-star-temperature-colour/shoot.ts after
 * ```
 *
 * There is no browser and no SVG rasterizer on the plain-node side of this
 * container, so the plates go through a0-40's `plate.ts` — a plain-TS PNG
 * rasterizer over `inkAlphaAt`, the one definition of "how bright is this ink
 * here" that `backdrop.test.ts` and `sky-preview.ts` also use. It draws the
 * diffraction cross, which matters here: `sampleShapes` and `sampleMockup` do
 * **not** (they composite fills only), so the p99 instrument that guards this
 * field is blind to the spikes, and a plate is the only thing in the repo that
 * shows them.
 *
 * **Everything here uses only backdrop API that exists on `main` as well**, so
 * the same file produces the *before* plates from a `main` worktree:
 *
 * ```sh
 * git worktree add /tmp/a045-main main
 * ln -s "$PWD/node_modules" /tmp/a045-main/node_modules
 * mkdir -p /tmp/a045-main/evidence/a0-45-star-temperature-colour
 * cp evidence/a0-45-star-temperature-colour/shoot.ts /tmp/a045-main/evidence/a0-45-star-temperature-colour/
 * (cd /tmp/a045-main && npx vite-node evidence/a0-45-star-temperature-colour/shoot.ts before)
 * ```
 *
 * Two kinds of plate:
 *
 *  - `<sky>.png` — one 640×360 panel per sky, the whole stack in composite order.
 *  - `star-<n>.png` — **one bloomed star at 8×**, and this is the pair to look
 *    at. a0-44's detail plates could crop the same three stars out of both trees
 *    because a0-44 changed no random draw; a0-45 gives every star a temperature
 *    from the same seeded stream, so from the second star onward the two fields
 *    are different fields and no crop of a full panel is a like-for-like
 *    comparison. What *is* like-for-like is the **first** star of a seed: its x,
 *    y and magnitude are the first three draws, so they are identical on both
 *    trees and only its colour, its cross and its glow can differ. These plates
 *    are that star, at a box size that makes the field draw exactly one.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GROUND_COLOR,
  NEBULAE,
  NEBULA_IDS,
  STAR_LAYERS,
  VOID_SEED,
  nebulaSprite,
  starFieldSprite,
  type NebulaId,
} from '../../src/art/backdrop';
import type { Shape } from '../../src/art/shapes';
import { ground, paint, write } from '../a0-40-backdrop-matches-mockup/plate';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), process.argv[2] ?? '.');
const PANEL = { w: 640, h: 360 };

/** Every star shape one panel of the field carries, all three layers. */
function starShapes(w: number, h: number): Shape[] {
  return STAR_LAYERS.flatMap((l) => [...starFieldSprite(l, VOID_SEED, w, h).shapes]);
}

function panel(id: NebulaId): void {
  const spec = NEBULAE[id];
  const buf = ground(PANEL.w, PANEL.h, GROUND_COLOR);
  const sky = nebulaSprite(id, VOID_SEED, PANEL.w, PANEL.h, 1, PANEL.w, PANEL.h).shapes;
  const stars = starShapes(PANEL.w, PANEL.h);
  // Light behind the stars; dust in front of them. That ordering IS Coalsack.
  if (spec.occludes) {
    for (const s of stars) paint(buf, s, false);
    for (const s of sky) paint(buf, s, false);
  } else {
    for (const s of sky) paint(buf, s, spec.additive);
    for (const s of stars) paint(buf, s, false);
  }
  write(buf, OUT, `${id}.png`);
  // eslint-disable-next-line no-console
  console.log(`${spec.name.padEnd(13)} ${sky.length} sky shapes + ${stars.length} star shapes -> ${id}.png`);
}

// ---------------------------------------------------------------------------
// The lens — one bloomed star, the SAME star on both trees
// ---------------------------------------------------------------------------

const ZOOM = 8;
const LENS = { w: 480, h: 480 };
/**
 * A box small enough that the near layer rounds to **exactly one** star:
 * `round(90 × 50 / 1e6 × 218.7) = 1`. It has to be exactly one, not merely few —
 * a star's x, y and magnitude are the first three draws of the stream, so the
 * FIRST star of a seed is identical on both trees and every star after it is not.
 */
const ONE_STAR = { w: 90, h: 50 };

function scaled(s: Shape, cx: number, cy: number): Shape {
  const move = (x: number, y: number): [number, number] => [(x - cx) * ZOOM, (y - cy) * ZOOM];
  const path =
    s.path.kind === 'circle'
      ? { ...s.path, ...zip(move(s.path.cx, s.path.cy)), r: s.path.r * ZOOM }
      : {
          ...s.path,
          points: s.path.points.map((v, i) => (i % 2 === 0 ? (v - cx) * ZOOM : (v - cy) * ZOOM)),
        };
  const fill = s.fill?.falloff
    ? {
        ...s.fill,
        falloff: {
          ...s.fill.falloff,
          ...(([x, y]) => ({ cx: x, cy: y }))(move(s.fill.falloff.cx, s.fill.falloff.cy)),
          rx: s.fill.falloff.rx * ZOOM,
          ry: s.fill.falloff.ry * ZOOM,
        },
      }
    : s.fill;
  const stroke = s.stroke ? { ...s.stroke, width: s.stroke.width * ZOOM } : undefined;
  return { ...s, path, ...(fill ? { fill } : {}), ...(stroke ? { stroke } : {}) } as Shape;
}

function zip([x, y]: [number, number]): { cx: number; cy: number } {
  return { cx: x, cy: y };
}

/**
 * Walk seeds until the one star in the box blooms, and plate it. The search is on
 * the *output* — "does this sprite contain a halo" — rather than on any constant,
 * so it finds the same seeds on both trees.
 */
function lenses(n: number): void {
  const layer = STAR_LAYERS.find((l) => l.key === 'near')!;
  let found = 0;
  for (let i = 0; found < n && i < 400; i++) {
    const seed = (VOID_SEED + i * 0x9e37_79b9) >>> 0;
    const shapes = [...starFieldSprite(layer, seed, ONE_STAR.w, ONE_STAR.h).shapes];
    const points = shapes.filter((s) => s.path.kind === "circle" && s.fill && !s.fill.falloff);
    if (points.length !== 1) throw new Error(`the lens box drew ${points.length} stars, not 1`);
    const halo = shapes.find((s) => s.path.kind === 'circle' && s.fill?.falloff);
    if (!halo || halo.path.kind !== 'circle') continue;
    found++;
    const buf = ground(LENS.w, LENS.h, GROUND_COLOR);
    for (const s of shapes) paint(buf, scaled(s, halo.path.cx, halo.path.cy), false);
    write(buf, OUT, `star-${found}.png`);
    const cross = shapes.find((s) => s.stroke);
    const point = shapes.find((s) => s.path.kind === 'circle' && s.fill && !s.fill.falloff);
    // eslint-disable-next-line no-console
    console.log(
      `star-${found}: seed 0x${seed.toString(16)} halo r ${halo.path.r} α ${halo.fill!.alpha}` +
        ` · cross α ${cross?.stroke?.alpha} w ${cross?.stroke?.width}` +
        ` · point #${(point?.fill?.color ?? 0).toString(16).padStart(6, '0')} α ${point?.fill?.alpha}`,
    );
  }
}

for (const id of NEBULA_IDS) panel(id);
lenses(3);
