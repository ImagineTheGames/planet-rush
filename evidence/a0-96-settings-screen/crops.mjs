/**
 * evidence/a0-96-settings-screen/crops.mjs — the magnifier. OWNER: QA Manager (a0-96).
 *
 * Two jobs, both in service of LOOKING rather than believing:
 *
 *  `crop`  cut a named rectangle out of a frame and scale it up with nearest
 *          neighbour (no smoothing — a resample that invents pixels is the last
 *          thing a piece of evidence needs). Used for the volume bars, where the
 *          whole finding is how many pips are lit, and for the corner where two
 *          buttons overlap.
 *
 *  `panel` find what CHANGED between a frame and its base and cut that out. The
 *          `?` panels land in six different places, and a hand-typed rectangle
 *          per row is six chances to crop the wrong thing; the difference against
 *          the same screen with no panel open IS the panel, wherever it went.
 *
 *   node crops.mjs crop <src> <out> <x> <y> <w> <h> [scale]
 *   node crops.mjs panel <base> <out> <frame...>      (stacks the crops)
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';

const [mode, ...rest] = process.argv.slice(2);

function read(p) {
  return PNG.sync.read(readFileSync(p));
}

if (mode === 'crop') {
  const [src, out, x0, y0, w, h, scale] = rest;
  const p = read(src);
  const s = Number(scale ?? 1);
  const o = new PNG({ width: Number(w) * s, height: Number(h) * s });
  for (let y = 0; y < o.height; y++) {
    for (let x = 0; x < o.width; x++) {
      const sx = Number(x0) + Math.floor(x / s);
      const sy = Number(y0) + Math.floor(y / s);
      const si = (sy * p.width + sx) * 4;
      const di = (y * o.width + x) * 4;
      for (let c = 0; c < 4; c++) o.data[di + c] = p.data[si + c];
    }
  }
  writeFileSync(out, PNG.sync.write(o));
  console.log(`${out} ${o.width}x${o.height}`);
} else if (mode === 'panel') {
  const [base, out, ...frames] = rest;
  const pb = read(base);
  const PAD = 12;
  const GAP = 10;
  // A threshold of 6/255 rather than 0: the frames either side of a `?` press are
  // the same screen, so the only sub-6 differences available are compositor
  // rounding, and a stray one would blow the crop box out to the whole frame.
  const crops = frames.map((f) => {
    const p = read(f);
    let minx = 1e9, miny = 1e9, maxx = -1, maxy = -1;
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        const i = (y * p.width + x) * 4;
        let d = 0;
        for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(p.data[i + c] - pb.data[i + c]));
        if (d > 6) {
          minx = Math.min(minx, x); maxx = Math.max(maxx, x);
          miny = Math.min(miny, y); maxy = Math.max(maxy, y);
        }
      }
    }
    const x0 = Math.max(0, minx - PAD), y0 = Math.max(0, miny - PAD);
    const x1 = Math.min(p.width - 1, maxx + PAD), y1 = Math.min(p.height - 1, maxy + PAD);
    console.log(`${f.split('/').pop()} -> ${x0},${y0} ${x1 - x0 + 1}x${y1 - y0 + 1}`);
    return { p, x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  });
  const W = Math.max(...crops.map((c) => c.w));
  const H = crops.reduce((s, c) => s + c.h + GAP, GAP);
  const o = new PNG({ width: W, height: H });
  o.data.fill(0);
  let oy = GAP;
  for (const c of crops) {
    for (let y = 0; y < c.h; y++) {
      for (let x = 0; x < c.w; x++) {
        const si = ((c.y0 + y) * c.p.width + (c.x0 + x)) * 4;
        const di = ((oy + y) * W + x) * 4;
        for (let ch = 0; ch < 4; ch++) o.data[di + ch] = c.p.data[si + ch];
      }
    }
    oy += c.h + GAP;
  }
  writeFileSync(out, PNG.sync.write(o));
  console.log(`${out} ${W}x${H}`);
} else {
  console.error('usage: crops.mjs crop|panel …');
  process.exit(2);
}
