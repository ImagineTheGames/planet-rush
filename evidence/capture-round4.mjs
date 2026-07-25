/**
 * evidence/capture-round4.mjs — round-4 re-verify of the three v0.1 FIELD REPORTS
 * (P1) after p1-01..03 landed (PRs #63 world-margin, #64 main-menu-wiring,
 * #65 turret-orbit) on main b65d6d5. OWNER: QA Manager.
 *
 * The developer played v0.1 and reported three faults; each has a fix on main and
 * this camera stages the exact tell on the LIVE preview build so a human LOOK can
 * confirm it or fail it:
 *
 *   main-menu-at-boot   — a CLEAN boot (NO ?debug=1) must land on the main menu
 *                         with no match behind it; ?debug=1 is not used because it
 *                         deliberately skips the menu (the harness path).
 *   planet-clear-of-edge— a home planet with visible clear space between it and
 *                         the steel arena wall (?debug=1&freeze=1, wide follow-cam).
 *   turret-orbit-facing — a turret that has SLID around its planet's rim to face
 *                         an attacking enemy; staged as a live home siege so the
 *                         turret has a real target to orbit toward.
 *
 * Every claim about a shot lives in evidence/manifest.json, written after LOOKING
 * at the PNG. This file only guarantees WHAT WAS ON SCREEN.
 *
 * Usage:  node evidence/capture-round4.mjs [shot-id ...]
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';

const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false };

/** Canvas attached + a few frames composited. */
async function settle(page, ms = 1200) {
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(ms);
}

/** Wait for the frozen debug hook, then a few frames. */
async function settleFrozen(page, ms = 400) {
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => window.__planetRush?.frozen === true, undefined, { timeout: 20_000 });
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(ms);
}

const SHOTS = [
  {
    // A CLEAN boot — the exact path the field report walked. No ?debug=1, so the
    // menu is NOT skipped. Wait for the menu seam to install, confirm the ?debug=1
    // instrument is absent (no match world), then shoot the resting menu.
    id: 'main-menu-at-boot',
    device: DESKTOP,
    url: '/',
    async run(page) {
      await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
      await page.waitForFunction(() => typeof window.__mainMenu?.play === 'function', undefined, {
        timeout: 20_000,
      });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(800);
      const state = await page.evaluate(() => ({
        menu: {
          visible: window.__mainMenu?.visible,
          screen: window.__mainMenu?.screen,
          matchStarted: window.__mainMenu?.matchStarted,
        },
        debugInstrumentPresent: '__planetRush' in window,
      }));
      // Shoot the MENU frame now, before we press PLAY (main() will skip its shot).
      await page.screenshot({ path: join(OUT, 'main-menu-at-boot.png') });
      // Now verify with our own eyes/instrument that PLAY — and only PLAY — builds
      // the match world: press the PLAY button, then confirm matchStarted flips.
      await page.mouse.click(640, 407); // PLAY button centre (1280×800 menu layout)
      const afterPlay = await page.evaluate(async () => {
        const deadline = Date.now?.() ? Date.now() + 8000 : null;
        // Fall back to a polling wait that doesn't depend on Date in-page.
        for (let i = 0; i < 160; i++) {
          if (window.__mainMenu?.matchStarted === true) break;
          await new Promise((r) => setTimeout(r, 50));
          if (deadline && Date.now() > deadline) break;
        }
        return {
          matchStarted: window.__mainMenu?.matchStarted,
          menuVisible: window.__mainMenu?.visible,
        };
      });
      console.log('main-menu-at-boot state:', JSON.stringify(state));
      console.log('main-menu-at-boot afterPlay:', JSON.stringify(afterPlay));
      return { skipShot: true };
    },
  },
  {
    // Home planet clear of the arena wall. Frozen so the scene holds still; a wide
    // follow-cam (centred on the local ship, which spawns at its home planet) so
    // the nearest steel wall is in frame beside home with the gap between them
    // visible. Read back ship world pos + viewport for the geometry note.
    id: 'planet-clear-of-edge',
    device: { viewport: { width: 2600, height: 1600 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    url: '/?debug=1&freeze=1',
    async run(page) {
      await settleFrozen(page, 500);
      const diag = await page.evaluate(() => ({
        shipWorld: window.__planetRush.shipWorld,
        viewport: window.__planetRush.viewport,
      }));
      console.log('planet-clear-of-edge diag:', JSON.stringify(diag));
    },
  },
  {
    // Turret slides around the rim to face an attacker. Live (unfrozen) so the sim
    // steps and the turret can orbit. The home planet (local slot 0) sits on the
    // arena's +x spoke, so its turret is BORN on the EAST (wall-side) rim
    // (turretHomeAngle = planet.angle 0). We build that turret, then stage an
    // attacker on the WEST (inward) side of the planet using the ?debug=1
    // __healthbarStage.damageEnemy seam, which parks a live bot 120u east of the
    // local ship — so flying the ship just WEST of home lands the bot on the
    // planet's west rim, forcing the turret to slide ~180° around to face it.
    //
    // The bot is a live entity, so we re-park it every frame to hold it in the
    // turret's 240u range while the turret glides (orbitSpeed 1.2 rad/s ⇒ ~2.6s
    // for a half-turn). We tight-poll __planetRush.beams for the turret muzzle
    // origin — sampling densely because the turret only enters `beams` on the
    // frames it actually fires (cooldown-gated) — and log the origin trail so the
    // manifest can attest the turret SLID (origin moves across the rim) then
    // SETTLED (origin stops moving) rather than thrashing.
    id: 'turret-orbit-facing',
    device: { viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    url: '/?debug=1',
    async run(page) {
      await settle(page, 2000);
      const home = await page.evaluate(() => ({
        x: window.__planetRush.shipWorld.x,
        y: window.__planetRush.shipWorld.y,
      }));
      // Build a turret at the home planet (mount slot 0 — the east rim).
      await page.keyboard.down('KeyE');
      await page.waitForTimeout(700);
      await page.keyboard.up('KeyE');
      await page.waitForTimeout(300);
      const wheel = await page.evaluate(() => {
        const e = window.__planetRush?.layout?.find((x) => x.id === 'build-wheel');
        return e ? e.bounds : null;
      });
      const { width, height } = page.viewportSize();
      if (wheel) {
        await page.mouse.click(wheel.x + wheel.width / 2, wheel.y + wheel.height / 2 - (wheel.width / 2) * 0.6);
      } else {
        await page.mouse.click(width / 2, height / 2 - 140);
      }
      await page.waitForTimeout(500); // ORE 3 → 0, turret queued
      await page.keyboard.down('KeyE'); // close the wheel
      await page.waitForTimeout(400);
      await page.keyboard.up('KeyE');
      // Let the 10 s (600-tick) build finish so the turret exists on the rim.
      await page.waitForFunction(() => (window.__planetRush?.ticks ?? 0) >= 700, undefined, { timeout: 30_000 });
      // Nudge the ship just WEST of home so the parked bot lands on the planet's
      // west rim (opposite the turret's east mount). The planet centre sits ~90u
      // east of the ship's SPAWN (`home.x`), so target `home.x - 130`: the bot
      // (ship + 120u) then lands ~on the planet's west rim, well inside the 240u
      // turret range.
      await page.keyboard.down('KeyA');
      await page.waitForFunction(
        (h) => window.__planetRush.shipWorld.x <= h.x - 155,
        home,
        { timeout: 30_000 },
      );
      await page.keyboard.up('KeyA');
      await page.keyboard.down('KeyD'); // counter-thrust to arrest + settle near the sweet spot
      await page.waitForTimeout(300);
      await page.keyboard.up('KeyD');
      // Re-park the attacker every frame while the turret slides; densely poll the
      // muzzle origin so we catch the fire-frames and can chart the slide + settle.
      const samples = [];
      for (let i = 0; i < 80; i++) {
        const s = await page.evaluate(() => {
          const pr = window.__planetRush;
          const stg = window.__healthbarStage;
          const staged = stg ? stg.damageEnemy(0.5) : null; // hold the bot at 50% hull, west of home
          const bars = stg ? stg.bars() : [];
          const turret = (pr.beams ?? []).find((b) => b.source === 'turret');
          const sh = pr.shipWorld;
          return {
            ticks: pr.ticks,
            shipX: Math.round(sh.x),
            shipY: Math.round(sh.y),
            staged,
            enemyBar: bars && bars.length ? { x: Math.round(bars[0].x), y: Math.round(bars[0].y), f: bars[0].fraction } : null,
            turretOrigin: turret ? { x: Math.round(turret.origin.x), y: Math.round(turret.origin.y) } : null,
          };
        });
        samples.push(s);
        await page.waitForTimeout(60);
      }
      // Hold the settled state a good while, re-parking + sampling, to PROVE the
      // turret has stopped moving (settled) rather than orbiting — a thrashing
      // turret would keep changing origin here.
      const settleTrail = [];
      for (let i = 0; i < 130; i++) {
        const s = await page.evaluate(() => {
          const pr = window.__planetRush;
          window.__healthbarStage?.damageEnemy(0.5);
          const t = (pr.beams ?? []).find((b) => b.source === 'turret');
          return t ? { x: Math.round(t.origin.x), y: Math.round(t.origin.y) } : null;
        });
        if (s) settleTrail.push(s);
        await page.waitForTimeout(35);
      }
      // One last re-park immediately before the shutter so the attacker is present
      // in the captured frame.
      const shutter = await page.evaluate(() => {
        window.__healthbarStage?.damageEnemy(0.5);
        const pr = window.__planetRush;
        const t = (pr.beams ?? []).find((b) => b.source === 'turret');
        return { shipX: Math.round(pr.shipWorld.x), shipY: Math.round(pr.shipWorld.y), turret: t ? { x: Math.round(t.origin.x), y: Math.round(t.origin.y) } : null };
      });
      const seen = samples.map((s) => s.turretOrigin).filter(Boolean);
      const summary = {
        home,
        turretOriginsSeen: seen.length,
        firstOrigin: seen[0] ?? null,
        settledOrigin: settleTrail[settleTrail.length - 1] ?? null,
        settleSamples: settleTrail.length,
        settleDistinctPositions: new Set(settleTrail.map((p) => `${p.x},${p.y}`)).size,
        lastShip: { x: shutter.shipX, y: shutter.shipY },
      };
      console.log('turret-orbit-facing summary:', JSON.stringify(summary));
      console.log('turret-orbit-facing origin trail:', JSON.stringify(seen));
      console.log('turret-orbit-facing settle trail:', JSON.stringify(settleTrail));
      // A zoom crop around the home planet (CSS px; the context's dpr multiplies it
      // into device px). Camera centres the ship at the viewport middle, 1:1 world.
      const vp = page.viewportSize();
      const planetX = home.x + 90; // planet centre is ~90u outboard of the ship spawn
      const cropCx = vp.width / 2 + (planetX - shutter.shipX);
      const cropCy = vp.height / 2;
      return {
        crops: [
          {
            id: 'turret-orbit-facing-zoom',
            clip: {
              x: Math.max(0, cropCx - 260),
              y: Math.max(0, cropCy - 170),
              width: 460,
              height: 340,
            },
          },
        ],
      };
    },
  },
];

// NOTE — the two-attacker anti-thrash clause. A genuine LIVE home siege (the
// round-2/3 method: build a turret, abandon or kite the core so bots swarm it)
// was attempted here and DID NOT reproduce: across dense polling of a
// core-abandon run AND a kite-them-home run, the home turret fired ZERO frames —
// the offline bots never crossed within its 240u range. The only in-client way to
// put an attacker in a turret's reach on this build is the single-bot
// `__healthbarStage.damageEnemy` seam, so the turret-orbit-facing scene stages ONE
// controlled attacker and proves the slide + settle (origin holds a fixed rim
// point across consecutive samples — the "settles instead of thrashing" behaviour
// for a tracked threat). The two-SIMULTANEOUS-attacker case is honestly out of
// reach of the booted client here; the manifest attestation says so plainly.

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
      const build = await page.evaluate(
        () => window.__planetRush?.build ?? window.__mainMenu?.build ?? null,
      );
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
