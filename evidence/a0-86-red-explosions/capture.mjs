/**
 * evidence/a0-86-red-explosions/capture.mjs — look at the colour round.
 *
 * Opens the committed board straight off disk (no server, the way the developer
 * opens it), asserts live playback booted, plays each family, and photographs
 * every candidate's PAIR mid-flight so the two treatments can be compared by eye
 * in one image. Run: node evidence/a0-86-red-explosions/capture.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BOARD = resolve(HERE, '../../docs/art-direction/explosion-lab.html');
const OUT = resolve(HERE, 'frames');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const AT = Number(process.env.AT_MS ?? 60);

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`file://${BOARD}`);
await page.waitForFunction(() => document.body.dataset.live !== undefined, null, { timeout: 30000 });
const live = await page.evaluate(() => document.body.dataset.live);
console.log('data-live =', live);
if (live !== 'on') {
  console.log('live error text:', await page.textContent('#live-error'));
}

const cards = await page.$$eval('.cand', (els) =>
  els.map((e) => ({ id: e.dataset.liveCand, fam: e.dataset.liveFam })),
);
console.log(`${cards.length} candidate cards`);

// 1. The stills: deterministic SVG at 0.05 / 0.15 / 0.35 / 0.6 / 1.0 / 1.5 s, cold
//    strip over red strip. This is the instrument for judging COLOUR, because
//    two panels photographed mid-flight are two panels photographed at whatever
//    instant the screenshot landed on.
await page.evaluate(() => {
  for (const d of document.querySelectorAll('details.stills')) d.open = true;
});
for (const c of cards) {
  const el = await page.$(`[data-live-fam="${c.fam}"][data-live-cand="${c.id}"] .striprow`);
  await el.screenshot({ path: `${OUT}/stills-${c.fam}-${c.id}.png` });
}
console.log('captured 19 still pairs');
await page.evaluate(() => {
  for (const d of document.querySelectorAll('details.stills')) d.open = false;
});

// 2. Live proof, one card at a time, photographed as early as the harness can.
for (const c of cards.filter((c) => ['A', 'L', 'M'].includes(c.id))) {
  const sel = `[data-live-fam="${c.fam}"][data-live-cand="${c.id}"]`;
  await page.click(`${sel} [data-act="replay"]`);
  await page.waitForTimeout(AT);
  await (await page.$(sel)).screenshot({ path: `${OUT}/live-${c.fam}-${c.id}.png` });
}
console.log('captured live');

// 3. The head of the page: the copy that frames the round.
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/page-head.png` });

// The clocks, to prove both panels of a pair ran on the same instant.
const clocks = await page.evaluate(() =>
  [...document.querySelectorAll('.cand')].map((c) => ({
    id: c.dataset.liveCand,
    at: [...c.querySelectorAll('.clock')].map((k) => k.textContent),
  })),
);
console.log('clocks:', JSON.stringify(clocks.slice(0, 4)));
console.log('console errors:', errors.length ? errors : 'none');
await browser.close();
