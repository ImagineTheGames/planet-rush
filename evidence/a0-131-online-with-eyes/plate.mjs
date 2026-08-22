/**
 * evidence/a0-131-online-with-eyes/plate.mjs — crops and plates. OWNER: QA
 * Manager (a0-131), after a0-111's `crops.mjs`, same rules.
 *
 * Nearest-neighbour magnification of a stated rectangle of a stated frame, and
 * composition of frames onto one plate. No filtering (a smoothed crop invents
 * pixels), no annotation, no drawing over the specimen. Rectangles are in the
 * PHYSICAL pixels of the source PNG - both profiles are dpr 2, so a logical 16 px
 * margin is 32 px here.
 *
 * This brief's plates are almost all PAIRS: the host frame above the joiner
 * frame, because the whole point is what the two clients each showed. A caption
 * strip is NOT drawn - captions live in the manifest attestation, where they can
 * be read as words rather than trusted as pixels.
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SHOTS, HERE } from './lib.mjs';

export const IMAGES = join(HERE, '..', 'images');

export const read = (name) => PNG.sync.read(readFileSync(join(SHOTS, `${name}.png`)));

/** A magnified rectangle of a frame, nearest-neighbour. */
export function crop(src, { x, y, w, h, scale = 1 }) {
  const png = typeof src === 'string' ? read(src) : src;
  const out = new PNG({ width: Math.round(w * scale), height: Math.round(h * scale) });
  for (let j = 0; j < out.height; j++) {
    for (let i = 0; i < out.width; i++) {
      const sx = Math.min(png.width - 1, Math.max(0, x + Math.floor(i / scale)));
      const sy = Math.min(png.height - 1, Math.max(0, y + Math.floor(j / scale)));
      const si = (png.width * sy + sx) * 4;
      const di = (out.width * j + i) * 4;
      out.data[di] = png.data[si];
      out.data[di + 1] = png.data[si + 1];
      out.data[di + 2] = png.data[si + 2];
      out.data[di + 3] = 255;
    }
  }
  return out;
}

/** Halve a frame, so a 2560-wide dpr2 specimen lands on a plate at a sane size
 *  without a resampler inventing anything: every output pixel is a source pixel. */
export function half(png) {
  const out = new PNG({ width: png.width >> 1, height: png.height >> 1 });
  for (let j = 0; j < out.height; j++) {
    for (let i = 0; i < out.width; i++) {
      const si = (png.width * (j * 2) + i * 2) * 4;
      const di = (out.width * j + i) * 4;
      out.data[di] = png.data[si];
      out.data[di + 1] = png.data[si + 1];
      out.data[di + 2] = png.data[si + 2];
      out.data[di + 3] = 255;
    }
  }
  return out;
}

const GAP = 10;
const RULE = 60; // the hairline between panes, mid grey

function blank(width, height) {
  const out = new PNG({ width, height });
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = 12; out.data[i + 1] = 14; out.data[i + 2] = 18; out.data[i + 3] = 255;
  }
  return out;
}

function blit(dst, src, x0, y0) {
  for (let j = 0; j < src.height; j++) {
    const dy = y0 + j;
    if (dy < 0 || dy >= dst.height) continue;
    for (let i = 0; i < src.width; i++) {
      const dx = x0 + i;
      if (dx < 0 || dx >= dst.width) continue;
      const si = (src.width * j + i) * 4;
      const di = (dst.width * dy + dx) * 4;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = 255;
    }
  }
}

/** Stack panes vertically, left-aligned, with a hairline rule between them. */
export function stack(panes) {
  const width = Math.max(...panes.map((p) => p.width));
  const height = panes.reduce((n, p) => n + p.height, 0) + GAP * (panes.length - 1);
  const out = blank(width, height);
  let y = 0;
  for (const [i, p] of panes.entries()) {
    if (i > 0) {
      for (let x = 0; x < width; x++) {
        const di = (out.width * (y - GAP / 2 | 0) + x) * 4;
        out.data[di] = RULE; out.data[di + 1] = RULE; out.data[di + 2] = RULE;
      }
    }
    blit(out, p, 0, y);
    y += p.height + GAP;
  }
  return out;
}

/** Lay panes side by side, top-aligned, with a hairline rule between them. */
export function row(panes) {
  const height = Math.max(...panes.map((p) => p.height));
  const width = panes.reduce((n, p) => n + p.width, 0) + GAP * (panes.length - 1);
  const out = blank(width, height);
  let x = 0;
  for (const [i, p] of panes.entries()) {
    if (i > 0) {
      for (let y = 0; y < height; y++) {
        const di = (out.width * y + (x - (GAP >> 1))) * 4;
        out.data[di] = RULE; out.data[di + 1] = RULE; out.data[di + 2] = RULE;
      }
    }
    blit(out, p, x, 0);
    x += p.width + GAP;
  }
  return out;
}

export function save(png, name) {
  mkdirSync(IMAGES, { recursive: true });
  writeFileSync(join(IMAGES, `${name}.png`), PNG.sync.write(png));
  console.log(`  images/${name}.png  ${png.width}x${png.height}`);
}
