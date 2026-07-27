/**
 * evidence/capture-controls-setting.mjs — v0.2.4 evidence: "choose Tap Commander in
 * SETTINGS, through the FRONT DOOR". OWNER: QA Manager.
 *
 * The p6-03 gate before this one flipped the scheme through the __tapCommanderStage
 * debug seam — a SIDE DOOR — so a MISSING settings row read as present. This walks
 * the WHOLE path with REAL clicks at the client's own reported control points and
 * reads back only plain state (never a hit-test or a scheme seam). It uses the
 * clean-boot __mainMenu seam (present WITHOUT ?debug=1 — the menu instrument), whose
 * `settingsControls`/`controls` report the physical press point of each real drawn
 * control, and whose `controlScheme` / `matchControlScheme` / `localShipPos` are pure
 * readbacks. Mirrors tests/live-stage/main-menu.spec.ts.
 *
 *   boot /  ->  real-click SETTINGS  ->  settings screen (CONTROLS row = STICKS)
 *           ->  real-click the CONTROLS row  ->  CONTROLS = TAP COMMANDER (persists)
 *           ->  DONE -> PLAY -> lobby -> RUSH!  ->  match drives with Tap Commander
 *           ->  a real empty-space tap MOVES the ship (localShipPos travels)
 *
 * Three frames: the SETTINGS screen with the CONTROLS row; Tap Commander seated;
 * the ship moved by a real tap (waypoint marker + the world scrolled under the
 * camera-centred ship). Every claim is read back, then LOOKED AT.
 *
 * Usage: EVIDENCE_BASE_URL=http://localhost:4191 node evidence/capture-controls-setting.mjs
 * Launch under the sandboxed-Chromium LD_LIBRARY_PATH (see the QA memory).
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const TMP = '/tmp/capctrl';
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4191';
const VP = { width: 1280, height: 800 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

function stitchV(paths, outPath, gap = 8, bg = [12, 14, 18]) {
  const imgs = paths.map((p) => PNG.sync.read(readFileSync(p)));
  const w = Math.max(...imgs.map((i) => i.width));
  const h = imgs.reduce((s, i) => s + i.height, 0) + gap * (imgs.length - 1);
  const out = new PNG({ width: w, height: h });
  for (let i = 0; i < out.data.length; i += 4) { out.data[i] = bg[0]; out.data[i + 1] = bg[1]; out.data[i + 2] = bg[2]; out.data[i + 3] = 255; }
  let oy = 0;
  for (const im of imgs) {
    const xo = Math.floor((w - im.width) / 2);
    for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
      const si = (y * im.width + x) * 4, di = ((oy + y) * w + (xo + x)) * 4;
      out.data[di] = im.data[si]; out.data[di + 1] = im.data[si + 1]; out.data[di + 2] = im.data[si + 2]; out.data[di + 3] = 255;
    }
    oy += im.height + gap;
  }
  writeFileSync(outPath, PNG.sync.write(out));
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

await page.goto(BASE + '/', { waitUntil: 'load' }); // CLEAN boot — the front door
await page.waitForSelector('canvas', { state: 'attached', timeout: 30000 });
await page.waitForFunction(() => typeof window.__mainMenu?.play === 'function', undefined, { timeout: 20000 });
await page.evaluate(() => document.fonts?.ready).catch(() => {});

const box = await page.locator('canvas').boundingBox();
const origin = { x: box.x, y: box.y };
const pointOf = (list, kind) => page.evaluate(({ list, kind }) => {
  const c = (window.__mainMenu?.[list] ?? []).find((x) => x.kind === kind);
  return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
}, { list, kind });
const clickCtl = async (list, kind) => {
  const p = await pointOf(list, kind);
  if (!p) throw new Error(`no ${list} control '${kind}'`);
  await page.mouse.click(origin.x + p.x, origin.y + p.y);
};
const menuState = () => page.evaluate(() => {
  const m = window.__mainMenu;
  return { screen: m?.screen, controlScheme: m?.controlScheme, matchControlScheme: m?.matchControlScheme, matchStarted: m?.matchStarted, localShipPos: m?.localShipPos ?? null };
});

const boot = await menuState();
const sha = await page.evaluate(() => (window.__mainMenu ? null : null)); // sha lives on __planetRush (absent); use git sha in manifest
console.log('BOOT', JSON.stringify(boot));
if (boot.controlScheme !== 'sticks') throw new Error(`default scheme not sticks: ${boot.controlScheme}`);

// FRAME 1 — real-click SETTINGS, capture the settings screen with CONTROLS = STICKS.
await clickCtl('controls', 'settings');
await page.waitForFunction(() => window.__mainMenu?.screen === 'settings', undefined, { timeout: 10000 });
await sleep(300);
const s1 = await menuState();
await page.screenshot({ path: join(TMP, 'f1-settings-sticks.png') });

// FRAME 2 — real-click the CONTROLS row → flips to TAP COMMANDER (persists).
await clickCtl('settingsControls', 'controls');
await page.waitForFunction(() => window.__mainMenu?.controlScheme === 'tap', undefined, { timeout: 10000 });
await sleep(300);
const s2 = await menuState();
const persisted = await page.evaluate(() => localStorage.getItem('planet-rush:controlScheme'));
await page.screenshot({ path: join(TMP, 'f2-settings-tap.png') });

// DONE → PLAY → lobby → RUSH → match.
await clickCtl('settingsControls', 'back');
await page.waitForFunction(() => window.__mainMenu?.screen === 'menu', undefined, { timeout: 10000 });
await clickCtl('controls', 'play');
await page.waitForFunction(() => typeof window.__lobby?.rush === 'function', undefined, { timeout: 20000 });
const rush = await page.evaluate(() => { const c = window.__lobby.rushControl.physicalCenter; return { x: c.x, y: c.y }; });
await page.mouse.click(origin.x + rush.x, origin.y + rush.y);
await page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 20000 });
await page.waitForFunction(() => window.__mainMenu?.matchControlScheme === 'tap', undefined, { timeout: 10000 });
await sleep(600);

// FRAME 3 — a real empty-space tap MOVES the ship.
const ship0 = await page.evaluate(() => window.__mainMenu.localShipPos);
const cbox = await page.locator('canvas').boundingBox();
const cx = cbox.x + cbox.width / 2, cy = cbox.y + cbox.height / 2;
await page.screenshot({ path: join(TMP, 'f3-before-tap.png') });
const tapX = Math.round(cx), tapY = Math.round(cy - cbox.height * 0.22); // straight up, open space
await page.mouse.click(tapX, tapY);
await sleep(120);
await page.screenshot({ path: join(TMP, 'f3-marker.png') }); // marker fresh, ship starting to move
await page.waitForFunction((start) => {
  const p = window.__mainMenu?.localShipPos;
  return p && start && Math.hypot(p.x - start.x, p.y - start.y) > 30;
}, ship0, { timeout: 8000 });
// Keep flying so the displacement is unmistakable in the frame (marker still up
// while the ship is well clear of its start). Stop at a clear distance or a cap.
await page.waitForFunction((start) => {
  const p = window.__mainMenu?.localShipPos;
  return p && start && Math.hypot(p.x - start.x, p.y - start.y) > 130;
}, ship0, { timeout: 8000 }).catch(() => {});
const ship1 = await page.evaluate(() => window.__mainMenu.localShipPos);
await page.screenshot({ path: join(TMP, 'f3-moved.png') });

const dist = Math.hypot(ship1.x - ship0.x, ship1.y - ship0.y);
// Promote frames + a three-frame strip (settings-sticks, settings-tap, moved).
for (const [src, dst] of [['f1-settings-sticks', 'controls-1-settings-sticks'], ['f2-settings-tap', 'controls-2-settings-tap'], ['f3-marker', 'controls-3-tap-marker'], ['f3-moved', 'controls-3-ship-moved']])
  writeFileSync(join(OUT, `${dst}.png`), readFileSync(join(TMP, `${src}.png`)));
stitchV([join(TMP, 'f1-settings-sticks.png'), join(TMP, 'f2-settings-tap.png'), join(TMP, 'f3-moved.png')], join(OUT, 'controls-setting-strip.png'));

const summary = { boot, s1, s2, persisted, ship0, ship1, moveDist: +dist.toFixed(1), tapScreen: { x: tapX, y: tapY }, canvasCenter: { x: Math.round(cx), y: Math.round(cy) }, errs: errs.slice(0, 6) };
writeFileSync(join(TMP, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('SUMMARY', JSON.stringify(summary, null, 2));
await browser.close();
