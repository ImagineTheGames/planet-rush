/**
 * evidence/capture-station-health-range.mjs — a0-05 evidence: **a rival station's
 * damage ring reads true at any range** (GDD §2.2, amended 2026-08-07).
 *
 * The developer, 2026-08-07: *"you can see other stations healths only when you
 * are near, it should always show the health regardless of proximity or else it
 * looks like a glitch approaching and getting far it looks like its full health
 * even if its damaged."*
 *
 * Four frames, on a REAL boot, through the real render pipeline:
 *
 *   1. damaged rival, CLOSE  (90u — inside the retired 180u `SENSOR_RANGE`)
 *   2. damaged rival, FAR    (700u — ~4× the retired gate; the frame that lied)
 *   3. healthy rival, CLOSE  (90u)
 *   4. healthy rival, FAR    (700u)
 *
 * Frame 2 is the whole point. Before this change it drew **no ring at all**, and
 * the always-visible owner-colour beacon ring underneath meant the player read
 * "no red" — which is what full health looks like. Frames 2 and 4 were the same
 * picture. They are not any more, and 1↔2 are.
 *
 * Everything is staged through `window.__stationHealthStage` (?debug=1), which
 * writes only plain sim data (`coreHp`, the local ship's `pos`) and reads the
 * geometry back so each caption states the distance and core fraction the frame
 * actually holds. The ring itself is drawn by the shipped renderer — the seam
 * cannot fake the thing it is evidence for. `?freeze=1` pins the sim so the
 * staged frame holds still.
 *
 * Usage: EVIDENCE_BASE_URL=http://localhost:4173 node evidence/capture-station-health-range.mjs
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

/** The retired gate — `2 * SHIELD.radius`. Every distance below is stated
 *  against it, because it is the number that used to decide these frames. */
const RETIRED_SENSOR_RANGE = 180;
const CLOSE = 90; // half the retired gate: the ring always drew here
/** The camera is translate-only at 1:1, so a 1280×800 viewport reaches ~640 world
 *  units sideways from the centred ship. 500u + the 64u station radius = 564 —
 *  the far end of what a player can actually SEE, and 2.8× the retired gate. */
const FAR = 500;

/** Paint a QA caption band across the top, then screenshot the frame. */
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
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(OUT, file) });
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text());
});

const readback = { retiredSensorRange: RETIRED_SENSOR_RANGE, frames: {} };
try {
  await page.goto(`${BASE}/?debug=1&freeze=1`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => typeof window.__stationHealthStage?.stage === 'function',
    undefined,
    { timeout: 20_000 },
  );

  const FRAMES = [
    {
      file: 'a0-05-1-damaged-close.png',
      core: 0.25,
      distance: CLOSE,
      title: 'damaged rival, CLOSE',
      note: 'the ring the old build also drew: owner colour whole, threat red filling clockwise from twelve.',
    },
    {
      file: 'a0-05-2-damaged-far.png',
      core: 0.25,
      distance: FAR,
      title: 'damaged rival, FAR  ← THE FRAME THAT WAS LYING',
      note: 'same core, same ring, near the far edge of what the camera reaches. Before a0-05 this drew NO ring — and the always-visible beacon ring under it read as full health.',
    },
    {
      file: 'a0-05-3-healthy-close.png',
      core: 1.0,
      distance: CLOSE,
      title: 'healthy rival, CLOSE',
      note: 'a whole ring in the owner colour, no red anywhere: full core (GDD §2.2 grammar).',
    },
    {
      file: 'a0-05-4-healthy-far.png',
      core: 1.0,
      distance: FAR,
      title: 'healthy rival, FAR',
      note: 'the control. Compare with frame 2: healthy and damaged are now different pictures at the SAME distance.',
    },
  ];

  for (const frame of FRAMES) {
    const first = await page.evaluate(
      ({ core, distance }) => window.__stationHealthStage.stage(core, distance),
      frame,
    );
    if (!first) throw new Error(`stage() returned null for ${frame.file}`);
    await page.waitForTimeout(250); // let the camera and the render loop catch up
    // Stage again (idempotent) so the projected screen point in the readback is
    // the one the CAPTURED frame holds, not the one the previous camera had.
    const staged = await page.evaluate(
      ({ core, distance }) => window.__stationHealthStage.stage(core, distance),
      frame,
    );
    await page.waitForTimeout(120);
    readback.frames[frame.file] = staged;

    const pct = Math.round(staged.coreFraction * 100);
    const mult = (staged.surfaceDistance / RETIRED_SENSOR_RANGE).toFixed(2);
    await capture(page, frame.file, [
      `QA EVIDENCE — a0-05 station health always visible  ·  ${frame.title}`,
      `slot ${staged.owner}'s home  ·  core ${pct}%  ·  surface distance ${staged.surfaceDistance}u  ` +
        `(${mult}× the RETIRED ${RETIRED_SENSOR_RANGE}u sensor range)  ·  live ?debug=1&freeze=1`,
      frame.note,
      'The ring is stroked in WORLD units and the camera is translate-only (no zoom), so near and far are the same pixels.',
    ]);
  }

  readback.pageErrors = errs;
  writeFileSync(join(OUT, 'a0-05-station-health-readback.json'), JSON.stringify(readback, null, 2));
  console.log(JSON.stringify(readback, null, 2));
} finally {
  await browser.close();
}
if (errs.length) {
  console.error('PAGE ERRORS:', errs.join('\n'));
}
