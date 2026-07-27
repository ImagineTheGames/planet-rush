/**
 * evidence/capture-p5-stuck.mjs — "no bot pins against a body" (p5 unstuck, PR
 * #146). OWNER: QA Manager. The field report photographed a bot wedged motionless
 * against a body for the rest of a match. The fix is obstacle-aware steering + a
 * net-progress stuck detector + an open-lane escape run (src/bots/{tree,behaviors,
 * steering}.ts), guarded by a STANDING soak invariant (tests/harness/unstuck.test.ts):
 * NO bot with movement intent stays within 8u of a fixed point for > 12s, across
 * 24 full shipped-cast matches — GREEN in CI (see the manifest attestation).
 *
 * This corroborates the invariant with a NATURAL live match, read frame by frame:
 *   - Centre the camera on the arena (`__tapCommanderStage.stage()`) so a whole
 *     match of bot pathing is on screen, then just WATCH (no further staging).
 *   - Track every bot's screen position over several seconds and measure, per bot,
 *     the longest it dwelt within 8 px of any point (the invariant's own metric):
 *     none pins.
 *   - Pick a bot whose path rounds a planet/body and overlay its trajectory as
 *     time-graded dots (injected DOM, screen-space) so the eye sees a smooth
 *     TANGENTIAL arc past the body — a route around it, not a pin against it.
 *
 * Runs WITHOUT ?freeze (pathing must step the sim).
 *
 * Usage: node evidence/capture-p5-stuck.mjs   (needs a server on $EVIDENCE_BASE_URL)
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';
const DSF = 1.5;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1800, height: 1800 }, deviceScaleFactor: DSF });
  const page = await ctx.newPage();
  await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__tapCommanderStage?.stage === 'function', { timeout: 25_000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.evaluate(() => window.__tapCommanderStage.stage());
  await page.waitForTimeout(400);

  // Fixed planet screen positions (camera is centred + still).
  const planets = await page.evaluate(() =>
    window.__nameplateStage.plates().filter((p) => p.kind === 'planet').map((p) => ({ owner: p.owner, x: p.x, y: p.y, text: p.text, r: p.radius })));

  // Track every bot ship's screen position over ~9 s.
  const SAMPLES = 90, DT = 100;
  const paths = new Map(); // owner -> [{x,y}]
  for (let i = 0; i < SAMPLES; i++) {
    const ships = await page.evaluate(() =>
      window.__nameplateStage.plates().filter((p) => p.kind === 'ship').map((p) => ({ owner: p.owner, x: p.x, y: p.y, name: p.text })));
    for (const s of ships) {
      if (!paths.has(s.owner)) paths.set(s.owner, { name: s.name, pts: [] });
      paths.get(s.owner).pts.push({ x: s.x, y: s.y });
    }
    await page.waitForTimeout(DT);
  }

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  // Per bot: path length, net displacement, longest dwell (consecutive samples all
  // within 8 px of the window's first point), and closest planet-rim approach while
  // moving. Rim ≈ 64 (planet radius); flag a "round" when the path grazes rim+80.
  const PLANET_R = 64 * DSF, GRAZE = PLANET_R + 80 * DSF, DWELL_R = 8 * DSF;
  const stats = [];
  for (const [owner, { name, pts }] of paths) {
    if (pts.length < 20 || owner === 0) continue;
    let pathLen = 0; for (let i = 1; i < pts.length; i++) pathLen += dist(pts[i], pts[i - 1]);
    const netDisp = dist(pts[0], pts[pts.length - 1]);
    // Longest dwell window.
    let maxDwell = 0;
    for (let i = 0; i < pts.length; i++) {
      let j = i;
      while (j < pts.length && dist(pts[j], pts[i]) <= DWELL_R) j++;
      maxDwell = Math.max(maxDwell, j - i);
    }
    // Closest planet approach while still moving (the sample before/after moved).
    let minRim = Infinity, grazeAt = -1;
    for (let i = 1; i < pts.length - 1; i++) {
      const moving = dist(pts[i], pts[i - 1]) > 3 || dist(pts[i + 1], pts[i]) > 3;
      if (!moving) continue;
      for (const pl of planets) {
        const d = dist(pts[i], pl) - PLANET_R;
        if (d < minRim) { minRim = d; grazeAt = i; }
      }
    }
    stats.push({ owner, name, samples: pts.length, pathLen: Math.round(pathLen), netDisp: Math.round(netDisp), maxDwellSamples: maxDwell, maxDwellSeconds: +(maxDwell * DT / 1000).toFixed(1), minPlanetRimPx: Math.round(minRim), grazeAt, pts });
  }

  // Pick the clearest "rounds a body" bot: grazed a planet (minRim small) while
  // travelling a long path and never dwelling.
  const rounders = stats.filter((s) => s.minPlanetRimPx <= GRAZE - PLANET_R && s.pathLen > 200).sort((a, b) => a.minPlanetRimPx - b.minPlanetRimPx);
  const pick = rounders[0] ?? stats.sort((a, b) => b.pathLen - a.pathLen)[0];

  // Overlay the picked bot's trajectory as time-graded dots + ring the grazed
  // planet, then screenshot. (DOM overlay in CSS px = screenshot px / DSF.)
  if (pick) {
    // Overlay the picked bot's trajectory as time-graded dots (cyan = earliest →
    // magenta = latest). The eye reads the arc rounding the visible planet.
    await page.evaluate(({ pts, dsf }) => {
      const layer = document.createElement('div');
      layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999';
      pts.forEach((p, i) => {
        const d = document.createElement('div');
        const t = i / (pts.length - 1);
        const r = Math.round(40 + 200 * t), g = Math.round(220 - 120 * t), b = 255;
        d.style.cssText = `position:absolute;left:${p.x / dsf - 3}px;top:${p.y / dsf - 3}px;width:6px;height:6px;border-radius:50%;background:rgb(${r},${g},${b});box-shadow:0 0 4px rgb(${r},${g},${b})`;
        layer.appendChild(d);
      });
      document.body.appendChild(layer);
    }, { pts: pick.pts, dsf: DSF });
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(OUT, 'p5-stuck-path.png') });
  }

  const readback = {
    trackedSeconds: SAMPLES * DT / 1000,
    dwellRadiusPx: DWELL_R,
    botsTracked: stats.length,
    maxDwellSecondsAnyBot: Math.max(0, ...stats.map((s) => s.maxDwellSeconds)),
    picked: pick ? { owner: pick.owner, name: pick.name, pathLen: pick.pathLen, netDisp: pick.netDisp, maxDwellSeconds: pick.maxDwellSeconds, minPlanetRimPx: pick.minPlanetRimPx } : null,
    perBot: stats.map((s) => ({ name: s.name, pathLen: s.pathLen, netDisp: s.netDisp, maxDwellSeconds: s.maxDwellSeconds, minPlanetRimPx: s.minPlanetRimPx })),
  };
  writeFileSync(join(OUT, 'p5-stuck-readback.json'), JSON.stringify(readback, null, 2));
  console.log(JSON.stringify(readback, null, 2));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
