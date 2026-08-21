/**
 * evidence/a0-127-three-changes-with-eyes/lib.mjs — the two things every capture
 * in this brief does, and the ruler it does them with. OWNER: QA Manager (a0-127).
 *
 * a0-111's method, kept through a0-118 and pointed at three shipped visual
 * changes (a0-123, a0-124, a0-125):
 *
 *  - the specimen is the app's OWN production pipeline (`npm run build` +
 *    `npm run preview`), on its own port, never a bench and never a dev server;
 *  - **no capture passes `?freeze=1`** — `src/main.ts` sets
 *    `buildBadge.visible = !flags.freeze`, so a frozen frame is a frame with the
 *    build stamp deliberately hidden, and the brief asks for the stamp in frame;
 *  - every frame writes a JSON readback beside it, and the readback is only ever a
 *    CROSS-CHECK: where a readback and an image disagree the image is the finding
 *    and the disagreement is the story (a0-96's rule, kept since);
 *  - crops are nearest-neighbour magnifications of a stated rectangle of a stated
 *    frame. No filtering, no annotation, nothing drawn over a specimen.
 */
import { PNG } from 'pngjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const SHOTS = join(HERE, 'shots');
export const CROPS = join(HERE, 'crops');

/** The shipping bundle's port. Its own, because the lanes share this box and a
 *  neighbouring preview may be serving another lane's pixels (a0-06's trap). */
export const PORT = process.env.PREVIEW_PORT ?? '4327';
export const BASE = `http://localhost:${PORT}`;
/** The pre-a0-123 bundle (68bac05e — main with a0-124 in it and a0-123 not yet),
 *  served from a second worktree for the one comparison that needs it. */
export const BEFORE_PORT = process.env.BEFORE_PORT ?? '4328';
export const BEFORE_BASE = `http://localhost:${BEFORE_PORT}`;

/**
 * The two screens this sweep is looked at on — a0-111's, unchanged, so a finding
 * here and a finding there are comparable rather than two different rulers. The
 * phone is the developer's own screenshot size and the narrowest supported width;
 * the desktop is the golden suite's control width. `dpr: 2` on both: these frames
 * exist to be READ.
 */
export const PHONE = { id: 'phone-798x384', width: 798, height: 384, dpr: 2, touch: true };
export const DESKTOP = { id: 'desktop-1280x800', width: 1280, height: 800, dpr: 2, touch: false };

export function pageOptions(profile) {
  return {
    viewport: { width: profile.width, height: profile.height },
    deviceScaleFactor: profile.dpr,
    hasTouch: profile.touch,
    isMobile: profile.touch,
  };
}

/** Wait for N composited render frames, with a stall watchdog — the same shape as
 *  `tests/mobile/render-settle.ts`, restated here so this bench does not depend on
 *  a test helper's import graph. A screenshot taken before the renderer has drawn
 *  is a picture of a frame that does not exist. */
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

/** Park the pointer off every affordance: a mouse left on a control HOVERS it,
 *  and a hovered plate is a brighter plate. Unless a frame says otherwise, every
 *  frame here is the screen AT REST. */
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
export async function bootMenu(page, base = BASE) {
  await page.goto(`${base}/?gate=0`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 60_000 });
  await page.waitForFunction(() => !!window.__mainMenu?.visible && window.__mainMenu.controls.length > 0, undefined, {
    timeout: 60_000,
  });
  await page.evaluate(() => document.fonts?.ready);
  await settle(page, 12);
}

/** Boot `?debug=1` — straight into an offline match with the read-back seams. */
export async function bootMatch(page, query = '?debug=1', base = BASE) {
  await page.goto(`${base}/${query}`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 60_000 });
  await page.waitForFunction(() => typeof window.__oreHudStage?.mine === 'function', undefined, { timeout: 60_000 });
  await page.evaluate(() => document.fonts?.ready);
  await settle(page, 12);
}

/** The build stamp the frame is wearing, read off the client's own seam. */
export async function stamp(page) {
  return page.evaluate(() => (window.__buildBadge ? { text: window.__buildBadge.text, visible: window.__buildBadge.visible } : null));
}

/** Every positioned element's drawn rect this frame, through the client's own
 *  corner seam (`__cornerStage`, installed on BOTH boots). */
export async function elements(page) {
  return page.evaluate(() => (window.__cornerStage?.read().elements ?? []).map((e) => ({
    id: e.id,
    anchor: e.anchor,
    bounds: { ...e.logicalBounds },
  })));
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

/** One magnified rectangle of one frame, nearest neighbour: every pixel in the
 *  output is a pixel from the specimen, repeated. `src` is a path. */
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
