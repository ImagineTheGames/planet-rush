/**
 * evidence/a0-99-wheel-and-hud/crops.mjs — the magnifier. OWNER: QA Manager (a0-99).
 *
 * a0-96's crop tool, kept, plus the one thing this brief needed that that one
 * did not: a way to put the SAME rectangle from several frames side by side.
 * Half of a0-99's questions are "did this change between two states" — the cost
 * numeral at 0 / 2 / 3 / 6 ore, the top-left corner with the wheel shut and with
 * it open — and a strip is the honest way to look at that: one image, same crop,
 * states in a stated order, so the eye compares instead of remembering.
 *
 * Nearest-neighbour scaling only. A resample that invents pixels is the last
 * thing a piece of evidence needs.
 *
 *   node crops.mjs crop <out> <scale> <src> <x> <y> <w> <h>
 *   node crops.mjs row  <out> <scale> <x> <y> <w> <h> <src...>   (left→right)
 *   node crops.mjs col  <out> <scale> <x> <y> <w> <h> <src...>   (top→bottom)
 *
 * All rectangles are in DEVICE px (the frames are dpr 2, so device = 2 x logical).
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';

const [mode, out, scaleArg, ...rest] = process.argv.slice(2);
const S = Number(scaleArg);

/** One crop, scaled, as a PNG. */
function cut(src, x0, y0, w, h) {
  const p = PNG.sync.read(readFileSync(src));
  const o = new PNG({ width: w * S, height: h * S });
  for (let y = 0; y < o.height; y++) {
    for (let x = 0; x < o.width; x++) {
      const sx = x0 + Math.floor(x / S);
      const sy = y0 + Math.floor(y / S);
      const di = (y * o.width + x) * 4;
      if (sx < 0 || sy < 0 || sx >= p.width || sy >= p.height) {
        o.data[di] = o.data[di + 1] = o.data[di + 2] = 0;
        o.data[di + 3] = 255;
        continue;
      }
      const si = (sy * p.width + sx) * 4;
      for (let c = 0; c < 4; c++) o.data[di + c] = p.data[si + c];
    }
  }
  return o;
}

/** A 2px rule between tiles, so the seam between two states is never mistaken
 *  for something the game drew. */
const GAP = 6;

if (mode === 'crop') {
  const [src, x, y, w, h] = rest;
  writeFileSync(out, PNG.sync.write(cut(src, +x, +y, +w, +h)));
} else if (mode === 'row' || mode === 'col') {
  const [x, y, w, h, ...srcs] = rest;
  const tiles = srcs.map((s) => cut(s, +x, +y, +w, +h));
  const tw = tiles[0].width;
  const th = tiles[0].height;
  const sheet =
    mode === 'row'
      ? new PNG({ width: tw * tiles.length + GAP * (tiles.length - 1), height: th })
      : new PNG({ width: tw, height: th * tiles.length + GAP * (tiles.length - 1) });
  sheet.data.fill(255);
  tiles.forEach((t, i) => {
    const ox = mode === 'row' ? i * (tw + GAP) : 0;
    const oy = mode === 'col' ? i * (th + GAP) : 0;
    PNG.bitblt(t, sheet, 0, 0, tw, th, ox, oy);
  });
  writeFileSync(out, PNG.sync.write(sheet));
} else {
  console.error('usage: crops.mjs crop|row|col <out> <scale> ...');
  process.exit(2);
}
