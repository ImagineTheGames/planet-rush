/**
 * evidence/capture-turret-healthbars.mjs — P4 turret health-bar evidence (field
 * request v0.2.2: "a turret is a thing you defend — every turret, yours and the
 * enemy's, gets a bar when damaged"). OWNER: QA Manager.
 *
 * Turrets do not exist at spawn — they are BUILT (TURRET.buildTime 10s), so every
 * frame here comes off a LIVE ?debug=1 match, not a frozen one.
 *
 *   OWN scene: the local player is idle and builds nothing on its own, so I drive
 *     the REAL build gesture — open the Build wheel (openBuild seam funds+docks),
 *     aim UP (KeyW → the TURRET wedge at 12 o'clock) and confirm (left mouse)
 *     TWICE, then wait out construction. Two turrets in the LOCAL player's colour
 *     now ring the home planet. damageTurret(0.4) (the healthbar live-stage seam,
 *     which prefers a LOCAL turret) drops ONE to 40% hp. I then wait for a LULL —
 *     a frame where the only drawn bar is that damaged own turret (no ship alarm
 *     bar, no besieger) — so the shot reads clean: one own-colour turret wearing a
 *     partial bar, its full-HP sibling wearing none.
 *
 *   ENEMY scene: a fresh page. Once a bot has built a turret, stageBot() (the
 *     nameplate live-stage seam) moves that bot's HOME PLANET — turrets and all —
 *     beside the centred local ship so it is on-screen (planets are static, so it
 *     stays). With no local turret present, damageTurret(0.4) falls to that bot's
 *     turret, dropping it to 40% — an ENEMY-colour turret bar at its orbit.
 *
 * Every candidate frame logs the bars() the real layer drew (owner, fill, local
 * flag, screen pos), so the attestation cites what rendered, not what code claims.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const CAP = '/tmp/turretbars';
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';
const VP = { width: 1280, height: 800 };
const DSF = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readBars = (page) => page.evaluate(() =>
  window.__healthbarStage.bars().map((b) => ({ o: b.owner, x: Math.round(b.x), y: Math.round(b.y), f: +b.fraction.toFixed(2), local: b.local })));

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: DSF });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page._errors = errors;
  await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__healthbarStage?.damageTurret === 'function', undefined, { timeout: 20_000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  return page;
}

async function ownScene(browser) {
  const page = await newPage(browser);
  await page.waitForFunction(() => typeof window.__pressStage?.openBuild === 'function', undefined, { timeout: 20_000 });
  // Build TWO turrets on the local planet via the real wheel gesture.
  await page.evaluate(() => window.__pressStage.openBuild(999));
  await sleep(200);
  await page.keyboard.down('KeyW'); // aim up → TURRET wedge (12 o'clock)
  await sleep(200);
  for (let n = 0; n < 2; n++) {
    await page.mouse.move(VP.width / 2, 250);
    await page.mouse.down(); await sleep(140); await page.mouse.up();
    await sleep(450);
  }
  await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyE'); // close the wheel
  console.log('[own] built turrets, waiting out construction...');
  await sleep(12500);

  const staged = await page.evaluate(() => window.__healthbarStage.damageTurret(0.4));
  console.log('[own] damageTurret ->', JSON.stringify(staged));

  // Wait for a LULL: the only bar is the damaged own turret (owner 0, non-local).
  let chosen = null;
  for (let i = 0; i < 60; i++) {
    const bars = await readBars(page);
    const ownTurret = bars.find((b) => b.o === 0 && !b.local && b.f > 0.2 && b.f < 0.7);
    const shipAlarm = bars.some((b) => b.local);
    const nearPlanetEnemy = bars.some((b) => !b.local && b.o !== 0 && b.x > 380 && b.x < 780 && b.y > 260 && b.y < 560);
    if (ownTurret && !shipAlarm && !nearPlanetEnemy) {
      chosen = { bars, ownTurret, i };
      break;
    }
    if (i % 6 === 0) console.log(`[own] i=${i} waiting for lull; bars=${JSON.stringify(bars)}`);
    await sleep(700);
  }
  if (chosen) {
    await page.screenshot({ path: join(OUT, 'turret-own-full.png') });
    writeFileSync(join(CAP, 'own.json'), JSON.stringify(chosen, null, 2));
    console.log('[own] LULL captured ->', JSON.stringify(chosen));
  } else {
    const bars = await readBars(page);
    await page.screenshot({ path: join(OUT, 'turret-own-full.png') });
    console.log('[own] no clean lull; captured anyway. bars=', JSON.stringify(bars));
  }
  console.log('[own] errors', page._errors.slice(0, 3));
  await page.context().close();
}

async function enemyScene(browser) {
  const page = await newPage(browser);
  await page.waitForFunction(() => typeof window.__nameplateStage?.stageBot === 'function', undefined, { timeout: 20_000 });
  await page.waitForFunction(() => (window.__planetRush?.ticks ?? 0) >= 780, undefined, { timeout: 60_000 });
  await sleep(1200);

  // Fly the local ship OUT into open space so the home planet leaves the frame —
  // then the bot planet staged beside the ship stands ALONE, no planet overlap.
  await page.keyboard.down('KeyW');
  await sleep(3800);
  await page.keyboard.up('KeyW');
  await sleep(700); // drag coasts the ship to rest
  const where = await page.evaluate(() => window.__planetRush?.shipWorld ?? null);
  console.log('[enemy] flew to', JSON.stringify(where));

  const bot = await page.evaluate(() => window.__nameplateStage.stageBot());
  const staged = await page.evaluate(() => window.__healthbarStage.damageTurret(0.35));
  console.log('[enemy] stageBot ->', JSON.stringify(bot), 'damageTurret ->', JSON.stringify(staged));

  // Capture a burst; pick the frame where the enemy turret bar is present and the
  // scene is least cluttered (fewest total bars), and where the local ship isn't
  // overlapping the staged planet region.
  let best = null;
  for (let i = 0; i < 24; i++) {
    const bars = await readBars(page);
    const enemyTurret = bars.filter((b) => !b.local && b.o === (staged?.owner ?? bot?.owner) && b.f > 0.2 && b.f < 0.7 && b.y > 380);
    if (enemyTurret.length) {
      const clutter = bars.length;
      if (!best || clutter < best.clutter) {
        await page.screenshot({ path: join(CAP, `enemy_${i}.png`) });
        best = { i, clutter, bars, enemyTurret, path: join(CAP, `enemy_${i}.png`) };
      }
    }
    await sleep(250);
  }
  if (best) {
    const { copyFileSync } = await import('node:fs');
    copyFileSync(best.path, join(OUT, 'turret-enemy-full.png'));
    writeFileSync(join(CAP, 'enemy.json'), JSON.stringify(best, null, 2));
    console.log('[enemy] captured ->', JSON.stringify({ i: best.i, clutter: best.clutter, enemyTurret: best.enemyTurret }));
  } else {
    console.log('[enemy] no enemy turret bar captured');
  }
  console.log('[enemy] errors', page._errors.slice(0, 3));
  await page.context().close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(CAP, { recursive: true });
  const browser = await chromium.launch();
  const only = process.argv[2]; // 'own' | 'enemy' | undefined (both)
  if (!only || only === 'own') await ownScene(browser);
  if (!only || only === 'enemy') await enemyScene(browser);
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
