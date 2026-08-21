/**
 * evidence/a0-127-three-changes-with-eyes/halo-compare.mjs — is the halo the same
 * SIZE as it was before a0-123? OWNER: QA Manager (a0-127).
 *
 * a0-123 was explicitly not allowed to touch the bloom's radius, and the developer
 * has twice reported the stars drifting from the mockups, so this is the check on
 * that. The two builds draw the SAME field — one seed, `VOID_SEED`, and a0-123's
 * own audit measured 9,333 stars byte-identical — so a star that blooms in both
 * frames is the same star in the same place, and the same rectangle of the two
 * frames is a fair comparison rather than a rhetorical one.
 *
 * For each named star it writes a side-by-side 6× nearest-neighbour crop (before
 * left, after right) and the RADIAL LUMINANCE PROFILE of both: the mean luminance
 * of the ring at each radius, out to 70 device px. A halo that had been made
 * smaller would fall to the sky at a smaller radius on the right-hand curve. The
 * crop is the verdict; the profile is the cross-check.
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CROPS, crop, note, shotPath } from './lib.mjs';

const SPOTS = process.argv.slice(2).map((s) => s.split(',').map(Number));
const BEFORE = shotPath('before-menu-desktop-1280x800-sky');
const AFTER = shotPath('after-menu-desktop-1280x800-sky');
const R = 70;
const SCALE = 6;

function profile(file, cx, cy) {
  const png = PNG.sync.read(readFileSync(file));
  const L = (x, y) => {
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) return NaN;
    const i = (y * png.width + x) * 4;
    return 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
  };
  const out = [];
  for (let r = 0; r <= R; r++) {
    let s = 0;
    let n = 0;
    // The DIAGONALS only, at 8 angles between the arms: a diffraction cross would
    // otherwise put its arms into the profile and read as halo. 22.5° off-axis.
    for (const th of [0.3927, 1.178, 1.9635, 2.7489, 3.5343, 4.3197, 5.1051, 5.8905]) {
      const v = L(Math.round(cx + Math.cos(th) * r), Math.round(cy + Math.sin(th) * r));
      if (!Number.isNaN(v)) { s += v; n++; }
    }
    out.push(n ? +(s / n).toFixed(2) : null);
  }
  return out;
}

mkdirSync(CROPS, { recursive: true });
const readback = [];
for (const [x, y] of SPOTS) {
  const b = crop(BEFORE, { x: x - R, y: y - R, w: 2 * R, h: 2 * R, scale: SCALE });
  const a = crop(AFTER, { x: x - R, y: y - R, w: 2 * R, h: 2 * R, scale: SCALE });
  const w = 2 * R * SCALE;
  const pair = new PNG({ width: w * 2 + 12, height: w });
  pair.data.fill(0);
  const blit = (src, ox) => {
    for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) {
      const si = (j * w + i) * 4;
      const di = (j * pair.width + ox + i) * 4;
      pair.data[di] = src.data[si]; pair.data[di + 1] = src.data[si + 1]; pair.data[di + 2] = src.data[si + 2]; pair.data[di + 3] = 255;
    }
  };
  blit(b, 0);
  blit(a, w + 12);
  writeFileSync(join(CROPS, `halo-${x}x${y}-before-after.png`), PNG.sync.write(pair));
  const pb = profile(BEFORE, x, y);
  const pa = profile(AFTER, x, y);
  // Where each profile falls to within 1 luma of its own far sky (r 60..70).
  const skyOf = (p) => p.slice(60).reduce((s, v) => s + v, 0) / p.slice(60).length;
  const edge = (p) => {
    const sky = skyOf(p);
    for (let r = 5; r <= R; r++) if (p[r] <= sky + 1) return r;
    return null;
  };
  readback.push({ star: { x, y }, before: { profile: pb, sky: +skyOf(pb).toFixed(2), haloEdge: edge(pb) }, after: { profile: pa, sky: +skyOf(pa).toFixed(2), haloEdge: edge(pa) } });
  console.log(`star ${x},${y}: halo edge before r=${edge(pb)}px, after r=${edge(pa)}px (device px, dpr2)`);
  console.log(`  before r0..24: ${pb.slice(0, 25).join(' ')}`);
  console.log(`  after  r0..24: ${pa.slice(0, 25).join(' ')}`);
}
note('halo-compare', readback);
