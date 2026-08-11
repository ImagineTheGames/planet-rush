/**
 * evidence/a0-23-touch-controls-theme/plate.mjs — the before/after plates.
 *
 * Crops the same window out of the same frame at two builds and lays them side
 * by side (before | after) so the developer can judge one control at a time at
 * the size a thumb sees it, rather than squinting at two 844×390 screenshots.
 *
 * Sources, and why each is what it is:
 *   · FIRE and the stick zone — the frozen landscape golden
 *     (`phone-landscape-frozen`), deterministic, `before` read straight out of
 *     git at the merge base;
 *   · BUILD — the live captures from ./capture.mjs, because no frozen scene can
 *     carry that button (see the header there).
 *
 * It also prints the two ratios the PR quotes: how much of the FULL frame the
 * re-skin moved (which is why every full-frame baseline passed unchanged) and
 * how much of the clipped thumb band it moved (which is why that band is now a
 * baseline of its own).
 *
 * Reproduce:
 *   git show $(git merge-base origin/main HEAD):tests/mobile/goldens.spec.ts-snapshots/phone-landscape-frozen-iphone-linux.png > evidence/a0-23-touch-controls-theme/before-frozen.png
 *   cp tests/mobile/goldens.spec.ts-snapshots/phone-landscape-frozen-iphone-linux.png evidence/a0-23-touch-controls-theme/after-frozen.png
 *   node evidence/a0-23-touch-controls-theme/plate.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const here = path.dirname(new URL(import.meta.url).pathname);

/**
 * The frozen phone golden is **844×390**, not 2532×1170: Playwright's
 * `toHaveScreenshot` defaults to `scale: 'css'`, so a dpr-3 phone baseline is
 * stored in CSS pixels. (`page.screenshot()` in ./capture.mjs defaults the other
 * way, to `scale: 'device'`, which is why that file scales by 3 and this one
 * does not. Getting this backwards silently crops the wrong window.)
 */
const DPR = 1;
const SCALE = 3;
const GUTTER = 10;

/** Windows in CSS px, from the control geometry in `@platform/touch-visuals`. */
const WINDOWS = {
  /** The hold-to-FIRE button: centre (774, 320), r = 42. */
  fire: { x: 714, y: 260, w: 120, h: 120 },
  /** The left thrust-stick zone ghost: centre (92, 298), r = 64. */
  stick: { x: 14, y: 220, w: 156, h: 156 },
};

/** The WORD `FIRE` alone, tight around the 18px line. Measured separately from
 *  the button because the two answer different questions: the button's window
 *  includes a rim that is now deliberately shadowed along its bottom, and the
 *  word is the thing a glance actually resolves. */
const FIRE_LABEL_WINDOW = { x: 748, y: 309, w: 52, h: 22 };

/** `PNG.sync.read` hands back a bare bitmap, not a `PNG` — so it has no
 *  `bitblt`. Copy it into a real one, once, at the door. */
function read(file) {
  const raw = PNG.sync.read(fs.readFileSync(path.join(here, file)));
  const out = new PNG({ width: raw.width, height: raw.height });
  raw.data.copy(out.data);
  return out;
}

function crop(src, { x, y, w, h }, scale, dpr) {
  const out = new PNG({ width: w * scale, height: h * scale });
  for (let oy = 0; oy < out.height; oy++) {
    for (let ox = 0; ox < out.width; ox++) {
      const sx = Math.min(src.width - 1, Math.round((x + ox / scale) * dpr));
      const sy = Math.min(src.height - 1, Math.round((y + oy / scale) * dpr));
      const si = (sy * src.width + sx) * 4;
      const di = (oy * out.width + ox) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = 255;
    }
  }
  return out;
}

/** before | after, with a gutter of the void between them. */
function beside(a, b) {
  const out = new PNG({ width: a.width + GUTTER + b.width, height: Math.max(a.height, b.height) });
  out.data.fill(0);
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
  a.bitblt(out, 0, 0, a.width, a.height, 0, 0);
  b.bitblt(out, 0, 0, b.width, b.height, a.width + GUTTER, 0);
  return out;
}

function write(name, png) {
  fs.writeFileSync(path.join(here, name), PNG.sync.write(png));
  console.log(`wrote ${name} (${png.width}×${png.height})`);
}

// --- The three plates ------------------------------------------------------

const frozenBefore = read('before-frozen.png');
const frozenAfter = read('after-frozen.png');

for (const [name, win] of Object.entries(WINDOWS)) {
  write(
    `${name}-before-after.png`,
    beside(crop(frozenBefore, win, SCALE, DPR), crop(frozenAfter, win, SCALE, DPR)),
  );
}
write('build-before-after.png', beside(read('before-build.png'), read('after-build.png')));

// --- The two ratios --------------------------------------------------------
//
// The point of the second number: a gate has to be pointed at the thing it is
// gating. Over a whole 844×390 frame the touch controls are a rounding error
// against a 1% budget a starfield has already half spent.

function ratio(a, b, region) {
  let moved = 0;
  let total = 0;
  const x0 = region ? Math.round(region.x * DPR) : 0;
  const y0 = region ? Math.round(region.y * DPR) : 0;
  const x1 = region ? Math.round((region.x + region.w) * DPR) : a.width;
  const y1 = region ? Math.round((region.y + region.h) * DPR) : a.height;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * a.width + x) * 4;
      total++;
      // Playwright's own comparator is perceptual; this is a plain "any channel
      // differs by more than a rounding step", which is stricter, so the ratios
      // below are an upper bound on what the gate would have seen.
      if (
        Math.abs(a.data[i] - b.data[i]) > 2 ||
        Math.abs(a.data[i + 1] - b.data[i + 1]) > 2 ||
        Math.abs(a.data[i + 2] - b.data[i + 2]) > 2
      ) {
        moved++;
      }
    }
  }
  return { moved, total, pct: (100 * moved) / total };
}

/**
 * "Does it still read?" as a number rather than as an opinion.
 *
 * Rec.601 luma over one control's window: the peak, and how many pixels clear
 * 128 — the ones a glance actually catches. Bone's claim is that brightness can
 * do the job hue was doing, so the honest test of it is whether the control got
 * BRIGHTER, not whether it got prettier.
 */
function luma(png, { x, y, w, h }) {
  let peak = 0;
  let bright = 0;
  let sum = 0;
  for (let oy = 0; oy < h; oy++) {
    for (let ox = 0; ox < w; ox++) {
      const i = ((y + oy) * png.width + (x + ox)) * 4;
      const yv = 0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2];
      sum += yv;
      if (yv > peak) peak = yv;
      if (yv >= 128) bright++;
    }
  }
  return { peak: Math.round(peak), bright, mean: +(sum / (w * h)).toFixed(1) };
}

/** The clip the new `phone-landscape-thumb-band` baseline takes. */
const BAND = { x: 0, y: 390 - 168, w: 844, h: 168 };

const full = ratio(frozenBefore, frozenAfter);
const band = ratio(frozenBefore, frozenAfter, BAND);
console.log(
  `\nfull frame : ${full.moved} / ${full.total} px moved = ${full.pct.toFixed(2)}%  (gate: 1.00%)`,
);
console.log(
  `thumb band : ${band.moved} / ${band.total} px moved = ${band.pct.toFixed(2)}%  (gate: 1.00%)`,
);
const readout = {};
for (const [name, win] of Object.entries({ ...WINDOWS, fireLabel: FIRE_LABEL_WINDOW })) {
  readout[name] = { before: luma(frozenBefore, win), after: luma(frozenAfter, win) };
  const b = readout[name].before;
  const a = readout[name].after;
  console.log(
    `${name.padEnd(6)}: peak ${b.peak} → ${a.peak}   px ≥128 ${b.bright} → ${a.bright}   mean ${b.mean} → ${a.mean}`,
  );
}

fs.writeFileSync(
  path.join(here, 'diff.json'),
  `${JSON.stringify({ fullFrame: full, thumbBand: band, gate: 0.01, luma: readout }, null, 2)}\n`,
);
