/**
 * evidence/a0-22-bloom-colour/plate-goldens.mjs — every re-baselined golden, at
 * the only magnification an eye can judge one at. OWNER: Art Agent.
 *
 * A bloom tint moves 187 of 1,024,000 pixels on the desktop frozen plate. Laid
 * side by side at 1:1 the two frames are indistinguishable, which is the a0-18
 * lesson about goldens restated — so this cuts the **bounding box of everything
 * that moved** out of both plates, at 6× nearest neighbour, and puts the
 * unamplified difference beside it. What is in these crops is what the GPU
 * painted; the difference column is the only amplified thing on the plate and it
 * says by how much on its own label.
 *
 *   node evidence/a0-22-bloom-colour/plate-goldens.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const DIR = 'tests/mobile/goldens.spec.ts-snapshots';
const PLATES = join(HERE, 'plates');
const AMP = 10;

/**
 * The ref the plate's "before" column comes from, and the ref the changed-file
 * list is taken against. Defaults to `HEAD` — the working-tree-vs-last-commit
 * shape this was written for.
 *
 * It is overridable because r12-01 plates a **merge**, where `HEAD` is the wrong
 * before: the branch tip predates `u14-01`'s self-hosted typefaces, so a plate
 * cut against it would show the tint *and* every glyph in the frame changing,
 * and the eye could not separate them. `origin/main` is the honest before for a
 * merge — same fonts, same arc chord, everything but this branch's tint.
 *
 *   node evidence/a0-22-bloom-colour/plate-goldens.mjs origin/main
 */
const BASE = process.argv[2] ?? 'HEAD';
// Resolved and printed ON the plate, because "MAIN" is not a claim anyone can
// check and a short sha is. It used to be typed into the label by hand.
const BASE_SHA = execFileSync('git', ['rev-parse', '--short', BASE], { cwd: ROOT, encoding: 'utf8' })
  .trim()
  .toUpperCase();

const changed = execFileSync('git', ['diff', '--name-only', BASE, '--', DIR], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// The same 5×7 font as the other plates, kept local so each script stands alone.
const G = {
  A: '01110,10001,10001,11111,10001,10001,10001', B: '11110,10001,11110,10001,10001,10001,11110',
  C: '01111,10000,10000,10000,10000,10000,01111', D: '11110,10001,10001,10001,10001,10001,11110',
  E: '11111,10000,11110,10000,10000,10000,11111', F: '11111,10000,11110,10000,10000,10000,10000',
  G: '01111,10000,10000,10111,10001,10001,01110', H: '10001,10001,11111,10001,10001,10001,10001',
  I: '11111,00100,00100,00100,00100,00100,11111', J: '00111,00010,00010,00010,00010,10010,01100',
  K: '10001,10010,11100,10100,10010,10001,10001', L: '10000,10000,10000,10000,10000,10000,11111',
  M: '10001,11011,10101,10001,10001,10001,10001', N: '10001,11001,10101,10011,10001,10001,10001',
  O: '01110,10001,10001,10001,10001,10001,01110', P: '11110,10001,11110,10000,10000,10000,10000',
  Q: '01110,10001,10001,10001,10101,10010,01101', R: '11110,10001,11110,10100,10010,10001,10001',
  S: '01111,10000,01110,00001,00001,10001,01110', T: '11111,00100,00100,00100,00100,00100,00100',
  U: '10001,10001,10001,10001,10001,10001,01110', V: '10001,10001,10001,10001,10001,01010,00100',
  W: '10001,10001,10001,10101,10101,11011,10001', X: '10001,01010,00100,00100,00100,01010,10001',
  Y: '10001,01010,00100,00100,00100,00100,00100', Z: '11111,00010,00100,00100,01000,10000,11111',
  0: '01110,10001,10011,10101,11001,10001,01110', 1: '00100,01100,00100,00100,00100,00100,01110',
  2: '01110,10001,00001,00110,01000,10000,11111', 3: '11110,00001,00110,00001,00001,10001,01110',
  4: '00010,00110,01010,10010,11111,00010,00010', 5: '11111,10000,11110,00001,00001,10001,01110',
  6: '00110,01000,10000,11110,10001,10001,01110', 7: '11111,00001,00010,00100,01000,01000,01000',
  8: '01110,10001,01110,10001,10001,10001,01110', 9: '01110,10001,10001,01111,00001,00010,01100',
  ' ': '00000,00000,00000,00000,00000,00000,00000', '.': '00000,00000,00000,00000,00000,01100,01100',
  ',': '00000,00000,00000,00000,01100,01100,01000', '-': '00000,00000,00000,11111,00000,00000,00000',
  '/': '00001,00010,00010,00100,01000,01000,10000', '#': '01010,11111,01010,01010,11111,01010,00000',
  '%': '11001,11010,00010,00100,01011,10011,00000', ':': '00000,01100,01100,00000,01100,01100,00000',
  '(': '00010,00100,01000,01000,01000,00100,00010', ')': '01000,00100,00010,00010,00010,00100,01000',
  '+': '00000,00100,00100,11111,00100,00100,00000', '=': '00000,00000,11111,00000,11111,00000,00000',
  X_: '', '*': '00000,10101,01110,11111,01110,10101,00000', "'": '00100,00100,00000,00000,00000,00000,00000',
};

const rect = (dst, x, y, w, h, rgb) => {
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const px = x + i;
      const py = y + j;
      if (px < 0 || py < 0 || px >= dst.width || py >= dst.height) continue;
      const o = (py * dst.width + px) * 4;
      dst.data[o] = rgb[0];
      dst.data[o + 1] = rgb[1];
      dst.data[o + 2] = rgb[2];
      dst.data[o + 3] = 255;
    }
};
const text = (dst, s, x, y, rgb = [200, 208, 216], k = 2) => {
  let cx = x;
  for (const ch of String(s).toUpperCase()) {
    const g = (G[ch] ?? G[' ']).split(',');
    for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (g[r][c] === '1') rect(dst, cx + c * k, y + r * k, k, k, rgb);
    cx += 6 * k;
  }
};
const blank = (w, h, rgb = [6, 7, 10]) => {
  const p = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    p.data[i * 4] = rgb[0];
    p.data[i * 4 + 1] = rgb[1];
    p.data[i * 4 + 2] = rgb[2];
    p.data[i * 4 + 3] = 255;
  }
  return p;
};

mkdirSync(PLATES, { recursive: true });

for (const name of changed) {
  const base = name.replace(`${DIR}/`, '').replace('.png', '');
  const A = PNG.sync.read(execFileSync('git', ['show', `${BASE}:${name}`], { cwd: ROOT, maxBuffer: 1 << 28 }));
  const B = PNG.sync.read(readFileSync(join(ROOT, name)));
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  let moved = 0;
  for (let i = 0; i < A.width * A.height; i++) {
    const o = i * 4;
    if (A.data[o] === B.data[o] && A.data[o + 1] === B.data[o + 1] && A.data[o + 2] === B.data[o + 2]) continue;
    moved++;
    const x = i % A.width;
    const y = (i - x) / A.width;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  if (moved === 0) continue;
  // Square the box so the three columns line up, and pad it a little so each
  // changed star is seen in the field it belongs to rather than cropped to itself.
  const PADPX = 6;
  x0 = Math.max(0, x0 - PADPX);
  y0 = Math.max(0, y0 - PADPX);
  x1 = Math.min(A.width - 1, x1 + PADPX);
  y1 = Math.min(A.height - 1, y1 + PADPX);
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  // Scale so the widest box fits a readable plate.
  const K = Math.max(1, Math.min(8, Math.floor(1500 / bw)));
  const CW = bw * K;
  const CH = bh * K;
  const PAD = 16;
  const TOP = 116;
  const out = blank(Math.max(PAD * 2 + CW, 1180), TOP + 3 * (CH + 30) + PAD);
  text(out, `A0-22 GOLDEN RE-BASELINE - ${base}`, PAD, 14);
  text(out, `${moved} OF ${A.width * A.height} PIXELS MOVED. THE BOX THAT CONTAINS ALL OF THEM, AT ${K}X NEAREST NEIGHBOUR.`, PAD, 38, [140, 150, 162], 1);
  text(out, `BOX ${x0},${y0} ${bw}X${bh} OF THE ${A.width}X${A.height} FRAME`, PAD, 54, [140, 150, 162], 1);
  text(out, `ROW 1 MAIN   ROW 2 THIS BRANCH   ROW 3 THE DIFFERENCE AT ${AMP}X (THE ONLY AMPLIFIED THING HERE)`, PAD, 70, [140, 150, 162], 1);
  const rows = [
    [`MAIN ${BASE_SHA}`, (o) => [A.data[o], A.data[o + 1], A.data[o + 2]]],
    ['THIS BRANCH', (o) => [B.data[o], B.data[o + 1], B.data[o + 2]]],
    [`DIFFERENCE X${AMP}`, (o) => {
      const d = (i) => Math.min(255, Math.abs(B.data[o + i] - A.data[o + i]) * AMP);
      return [d(0), d(1), d(2)];
    }],
  ];
  rows.forEach(([label, pick], r) => {
    const oy = TOP + r * (CH + 30);
    for (let y = 0; y < CH; y++)
      for (let x = 0; x < CW; x++) {
        const sx = x0 + Math.floor(x / K);
        const sy = y0 + Math.floor(y / K);
        rect(out, PAD + x, oy + y, 1, 1, pick((sy * A.width + sx) * 4));
      }
    text(out, label, PAD, oy + CH + 8, [150, 200, 175], 1);
  });
  writeFileSync(join(PLATES, `golden-${base}.png`), PNG.sync.write(out));
  const dY = (() => {
    let s = 0;
    let n = 0;
    for (let i = 0; i < A.width * A.height; i++) {
      const o = i * 4;
      if (A.data[o] === B.data[o] && A.data[o + 1] === B.data[o + 1] && A.data[o + 2] === B.data[o + 2]) continue;
      s += luma(B.data[o], B.data[o + 1], B.data[o + 2]) - luma(A.data[o], A.data[o + 1], A.data[o + 2]);
      n++;
    }
    return s / n;
  })();
  console.log(`${base.padEnd(46)} ${String(moved).padStart(6)} px  meanΔY ${dY.toFixed(2)}  box ${bw}x${bh}`);
}
