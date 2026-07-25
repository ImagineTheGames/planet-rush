/**
 * evidence/capture-round3.mjs — round-3 re-verify of the three combat-visibility
 * failures after the m2-15 / m2-16 wiring landed (PRs #60, #61). OWNER: QA Manager.
 *
 * The round-1/2 approach kited live bots and hoped a fight framed itself — flaky,
 * and it also depended on the very wiring that was missing. The wiring fix ships
 * deterministic debug seams (behind ?debug=1&freeze=1), which are the honest,
 * reproducible way to stage the exact tells the field report found invisible:
 *
 *   window.__planetRush.stageCombat()      → publish a NON-LOCAL ship beam and a
 *                                            rival turret muzzle into the live world
 *   window.__planetRush.beams              → the beam set the client actually drew
 *   window.__healthbarStage.damageEnemy(f) → park a live enemy beside the local ship
 *                                            at fraction f of hull (⇒ a health bar)
 *   window.__healthbarStage.bars()         → the bars the real layer drew last frame
 *
 * ?freeze=1 pins the sim so the staged beam / muzzle / hull are not stepped away
 * before the shutter. This file only guarantees WHAT WAS ON SCREEN; every claim is
 * written in evidence/manifest.json after a human-equivalent LOOK at the PNG.
 *
 * Usage:  node evidence/capture-round3.mjs [shot-id ...]
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';

/** Wait for canvas + the frozen debug hook to report pinned, then a few frames. */
async function settleFrozen(page, ms = 400) {
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => window.__planetRush?.frozen === true,
    undefined,
    { timeout: 20_000 },
  );
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(ms);
}

const SHOTS = [
  {
    // enemy-beam-visible + enemy-healthbars, one tight legible frame. Park the
    // first non-local bot beside the centred local ship at 40% hull (health bar),
    // THEN stage the firefight so the SAME bot publishes a beam from that spot —
    // both non-local tells sit right of centre where they can be read at 1:1.
    id: 'combat-staged',
    device: { viewport: { width: 1900, height: 1100 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    url: '/?debug=1&freeze=1',
    async run(page) {
      await settleFrozen(page);
      const staged = await page.evaluate(() => {
        const dmg = window.__healthbarStage.damageEnemy(0.4); // park bot @40% beside local
        const combat = window.__planetRush.stageCombat();     // beam on that bot + rival turret muzzle
        return { dmg, combat };
      });
      // Let the render loop feed combatants + draw the staged beams.
      await page.waitForFunction(
        () => (window.__planetRush.beams ?? []).some((b) => b.shooter !== 0 && b.source === 'ship'),
        undefined,
        { timeout: 10_000 },
      );
      await page.waitForTimeout(300);
      const readback = await page.evaluate(() => ({
        beams: window.__planetRush.beams,
        bars: window.__healthbarStage.bars(),
        viewport: window.__planetRush.viewport,
      }));
      console.log('combat-staged staged:', JSON.stringify(staged));
      console.log('combat-staged readback:', JSON.stringify(readback));
    },
  },
  {
    // turret-firing. Same stage, but a viewport wide enough (3600×2000 — the
    // proven planet-ring width) that the rival planet carrying the staged turret
    // muzzle is inside the 1:1 follow-camera frame, so the muzzle beam is on
    // screen. Read back the drawn turret beam's world endpoint for corroboration.
    id: 'turret-muzzle',
    device: { viewport: { width: 3600, height: 2000 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    url: '/?debug=1&freeze=1',
    async run(page) {
      await settleFrozen(page);
      const staged = await page.evaluate(() => window.__planetRush.stageCombat());
      await page.waitForFunction(
        () => (window.__planetRush.beams ?? []).some((b) => b.source === 'turret'),
        undefined,
        { timeout: 10_000 },
      );
      await page.waitForTimeout(300);
      const readback = await page.evaluate(() => {
        const pr = window.__planetRush;
        const turret = (pr.beams ?? []).find((b) => b.source === 'turret');
        // Where does that turret's muzzle project on screen? (screen = world − camera + half-viewport, 1:1)
        return { beams: pr.beams, ship: pr.shipWorld, viewport: pr.viewport, turret };
      });
      console.log('turret-muzzle staged:', JSON.stringify(staged));
      console.log('turret-muzzle readback:', JSON.stringify(readback));
      // Stash the on-screen turret position so main() can also grab a 2× crop.
      page.__turretScreen = readback;
    },
  },
];

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
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      await page.goto(BASE + shot.url, { waitUntil: 'load' });
      await shot.run(page);
      const file = join(OUT, `${shot.id}.png`);
      await page.screenshot({ path: file });
      const build = await page.evaluate(() => window.__planetRush?.build ?? null);
      console.log(JSON.stringify({ id: shot.id, url: shot.url, viewport: shot.device.viewport, build, errors }));
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
