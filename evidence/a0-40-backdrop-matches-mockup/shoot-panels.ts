/**
 * evidence/a0-40-backdrop-matches-mockup/shoot-panels.ts — the before/after
 * plates. OWNER: Art Agent.
 *
 * One full backdrop panel per sky, 640×360 (the design preview's own panel), as
 * a PNG a human can look at:
 *
 * ```sh
 * npx vite-node evidence/a0-40-backdrop-matches-mockup/shoot-panels.ts after
 * ```
 *
 * **It deliberately uses only the backdrop API that exists on `main` as well** —
 * `groundSprite`, `nebulaSprite`, `starFieldSprite`, `STAR_LAYERS`,
 * `NEBULA_IDS`, `GROUND_COLOR` — so this file and `./plate.ts` drop into a `main`
 * worktree unchanged and produce the *before* plates. That is what makes the
 * pair comparable rather than two different renderers arguing:
 *
 * ```sh
 * git worktree add /tmp/pr-main main
 * ln -s "$PWD/node_modules" /tmp/pr-main/node_modules
 * cp evidence/a0-40-backdrop-matches-mockup/{plate,shoot-panels}.ts \
 *    /tmp/pr-main/evidence/a0-40-backdrop-matches-mockup/
 * (cd /tmp/pr-main && npx vite-node evidence/a0-40-backdrop-matches-mockup/shoot-panels.ts before)
 * ```
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
import { ground, paint, write } from './plate';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), process.argv[2] ?? '.');
const PANEL = { w: 640, h: 360 };

function panel(id: NebulaId): void {
  const spec = NEBULAE[id];
  const buf = ground(PANEL.w, PANEL.h, GROUND_COLOR);
  const sky = nebulaSprite(id, VOID_SEED, PANEL.w, PANEL.h, 1, PANEL.w, PANEL.h).shapes;
  const stars = STAR_LAYERS.flatMap((l) => [...starFieldSprite(l, VOID_SEED, PANEL.w, PANEL.h).shapes]);
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

// eslint-disable-next-line no-console
console.log(`ground #${GROUND_COLOR.toString(16).padStart(6, '0')} -> ${OUT}`);
for (const id of NEBULA_IDS) panel(id);
