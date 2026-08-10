/**
 * evidence/a0-18-bloom-gone/make-plates.mjs — a0-18, the looking glass. OWNER: Art Agent.
 *
 * The probe writes 2880×1800 frames; a reviewer looks at a crop. This cuts the
 * same window out of every frame it is given, at 1:1 device pixels (no resample —
 * a bilinear downscale is exactly the operation that would erase a 6% wash and
 * fake the defect under investigation), optionally amplified, and stacks the
 * requested crops into one labelled column.
 *
 *   node evidence/a0-18-bloom-gone/make-plates.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAMES = join(HERE, 'frames');
const PLATES = join(HERE, 'plates');

const read = (p) => PNG.sync.read(readFileSync(p));

/** A 1:1 crop. No resampling, ever — see the header. */
function crop(src, x, y, w, h) {
  const out = new PNG({ width: w, height: h });
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const s = ((y + j) * src.width + (x + i)) * 4;
      const d = (j * w + i) * 4;
      out.data[d] = src.data[s];
      out.data[d + 1] = src.data[s + 1];
      out.data[d + 2] = src.data[s + 2];
      out.data[d + 3] = 255;
    }
  }
  return out;
}

/** Multiply every channel by `k`, clamped — the "look closer" knob, stated on the plate. */
function amplify(img, k) {
  const out = new PNG({ width: img.width, height: img.height });
  for (let i = 0; i < img.data.length; i += 4) {
    out.data[i] = Math.min(255, Math.round(img.data[i] * k));
    out.data[i + 1] = Math.min(255, Math.round(img.data[i + 1] * k));
    out.data[i + 2] = Math.min(255, Math.round(img.data[i + 2] * k));
    out.data[i + 3] = 255;
  }
  return out;
}

/** Nearest-neighbour zoom — the only enlargement that adds no ink of its own. */
function zoom(img, k) {
  const out = new PNG({ width: img.width * k, height: img.height * k });
  for (let j = 0; j < out.height; j++) {
    for (let i = 0; i < out.width; i++) {
      const s = (Math.floor(j / k) * img.width + Math.floor(i / k)) * 4;
      const d = (j * out.width + i) * 4;
      out.data[d] = img.data[s];
      out.data[d + 1] = img.data[s + 1];
      out.data[d + 2] = img.data[s + 2];
      out.data[d + 3] = 255;
    }
  }
  return out;
}

/** Stack images vertically on a 2 px vacuum gutter, left-aligned. */
function stack(imgs, gap = 2) {
  const w = Math.max(...imgs.map((i) => i.width));
  const h = imgs.reduce((a, i) => a + i.height, 0) + gap * (imgs.length - 1);
  const out = new PNG({ width: w, height: h });
  out.data.fill(0);
  for (let i = 0; i < out.data.length; i += 4) out.data[i + 3] = 255;
  let y = 0;
  for (const img of imgs) {
    for (let j = 0; j < img.height; j++) {
      for (let i = 0; i < img.width; i++) {
        const s = (j * img.width + i) * 4;
        const d = ((y + j) * w + i) * 4;
        out.data[d] = img.data[s];
        out.data[d + 1] = img.data[s + 1];
        out.data[d + 2] = img.data[s + 2];
      }
    }
    y += img.height + gap;
  }
  return out;
}

mkdirSync(PLATES, { recursive: true });

/** The window: open void, left of centre, clear of the ship and the HUD. */
const WIN = { x: 200, y: 200, w: 900, h: 560 };

const jobs = [];
for (const label of ['before-111db86', 'after-ebdae99']) {
  for (const map of ['octagon', 'line']) {
    jobs.push({ label, map, tag: 'A-frozen', k: 1 });
    jobs.push({ label, map, tag: 'A-frozen', k: 4, suffix: '-x4' });
    jobs.push({ label, map, tag: 'iso-allStars', k: 1 });
  }
}

for (const j of jobs) {
  const src = read(join(FRAMES, j.label, `${j.map}-${j.tag}.png`));
  let img = crop(src, WIN.x, WIN.y, WIN.w, WIN.h);
  if (j.k !== 1) img = amplify(img, j.k);
  const out = join(PLATES, `${j.label}-${j.map}-${j.tag}${j.suffix ?? ''}.png`);
  writeFileSync(out, PNG.sync.write(img));
  console.log(`${out}  ${img.width}x${img.height}`);
}

/** The orb, at 6× nearest-neighbour: one 300×200 window of raw frame so a halo's
 *  radial falloff can be read off individual pixels. */
for (const label of ['before-111db86', 'after-ebdae99']) {
  const src = read(join(FRAMES, label, 'octagon-A-frozen.png'));
  const detail = zoom(crop(src, 300, 300, 300, 200), 3);
  writeFileSync(join(PLATES, `${label}-octagon-detail-x3.png`), PNG.sync.write(detail));
  const lit = zoom(amplify(crop(src, 300, 300, 300, 200), 5), 3);
  writeFileSync(join(PLATES, `${label}-octagon-detail-x3-lit5.png`), PNG.sync.write(lit));
}

/** before / after, same window, stacked — one image, one verdict. */
for (const map of ['octagon', 'line']) {
  const pair = stack([
    read(join(PLATES, `before-111db86-${map}-A-frozen-x4.png`)),
    read(join(PLATES, `after-ebdae99-${map}-A-frozen-x4.png`)),
  ]);
  writeFileSync(join(PLATES, `pair-${map}-A-frozen-x4.png`), PNG.sync.write(pair));
  console.log(`plates/pair-${map}-A-frozen-x4.png  (top before-111db86, bottom after-ebdae99)`);
}
