/**
 * evidence/a0-70-title-entrance/resize-boot.spec.ts — OWNER: UI Engineer (a0-70).
 *
 * The one mechanism left that could put the menu somewhere other than where it
 * belongs on its first visible frame: **the viewport changing while the boot is
 * still in flight**. A window being restored from a previous session, a window
 * dragged to a second monitor at a different DPI, or a browser that reports one
 * size at `Application.init` and another a frame later would all land here — and
 * a menu laid out for the wrong viewport and then re-laid is exactly the "snap
 * into place" candidate 1 of the brief describes.
 *
 * So: boot at a deliberately wrong size, change it mid-boot, and film. If any
 * frame carries the menu off-centre, this is where it shows up.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LABEL = process.env.A0_70_LABEL ?? 'before';
const FRAMES = 60;

const INSTRUMENT = `(() => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (typeof type === 'string' && type.indexOf('webgl') === 0) {
      attrs = Object.assign({}, attrs, { preserveDrawingBuffer: true });
    }
    return orig.call(this, type, attrs);
  };
  const ticks = [];
  window.__a0_70 = ticks;
  let i = 0;
  function sample() {
    const canvas = document.querySelector('#app canvas');
    let png = '';
    if (canvas) { try { png = canvas.toDataURL('image/png'); } catch (e) { png = ''; } }
    ticks.push({ i: i++, t: Math.round(performance.now()), png,
                 win: [window.innerWidth, window.innerHeight],
                 canvas: canvas ? [canvas.width, canvas.height] : null });
  }
  function loop() {
    if (i >= ${FRAMES}) return;
    requestAnimationFrame(() => setTimeout(() => { sample(); loop(); }, 0));
  }
  loop();
})();`;

test('the menu across a viewport change during boot', async ({ page }) => {
  const out = join(HERE, 'frames', LABEL, 'resize-boot');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  await page.setViewportSize({ width: 900, height: 600 });
  await page.addInitScript(INSTRUMENT);
  await page.goto('/', { waitUntil: 'commit' });
  // Mid-boot, before the bundle has finished evaluating on this machine.
  await page.waitForTimeout(120);
  await page.setViewportSize({ width: 1707, height: 898 });

  await page.waitForFunction(`(window.__a0_70 || []).length >= ${FRAMES}`, null, { timeout: 60_000 });
  const ticks = (await page.evaluate('window.__a0_70')) as {
    i: number; t: number; png: string; win: [number, number]; canvas: [number, number] | null;
  }[];
  const meta: unknown[] = [];
  for (const tick of ticks) {
    const name = `f${String(tick.i).padStart(3, '0')}-${String(tick.t).padStart(5, '0')}ms.png`;
    if (tick.png.startsWith('data:image/png;base64,')) {
      writeFileSync(join(out, name), Buffer.from(tick.png.slice('data:image/png;base64,'.length), 'base64'));
    }
    meta.push({ i: tick.i, t: tick.t, file: name, win: tick.win, canvas: tick.canvas });
  }
  writeFileSync(join(out, 'ticks.json'), JSON.stringify(meta, null, 2));
  expect(ticks.length).toBe(FRAMES);
});
