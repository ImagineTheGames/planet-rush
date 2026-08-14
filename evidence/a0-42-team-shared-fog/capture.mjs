/**
 * a0-42 — capture the shared-vision evidence frames. Run from the repo root:
 *
 *   npx vite build && npx vite preview --port 4194 --strictPort   # this branch
 *   # …and the same in a worktree at origin/main, on 4195, for frame 1
 *   node evidence/a0-42-team-shared-fog/capture.mjs
 *
 * Frames 2–5 come from 4194, frame 1 from 4195, so the "before" is the real
 * pre-change bundle rendering the same frozen match at the same tick rather than
 * a reconstruction. Everything the frames show is computed by the shipped
 * pipeline; `__minimapStage` only STAGES sim data (a ship position, the sim's own
 * `updateSensory`), exactly as `buildSatellite`/`killSatellite` do for feature f1.
 */
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'evidence/a0-42-team-shared-fog';
mkdirSync(OUT, { recursive: true });

const TEAMS = '/?debug=1&freeze=1&sides=2';
const VIEW = { width: 1280, height: 800 };

const browser = await chromium.launch();

/** Boot a frozen TEAMS scene, run `stage` against the debug seams, screenshot the
 *  minimap overlay. */
async function shot(port, name, stage) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}${TEAMS}`);
  await page.waitForFunction(() => window.__planetRush?.frozen === true, null, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  const staged = stage ? await page.evaluate(stage) : null;
  // The minimap's content layer is throttled on SIM TICKS, which a frozen scene
  // never advances — so open the centred overlay (the `M` toggle, GDD §2.4). The
  // rect change forces the one rebuild, and the overlay is the legible read.
  await page.keyboard.press('m');
  const settle = () =>
    page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))),
    );
  await settle();
  await settle();
  const mm = await page.evaluate(() => window.__minimapStage?.state?.() ?? null);
  const p = PNG.sync.read(await page.screenshot());
  const X = Math.round(mm.rect.x) - 6;
  const Y = Math.round(mm.rect.y) - 6;
  const W = Math.round(mm.rect.width) + 12;
  const H = Math.round(mm.rect.height) + 12;
  const c = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = ((Y + y) * p.width + X + x) * 4;
      const j = (y * W + x) * 4;
      c.data[j] = p.data[i];
      c.data[j + 1] = p.data[i + 1];
      c.data[j + 2] = p.data[i + 2];
      c.data[j + 3] = 255;
    }
  }
  writeFileSync(`${OUT}/${name}.png`, PNG.sync.write(c));
  console.log(
    `${name.padEnd(34)} coverage=${mm.coverageCount} stations=${mm.stationCount} ships=${mm.shipCount} ore=${mm.oreCount}`,
    staged ? JSON.stringify(staged) : '',
  );
  await ctx.close();
}

// 1 + 2 — the same Teams match, same frozen tick, on both codebases.
await shot(4195, '1-before-per-player-fog', null);
await shot(4194, '2-after-team-shared-fog', null);

// 3 — the teammate parked on a field no disc of the side reaches: LIVE coverage.
await shot(4194, '3-ally-scouting-live-coverage', () => window.__minimapStage.stageAllyScout(true));

// 4 — the teammate flew home: their disc is gone and the field is still drawn,
//     in the remembered dimming.
await shot(4194, '4-ally-home-field-remembered', () => window.__minimapStage.stageAllyScout(false));

// 5 — the collapse: the tick the teammate's ship dies, their coverage goes too.
await shot(4194, '5-ally-dead-coverage-collapsed', () => {
  const scout = window.__minimapStage.stageAllyScout(true);
  const killed = window.__minimapStage.killAlly();
  return { scout, killed };
});

await browser.close();
