/**
 * evidence/capture-round6.mjs — round-6 verification of RESOURCE FAIRNESS (p1-09,
 * field rule v0.1.2) and the two v0.1.2 field-report fixes it rode in with (ore
 * deposit, end screens) on the LIVE preview build. OWNER: QA Manager.
 *
 * The gameplay claim under test: asteroid placement is a fairness invariant — the
 * whole field is invariant under rotation by 2π/N about the arena centre. Home
 * fields are one seeded pattern stamped (rotated) around every planet; the central
 * commons is N-fold symmetric and richer; nothing else is scattered.
 *
 * The camera follows the LOCAL ship 1:1 (worldRoot is OFFSET, never scaled), so a
 * normal viewport only shows the home neighbourhood. To SEE the whole ring at once
 * — every home field + the contested commons — we open an OVERSIZED square
 * viewport under ?debug=1&freeze=1: the sim advances to the seeded freeze tick and
 * pins, giving one deterministic, static arena we can shoot and crop. The arena is
 * WORLD_SIZE=2400 square, centred at (1200,1200); planets sit on a ring of
 * radius ≈864 at i·45° (8 slots); the LOCAL ship (slot 0, no human input under
 * headless) rests at (1968,1200). We read the live shipWorld off __planetRush and
 * project the FIXED planet/centre world coords into screen space to place tight
 * crops exactly.
 *
 *   field-map            — the whole arena in one frame (context; the source the
 *                          two fairness crops are cut from).
 *   fair-home-resources  — a crop holding TWO adjacent home planets (slots 0 & 7)
 *                          side by side, each with its rotated-copy asteroid field.
 *   central-commons      — a crop centred on the arena centre (the collapse centre):
 *                          the contested commons.
 *
 * The other two ride the ?debug=1 live-stage seams main.ts installs (no ?freeze —
 * both need the LIVE sim moving):
 *
 *   ore-deposit-flight   — __oreDepositStage.stage(ore) parks the local ship at its
 *                          own planet with a full hold; we watch the sim drain it,
 *                          shoot the frame with ore couriers in flight, and log the
 *                          hold→0 / bank→full sequence.
 *   defeat-screen        — __endScreenStage.eliminateLocal() kills the local core
 *                          via the sim's own destroyCore; we shoot the DEFEATED
 *                          overlay, then press SPECTATE and prove the sim keeps
 *                          ticking (match runs on) behind it.
 *
 * Every claim about a shot lives in evidence/manifest.json, written after LOOKING
 * at the PNG. This file only guarantees WHAT WAS ON SCREEN.
 *
 * Usage:  node evidence/capture-round6.mjs [shot-id ...]
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';

// Arena geometry (src/sim/constants.ts + state.ts), fixed for the default match.
const WORLD_SIZE = 2400;
const CENTER = { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 }; // (1200,1200) — collapse centre
const RING_RADIUS = 768; // ship ring: halfMin*2*ringFraction = 1200*2*0.32
const PLANET_RING = 864; // planet ring: min(768+96, 1200-90-220)
const SLOTS = 8;
/** Fixed world position of slot i's home planet (planets never move). */
function planetWorld(i) {
  const theta = (2 * Math.PI * i) / SLOTS;
  return { x: CENTER.x + Math.cos(theta) * PLANET_RING, y: CENTER.y + Math.sin(theta) * PLANET_RING };
}

// A square viewport big enough to hold every planet (max ~1632px from the local
// ship) with room to spare; the arena wall corners may clip — irrelevant to the
// field. dpr 1 so the backing store is exactly this many px (swiftshader-safe).
const MAP = { viewport: { width: 3600, height: 3600 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
// A plain landscape desktop for the two live-sim shots — the HUD readouts and the
// overlay buttons are unambiguous at this size.
const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false };

/** Project a world point into screen (CSS px) given the live ship-world centre. */
function toScreen(world, shipWorld, vp) {
  return { x: vp.width / 2 + (world.x - shipWorld.x), y: vp.height / 2 + (world.y - shipWorld.y) };
}

/** Wait for the ?debug=1 instrument, then return shipWorld + viewport. */
async function readDebug(page) {
  await page.waitForFunction(() => window.__planetRush?.viewport?.w > 0, undefined, { timeout: 20_000 });
  return page.evaluate(() => ({
    shipWorld: { x: window.__planetRush.shipWorld.x, y: window.__planetRush.shipWorld.y },
    viewport: { width: window.__planetRush.viewport.w, height: window.__planetRush.viewport.h },
    ticks: window.__planetRush.ticks,
    build: window.__planetRush.build,
  }));
}

const SHOTS = [
  {
    // The whole arena, frozen: every home field + the commons in one static frame.
    // Shoot it full, then cut the two fairness crops from the SAME frame so the
    // scale is identical and the comparison is honest.
    id: 'field-map',
    device: MAP,
    url: '/?debug=1&freeze=1',
    async run(page) {
      await page.waitForFunction(() => window.__planetRush?.frozen === true || window.__planetRush?.viewport?.w > 0, undefined, { timeout: 20_000 }).catch(() => {});
      const dbg = await readDebug(page);
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(500);

      const vp = dbg.viewport;
      const center = toScreen(CENTER, dbg.shipWorld, vp);
      const planetsScreen = Array.from({ length: SLOTS }, (_, i) => ({ i, ...toScreen(planetWorld(i), dbg.shipWorld, vp) }));
      console.log('field-map:', JSON.stringify({ shipWorld: dbg.shipWorld, vp, center, planetsScreen, ticks: dbg.ticks, build: dbg.build }));

      // Full arena (context / source frame).
      await page.screenshot({ path: join(OUT, 'field-map.png') });

      // fair-home-resources: slots 0 (local) & 7 — adjacent on the right edge of
      // the ring. Box the pair with margin so each planet's 3-rock field is inside.
      // Field centre along each spoke (~0.455 of the ship ring from the arena
      // centre), projected to screen — for framing planet+its-field crops.
      const FIELD_R = 350;
      const fieldScreen = (i) => {
        const t = (2 * Math.PI * i) / SLOTS;
        return toScreen({ x: CENTER.x + Math.cos(t) * FIELD_R, y: CENTER.y + Math.sin(t) * FIELD_R }, dbg.shipWorld, vp);
      };
      const f0 = fieldScreen(0);
      const f7 = fieldScreen(7);
      console.log('fields:', JSON.stringify({ f0, f7 }));

      // fair-home: the UPPER ARC of the field — the home neighbourhoods of the
      // top planets (spokes 5,6,7) laid out in a row, so adjacent home fields read
      // side by side as identical rotated copies of one canonical pattern.
      const cs = 1000; // wide central field (context)
      const ct = 780; // tight commons

      // fair-home MAIN: the top half of the arena — the three top home PLANETS
      // (spokes 5,6,7) each with its local field pulled inboard toward the centre,
      // so a reviewer sees planet→field pairing and the fields' shared symmetry.
      const p5 = planetsScreen[5], p6 = planetsScreen[6], p7f = planetsScreen[7];
      const topX = Math.min(p5.x, p6.x, p7f.x) - 120;
      const topW = Math.max(p5.x, p6.x, p7f.x) - Math.min(p5.x, p6.x, p7f.x) + 240;
      const topY = Math.min(p5.y, p6.y, p7f.y) - 120;
      const topH = center.y - topY + 60;

      return {
        crops: [
          { id: 'fair-home-resources', clip: { x: Math.round(topX), y: Math.round(topY), width: Math.round(topW), height: Math.round(topH) } },
          // Detail: the upper arc of the field alone — adjacent home neighbourhoods
          // side by side as congruent rotated copies.
          { id: 'fair-home-detail', clip: { x: Math.round(center.x - 520), y: Math.round(center.y - 500), width: 1040, height: 470 } },
          { id: 'central-commons', clip: { x: Math.round(center.x - ct / 2), y: Math.round(center.y - ct / 2), width: ct, height: ct } },
          // Context (supporting image): the whole central field, all 8 sectors.
          { id: 'central-field-wide', clip: { x: Math.round(center.x - cs / 2), y: Math.round(center.y - cs / 2), width: cs, height: cs } },
        ],
      };
    },
  },
  {
    // Ore deposit at home, live: park the local ship at its planet with a full hold
    // and watch the sim fly it to the bank. Shoot the frame with couriers in flight;
    // log the full hold→0 / bank→up sequence for the attestation.
    id: 'ore-deposit-flight',
    device: DESKTOP,
    url: '/?debug=1',
    async run(page) {
      await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
      await page.waitForFunction(() => typeof window.__oreDepositStage?.stage === 'function', undefined, { timeout: 20_000 });
      await page.evaluate(() => document.fonts?.ready);

      const STAGED = 6;
      const staged = await page.evaluate((ore) => window.__oreDepositStage.stage(ore), STAGED);
      console.log('ore-deposit staged:', JSON.stringify(staged));

      // Wait for the drain to be visibly under way: hold has fallen below staged AND
      // at least one courier is in flight. That is the money frame.
      await page.waitForFunction(
        (start) => {
          const s = window.__oreDepositStage;
          const r = s.readout();
          return r && r.cargo < start - 0.2 && r.cargo > 0.3 && s.flights() > 0;
        },
        STAGED,
        { timeout: 20_000 },
      );
      const mid = await page.evaluate(() => ({ readout: window.__oreDepositStage.readout(), flights: window.__oreDepositStage.flights() }));
      console.log('ore-deposit mid-drain:', JSON.stringify(mid));
      await page.screenshot({ path: join(OUT, 'ore-deposit-flight.png') });
      // A HUD crop (top-left hold/bank readout) so the two counters can be read.
      await page.screenshot({ path: join(OUT, 'ore-deposit-flight-hud.png'), clip: { x: 0, y: 0, width: 420, height: 170 } });

      // Watch it drain to empty, logging the sequence so the attestation can state
      // the hold reached zero and the bank rose by the whole staged amount.
      await page.waitForFunction(() => (window.__oreDepositStage.readout()?.cargo ?? 1) <= 1e-6, undefined, { timeout: 20_000 }).catch(() => {});
      const end = await page.evaluate(() => ({ readout: window.__oreDepositStage.readout(), flights: window.__oreDepositStage.flights() }));
      console.log('ore-deposit end:', JSON.stringify({ staged, end }));
      await page.screenshot({ path: join(OUT, 'ore-deposit-flight-end.png') });
      return { skipShot: true };
    },
  },
  {
    // Defeat: kill the local core via the sim's own destroyCore, shoot the DEFEATED
    // overlay, then press SPECTATE and prove the sim keeps ticking behind it.
    id: 'defeat-screen',
    device: DESKTOP,
    url: '/?debug=1',
    async run(page) {
      await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
      await page.waitForFunction(() => typeof window.__endScreenStage?.eliminateLocal === 'function', undefined, { timeout: 20_000 });
      await page.evaluate(() => document.fonts?.ready);
      // Let the live match run a beat so there is visible motion behind the overlay.
      await page.waitForTimeout(1200);

      const staged = await page.evaluate(() => {
        const s = window.__endScreenStage;
        const ok = s.eliminateLocal();
        return { ok, screen: s.screen(), buttons: s.buttons(), ticks: s.ticks(), matchId: s.matchId() };
      });
      // Let the overlay actually paint.
      await page.waitForFunction(() => window.__endScreenStage.screen() === 'defeated', undefined, { timeout: 10_000 }).catch(() => {});
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(500);
      console.log('defeat-screen (overlay up):', JSON.stringify(staged));
      await page.screenshot({ path: join(OUT, 'defeat-screen.png') });

      // Now prove SPECTATE keeps the match live: ticks must climb after pressing it.
      const before = await page.evaluate(() => window.__endScreenStage.ticks());
      await page.evaluate(() => window.__endScreenStage.spectate());
      await page.waitForTimeout(1500);
      const after = await page.evaluate(() => ({ ticks: window.__endScreenStage.ticks(), screen: window.__endScreenStage.screen() }));
      console.log('defeat-screen (after spectate):', JSON.stringify({ before, after, climbed: after.ticks - before }));
      await page.screenshot({ path: join(OUT, 'defeat-screen-spectate.png') });
      return { skipShot: true };
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
      const result = await shot.run(page);
      const file = join(OUT, `${shot.id}.png`);
      if (!result?.skipShot) await page.screenshot({ path: file });
      for (const crop of result?.crops ?? []) {
        await page.screenshot({ path: join(OUT, `${crop.id}.png`), clip: crop.clip });
        console.log(`crop ${crop.id}:`, JSON.stringify(crop.clip));
      }
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
