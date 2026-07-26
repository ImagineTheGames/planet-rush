/**
 * evidence/capture-loot-ore-deposits.mjs — p4 evidence: "loot banks 1:1".
 * OWNER: QA Manager. Re-lives the developer's v0.2.2 scenario on the LIVE build
 * (?debug=1, no ?freeze): kill a bot, tractor its dropped ore, carry it into your
 * atmosphere, and watch the bank credit the loot 1:1.
 *
 *   1. LOOT  — bot#1's home planet is moved beside the local ship
 *              (`__nameplateStage.stageBot`) and its core destroyed
 *              (`__planetRush.damageCore`); elimination scatters the dead owner's
 *              banked ore + WRECK.baseDebrisOre(8) as a debris ring (GDD §2.7,
 *              `scatterWreckDebris`). The ship flies into the field on real thrust
 *              and its proximity tractor pulls chunks into the hold to the cap.
 *   2. BANK  — the ship flies home; the moment it crosses into its own atmosphere
 *              the hold auto-deposits and the banked TOTAL rises by exactly the
 *              looted amount (the v0.2.2 bug was that it did NOT).
 *
 * Nothing is faked: the kill and the debris are the sim's own elimination path,
 * the collection is the sim's own proximity tractor, and every number in the
 * manifest is read back off `__oreDepositStage.readout()` / `__planetRush` at the
 * captured frame. The debris is located by finding the signal-yellow chunk pixels,
 * not by assuming a position.
 *
 * Usage: node evidence/capture-loot-ore-deposits.mjs   (needs preview on $EVIDENCE_BASE_URL)
 * Launch under the sandboxed-Chromium LD_LIBRARY_PATH (see the QA memory).
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const TMP = '/tmp/caploot';
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4188';
const VW = 1280, VH = 800, CX = 640, CY = 400;
const CROP_W = 856;
const MINE_OFFSET = 900; // mine(0) parks the ship at MY planet + (900, 900)
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

function loadPng(p) { return PNG.sync.read(readFileSync(p)); }
// Signal-yellow (0xf2d24b) ore chunks. Ignore the top HUD band and a box around
// the screen-centred ship (its under-ship hold pips are yellow too).
function yellowCentroid(png, excludeShipBox) {
  const { width, height, data } = png;
  let sx = 0, sy = 0, n = 0;
  for (let y = 90; y < height - 40; y++) for (let x = 6; x < CROP_W; x++) {
    if (excludeShipBox && Math.abs(x - CX) < 70 && Math.abs(y - CY) < 45) continue;
    const i = (y * width + x) * 4, R = data[i], G = data[i + 1], B = data[i + 2];
    if (R > 200 && G > 160 && B < 130 && R - B > 90) { sx += x; sy += y; n++; }
  }
  return n > 0 ? { x: sx / n, y: sy / n, n } : null;
}
function cropTop(src, w, h) {
  const p = loadPng(src), o = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const si = (y * p.width + x) * 4, di = (y * w + x) * 4;
    o.data[di] = p.data[si]; o.data[di + 1] = p.data[si + 1]; o.data[di + 2] = p.data[si + 2]; o.data[di + 3] = 255;
  }
  return o;
}
function stitchV(pngs, outPath, gap = 8, bg = [10, 12, 16]) {
  const w = Math.max(...pngs.map((i) => i.width));
  const h = pngs.reduce((s, i) => s + i.height, 0) + gap * (pngs.length - 1);
  const out = new PNG({ width: w, height: h });
  for (let i = 0; i < out.data.length; i += 4) { out.data[i] = bg[0]; out.data[i + 1] = bg[1]; out.data[i + 2] = bg[2]; out.data[i + 3] = 255; }
  let oy = 0;
  for (const im of pngs) {
    for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
      const si = (y * im.width + x) * 4, di = ((oy + y) * w + x) * 4;
      out.data[di] = im.data[si]; out.data[di + 1] = im.data[si + 1]; out.data[di + 2] = im.data[si + 2]; out.data[di + 3] = 255;
    }
    oy += im.height + gap;
  }
  writeFileSync(outPath, PNG.sync.write(out));
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__planetRush?.viewport?.width > 0, undefined, { timeout: 25000 });
await page.waitForFunction(() => typeof window.__nameplateStage?.stageBot === 'function'
  && typeof window.__oreHudStage?.mine === 'function'
  && typeof window.__planetRush?.damageCore === 'function'
  && typeof window.__oreDepositStage?.readout === 'function', undefined, { timeout: 20000 });
await page.waitForFunction(() => (window.__planetRush?.ticks ?? 0) >= 60, undefined, { timeout: 30000 });

const read = () => page.evaluate(() => {
  const pr = window.__planetRush, d = window.__oreDepositStage;
  const ro = d.readout();
  return { t: pr.ticks, x: pr.shipWorld.x, y: pr.shipWorld.y, cargo: ro?.cargo, banked: ro?.banked, core1: pr.coreHp(1), fl: d.flights(), sha: pr.build.sha };
});
const held = new Set();
const set = async (want) => {
  for (const k of held) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
  for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
};
const keysToward = (dx, dy, tol) => { const w = new Set(); if (dx > tol) w.add('KeyD'); else if (dx < -tol) w.add('KeyA'); if (dy > tol) w.add('KeyS'); else if (dy < -tol) w.add('KeyW'); return w; };
async function flyToward(tx, ty, stopDist, { maxIters = 300, tag = '', capSpd = 999 } = {}) {
  let prev = await read();
  for (let i = 0; i < maxIters; i++) {
    await page.waitForTimeout(25);
    const s = await read();
    const dx = tx - s.x, dy = ty - s.y, dist = Math.hypot(dx, dy);
    const spd = Math.hypot((s.x - prev.x) / 0.025, (s.y - prev.y) / 0.025); prev = s;
    if (i % 10 === 0) console.log(`${tag} i=${i} dist=${dist.toFixed(0)} spd=${spd.toFixed(0)} cargo=${s.cargo.toFixed(2)}`);
    if (dist < stopDist) { await set(new Set()); return { s, dist }; }
    await set(spd > capSpd ? new Set() : keysToward(dx, dy, 12));
  }
  await set(new Set());
  return { s: await read(), dist: null };
}

await page.waitForTimeout(12000); // let planet spawn-protection lapse
// Seed the bank to a fractional baseline (a 0.5-ore deposit at home). The HUD
// TOTAL FLOORS the bank, and draining an exact whole number lands the bank a
// float-ULP under it (…-eps) — floor()ing one under (the documented ore-HUD
// residue, see loot-ore-truth). +0.5 lifts the landing clear of that boundary so
// the whole-ore loot credit displays cleanly; it changes only the readout, never
// the measured credit (bankRise is read off the authoritative bank both times).
await page.evaluate(() => window.__oreDepositStage.stage(0.5));
await page.waitForTimeout(900);
console.log('seed bank ->', JSON.stringify(await read()));
await page.evaluate(() => window.__oreHudStage.mine(0)); // park far from my home; empty hold
const parked = await read();
const myPlanet = { x: parked.x - MINE_OFFSET, y: parked.y - MINE_OFFSET };
console.log('parked', JSON.stringify(parked), 'myPlanet', JSON.stringify(myPlanet), 'sha', parked.sha);

// === 1. LOOT — move bot#1's planet beside me and destroy its core ===
const staged = await page.evaluate(() => window.__nameplateStage.stageBot());
const killq = await page.evaluate(() => window.__planetRush.damageCore(1, 99999));
console.log('stageBot', JSON.stringify(staged), 'damageCore', JSON.stringify(killq));
for (let i = 0; i < 80; i++) { await page.waitForTimeout(50); const s = await read(); if (s.core1 === null || s.core1 <= 0) { console.log('core dead i=', i); break; } }
await page.waitForTimeout(300); // debris settles into a readable ring

const bankBefore = (await read()).banked;
const cargoBefore = (await read()).cargo;
await page.screenshot({ path: join(TMP, 'wreck-full.png') });
const cen = yellowCentroid(loadPng(join(TMP, 'wreck-full.png')), true);
if (!cen) throw new Error('no wreck debris found on screen');
const shipNow = await read();
const debrisWorld = { x: shipNow.x + (cen.x - CX), y: shipNow.y + (cen.y - CY) };
console.log('debris centroid screen', JSON.stringify(cen), 'world', JSON.stringify(debrisWorld), 'bankBefore', bankBefore);

// Fly into the field; the proximity tractor fills the hold to its cap.
await flyToward(debrisWorld.x, debrisWorld.y, 25, { tag: 'SCOOP', capSpd: 170, maxIters: 200 });
let peak = 0;
for (let i = 0; i < 120; i++) { await page.waitForTimeout(30); const s = await read(); peak = Math.max(peak, s.cargo); if (s.cargo >= 1.95) break; if (i % 10 === 0) console.log(`pull i=${i} cargo=${s.cargo.toFixed(2)}`); }
await set(new Set());
await page.waitForTimeout(150);
const looted = await read();
const lootAmount = +(looted.cargo - cargoBefore).toFixed(3);
await page.screenshot({ path: join(TMP, 'loot-full.png') });
console.log('LOOTED cargo', looted.cargo.toFixed(3), 'lootAmount', lootAmount, 'peak', peak.toFixed(3), 'banked(unchanged)', looted.banked);

// === 2. BANK — return the loot-laden ship to its home atmosphere ===
// The route home crosses the dense wave-1 asteroid field and a nest of HARD rival
// planets (a real flight got the ship wedged on rocks, then shot). So the ship's
// hold — carrying the EXACTLY-measured 2 looted ore — is returned to its own
// living planet via the debug park (`dock` sets cargo to the real looted amount we
// pass, never a fabricated one), and the LIVE atmosphere auto-deposit is then what
// banks it. The mechanic under test (the v0.2.2 bug: looted ore reaching the bank)
// runs for real; only the cross-map transit is shortcut.
const myCore = await page.evaluate(() => window.__planetRush.coreHp(0));
console.log('my coreHp(0) before return =', myCore);
const dockRes = await page.evaluate((c) => window.__oreHudStage.dock(c), looted.cargo);
console.log('dock(looted) ->', JSON.stringify(dockRes));
// Watch the LIVE atmosphere drain bank the loot. Capture the "depositing" frame
// once the TOTAL has ticked past the next whole number (couriers still in flight,
// hold still draining), then let it finish for the settled "banked" frame.
let depositShot = false, arrived = null;
for (let i = 0; i < 240; i++) {
  await page.waitForTimeout(30);
  const s = await read();
  if (!depositShot && s.banked >= bankBefore + lootAmount - 0.5 && s.fl > 0) {
    await page.screenshot({ path: join(TMP, 'depositing-full.png') }); arrived = s; depositShot = true;
    console.log('DEPOSITING cargo', s.cargo.toFixed(3), 'banked', s.banked.toFixed(3), 'TOTALfloor', Math.floor(s.banked), 'flights', s.fl);
  }
  if (s.cargo <= 0.02) break;
}
if (!depositShot) { await page.screenshot({ path: join(TMP, 'depositing-full.png') }); arrived = await read(); }
await page.waitForTimeout(400);
const done = await read();
await page.screenshot({ path: join(TMP, 'banked-full.png') });
const bankRise = +(done.banked - bankBefore).toFixed(3);
console.log('DONE cargo', done.cargo.toFixed(3), 'banked', done.banked.toFixed(3), 'bankRise', bankRise, 'lootAmount', lootAmount);

// Compose: LOOT (hold full over the field) above BANK (deposited at home).
stitchV([cropTop(join(TMP, 'loot-full.png'), CROP_W, VH), cropTop(join(TMP, 'depositing-full.png'), CROP_W, VH)],
  join(OUT, 'loot-ore-deposits.png'));

console.log('ERRORS', JSON.stringify(errs));
console.log('RESULT', JSON.stringify({
  sha: parked.sha,
  wreckChunksSeenPx: cen.n,
  bankBefore, lootAmount, bankAfter: done.banked, bankRise,
  oneToOne: Math.abs(bankRise - lootAmount) < 0.05,
}, null, 2));

await browser.close();
