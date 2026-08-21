/**
 * evidence/a0-127-three-changes-with-eyes/mark.mjs — the COUNT SHEET. OWNER: QA
 * Manager (a0-127).
 *
 * The specimens in `shots/` are never drawn on. This writes a separate, clearly
 * named `*-marked-*.png`: the same sky tile with a thin hollow ring around every
 * position `candidates.mjs` proposed, so that "how many stars bloom, and how many
 * of those wear a cross" can be counted against a reference a reader can check
 * mark by mark, rather than trusting a number nobody can re-derive.
 *
 * A ring is a QUESTION, not an answer: it says "a local maximum stands here",
 * and every verdict in the manifest comes from looking at what is inside it. The
 * ring is 1px, hollow, and magenta — a hue the void does not contain — so it can
 * never be mistaken for something the game drew.
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHOTS, shotPath } from './lib.mjs';

const NAME = process.argv[2];
const cands = JSON.parse(readFileSync(join(SHOTS, `${NAME}-candidates.json`), 'utf8')).stars;
const png = PNG.sync.read(readFileSync(shotPath(`${NAME}-sky`)));
const W = png.width;
const H = png.height;
const put = (x, y) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  png.data[i] = 255; png.data[i + 1] = 0; png.data[i + 2] = 255; png.data[i + 3] = 255;
};
for (const s of cands) {
  for (let a = 0; a < 180; a++) {
    const th = (2 * Math.PI * a) / 180;
    put(Math.round(s.x + Math.cos(th) * 30), Math.round(s.y + Math.sin(th) * 30));
  }
}
const cols = 2;
const rows = H > 800 ? 2 : 1;
const tw = Math.ceil(W / cols);
const th = Math.ceil(H / rows);
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    const x0 = c * tw;
    const y0 = r * th;
    const w = Math.min(tw, W - x0);
    const h = Math.min(th, H - y0);
    const t = new PNG({ width: w, height: h });
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const si = (W * (y0 + j) + (x0 + i)) * 4;
      const di = (w * j + i) * 4;
      t.data[di] = png.data[si]; t.data[di + 1] = png.data[si + 1]; t.data[di + 2] = png.data[si + 2]; t.data[di + 3] = 255;
    }
    writeFileSync(join(SHOTS, `${NAME}-marked-r${r + 1}c${c + 1}.png`), PNG.sync.write(t));
  }
}
console.log(`${NAME}: ${cands.length} rings, ${cols * rows} marked tiles`);
