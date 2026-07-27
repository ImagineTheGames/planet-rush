/**
 * evidence/capture-p5-noturret.mjs — "the turret laser is gone" (p5 turret-flash,
 * PR #141). OWNER: QA Manager. The developer saw a transient LINE from a firing
 * turret to its target (beam-era geometry: muzzle length = distance-to-target,
 * hitPoint AT the target). The fix makes the muzzle a short flare off the barrel
 * (TURRET.muzzleFlashLength = 16, hitPoint = null); a turret's SHOT is a pooled
 * projectile (a travelling dot), never a standing line.
 *
 * This witnesses the absence through a full firing cycle, two ways:
 *
 *   1. GEOMETRY (the shipped `window.__planetRush.muzzles` seam — combat-view's
 *      `muzzleFlashes`): drive a REAL firefight and collect every turret muzzle the
 *      client drew. Attest that EVERY record is a ~16-unit stub (|end−origin| ≈ 16)
 *      with hit === null — never a segment reaching the ~130-u-away target. A laser
 *      would read length ≈ distance and hit === target; none do.
 *   2. VISUAL: stage the LOCAL home turret + a parked attacker ~130 u off the west
 *      rim (the __healthbarStage.damageEnemy seam, re-parked each frame), so the
 *      camera sits on the engagement. Burst tight clipped frames; keep the ones
 *      where the home turret fired and a red projectile dot is in flight in the gap
 *      between turret and attacker. LOOK: a stub at the barrel + a travelling dot,
 *      with clean empty space between them — no line at any frame.
 *
 * Runs WITHOUT ?freeze (a real shot must step the sim).
 *
 * Usage: node evidence/capture-p5-noturret.mjs   (needs a server on $EVIDENCE_BASE_URL)
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';
const isRed = (r, g, b) => r > 150 && g < 95 && b < 95;
const clampClip = (c, vp) => {
  const x = Math.max(0, Math.min(c.x, vp.width - 4));
  const y = Math.max(0, Math.min(c.y, vp.height - 4));
  return { x, y, width: Math.min(c.width, vp.width - x), height: Math.min(c.height, vp.height - y) };
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  const burstDir = '/tmp/pwnoturret';
  mkdirSync(burstDir, { recursive: true });
  const browser = await chromium.launch();
  const readback = {};

  // ── 1 · GEOMETRY across a live firefight (no staging) ─────────────────────
  {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 750 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__planetRush?.viewport?.width > 0, { timeout: 25_000 });
    const records = [];
    const shooters = new Set();
    for (let i = 0; i < 900 && records.length < 40; i++) {
      await page.waitForTimeout(80);
      const ms = await page.evaluate(() => window.__planetRush.muzzles.map((m) => ({
        shooter: m.shooter,
        len: Math.round(Math.hypot(m.end.x - m.origin.x, m.end.y - m.origin.y)),
        hasHit: m.hit !== null,
      })));
      for (const m of ms) { records.push(m); shooters.add(m.shooter); }
    }
    const lens = [...new Set(records.map((r) => r.len))];
    readback.geometry = {
      ticks: await page.evaluate(() => window.__planetRush.ticks),
      records: records.length,
      distinctShooters: [...shooters],
      distinctLengths: lens,
      maxLen: Math.max(0, ...records.map((r) => r.len)),
      anyHitPointNonNull: records.some((r) => r.hasHit),
    };
    await ctx.close();
  }

  // ── 2 · VISUAL: staged home turret firing at a parked attacker ────────────
  {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 750 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__planetRush?.viewport?.width > 0, { timeout: 25_000 });
    await page.waitForFunction(() => typeof window.__healthbarStage?.damageEnemy === 'function', { timeout: 20_000 });
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    const home = await page.evaluate(() => ({ x: window.__planetRush.shipWorld.x, y: window.__planetRush.shipWorld.y }));

    // Build a turret on the home planet (mount slot 0 → east rim): E, click the
    // TURRET wedge (top segment), E to close, then wait out the ~600-tick build.
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(300);
    const wheel = await page.evaluate(() => {
      const e = window.__planetRush?.layout?.find((x) => x.id === 'build-wheel');
      return e ? { x: e.bounds.x, y: e.bounds.y, width: e.bounds.width, height: e.bounds.height } : null;
    });
    if (!wheel) throw new Error('no build-wheel layout to click TURRET');
    // TURRET is the top segment: wheel centre, up 0.6·radius.
    await page.mouse.click(wheel.x + wheel.width / 2, wheel.y + wheel.height / 2 - (wheel.width / 2) * 0.6);
    await page.waitForTimeout(400);
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => window.__planetRush.ticks >= 720, { timeout: 30_000 });

    // Nudge the ship WEST so the parked attacker (ship + 120u) lands ~130u off the
    // FAR (west) rim — a clean gap so the turret→dot→attacker reads without a line.
    await page.keyboard.down('KeyA');
    await page.waitForFunction((h) => window.__planetRush.shipWorld.x <= h.x - 200, home, { timeout: 30_000 });
    await page.keyboard.up('KeyA');
    await page.waitForTimeout(300);

    const HOME_C = { x: home.x + 90, y: home.y };
    const readMuzzle = (hc) => {
      const pr = window.__planetRush;
      window.__healthbarStage?.damageEnemy(0.6); // re-park the attacker + keep it alive
      const near = (m) => Math.hypot(m.origin.x - hc.x, m.origin.y - hc.y) <= 170;
      const t = pr.muzzles.filter(near)[0];
      return {
        shipX: Math.round(pr.shipWorld.x),
        muzzle: t ? {
          ox: Math.round(t.origin.x), oy: Math.round(t.origin.y),
          ex: Math.round(t.end.x), ey: Math.round(t.end.y),
          len: Math.round(Math.hypot(t.end.x - t.origin.x, t.end.y - t.origin.y)),
          hit: t.hit ? { x: Math.round(t.hit.x), y: Math.round(t.hit.y) } : null,
        } : null,
      };
    };

    // Burst tight clipped frames while re-parking. Keep frames with a red projectile
    // pixel in the clip (a shot in flight) and note muzzle presence.
    const vp = page.viewportSize();
    const burst = [];
    for (let i = 0; i < 160; i++) {
      const st = await page.evaluate(readMuzzle, HOME_C);
      const psx = vp.width / 2 + (HOME_C.x - st.shipX);
      const clip = clampClip({ x: psx - 260, y: vp.height / 2 - 150, width: 380, height: 300 }, vp);
      const path = join(burstDir, `f${String(i).padStart(3, '0')}.png`);
      await page.screenshot({ path, clip });
      // Count red projectile pixels in the frame.
      const png = PNG.sync.read(readFileSync(path));
      let red = 0;
      for (let p = 0; p < png.data.length; p += 4) if (isRed(png.data[p], png.data[p + 1], png.data[p + 2])) red++;
      burst.push({ i, path, red, muzzle: st.muzzle });
      await page.waitForTimeout(20);
    }
    // Best visual: a frame with a projectile dot in flight (most red), muzzle bonus.
    const withRed = burst.filter((b) => b.red > 0).sort((a, b) => (b.red + (b.muzzle ? 50 : 0)) - (a.red + (a.muzzle ? 50 : 0)));
    const withMuzzle = burst.filter((b) => b.muzzle);
    const pickShot = withRed[0] ?? null;
    const pickFlash = withMuzzle[0] ?? null;
    if (pickShot) copyFileSync(pickShot.path, join(OUT, 'p5-noturret-shot.png'));
    if (pickFlash) copyFileSync(pickFlash.path, join(OUT, 'p5-noturret-flash.png'));
    // A wider context frame (turret + attacker + gap), full clip.
    const st = await page.evaluate(readMuzzle, HOME_C);
    const psx = vp.width / 2 + (HOME_C.x - st.shipX);
    await page.screenshot({ path: join(OUT, 'p5-noturret-scene.png'), clip: clampClip({ x: psx - 300, y: vp.height / 2 - 200, width: 520, height: 400 }, vp) });

    readback.visual = {
      home, HOME_C,
      burstFrames: burst.length,
      framesWithProjectile: burst.filter((b) => b.red > 0).length,
      framesWithMuzzle: withMuzzle.length,
      muzzleSamples: withMuzzle.slice(0, 8).map((b) => b.muzzle),
      pickShot: pickShot ? { i: pickShot.i, red: pickShot.red, muzzle: pickShot.muzzle } : null,
      pickFlash: pickFlash ? { i: pickFlash.i, muzzle: pickFlash.muzzle } : null,
    };
    await ctx.close();
  }

  writeFileSync(join(OUT, 'p5-noturret-readback.json'), JSON.stringify(readback, null, 2));
  console.log(JSON.stringify(readback, null, 2));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
