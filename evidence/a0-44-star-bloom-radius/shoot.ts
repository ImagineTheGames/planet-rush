/**
 * evidence/a0-44-star-bloom-radius/shoot.ts — the before/after plates.
 * OWNER: Art Agent.
 *
 * ```sh
 * npx vite-node evidence/a0-44-star-bloom-radius/shoot.ts after
 * ```
 *
 * There is still no browser and no SVG rasterizer on the plain-node side of this
 * container, so the plates go through a0-40's `plate.ts` — a plain-TS PNG
 * rasterizer over `inkAlphaAt`, the one definition of "how bright is this ink
 * here" that `backdrop.test.ts` and `sky-preview.ts` also use. A plate cannot
 * flatter the build: if a number is wrong the plate is wrong the same way. (It
 * is imported rather than copied so there is one rasterizer, not two.)
 *
 * **Everything here uses only backdrop API that exists on `main` as well**, so
 * the same file produces the *before* plates from a `main` worktree:
 *
 * ```sh
 * git worktree add /tmp/a044-main main
 * ln -s "$PWD/node_modules" /tmp/a044-main/node_modules
 * mkdir -p /tmp/a044-main/evidence/a0-44-star-bloom-radius
 * cp evidence/a0-44-star-bloom-radius/shoot.ts /tmp/a044-main/evidence/a0-44-star-bloom-radius/
 * (cd /tmp/a044-main && npx vite-node evidence/a0-44-star-bloom-radius/shoot.ts before)
 * ```
 *
 * Two kinds of plate, because the defect is small on a full panel and obvious
 * under a lens:
 *
 *  - `<sky>.png` — one 640×360 panel per sky, the whole stack in composite order.
 *  - `detail-<n>.png` — **5× enlargements around single bloomed stars**, which is
 *    where "the cross is outside the glow" is a thing you can see rather than a
 *    number you have to trust.
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

/**
 * **One bloomed star, enlarged.** Every shape is translated so the star sits at
 * the centre of a small box and scaled by `ZOOM`, then painted by the same
 * rasterizer — so this is a magnification of the art, not a re-drawing of it.
 */
const ZOOM = 5;
const DETAIL = { w: 320, h: 320 };

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

function details(): void {
  const stars = starShapes(PANEL.w, PANEL.h);
  // A bloomed star is a halo (the one circle with a falloff) followed by its two
  // arms and its point. Take the brightest few by halo radius.
  const halos = stars
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.path.kind === 'circle' && s.fill?.falloff)
    .sort((a, b) => (b.s.path.kind === 'circle' ? b.s.path.r : 0) - (a.s.path.kind === 'circle' ? a.s.path.r : 0))
    .slice(0, 3);

  halos.forEach(({ s, i }, n) => {
    if (s.path.kind !== 'circle') return;
    const cx = s.path.cx;
    const cy = s.path.cy;
    const buf = ground(DETAIL.w, DETAIL.h, GROUND_COLOR);
    // The star's own four shapes, in draw order, plus anything else that lands
    // in the box — a plate should not quietly tidy the neighbourhood.
    for (const shape of stars.slice(Math.max(0, i - 8), i + 8)) paint(buf, scaled(shape, cx, cy), false);
    write(buf, OUT, `detail-${n + 1}.png`);
    // eslint-disable-next-line no-console
    console.log(`detail-${n + 1}: halo r ${s.path.r} at (${cx}, ${cy}), ${ZOOM}x -> detail-${n + 1}.png`);
  });
}

for (const id of NEBULA_IDS) panel(id);
details();
