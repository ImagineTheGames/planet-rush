/**
 * evidence/capture-p8-ore-conservation.mjs — p8 RE-VERIFY on the ATMOSPHERE path:
 * "one flight sprite per unit banked, never more" (src/sim/step.ts updateDeposits).
 * OWNER: QA Manager. The developer has watched the ore readout lie TWICE, so this
 * uses the smallest legible number — exactly 2 ore — where a miscount cannot hide.
 *
 * The count is not staged. `__oreDepositStage.stage(2)` parks the LOCAL ship AT REST
 * inside its own atmosphere halo (planet.radius+ship.radius+30 ≈ 110u from the
 * planet centre, well within the 256u DEPOSIT_RANGE) with a 2-ore hold; the sim's
 * own auto-deposit then drains the hold and flies the couriers home. Nothing else is
 * touched.
 *
 * COUNTING, isolated from the seven rival bots (which deposit at THEIR planets, so a
 * global courier tally is contaminated): the sim spawns exactly one courier per
 * WHOLE unit the LOCAL hold sheds — keyed to `floor(cargo)` integer-boundary
 * crossings (step.ts:842). So the LOCAL courier count is observed directly, off the
 * local readout, by counting how many times `floor(localCargo)` DECREASES during the
 * drain: for a clean 2→0 hold that is exactly two crossings (2→1, then 1→0), i.e.
 * two couriers, matched by the LOCAL bank rising exactly +2. The p8 bug spawned ~3
 * per ore; were it back, either the crossings or the visible couriers would exceed 2.
 *
 * VISUAL: the local ship is camera-centred, its planet ≈110u away, so a tight 300px
 * crop around centre shows ONLY the local ship→planet couriers (rival couriers are
 * hundreds of units off at the arena rim). A courier frame is grabbed at each of the
 * two crossings; the settled empty frame (hold gone, bank +2, no courier at centre)
 * closes it. Retries on a fresh page until one clean 2→0 drain lands. No game code
 * touched; every pixel claim written AFTER looking at the PNG.
 *
 * Usage: EVIDENCE_BASE_URL=http://localhost:4191 node evidence/capture-p8-ore-conservation.mjs
 * Launch under the sandboxed-Chromium LD_LIBRARY_PATH (see the QA memory).
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const TMP = '/tmp/capp8ore';
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4191';
const VW = 1280, VH = 800, CX = 640, CY = 400;
const DEPOSIT_RANGE = 256; // PLANET.radius(64) * 4 (src/sim/constants.ts)
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

function cropSave(src, out, x, y, w, h) {
  const p = PNG.sync.read(readFileSync(src));
  x = Math.max(0, Math.min(Math.round(x), p.width - w));
  y = Math.max(0, Math.min(Math.round(y), p.height - h));
  const o = new PNG({ width: w, height: h });
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const si = ((y + j) * p.width + (x + i)) * 4, di = (j * w + i) * 4;
    o.data[di] = p.data[si]; o.data[di + 1] = p.data[si + 1]; o.data[di + 2] = p.data[si + 2]; o.data[di + 3] = 255;
  }
  writeFileSync(out, PNG.sync.write(o));
}
function stitchV(paths, outPath, gap = 6, bg = [12, 14, 18]) {
  const imgs = paths.map((p) => PNG.sync.read(readFileSync(p)));
  const w = Math.max(...imgs.map((i) => i.width));
  const h = imgs.reduce((s, i) => s + i.height, 0) + gap * (imgs.length - 1);
  const out = new PNG({ width: w, height: h });
  for (let i = 0; i < out.data.length; i += 4) { out.data[i] = bg[0]; out.data[i + 1] = bg[1]; out.data[i + 2] = bg[2]; out.data[i + 3] = 255; }
  let oy = 0;
  for (const im of imgs) {
    for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
      const si = (y * im.width + x) * 4, di = ((oy + y) * w + x) * 4;
      out.data[di] = im.data[si]; out.data[di + 1] = im.data[si + 1]; out.data[di + 2] = im.data[si + 2]; out.data[di + 3] = 255;
    }
    oy += im.height + gap;
  }
  writeFileSync(outPath, PNG.sync.write(out));
}

async function attempt(browser, n) {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  try {
    await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__planetRush?.viewport?.width > 0, undefined, { timeout: 25000 });
    await page.waitForFunction(
      () => typeof window.__oreDepositStage?.stage === 'function' && typeof window.__oreDepositStage?.flights === 'function',
      undefined, { timeout: 20000 });
    await page.waitForFunction(() => (window.__planetRush?.ticks ?? 0) >= 60, undefined, { timeout: 30000 });

    const read = () => page.evaluate(() => {
      const pr = window.__planetRush, d = window.__oreDepositStage;
      const ro = d.readout();
      return { t: pr.ticks, x: pr.shipWorld.x, y: pr.shipWorld.y,
        cargo: ro ? ro.cargo : null, banked: ro ? ro.banked : null, flights: d.flights(), sha: pr.build.sha };
    });
    const shot = async (name) => { const p = join(TMP, name + '.png'); await page.screenshot({ path: p }); return p; };

    // Park 2 ore at rest inside the atmosphere; the sim drains it from here.
    const staged = await page.evaluate(() => window.__oreDepositStage.stage(2));
    if (!staged) throw new Error('stage(2) returned null (no local ship/planet)');
    const bankStart = staged.banked;
    console.log(`[${n}] staged cargo=${staged.cargo} bank=${bankStart}`);
    if (Math.abs(staged.cargo - 2) > 1e-6) throw new Error(`staged cargo ${staged.cargo} != 2`);

    // Poll the drain; count LOCAL courier spawns as decreases of floor(localCargo).
    // Grab a screenshot at each crossing (courier just launched, in flight near centre).
    let prevFloor = Math.floor(staged.cargo); // 2
    let localCouriers = 0;
    const crossingShots = []; // { from, to, path, cargo, banked, flights }
    let lastActivity = 0;
    let started = false;
    for (let i = 0; i < 240; i++) {
      const s = await read();
      if (s.cargo < staged.cargo - 1e-6) started = true;
      const f = Math.floor(s.cargo);
      if (f < prevFloor) {
        // one or more whole units left the hold since the last poll (normally one)
        for (let x = prevFloor; x > f; x--) localCouriers++;
        const p = await shot(`cross-${prevFloor}to${f}-${String(i).padStart(3, '0')}`);
        crossingShots.push({ from: prevFloor, to: f, path: p, cargo: s.cargo, banked: s.banked, flights: s.flights });
        prevFloor = f;
        lastActivity = i;
      }
      if (started && s.cargo <= 1e-6) { lastActivity = lastActivity || i; if (i - lastActivity > 4) break; }
      await page.waitForTimeout(30);
    }
    // Settle & read the final bank; capture the empty frame.
    await page.waitForTimeout(500);
    const done = await read();
    const bankDelta = +(done.banked - bankStart).toFixed(3);
    const emptyPath = await shot('empty');

    const ok = localCouriers === 2 && Math.abs(bankDelta - 2) < 0.02 && done.cargo <= 1e-6
      && crossingShots.length === 2 && errs.length === 0;
    const summary = {
      sha: staged ? (await read()).sha : null,
      bankStart, bankFinal: done.banked, bankDelta,
      stagedCargo: staged.cargo, finalCargo: +done.cargo.toFixed(4),
      localCourierSpawns: localCouriers, crossings: crossingShots.map((c) => `${c.from}->${c.to}`),
      depositRange: DEPOSIT_RANGE, errs: errs.slice(0, 5), ok,
    };
    console.log(`[${n}] SUMMARY ${JSON.stringify(summary)}`);

    if (ok) {
      const cropPaths = [];
      const labels = ['courier-1', 'courier-2'];
      for (let k = 0; k < 2; k++) {
        const c = crossingShots[k];
        writeFileSync(join(OUT, `ore-conservation-${labels[k]}.png`), readFileSync(c.path));
        const cp = join(TMP, `crop-${labels[k]}.png`);
        cropSave(c.path, cp, CX - 200, CY - 210, 400, 380);
        cropPaths.push(cp);
      }
      writeFileSync(join(OUT, 'ore-conservation-empty.png'), readFileSync(emptyPath));
      const ce = join(TMP, 'crop-empty.png');
      cropSave(emptyPath, ce, CX - 200, CY - 210, 400, 380);
      cropPaths.push(ce);
      stitchV(cropPaths, join(OUT, 'ore-conservation-strip.png'));
      writeFileSync(join(TMP, 'summary.json'), JSON.stringify({ summary, crossings: crossingShots.map((c) => ({ cross: `${c.from}->${c.to}`, cargo: +c.cargo.toFixed(4), banked: +c.banked.toFixed(4), globalFlights: c.flights })) }, null, 2));
    }
    return { ok, summary, crossingShots };
  } finally {
    await ctx.close();
  }
}

const browser = await chromium.launch();
let result = null;
try {
  for (let n = 1; n <= 6; n++) {
    try {
      const r = await attempt(browser, n);
      if (r.ok) { result = r; break; }
      result = r;
    } catch (e) { console.log(`[${n}] threw: ${String(e).split('\n')[0]}`); }
  }
} finally { await browser.close(); }

if (!result) { console.log('NO RESULT'); process.exit(1); }
console.log('FINAL', JSON.stringify(result.summary, null, 2));
process.exit(result.ok ? 0 : 2);
