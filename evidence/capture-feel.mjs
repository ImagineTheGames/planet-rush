/**
 * evidence/capture-feel.mjs — p4 "the game answers your finger" evidence.
 * OWNER: QA Manager. Drives the SHIPPED ?debug=1 press seams and reads the
 * motion back, then screenshots the drawn client. No game/test code touched.
 *
 * press-feedback (freeze=1, static scene):
 *   - PRESSED  — Build wheel open with ore; TURRET wedge pressed through the real
 *     press path (a genuine pointer held on the wedge + the shipped __pressStage
 *     seam), captured while scale<1 & glow>0 & reject==0 (the "your finger
 *     landed" tell).
 *   - REJECTED — Build wheel open with the bank drained (0 ore); TURRET is
 *     disabled, a press red-flashes + shakes (reject>0, glow==0) and spends
 *     nothing. Captured mid-rejection.
 *   Stitched two-up so both states sit side by side, unmistakably different.
 *
 * repair-confirmation (NO freeze — a REAL heal must step the sim):
 *   Damage the OWN core, open the Build wheel, press REPAIR through the real
 *   pointer path. The core heals every tick; the HUD's own detectConfirmations
 *   sees the rise and floats the ore cost toward the bank + shimmers the core.
 *   Capture a mid-repair frame (cost floating, core pip up), caption the
 *   before/after core HP + bank read straight off the sim seams.
 *
 * Usage: node evidence/capture-feel.mjs [press-feedback repair-confirmation]
 *   env EVIDENCE_BASE_URL (default http://localhost:4191)
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4191';

// WHEEL_ORDER = [turret, shield, repair, upgrade, bank]  (src/ui/build-wheel.ts)
const TURRET = 0;
const REPAIR = 2;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
const frames = (page, n = 2) =>
  page.evaluate(
    (k) => new Promise((r) => { let i = 0; const s = () => { i++; i >= k ? r() : requestAnimationFrame(s); }; requestAnimationFrame(s); }),
    n,
  );

/** Screen-space centre of wheel segment `index` (wheel centred in the logical
 *  viewport; matches segmentAngle + the radius clamp the view draws with). */
function segmentPoint(vp, index, frac = 0.62) {
  const cx = vp.width / 2, cy = vp.height / 2;
  const R = clamp(Math.min(vp.width, vp.height) * 0.36, 120, 230);
  const ang = -Math.PI / 2 + index * ((2 * Math.PI) / 5);
  return { x: Math.round(cx + R * frac * Math.cos(ang)), y: Math.round(cy + R * frac * Math.sin(ang)) };
}

async function waitPress(page) {
  await page.waitForFunction(() => typeof window.__pressStage?.openBuild === 'function', undefined, { timeout: 25_000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
}

/** Stitch PNGs side by side into one strip. */
function stitchH(paths, outPath, gap = 8, bg = [10, 12, 16]) {
  const imgs = paths.map((p) => PNG.sync.read(readFileSync(p)));
  const h = Math.max(...imgs.map((i) => i.height));
  const w = imgs.reduce((s, i) => s + i.width, 0) + gap * (imgs.length - 1);
  const out = new PNG({ width: w, height: h });
  for (let i = 0; i < out.data.length; i += 4) { out.data[i] = bg[0]; out.data[i + 1] = bg[1]; out.data[i + 2] = bg[2]; out.data[i + 3] = 255; }
  let ox = 0;
  for (const im of imgs) {
    const yoff = Math.floor((h - im.height) / 2);
    for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
      const si = (y * im.width + x) * 4, di = ((y + yoff) * w + (ox + x)) * 4;
      out.data[di] = im.data[si]; out.data[di + 1] = im.data[si + 1]; out.data[di + 2] = im.data[si + 2]; out.data[di + 3] = 255;
    }
    ox += im.width + gap;
  }
  writeFileSync(outPath, PNG.sync.write(out));
}

// ── press-feedback ────────────────────────────────────────────────────────────
const PRESS_FEEDBACK = {
  id: 'press-feedback',
  device: { viewport: { width: 900, height: 600 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  url: '/?debug=1&freeze=1',
  async run(page) {
    await waitPress(page);
    const vp = page.viewportSize();
    const turretPt = segmentPoint(vp, TURRET);

    // --- PRESSED: open with ore so TURRET is a live wedge, hold a real pointer on
    //     it AND drive the shipped press seam, then grab the frame while the tell
    //     is up. Re-press right before each shot so the 0.16s flash is near peak.
    await page.evaluate(() => window.__pressStage.openBuild(999));
    await frames(page, 3);
    let pressedFb = null, pressedPath = join(OUT, 'press-wedge-pressed.png');
    await page.mouse.move(turretPt.x, turretPt.y);
    await page.mouse.down();
    for (let i = 0; i < 8; i++) {
      const fb = await page.evaluate((idx) => { window.__pressStage.press('build', idx); return window.__pressStage.feedback('build', idx); }, TURRET);
      if (fb.glow > 0 && fb.scale < 1 && fb.reject === 0) {
        await page.screenshot({ path: pressedPath });
        pressedFb = await page.evaluate((idx) => window.__pressStage.feedback('build', idx), TURRET);
        if (pressedFb.glow > 0.25) break; // a strong frame; keep it
      }
      await frames(page, 1);
    }
    await page.mouse.up();

    // --- REJECTED: reopen with the bank drained so TURRET is disabled; a press
    //     must red-flash + shake and spend nothing (reject>0, glow==0).
    await page.evaluate(() => window.__pressStage.openBuild(0));
    await frames(page, 3);
    const bankBeforeReject = await page.evaluate(() => window.__pressStage.bank());
    let rejectFb = null, rejectPath = join(OUT, 'press-wedge-rejected.png');
    await page.mouse.move(turretPt.x, turretPt.y);
    await page.mouse.down();
    for (let i = 0; i < 10; i++) {
      const fb = await page.evaluate((idx) => { window.__pressStage.press('build', idx); return window.__pressStage.feedback('build', idx); }, TURRET);
      if (fb.reject > 0) {
        await page.screenshot({ path: rejectPath });
        rejectFb = await page.evaluate((idx) => window.__pressStage.feedback('build', idx), TURRET);
        if (rejectFb.reject > 0.3) break;
      }
      await frames(page, 1);
    }
    await page.mouse.up();
    const bankAfterReject = await page.evaluate(() => window.__pressStage.bank());

    stitchH([pressedPath, rejectPath], join(OUT, 'press-feedback.png'));

    const facts = { pressedFb, rejectFb, bankBeforeReject, bankAfterReject, turretPt };
    console.log('[press-feedback]', JSON.stringify(facts));
    return { skipShot: true, facts };
  },
};

// ── repair-confirmation ─────────────────────────────────────────────────────
const REPAIR_CONFIRMATION = {
  id: 'repair-confirmation',
  device: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  url: '/?debug=1',
  async run(page) {
    await waitPress(page);
    await page.waitForFunction(() => typeof window.__planetRush?.coreHp === 'function', undefined, { timeout: 20_000 });
    await page.waitForFunction(() => typeof window.__oreDepositStage?.readout === 'function', undefined, { timeout: 20_000 });
    // Past spawn protection so the repair channel actually heals.
    await page.waitForFunction(() => (window.__planetRush?.ticks ?? 0) >= 700, undefined, { timeout: 45_000 });
    const vp = page.viewportSize();
    const repairPt = segmentPoint(vp, REPAIR);

    const full = await page.evaluate(() => window.__planetRush.coreHp(0));
    // Fund the bank and park docked with the wheel open.
    await page.evaluate(() => window.__pressStage.openBuild(40));
    await frames(page, 4);
    // Damage the OWN core so REPAIR is live and there is room to heal into.
    const HIT = Math.floor(full * 0.6);
    await page.evaluate((h) => window.__planetRush.damageCore(0, h), HIT);
    let damaged = full;
    for (let i = 0; i < 60; i++) { await frames(page, 2); const hp = await page.evaluate(() => window.__planetRush.coreHp(0)); if (hp < full - 1) { damaged = hp; break; } }
    await page.evaluate(() => window.__pressStage.openBuild(40)); // keep docked + open + funded
    await frames(page, 4);
    const coreBefore = await page.evaluate(() => window.__planetRush.coreHp(0));
    const bankBefore = (await page.evaluate(() => window.__oreDepositStage.readout())).banked;

    // Press REPAIR through the REAL pointer path — this queues the repair channel,
    // which heals the core every tick.
    await page.mouse.move(repairPt.x, repairPt.y);
    await page.mouse.down();
    await page.mouse.up();

    // Burst-sample: each frame read the derived tell (floats + core shimmer) and
    // the live core/bank. Keep the frame with a repair float mid-travel while the
    // core has risen — the flagship "it did something" moment.
    const trace = [];
    let best = null;
    const bestPath = join(OUT, 'repair-confirmation.png');
    for (let i = 0; i < 140; i++) {
      await frames(page, 2);
      const snap = await page.evaluate(() => ({
        core: window.__planetRush.coreHp(0),
        bank: window.__oreDepositStage.readout().banked,
        floats: window.__pressStage.floats(),
        shimmer: window.__pressStage.coreShimmer(),
      }));
      const rf = snap.floats.find((f) => f.index === REPAIR && !f.deposit);
      const coreUp = snap.core - damaged;
      trace.push({ i, core: +snap.core.toFixed(2), bank: +snap.bank.toFixed(2), nFloats: snap.floats.length, shimmer: +snap.shimmer.toFixed(3), rfProg: rf ? +rf.progress.toFixed(2) : null });
      // Score: prefer a visible float mid-travel + shimmer + a real core rise.
      if (rf && rf.alpha > 0.15 && rf.progress > 0.15 && rf.progress < 0.75 && snap.shimmer > 0.15 && coreUp > 1) {
        const score = coreUp + snap.shimmer + rf.alpha;
        if (!best || score > best.score) {
          await page.screenshot({ path: bestPath });
          best = { score, i, core: +snap.core.toFixed(2), bank: +snap.bank.toFixed(2), shimmer: +snap.shimmer.toFixed(3), floatAmount: rf.amount, floatProgress: +rf.progress.toFixed(2), floatAlpha: +rf.alpha.toFixed(2) };
        }
      }
      // Stop once the core is essentially full again (nothing left to heal).
      if (snap.core >= full - 0.5) break;
    }
    // Fallback: if no ideal frame, grab the last state with any active float/shimmer.
    if (!best) {
      await page.screenshot({ path: bestPath });
      const last = trace[trace.length - 1] ?? {};
      best = { fallback: true, ...last };
    }
    const coreAfter = await page.evaluate(() => window.__planetRush.coreHp(0));
    const bankAfter = (await page.evaluate(() => window.__oreDepositStage.readout())).banked;

    const facts = {
      full: +full.toFixed(2), coreBefore: +coreBefore.toFixed(2), damaged: +damaged.toFixed(2),
      coreAfter: +coreAfter.toFixed(2), bankBefore: +bankBefore.toFixed(2), bankAfter: +bankAfter.toFixed(2),
      deltaCore: +(coreAfter - damaged).toFixed(2), deltaBank: +(bankBefore - bankAfter).toFixed(2),
      capturedFrame: best, repairPt, traceHead: trace.slice(0, 4), traceTail: trace.slice(-4),
    };
    console.log('[repair-confirmation]', JSON.stringify(facts));
    return { skipShot: true, facts };
  },
};

const SHOTS = [PRESS_FEEDBACK, REPAIR_CONFIRMATION];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const only = process.argv.slice(2);
  const shots = only.length ? SHOTS.filter((s) => only.includes(s.id)) : SHOTS;
  if (!shots.length) throw new Error(`no shots matched: ${only.join(', ')}`);
  const browser = await chromium.launch();
  try {
    for (const shot of shots) {
      const context = await browser.newContext(shot.device);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(BASE + shot.url, { waitUntil: 'load' });
      await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
      const result = await shot.run(page);
      if (!result?.skipShot) await page.screenshot({ path: join(OUT, `${shot.id}.png`) });
      const build = await page.evaluate(() => window.__planetRush?.build ?? null).catch(() => null);
      console.log(JSON.stringify({ id: shot.id, url: shot.url, build, errors: errors.slice(0, 4) }));
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
