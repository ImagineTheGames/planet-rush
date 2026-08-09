/**
 * evidence/a2-04-no-hull-turrets/capture-frames.mjs — shoot the four frames.
 * OWNER: Art Agent (brief a2-04).
 *
 * Loads `frames.html` (which drives the SHIPPED renderer against the SHIPPED
 * sim — see its header), waits for every panel, and writes one PNG per panel
 * plus a strip of all four. It also reads each panel's `data-turrets` back off
 * the DOM and prints it, so the caption under each picture is the simulation's
 * own count rather than a label someone typed.
 *
 * Usage:  node evidence/a2-04-no-hull-turrets/capture-frames.mjs
 * Needs a `vite` dev server on $EVIDENCE_BASE_URL (default http://localhost:5199).
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, process.env.OUT ?? 'frames');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:5199';
const URL = `${BASE}/evidence/a2-04-no-hull-turrets/frames.html`;
const DSF = 2;

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1720, height: 520 }, deviceScaleFactor: DSF });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.error('PAGE ERROR:', m.text()); });
page.on('pageerror', (e) => console.error('PAGE THREW:', e.message));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('body[data-ready="1"]', { timeout: 30_000 });
await page.evaluate(() => document.fonts?.ready).catch(() => {});

const panels = await page.$$eval('.panel', (els) =>
  els.map((el) => ({ id: el.id, turrets: Number(el.dataset.turrets), caption: el.querySelector('figcaption').textContent })));

for (const p of panels) {
  const el = await page.$(`#${p.id}`);
  await el.screenshot({ path: join(OUT, `${p.id.replace('panel-', '')}.png`) });
  console.log(`${p.id.padEnd(16)} sim turret count = ${p.turrets}   "${p.caption}"`);
}
await page.screenshot({ path: join(OUT, 'strip.png'), fullPage: true });
writeFileSync(join(OUT, 'panels.json'), JSON.stringify(panels, null, 2) + '\n');

await browser.close();
console.log(`\nwrote ${panels.length} panels + strip.png to ${OUT}`);
