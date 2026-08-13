/**
 * evidence/a0-40-backdrop-matches-mockup/shoot-tiles.ts — the golden's own
 * tiles, as pixels. OWNER: Art Agent.
 *
 * ```sh
 * npx vite-node evidence/a0-40-backdrop-matches-mockup/shoot-tiles.ts tiles
 * ```
 *
 * `assets/preview/sprite-sheet.svg` is the committed art golden, and a0-40
 * re-bakes it. Nine of its 178 tiles change — the three star layers and the six
 * skies — and the studio rule is that every re-baselined image gets looked at.
 * There is no SVG rasterizer in this container, so this renders **the same
 * `SpriteDef`s the contact sheet draws**, at the same size, straight to PNG.
 *
 * It is the tiles, not a re-imagining of them: `starFieldSprite` and
 * `nebulaTileSprite` at `catalogue.ts`'s own `VOID_TILE`, in the catalogue's own
 * order.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GROUND_COLOR,
  NEBULAE,
  NEBULA_IDS,
  STAR_LAYERS,
  VOID_SEED,
  nebulaTileSprite,
  starFieldSprite,
} from '../../src/art/backdrop';
import { ground, paint, write } from './plate';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), process.argv[2] ?? 'tiles');
/** `catalogue.ts`'s own `VOID_TILE`. */
const TILE = { w: 480, h: 300 };

for (const layer of STAR_LAYERS) {
  const def = starFieldSprite(layer, VOID_SEED, TILE.w, TILE.h);
  // The catalogue renders a sprite on Vacuum; the star layers carry no ground of
  // their own, so the tile is drawn on the same ground the sheet uses.
  const buf = ground(TILE.w, TILE.h, GROUND_COLOR);
  for (const s of def.shapes) paint(buf, s, false);
  write(buf, OUT, `stars-${layer.key}.png`);
  // eslint-disable-next-line no-console
  console.log(`stars/${layer.key.padEnd(5)} ${def.shapes.length} shapes -> stars-${layer.key}.png`);
}

for (const id of NEBULA_IDS) {
  // The sky tile is the WHOLE stack and carries its own ground quad, so the
  // buffer starts at zero and the sprite paints everything including the floor.
  const def = nebulaTileSprite(id, VOID_SEED, TILE.w, TILE.h);
  const buf = ground(TILE.w, TILE.h, 0x000000);
  for (const s of def.shapes) paint(buf, s, NEBULAE[id].additive && s.role === 'sky');
  write(buf, OUT, `tile-${id}.png`);
  // eslint-disable-next-line no-console
  console.log(`tile/${id.padEnd(12)} ${def.shapes.length} shapes -> tile-${id}.png`);
}
