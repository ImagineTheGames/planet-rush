/**
 * evidence/capture-atmosphere-deposit.mjs — p4 evidence: "the atmosphere works".
 * OWNER: QA Manager. Drives the LIVE build (?debug=1, no ?freeze) through the
 * ratified ore-deposit seams and REAL thrust, and flies the atmosphere boundary
 * to prove the halo edge and the deposit-mechanic edge are the SAME place:
 *
 *   FRAME A (INSIDE)  — ship inside the home planet's atmosphere halo, clearly
 *                       NOT touching the planet, ore couriers streaming
 *                       ship→planet, the hold draining and the bank rising.
 *   FRAME B (OUTSIDE) — the ship flown out until the drain STOPS, then braked to
 *                       rest just beyond the point of stopping: the couriers are
 *                       gone and the hold sits frozen at what it held on the way out.
 *
 * The boundary is found EMPIRICALLY, not assumed: the outbound flight watches the
 * hold and marks the distance at which the drain switches off — that stopping
 * distance is compared, in the manifest, to the 256-unit DEPOSIT_RANGE the render
 * layer draws the halo from. Nothing is faked: `__oreDepositStage.stage(ore)`
 * seeds a hold at home, the ship then flies on real WASD thrust and the sim's own
 * drag, and every number is read back off `__oreDepositStage.readout()` /
 * `__planetRush` at the captured frame.
 *
 * Usage: node evidence/capture-atmosphere-deposit.mjs   (needs preview on $EVIDENCE_BASE_URL)
 * Launch under the sandboxed-Chromium LD_LIBRARY_PATH (see the QA memory).
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const TMP = '/tmp/capatm';
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4188';
const VW = 1280, VH = 800;
const DEPOSIT_RANGE = 256; // PLANET.radius(64) * 4  (src/sim/constants.ts)
const STAGE_OFFSET = 110;  // stage() parks the ship at planet + radius64+shipR16+30
const CROP_W = 856;        // left playfield + HUD; the right status strip is empty here
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

function cropTop(src, w, h) {
  const p = PNG.sync.read(readFileSync(src));
  const o = new PNG({ width: w, height: h });
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
await page.waitForFunction(() => typeof window.__oreDepositStage?.stage === 'function', undefined, { timeout: 20000 });
await page.waitForFunction(() => (window.__planetRush?.ticks ?? 0) >= 60, undefined, { timeout: 30000 });

const read = () => page.evaluate(() => {
  const pr = window.__planetRush, d = window.__oreDepositStage;
  const ro = d.readout();
  return { t: pr.ticks, x: pr.shipWorld.x, y: pr.shipWorld.y,
    cargo: ro ? ro.cargo : null, banked: ro ? ro.banked : null, flights: d.flights(), sha: pr.build.sha };
});
const held = new Set();
const set = async (want) => {
  for (const k of held) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
  for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
};

const s0boot = await read();
let planet = { x: s0boot.x - STAGE_OFFSET, y: s0boot.y }; // refined right after stage
const distTo = (s) => Math.hypot(s.x - planet.x, s.y - planet.y);
const radial = (s) => { const dx = s.x - planet.x, dy = s.y - planet.y, d = Math.hypot(dx, dy) || 1; return { ux: dx / d, uy: dy / d, d }; };
const keysFor = (ux, uy) => { const w = new Set(); if (ux > 0.2) w.add('KeyD'); else if (ux < -0.2) w.add('KeyA'); if (uy > 0.2) w.add('KeyS'); else if (uy < -0.2) w.add('KeyW'); return w; };

// === FRAME A — INSIDE the atmosphere, mid-drain (captured at the staged spot) ===
// A small hold keeps the under-ship pip row readable; capture promptly so ore is
// still visibly in the hold while the couriers stream home.
let staged = await page.evaluate(() => window.__oreDepositStage.stage(8));
const sA0 = await read();
planet = { x: sA0.x - STAGE_OFFSET, y: sA0.y };
console.log('staged A', JSON.stringify(staged), 'planet', JSON.stringify(planet));
await page.waitForTimeout(350); // let a courier stream populate
const a = await read();
await page.screenshot({ path: join(TMP, 'inside-full.png') });
console.log('FRAME A dist', distTo(a).toFixed(0), 'cargo', a.cargo.toFixed(3), 'banked', a.banked.toFixed(3), 'flights', a.flights);

// === FRAME B — the SAME hold flown out until the drain STOPS, braked just outside ===
// No re-stage: this is one continuous flight from FRAME A across the atmosphere edge.
// Phase 1: full outward thrust; watch the hold. When cargo stops falling (while
// still > 0) for a short window, the ship has crossed the atmosphere edge.
let prev = await read();
let stopDist = null, stopCargo = null, flat = 0;
for (let i = 0; i < 300; i++) {
  await page.waitForTimeout(25);
  const s = await read();
  const { ux, uy, d } = radial(s);
  if (i % 6 === 0) console.log(`OUT i=${i} dist=${d.toFixed(0)} cargo=${s.cargo.toFixed(2)} fl=${s.flights}`);
  const drainedThisStep = prev.cargo - s.cargo; // >0 while inside & draining
  if (s.cargo > 0.2) {
    if (drainedThisStep < 0.005) { flat++; if (flat >= 3 && stopDist === null) { stopDist = d; stopCargo = s.cargo; } }
    else flat = 0;
  }
  prev = s;
  if (stopDist !== null && d > stopDist + 30) break; // a touch past the edge, then brake
  await set(keysFor(ux, uy)); // thrust straight out
}
await set(new Set());
if (stopDist === null) { console.log('WARN: never detected a drain-stop (hold may have emptied)'); }

// Phase 2: brake to rest with radial-PD, holding just outside the stop distance.
const target = (stopDist ?? distTo(await read())) + 22;
for (let i = 0; i < 200; i++) {
  await page.waitForTimeout(25);
  const s = await read();
  const p2 = radial(s);
  const vx = (s.x - prev.x) / 0.025, vy = (s.y - prev.y) / 0.025;
  const radVel = vx * p2.ux + vy * p2.uy; // outward-positive radial speed
  const spd = Math.hypot(vx, vy);
  prev = s;
  const err = target - p2.d; // +ve => need to move outward
  const cmd = err * 0.05 - radVel * 0.30; // PD with velocity braking
  if (i % 8 === 0) console.log(`BRK i=${i} dist=${p2.d.toFixed(0)} spd=${spd.toFixed(0)} cargo=${s.cargo.toFixed(2)} cmd=${cmd.toFixed(1)}`);
  if (Math.abs(err) < 10 && spd < 8) { await set(new Set()); break; }
  if (Math.abs(cmd) < 6) { await set(new Set()); continue; }
  await set(keysFor(cmd * p2.ux, cmd * p2.uy));
}
await set(new Set());

await page.waitForTimeout(1300); // couriers in flight arrive & clear
const b1 = await read();
await page.waitForTimeout(700);
const b2 = await read();
await page.screenshot({ path: join(TMP, 'outside-full.png') });
const bankCrept = +(b2.banked - b1.banked).toFixed(4);
const cargoCrept = +(b1.cargo - b2.cargo).toFixed(4);
console.log('FRAME B dist', distTo(b2).toFixed(0), 'cargo', b2.cargo.toFixed(3), 'banked', b2.banked.toFixed(3),
  'flights', b2.flights, 'stopDist', stopDist?.toFixed(0), 'bankCrept0.7s', bankCrept, 'cargoCrept0.7s', cargoCrept);

// Compose the boundary story: INSIDE over OUTSIDE.
stitchV([cropTop(join(TMP, 'inside-full.png'), CROP_W, VH), cropTop(join(TMP, 'outside-full.png'), CROP_W, VH)],
  join(OUT, 'atmosphere-deposit.png'));

console.log('ERRORS', JSON.stringify(errs));
console.log('RESULT', JSON.stringify({
  sha: a.sha,
  inside: { dist: +distTo(a).toFixed(0), cargo: +a.cargo.toFixed(3), banked: +a.banked.toFixed(3), flights: a.flights },
  outside: { dist: +distTo(b2).toFixed(0), cargo: +b2.cargo.toFixed(3), banked: +b2.banked.toFixed(3), flights: b2.flights, bankCrept, cargoCrept },
  drainStopDist: stopDist === null ? null : +stopDist.toFixed(0), drainStopCargo: stopCargo === null ? null : +stopCargo.toFixed(3),
  depositRange: DEPOSIT_RANGE,
}, null, 2));

await browser.close();
