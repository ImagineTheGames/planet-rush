/**
 * evidence/capture-ore-truth.mjs — p4-01 evidence: "ore numbers tell the truth".
 * OWNER: QA Manager. Drives the LIVE build (?debug=1, no ?freeze) through REAL
 * input and the ratified read seams, runs the whole ore cycle NATURALLY —
 *   mine a field → dock → interrupt the deposit by undocking mid-drain → re-dock
 *   → finish —
 * and at every captured sample records the three numbers the field report says
 * used to disagree:
 *   pips    = the under-ship hold indicator the HUD DREW      (__oreHudStage.hold)
 *   TOTAL   = the top-left banked total the HUD DREW           (__oreHudStage.total)
 *   sim     = the live hold/bank the sim holds this frame      (__oreHudStage.readout)
 * plus the deposit-flight courier count (__oreDepositStage.flights). No game code;
 * every pixel claim is written into the manifest AFTER looking at the PNG.
 *
 * The ship boots DOCKED at its home planet (blue-ringed disc, "YOU"), banked 3,
 * hold empty. Base cargoCap is 2 (src/sim class stats), so a naturally-mined hold
 * is 2 ore and drains in ~1 s at DEPOSIT.drainRate 2/s — a real, cleanly
 * interruptible cycle. Everything is flown: mining chips real chunks off a real
 * rock (screenshot rock-finder + manual-aim fire), docking is a real return flight
 * that coasts to rest inside dock range on the sim's own DRAG, the interrupt is a
 * real thrust-away (the parkSpeed gate halts the drain the instant speed > 40), and
 * the re-dock is a real return. Mining depends on live projectile hits, so a whole
 * attempt is retried on a fresh page until one clean cycle is captured.
 *
 * Usage: node evidence/capture-ore-truth.mjs   (env EVIDENCE_BASE_URL)
 * Launch under LD_LIBRARY_PATH for the sandboxed Chromium (see the QA memory).
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const TMP = '/tmp/capore';
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4174';
const VW = 1280, VH = 800, CX = 640, CY = 400;
const PLANET = { x: 2074.5, y: 1198.7 }; // home planet centre (world) — scale-probed
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

// ── pixel helpers (rock finder mirrors capture-mining.mjs) ──────────────────
function isGrey(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx > 110 && mx < 215 && (mx - mn) < 28 && Math.abs(r - g) < 22 && Math.abs(g - b) < 30;
}
function nearestRock(png) {
  const { width, height, data } = png;
  let best = null, bestD = 1e18;
  for (let y = 120; y < 700; y += 2) for (let x = 40; x < 1040; x += 2) {
    const i = (y * width + x) * 4;
    if (!isGrey(data[i], data[i + 1], data[i + 2])) continue;
    const dx = x - CX, dy = y - CY, d = dx * dx + dy * dy;
    if (d < 900) continue;
    if (d < bestD) { bestD = d; best = { x, y }; }
  }
  if (!best) return null;
  let sx = 0, sy = 0, n = 0;
  for (let y = Math.max(0, best.y - 55); y < Math.min(height, best.y + 55); y += 2)
    for (let x = Math.max(0, best.x - 55); x < Math.min(width, best.x + 55); x += 2) {
      const i = (y * width + x) * 4;
      if (isGrey(data[i], data[i + 1], data[i + 2])) { sx += x; sy += y; n++; }
    }
  if (n < 1) return null;
  const cx = sx / n, cy = sy / n;
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  return { x: cx, y: cy, dist: Math.sqrt(bestD) };
}
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
const clampAim = (x, y) => ({ x: Math.max(1, Math.min(VW - 1, x)), y: Math.max(1, Math.min(VH - 1, y)) });

// ── one full attempt on a fresh page; returns a result or throws ────────────
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
      () => typeof window.__oreHudStage?.hold === 'function' && typeof window.__oreDepositStage?.flights === 'function',
      undefined, { timeout: 20000 });
    await page.waitForFunction(() => (window.__planetRush?.ticks ?? 0) >= 60, undefined, { timeout: 30000 });

    const read = () => page.evaluate(() => {
      const pr = window.__planetRush, s = window.__oreHudStage, d = window.__oreDepositStage;
      const ro = s.readout(); const h = s.hold();
      return {
        t: pr.ticks, x: pr.shipWorld.x, y: pr.shipWorld.y,
        cargo: ro ? ro.cargo : null, banked: ro ? ro.banked : null,
        pips: h ? h.filled : null, slots: h ? h.slots : null, hidden: h === null,
        total: s.total(), flights: d.flights(), build: pr.build,
      };
    });
    const held = new Set();
    const set = async (want) => {
      for (const k of held) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
      for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
    };
    const aimAt = async (x, y) => { const a = clampAim(x, y); await page.mouse.move(a.x, a.y); };
    const shot = async (name) => { const p = join(TMP, name + '.png'); await page.screenshot({ path: p }); return p; };

    const samples = [];
    // The HUD floors the SAME sim values this reads: pips = floor(cargo),
    // TOTAL = floor(banked). STATIC frames (nothing transferring) must agree
    // EXACTLY — those are the frames screenshotted and attested pixel-for-pixel.
    // LIVE-drain frames carry the documented ≤1-frame draw lag (the drawn value
    // is the previous render's, and cargo/bank moved <0.05 in that frame), so a
    // symmetric ±1 is allowed there and only there. No epsilon on the floors —
    // the HUD floors the raw value, so we must too (banked lands at 4.9999… =
    // floor 4 by float residue; an inflating epsilon would wrongly demand 5).
    function checkAgree(s, live) {
      const v = [];
      if (s.cargo === null || s.banked === null) { v.push('sim readout null'); return v; }
      const fc = Math.floor(s.cargo), fb = Math.floor(s.banked);
      if (live) { if (Math.abs(s.total - fb) > 1) v.push(`TOTAL ${s.total} vs floor(bank ${s.banked.toFixed(4)})=${fb} (>1 off)`); }
      else if (s.total !== fb) v.push(`TOTAL ${s.total} != floor(bank ${s.banked.toFixed(4)})=${fb}`);
      if (s.cargo > 1e-6) {
        if (s.pips === null) v.push('pips hidden while holding ore');
        else if (live) { if (Math.abs(s.pips - fc) > 1) v.push(`pips ${s.pips} vs floor(hold ${s.cargo.toFixed(4)})=${fc} (>1 off)`); }
        else if (s.pips !== fc) v.push(`pips ${s.pips} != floor(hold ${s.cargo.toFixed(4)})=${fc}`);
      } else if (s.pips !== null && s.pips > 0) {
        v.push(`pips ${s.pips} shown with empty hold`);
      }
      return v;
    }
    // Global courier accounting: every sample updates the rising-edge spawn count
    // and the peak simultaneously-in-flight, so the whole deposit is tallied.
    let prevFlights = 0, courierSpawns = 0, peakFlights = 0;
    async function sample(phase, live) {
      const s = await read();
      const v = checkAgree(s, live);
      if (s.flights > prevFlights) courierSpawns += (s.flights - prevFlights);
      prevFlights = s.flights;
      peakFlights = Math.max(peakFlights, s.flights);
      samples.push({ phase, live, ...s, viol: v });
      return { s, v };
    }
    // Park inside dock range by coasting to rest (release keys → DRAG settles it).
    async function dockAt(refCargo, maxIters, tag) {
      let prev = await read();
      for (let i = 0; i < maxIters; i++) {
        await page.waitForTimeout(35);
        const s = await read();
        const vx = (s.x - prev.x) / 0.035, vy = (s.y - prev.y) / 0.035, spd = Math.hypot(vx, vy);
        prev = s;
        const dx = PLANET.x - s.x, dy = PLANET.y - s.y, dist = Math.hypot(dx, dy);
        if (s.cargo < refCargo - 0.06) { console.log(`${tag} DRAIN STARTED i=${i} dist=${dist.toFixed(0)}`); return { docked: true, i, dist }; }
        if (i % 10 === 0) console.log(`${tag} i=${i} dist=${dist.toFixed(0)} spd=${spd.toFixed(0)} cargo=${s.cargo.toFixed(2)} banked=${s.banked.toFixed(2)}`);
        const want = new Set();
        if (dist > 175) {
          if (spd < 125) {
            if (dx > 20) want.add('KeyD'); else if (dx < -20) want.add('KeyA');
            if (dy > 20) want.add('KeyS'); else if (dy < -20) want.add('KeyW');
          }
        } else if (spd < 18 && dist > 150) {
          if (dx > 12) want.add('KeyD'); else if (dx < -12) want.add('KeyA');
          if (dy > 12) want.add('KeyS'); else if (dy < -12) want.add('KeyW');
          await set(want); await page.waitForTimeout(80); await set(new Set()); continue;
        }
        await set(want);
      }
      console.log(`${tag} NEVER DOCKED`);
      return { docked: false };
    }

    const boot = await read();
    console.log(`[attempt ${n}] BOOT cargo=${boot.cargo} banked=${boot.banked} total=${boot.total} build=${boot.build.sha}`);

    // === 1. MINE — manual aim at the nearest rock, fire, tractor to full ===
    await page.mouse.move(CX, CY);
    await page.mouse.down();
    let minedPath = null, rock = null;
    for (let i = 0; i < 200; i++) {
      const path = join(TMP, `mine${String(i).padStart(3, '0')}.png`);
      await page.screenshot({ path });
      rock = nearestRock(PNG.sync.read(readFileSync(path))) ?? rock;
      const s = await read();
      if (rock) await aimAt(rock.x, rock.y);
      if (i % 8 === 0) console.log(`MINE i=${i} pos=(${s.x.toFixed(0)},${s.y.toFixed(0)}) cargo=${s.cargo.toFixed(2)} pips=${s.pips}/${s.slots} rock=${rock ? Math.round(rock.dist) : '-'}`);
      if (s.cargo >= 1.95) { minedPath = path; console.log('HOLD FULL i=', i); break; }
      const want = new Set();
      if (rock) {
        if (rock.dist > 165) {
          if (rock.x < CX - 14) want.add('KeyA'); else if (rock.x > CX + 14) want.add('KeyD');
          if (rock.y < CY - 14) want.add('KeyW'); else if (rock.y > CY + 14) want.add('KeyS');
        } else if (rock.dist < 110) {
          if (rock.x < CX) want.add('KeyD'); else want.add('KeyA');
          if (rock.y < CY) want.add('KeyS'); else want.add('KeyW');
        }
      } else { want.add('KeyA'); want.add('KeyS'); }
      await set(want);
      if (rock) await aimAt(rock.x, rock.y);
      await page.waitForTimeout(45);
    }
    await page.mouse.up();
    await set(new Set());
    const mined = await read();
    console.log(`MINED cargo=${mined.cargo} pips=${mined.pips}/${mined.slots} banked=${mined.banked}`);
    if (mined.cargo < 1.9) throw new Error(`mining did not fill the hold (cargo ${mined.cargo})`);
    if (minedPath) writeFileSync(join(TMP, 'phase-mined.png'), readFileSync(minedPath));
    else await shot('phase-mined');
    await sample('mined', false);

    // === 2. RETURN + DOCK — real return; drain starts when parked in range ===
    const dock1 = await dockAt(mined.cargo, 360, 'DOCK');
    await set(new Set());
    if (!dock1.docked) throw new Error('failed to dock after mining');
    await sample('docked', true);
    await shot('phase-docked');

    const bankBeforeDrain = (await read()).banked; // bank at the start of the deposit
    let oneTick = null; // the single-tick courier-vs-bank measurement (taken in phase 5)

    // Live-drain sampling down to half the hold (screenshots + per-frame checks).
    // Interrupt promptly so the hold freezes with a WHOLE ore still aboard (pips=1).
    let midDrainShot = null;
    const halfTarget = 1.65; // interrupt with ≥1 whole ore still held (pips=1 visible)
    for (let i = 0; i < 80; i++) {
      await page.waitForTimeout(26);
      const { s } = await sample('drain', true);
      if (i % 3 === 0) console.log(`DRAIN i=${i} cargo=${s.cargo.toFixed(3)} banked=${s.banked.toFixed(3)} pips=${s.pips} total=${s.total} fl=${s.flights}`);
      if (!midDrainShot && s.cargo <= 1.6 && s.flights > 0) midDrainShot = await shot('phase-mid-drain');
      if (s.cargo <= halfTarget) { console.log(`reached half i=${i} cargo=${s.cargo.toFixed(3)}`); break; }
    }
    if (!midDrainShot) await shot('phase-mid-drain');

    // === 3. INTERRUPT — thrust away; the parkSpeed gate halts the drain at once ===
    // Boost on the first strides so speed clears parkSpeed (40) in one step and the
    // drain stops almost immediately — the hold freezes with its whole ore aboard.
    for (let i = 0; i < 20; i++) {
      const s = await read();
      const want = new Set();
      if (s.x - PLANET.x >= 0) want.add('KeyD'); else want.add('KeyA');
      if (s.y - PLANET.y >= 0) want.add('KeyS'); else want.add('KeyW');
      if (i < 6) want.add('ShiftLeft'); // boost out of dock range fast
      await set(want);
      await page.waitForTimeout(30);
    }
    await set(new Set());
    let prevI = await read();
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(35);
      const s = await read();
      const spd = Math.hypot(s.x - prevI.x, s.y - prevI.y) / 0.035;
      prevI = s;
      if (spd < 18 && Math.hypot(s.x - PLANET.x, s.y - PLANET.y) > 210) break;
    }
    const frozen0 = await read();
    let cargoDrift = 0; const frozenViol = [];
    for (let i = 0; i < 18; i++) {
      const { s, v } = await sample('frozen', false);
      cargoDrift = Math.max(cargoDrift, Math.abs(s.cargo - frozen0.cargo));
      if (s.banked > frozen0.banked + 0.03) v.push(`bank crept while undocked: ${frozen0.banked.toFixed(3)}->${s.banked.toFixed(3)}`);
      frozenViol.push(...v);
      await page.waitForTimeout(33);
    }
    await shot('phase-interrupt');
    const afterFrozen = await read();
    console.log(`INTERRUPT frozenCargo=${frozen0.cargo.toFixed(3)} drift=${cargoDrift.toFixed(4)} banked=${frozen0.banked} viol=${JSON.stringify(frozenViol)}`);
    if (frozen0.cargo < 0.4) throw new Error(`interrupt landed with too little hold left (${frozen0.cargo})`);

    // === 4. RE-DOCK — real return; the drain resumes ===
    const redock = await dockAt(afterFrozen.cargo, 360, 'REDOCK');
    await set(new Set());
    if (!redock.docked) throw new Error('failed to re-dock');
    await sample('redocked', true);
    await shot('phase-redocked');

    // ONE DEPOSIT TICK measured precisely on the RESUMED deposit: an in-page rAF
    // loop over a single DEPOSIT.flightInterval window (0.15 s) counting courier
    // spawns (flights() rising edge) against the exact bank delta — the "flight
    // chunks vs bank delta in one tick" the brief asks to put in the caption.
    oneTick = await page.evaluate(async () => {
      const s = window.__oreHudStage, w = window.__planetRush, d = window.__oreDepositStage;
      const startBank = s.readout().banked, startTick = w.ticks;
      let spawns = 0, prev = d.flights(), peak = prev, frames = 0;
      const t0 = performance.now();
      await new Promise((res) => {
        const tick = () => {
          frames++;
          const f = d.flights();
          if (f > prev) spawns += (f - prev);
          prev = f; peak = Math.max(peak, f);
          if (performance.now() - t0 >= 150) return res();
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return { spawns, peak, frames, bankDelta: +(s.readout().banked - startBank).toFixed(4), simTicks: w.ticks - startTick };
    });
    console.log('ONE-TICK', JSON.stringify(oneTick));

    // === 5. FINISH — drain to empty; indicator hidden, TOTAL risen ===
    for (let i = 0; i < 90; i++) {
      await page.waitForTimeout(28);
      const { s } = await sample('finishing', true);
      if (i % 5 === 0) console.log(`FINISH i=${i} cargo=${s.cargo.toFixed(3)} banked=${s.banked.toFixed(3)} pips=${s.pips} hidden=${s.hidden} total=${s.total} fl=${s.flights}`);
      if (s.cargo <= 0.001 && s.hidden) break;
    }
    await set(new Set());
    await page.waitForTimeout(200);
    await sample('empty', false);
    await shot('phase-empty');
    const done = await read();
    console.log(`DONE cargo=${done.cargo} banked=${done.banked} pips=${done.pips} hidden=${done.hidden} total=${done.total}`);

    // ── validate this attempt ─────────────────────────────────────────────
    const allViol = samples.flatMap((s) => (s.viol || []).map((v) => `[${s.phase}] ${v}`));
    const conserved = { bankBefore: mined.banked, minedHold: mined.cargo, finalBank: done.banked,
      expectedFinalBank: mined.banked + mined.cargo, ok: Math.abs(done.banked - (mined.banked + mined.cargo)) < 0.05 };
    const ok = mined.cargo >= 1.9 && conserved.ok && allViol.length === 0 && cargoDrift < 0.05
      && done.cargo <= 0.01 && done.hidden && frozenViol.length === 0 && errs.length === 0;
    const summary = {
      build: boot.build, planet: PLANET,
      minedCargo: mined.cargo, minedPips: mined.pips, minedSlots: mined.slots,
      conserved,
      courier: { totalBankDelta: +(done.banked - bankBeforeDrain).toFixed(3), totalCourierSpawns: courierSpawns,
        peakFlights, oneTick, flightIntervalS: 0.15, drainRatePerS: 2 },
      frozen: { cargoDrift: +cargoDrift.toFixed(4), cargo: +frozen0.cargo.toFixed(3), banked: frozen0.banked, violations: frozenViol },
      done: { cargo: done.cargo, banked: done.banked, pips: done.pips, hidden: done.hidden, total: done.total },
      samples: samples.length, violations: allViol, errs: errs.slice(0, 6), ok,
    };
    if (ok) {
      // Promote this attempt's frames to the evidence dir + build crops/strip.
      for (const nm of ['mined', 'docked', 'mid-drain', 'interrupt', 'redocked', 'empty'])
        writeFileSync(join(OUT, `ore-truth-${nm}.png`), readFileSync(join(TMP, `phase-${nm}.png`)));
      const cropPaths = [];
      for (const [src, name] of [['phase-mined', 'mined'], ['phase-mid-drain', 'mid-drain'], ['phase-interrupt', 'interrupt'], ['phase-empty', 'empty']]) {
        const cs = join(TMP, `crop-ship-${name}.png`);
        cropSave(join(TMP, src + '.png'), cs, CX - 150, CY - 60, 300, 180);
        cropPaths.push(cs);
      }
      stitchV(cropPaths, join(OUT, 'ore-truth-strip.png'));
      writeFileSync(join(TMP, 'summary.json'), JSON.stringify(summary, null, 2));
    }
    return { ok, summary, samples };
  } finally {
    await ctx.close();
  }
}

// ── retry until one clean cycle is captured ─────────────────────────────────
const browser = await chromium.launch();
let result = null;
try {
  for (let n = 1; n <= 5; n++) {
    try {
      const r = await attempt(browser, n);
      console.log(`[attempt ${n}] ok=${r.ok} viol=${r.summary.violations.length} conserved=${r.summary.conserved.ok} mined=${r.summary.minedCargo}`);
      if (r.ok) { result = r; break; }
      result = r; // keep the last for reporting even if imperfect
    } catch (e) {
      console.log(`[attempt ${n}] threw: ${String(e).split('\n')[0]}`);
    }
  }
} finally { await browser.close(); }

if (!result) { console.log('NO RESULT'); process.exit(1); }
console.log('SUMMARY', JSON.stringify(result.summary, null, 2));
console.log('AGREEMENT VIOLATIONS:', result.summary.violations.length ? result.summary.violations : 'NONE');
console.log('SAMPLE TABLE (phase | cargo | pips | banked | TOTAL | flights):');
for (const s of result.samples)
  console.log(`  ${s.phase.padEnd(10)} cargo=${(s.cargo ?? 0).toFixed(3)} pips=${s.pips ?? '-'} banked=${(s.banked ?? 0).toFixed(3)} TOTAL=${s.total} fl=${s.flights}`);
process.exit(result.ok ? 0 : 2);
