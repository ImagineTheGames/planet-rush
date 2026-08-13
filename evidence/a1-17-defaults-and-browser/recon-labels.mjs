/** Recon only — how does the served build report the BUILD & UPGRADE button and
 *  the UPGRADE SHIP wedge at 390 px? Not evidence; it takes no attested pictures. */
import { chromium } from 'playwright';

const BASE = process.env.A1_17_BASE_URL ?? 'https://imaginethegames.github.io/planet-rush/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.addInitScript(() => localStorage.clear());
await page.goto(`${BASE}?debug=1`, { waitUntil: 'load' });
await page.waitForSelector('canvas', { state: 'attached', timeout: 60_000 });
await page.waitForFunction(() => typeof window.__upgradeWheelStage?.wedges === 'function', undefined, { timeout: 40_000 });
await sleep(2500);

console.log('layout registry:', JSON.stringify(await page.evaluate(() => {
  const l = window.__planetRush?.layout;
  if (!l) return null;
  return typeof l === 'function' ? 'function' : Object.keys(l);
})));
console.log('layout ids:', JSON.stringify(await page.evaluate(() => {
  const l = window.__planetRush?.layout;
  if (!l) return null;
  try { return typeof l.all === 'function' ? l.all() : l; } catch (e) { return String(e); }
})).slice(0, 1200));

console.log('tapCommander readout:', JSON.stringify(await page.evaluate(() => {
  try { return window.__tapCommanderStage.buildReadout(); } catch (e) { return String(e); }
})));
console.log('wheelState:', JSON.stringify(await page.evaluate(() => {
  try { return window.__tapCommanderStage.wheelState(); } catch (e) { return String(e); }
})));

console.log('openBuild:', await page.evaluate(() => window.__upgradeWheelStage.openBuild()));
await sleep(900);
console.log('wedges:', JSON.stringify(await page.evaluate(() => window.__upgradeWheelStage.wedges())).slice(0, 1500));
console.log('wedgePoints:', JSON.stringify(await page.evaluate(() => {
  const n = window.__upgradeWheelStage.wedges().length;
  return Array.from({ length: n }, (_, i) => window.__upgradeWheelStage.wedgePoint(i));
})));
await page.screenshot({ path: '/tmp/recon-wheel-390.png' });
await browser.close();
