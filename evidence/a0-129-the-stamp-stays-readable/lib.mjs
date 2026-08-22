/**
 * evidence/a0-129-the-stamp-stays-readable/lib.mjs — the ruler. OWNER: UI Engineer (a0-129).
 *
 * a0-111's method, kept through a0-118 and a0-127, and pointed at the defect
 * a0-127 found while photographing something else:
 *
 *  - the specimen is the app's OWN production pipeline (`npm run build` +
 *    `npm run preview`), on its own port, never a bench and never a dev server;
 *  - **no capture passes `?freeze=1`** — `src/main.ts` sets
 *    `buildBadge.visible = !flags.freeze`, so a frozen frame is a frame with the
 *    build stamp deliberately hidden, and this brief is ABOUT the stamp;
 *  - every frame writes a JSON readback beside it, and the readback is only ever
 *    a cross-check: where a readback and an image disagree the image is the
 *    finding (a0-96's rule, kept since);
 *  - crops are nearest-neighbour magnifications of a stated rectangle of a stated
 *    frame. No filtering, no annotation, nothing drawn over a specimen.
 *
 * The profile is a0-127's own — **phone landscape 798x384 dpr 2 touch** — because
 * the finding this answers was measured there, and a fix photographed on a
 * different screen is a different measurement.
 *
 * Restated here rather than imported from `../a0-127-three-changes-with-eyes`:
 * that directory is QA's evidence for a closed brief, and a script of mine
 * writing PNGs into it would edit their attestation.
 */
import { PNG } from 'pngjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const SHOTS = join(HERE, 'shots');
export const CROPS = join(HERE, 'crops');

/** This brief's own ports, because the lanes share this box and a neighbouring
 *  preview may be serving another lane's pixels (a0-06's trap). AFTER is this
 *  branch; BEFORE is `main` as it stands, built from a second worktree. */
export const AFTER_BASE = `http://localhost:${process.env.AFTER_PORT ?? '4329'}`;
export const BEFORE_BASE = `http://localhost:${process.env.BEFORE_PORT ?? '4330'}`;

/** a0-127's phone, to the pixel. `dpr: 2`: these frames exist to be READ. */
export const PHONE = { id: 'phone-798x384', width: 798, height: 384, dpr: 2, touch: true };

export function pageOptions(profile) {
  return {
    viewport: { width: profile.width, height: profile.height },
    deviceScaleFactor: profile.dpr,
    hasTouch: profile.touch,
    isMobile: profile.touch,
  };
}

/** Wait for N composited render frames, with a stall watchdog — the same shape as
 *  `tests/mobile/render-settle.ts`. A screenshot taken before the renderer has
 *  drawn is a picture of a frame that does not exist. */
export async function settle(page, frames = 8) {
  await page.evaluate(
    (n) =>
      new Promise((resolve) => {
        let seen = 0;
        const tick = () => {
          if (++seen >= n) resolve(undefined);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        setTimeout(() => resolve(undefined), 8000);
      }),
    frames,
  );
}

/** Park the pointer off every affordance: a hovered plate is a brighter plate,
 *  and every frame here is the screen AT REST. */
export async function park(page) {
  await page.mouse.move(1, 1);
  await settle(page, 8);
}

export async function frame(page, name) {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), timeout: 240_000 });
}

export function note(name, data) {
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(join(SHOTS, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
}

/** Boot to the real main menu, past the title gate (`?gate=0` turns off that one
 *  screen and nothing else — the menu, the doors and the lobby are the real ones). */
export async function bootMenu(page, base) {
  await page.goto(`${base}/?gate=0`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 60_000 });
  await page.waitForFunction(
    () => !!window.__mainMenu?.visible && window.__mainMenu.controls.length > 0,
    undefined,
    { timeout: 60_000 },
  );
  await page.evaluate(() => document.fonts?.ready);
  await settle(page, 12);
}

/**
 * The build stamp this frame is wearing, off the client's own read-only seam
 * (`main.ts`'s `window.__buildBadge`): the tag, whether it is drawn, and the rect
 * it reports drawing at — which is where a0-127's `{8,363 43.5x13}` came from.
 *
 * This and not `__cornerStage`, and the difference is the brief. **The corner
 * seam is not installed on a menu screen at all** — it is built in the match boot
 * (`installCornerStage`), so on MAP SELECT `window.__cornerStage` is `undefined`
 * and there is no registry to read, exactly as a0-127 said. `__buildBadge` is the
 * badge component's own seam and is installed with the badge, before the menu.
 */
export async function stamp(page) {
  return page.evaluate(() => (window.__buildBadge ? { ...window.__buildBadge } : null));
}

/** Every positioned element's drawn rect this frame, IF the client has a layout
 *  registry to read on this screen. On a menu it has none — see {@link stamp} —
 *  so this returns `[]` and the emptiness is itself part of the readback. */
export async function elements(page) {
  return page.evaluate(() => {
    if (!window.__cornerStage) return null;
    return window.__cornerStage.read().elements.map((e) => ({
      id: e.id,
      anchor: e.anchor,
      bounds: { ...e.logicalBounds },
    }));
  });
}

export function rectOf(els, id) {
  return els.find((e) => e.id === id)?.bounds ?? null;
}

/** Intersection of two rects, or null. */
export function overlap(a, b) {
  if (!a || !b) return null;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.width, b.x + b.width);
  const t = Math.min(a.y + a.height, b.y + b.height);
  if (r <= x || t <= y) return null;
  return { x, y, width: r - x, height: t - y };
}

/** One magnified rectangle of one frame, nearest neighbour: every pixel out is a
 *  pixel from the specimen, repeated. `src` is a path. */
export function crop(src, { x, y, w, h, scale = 1 }) {
  const png = PNG.sync.read(readFileSync(src));
  const out = new PNG({ width: w * scale, height: h * scale });
  for (let j = 0; j < h * scale; j++) {
    for (let i = 0; i < w * scale; i++) {
      const sx = Math.max(0, Math.min(png.width - 1, x + Math.floor(i / scale)));
      const sy = Math.max(0, Math.min(png.height - 1, y + Math.floor(j / scale)));
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

export function writeCrop(name, png) {
  mkdirSync(CROPS, { recursive: true });
  writeFileSync(join(CROPS, `${name}.png`), PNG.sync.write(png));
}

export const shotPath = (name) => join(SHOTS, `${name}.png`);

// ---------------------------------------------------------------------------
// Measuring off the pixels — because there is no registry to read here
// ---------------------------------------------------------------------------

/** Rec. 601 luma of one pixel, 0..255. */
const luma = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/**
 * The brightest and the mean pixel inside a LOGICAL rect of a frame.
 *
 * This is how "is the stamp readable" is measured rather than argued. The stamp
 * is `PALETTE.hullSteel` (#7E8894, luma ~136) at alpha 0.55 over whatever is
 * behind it, so its own ink cannot reach far past ~136 on a dark ground; a
 * `primary` plate's face and its white accent bar are far brighter than that. A
 * max luma in the stamp's own rect that is well above the ink's ceiling is a
 * plate behind the tag, and that is the defect a0-127 photographed.
 */
export function pixelStats(src, rect, dpr) {
  const png = PNG.sync.read(readFileSync(src));
  const x0 = Math.max(0, Math.round(rect.x * dpr));
  const y0 = Math.max(0, Math.round(rect.y * dpr));
  const x1 = Math.min(png.width, Math.round((rect.x + rect.width) * dpr));
  const y1 = Math.min(png.height, Math.round((rect.y + rect.height) * dpr));
  let max = 0;
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const l = luma(png.data, (png.width * y + x) * 4);
      if (l > max) max = l;
      sum += l;
      n++;
    }
  }
  return { max: Math.round(max * 10) / 10, mean: n ? Math.round((sum / n) * 10) / 10 : 0, pixels: n };
}

/**
 * The top edge of the bright plate above the bottom-left corner, LOGICAL px —
 * measured, not read off a seam, because on a menu screen no seam reports it.
 *
 * Inside `columns` (a logical x span) and within `window` logical px of the
 * bottom edge, this returns the HIGHEST row carrying a run of >= `run`
 * consecutive pixels at or above `threshold`. A `primary` plate's face is the
 * brightest large flat area in that corner by a wide margin; the beam behind it
 * is dark metal and the stamp's own ink cannot reach the threshold (it is
 * #7E8894 at 0.55 alpha — see {@link pixelStats}).
 *
 * Gaps are not a stopping condition: `drawPlate` cuts the plate's lower-left
 * corner away at an angle, so scanning up from the bottom edge crosses rows that
 * carry no run at all before reaching the plate's body. An early break there
 * measures the corner cut rather than the plate.
 */
export function plateTop(src, { x, width }, dpr, { threshold = 100, run = 20, window = 90 } = {}) {
  const png = PNG.sync.read(readFileSync(src));
  const x0 = Math.max(0, Math.round(x * dpr));
  const x1 = Math.min(png.width, Math.round((x + width) * dpr));
  const yStop = Math.max(0, png.height - Math.round(window * dpr));
  let top = null;
  for (let y = png.height - 1; y >= yStop; y--) {
    let best = 0;
    let cur = 0;
    for (let px = x0; px < x1; px++) {
      if (luma(png.data, (png.width * y + px) * 4) >= threshold) {
        if (++cur > best) best = cur;
      } else cur = 0;
    }
    if (best >= run) top = y;
  }
  return top === null ? null : top / dpr;
}
