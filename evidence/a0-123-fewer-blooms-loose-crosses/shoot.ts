/**
 * evidence/a0-123-fewer-blooms-loose-crosses/shoot.ts — the menu backdrop, as a
 * plate. OWNER: Art Agent.
 *
 * ```sh
 * npx vite-node evidence/a0-123-fewer-blooms-loose-crosses/shoot.ts after
 * ```
 *
 * The developer reported this off the **menu** backdrop, so the plate is the
 * menu backdrop and not a review panel: {@link ../../src/ui/menu-backdrop}
 * drives `VoidBackdrop` with `bounds = viewport`, camera offset `(0, 0)`, and
 * the `patinaDrift` sky, so that is what is reproduced here — layer for layer,
 * `coverSpan` for `coverSpan`, in `configure`'s own composite order.
 *
 * There is no browser on the plain-node side of this container, so the pixels go
 * through a0-40's `plate.ts` — a plain-TS rasterizer over `inkAlphaAt`, the one
 * definition of "how bright is this ink here" that `backdrop.test.ts` and
 * `sky-preview.ts` also use. A plate cannot flatter the build.
 *
 * Everything here uses only backdrop API that exists on `main` as well, so the
 * same file produces the *before* plate from a `main` worktree (see README).
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GROUND_COLOR,
  MAP_NEBULA,
  NEBULAE,
  STAR_LAYERS,
  VOID_SEED,
  coverSpan,
  nebulaSprite,
  starFieldSprite,
} from '../../src/art/backdrop';
import { MOCKUP_STARS } from '../../src/art/mockup-reference';
import type { Shape } from '../../src/art/shapes';
import { ground, paint, write } from '../a0-40-backdrop-matches-mockup/plate';

/**
 * **The by-eye sweep's two knobs**, as env overrides.
 *
 * They exist so the candidate plates are the same code path as the shipped one —
 * a sweep that re-implemented the field would be choosing a threshold against a
 * picture the game does not draw. Unset, this file renders whatever the tree it
 * runs in draws, which is exactly what makes it produce the *before* plate
 * unchanged from a `main` worktree (where `spike.chance` does not exist and the
 * second override is a no-op on an absent field).
 */
const override = (key: string): number | null =>
  process.env[key] === undefined ? null : Number(process.env[key]);
const T = override('A0123_THRESHOLD');
if (T !== null) (MOCKUP_STARS.bloom as { threshold: number }).threshold = T;
const C = override('A0123_CROSS_CHANCE');
if (C !== null) (MOCKUP_STARS.spike as unknown as { chance: number }).chance = C;

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), process.argv[2] ?? '.');

/** The developer's desktop — the viewport `backdrop-bloom.test.ts` measures at. */
const VIEW = { w: 1440, h: 900 } as const;
/** The menus' sky, looked up the way `menu-backdrop.ts` looks it up. */
const MENU_SKY = 'patinaDrift';
const MENU_MAP = (Object.keys(MAP_NEBULA) as (keyof typeof MAP_NEBULA)[]).find(
  (m) => MAP_NEBULA[m] === MENU_SKY,
)!;

/** Move a shape into buffer space. The falloff carries its own centre, so it
 *  moves with the path or the glow detaches from the disc it belongs to. */
function translate(s: Shape, dx: number, dy: number): Shape {
  const path =
    s.path.kind === 'circle'
      ? { ...s.path, cx: s.path.cx + dx, cy: s.path.cy + dy }
      : { ...s.path, points: s.path.points.map((v, i) => v + (i % 2 === 0 ? dx : dy)) };
  const move = <T extends { falloff?: { cx: number; cy: number } | undefined }>(ink: T | undefined) =>
    ink === undefined
      ? undefined
      : ink.falloff === undefined
        ? ink
        : { ...ink, falloff: { ...ink.falloff, cx: ink.falloff.cx + dx, cy: ink.falloff.cy + dy } };
  return { ...s, path, fill: move(s.fill), stroke: move(s.stroke) } as Shape;
}

/** One menu backdrop, composited exactly as `VoidBackdrop.configure` does. */
function menuPanel(name: string): void {
  const { w, h } = VIEW;
  const spec = NEBULAE[MAP_NEBULA[MENU_MAP]];
  const cx = w / 2;
  const cy = h / 2;
  const buf = ground(w, h, GROUND_COLOR);

  const nw = coverSpan(spec.parallax, w, w);
  const nh = coverSpan(spec.parallax, h, h);
  const sky = nebulaSprite(spec.id, VOID_SEED, nw, nh, 1, w, h).shapes.map((s) => translate(s, cx, cy));
  const stars: Shape[] = [];
  for (const layer of STAR_LAYERS) {
    const lw = coverSpan(layer.parallax, w, w);
    const lh = coverSpan(layer.parallax, h, h);
    for (const s of starFieldSprite(layer, VOID_SEED, lw, lh).shapes) stars.push(translate(s, cx, cy));
  }

  // Light behind the stars; dust in front of them. `configure`'s own ordering.
  if (spec.occludes) {
    for (const s of stars) paint(buf, s, false);
    for (const s of sky) paint(buf, s, false);
  } else {
    for (const s of sky) paint(buf, s, spec.additive);
    for (const s of stars) paint(buf, s, false);
  }
  write(buf, OUT, `${name}.png`);
  // eslint-disable-next-line no-console
  console.log(`${name}.png — ${w}x${h}, sky ${spec.id} (${sky.length} shapes) + ${stars.length} star shapes`);
}

menuPanel(process.env.A0123_NAME ?? `menu-${VIEW.w}x${VIEW.h}`);
