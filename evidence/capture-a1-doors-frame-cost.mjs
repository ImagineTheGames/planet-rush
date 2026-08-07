/**
 * evidence/capture-a1-doors-frame-cost.mjs — a1-01, the doors and the CODEX:
 * what they LOOK like and what they COST. OWNER: UI Engineer.
 *
 * The a1-01 regression is not a screen that looks wrong — it is a screen that is
 * too expensive to paint. u7-04 re-skinned THE DOORS and THE CODEX in Gantry/Bone
 * without giving either the `src/ui/screen-cache.ts` treatment every other screen
 * in the set has, so both repainted their whole plate set every frame; on the
 * software-GL CI runner that pegs the page's main thread and Playwright's
 * `page.screenshot` / `waitForFunction` time out. Fifteen tests across four specs,
 * every one of them a timeout rather than an assertion.
 *
 * So a still frame alone cannot show this defect, and a frame time alone cannot
 * show that the fix kept the look. This script captures BOTH in one pass, per
 * profile:
 *
 *   <name>-doors.png              the doors at rest
 *   <name>-doors-coming-soon.png  the CAMPAIGN teaser answered, having navigated
 *                                 nowhere (the u9-01 behaviour, still intact)
 *   <name>-codex.png              the other screen u7-04 re-skinned
 *   frame-cost.json               median rAF delta for each of the above, plus
 *                                 the frozen match as the yardstick
 *
 * Three profiles, because the developer reports these by looking at them on both:
 * desktop, phone held LANDSCAPE, and phone held PORTRAIT — the last one goes
 * through the landscape lock's 90° root rotation, which has stranded a menu
 * off-screen before (the M1 field report).
 *
 * Usage — build and serve the tree you want to shoot FIRST, then:
 *   node evidence/capture-a1-doors-frame-cost.mjs <outDir> [baseUrl]
 * Defaults: outDir /tmp/a1-shots, baseUrl http://localhost:4173
 *
 * The frame times are wall-clock on whatever machine runs this, so only the
 * BEFORE/AFTER ratio on one machine means anything — which is the same reason
 * `tests/mobile/menu-frame-cost.spec.ts` asserts a ratio against the live match
 * rather than a millisecond ceiling.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = process.argv[2] ?? '/tmp/a1-shots';
const BASE = process.argv[3] ?? 'http://localhost:4173';
mkdirSync(OUT, { recursive: true });

/** The mobile suite's own device matrix (tests/mobile/shot-budget.ts), so a frame
 *  here is the frame that suite gates. */
const PROFILES = [
  { name: 'desktop', viewport: { width: 1280, height: 800 }, dsf: 1, touch: false, mobile: false },
  { name: 'phone-landscape', viewport: { width: 844, height: 390 }, dsf: 3, touch: true, mobile: true },
  { name: 'phone-portrait', viewport: { width: 390, height: 844 }, dsf: 3, touch: true, mobile: true },
];

/** Wait N rendered frames rather than N milliseconds — a loaded software-GL host
 *  can draw none at all in 500 ms (tests/mobile/render-settle.ts). */
const settle = async (page, n = 10) => {
  await page.evaluate(
    (count) =>
      new Promise((resolve) => {
        let i = 0;
        const tick = () => (++i >= count ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );
};

/** Median rAF delta over `frames` — the browser's own main-thread frame time, the
 *  same measurement `menu-frame-cost.spec.ts` asserts on. */
const medianFrameMs = async (page, frames = 60) =>
  page.evaluate(async (n) => {
    const deltas = [];
    let last = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        const now = performance.now();
        deltas.push(now - last);
        last = now;
        if (deltas.length >= n) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    deltas.sort((a, b) => a - b);
    return deltas[Math.floor(deltas.length / 2)] ?? 0;
  }, frames);

const bootMenu = async (page) => {
  await page.goto(`${BASE}/`);
  await page.waitForSelector('canvas', { state: 'attached', timeout: 60000 });
  await page.waitForFunction(
    () => {
      const m = window.__mainMenu;
      return !!m && m.visible && m.controls.length > 0 && m.logicalViewport.width > 0;
    },
    undefined,
    { timeout: 60000 },
  );
  await page.evaluate(() => document.fonts?.ready);
  await settle(page, 12);
};

/** Press one of the title screen's plates, then park the pointer: a hovered plate
 *  is a brighter plate, and a hover left under the mouse would both dirty the
 *  frame being measured and put a lit plate in the evidence. */
const pressControl = async (page, kind) => {
  const p = await page.evaluate((k) => {
    const c = window.__mainMenu?.controls.find((x) => x.kind === k);
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  }, kind);
  if (!p) throw new Error(`no menu control ${kind}`);
  await page.mouse.click(Math.round(p.x), Math.round(p.y));
  await page.mouse.move(1, 1);
  await settle(page, 12);
};

const doorPoint = (page, kind) =>
  page.evaluate((k) => {
    const c = window.__onlineMenu?.doorControls.find((x) => x.kind === k);
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  }, kind);

const cost = {};
const browser = await chromium.launch();

for (const profile of PROFILES) {
  const ctx = await browser.newContext({
    viewport: profile.viewport,
    deviceScaleFactor: profile.dsf,
    isMobile: profile.mobile,
    hasTouch: profile.touch,
  });
  const page = await ctx.newPage();
  cost[profile.name] = {};

  // The frozen match first: the yardstick, sampled on this machine in this run.
  // It is the heaviest frame the game legitimately draws, and the fixed point the
  // two menu numbers are only meaningful against.
  await page.goto(`${BASE}/?debug=1&freeze=1`);
  await page.waitForSelector('canvas', { state: 'attached', timeout: 60000 });
  await page.waitForFunction(() => window.__planetRush?.frozen === true, undefined, { timeout: 60000 });
  await settle(page, 20);
  cost[profile.name].match = await medianFrameMs(page);

  // THE DOORS, at rest.
  await bootMenu(page);
  await pressControl(page, 'play');
  await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 60000 });
  await settle(page, 20);
  cost[profile.name].doors = await medianFrameMs(page);
  await page.screenshot({ path: `${OUT}/${profile.name}-doors.png` });

  // …and the CAMPAIGN teaser ANSWERED. The still frame is the point: `Coming Soon…`
  // chalk-bright in the message slot, the four doors still up, no lobby opened.
  const campaign = await doorPoint(page, 'campaign');
  if (campaign) {
    await page.mouse.click(Math.round(campaign.x), Math.round(campaign.y));
    await page.mouse.move(1, 1);
    await page.waitForFunction(() => window.__onlineMenu?.notice !== '', undefined, { timeout: 60000 });
    await settle(page, 12);
    await page.screenshot({ path: `${OUT}/${profile.name}-doors-coming-soon.png` });
  }

  // THE CODEX — a fresh boot, because the doors screen has no route to it.
  await bootMenu(page);
  await pressControl(page, 'codex');
  await page.waitForFunction(() => window.__mainMenu?.screen === 'codex', undefined, { timeout: 60000 });
  await settle(page, 20);
  cost[profile.name].codex = await medianFrameMs(page);
  await page.screenshot({ path: `${OUT}/${profile.name}-codex.png` });

  await ctx.close();
}

await browser.close();

// Ratios alongside the raw numbers: the ratio is what survives being read on a
// different machine, and it is what the CI gate actually asserts.
for (const [name, c] of Object.entries(cost)) {
  c.doorsRatio = +(c.doors / c.match).toFixed(2);
  c.codexRatio = +(c.codex / c.match).toFixed(2);
}
writeFileSync(`${OUT}/frame-cost.json`, `${JSON.stringify(cost, null, 2)}\n`);
// eslint-disable-next-line no-console
console.log(JSON.stringify(cost, null, 2));
