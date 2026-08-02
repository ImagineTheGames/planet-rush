/**
 * evidence/probe-actions-offline.mjs — dry-run the `online-actions` mechanics
 * against the OFFLINE door, where a failed attempt costs nothing but time.
 * OWNER: QA Manager.
 *
 * The online capture (`capture-online-actions.mjs`) walks two live clients through
 * the fleet, and a mistake in it — the wrong wedge point, a mining loop that never
 * finds a rock, a wheel that will not open because the ship is not docked — costs a
 * five-minute live round to discover. The sim is the same code offline (GDD §2.4
 * parity), so every one of those questions can be answered against PLAY SOLO first:
 *
 *   1. does E open the Build wheel at spawn, and is the TURRET wedge where the
 *      geometry says it is? (the screenshot answers this, not the seam)
 *   2. does holding fire with AUTO-AIM actually mine ore, and how fast?
 *   3. do two clicks buy two turrets, and how long does one take to appear?
 *
 * It proves nothing about the network — that is the online capture's job. It exists
 * so the online capture is spent on the network and not on geometry.
 *
 * WHY THERE IS NO `?debug=1` HERE, AND NO SEAM READ-BACK ANYWHERE IN THIS ROUND.
 * The first draft of this probe (and of the online capture) asked for both the real
 * front door and the `?debug=1` live-stage seams. THE DEPLOYED BUILD CANNOT GIVE
 * BOTH, and I found that out by running it: `src/main.ts:696` builds the menu only
 * when `flags.debug` is false, and the lobby the same way at :731 — `?debug=1`
 * *skips* the menu and the lobby, which is the harness contract, so under it there
 * is no PLAY, no CREATE ROOM and therefore no online match at all. Enumerated on
 * the deployed ef4babe client:
 *
 *   clean boot   → __buildBadge __mainMenu __onlineMenu __lobby __fullscreen
 *   ?debug=1     → __buildBadge __planetRush __healthbarStage __tapCommanderStage
 *                  __oreHudStage __pressStage __repairStage __minimapStage …
 *
 * A gate about a LIVE two-client match must take the first column, so this round
 * reads back nothing numeric from inside the match. What replaces it is what the
 * game itself hands the player: the pixels, and the COPY LOG export — whose action
 * events (`volley` / `order` / `echo` / `expiry`, src/net/action-journal.ts) are
 * exactly the discrete record the three symptoms are about.
 *
 *   node evidence/probe-actions-offline.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
mkdirSync(OUT, { recursive: true });
const BASE = process.env.EVIDENCE_BASE_URL ?? 'https://imaginethegames.github.io/planet-rush/';
const MINE_MS = Number(process.env.QA_MINE_MS ?? 75_000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE, { waitUntil: 'load', timeout: 60_000 });
await page.waitForSelector('canvas', { state: 'attached', timeout: 60_000 });
await page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, { timeout: 60_000 });
const box = await page.locator('canvas').boundingBox();
const click = async (p) => page.mouse.click(box.x + p.x, box.y + p.y);
const shot = (name) => page.screenshot({ path: join(OUT, `actions-offline-${name}.png`) });
const out = { probe: 'actions-offline-dry-run', base: BASE, capturedAt: new Date().toISOString() };

const point = (list, kind) =>
  page.evaluate(
    ([l, k]) => {
      const c = (window[l]?.[k === 'rush' ? 'rushControl' : 'controls'] ?? []) && null;
      return c;
    },
    [list, kind],
  );

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

// --- FIRE MODE → AUTO-AIM, through the real settings screen. -----------------
// Declared plainly because it is the one thing this run changes about how the
// game plays: a headless client cannot see where a rock is, and ore is how the
// second turret is paid for. It is the shipped default on touch.
await click(await menuPoint('settings'));
await page.waitForFunction(() => window.__mainMenu?.screen === 'settings', undefined, { timeout: 20_000 });
out.settingsControls = await page.evaluate(() => (window.__mainMenu?.settingsControls ?? []).map((c) => c.kind));
const fireRow = await settingsPoint('fireMode');
if (fireRow) {
  await click(fireRow);
  await sleep(400);
  await shot('settings-fire');
}
const back = await settingsPoint('back');
if (back) await click(back);
await page.waitForFunction(() => window.__mainMenu?.screen === 'menu', undefined, { timeout: 20_000 });

// --- PLAY → SOLO → RUSH!, all real clicks. -----------------------------------
await click(await menuPoint('play'));
await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 30_000 });
await click(await doorPoint('solo'));
await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 30_000 });
const rush = await page.evaluate(() => window.__lobby.rushControl.physicalCenter);
await shot('lobby');
await click(rush);
await page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 60_000 });
out.matchStarted = true;
await sleep(3_000);
await shot('spawn');

// --- 1. Does E open the wheel at spawn, and where is TURRET? -----------------
/**
 * `WHEEL_ORDER[0]` is `turret` and segment 0 sits at twelve o'clock
 * (`src/ui/build-wheel.ts` `segmentAngle`); the wheel is centred on the viewport
 * and the outer ring is `clamp(min(w,h) * 0.36, 120, 230)` (`src/ui/hud-geometry.ts`
 * `wheelRadius`), with the words drawn at 0.6 r. The SCREENSHOT is the check on
 * this arithmetic — if the click lands off the word, the frame says so.
 */
const wheelRadius = Math.max(120, Math.min(230, Math.min(box.width, box.height) * 0.36));
const wedge = { x: box.width / 2, y: box.height / 2 - wheelRadius * 0.6 };
out.wheelRadius = wheelRadius;
out.turretWedgePoint = wedge;

await page.keyboard.press('KeyE');
await sleep(700);
await shot('wheel-at-spawn');

// --- 2. One tap: does a turret get ordered, and does it take real time? ------
await click(wedge);
await sleep(400);
await shot('wheel-after-one-tap');
await page.keyboard.press('Escape');
await sleep(300);
const buildT0 = now();
for (const at of [2, 6, 11, 14]) {
  while (now() - buildT0 < at * 1000) await sleep(200);
  await shot(`station-t${at}s`);
}

// --- 3. Does holding fire with AUTO-AIM actually mine? ----------------------
// Walk a slow box around home so new rocks come into range, trigger held down.
await shot('before-mining');
const legs = [
  { k: 'KeyD', ms: 2_200 },
  { k: 'KeyS', ms: 2_200 },
  { k: 'KeyA', ms: 2_200 },
  { k: 'KeyW', ms: 2_200 },
];
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
await page.mouse.down();
const mineEnd = now() + MINE_MS;
let leg = 0;
while (now() < mineEnd) {
  const l = legs[leg % legs.length];
  await page.keyboard.down(l.k);
  await sleep(l.ms);
  await page.keyboard.up(l.k);
  await sleep(500);
  if (leg % 4 === 3) await shot(`mining-${Math.round((now() - (mineEnd - MINE_MS)) / 1000)}s`);
  leg++;
}
await page.mouse.up();
for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) await page.keyboard.up(k).catch(() => {});
await shot('after-mining');

// --- 4. The pause overlay and its COPY LOG button. --------------------------
await page.keyboard.press('Escape');
await sleep(900);
await shot('pause');
out.copyLogButtonPresent = await page.evaluate(() => !!document.querySelector('#playtest-copy-log-button'));
out.copyLogButtonPressable = await page.evaluate(() => {
  const b = document.querySelector('#playtest-copy-log-button');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return el ? (el.id ? `${el.tagName}#${el.id}` : el.tagName) : null;
});
out.pageErrors = errors.slice(0, 10);

writeFileSync(join(OUT, 'actions-offline-dryrun.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
