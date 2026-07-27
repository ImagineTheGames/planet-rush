/**
 * evidence/capture-p5-aim.mjs — "a strafing ship dodges bot fire" (p5 aim-error,
 * PR p5-01). OWNER: QA Manager. The v0.2.2 field report was "enemies' aim is too
 * accurate" — the projectile pivot gave bots a perfect intercept solve, so no bot
 * missed. The fix is a per-difficulty aim-error model (src/bots): angular spread
 * (`aimJitter`) + reaction latency on the predictive lead (`aimLatency`), both from
 * the sim's seeded RNG. A wider spread is a wider miss; a slower re-solve is led
 * where the target WAS. EASY sprays; HARD is tight but beatable.
 *
 * Two parts:
 *   1. The MEASUREMENT (the rigorous proof): re-run the shipped harness
 *      `tests/sim/aim-error.test.ts` and record its printed hit-rate table vs a
 *      JUKING strafer and a SITTING duck. This is the p5-01 number the doc quotes;
 *      the QA officer runs it and witnesses it GREEN.
 *   2. The EYES (corroboration): centre the camera on the commons (via
 *      `__tapCommanderStage.stage()`) where the cast converges and fights, and burst
 *      frames of the live melee. Bots' shots are red projectile DOTS; against moving
 *      hulls many fly wide — a dodgeable gun, not an aimbot. Nameplates identify the
 *      EASY and HARD shooters in frame.
 *
 * Usage: node evidence/capture-p5-aim.mjs   (needs a server on $EVIDENCE_BASE_URL)
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';
const isRed = (r, g, b) => r > 150 && g < 95 && b < 95;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const burstDir = '/tmp/pwaim';
  mkdirSync(burstDir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__tapCommanderStage?.stage === 'function', { timeout: 25_000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.evaluate(() => window.__tapCommanderStage.stage());

  // Let the cast converge on the commons and start trading fire.
  await page.waitForTimeout(4000);

  // Burst frames; score each by red projectile pixels that are OFF every ship hull
  // (a shot in open space = a miss in flight). Track ship screen positions to test.
  const vp = page.viewportSize();
  const frames = [];
  for (let i = 0; i < 80; i++) {
    const ships = await page.evaluate(() =>
      window.__nameplateStage.plates().filter((p) => p.kind === 'ship').map((p) => ({ owner: p.owner, x: p.x, y: p.y, name: p.text, suffix: p.suffix })));
    const path = join(burstDir, `f${String(i).padStart(2, '0')}.png`);
    await page.screenshot({ path });
    const png = PNG.sync.read(readFileSync(path));
    // Collect red pixels; count those farther than a hull radius (~34 device px) from
    // every ship — projectiles in open space (misses in flight).
    let red = 0, orphan = 0;
    const HULL = 40 * 2; // ~hull radius in device px at dsf 2
    for (let y = 0; y < png.height; y += 2) {
      for (let x = 0; x < png.width; x += 2) {
        const p = (y * png.width + x) * 4;
        if (!isRed(png.data[p], png.data[p + 1], png.data[p + 2])) continue;
        red++;
        const near = ships.some((s) => Math.hypot(x - s.x, y - s.y) < HULL);
        if (!near) orphan++;
      }
    }
    frames.push({ i, path, red, orphan, ships });
    await page.waitForTimeout(220);
  }

  // Best frame: the most projectile pixels in open space (shots visibly missing).
  const ranked = [...frames].sort((a, b) => b.orphan - a.orphan);
  const best = ranked[0];
  // A short consecutive sequence around the best frame (shots travelling past hulls).
  const seqStart = Math.max(0, best.i - 1);
  for (let k = 0; k < 3; k++) {
    const f = frames[seqStart + k];
    if (f) writeFileSync(join(OUT, `p5-aim-seq${k}.png`), readFileSync(f.path));
  }
  writeFileSync(join(OUT, 'p5-aim-miss.png'), readFileSync(best.path));

  const readback = {
    bestFrame: best.i,
    bestOrphanProjectilePixels: best.orphan,
    bestTotalRedPixels: best.red,
    framesWithOpenSpaceProjectiles: frames.filter((f) => f.orphan > 4).length,
    shootersInBest: best.ships.filter((s) => s.suffix).map((s) => `${s.name} ${s.suffix}`),
    note: 'hit-rate quantified by tests/sim/aim-error.test.ts; see p5-aim-harness.json',
  };
  writeFileSync(join(OUT, 'p5-aim-readback.json'), JSON.stringify(readback, null, 2));
  console.log(JSON.stringify(readback, null, 2));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
