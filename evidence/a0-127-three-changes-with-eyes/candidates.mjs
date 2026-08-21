/**
 * evidence/a0-127-three-changes-with-eyes/candidates.mjs — a CHECKLIST for the
 * eye, not a verdict. OWNER: QA Manager (a0-127).
 *
 * The brief asks for two numbers off a frame: how many stars bloom, and how many
 * of those wear a cross. Counting them is done by LOOKING at the native-size
 * tiles; what this does is make sure nothing is missed while looking. It finds
 * every local luminance maximum in the frame that stands clear of its own local
 * background, and cuts a magnified contact sheet of them, so each candidate can be
 * judged — halo? cross? — instead of hunted for.
 *
 * It deliberately over-collects: the threshold is low enough to bring in plain
 * (unbloomed) stars, because a checklist that only lists blooms would be deciding
 * the question it exists to help answer. The classification numbers it prints are
 * a CROSS-CHECK on the counted numbers, exactly as a readback is a cross-check on
 * a frame — where they disagree, the frame wins and the disagreement is the story.
 *
 *   node evidence/a0-127-three-changes-with-eyes/candidates.mjs after-menu-desktop-1280x800
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHOTS, shotPath, note } from './lib.mjs';

const NAME = process.argv[2] ?? 'after-menu-desktop-1280x800';
const png = PNG.sync.read(readFileSync(shotPath(NAME)));

/**
 * The SKY WINDOW. A menu is not only sky: the wordmark, the eyebrow, the two
 * rules, the four plates and the build stamp are ink, and a local maximum in the
 * letter P is not a star. So the frame is masked to the sky before anything is
 * counted — `<name>-ink.json`, written by shoot-menu.mjs, identical on both
 * builds — and `<name>-sky.png` is that masked frame, committed, so the number
 * below and the picture a reader counts on are the same pixels. Nothing is
 * counted in a region that is painted out.
 */
const ink = JSON.parse(readFileSync(shotPath(NAME).replace(/\.png$/, '-ink.json'), 'utf8'));
const masked = (x, y) => ink.some((r) => x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height);
let skyPixels = 0;
for (let y = 0; y < png.height; y++) {
  for (let x = 0; x < png.width; x++) {
    if (masked(x, y)) {
      const i = (y * png.width + x) * 4;
      png.data[i] = 0; png.data[i + 1] = 0; png.data[i + 2] = 0;
    } else skyPixels++;
  }
}
writeFileSync(shotPath(`${NAME}-sky`), PNG.sync.write(png));
const W = png.width;
const H = png.height;
const lum = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) {
  lum[i] = 0.2126 * png.data[i * 4] + 0.7152 * png.data[i * 4 + 1] + 0.0722 * png.data[i * 4 + 2];
}
const L = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? NaN : lum[y * W + x]);

/** Median luminance of the ring r∈[lo,hi] around (x,y) — the LOCAL sky, so a star
 *  standing on a bright nebula is judged against that nebula and not against the
 *  darkest corner of the frame. */
function ring(x, y, lo, hi) {
  const vals = [];
  for (let a = 0; a < 64; a++) {
    const th = (2 * Math.PI * a) / 64;
    for (let r = lo; r <= hi; r += 2) {
      const v = L(Math.round(x + Math.cos(th) * r), Math.round(y + Math.sin(th) * r));
      if (!Number.isNaN(v)) vals.push(v);
    }
  }
  vals.sort((p, q) => p - q);
  return vals.length ? vals[vals.length >> 1] : 0;
}

/** Mean luminance along the four AXIS arms (where a diffraction cross is drawn:
 *  `starFieldSprite` strokes one horizontal and one vertical polyline) against the
 *  four diagonals at the same radii, which carry only the halo. */
function crossScore(x, y, lo, hi) {
  const at = (dx, dy) => {
    let s = 0;
    let n = 0;
    for (let r = lo; r <= hi; r++) {
      const v = L(Math.round(x + dx * r), Math.round(y + dy * r));
      if (!Number.isNaN(v)) { s += v; n++; }
    }
    return n ? s / n : 0;
  };
  const k = Math.SQRT1_2;
  const arms = (at(1, 0) + at(-1, 0) + at(0, 1) + at(0, -1)) / 4;
  const diag = (at(k, k) + at(-k, k) + at(k, -k) + at(-k, -k)) / 4;
  return { arms, diag, score: arms - diag };
}

// Local maxima, 3×3, standing at least 6 luma above the local sky.
const found = [];
for (let y = 2; y < H - 2; y++) {
  for (let x = 2; x < W - 2; x++) {
    const c = lum[y * W + x];
    if (c < 30) continue;
    let top = true;
    for (let j = -1; j <= 1 && top; j++) for (let i = -1; i <= 1; i++) {
      if ((i || j) && lum[(y + j) * W + (x + i)] > c) { top = false; break; }
    }
    if (!top) continue;
    const sky = ring(x, y, 30, 40);
    if (c - sky < 6) continue;
    found.push({ x, y, core: c, sky });
  }
}
// Merge maxima within 6px — one star, several plateau pixels. Deliberately
// small: a0-127 found two DISTINCT bloomed stars 12px apart on this frame, and a
// generous merge radius quietly counts them as one.
found.sort((a, b) => b.core - a.core);
const stars = [];
for (const f of found) {
  if (stars.some((s) => Math.hypot(s.x - f.x, s.y - f.y) < 6)) continue;
  stars.push(f);
}
for (const s of stars) {
  s.halo = +(ring(s.x, s.y, 8, 16) - s.sky).toFixed(2);
  const c = crossScore(s.x, s.y, 5, 22);
  s.cross = +c.score.toFixed(2);
  s.core = +s.core.toFixed(1);
  s.sky = +s.sky.toFixed(1);
}

// The candidates worth putting in front of an eye: a local maximum that stands
// clear of its own sky AND carries some ring of light around it. Deliberately
// generous — plain stars come through — because a checklist that only listed
// blooms would be deciding the question it exists to help answer.
const short = stars
  .filter((s) => !masked(s.x, s.y) && s.halo >= 4 && s.core - s.sky >= 30)
  .sort((a, b) => b.halo - a.halo);
const picked = [];
for (const s of short) {
  if (picked.some((p) => Math.hypot(p.x - s.x, p.y - s.y) < 10)) continue;
  picked.push(s);
}
picked.sort((a, b) => (Math.floor(a.y / 120) - Math.floor(b.y / 120)) || a.x - b.x);
picked.forEach((s, i) => { s.n = i + 1; });

note(`${NAME}-candidates`, {
  name: NAME,
  size: { width: W, height: H },
  order: 'reading order, row-major, numbered from 1 — the ring numbers on the count sheets (mark.mjs)',
  skyPixels,
  skyShare: +(skyPixels / (W * H)).toFixed(3),
  stars: picked,
});
const sheetStars = picked;
const haloed = sheetStars.filter((s) => s.halo > 1.2);
console.log(`${NAME}: sky ${(100 * skyPixels / (W * H)).toFixed(1)}% of frame; ${sheetStars.length} candidates, ${haloed.length} with halo>1.2, ${haloed.filter((s) => s.cross > 0.8).length} of those with cross>0.8`);
