/**
 * evidence/probe-siege.mjs — round-10 reconnaissance (NOT a deliverable).
 * OWNER: QA Manager. Answers the empirical question the round-10 gate turns on:
 * in a REAL browser match (no staging), does a turret slide to engage a
 * naturally-arrived besieger, and if so, on which planet, and is it ever on the
 * local follow-camera's screen?
 *
 * Reads only. Boots /?debug=1 LIVE (no freeze), leaves the local ship idle at
 * home, and polls the read-only seams over a full match:
 *   __planetRush.ticks, .coreHp(p) for p=0..7, .beams (turret muzzles),
 *   .shipWorld (local), __lobby.worldPlanets (home centres), __healthbarStage.bars().
 *
 * Emits per-player core-HP trajectories (siege detector), per-planet turret-beam
 * origin tracks (the slide), and how close the local camera ever gets to a
 * besieged, turret-defended planet.
 *
 * Usage: node evidence/probe-siege.mjs [seconds]
 */
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4174';
const SECONDS = Number(process.argv[2] ?? 200);

const hyp = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__planetRush?.viewport?.width > 0, undefined, { timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__planetRush?.coreHp === 'function', undefined, { timeout: 20_000 });

  const build = await page.evaluate(() => window.__planetRush?.build ?? null);
  console.log('build:', JSON.stringify(build));

  const samples = [];
  const t0 = Date.now();
  while ((Date.now() - t0) / 1000 < SECONDS) {
    const snap = await page.evaluate(() => {
      const pr = window.__planetRush;
      const cores = [];
      for (let p = 0; p < 8; p++) cores.push(pr.coreHp(p));
      const turretBeams = (pr.beams ?? [])
        .filter((b) => b.source === 'turret')
        .map((b) => ({ shooter: b.shooter, ox: b.origin.x, oy: b.origin.y, ex: b.end.x, ey: b.end.y, hit: b.hit }));
      const shipBeams = (pr.beams ?? []).filter((b) => b.source === 'ship').length;
      return {
        tick: pr.ticks,
        cores,
        sw: { x: pr.shipWorld.x, y: pr.shipWorld.y },
        turretBeams,
        shipBeams,
      };
    });
    samples.push(snap);
    await page.waitForTimeout(90);
  }

  // ---- analysis ----
  // Per-player core trajectory: full at start, min seen, and "siege windows" where
  // it dropped between consecutive samples.
  const first = samples[0].cores;
  const perPlayer = [];
  for (let p = 0; p < 8; p++) {
    let min = Infinity, drops = 0, totalDrop = 0, firstDropTick = null, lastDropTick = null;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1].cores[p], b = samples[i].cores[p];
      if (a == null || b == null) continue;
      if (b < min) min = b;
      if (b < a - 0.01) {
        drops++; totalDrop += a - b;
        if (firstDropTick == null) firstDropTick = samples[i].tick;
        lastDropTick = samples[i].tick;
      }
    }
    perPlayer.push({ p, start: first[p], min: min === Infinity ? null : +min.toFixed(1), drops, totalDrop: +totalDrop.toFixed(1), firstDropTick, lastDropTick });
  }

  // Cluster all turret-beam origins into planet centres (origins sit on a rim, so
  // any two within ~180u belong to the same planet). Centre = mean of its origins.
  const clusters = [];
  for (const s of samples) {
    for (const tb of s.turretBeams) {
      let c = clusters.find((cl) => hyp(cl.cx, cl.cy, tb.ox, tb.oy) < 180);
      if (!c) { c = { sx: 0, sy: 0, n: 0, cx: tb.ox, cy: tb.oy, shooter: tb.shooter }; clusters.push(c); }
      c.sx += tb.ox; c.sy += tb.oy; c.n++; c.cx = c.sx / c.n; c.cy = c.sy / c.n;
    }
  }
  // Second pass: per-cluster orbit-angle track over time (origin bearing from centre)
  // and target bearing (end from centre), so a slide = orbit converging on bearing.
  const perTurret = clusters.map((cl) => ({ shooter: cl.shooter, cx: Math.round(cl.cx), cy: Math.round(cl.cy), frames: 0, track: [] }));
  let turretBeamFrames = 0;
  for (const s of samples) {
    if (s.turretBeams.length) turretBeamFrames++;
    for (const tb of s.turretBeams) {
      let bi = -1, bd = Infinity;
      clusters.forEach((cl, i) => { const d = hyp(cl.cx, cl.cy, tb.ox, tb.oy); if (d < bd) { bd = d; bi = i; } });
      if (bi < 0 || bd > 180) continue;
      const cl = clusters[bi];
      perTurret[bi].frames++;
      perTurret[bi].track.push({
        tick: s.tick,
        orbit: +Math.atan2(tb.oy - cl.cy, tb.ox - cl.cx).toFixed(3),
        bearing: +Math.atan2(tb.ey - cl.cy, tb.ex - cl.cx).toFixed(3),
        localDist: Math.round(hyp(s.sw.x, s.sw.y, cl.cx, cl.cy)),
      });
    }
  }

  const summary = {
    seconds: SECONDS, samples: samples.length,
    lastTick: samples[samples.length - 1].tick,
    localSpawn: samples[0].sw,
    localFinal: samples[samples.length - 1].sw,
    perPlayer,
    turretBeamFrames,
    turretClusters: perTurret.map((r) => {
      const orbits = r.track.map((t) => t.orbit);
      return {
        centre: { x: r.cx, y: r.cy }, shooter: r.shooter, frames: r.frames,
        orbitSpan: orbits.length ? +(Math.max(...orbits) - Math.min(...orbits)).toFixed(3) : null,
        minLocalDist: r.track.length ? Math.min(...r.track.map((t) => t.localDist)) : null,
        track: r.track,
      };
    }),
    errors: errors.slice(0, 5),
  };
  console.log('SUMMARY:', JSON.stringify(summary, null, 2));
  writeFileSync('/tmp/probe-siege.json', JSON.stringify({ summary, samples }, null, 2));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
