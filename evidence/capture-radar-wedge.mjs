/**
 * evidence/capture-radar-wedge.mjs — p13 evidence `radar-wedge-restored`: the RADAR
 * wedge is back in the build wheel, a REAL tap on it builds a radar satellite, the
 * minimap fog LIFTS while it lives, an enemy kill collapses that coverage and the
 * fog RETURNS, and the wedge RE-ARMS. OWNER: QA Manager.
 *
 * Every build here is a GENUINE pointer press on the drawn RADAR wedge (the p1a
 * rule) — NOT a debug order method. There is no dedicated radar-wedge seam on the
 * shipped `main.ts` (de34bbb never merged into #226), so the wedge's on-screen
 * point is reconstructed from geometry the client DOES expose and self-checked:
 *   - `__upgradeWheelStage.hubPoint()`  → the wheel centre, LOGICAL (w/2, h/2).
 *   - `__repairStage.repairWedgePoint()` / `repairWedgeClientPoint()` → the REPAIR
 *     wedge in LOGICAL and CLIENT space — one validated logical→client pair.
 * The RADAR wedge (WHEEL_ORDER index 2) sits on the same 0.6·R ring as REPAIR
 * (index 3); its logical point is `centre + 0.6R·û₂`, mapped to client through the
 * same landscape-lock transform the repair pair calibrates (identity on desktop, a
 * +90° rotation on a portrait phone). Every step is GATED on real sim state read
 * back off the seams — a tap that lands wrong fails the gate, it never fakes a pass:
 *   - build landed  ⇔  `__repairStage.readout().banked` drops by exactly SATELLITE
 *     .cost (6) — the only 6-ore build, so the drop names the wedge that was hit.
 *   - fog lifted     ⇔  `__minimapStage.state()` coverageCount grows + satelliteCount 1.
 *   - fog returned   ⇔  after `killSatellite()` coverage collapses + satelliteCount 0.
 *
 * Driven WITHOUT ?freeze (the 12 s construction has to run live) on both form
 * factors the game ships to. Writes raw frames to /tmp and a readback JSON; the
 * montage is composed by build-radar-wedge-figure.mjs.
 *
 * Usage: EVIDENCE_BASE_URL=http://localhost:4173 \
 *   LD_LIBRARY_PATH=/tmp/pwlibs/... node evidence/capture-radar-wedge.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP = '/tmp';
const OUTJSON = join(HERE, 'images');
mkdirSync(OUTJSON, { recursive: true });
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';

const SATELLITE_COST = 6; // src/sim/constants.ts SATELLITE.cost — the only 6-ore build
const SEG_ARC = (2 * Math.PI) / 5; // five wheel segments
const segAngle = (i) => -Math.PI / 2 + i * SEG_ARC; // src/ui/build-wheel.ts segmentAngle
const SAT_INDEX = 2; // WHEEL_ORDER = [turret, shield, satellite, repair, upgrade]

const PROFILES = [
  { key: 'desktop', rotated: false, ctx: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } },
  { key: 'mobile', rotated: true, ctx: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
];

/** Build a logical→client mapper from the repair pair, per form factor.
 *  Desktop: pure translation. Phone (landscape lock): +90° rotation, px = TX − ly,
 *  py = lx + TY — the exact inverse of `physicalToLogical` every real pointer crosses. */
function makeL2C(rotated, rL, rC) {
  if (!rotated) {
    const dx = rC.x - rL.x, dy = rC.y - rL.y;
    return (p) => ({ x: p.x + dx, y: p.y + dy });
  }
  const TX = rC.x + rL.y, TY = rC.y - rL.x;
  return (p) => ({ x: -p.y + TX, y: p.x + TY });
}

/** The wheel-wedge press: a synthesized pointerdown+pointerup on the canvas at the
 *  client point — the same event a mouse click / thumb tap fires into the same
 *  `main.ts` handler. The wheel commits a build on pointerdown (the up releases the
 *  pointer so the next gesture is clean). Empirically this is what places the order;
 *  Playwright's higher-level click is read by the wheel as a drag and cancels. */
async function wedgeTap(page, pt, pointerType) {
  await page.evaluate(({ p, pt }) => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas');
    const common = { clientX: p.x, clientY: p.y, pointerId: 1, pointerType: pt, bubbles: true, cancelable: true };
    canvas.dispatchEvent(new PointerEvent('pointerdown', common));
    canvas.dispatchEvent(new PointerEvent('pointerup', common));
  }, { p: pt, pt: pointerType });
}

/** The minimap toggle: a REAL synthesized OS-level tap (mouse click / touchscreen
 *  tap). Playwright routes it through the browser's own hit-testing and
 *  pointer-capture bookkeeping — which a preceding synthetic wedge press leaves in
 *  a state that swallows a bare hand-dispatched pointerdown on the corner map. */
async function mapTap(page, pt, pointerType) {
  if (pointerType === 'touch') await page.touchscreen.tap(pt.x, pt.y);
  else await page.mouse.click(pt.x, pt.y);
}

/** Toggle the minimap overlay to `want` (expanded/collapsed) with real taps, retried
 *  against fresh state. To EXPAND, tap the collapsed corner's centre. To COLLAPSE,
 *  tap the expanded overlay's top band — above the open wheel, so the wheel never
 *  intercepts it. Returns the final `expanded` (throws if it never reached `want`). */
async function setExpanded(page, want, l2c, pointerType) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const s = await page.evaluate(() => window.__minimapStage.state());
    if (s.expanded === want) return s;
    const r = s.rect;
    const pt = want
      ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } // collapsed corner centre
      : { x: r.x + r.width / 2, y: r.y + 12 };          // overlay top band (off the wheel)
    await mapTap(page, l2c(pt), pointerType);
    try {
      await page.waitForFunction((w) => window.__minimapStage.state().expanded === w, want, { timeout: 2_000 });
      return await page.evaluate(() => window.__minimapStage.state());
    } catch { /* re-read and retry */ }
  }
  throw new Error(`minimap never reached expanded=${want}`);
}

async function shot(page, key, name) {
  const file = join(TMP, `rw_${key}_${name}.png`);
  await page.waitForTimeout(160); // let the frame settle / caption paint
  await page.screenshot({ path: file });
  return file;
}

async function runProfile(browser, profile) {
  const { key, rotated, ctx } = profile;
  const pointerType = rotated ? 'touch' : 'mouse';
  const page = await (await browser.newContext(ctx)).newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const rb = { key };
  try {
    await page.goto(`${BASE}/?debug=1`, { waitUntil: 'load' });
    await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
    await page.waitForFunction(
      () => typeof window.__repairStage?.siege === 'function'
        && typeof window.__upgradeWheelStage?.hubPoint === 'function'
        && typeof window.__minimapStage?.state === 'function',
      undefined, { timeout: 20_000 },
    );

    // Park docked at the home station, bank 30 ore (>2× cost, so the re-arm is
    // provably affordable after the 6 spent), open the Build wheel on the main ring.
    const staged = await page.evaluate(() => window.__repairStage.siege(0, 30));
    if (!staged) throw new Error('siege returned null — no local ship/station');
    rb.bankStart = staged.banked;

    // Reconstruct the RADAR wedge's client point + a logical→client mapper.
    const geo = await page.evaluate(() => ({
      hub: window.__upgradeWheelStage.hubPoint(),
      rL: window.__repairStage.repairWedgePoint(),
      rC: window.__repairStage.repairWedgeClientPoint(),
    }));
    const c = geo.hub, rL = geo.rL, rC = geo.rC;
    const r06 = Math.hypot(rL.x - c.x, rL.y - c.y); // 0.6·R
    // Self-check: rebuild REPAIR (index 3) from centre+angle+r06 — proves the angle
    // convention + radius are the client's, before trusting the satellite point.
    const reRepair = { x: c.x + Math.cos(segAngle(3)) * r06, y: c.y + Math.sin(segAngle(3)) * r06 };
    const selfErr = Math.hypot(reRepair.x - rL.x, reRepair.y - rL.y);
    if (selfErr > 1) throw new Error(`geometry self-check failed (${selfErr.toFixed(2)}px)`);
    const satL = { x: c.x + Math.cos(segAngle(SAT_INDEX)) * r06, y: c.y + Math.sin(segAngle(SAT_INDEX)) * r06 };
    const l2c = makeL2C(rotated, rL, rC);
    const satC = l2c(satL);
    rb.geometry = { hub: c, r06, satLogical: satL, satClient: satC, selfCheckPx: selfErr };

    const base = await page.evaluate(() => window.__minimapStage.state());
    rb.minimapBaseline = { coverageCount: base.coverageCount, satelliteCount: base.satelliteCount, shipCount: base.shipCount };

    // ===== 1) armed — wheel open, RADAR "0/1" ==============================
    rb.armed = { banked: (await page.evaluate(() => window.__repairStage.readout())).banked };
    rb.files = {};
    rb.files.armed = await shot(page, key, '1_armed');

    // ===== real tap on the RADAR wedge → build order =======================
    const before = await page.evaluate(() => window.__repairStage.readout());
    await wedgeTap(page, satC, pointerType);
    await page.waitForFunction(
      (target) => Math.abs(window.__repairStage.readout().banked - target) < 0.5,
      before.banked - SATELLITE_COST, { timeout: 6_000 },
    );
    rb.built = { banked: (await page.evaluate(() => window.__repairStage.readout())).banked };
    rb.spent = before.banked - rb.built.banked;

    // ===== 2) built — wheel RADAR "1/1", 6 ore spent =======================
    rb.files.built = await shot(page, key, '2_built');

    // Expand the minimap for the fog shots (real taps on the collapsed corner).
    await setExpanded(page, true, l2c, pointerType);

    // ===== 3) fog lifted — coverage disc + revealed enemies ================
    await page.waitForFunction(
      (bc) => { const s = window.__minimapStage.state(); return s.satelliteCount >= 1 && s.coverageCount > bc; },
      base.coverageCount, { timeout: 25_000 },
    );
    const lifted = await page.evaluate(() => window.__minimapStage.state());
    rb.fogLifted = { coverageCount: lifted.coverageCount, satelliteCount: lifted.satelliteCount, shipCount: lifted.shipCount };
    rb.files.fogLifted = await shot(page, key, '3_fog_lifted');

    // ===== 4) fog returned — kill the satellite ===========================
    await page.evaluate(() => window.__minimapStage.killSatellite());
    await page.waitForFunction(
      (bc) => { const s = window.__minimapStage.state(); return s.coverageCount < bc && s.satelliteCount === 0; },
      lifted.coverageCount, { timeout: 10_000 },
    );
    const dark = await page.evaluate(() => window.__minimapStage.state());
    rb.fogReturned = { coverageCount: dark.coverageCount, satelliteCount: dark.satelliteCount, shipCount: dark.shipCount };
    rb.files.fogReturned = await shot(page, key, '4_fog_returned');

    // Collapse the minimap (tap the overlay's top band, off the wheel).
    await setExpanded(page, false, l2c, pointerType);
    rb.minimapCollapsed = true;

    // ===== 5) re-armed — wheel RADAR "0/1" again, bank still affordable =====
    // The ~28 s live run (12 s build + waits) let the docked ship drift off its
    // station, auto-closing the wheel. Re-park docked at the CURRENT bank (no
    // re-funding) to re-open the wheel and SHOW the wedge re-armed — the satellite
    // is already dead (satelliteCount 0), so the RADAR wedge reads "0/1" pressable.
    const held = (await page.evaluate(() => window.__repairStage.readout())).banked;
    await page.evaluate((b) => window.__repairStage.siege(0, b), held);
    const rearm = await page.evaluate(() => window.__repairStage.readout());
    const sats = await page.evaluate(() => window.__minimapStage.state());
    rb.rearm = { banked: rearm.banked, affordable: rearm.banked >= SATELLITE_COST, satelliteCount: sats.satelliteCount };
    rb.files.rearmed = await shot(page, key, '5_rearmed');

    rb.pageErrors = errs;
    return rb;
  } finally {
    await page.close();
  }
}

const browser = await chromium.launch();
const readback = {};
try {
  for (const profile of PROFILES) {
    console.log(`--- ${profile.key} ---`);
    readback[profile.key] = await runProfile(browser, profile);
    console.log(JSON.stringify(readback[profile.key], null, 2));
  }
} finally {
  await browser.close();
}
writeFileSync(join(OUTJSON, 'radar-wedge-readback.json'), JSON.stringify(readback, null, 2));
const anyErr = Object.values(readback).some((r) => r.pageErrors && r.pageErrors.length);
if (anyErr) console.error('PAGE ERRORS present — see readback.json');
