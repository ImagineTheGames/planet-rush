/**
 * tools/a0-103-registry-dump.mjs — read the client's OWN layout registry.
 *
 * The instrument a0-99 was reported off, run headlessly: boot the frozen debug
 * build (`?debug=1&freeze=1`) at three profiles, read
 * `window.__planetRush.layout`, and print every registered element's declared
 * anchor beside the rect it actually drew — plus the two numbers a0-103 is
 * about, the clear space left to the right and bottom edges.
 *
 * Reproduces `evidence/a0-103-anchor-reach/registry-{before,after}.txt`:
 *
 *   npx vite build && npx vite preview --port 4202 --strictPort &
 *   node tools/a0-103-registry-dump.mjs http://localhost:4202 "AFTER — <branch>"
 *
 * Pass `--shot <path>` to also write the 844x390 frame.
 */
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const shotFlag = args.indexOf('--shot');
const shot = shotFlag >= 0 ? args.splice(shotFlag, 2)[1] : null;
const [origin, label = ''] = args;
if (!origin) {
  console.error('usage: node tools/a0-103-registry-dump.mjs <preview-origin> [label] [--shot out.png]');
  process.exit(2);
}

/** The three the evidence pins: QA's own handset, the emulation phone, desktop. */
const PROFILES = [
  { name: 'qa-phone/landscape (a0-99)', w: 798, h: 384, dpr: 3 },
  { name: 'iphone/landscape', w: 844, h: 390, dpr: 3 },
  { name: 'desktop', w: 1280, h: 800, dpr: 1 },
];

const browser = await chromium.launch();
const lines = [label];
for (const p of PROFILES) {
  const ctx = await browser.newContext({
    viewport: { width: p.w, height: p.h },
    deviceScaleFactor: p.dpr,
    isMobile: p.dpr > 1,
    hasTouch: p.dpr > 1,
  });
  const page = await ctx.newPage();
  await page.goto(`${origin}/?debug=1&freeze=1`);
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => window.__planetRush?.frozen === true, null, { timeout: 20_000 });
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(1500);
  const layout = await page.evaluate(() =>
    window.__planetRush.layout.map((e) => ({
      id: e.id,
      region: e.anchor.region,
      margin: e.anchor.margin,
      b: e.bounds,
    })),
  );
  lines.push(`\n${p.name} — ${p.w}x${p.h} @dpr${p.dpr}`);
  lines.push('  id                region          margin   x      y      w      h     right-gap  bottom-gap');
  for (const e of layout) {
    const r = e.b;
    lines.push(
      `  ${e.id.padEnd(17)} ${e.region.padEnd(15)} ${String(e.margin).padEnd(6)} ` +
        `${r.x.toFixed(1).padStart(6)} ${r.y.toFixed(1).padStart(6)} ` +
        `${r.width.toFixed(1).padStart(6)} ${r.height.toFixed(1).padStart(6)}   ` +
        `${(p.w - (r.x + r.width)).toFixed(1).padStart(7)}   ` +
        `${(p.h - (r.y + r.height)).toFixed(1).padStart(8)}`,
    );
  }
  if (shot && p.w === 844) await page.screenshot({ path: shot });
  await ctx.close();
}
await browser.close();
console.log(lines.join('\n'));
