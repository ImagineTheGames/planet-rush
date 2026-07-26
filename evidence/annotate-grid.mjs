/**
 * evidence/annotate-grid.mjs — round-10 analysis helper (NOT a deliverable).
 * Crops burst frames around a planet centre and OVERLAYS a marker at every drawn
 * ship position (from bars(), stored per frame) so the turret disc — a grey disc
 * on the rim that is NOT at any ship marker — is unmistakable (round-8 lesson).
 * Besieger (a given owner) = red box; planet owner's own ship = cyan box; others
 * = yellow box; local = white box. Faint ring drawn at the rim radius, cross at
 * centre. Usage: node annotate-grid.mjs <epiDir> <ownerId> <besiegerId> <box> <idxCSV> <cols> <out>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const [dir, ownerS, besiegerS, boxS, idxCSV, colsS, out] = process.argv.slice(2);
const owner = +ownerS, besieger = +besiegerS, box = +(boxS ?? 380), cols = +(colsS ?? 4);
const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
const idxs = idxCSV.split(',').map(Number);
const RIM = 88;

function px(img, x, y, r, g, b) { if (x < 0 || y < 0 || x >= img.width || y >= img.height) return; const i = (y * img.width + x) * 4; img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255; }
function box2(img, cx, cy, s, r, g, b) { for (let d = -s; d <= s; d++) { px(img, cx + d, cy - s, r, g, b); px(img, cx + d, cy + s, r, g, b); px(img, cx - s, cy + d, r, g, b); px(img, cx + s, cy + d, r, g, b); } }
function cross(img, cx, cy, s, r, g, b) { for (let d = -s; d <= s; d++) { px(img, cx + d, cy, r, g, b); px(img, cx, cy + d, r, g, b); } }
function ring(img, cx, cy, rad, r, g, b) { for (let a = 0; a < 360; a += 2) { const x = Math.round(cx + rad * Math.cos(a * Math.PI / 180)), y = Math.round(cy + rad * Math.sin(a * Math.PI / 180)); px(img, x, y, r, g, b); } }

function cropAnn(f) {
  const c = f.centre;
  const x0 = Math.round(c.x - box / 2), y0 = Math.round(c.y - box / 2);
  const png = PNG.sync.read(readFileSync(f.path));
  const o = new PNG({ width: box, height: box });
  for (let y = 0; y < box; y++) for (let x = 0; x < box; x++) {
    const sx = x0 + x, sy = y0 + y, di = (y * box + x) * 4;
    if (sx < 0 || sy < 0 || sx >= png.width || sy >= png.height) { o.data[di + 3] = 255; continue; }
    const si = (sy * png.width + sx) * 4;
    o.data[di] = png.data[si]; o.data[di + 1] = png.data[si + 1]; o.data[di + 2] = png.data[si + 2]; o.data[di + 3] = 255;
  }
  const lx = Math.round(box / 2), ly = Math.round(box / 2);
  ring(o, lx, ly, RIM, 70, 90, 120);
  cross(o, lx, ly, 5, 200, 200, 60);
  for (const s of f.ships) {
    const mx = s.x - x0, my = s.y - y0;
    let col = [230, 210, 60]; // other bot = yellow
    if (s.local) col = [240, 240, 240];
    else if (s.o === besieger) col = [240, 60, 60];
    else if (s.o === owner) col = [60, 220, 220];
    box2(o, mx, my, 7, col[0], col[1], col[2]);
  }
  // muzzle origins (seam-certain turret pixel) = magenta cross
  for (const t of f.ownTurret) { cross(o, t.ox - x0, t.oy - y0, 6, 250, 80, 250); }
  return o;
}

const frames = idxs.map((i) => meta.frames.find((f) => f.i === i)).filter(Boolean);
const gap = 6, rows = Math.ceil(frames.length / cols);
const w = cols * box + gap * (cols - 1), h = rows * box + gap * (rows - 1);
const grid = new PNG({ width: w, height: h });
for (let i = 0; i < grid.data.length; i += 4) { grid.data[i] = 8; grid.data[i + 1] = 10; grid.data[i + 2] = 14; grid.data[i + 3] = 255; }
frames.forEach((f, k) => {
  const img = cropAnn(f);
  const cc = k % cols, rr = (k / cols) | 0, ox = cc * (box + gap), oy = rr * (box + gap);
  for (let y = 0; y < box; y++) for (let x = 0; x < box; x++) { const si = (y * box + x) * 4, di = ((oy + y) * w + (ox + x)) * 4; grid.data[di] = img.data[si]; grid.data[di + 1] = img.data[si + 1]; grid.data[di + 2] = img.data[si + 2]; grid.data[di + 3] = 255; }
});
writeFileSync(out, PNG.sync.write(grid));
console.log('grid', out, frames.map((f) => `i${f.i}/t${f.tick}/hp${(f.core ?? 0).toFixed(0)}`).join('  '));
