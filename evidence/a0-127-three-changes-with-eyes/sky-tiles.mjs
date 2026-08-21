/**
 * evidence/a0-127-three-changes-with-eyes/sky-tiles.mjs — the sky window, cut into
 * NATIVE-SIZE tiles. OWNER: QA Manager (a0-127).
 *
 * The counting in this brief is done here, on these tiles: 1 image pixel = 1
 * device pixel of the profile, no scaling and no filtering, with the menu's own
 * ink painted out (`candidates.mjs`, `<name>-ink.json`) so nothing but sky is in
 * the frame being counted. Four tiles hold the desktop frame, two the phone's.
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHOTS, shotPath } from './lib.mjs';

for (const name of process.argv.slice(2)) {
  const png = PNG.sync.read(readFileSync(shotPath(`${name}-sky`)));
  const cols = 2;
  const rows = png.height > 800 ? 2 : 1;
  const tw = Math.ceil(png.width / cols);
  const th = Math.ceil(png.height / rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = c * tw;
      const y0 = r * th;
      const w = Math.min(tw, png.width - x0);
      const h = Math.min(th, png.height - y0);
      const t = new PNG({ width: w, height: h });
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const si = (png.width * (y0 + j) + (x0 + i)) * 4;
          const di = (w * j + i) * 4;
          t.data[di] = png.data[si];
          t.data[di + 1] = png.data[si + 1];
          t.data[di + 2] = png.data[si + 2];
          t.data[di + 3] = 255;
        }
      }
      writeFileSync(join(SHOTS, `${name}-sky-r${r + 1}c${c + 1}.png`), PNG.sync.write(t));
    }
  }
  console.log(`${name}-sky: ${cols * rows} tiles of ${tw}×${th}`);
}
