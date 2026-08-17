/**
 * evidence/a0-70-title-entrance/motion.spec.ts — OWNER: UI Engineer (a0-70).
 *
 * "It flies in" is a claim about MOTION, and the browser will tell you about
 * motion directly rather than by inference from pixels. This probe installs, at
 * document start and before a line of app code runs:
 *
 *  - `transitionrun` / `transitionstart` / `transitionend` / `animationstart`
 *    listeners in the CAPTURE phase on `document`, so every transition anything
 *    on the page runs is recorded with its property, its target, its duration,
 *    and — the part that names the corner — the target's rect at the instant the
 *    transition began versus where it ended up.
 *  - a `MutationObserver` on `#app`, which reports the gate overlay's own
 *    insertion and, in the SAME microtask, the door's computed transform and
 *    rect. That is the one instant the frame-loop sampler cannot reach: it is
 *    inside the boot's synchronous task, before any rAF can fire.
 *
 * A door that is momentarily transformless sits with its top-left corner at
 * `left:50% top:50%` — the bottom-right quadrant — because
 * `transform:translate(-50%,-50%) scale(var(--pr-gate-door-scale))` is invalid
 * at computed-value time while that variable is unset. If that state is ever
 * *painted*, a 1500 ms `transition:transform` carries it back to centre, and
 * `transitionrun` on `transform` for `#pr-gate-door` is the receipt.
 */
import { test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LABEL = process.env.A0_70_LABEL ?? 'before';

const PROBE = `(() => {
  const log = [];
  window.__a0_70_motion = log;
  const box = (el) => {
    if (!el || !el.getBoundingClientRect) return null;
    const r = el.getBoundingClientRect();
    return [Math.round(r.x*10)/10, Math.round(r.y*10)/10, Math.round(r.width*10)/10, Math.round(r.height*10)/10];
  };
  const idOf = (el) => {
    if (!el || !el.tagName) return String(el);
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className ? '.' + String(el.className) : '');
  };
  for (const type of ['transitionrun','transitionstart','transitionend','transitioncancel','animationstart']) {
    document.addEventListener(type, (e) => {
      log.push({ t: Math.round(performance.now()), type, prop: e.propertyName || e.animationName,
                 target: idOf(e.target), rect: box(e.target),
                 computed: e.target && e.target.nodeType === 1 ? getComputedStyle(e.target).transform : null });
    }, true);
  }

  // The gate overlay's insertion, caught in the boot's own task.
  const start = () => {
    const app = document.getElementById('app');
    if (!app) { requestAnimationFrame(start); return; }
    new MutationObserver((records) => {
      for (const rec of records) {
        for (const node of rec.addedNodes) {
          if (node.nodeType !== 1) continue;
          const door = node.id === 'pr-title-gate' ? node.querySelector('#pr-title-gate-door') : null;
          log.push({ t: Math.round(performance.now()), type: 'inserted', target: idOf(node),
                     rect: box(node),
                     doorRect: box(door),
                     doorComputed: door ? getComputedStyle(door).transform : null,
                     doorScaleVar: node.style ? node.style.getPropertyValue('--pr-gate-door-scale') : null });
          // …and again after a microtask + a task, to catch the value settling.
          queueMicrotask(() => log.push({ t: Math.round(performance.now()), type: 'inserted+micro',
                     target: idOf(node), doorRect: box(door),
                     doorComputed: door ? getComputedStyle(door).transform : null }));
          setTimeout(() => log.push({ t: Math.round(performance.now()), type: 'inserted+task',
                     target: idOf(node), doorRect: box(door),
                     doorComputed: door ? getComputedStyle(door).transform : null }), 0);
        }
      }
    }).observe(app, { childList: true, subtree: false });
  };
  start();
})();`;

test('what actually moves in the first second', async ({ page }) => {
  const url = process.env.A0_70_URL ?? '/';
  const name = process.env.A0_70_NAME ?? 'motion';
  await page.addInitScript(PROBE);
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForTimeout(3000);
  const log = await page.evaluate('window.__a0_70_motion');
  const out = join(HERE, 'frames', LABEL);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${name}.json`), JSON.stringify(log, null, 2));
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(log, null, 2));
});
