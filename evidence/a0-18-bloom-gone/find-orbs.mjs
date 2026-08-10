/**
 * evidence/a0-18-bloom-gone/find-orbs.mjs — a0-18, aim the crop. OWNER: Art Agent.
 *
 * Cropping a 2880×1800 frame at coordinates chosen by hand lands on empty void
 * more often than not, and an empty crop is not evidence of anything. So the crop
 * is aimed by the isolate instead: the star layer's own delta field
 * (|A − A-without-that-layer|, from probe-bloom.mjs) is segmented into connected
 * components, and the biggest ones ARE the bloomed stars — a plain star is a
 * ~4 px dot, a bloomed one a disc up to 4.3× its radius. For each it reports the
 * centroid, the bounding box, the peak delta at the centre and the delta at the
 * rim, then cuts that window out of the RAW frame at 3× nearest-neighbour so the
 * halo can be read pixel by pixel.
 *
 *   node evidence/a0-18-bloom-gone/find-orbs.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAMES = join(HERE, 'frames');
const PLATES = join(HERE, 'plates');
const LABELS = ['before-111db86', 'after-ebdae99'];
const AMPLIFY = 14; // the amplification probe-bloom.mjs baked into the isolate plates

const read = (p) => PNG.sync.read(readFileSync(p));
const luma = (d, o) => 0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2];

/** Components of the isolate plate at Δ ≥ 2 (the plate is Δ×14, so ≥ 28 of ink). */
function components(img, minInk = 2 * AMPLIFY) {
  const n = img.width * img.height;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const out = [];
  for (let i = 0; i < n; i++) {
    if (seen[i] || img.data[i * 4] < minInk) continue;
    let top = 0;
    stack[top++] = i;
    seen[i] = 1;
    const px = [];
    while (top > 0) {
      const p = stack[--top];
      px.push(p);
      const x = p % img.width;
      const y = (p - x) / img.width;
      const push = (q) => {
        if (q >= 0 && q < n && !seen[q] && img.data[q * 4] >= minInk) {
          seen[q] = 1;
          stack[top++] = q;
        }
      };
      if (x > 0) push(p - 1);
      if (x < img.width - 1) push(p + 1);
      if (y > 0) push(p - img.width);
      if (y < img.height - 1) push(p + img.width);
    }
    let sx = 0;
    let sy = 0;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    let peak = 0;
    for (const p of px) {
      const x = p % img.width;
      const y = (p - x) / img.width;
      sx += x;
      sy += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const v = img.data[p * 4] / AMPLIFY;
      if (v > peak) peak = v;
    }
    out.push({
      area: px.length,
      cx: Math.round(sx / px.length),
      cy: Math.round(sy / px.length),
      w: x1 - x0 + 1,
      h: y1 - y0 + 1,
      peakDelta: Math.round(peak * 10) / 10,
    });
  }
  out.sort((a, b) => b.area - a.area);
  return out;
}

/** Nearest-neighbour zoom of a crop, with optional amplification. */
function cut(src, x, y, w, h, k, gain = 1) {
  x = Math.max(0, Math.min(src.width - w, x));
  y = Math.max(0, Math.min(src.height - h, y));
  const out = new PNG({ width: w * k, height: h * k });
  for (let j = 0; j < out.height; j++) {
    for (let i = 0; i < out.width; i++) {
      const s = ((y + Math.floor(j / k)) * src.width + (x + Math.floor(i / k))) * 4;
      const d = (j * out.width + i) * 4;
      out.data[d] = Math.min(255, Math.round(src.data[s] * gain));
      out.data[d + 1] = Math.min(255, Math.round(src.data[s + 1] * gain));
      out.data[d + 2] = Math.min(255, Math.round(src.data[s + 2] * gain));
      out.data[d + 3] = 255;
    }
  }
  return out;
}

/** A horizontal cut through a blob's centre, as raw luma — the radial profile a
 *  halo has and a bare point does not. */
function profile(raw, cx, cy, half = 26) {
  const row = [];
  for (let i = -half; i <= half; i++) {
    const x = Math.max(0, Math.min(raw.width - 1, cx + i));
    row.push(Math.round(luma(raw.data, (cy * raw.width + x) * 4) * 10) / 10);
  }
  return row;
}

mkdirSync(PLATES, { recursive: true });
const report = {};

for (const label of LABELS) {
  report[label] = {};
  for (const map of ['octagon', 'line']) {
    const raw = read(join(FRAMES, label, `${map}-A-frozen.png`));
    report[label][map] = {};
    for (const layer of ['near', 'mid', 'deep']) {
      const iso = read(join(FRAMES, label, `${map}-iso-${layer}.png`));
      const comps = components(iso);
      const top = comps.slice(0, 6);
      report[label][map][layer] = {
        components: comps.length,
        top: top.map((c) => ({ ...c, profile: profile(raw, c.cx, c.cy) })),
      };
      console.log(`${label} ${map} ${layer}: ${comps.length} components; biggest:`);
      for (const c of top.slice(0, 3)) {
        console.log(
          `   area=${String(c.area).padStart(4)} box=${c.w}x${c.h} at (${c.cx},${c.cy}) peakΔ=${c.peakDelta}`,
        );
      }
      // The single biggest orb in this layer, cut out of the raw frame.
      if (top[0]) {
        const c = top[0];
        const size = 96;
        const x = c.cx - size / 2;
        const y = c.cy - size / 2;
        writeFileSync(
          join(PLATES, `${label}-${map}-orb-${layer}-x6.png`),
          PNG.sync.write(cut(raw, x, y, size, size, 6)),
        );
        writeFileSync(
          join(PLATES, `${label}-${map}-orb-${layer}-x6-lit4.png`),
          PNG.sync.write(cut(raw, x, y, size, size, 6, 4)),
        );
      }
    }
  }
}

writeFileSync(join(HERE, 'orbs.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nwrote ${join(HERE, 'orbs.json')}`);
