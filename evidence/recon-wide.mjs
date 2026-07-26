/**
 * evidence/recon-wide.mjs — round-10 recon (NOT a deliverable). Confirms the
 * camera renders 1:1 so a LARGE viewport is a wide-angle view of the natural
 * match (no staging): the local ship idles at home, the camera holds it centred,
 * and a big window shows several bot homes + their turrets at once.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4174';
const W = Number(process.argv[2] ?? 2560), H = Number(process.argv[3] ?? 2560);

async function main() {
  mkdirSync('/tmp/recon', { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__planetRush?.viewport?.width > 0, undefined, { timeout: 30_000 });
  await page.waitForFunction(() => (window.__planetRush?.ticks ?? 0) >= 800, undefined, { timeout: 60_000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  const info = await page.evaluate(() => ({
    vp: window.__planetRush.viewport, sw: window.__planetRush.shipWorld, tick: window.__planetRush.ticks,
    ss: window.__planetRush.shipScreen,
    bars: (window.__healthbarStage?.bars?.() ?? []).map((b) => ({ o: b.owner, x: Math.round(b.x), y: Math.round(b.y), f: +b.fraction.toFixed(2), local: b.local })),
    cores: Array.from({ length: 8 }, (_, p) => window.__planetRush.coreHp(p)),
  }));
  console.log('info:', JSON.stringify(info, null, 2));
  await page.screenshot({ path: '/tmp/recon/wide.png' });
  console.log('saved /tmp/recon/wide.png', W + 'x' + H);
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
