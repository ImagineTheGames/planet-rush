/**
 * evidence/a3-rock-palette/capture-rock-field.mjs — judge the rock at the zoom the
 * game renders it. OWNER: Art Agent (brief a3-01).
 *
 * a2-08 failed `art-vs-board-scene` on two measured pixels — the asteroid body at
 * luminance 154 against the board's 77, the rim ink a value step light. The fix is
 * three ramp stops and one line weight, and the whole risk in it is that a rock dark
 * enough to match the board stops reading against `#0D1015` on a phone. A swatch
 * cannot answer that; this shoots the REAL preview build, frozen, at the two sizes
 * that matter, and reports the numbers a swatch hides:
 *
 *   - the frozen arena, full frame, desktop 1280×800 and phone portrait 390×844
 *     (dpr 3) — `?debug=1&freeze=1` pins the sim at FREEZE_TICK, so a before/after
 *     pair is the same world down to the tick and the same rock is in the same place
 *   - every rock found by SEGMENTING the frame (below), cropped at 6× nearest-
 *     neighbour, so a facet and a crack line get looked at rather than inferred
 *   - per-rock readback: its own pixels, their luma (BT.601 — the number a2-08's
 *     verdict quoted, so the two compare line for line), WCAG contrast against
 *     Vacuum (does the rock still read against space?) and signal yellow's contrast
 *     against the body (is ore still legible ON it?)
 *
 * **Segmentation, not guessed pixels.** There is no asteroid position on the
 * `?debug=1` hook (`src/platform/debug-hook.ts` exposes the local ship and the
 * viewport, nothing else) and that file is not this agent's to extend. So rocks are
 * found in the frame instead: flood-fill the connected components of "not vacuum",
 * then keep the ones whose dominant colour is DESATURATED (max-min channel ≤ 24) and
 * whose bounding box is roughly round and rock-sized. That drops the starfield (too
 * small), the HUD (too wide, and its bone/gold are saturated or near-white), the
 * planet (patina and ocean are saturated) and the player ship (roster trim is
 * saturated, and its blob is small and elongated). What is left is rock. The filter
 * is stated in `looksLikeRock()` so a reader can disagree with it in one place.
 *
 * Run once per build, into its own directory:
 *   EVIDENCE_BASE_URL=http://localhost:4199 OUT=before node evidence/a3-rock-palette/capture-rock-field.mjs
 *
 * Needs a `vite preview` of the build under test on $EVIDENCE_BASE_URL.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LABEL = process.env.OUT ?? 'after';
const OUT = join(HERE, LABEL);
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4199';

mkdirSync(OUT, { recursive: true });

const VACUUM = [0x0d, 0x10, 0x15];
const SIGNAL_YELLOW = [0xf2, 0xd2, 0x4b];

const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
/** ITU-R BT.601 luma — the number a2-08's verdict quoted ("luminance 154 vs 77"). */
const luma = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
const relLum = ([r, g, b]) =>
  [r, g, b]
    .map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4))
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => {
  const [hi, lo] = relLum(a) > relLum(b) ? [relLum(a), relLum(b)] : [relLum(b), relLum(a)];
  return +((hi + 0.05) / (lo + 0.05)).toFixed(2);
};
const sat = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const px = (png, x, y) => {
  const i = (y * png.width + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
};

/**
 * The top colours in a region, quantised to a 6-bit-per-channel grid so
 * antialiasing does not shatter one fill into forty near-identical rows. Same
 * binning as the QA Manager's `probe-art-palette.mjs`, on purpose: the two
 * readbacks are meant to line up.
 */
function topColours(png, region, n = 8) {
  const { x, y, w, h } = region;
  const bins = new Map();
  let total = 0;
  for (let yy = y; yy < Math.min(y + h, png.height); yy++) {
    for (let xx = x; xx < Math.min(x + w, png.width); xx++) {
      const c = px(png, xx, yy);
      const key = `${c[0] >> 3}_${c[1] >> 3}_${c[2] >> 3}`;
      let e = bins.get(key);
      if (!e) bins.set(key, (e = { r: 0, g: 0, b: 0, n: 0 }));
      e.r += c[0];
      e.g += c[1];
      e.b += c[2];
      e.n++;
      total++;
    }
  }
  return [...bins.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, n)
    .map((e) => {
      const rgb = [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)];
      return {
        hex: hex(...rgb),
        share: +(e.n / total).toFixed(4),
        luma: +luma(rgb).toFixed(1),
        crVsVacuum: contrast(rgb, VACUUM),
        crVsSignalYellow: contrast(rgb, SIGNAL_YELLOW),
      };
    });
}

/** Nearest-neighbour upscale, so a 6× crop shows pixels rather than a guess at them. */
function zoom(png, { x, y, w, h }, s) {
  const out = new PNG({ width: w * s, height: h * s });
  for (let yy = 0; yy < h * s; yy++) {
    for (let xx = 0; xx < w * s; xx++) {
      const c = px(png, x + Math.floor(xx / s), y + Math.floor(yy / s));
      const di = (yy * out.width + xx) * 4;
      [out.data[di], out.data[di + 1], out.data[di + 2], out.data[di + 3]] = [...c, 255];
    }
  }
  return out;
}

/** Distance from Vacuum. Anything under this is background, not an entity. */
const isBackground = (c) => Math.hypot(c[0] - VACUUM[0], c[1] - VACUUM[1], c[2] - VACUUM[2]) <= 20;

/**
 * Is this connected component a rock? Stated in one place so it can be argued with.
 * A rock is a chunky, roughly-round, DESATURATED mass. The four things that share
 * the frame with it each fail at least one clause:
 *   starfield — area far too small · HUD — aspect far too wide
 *   planet / ore / plasma / roster trim — dominant colour is saturated
 *   the local ship — small, and its trim pushes the dominant colour saturated
 */
function looksLikeRock(blob, dominant, minR) {
  const w = blob.x1 - blob.x0 + 1;
  const h = blob.y1 - blob.y0 + 1;
  const aspect = Math.max(w, h) / Math.min(w, h);
  const fill = blob.n / (w * h);
  return (
    Math.min(w, h) >= minR * 1.5 &&
    Math.max(w, h) <= minR * 14 &&
    aspect <= 1.9 &&
    fill >= 0.45 &&
    sat(dominant) <= 24
  );
}

/** Flood-fill every non-background component, 4-connected, iterative (no recursion). */
function segment(png, minR) {
  const seen = new Uint8Array(png.width * png.height);
  const blobs = [];
  const stack = [];
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const idx = y * png.width + x;
      if (seen[idx] || isBackground(px(png, x, y))) continue;
      const blob = { x0: x, x1: x, y0: y, y1: y, n: 0 };
      stack.push(idx);
      seen[idx] = 1;
      while (stack.length) {
        const p = stack.pop();
        const py = (p / png.width) | 0;
        const pxx = p % png.width;
        blob.n++;
        if (pxx < blob.x0) blob.x0 = pxx;
        if (pxx > blob.x1) blob.x1 = pxx;
        if (py < blob.y0) blob.y0 = py;
        if (py > blob.y1) blob.y1 = py;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = pxx + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= png.width || ny >= png.height) continue;
          const ni = ny * png.width + nx;
          if (seen[ni] || isBackground(px(png, nx, ny))) continue;
          seen[ni] = 1;
          stack.push(ni);
        }
      }
      blobs.push(blob);
    }
  }
  return blobs
    .map((b) => {
      const box = { x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 };
      const cols = topColours(png, box, 8);
      // The dominant colour of the blob, ignoring background pixels caught inside
      // its bounding box (a rock's box always contains some vacuum at the corners).
      const dom = cols.find((c) => !isBackground([...c.hex.slice(1).match(/../g)].map((s) => parseInt(s, 16))));
      return { blob: b, box, cols, dom: dom ? [...dom.hex.slice(1).match(/../g)].map((s) => parseInt(s, 16)) : [0, 0, 0] };
    })
    .filter((r) => looksLikeRock(r.blob, r.dom, minR))
    .sort((a, b) => b.blob.n - a.blob.n);
}

const notes = { label: LABEL, base: BASE, frames: [] };

async function shoot(browser, name, viewport, dsf) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dsf });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(BASE + '/?debug=1&freeze=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => window.__planetRush?.frozen === true, undefined, { timeout: 20_000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await sleep(1500);

  const stamp = await page.evaluate(() => {
    const p = window.__planetRush;
    return { ticks: p.ticks, worldHash: p.worldHash, freezeTick: p.freezeTick, build: p.build?.sha ?? null };
  });

  const buf = await page.screenshot();
  writeFileSync(join(OUT, `${name}-full.png`), buf);
  const png = PNG.sync.read(buf);

  // The sim's smallest asteroid is radius 22 world units; at dpr `dsf` and roughly
  // 1:1 zoom that is the floor a rock blob can be, which is what `minR` scales.
  const rocks = segment(png, 22 * dsf).slice(0, 8);
  rocks.forEach((r, i) => {
    writeFileSync(join(OUT, `${name}-rock${i}-x6.png`), PNG.sync.write(zoom(png, r.box, 6)));
  });

  const frame = {
    name,
    viewport,
    deviceScaleFactor: dsf,
    ...stamp,
    errors,
    rocks: rocks.map((r, i) => ({ i, box: r.box, pixels: r.blob.n, colours: r.cols })),
  };
  notes.frames.push(frame);

  console.log(`\n[${name}] ${viewport.width}×${viewport.height} dpr${dsf} · tick ${stamp.ticks} · ${rocks.length} rocks`);
  for (const r of frame.rocks) {
    console.log(
      `  rock${r.i} ${r.box.w}×${r.box.h}px `.padEnd(22),
      r.colours
        .filter((c) => c.share > 0.03)
        .slice(0, 4)
        .map((c) => `${c.hex} ${(c.share * 100).toFixed(0)}% L${c.luma} vac${c.crVsVacuum} ore${c.crVsSignalYellow}`)
        .join('  '),
    );
  }
  await ctx.close();
}

const browser = await chromium.launch();
await shoot(browser, 'desktop', { width: 1280, height: 800 }, 1);
// The phone half is LANDSCAPE 844×390, not portrait: the game locks to landscape
// (src/platform/orientation.ts) and `tests/mobile/goldens.spec.ts` shoots its phone
// frozen scene rotated for the same reason. A portrait boot parks the camera on the
// station with no rock in frame at all — it would have answered nothing. 390 is the
// short edge, i.e. the thumb-scale the brief names.
await shoot(browser, 'phone-landscape', { width: 844, height: 390 }, 3);
await browser.close();
writeFileSync(join(OUT, 'readback.json'), JSON.stringify(notes, null, 2));
console.log('\nwrote', join(OUT, 'readback.json'));
