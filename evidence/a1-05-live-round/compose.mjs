/**
 * evidence/a1-05-live-round/compose.mjs — the two figures this round needs, built
 * from frames it already shot. OWNER: QA Manager.
 *
 * Nothing is drawn here that the client did not draw: each panel is a captured
 * crop, scaled by whole pixels (nearest neighbour, so no colour is invented) and
 * stacked with a hairline rule between panels. The captions are in the manifest,
 * not burnt into the image.
 *
 *   node evidence/a1-05-live-round/compose.mjs
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGES = resolve(HERE, '..', 'images');

const load = (n) => PNG.sync.read(readFileSync(join(IMAGES, n)));

/** Nearest-neighbour integer upscale — invents no colour. */
function scale(src, k) {
  const out = new PNG({ width: src.width * k, height: src.height * k });
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const si = (src.width * ((y / k) | 0) + ((x / k) | 0)) << 2;
      const di = (out.width * y + x) << 2;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = 255;
    }
  }
  return out;
}

/** Stack panels vertically with a 2px rule between them. */
function stackV(panels, gap = 4) {
  const width = Math.max(...panels.map((p) => p.width));
  const height = panels.reduce((h, p) => h + p.height, 0) + gap * (panels.length - 1);
  const out = new PNG({ width, height });
  out.data.fill(0);
  for (let i = 0; i < out.data.length; i += 4) out.data[i + 3] = 255;
  let y0 = 0;
  for (const [i, p] of panels.entries()) {
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        const si = (p.width * y + x) << 2;
        const di = (width * (y0 + y) + x) << 2;
        out.data[di] = p.data[si];
        out.data[di + 1] = p.data[si + 1];
        out.data[di + 2] = p.data[si + 2];
      }
    }
    y0 += p.height;
    if (i < panels.length - 1) {
      for (let y = y0; y < y0 + gap; y++) {
        for (let x = 0; x < width; x++) {
          const di = (width * y + x) << 2;
          out.data[di] = 60;
          out.data[di + 1] = 66;
          out.data[di + 2] = 74;
        }
      }
      y0 += gap;
    }
  }
  return out;
}

/** Lay panels side by side with a 2px rule between them. */
function stackH(panels, gap = 4) {
  const height = Math.max(...panels.map((p) => p.height));
  const width = panels.reduce((w, p) => w + p.width, 0) + gap * (panels.length - 1);
  const out = new PNG({ width, height });
  out.data.fill(0);
  for (let i = 0; i < out.data.length; i += 4) out.data[i + 3] = 255;
  let x0 = 0;
  for (const [i, p] of panels.entries()) {
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        const si = (p.width * y + x) << 2;
        const di = (width * y + (x0 + x)) << 2;
        out.data[di] = p.data[si];
        out.data[di + 1] = p.data[si + 1];
        out.data[di + 2] = p.data[si + 2];
      }
    }
    x0 += p.width;
    if (i < panels.length - 1) {
      for (let y = 0; y < height; y++) {
        for (let x = x0; x < x0 + gap; x++) {
          const di = (width * y + x) << 2;
          out.data[di] = 60;
          out.data[di + 1] = 66;
          out.data[di + 2] = 74;
        }
      }
      x0 += gap;
    }
  }
  return out;
}

const write = (name, png) => {
  writeFileSync(join(IMAGES, name), PNG.sync.write(png));
  console.log(`${name}  ${png.width}x${png.height}`);
};

// 1. The full-hold flash: on-beat, off-beat, and a half hold that never blinks.
write(
  'a1-05-hold-flash-figure.png',
  stackV([
    scale(load('a1-05-flash-full-1.png'), 3),
    scale(load('a1-05-flash-full-0.png'), 3),
    scale(load('a1-05-flash-half-0.png'), 3),
  ]),
);

// 2. The station ring at two ranges, damaged and healthy, from the same boot.
write(
  'a1-05-station-health-figure.png',
  stackV([
    stackH([load('a1-05-station-health-damaged-near-crop.png'), load('a1-05-station-health-damaged-far-crop.png')]),
    stackH([load('a1-05-station-health-healthy-near-crop.png'), load('a1-05-station-health-healthy-far-crop.png')]),
  ]),
);
