/**
 * evidence/a0-42-team-shared-fog/capture.mjs — the a0-42 evidence frames, and
 * the golden-parity control behind "FFA did not move".
 *
 * Two jobs, one script, because both need the same thing: the REAL preview
 * bundle, booted frozen so the frame is deterministic, screenshotted at the
 * golden suite's own viewports.
 *
 *   --mode=control   the two frozen golden scenes (FFA + TEAMS), nothing staged.
 *                    Run against a build of origin/main and again against the
 *                    branch: the two captures are the before/after the goldens
 *                    would see, taken on the same box with the same GPU, so a
 *                    pixel difference between them is this change and not the
 *                    runner.
 *   --mode=evidence  the four frames the brief asks for, staged through
 *                    `window.__teamFogStage` (?debug=1 only, src/main.ts):
 *                    fog / lifted / remembered / collapsed.
 *
 * Every fog decision in every frame is made by the shipped pipeline. The stage
 * writes plain sim data (a ship's position, its side, `alive`) and calls the
 * sim's own `updateSensory`; it never touches the minimap.
 *
 * Usage (a preview server must already be serving the build under test):
 *   node evidence/a0-42-team-shared-fog/capture.mjs --mode=evidence --port=4194 --out=DIR
 */

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  }),
);
const PORT = Number(args.port ?? 4194);
const OUT = args.out ?? new URL('.', import.meta.url).pathname;
const MODE = args.mode ?? 'evidence';
const BASE = `http://localhost:${PORT}`;

/** The golden suite's desktop control: 1280×800 at dpr 1 (playwright.config.ts). */
const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
/** The golden suite's landscape phone: 844×390 at dpr 3. */
const PHONE = {
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};

/**
 * A 2v2 for the evidence, through the shipped path: the debug boot reads the
 * match size the lobby last RUSHed with out of `planet-rush:matchSize`
 * (src/main.ts `readMatchSize`), so seeding that key is the same request a host
 * makes with the lobby's size control. `?sides=2` then splits it one-and-one.
 *
 * The default 8-slot scene would be a 4v4, where three OTHER teammates sit
 * around the viewer's own home and their coverage muddies the very thing the
 * frames are of. With one teammate, every disc over there is theirs.
 */
async function useMatchSize(page, n) {
  await page.addInitScript((size) => {
    try {
      window.localStorage.setItem('planet-rush:matchSize', String(size));
    } catch {
      /* storage disabled — the default size still boots */
    }
  }, n);
}

/** Boot frozen and wait the way tests/mobile/goldens.spec.ts waits: canvas
 *  attached, `frozen` true, fonts loaded, then render frames COUNTED (not timed)
 *  so the composited frame is genuinely up. */
async function bootFrozen(page, url) {
  await page.goto(BASE + url);
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => window.__planetRush?.frozen === true, undefined, { timeout: 20_000 });
  await page.evaluate(() => document.fonts?.ready);
  await settle(page);
}

/** Wait for N drawn frames (the render-settle discipline, inlined). */
async function settle(page, frames = 6) {
  await page.evaluate(
    (n) =>
      new Promise((resolve) => {
        let seen = 0;
        const tick = () => (++seen >= n ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    frames,
  );
}

async function shot(page, name) {
  const buf = await page.screenshot();
  writeFileSync(join(OUT, name), buf);
  console.log(`wrote ${name}`);
}

/**
 * Open the minimap overlay, twice, with the REAL `M` toggle (GDD §2.4's minimap
 * shortcut; `src/main.ts` MINIMAP_TOGGLE_KEY) — and this is not belt-and-braces,
 * it is required.
 *
 * The minimap's content is a CACHED texture rebuilt only every
 * `MINIMAP_REDRAW_TICKS` sim ticks, **or whenever the rect/state changes**
 * (`src/ui/minimap-view.ts`). Under `?freeze=1` the tick never advances, so the
 * picture would keep showing whatever was true at the first rebuild however many
 * times the scene is re-staged — the sim numbers would move and the pixels would
 * not. Toggling the overlay closed and open again is the state change that forces
 * an honest rebuild, through the same input path a player uses.
 *
 * The docked map is ~150 px in the corner of a 1280×800 frame; the overlay is the
 * same fog decision drawn large enough to read, which is what these frames are of.
 */
async function refreshMinimap(page) {
  // Close it first if it is open, so every call ends on an OPEN state that was
  // rebuilt just now — one toggle from docked, two from expanded.
  if (await page.evaluate(() => window.__minimapStage.state().expanded)) {
    await page.keyboard.press('KeyM');
    await settle(page);
  }
  await page.keyboard.press('KeyM');
  await settle(page);
  const s = await page.evaluate(() => window.__minimapStage.state());
  if (!s.expanded) throw new Error('the minimap overlay is not open after the toggle');
}

/** What the local viewer's fog actually reads right now — the sim's side of it
 *  from `__teamFogStage`, and what the minimap layer ACTUALLY DREW from
 *  `__minimapStage`. Printed beside every frame so the picture is backed by
 *  numbers rather than by a caption. */
async function fogState(page) {
  return page.evaluate(() => {
    const sim = window.__teamFogStage?.state() ?? null;
    const d = window.__minimapStage?.state() ?? null;
    const drawn = d
      ? {
          expanded: d.expanded,
          coverageDiscs: d.coverageCount,
          shipDots: d.shipCount,
          stationDots: d.stationCount,
          oreDots: d.oreCount,
          satelliteDots: d.satelliteCount,
        }
      : null;
    return { sim, drawn };
  });
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

if (MODE === 'control') {
  for (const [label, ctxOpts] of [
    ['desktop', DESKTOP],
    ['phone-landscape', PHONE],
  ]) {
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage();
    await bootFrozen(page, '/?debug=1&freeze=1');
    await shot(page, `control-frozen-ffa-${label}.png`);
    await bootFrozen(page, '/?debug=1&freeze=1&sides=2');
    await shot(page, `control-frozen-teams-${label}.png`);
    await ctx.close();
  }
} else {
  const ctx = await browser.newContext(DESKTOP);
  const page = await ctx.newPage();
  const log = {};

  await useMatchSize(page, 4); // 2v2 — one teammate, so every far disc is theirs
  await bootFrozen(page, '/?debug=1&freeze=1&sides=2');
  const staged = await page.evaluate(() => window.__teamFogStage.stage());
  if (!staged) throw new Error('the team-fog stage found no ally / no rival to post');
  log.staged = staged;

  // 1. BEFORE — the same tick, the same staged world, the ally on the ENEMY side.
  //    Their half of the board is dark, because a stranger's coverage is nobody's.
  await page.evaluate(() => window.__teamFogStage.share(false));
  await refreshMinimap(page);
  log.before = await fogState(page);
  await shot(page, '1-fog-ally-not-yours.png');

  // 2. AFTER — one thing changed: that ship is on your side. The fog lifts where
  //    it stands, and the rival under its sensor is on your map.
  await page.evaluate(() => window.__teamFogStage.share(true));
  await refreshMinimap(page);
  log.after = await fogState(page);
  await shot(page, '2-lifted-ally-is-yours.png');

  // 3. REMEMBERED — the ally flies over a distant field, the sim's own memory
  //    fold runs, the ally comes home. Nobody's live coverage reaches that field
  //    now; it is on the viewer's minimap because a teammate was there.
  log.scout = await page.evaluate(() => window.__teamFogStage.scout());
  await refreshMinimap(page);
  log.remembered = await fogState(page);
  await shot(page, '3-remembered-ally-scouted-ore.png');

  // 4. COLLAPSE — the tick after the teammate dies. Their disc is gone and every
  //    live dot only under it drops; the remembered geography stays.
  log.killed = await page.evaluate(() => window.__teamFogStage.killAlly());
  await refreshMinimap(page);
  log.collapsed = await fogState(page);
  await shot(page, '4-collapse-teammate-dead.png');

  writeFileSync(join(OUT, 'fog-state.json'), JSON.stringify(log, null, 2));
  console.log(JSON.stringify(log, null, 2));
  await ctx.close();
}

await browser.close();
