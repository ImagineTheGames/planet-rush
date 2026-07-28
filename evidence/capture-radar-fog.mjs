/**
 * evidence/capture-radar-fog.mjs — feature f1 evidence: the minimap is fog-of-war,
 * a radar satellite BUYS sight, and that sight can be SHOT DOWN. OWNER: QA Manager.
 *
 * Three states, one continuous booted client (?debug=1, LIVE loop — no freeze — so
 * `__planetRush.ticks` advances and the collapse can be captioned on a real tick):
 *
 *   1. minimap-fog      — no live satellite: the map dark, own surroundings lit, a
 *                         distant enemy (provably parked at enemyDist, still in the
 *                         arena) NOT on the map. Enemy dots shown = 0.
 *   2. radar-coverage   — the satellite built: a LARGE coverage disc on the map, the
 *                         SAME distant enemy now a dot, the satellite itself a dot.
 *   3. satellite-killable — the satellite killed: its coverage disc collapses the
 *                         same tick and the enemy dot vanishes. Captioned tick numbers.
 *
 * The seam (`__minimapStage.buildSatellite/killSatellite`) STAGES sim data only — the
 * fog itself is computed by the real pipeline (src/sim/sensing → feedMinimapFog → the
 * pure scene → the drawn layer), so the shot proves the shipped wiring, not the seam.
 * killSatellite zeroes the satellite's HP but leaves the enemy parked, so all three
 * shots share ONE enemy at ONE distance. The minimap is expanded with a REAL click
 * (the p1a rule) so the fog reads at size. A QA caption band (top) carries the live
 * tick + fog-gated counts read back off the seam; it is a QA annotation, not game UI.
 *
 * NB (honest scope): the in-world orbiting satellite BODY with its dish sweep is NOT
 * wired into src/render yet (art exists in src/art/satellite.ts; render is a flagged
 * cross-lane follow-up). On the live client the satellite is a MINIMAP dot + coverage
 * disc. This evidence attests the minimap fog story, which is what f1 shipped.
 *
 * Usage: EVIDENCE_BASE_URL=http://localhost:4173 node evidence/capture-radar-fog.mjs
 * Launch under the sandboxed-Chromium LD_LIBRARY_PATH (see the QA memory).
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';
mkdirSync(OUT, { recursive: true });

const VIEW = { width: 1280, height: 800 };

/** Read the drawn minimap counts + the live sim-tick in one hop. */
async function readState(page) {
  return page.evaluate(() => {
    const s = window.__minimapStage.state();
    const pr = window.__planetRush;
    return { ...s, ticks: pr && typeof pr.ticks === 'number' ? pr.ticks : null };
  });
}

/** Paint a QA caption band across the top of the page, then screenshot the frame. */
async function capture(page, file, lines) {
  await page.evaluate((text) => {
    let el = document.getElementById('__qa_caption');
    if (!el) {
      el = document.createElement('div');
      el.id = '__qa_caption';
      el.style.cssText =
        'position:fixed;left:0;top:0;width:100%;z-index:99999;background:rgba(6,10,16,0.86);' +
        'color:#d7e6f5;font:13px/1.5 ui-monospace,Menlo,monospace;padding:8px 14px;' +
        'white-space:pre;border-bottom:1px solid #2b6cb0;letter-spacing:0.2px;';
      document.body.appendChild(el);
    }
    el.textContent = text;
  }, lines.join('\n'));
  await page.waitForTimeout(120); // let the caption paint
  await page.screenshot({ path: join(OUT, file) });
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

const readback = {};
try {
  await page.goto(`${BASE}/?debug=1`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__minimapStage?.state === 'function', undefined, { timeout: 20_000 });
  await page.waitForFunction(
    () => { const s = window.__minimapStage?.state(); return !!s && s.rect.width > 0 && s.stationCount > 0; },
    undefined, { timeout: 20_000 },
  );

  // --- Real input: click the collapsed corner to EXPAND the overlay (fog at size).
  const collapsed = await readState(page);
  await page.mouse.click(collapsed.rect.x + collapsed.rect.width / 2, collapsed.rect.y + collapsed.rect.height / 2);
  await page.waitForFunction(() => window.__minimapStage.state().expanded === true, undefined, { timeout: 10_000 });

  // --- Prime a parked enemy: build → confirm reveal → kill → confirm collapse. The
  //     enemy stays parked after the kill, so shot 1 shows a KNOWN distant enemy the
  //     fog does not reveal.
  const base = await readState(page);
  const staged = await page.evaluate(() => window.__minimapStage.buildSatellite());
  if (!staged) throw new Error('buildSatellite returned null (no local station / no enemy)');
  readback.geometry = staged;
  await page.waitForFunction(
    (b) => { const s = window.__minimapStage.state(); return s.satelliteCount > b.satelliteCount && s.coverageCount > b.coverageCount && s.shipCount > b.shipCount; },
    base, { timeout: 10_000 },
  );
  const primePeak = await readState(page); // high-water while the satellite lives
  await page.evaluate(() => window.__minimapStage.killSatellite());
  await page.waitForFunction(
    (b) => { const s = window.__minimapStage.state(); return s.coverageCount < b.coverageCount && s.shipCount < b.shipCount; },
    primePeak, { timeout: 10_000 },
  );

  // ===== 1) minimap-fog ====================================================
  const fog = await readState(page);
  readback.fog = fog;
  await capture(page, 'radar-1-minimap-fog.png', [
    'QA EVIDENCE — minimap-fog  (feature f1, live ?debug=1)',
    `tick ${fog.ticks}   ·   coverage discs: ${fog.coverageCount} (own ship + station reach)   ·   enemy dots on map: ${fog.shipCount}`,
    `no live satellite: the overlay is dark vacuum + faint hatch, only the own slice lit. An enemy contact is parked at`,
    `${Math.round(staged.enemyDist)}u (> ship sensor 520, > station 300) — it is in the arena, but the strategic map cannot place it. Fog.`,
  ]);

  // ===== 2) radar-coverage =================================================
  const built = await page.evaluate(() => window.__minimapStage.buildSatellite());
  readback.geometry2 = built;
  await page.waitForFunction(
    (b) => { const s = window.__minimapStage.state(); return s.coverageCount > b.coverageCount && s.shipCount > b.shipCount && s.satelliteCount > b.satelliteCount; },
    fog, { timeout: 10_000 },
  );
  const cov = await readState(page);
  readback.coverage = cov;
  await capture(page, 'radar-2-radar-coverage.png', [
    'QA EVIDENCE — radar-coverage  (feature f1, live ?debug=1)',
    `tick ${cov.ticks}   ·   coverage discs: ${cov.coverageCount}   ·   enemy dots on map: ${cov.shipCount}   ·   satellite dots: ${cov.satelliteCount}`,
    `the satellite (sensor range ${Math.round(staged.satRange)}u) paints a LARGE coverage disc; the SAME enemy at ${Math.round(staged.enemyDist)}u is now a dot`,
    'under it. (In-world dish body is not yet render-wired — the satellite reads as a minimap dot here.)',
  ]);

  // ===== 3) satellite-killable =============================================
  const beforeKill = await readState(page);
  await page.evaluate(() => window.__minimapStage.killSatellite());
  await page.waitForFunction(
    (b) => { const s = window.__minimapStage.state(); return s.coverageCount < b.coverageCount && s.shipCount < b.shipCount; },
    cov, { timeout: 10_000 },
  );
  const killed = await readState(page);
  readback.beforeKill = beforeKill;
  readback.killed = killed;
  await capture(page, 'radar-3-satellite-killable.png', [
    'QA EVIDENCE — satellite-killable  (feature f1, live ?debug=1)',
    `satellite killed at tick ${beforeKill.ticks} → drawn collapse by tick ${killed.ticks} (the minimap redraw is throttled ~1/sec)`,
    `coverage discs ${beforeKill.coverageCount} → ${killed.coverageCount}   ·   enemy dots on map ${beforeKill.shipCount} → ${killed.shipCount}   ·   satellite dots ${beforeKill.satelliteCount} → ${killed.satelliteCount}`,
    'the satellite is dead: its LARGE coverage disc is gone and the dots it bought VANISH — the strategic map is dark again.',
  ]);

  readback.pageErrors = errs;
  writeFileSync(join(OUT, 'radar-fog-readback.json'), JSON.stringify(readback, null, 2));
  console.log(JSON.stringify(readback, null, 2));
} finally {
  await browser.close();
}
if (errs.length) { console.error('PAGE ERRORS:', errs.join('\n')); }
