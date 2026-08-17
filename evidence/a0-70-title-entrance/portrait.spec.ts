/**
 * evidence/a0-70-title-entrance/portrait.spec.ts — OWNER: UI Engineer (a0-71).
 *
 * a0-70 filmed three landscape viewports and closed the case. The developer had
 * already said *"no I'm on mobile, on PC it's fine"*. This probe films the
 * platform that was actually named — a PORTRAIT viewport with `isMobile` true,
 * where `computeRootTransform` takes the rotated branch — and answers the one
 * question the motion log leaves open: **why** the door's
 * `transform:translate(-50%,-50%)` resolves to a zero translation for the whole
 * first second there and not on a desktop.
 *
 * Per animation frame it records, for the door and for the gate root:
 *   - the computed `transform` (the resolved matrix the browser will paint),
 *   - the computed AND layout box (`offsetWidth/Height`, `getComputedStyle`),
 *   - the four custom properties the box and the transform are built out of,
 *   - `document.fonts.status`, because a late web font is the classic thing that
 *     forces the second style recalc a transition needs to have something to
 *     transition FROM.
 *
 * Nothing in `src/` is patched: this reads the shipped client only.
 */
import { test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LABEL = process.env.A0_70_LABEL ?? 'before';
const FRAMES = Number(process.env.A0_71_FRAMES ?? 120);

const PROBE = `(() => {
  const log = [];
  window.__a0_71 = log;
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return [Math.round(r.x*10)/10, Math.round(r.y*10)/10, Math.round(r.width*10)/10, Math.round(r.height*10)/10];
  };
  const describe = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      rect: box(el),
      transform: cs.transform,
      origin: cs.transformOrigin,
      // The USED box the -50% percentages resolve against.
      css: [cs.width, cs.height],
      offset: [el.offsetWidth, el.offsetHeight],
      // …and the four properties the box and the transform are assembled from.
      vars: {
        vw: cs.getPropertyValue('--pr-gate-vw').trim(),
        vh: cs.getPropertyValue('--pr-gate-vh').trim(),
        scale: cs.getPropertyValue('--pr-gate-door-scale').trim(),
        op: cs.getPropertyValue('--pr-gate-door-op').trim(),
      },
    };
  };

  // Transitions, so a frame sample can be read against the event that explains it.
  for (const type of ['transitionrun','transitionstart','transitionend']) {
    document.addEventListener(type, (e) => {
      if (e.target && e.target.id === 'pr-title-gate-door') {
        log.push({ t: Math.round(performance.now()), event: type, prop: e.propertyName,
                   ms: e.elapsedTime, door: describe(e.target) });
      }
    }, true);
  }

  // ── THE BEFORE-CHANGE STYLE ────────────────────────────────────────────────
  // A transition needs two computed values, and the frame loop can only ever see
  // the second one: the first lives inside the boot's own synchronous task. So
  // every write of a \`--pr-gate-*\` custom property is wrapped, and the door's
  // computed transform is read IMMEDIATELY BEFORE the write lands. That reading
  // is, by definition, the value the browser will transition FROM.
  //
  // Reading computed style here forces a style recalc that the shipped client
  // does not force, so this probe is run on its own and never mixed with the
  // frame film's timings — it answers "from what", not "when".
  const writes = [];
  window.__a0_71_writes = writes;
  const setProperty = CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty = function (name, value, prio) {
    if (typeof name === 'string' && name.indexOf('--pr-gate-') === 0 && writes.length < 60) {
      const door = document.getElementById('pr-title-gate-door');
      writes.push({
        t: Math.round(performance.now()), write: name, value: String(value),
        beforeDoorTransform: door ? getComputedStyle(door).transform : null,
        beforeDoorWidth: door ? getComputedStyle(door).width : null,
      });
    }
    return setProperty.call(this, name, value, prio);
  };
  // …and the whole-declaration write \`applyLayout\` makes, which REPLACES the
  // block (custom properties included) before replaying them.
  const cssTextDesc = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'cssText');
  Object.defineProperty(CSSStyleDeclaration.prototype, 'cssText', {
    configurable: true,
    get() { return cssTextDesc.get.call(this); },
    set(v) {
      if (typeof v === 'string' && v.indexOf('--pr-gate-vw') >= 0 && writes.length < 60) {
        const door = document.getElementById('pr-title-gate-door');
        writes.push({
          t: Math.round(performance.now()), write: 'cssText', value: String(v).slice(0, 160),
          beforeDoorTransform: door ? getComputedStyle(door).transform : null,
          beforeDoorWidth: door ? getComputedStyle(door).width : null,
        });
      }
      return cssTextDesc.set.call(this, v);
    },
  });

  let i = 0;
  const MAX = ${FRAMES};
  function sample() {
    const root = document.getElementById('pr-title-gate');
    const door = document.getElementById('pr-title-gate-door');
    log.push({
      i: i++, t: Math.round(performance.now()),
      fonts: document.fonts ? document.fonts.status : 'n/a',
      window: [window.innerWidth, window.innerHeight, window.devicePixelRatio],
      visual: window.visualViewport
        ? [Math.round(window.visualViewport.width), Math.round(window.visualViewport.height),
           Math.round(window.visualViewport.offsetLeft), Math.round(window.visualViewport.offsetTop),
           window.visualViewport.scale]
        : null,
      root: describe(root),
      door: describe(door),
      menu: (() => { try { const m = window.__mainMenu;
        return m ? { rotated: m.rotated, logicalViewport: m.logicalViewport } : null; } catch (e) { return null; } })(),
    });
  }
  function loop() {
    if (i >= MAX) return;
    requestAnimationFrame(() => { setTimeout(() => { sample(); loop(); }, 0); });
  }
  loop();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => log.push({ t: Math.round(performance.now()), event: 'fonts.ready' }));
  }
})();`;

test('the door on a portrait phone, frame by frame', async ({ page }) => {
  const url = process.env.A0_70_URL ?? '/';
  const name = process.env.A0_71_NAME ?? 'portrait-probe';
  await page.addInitScript(PROBE);
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForFunction(`(window.__a0_71 || []).filter(e => e.i !== undefined).length >= ${FRAMES}`, null, {
    timeout: 120_000,
  });
  const log = await page.evaluate('window.__a0_71');
  const writes = await page.evaluate('window.__a0_71_writes');
  const out = join(HERE, 'analysis');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${name}.json`), JSON.stringify(log, null, 2));
  writeFileSync(join(out, `${name}-writes.json`), JSON.stringify(writes, null, 2));
});
