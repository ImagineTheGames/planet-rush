/**
 * evidence/capture-u7-match-hud.mjs — u7-07 evidence: the in-match HUD, before and
 * after the Gantry/Bone pass. OWNER: UI Engineer.
 *
 * The developer judges this brief by playing it, so every frame here is the REAL
 * booted bundle at a REAL viewport, driven through the `?debug=1` live-stage seams
 * (`__nameplateStage`, `__tapCommanderStage`, `__repairStage`) — never a mock and
 * never a screenshot of a unit test.
 *
 * Three profiles, because the match HUD is the hardest case in the game and a
 * desktop frame speaks for none of the others:
 *
 *   desktop          1280×800  dpr 1    no touch  — the controls strip is here
 *   phone-landscape   844×390  dpr 3    touch     — sticks, FIRE, minimap, no strip
 *   phone-portrait    390×844  dpr 3    touch     — held portrait, so the whole root
 *                                                   goes through the landscape lock's
 *                                                   90° rotation
 *
 * Three states per profile, chosen for what each can fail that the others cannot:
 *
 *   hud    the resting HUD — ore TOTAL, wave clock, HOME, minimap, nameplates,
 *          over-ship bars, and (desktop only) the controls strip
 *   wheel  the Build & Upgrade wheel open with the SPEND onboarding prompt live —
 *          the known collision the brief names, at the width it happens at
 *   alarm  the under-attack alarm: the threat-red screen frame and, when home is
 *          off-screen, the arrow pointing at it
 *
 * Usage:
 *   EVIDENCE_BASE_URL=http://localhost:4173 EVIDENCE_TAG=before \
 *     node evidence/capture-u7-match-hud.mjs
 *
 * Writes evidence/images/u7-gantry-match-hud/<tag>-<profile>-<state>.png and prints
 * a per-frame readout (viewport, what the seams reported) so a caption can quote
 * numbers rather than adjectives.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images', 'u7-gantry-match-hud');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';
const TAG = process.env.EVIDENCE_TAG ?? 'after';
mkdirSync(OUT, { recursive: true });

const PROFILES = [
  { key: 'desktop', vw: 1280, vh: 800, dpr: 1, touch: false },
  { key: 'phone-landscape', vw: 844, vh: 390, dpr: 3, touch: true },
  { key: 'phone-portrait', vw: 390, vh: 844, dpr: 3, touch: true },
];

/** A REAL press: a synthesized `pointerdown` into the same canvas handler a mouse
 *  click / thumb tap crosses (the p1a real-input rule) — never a debug order. */
async function realTap(page, at) {
  await page.evaluate((p) => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas to tap');
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        clientX: p.x,
        clientY: p.y,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
        bubbles: true,
        cancelable: true,
      }),
    );
  }, at);
}

/**
 * A LOGICAL point, converted to the CLIENT (physical CSS) point a real press has to
 * land on. Identity on desktop and on any already-landscape viewport; on a phone
 * held PORTRAIT the landscape lock rotates the whole root 90°, so pressing the raw
 * logical point presses somewhere else entirely. Uses the client's own
 * `__minimapStage.physicalPoint` seam — the same rotation every real press crosses
 * — rather than re-deriving the transform here.
 */
async function toClient(page, at) {
  return page.evaluate((p) => {
    const phys = window.__minimapStage?.physicalPoint(p.x, p.y) ?? p;
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return { x: phys.x + rect.left, y: phys.y + rect.top };
  }, at);
}

/** Wait for N drawn frames rather than N milliseconds — the honest unit on a
 *  software-GL container, where 500 ms can be no frames at all. */
async function frames(page, n = 4) {
  await page.evaluate(
    (count) =>
      new Promise((resolve) => {
        let left = count;
        const step = () => (left-- <= 0 ? resolve(null) : requestAnimationFrame(step));
        requestAnimationFrame(step);
      }),
    n,
  );
}

async function shoot(page, profile, state, note) {
  const file = join(OUT, `${TAG}-${profile.key}-${state}.png`);
  await page.screenshot({ path: file });
  console.log(`  ${TAG}-${profile.key}-${state}.png  ${profile.vw}×${profile.vh} dpr${profile.dpr}  ${note}`);
}

const browser = await chromium.launch();

for (const profile of PROFILES) {
  console.log(`\n${profile.key} — ${profile.vw}×${profile.vh} dpr${profile.dpr}${profile.touch ? ' touch' : ''}`);
  const ctx = await browser.newContext({
    viewport: { width: profile.vw, height: profile.vh },
    deviceScaleFactor: profile.dpr,
    isMobile: profile.touch,
    hasTouch: profile.touch,
  });

  // ---- 1. the resting HUD, in a frozen TEAMS scene with a rival staged --------
  {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/?debug=1&freeze=1&sides=2`, { waitUntil: 'load' });
    await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
    await page.waitForFunction(() => window.__planetRush?.frozen === true, undefined, { timeout: 20_000 });
    await page.evaluate(() => document.fonts?.ready);
    const staged = await page.evaluate(() => window.__nameplateStage?.stageBot() ?? null);
    await frames(page, 6);
    await shoot(page, profile, 'hud', staged ? 'rival staged (FRIENDLY A / ENEMY B on screen)' : 'no rival staged');
    await page.close();
  }

  // ---- 2. the wheel open, with the SPEND onboarding prompt live ---------------
  {
    const page = await ctx.newPage();
    // Live sim (no ?freeze): the wheel only opens on a real docked tap.
    await page.goto(`${BASE}/?debug=1`, { waitUntil: 'load' });
    await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
    await page.waitForFunction(
      () => typeof window.__tapCommanderStage?.stageStationWheel === 'function',
      undefined,
      { timeout: 20_000 },
    );
    await page.evaluate(() => document.fonts?.ready);
    await page.evaluate(() => window.__tapCommanderStage.setScheme('tap'));
    const points = await page.evaluate(() => window.__tapCommanderStage.stageStationWheel());
    if (points) {
      await realTap(page, await toClient(page, points.stationPoint));
      await frames(page, 8);
    }
    const wheel = await page.evaluate(() => window.__tapCommanderStage?.wheelState() ?? null);
    await frames(page, 2);
    await shoot(page, profile, 'wheel', `wheel open=${wheel?.open}`);
    await page.close();
  }

  // ---- 3. the under-attack alarm ---------------------------------------------
  {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/?debug=1`, { waitUntil: 'load' });
    await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
    await page.waitForFunction(() => typeof window.__repairStage?.setCore === 'function', undefined, {
      timeout: 20_000,
    });
    await page.evaluate(() => document.fonts?.ready);
    // Fly away from home first, so the screen-edge arrow has something to point AT:
    // the arrow is suppressed while the station is on screen (it is its own tell).
    await page.evaluate(() => window.__tapCommanderStage?.setScheme('tap'));
    const away = await page.evaluate(() => window.__tapCommanderStage?.stageStationWheel() ?? null);
    if (away) {
      await realTap(page, await toClient(page, away.outsidePoint)); // close the staged wheel
      await realTap(page, await toClient(page, away.movePoint));
      await page.waitForTimeout(3500); // a live sim: the ship actually travels
    }
    // Then a real HP fall on the own station. The HUD derives "damage this tick"
    // from the drop, and ALARM_THRESHOLD_HP is 5 — a 30 HP fall is a siege, not a
    // taunt-tap, so the alarm latches and holds for its 5 s.
    const hit = await page.evaluate(() => window.__repairStage.setCore(70));
    await frames(page, 4);
    const ids = await page.evaluate(
      () => (window.__planetRush?.layout ?? []).map((e) => e.id).filter((id) => id.startsWith('alarm')),
    );
    await shoot(page, profile, 'alarm', `core ${hit?.coreHp}/${hit?.maxCoreHp} drawn=[${ids}]`);
    await page.close();
  }

  await ctx.close();
}

await browser.close();
console.log(`\nwrote ${TAG}-* to ${OUT}`);
