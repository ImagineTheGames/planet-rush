/**
 * evidence/capture-wheel-back.mjs — v0.2.4 evidence: "the hub BACK gesture pops the
 * wheel one level at a time, never bounces". OWNER: QA Manager.
 *
 * REAL input on the live build (?debug=1, no freeze). The seam is used ONLY to place
 * the ship docked + funded (scene staging); EVERY navigation is a genuine E press /
 * pointer click / hub tap the client's own pointer handler hit-tests. The flow the
 * developer walks:
 *   E -> BUILD wheel  ->(click UPGRADE SHIP)->  UPGRADE main wheel
 *                     ->(click WEAPON)->        WEAPON sub-wheel
 * then BACK by REAL taps on the wheel HUB (dead centre = the BACK/ESC affordance):
 *   WEAPON sub  --hub tap-->  UPGRADE main  --hub tap-->  BUILD  --hub tap-->  closed
 *
 * Four frames, one per back state, each read back off the wheel's own debug capture
 * so the pixels and the state are the same source:
 *   __upgradeWheelStage.wedges()  — the wedge labels the view drew this frame
 *   __upgradeWheelStage.interactive() — whether a wheel is up and taking input
 *   (WEAPON sub = [DAMAGE,SPEED]; UPGRADE main = [WEAPON,ENGINE,CARGO,HULL];
 *    BUILD wheel wedges are TURRET/SHIELD/REPAIR/UPGRADE SHIP — a different set, so
 *    the UPGRADE seam reads [] there but interactive() is still true; closed = []
 *    AND interactive() false.)
 *
 * Usage: EVIDENCE_BASE_URL=http://localhost:4191 node evidence/capture-wheel-back.mjs
 * Launch under the sandboxed-Chromium LD_LIBRARY_PATH (see the QA memory).
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const TMP = '/tmp/capwheelback';
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4191';
const VP = { width: 1280, height: 800 };
const DSF = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

const P = {
  upgradeShip: { x: 502, y: 400 }, // build wheel, 180deg
  weapon: { x: 640, y: 262 },      // upgrade main wheel, -90deg
};
const HUB = { x: 640, y: 400 };
const WHEEL_CLIP = { x: 300, y: 150, width: 680, height: 520 };

function stitchV(paths, outPath, gap = 6, bg = [12, 14, 18]) {
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
const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: DSF });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
await page.waitForSelector('canvas', { state: 'attached', timeout: 30000 });
await page.waitForFunction(() => typeof window.__upgradeWheelStage?.openUpgrade === 'function', undefined, { timeout: 20000 });
await page.evaluate(() => document.fonts?.ready).catch(() => {});

const wedges = () => page.evaluate(() => window.__upgradeWheelStage.wedges().map((w) => w.label));
const interactive = () => page.evaluate(() => window.__upgradeWheelStage.interactive());
const sha = await page.evaluate(() => window.__planetRush.build.sha);

// Stage docked + funded, then CLOSE so the following opens are real input.
await page.evaluate(() => { window.__upgradeWheelStage.openUpgrade(120); });
await sleep(150);
await page.evaluate(() => window.__upgradeWheelStage.close());
await sleep(200);

// FORWARD (real input): E -> build -> UPGRADE SHIP -> upgrade -> WEAPON -> sub.
await page.keyboard.press('KeyE');
await sleep(300);
const buildOpenWedges = await wedges();
await page.mouse.click(P.upgradeShip.x, P.upgradeShip.y);
await sleep(300);
const upgradeWedges0 = await wedges();
await page.mouse.click(P.weapon.x, P.weapon.y);
await sleep(300);

// FRAME 1 — WEAPON sub-wheel (deepest).
const f1 = { level: 'weapon-sub', wedges: await wedges(), interactive: await interactive() };
await page.screenshot({ path: join(TMP, 'f1-weapon.png'), clip: WHEEL_CLIP });

// BACK #1 (real hub tap) -> UPGRADE main.
await page.mouse.click(HUB.x, HUB.y);
await sleep(300);
const f2 = { level: 'upgrade-main', wedges: await wedges(), interactive: await interactive() };
await page.screenshot({ path: join(TMP, 'f2-upgrade.png'), clip: WHEEL_CLIP });

// BACK #2 (real hub tap) -> BUILD wheel.
await page.mouse.click(HUB.x, HUB.y);
await sleep(300);
const f3 = { level: 'build', wedges: await wedges(), interactive: await interactive() };
await page.screenshot({ path: join(TMP, 'f3-build.png'), clip: WHEEL_CLIP });

// BACK #3 (real hub tap) -> CLOSED.
await page.mouse.click(HUB.x, HUB.y);
await sleep(300);
const f4 = { level: 'closed', wedges: await wedges(), interactive: await interactive() };
await page.screenshot({ path: join(TMP, 'f4-closed.png'), clip: WHEEL_CLIP });
await page.screenshot({ path: join(TMP, 'f4-closed-full.png') });

// Promote frames + a stacked strip.
for (const [src, dst] of [['f1-weapon', 'wheel-back-1-weapon'], ['f2-upgrade', 'wheel-back-2-upgrade'], ['f3-build', 'wheel-back-3-build'], ['f4-closed', 'wheel-back-4-closed']])
  writeFileSync(join(OUT, `${dst}.png`), readFileSync(join(TMP, `${src}.png`)));
writeFileSync(join(OUT, 'wheel-back-closed-full.png'), readFileSync(join(TMP, 'f4-closed-full.png')));
stitchV(['f1-weapon', 'f2-upgrade', 'f3-build', 'f4-closed'].map((n) => join(TMP, `${n}.png`)), join(OUT, 'wheel-back-strip.png'));

const summary = { sha, buildOpenWedges, upgradeWedges0, frames: [f1, f2, f3, f4], errs: errs.slice(0, 5) };
writeFileSync(join(TMP, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('SUMMARY', JSON.stringify(summary, null, 2));
await browser.close();
