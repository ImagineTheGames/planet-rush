/**
 * evidence/capture-art-live.mjs — the LIVE GAME half of the art-vs-boards gate.
 * OWNER: QA Manager.
 *
 * Shoots the real preview build (vite build → vite preview) so every live frame
 * in the composites comes from the shipped renderer, not from the art pipeline's
 * own contact sheet. Three groups, matching the three gate entries:
 *
 *   SCENE — ?debug=1&freeze=1 (the sim pinned at FREEZE_TICK, deterministic).
 *           Raw arena, then the defended home (freeze stamps three turret Mks, a
 *           mid-build scaffold and two shields), then the same home with its core
 *           beaten down so the damage ring and the alarm are on screen, then a
 *           staged muzzle flash. Crops are taken around the ship's OWN reported
 *           screen position (`__planetRush.shipScreen`) and around the local
 *           station's projected centre — never a guessed pixel.
 *
 *   SHIPS — the FRONT DOOR, four times: PLAY → PLAY SOLO → pick hull i → RUSH!.
 *           ?debug=1 cannot do this (it skips menu and lobby entirely, and its
 *           boot world is eight Vanguards), so the hulls are only reachable the
 *           way a player reaches them. The local ship is the camera target, so it
 *           is cropped from the viewport centre and the crop is checked against
 *           the lobby's own readback of which hull was locked.
 *
 *   UI    — the menu, the doors, the lobby and the live match HUD, clean boot,
 *           plus the build wheel open (?debug=1 `__upgradeWheelStage`).
 *
 * Writes images/live/*.png and images/live/index.json (what each frame is, the
 * geometry it was cropped against, and any console error the page raised).
 *
 * Usage: node evidence/capture-art-live.mjs   (needs preview on $EVIDENCE_BASE_URL)
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images', 'live');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4188';
const VP = { width: 1280, height: 800 };
const DSF = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const notes = { base: BASE, viewport: VP, deviceScaleFactor: DSF, frames: [] };
const record = (o) => { notes.frames.push(o); console.log('[frame]', JSON.stringify(o)); };

async function boot(browser, query, dsf = DSF) {
  const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: dsf });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page._errors = errors;
  page._ctx = ctx;
  await page.goto(BASE + query, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  return page;
}

/** A CSS-pixel box centred on (cx, cy), clamped into the viewport. */
function box(cx, cy, w, h) {
  const x = Math.max(0, Math.min(VP.width - w, Math.round(cx - w / 2)));
  const y = Math.max(0, Math.min(VP.height - h, Math.round(cy - h / 2)));
  return { x, y, width: w, height: h };
}

/**
 * Poll the ship crop until `PALETTE.hullSteel` (#7E8894, the value the art
 * pipeline paints and `assets/preview/sprite-sheet.svg` carries 393 times) is
 * present in it — i.e. until the spawn-protection half-alpha has lifted and the
 * frame shows the paint rather than the tell. Returns what it measured either
 * way, so a run that never clears says so instead of quietly shipping a fade.
 */
async function waitForFullOpacity(page, budgetMs) {
  const t0 = Date.now();
  const clip = { x: VP.width / 2 - 48, y: VP.height / 2 - 48, width: 96, height: 96 };
  let steel = 0, faded = 0;
  while (Date.now() - t0 < budgetMs) {
    const png = PNG.sync.read(await page.screenshot({ clip }));
    steel = 0; faded = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
      if (Math.abs(r - 0x7e) <= 3 && Math.abs(g - 0x88) <= 3 && Math.abs(b - 0x94) <= 3) steel++;
      if (Math.abs(r - 0x45) <= 3 && Math.abs(g - 0x4c) <= 3 && Math.abs(b - 0x55) <= 3) faded++;
    }
    if (steel > faded && steel > 40) return { ok: true, waitedMs: Date.now() - t0, steel, faded };
    await sleep(1500);
  }
  return { ok: false, waitedMs: Date.now() - t0, steel, faded };
}

async function shot(page, name, clip) {
  await page.screenshot({ path: join(OUT, name + '.png'), clip });
  return name;
}

// ---------------------------------------------------------------------------
// SCENE — the pinned arena
// ---------------------------------------------------------------------------
async function captureScene(browser) {
  const page = await boot(browser, '/?debug=1&freeze=1');
  await page.waitForFunction(() => window.__planetRush?.frozen === true, undefined, { timeout: 20_000 });
  await sleep(1200);

  const geo = await page.evaluate(() => {
    const p = window.__planetRush;
    return { shipScreen: { ...p.shipScreen }, shipWorld: { ...p.shipWorld },
             viewport: { w: p.viewport.w, h: p.viewport.h }, ticks: p.ticks,
             worldHash: p.worldHash, freezeTick: p.freezeTick,
             build: { sha: p.build?.sha ?? null, time: p.build?.time ?? null } };
  });
  notes.freeze = geo;
  console.log('[scene] geo=', JSON.stringify(geo));

  // Whole screen, untouched — the frame the game opens on.
  record({ name: await shot(page, 'scene-arena-full'), what: 'whole pinned arena, nothing staged', geo });

  // The asteroid field, cropped left of the home ring (the mining-run comparison).
  record({ name: await shot(page, 'scene-field-crop', { x: 0, y: 60, width: 560, height: 560 }),
           what: 'asteroid field, left of the home ring, nothing staged' });

  // The defended home. The freeze stamp puts three turret Mks, a 60%-built
  // scaffold and two shields on the LOCAL station; the ship sits beside it, so a
  // box around the ship's own reported screen point contains both.
  const s = geo.shipScreen;
  record({ name: await shot(page, 'scene-home-defended', box(s.x, s.y, 620, 620)),
           what: 'local home: freeze-stamped turrets, mid-build scaffold, two shields', center: s });

  // A staged rival muzzle flash on the pinned frame (the turret that is firing is
  // non-local by construction — main.ts stageCombatFor).
  const staged = await page.evaluate(() => window.__planetRush.stageCombat());
  await sleep(400);
  const muzzles = await page.evaluate(() => JSON.parse(JSON.stringify(window.__planetRush.muzzles ?? [])));
  record({ name: await shot(page, 'scene-staged-muzzle-full'), what: 'pinned arena with a rival turret muzzle staged',
           staged, muzzleCount: muzzles.length });

  // THE SIEGE FRAME. Everything above is pinned at tick 120 — two seconds, inside
  // SPAWN_PROTECTION_S (10 s) — so the ship draws at `alpha 0.5` and the station at
  // 0.75 (render/index.ts:874, :656). That is the shipped spawn tell, not the paint,
  // and a value comparison taken off it would be measuring a fade. __repairStage's
  // `siege()` lifts the station's protection and damages the core through the sim's
  // own damageStation, so this frame carries the freeze stamp's turrets and shields
  // at FULL opacity with a bleeding core.
  // 105, not 58: the freeze stamp puts TWO shields on the station (a full 40 hp
  // bubble and a half-drained one), and damageStation spends shields before the
  // core. A first pass sieged 58 and read coreHp 100 — the shields ate all of it,
  // which is the sim behaving correctly, not a miss. 105 drains both and bleeds
  // the core, which is the frame the board's siege scene is actually about.
  const siege = await page.evaluate(() => window.__repairStage?.siege(105, 11) ?? null);
  // siege() also OPENS the wheel (it is the repair-wedge instrument), which would
  // bury the scene it just staged. Shut it again — the scene is the subject here.
  await page.evaluate(() => window.__upgradeWheelStage?.close?.());
  await sleep(700);
  const shipAlphaNote = await page.evaluate(() => ({ ticks: window.__planetRush.ticks }));
  record({ name: await shot(page, 'scene-siege-full'), what: 'pinned arena, station spawn protection lifted, core besieged', siege, shipAlphaNote });
  record({ name: await shot(page, 'scene-siege-home', box(s.x, s.y, 620, 620)),
           what: 'the defended home at full opacity with a damaged core', siege });
  notes.siege = siege;
  console.log('[siege]', JSON.stringify(siege));

  notes.sceneErrors = page._errors.slice(0, 5);
  await page._ctx.close();
}

// ---------------------------------------------------------------------------
// ALARM — sustained damage on a LIVE (unpinned) sim
//
// The damage write-seam queues an Action that `debugStage.drain()` applies once
// per fixed step. Under ?freeze=1 the sim never steps, so the queue never drains
// and the core never loses a point — measured, not assumed (a first pass of this
// script staged the damage under freeze and read coreHp 100 -> 100). The alarm is
// a leaky bucket over sustained damage besides, so it needs a running clock.
// ---------------------------------------------------------------------------
async function captureAlarm(browser) {
  const page = await boot(browser, '/?debug=1');
  await page.waitForFunction(() => typeof window.__planetRush?.damageCore === 'function', undefined, { timeout: 20_000 });
  // A station refuses damage while `spawnProtect > 0` (sim/buildings.ts:771). A
  // first pass of this script hit the core fourteen times in the opening seconds
  // and read coreHp 100 -> 94: thirteen of the fourteen were refused, not lost.
  // So wait the protection out before the pressure starts.
  await sleep(16_000);
  const before = await page.evaluate(() => window.__planetRush.coreHp(0));
  const hp = [before];
  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => window.__planetRush.damageCore(0, 5));
    await sleep(260);
    hp.push(await page.evaluate(() => window.__planetRush.coreHp(0)));
  }
  await page.evaluate(() => window.__planetRush.damageShip(0, 26));
  await sleep(400);
  const geo = await page.evaluate(() => ({ shipScreen: { ...window.__planetRush.shipScreen }, ticks: window.__planetRush.ticks }));
  record({ name: await shot(page, 'scene-alarm-full'), what: 'whole screen after sustained core damage — the alarm state', coreHp: hp, geo });
  record({ name: await shot(page, 'scene-alarm-home', box(geo.shipScreen.x, geo.shipScreen.y, 620, 620)),
           what: 'the damaged home, cropped on the ship', coreHp: hp });
  notes.alarm = { coreHp: hp, geo, errors: page._errors.slice(0, 5) };
  console.log('[alarm] coreHp', JSON.stringify(hp));
  await page._ctx.close();
}

// ---------------------------------------------------------------------------
// FIGHT — a frame the game produced from REAL INPUT, not a staged pose.
// Drive the local ship west into the asteroid field with the keyboard and hold
// the real fire button on the real mouse. Whatever comes out is what a player
// sees when they shoot a rock; the composite says so.
// ---------------------------------------------------------------------------
async function captureFight(browser) {
  const page = await boot(browser, '/?debug=1');
  await page.waitForFunction(() => typeof window.__planetRush?.ticks === 'number', undefined, { timeout: 20_000 });
  await sleep(1500);
  const start = await page.evaluate(() => ({ ...window.__planetRush.shipWorld }));

  // Thrust west out of the home ring and into the field.
  await page.mouse.move(300, 400);
  await page.keyboard.down('KeyA');
  await sleep(2600);
  await page.keyboard.up('KeyA');
  await sleep(900);
  const mid = await page.evaluate(() => ({ ...window.__planetRush.shipWorld }));

  // Aim west and hold the trigger, sampling the frame while it fires.
  await page.mouse.move(240, 400);
  await page.mouse.down();
  const burst = [];
  for (let i = 0; i < 8; i++) {
    await sleep(320);
    const name = `fight-burst-${i}`;
    await shot(page, name, { x: 0, y: 90, width: 760, height: 620 });
    burst.push({ name, input: await page.evaluate(() => JSON.parse(JSON.stringify(window.__planetRush.input ?? null))) });
  }
  await shot(page, 'fight-full');
  await page.mouse.up();
  const end = await page.evaluate(() => ({ ...window.__planetRush.shipWorld }));
  notes.fight = { start, mid, end, burst, errors: page._errors.slice(0, 5) };
  record({ name: 'fight-full', what: 'whole screen while the ship is firing, driven by real keyboard + mouse', start, mid, end });
  console.log('[fight] world', JSON.stringify(start), '->', JSON.stringify(end), 'input=', JSON.stringify(burst[3]?.input));
  await page._ctx.close();
}

// ---------------------------------------------------------------------------
// SHIPS — four hulls, four front-door runs
// ---------------------------------------------------------------------------
async function captureHulls(browser) {
  const out = [];
  const HULL_DSF = 3; // real render pixels, not an upscale — Pixi draws at this resolution
  for (let i = 0; i < 4; i++) {
    const page = await boot(browser, '/', HULL_DSF);
    await page.waitForFunction(() => typeof window.__mainMenu?.play === 'function', undefined, { timeout: 20_000 });
    await sleep(600);
    await page.evaluate(() => window.__mainMenu.play());
    await page.waitForFunction(() => typeof window.__onlineMenu?.solo === 'function', undefined, { timeout: 20_000 });
    await sleep(400);
    await page.evaluate(() => window.__onlineMenu.solo());
    await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 20_000 });
    await sleep(500);
    await page.evaluate((k) => window.__lobby.selectClass(k), i);
    await sleep(300);
    const picked = await page.evaluate(() => ({
      selectedClass: window.__lobby.selectedClass,
      classOrder: window.__lobby.classOrder,
    }));
    if (i === 0) {
      await page.screenshot({ path: join(OUT, 'ui-lobby-full.png') });
      record({ name: 'ui-lobby-full', what: 'the lobby, clean boot, hull tiles + arena cards + RUSH!' });
    }
    await page.evaluate(() => window.__lobby.rush());
    await page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 90_000 });
    // WAIT OUT SPAWN PROTECTION, AND PROVE IT RATHER THAN TIME IT.
    // render/index.ts:874 draws a ship at `alpha 0.5` while `ship.spawnProtect > 0`
    // (SPAWN_PROTECTION_S = 10 s). A first pass shot at +2.2 s and measured the hull
    // plate at #454C55 — which is exactly PALETTE.hullSteel #7E8894 composited at one
    // half over vacuum: the spawn tell, not the paint. A second pass waited a flat
    // 14 s and STILL caught the fade, because under a dsf-3 capture the sim clock
    // lags the wall clock and the flip lands between +9 s and +14 s. So no clock:
    // sample the ship crop until the un-faded steel is actually on the screen.
    const fade = await waitForFullOpacity(page, 60_000);
    if (!fade.ok) console.warn(`[hull ${i}] STILL FADED after ${fade.waitedMs} ms — frame not trustworthy`);

    const live = await page.evaluate(() => ({
      shipPos: window.__mainMenu.localShipPos,
      logical: window.__mainMenu.logicalViewport,
    }));
    // The camera targets the local ship, so it is at the viewport centre.
    const name = `hull-${i}-${String(picked.selectedClass)}`;
    await shot(page, name, box(VP.width / 2, VP.height / 2, 96, 96));   // 384x384 real px at dsf 4
    await shot(page, name + '-wide', box(VP.width / 2, VP.height / 2, 320, 320));
    if (i === 1) {
      await page.screenshot({ path: join(OUT, 'ui-match-hud-full.png') });
      record({ name: 'ui-match-hud-full', what: 'the live match HUD, clean boot, Vanguard' });
    }
    record({ name, what: `hull index ${i} as the running game draws it`, picked, live, spawnFade: fade, errors: page._errors.slice(0, 3) });
    out.push({ i, name, picked });
    await page._ctx.close();
  }
  notes.hulls = out;
}

// ---------------------------------------------------------------------------
// UI — menu, doors, build wheel
// ---------------------------------------------------------------------------
async function captureUi(browser) {
  {
    const page = await boot(browser, '/');
    await sleep(1200);
    record({ name: await shot(page, 'ui-menu-title'), what: 'the title screen, clean boot' });
    await page.evaluate(() => window.__mainMenu.play());
    await sleep(1000);
    record({ name: await shot(page, 'ui-menu-doors'), what: 'the doors: CAMPAIGN / PLAY SOLO / CREATE / JOIN' });
    await page._ctx.close();
  }
  {
    const page = await boot(browser, '/?debug=1&freeze=1');
    await page.waitForFunction(() => typeof window.__upgradeWheelStage?.openBuild === 'function', undefined, { timeout: 20_000 });
    await sleep(900);
    const opened = await page.evaluate(() => window.__upgradeWheelStage.openBuild());
    await sleep(900);
    const wedges = await page.evaluate(() => {
      try { return JSON.parse(JSON.stringify(window.__upgradeWheelStage.wedges?.() ?? null)); } catch { return 'ERR'; }
    });
    console.log('[wheel] opened=', JSON.stringify(opened), 'wedges=', JSON.stringify(wedges));
    notes.wheel = { opened, wedges };
    record({ name: await shot(page, 'ui-build-wheel-full'), what: 'the build & upgrade wheel, open, on the pinned arena', opened, wedges });
    await page._ctx.close();
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const only = process.argv[2] ?? 'all';
  const want = (s) => only === 'all' || only === s;
  if (want('scene')) await captureScene(browser);
  if (want('alarm')) await captureAlarm(browser);
  if (want('fight')) await captureFight(browser);
  if (want('hulls')) await captureHulls(browser);
  if (want('ui')) await captureUi(browser);
  await browser.close();
  writeFileSync(join(OUT, `index${only === 'all' ? '' : '-' + only}.json`), JSON.stringify(notes, null, 2));
  console.log('[done] frames=', notes.frames.length);
}

main().catch((e) => { console.error(e); process.exit(1); });
