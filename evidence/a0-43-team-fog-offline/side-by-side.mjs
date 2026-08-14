/**
 * evidence/a0-43-team-fog-offline/side-by-side.mjs — glue the pair into one image.
 *
 * The brief asks for the two minimaps "side by side": the human's map in an
 * OFFLINE TEAMS match booted through the real lobby, and the identical setup in
 * free-for-all. A reviewer should not have to open two tabs and flick between
 * them to see that one is a quarter of an arena and the other is a single disc.
 *
 * It crops both frames to the minimap overlay's own rect (360,100 560×560 on the
 * desktop control profile — `src/ui/minimap.ts` `expandedRect`, the same number
 * the spec derives) and lays them left/right with a gutter.
 *
 * The two inputs are written by the spec itself, so this composes evidence and
 * never produces it:
 *
 *   A0_43_CAPTURE=1 npx playwright test tests/mobile/team-fog-offline.spec.ts --project=desktop
 *   node evidence/a0-43-team-fog-offline/side-by-side.mjs
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = new URL('.', import.meta.url).pathname;
/** The expanded minimap's rect on the 1280×800 desktop control profile. */
const CROP = { x: 360, y: 100, w: 560, h: 560 };
const GUTTER = 24;

const load = (name) => PNG.sync.read(readFileSync(join(DIR, name)));

const teams = load('lobby-teams-minimap.png');
const ffa = load('lobby-ffa-minimap.png');

const out = new PNG({ width: CROP.w * 2 + GUTTER, height: CROP.h });
// The gutter reads as the page behind the overlay rather than as a white bar.
for (let i = 0; i < out.data.length; i += 4) {
  out.data[i] = 7;
  out.data[i + 1] = 9;
  out.data[i + 2] = 16;
  out.data[i + 3] = 255;
}

const blit = (src, dx) => {
  for (let y = 0; y < CROP.h; y++) {
    for (let x = 0; x < CROP.w; x++) {
      const s = (src.width * (CROP.y + y) + (CROP.x + x)) << 2;
      const d = (out.width * y + (dx + x)) << 2;
      out.data[d] = src.data[s];
      out.data[d + 1] = src.data[s + 1];
      out.data[d + 2] = src.data[s + 2];
      out.data[d + 3] = 255;
    }
  }
};

blit(teams, 0);
blit(ffa, CROP.w + GUTTER);

writeFileSync(join(DIR, 'lobby-teams-vs-ffa.png'), PNG.sync.write(out));
console.log('wrote lobby-teams-vs-ffa.png — TEAMS left, FFA right');
