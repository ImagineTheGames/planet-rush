/**
 * evidence/a0-70-title-entrance/firstframes.spec.ts — OWNER: UI Engineer (a0-70).
 *
 * A frame-exact film of the first second, because CDP screencast is not one: it
 * only emits a frame once the previous one is acked, so the single frame this
 * report is about is exactly the frame it is entitled to drop.
 *
 * The instrument is installed before any app code runs and is entirely
 * non-invasive — it patches nothing in `src/`:
 *
 *  1. `getContext` is wrapped so the WebGL context is created with
 *     `preserveDrawingBuffer: true`. Without it `toDataURL()` on Pixi's canvas
 *     reads back an empty buffer and every frame looks blank, which is its own
 *     way of lying about where the menu is.
 *  2. A self-rescheduling `requestAnimationFrame` loop fires a `setTimeout(0)`
 *     from inside its callback. Every rAF callback in one frame runs in a single
 *     task, so a timeout queued from within one lands **after Pixi's renderer
 *     has drawn** — i.e. it reads the frame the player is about to see, not the
 *     one before it.
 *  3. Each tick records the canvas as a PNG data URL, the gate overlay's own DOM
 *     rects and computed transforms, and `window.__mainMenu`'s logical viewport
 *     and control rects. Pixels and numbers from the same instant, so a claim
 *     about one can be checked against the other.
 *
 * Nothing is dropped and nothing is coalesced: frame `n` here is animation frame
 * `n` of the real boot.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LABEL = process.env.A0_70_LABEL ?? 'before';
/** Animation frames to keep. ~60 fps, so this is a little over a second — and
 *  the readback itself slows the page, which only ever makes the window longer. */
const FRAMES = Number(process.env.A0_70_FRAMES ?? 90);

interface Tick {
  readonly i: number;
  readonly t: number;
  readonly png: string;
  readonly canvas: { w: number; h: number; cssW: number; cssH: number } | null;
  readonly dom: readonly { sel: string; rect: [number, number, number, number]; transform: string }[];
  readonly menu: unknown;
}

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
  const MAX = ${FRAMES};

  function sample() {
    const canvas = document.querySelector('#app canvas');
    let png = '';
    let canvasInfo = null;
    if (canvas) {
      const r = canvas.getBoundingClientRect();
      canvasInfo = { w: canvas.width, h: canvas.height, cssW: r.width, cssH: r.height };
      try { png = canvas.toDataURL('image/png'); } catch (e) { png = 'ERR:' + e; }
    }
    // Every element the gate overlay owns, plus the mount itself. The overlay is
    // the only DOM in front of the canvas, so this is the whole of what could be
    // moving that is not Pixi.
    const dom = [];
    const mount = document.getElementById('app');
    for (const el of (mount ? mount.querySelectorAll('*') : [])) {
      if (el.tagName === 'CANVAS') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const cs = getComputedStyle(el);
      dom.push({
        sel: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ').join('.') : '')
          + '#' + (el.id || ''),
        rect: [Math.round(r.x * 10) / 10, Math.round(r.y * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10],
        transform: cs.transform,
      });
    }
    let menu = null;
    try {
      const m = window.__mainMenu;
      if (m) menu = { visible: m.visible, screen: m.screen, rotated: m.rotated,
                      logicalViewport: m.logicalViewport, controls: m.controls };
    } catch (e) { menu = 'ERR:' + e; }
    ticks.push({ i: i++, t: Math.round(performance.now()), png, canvas: canvasInfo, dom, menu });
  }

  function loop() {
    if (i >= MAX) return;
    requestAnimationFrame(() => {
      // Queued from inside a rAF callback, so it runs after every rAF callback in
      // this frame — Pixi's renderer included.
      setTimeout(() => { sample(); loop(); }, 0);
    });
  }
  loop();
})();`;

test('frame-exact film of the first second', async ({ page }) => {
  const url = process.env.A0_70_URL ?? '/';
  const dir = process.env.A0_70_DIR ?? 'exact';
  const out = join(HERE, 'frames', LABEL, dir);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  await page.addInitScript(INSTRUMENT);
  await page.goto(url, { waitUntil: 'commit' });
  // `A0_70_PRESS=1` opens the door and films the reveal as well as the boot: the
  // menu is BEHIND the gate, so the boot alone never shows it to a player, and
  // "where the menu is when you first see it" is a question about this sequence
  // too. The press is a real pointerdown on the overlay, which is the only thing
  // the gate accepts (`GateDom.mount`).
  if (process.env.A0_70_PRESS) {
    await page.waitForSelector('#pr-title-gate', { timeout: 30_000 });
    await page.mouse.click(200, 200);
  }
  await page.waitForFunction(`(window.__a0_70 || []).length >= ${FRAMES}`, null, { timeout: 120_000 });

  const ticks = (await page.evaluate('window.__a0_70')) as Tick[];
  const meta: unknown[] = [];
  for (const tick of ticks) {
    const name = `f${String(tick.i).padStart(3, '0')}-${String(tick.t).padStart(5, '0')}ms.png`;
    if (tick.png.startsWith('data:image/png;base64,')) {
      writeFileSync(join(out, name), Buffer.from(tick.png.slice('data:image/png;base64,'.length), 'base64'));
    }
    meta.push({ i: tick.i, t: tick.t, file: name, canvas: tick.canvas, dom: tick.dom, menu: tick.menu });
  }
  writeFileSync(join(out, 'ticks.json'), JSON.stringify(meta, null, 2));
  expect(ticks.length).toBe(FRAMES);
});
