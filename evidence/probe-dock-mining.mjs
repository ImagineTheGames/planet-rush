/**
 * evidence/probe-dock-mining.mjs — can a ship pay for a second turret WITHOUT
 * leaving its station? OWNER: QA Manager.
 *
 * The `online-actions` gate needs two build taps with the ore for both already in
 * hand, and the Build wheel only opens near the player's own station. Two live
 * rounds were lost to the same thing: a ship that thrusts at all drifts out of
 * range and never comes back, because a headless client has no read-back of where
 * it or its station is (see capture-online-actions.mjs, why `?debug=1` is not an
 * option). Both mining patterns tried so far drift —
 *
 *   box of 2.2 s legs   → station in the far corner inside a minute
 *   box of 700 ms legs  → out of range by t+120 s
 *   `+t, −2t, +t` cross → out of range by t+60 s (drag and rock collisions eat
 *                         the symmetry the pattern assumes)
 *
 * — so this asks the only question that removes the problem entirely: with the
 * trigger held, AUTO-AIM on and NO THRUST AT ALL, does the spawn's own rock field
 * come into range and pay out? If it does, the online capture never moves before
 * it builds, and "is the ship docked?" stops being a question.
 *
 * Offline (PLAY SOLO), because the sim is the same code (GDD §2.4 parity) and a
 * wrong answer here costs no live round.
 *
 *   node evidence/probe-dock-mining.mjs [seconds]
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
mkdirSync(OUT, { recursive: true });
const BASE = process.env.EVIDENCE_BASE_URL ?? 'https://imaginethegames.github.io/planet-rush/';
const SECONDS = Number(process.argv[2] ?? 120);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'load', timeout: 60_000 });
await page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, { timeout: 60_000 });
const box = await page.locator('canvas').boundingBox();
const click = async (p) => page.mouse.click(box.x + p.x, box.y + p.y);
const shot = (n) => page.screenshot({ path: join(OUT, `dock-mining-${n}.png`) });
const menuPoint = (kind) =>
  page.evaluate((k) => {
    const c = (window.__mainMenu?.controls ?? []).find((x) => x.kind === k);
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  }, kind);
const settingsPoint = (kind) =>
  page.evaluate((k) => {
    const c = (window.__mainMenu?.settingsControls ?? []).find((x) => x.kind === k);
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  }, kind);
const doorPoint = (kind) =>
  page.evaluate((k) => {
    const c = (window.__onlineMenu?.doorControls ?? []).find((x) => x.kind === k);
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  }, kind);

// FIRE MODE → AUTO-AIM, through the real settings screen.
await click(await menuPoint('settings'));
await page.waitForFunction(() => window.__mainMenu?.screen === 'settings', undefined, { timeout: 20_000 });
await click(await settingsPoint('fireMode'));
await sleep(300);
await click(await settingsPoint('back'));
await page.waitForFunction(() => window.__mainMenu?.screen === 'menu', undefined, { timeout: 20_000 });

await click(await menuPoint('play'));
await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 30_000 });
await click(await doorPoint('solo'));
await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 30_000 });
await click(await page.evaluate(() => window.__lobby.rushControl.physicalCenter));
await page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 60_000 });
await sleep(3_000);
await shot('t000s');

// Trigger down. NOTHING ELSE. No key is ever pressed from here.
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
await page.mouse.down();
const marks = [];
for (let s = 20; s <= SECONDS; s += 20) marks.push(s);
const t0 = Date.now();
for (const at of marks) {
  while (Date.now() - t0 < at * 1000) await sleep(250);
  await shot(`t${String(at).padStart(3, '0')}s`);
}
await page.mouse.up();

// Does the wheel still open? If the ship never moved, it must.
await page.keyboard.press('KeyE');
await sleep(700);
await shot('wheel-after-sitting-still');
await browser.close();
writeFileSync(
  join(OUT, 'dock-mining.json'),
  JSON.stringify({ probe: 'dock-mining', base: BASE, seconds: SECONDS, marks, capturedAt: new Date().toISOString() }, null, 2),
);
console.log(`dock-mining: frames at ${marks.join(', ')}s — read TOTAL off each, and the wheel frame last`);
