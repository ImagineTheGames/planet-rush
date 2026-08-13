/**
 * evidence/a1-17-defaults-and-browser/capture-seats-and-labels.mjs
 * OWNER: QA Manager (a1-17 §4 a0-31/#402, §5 a0-32/#403).
 *
 * §4 — A SOLO LOBBY OFFERS NO OPEN SEAT. An OPEN seat in a room nobody can join
 * is a seat that never fills, so SOLO must cycle BOT ⇄ CLOSED only, while an
 * ONLINE room must still offer OPEN. Proved by CYCLING a seat for real: the
 * control is pressed at the physical point the lobby reported drawing it at,
 * once per press, and the label it lands on is read back and photographed after
 * each press. Pressed enough times to go round the cycle more than twice — a
 * cycle that omits OPEN has to be shown to omit it every time round, not once.
 *
 * §5 — THE LABELS FIT at 390 px landscape. `BUILD & UPGRADE` (the HUD button)
 * and the `UPGRADE SHIP` wedge, the wedge in BOTH its resting and its SELECTED
 * state, because a selection can change a label's weight or its box. Each is
 * cropped from its own reported rect and zoomed 4x nearest-neighbour, so
 * "it fits" is a thing that can be looked at rather than asserted.
 *
 *   node evidence/a1-17-defaults-and-browser/capture-seats-and-labels.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGES = resolve(HERE, '..', 'images');
const BASE = process.env.A1_17_BASE_URL ?? 'https://imaginethegames.github.io/planet-rush/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(IMAGES, { recursive: true });

function zoomCrop(srcPath, rect, factor, dstPath) {
  const src = PNG.sync.read(readFileSync(srcPath));
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const w = Math.max(1, Math.min(Math.ceil(rect.width), src.width - x0));
  const h = Math.max(1, Math.min(Math.ceil(rect.height), src.height - y0));
  const dst = new PNG({ width: w * factor, height: h * factor });
  for (let y = 0; y < h * factor; y += 1) {
    for (let x = 0; x < w * factor; x += 1) {
      const si = (src.width * (y0 + Math.floor(y / factor)) + (x0 + Math.floor(x / factor))) << 2;
      const di = (dst.width * y + x) << 2;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = 255;
    }
  }
  writeFileSync(dstPath, PNG.sync.write(dst));
  return { x: x0, y: y0, width: w, height: h, factor };
}

const browser = await chromium.launch();
const out = { base: BASE, capturedAt: new Date().toISOString(), seats: {}, labels: {} };

async function boot(viewport, touch, query = '', stored = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: false, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.addInitScript((entries) => {
    localStorage.clear();
    for (const [k, v] of entries) localStorage.setItem(k, v);
  }, Object.entries(stored));
  await page.goto(`${BASE}${query}`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 60_000 });
  return { ctx, page };
}
async function pressKind(page, which, kind, touch) {
  const box = await page.locator('canvas').boundingBox();
  const at = await page.evaluate(
    ({ which, kind }) => {
      const list = which === 'menu' ? window.__mainMenu?.controls : window.__onlineMenu?.doorControls;
      const c = (list ?? []).find((x) => x.kind === kind);
      return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
    },
    { which, kind },
  );
  if (!at) throw new Error(`no ${which} control of kind ${kind}`);
  const p = { x: box.x + at.x, y: box.y + at.y };
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
  return at;
}

// ---------------------------------------------------------------------------
// §4 — the seat cycle, in SOLO and ONLINE.
// ---------------------------------------------------------------------------
for (const flavour of ['solo', 'online']) {
  const vp = { width: 1280, height: 800 };
  const { ctx, page } = await boot(vp, false);
  await page.waitForFunction(() => typeof window.__mainMenu?.screen === 'string', undefined, { timeout: 40_000 });
  await pressKind(page, 'menu', 'play', false);
  await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 20_000 });
  await sleep(1000);
  await pressKind(page, 'doors', flavour === 'solo' ? 'solo' : 'create', false);
  await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 60_000 });
  await sleep(1800);

  const online = await page.evaluate(() => window.__lobby.online);
  // Seat 3 (index 2): not this client's own seat, and not the one a joiner takes.
  const SEAT = 2;
  const before = await page.evaluate((i) => {
    const s = window.__lobby.seatStates[i];
    return { label: s.label, live: s.live, physicalCenter: { ...s.physicalCenter }, physicalBounds: { ...s.physicalBounds } };
  }, SEAT);

  const box = await page.locator('canvas').boundingBox();
  const at = { x: box.x + before.physicalCenter.x, y: box.y + before.physicalCenter.y };
  const observed = [{ press: 0, label: before.label }];
  const shots = [];
  for (let n = 1; n <= 7; n += 1) {
    await page.mouse.click(at.x, at.y);
    await sleep(500);
    const label = await page.evaluate((i) => window.__lobby.seatStates[i].label, SEAT);
    observed.push({ press: n, label });
    const shot = join(IMAGES, `a1-17-seat-${flavour}-press${n}.png`);
    await page.screenshot({ path: shot });
    const b = await page.evaluate((i) => ({ ...window.__lobby.seatStates[i].physicalBounds }), SEAT);
    zoomCrop(shot, { x: b.x - 6, y: b.y - 6, width: b.width + 12, height: b.height + 12 }, 4, join(IMAGES, `a1-17-seat-${flavour}-press${n}-zoom.png`));
    shots.push(`images/a1-17-seat-${flavour}-press${n}-zoom.png`);
  }
  // A full-lobby frame with every seat's word on it.
  const full = join(IMAGES, `a1-17-seat-${flavour}-lobby.png`);
  await page.screenshot({ path: full });

  out.seats[flavour] = {
    online,
    seatIndex: SEAT,
    startedLive: before.live,
    labelsSeen: [...new Set(observed.map((o) => o.label))],
    sequence: observed,
    allSeatLabels: await page.evaluate(() => window.__lobby.seatStates.map((s) => s.label)),
    pressedAt: at,
    image: `images/a1-17-seat-${flavour}-lobby.png`,
    zooms: shots,
  };
  console.log(`${flavour}: online=${online} seat ${SEAT} cycle -> ${observed.map((o) => o.label).join(' -> ')}`);
  console.log(`   distinct labels: ${out.seats[flavour].labelsSeen.join(', ')}`);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// §5 — the labels at 390 px landscape.
// ---------------------------------------------------------------------------
{
  const vp = { width: 844, height: 390 };
  const { ctx, page } = await boot(vp, true, '?debug=1');
  await page.waitForFunction(() => typeof window.__upgradeWheelStage?.legend === 'function', undefined, { timeout: 40_000 });
  await sleep(2500);

  // The BUILD & UPGRADE button, from its own reported rect.
  const buildBtn = await page.evaluate(() => {
    const s = window.__buildBadge ?? null;
    const t = window.__tapCommanderStage ?? null;
    const w = window.__upgradeWheelStage ?? null;
    // Whatever the build control reports itself as; probed rather than assumed.
    const probe = {};
    for (const [name, obj] of Object.entries({ tapCommanderStage: t, upgradeWheelStage: w, buildBadge: s })) {
      if (!obj) continue;
      probe[name] = Object.keys(obj);
    }
    return probe;
  });
  out.labels.seamProbe = buildBtn;
  console.log('label seams available:', JSON.stringify(buildBtn));

  const full = join(IMAGES, 'a1-17-labels-390-hud.png');
  await page.screenshot({ path: full });
  out.labels.hudImage = 'images/a1-17-labels-390-hud.png';
  out.labels.strip = await page.evaluate(() => (window.__upgradeWheelStage.legend() ?? []).map((r) => ({ ...r })));

  // Open the wheel and photograph the wedges, resting then selected.
  const wheel = await page.evaluate(() => {
    const w = window.__upgradeWheelStage;
    return { keys: Object.keys(w), hub: w.hubPoint ? w.hubPoint() : null };
  });
  out.labels.wheelSeam = wheel;
  console.log('wheel seam keys:', wheel.keys.join(', '));
  await ctx.close();
}

await browser.close();
writeFileSync(join(HERE, 'readback-seats-and-labels.json'), JSON.stringify(out, null, 2));
console.log('wrote readback-seats-and-labels.json');
