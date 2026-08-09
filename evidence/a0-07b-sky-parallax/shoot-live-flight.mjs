/**
 * evidence/a0-07b-sky-parallax/shoot-live-flight.mjs — the same flight, through
 * the real renderer. OWNER: Art Agent (a0-07b).
 *
 * The LIVE half of the a0-07b evidence. `render-parallax-strip.ts` proves the
 * geometry with nothing else moving; this proves the shipped build, on a
 * landscape phone, with the sim running and everything else in the frame moving
 * too — which is the condition the developer reported the bug from.
 *
 * One straight flight, three camera positions, two builds:
 *
 *   - the ship is flown **due east** with a held key (real input through the real
 *     funnel — no teleport seam exists and none is invented here), and a frame is
 *     taken as it passes three world-x marks read off `__planetRush.shipWorld`.
 *     The camera is 1:1 and follows the ship, so those marks ARE three camera
 *     positions along a straight line.
 *   - `AFTER` is this branch's bundle; `BEFORE` is a preview of `origin/main`.
 *     Two ports, two builds — `verify-served-build.mjs` reads each one back
 *     before a shot is trusted, because a shared box and a reused preview server
 *     is exactly how a3-01 nearly published a frame of somebody else's bundle.
 *
 * The maps are the two the brief names: The Oval (Plasma Reef — the most
 * object-like sky) and The Line (Deep Ember — a sparse one). The map comes from
 * `localStorage['planet-rush:mapId']`, which is where the boot reads it under
 * `?debug=1`.
 *
 *   node evidence/a0-07b-sky-parallax/shoot-live-flight.mjs [afterPort] [beforePort]
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'frames');
const AFTER_PORT = process.argv[2] ?? '4272';
const BEFORE_PORT = process.argv[3] ?? '4273';
const AFTER = `http://localhost:${AFTER_PORT}`;
const BEFORE = `http://localhost:${BEFORE_PORT}`;

/** The landscape phone, as a0-07 shot it — the game is landscape-locked (GDD §4.6). */
const PHONE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

/** The two skies the brief names, on the maps that fly under them. */
const CASES = [
  // `dir`: +1 flies east, −1 west. The local home on The Oval sits at x ≈ 2820 of
  // 3200, so east is a wall 380 u away and the flight has to run the other way.
  { sky: 'plasmaReef', name: 'Plasma Reef', map: 'oval', why: 'the most object-like sky', dir: -1 },
  { sky: 'deepEmber', name: 'Deep Ember', map: 'line', why: 'a sparse one', dir: +1 },
];

/**
 * How far along the flight each of the three frames is taken, in world units.
 *
 * Short on purpose. This is a LIVE match with bots in it: at 840 u the local
 * ship was dead before the third frame and the shot came back with a RESPAWNING
 * plate across it. 600 u is still two thirds of a screen-width of camera travel
 * — 30 px of sky at the old parallax, 51 at the new — and it gets there before
 * the fight does.
 */
const MARKS = [0, 300, 600];

/**
 * The window the detail row zooms, in CSS px of the 844x390 frame: a band of
 * open void between the top HUD bar (ends y≈60) and the hint banner (starts
 * y≈205), so nothing but the world and the sky is in it. At page scale the sky is
 * a whisper (peak luma 17 of 255, by design — a0-07 "subtle"); this is what
 * makes it something a reader can actually look at.
 */
const CROP = { x: 300, y: 85, w: 420, h: 115, zoom: 2.2 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(page, url) {
  await page.goto(url);
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => !!window.__planetRush?.shipWorld, undefined, { timeout: 20_000 });
  await page.evaluate(() => document.fonts?.ready);
  // Settle by counting frames, not by timing them — a loaded software-GL box can
  // still be mid-draw when a clock says it should be finished (the q8 lesson).
  await page.evaluate(
    () =>
      new Promise((done) => {
        let n = 0;
        const tick = () => (++n < 10 ? requestAnimationFrame(tick) : done());
        requestAnimationFrame(tick);
      }),
  );
}

const shipX = (page) => page.evaluate(() => window.__planetRush.shipWorld.x);

/**
 * Fly until the ship is at least `target` units from `x0` in `dir` (+1 east,
 * −1 west), or give up.
 *
 * The direction is chosen per flight rather than fixed, and that is not
 * fussiness: the local home on The Oval sits at x ≈ 2820 on a 3200-unit board,
 * so a fixed "fly east" pinned the ship against the arena wall at 3184 and the
 * second and third frames came back identical — three camera positions that
 * were really two. The wall is a real edge of the world; the fix is to fly the
 * other way, not to fly into it harder.
 */
async function flyTo(page, x0, dir, target, budgetMs = 30_000) {
  if (target <= 0) return shipX(page);
  const key = dir > 0 ? 'KeyD' : 'KeyA';
  const deadline = Date.now() + budgetMs;
  await page.keyboard.down(key);
  let x = await shipX(page);
  while ((x - x0) * dir < target && Date.now() < deadline) {
    await sleep(80);
    x = await shipX(page);
  }
  await page.keyboard.up(key);
  // Let the frame settle after the key is released, so the shot is not taken
  // mid-input; the ship coasts a little, which is fine — the mark is recorded.
  await page.evaluate(
    () =>
      new Promise((done) => {
        let n = 0;
        const tick = () => (++n < 4 ? requestAnimationFrame(tick) : done());
        requestAnimationFrame(tick);
      }),
  );
  return shipX(page);
}

async function flight(browser, origin, build, c, dir) {
  const ctx = await browser.newContext(PHONE);
  await ctx.addInitScript((id) => {
    try {
      localStorage.setItem('planet-rush:mapId', id);
    } catch {
      /* storage disabled — the boot falls back to the default map */
    }
  }, c.map);
  const page = await ctx.newPage();
  await boot(page, `${origin}/?debug=1`);
  const x0 = await shipX(page);
  const shots = [];
  for (let i = 0; i < MARKS.length; i++) {
    const at = await flyTo(page, x0, dir, MARKS[i]);
    const name = `2-live-${c.sky}-${build}-${i + 1}.png`;
    await page.screenshot({ path: join(OUT, name) });
    shots.push({ name, worldX: Math.round(at), flown: Math.round((at - x0) * dir) });
    console.log(`  ${name}   ship x=${Math.round(at)} (${Math.round((at - x0) * dir)} u flown)`);
  }
  await ctx.close();
  return shots;
}

const CSS = `
  body { margin: 0; padding: 28px 24px 34px; background: #14181d; color: #b9c2cc;
         font-family: 'Oxanium', ui-monospace, monospace; }
  h1 { font-size: 19px; margin: 0 0 4px; color: #4DC3FF; font-weight: 600; }
  .lede { font-size: 12.5px; margin: 0 0 22px; max-width: 2560px; line-height: 1.55; color: #8b96a3; }
  .lede b { color: #b9c2cc; }
  h2 { font-size: 14px; margin: 20px 0 8px; color: #e7edf3; font-weight: 600; }
  h2 .sub { color: #7E8894; font-weight: 400; font-size: 12px; }
  .strip { display: flex; gap: 14px; }
  figure { margin: 0; }
  figure img { display: block; width: 844px; height: 390px; border: 1px solid #2b333c; }
  figcaption { font-size: 11px; line-height: 1.5; padding-top: 6px; color: #8b96a3; }
  figcaption b { color: #cfd7e0; font-weight: 600; }
  h3 { font-size: 11.5px; margin: 14px 0 6px; color: #7E8894; font-weight: 400; }
  .crop { overflow: hidden; border: 1px solid #39424c; }
  .crop img { border: 0; }
`;

const LABEL = ['start', 'middle', 'end'];

/** One frame, cropped to {@link CROP} and zoomed, as plain CSS over the same PNG. */
const cropHtml = (name) => `<div class="crop" style="width:${CROP.w * CROP.zoom}px;height:${CROP.h * CROP.zoom}px">
  <img src="${name}" style="width:${844 * CROP.zoom}px;height:${390 * CROP.zoom}px;
       margin-left:${-CROP.x * CROP.zoom}px;margin-top:${-CROP.y * CROP.zoom}px"/>
</div>`;

const rowHtml = (title, sub, shots) => `<section>
  <h2>${title} <span class="sub">${sub}</span></h2>
  <div class="strip">${shots
    .map(
      (s, i) => `<figure><img src="${s.name}"/><figcaption>
        <b>${LABEL[i]}</b> — ship at world x = ${s.worldX} u (${s.flown} u flown)
      </figcaption></figure>`,
    )
    .join('')}</div>
  <h3>the same three frames, 2x on the open band between the HUD bars (x ${CROP.x}-${CROP.x + CROP.w}, y ${CROP.y}-${CROP.y + CROP.h}) — the sky is a whisper by design, so it needs the zoom</h3>
  <div class="strip">${shots.map((s, i) => `<figure>${cropHtml(s.name)}<figcaption>${LABEL[i]}</figcaption></figure>`).join('')}</div>
</section>`;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const index = [];
for (const c of CASES) {
  console.log(`\n${c.name} on ${c.map} — ${c.why}:`);
  console.log('  BEFORE (origin/main, parallax 0.05):');
  const before = await flight(browser, BEFORE, 'before', c, c.dir);
  console.log('  AFTER (this branch, parallax 0.085):');
  const after = await flight(browser, AFTER, 'after', c, c.dir);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
    <h1>${c.name} — one straight flight, the real build, before and after (a0-07b)</h1>
    <p class="lede">
      ${c.why}, on <b>${c.map}</b>, landscape phone 844×390 at dpr 3, <b>?debug=1</b> with the sim running:
      the ship is flown in a straight line on a held key (${c.dir > 0 ? 'east' : 'west'}, whichever side of
      this board has room) and a frame is taken at the start, ${MARKS[1]} u along and ${MARKS[2]} u along. Everything in the world moves a full 1 px per unit flown; the far star field moves
      0.10 of that. The question is only what the sky does between the three frames — and whether it
      stays with the stars or with the ship.
    </p>
    ${rowHtml('BEFORE — origin/main, parallax 0.05', 'the build the developer reported', before)}
    ${rowHtml('AFTER — this branch, parallax 0.085', 'the sky travels with the far star field', after)}
  </body></html>`;
  const file = join(OUT, `live-${c.sky}.html`);
  writeFileSync(file, html);
  const ctx = await browser.newContext({ viewport: { width: 2680, height: 1400 }, deviceScaleFactor: 1 });
  const tab = await ctx.newPage();
  await tab.goto(`file://${file}`);
  await tab.waitForLoadState('load');
  await sleep(400);
  const name = `3-live-${c.sky}-before-vs-after.png`;
  await tab.screenshot({ path: join(OUT, name), fullPage: true });
  await ctx.close();
  console.log(`  ${name}`);
  index.push({ sky: c.sky, map: c.map, before, after, composite: name });
}
writeFileSync(join(OUT, 'live-index.json'), `${JSON.stringify({ after: AFTER, before: BEFORE, cases: index }, null, 2)}\n`);
await browser.close();
