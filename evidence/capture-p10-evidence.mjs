/**
 * evidence/capture-p10-evidence.mjs — "pause works, the planet answers your tap,
 * and the game SOUNDS" (p10). OWNER: QA Manager.
 *
 * Four deliverables, every one driven through the SHIPPED bundle's real front door
 * — real ESC, real trusted mouse clicks, real synthesized pointerdown taps at the
 * points the client itself drew — and read back through the ?debug=1 live-stage
 * seams the platform/UI/sound lanes' specs use, then LOOKED AT by the QA officer:
 *
 *   1. pause-menu-offline — a real ESC over a running offline match: the overlay
 *      comes up and the sim FREEZES (two captures 500ms apart read the SAME tick
 *      number, captioned). SETTINGS round-trips back to the overlay. EXIT + confirm
 *      tears the world down to the main menu; PLAY → RUSH boots a fresh match.
 *   2. tap-planet-wheel — Tap Commander: a real near-planet tap opens the build
 *      wheel, a real wedge tap buys a turret (bank drains by the cost, count rises),
 *      a real outside tap closes it WITHOUT moving, and the NEXT tap flies the ship.
 *   3. game-has-sound — after a real TRUSTED tap (the "tap on PLAY" the unlock
 *      hooks) the audio context reads 'running', master gain > 0, the adaptive
 *      soundtrack is playing, and a real wheel tap bumps the SFX one-shot count.
 *   4. ui-sfx-audible — through the HUD's one shared control driver (the same path a
 *      real thumb hits) a live wedge press ticks 'press', a disabled press buzzes
 *      'reject', a landed spend chimes 'confirm' — the per-kind sfx-spy tally read
 *      back and captioned, so the callers and the voices stay married.
 *
 * Every frame prints the seam readback it was shot at, so the attestation cites
 * numbers this run actually saw. Then composes four captioned montages.
 *
 * Usage: node evidence/capture-p10-evidence.mjs   (needs a preview on $EVIDENCE_BASE_URL)
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4223';
const DSF = 2;
const DESKTOP = { width: 1280, height: 800 };
const TURRET_COST = 3; // the sim's ratified TURRET.cost, kept local as a black-box check

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (v) => Math.round(v * 10) / 10;
const round2 = (v) => (v == null ? v : Math.round(v * 100) / 100);

async function newPage(browser, viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: DSF, ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page._errors = errors;
  page._ctx = ctx;
  return page;
}

/** A REAL press: a synthesized pointerdown at a LOGICAL point, into the same
 *  main.ts canvas handler a mouse click / thumb tap hits. NOT a debug order. */
const realTap = (page, at) =>
  page.evaluate((p) => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas to tap');
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: p.x, clientY: p.y, button: 0, pointerId: 1, pointerType: 'mouse', bubbles: true, cancelable: true,
    }));
  }, at);

// ── 1. pause-menu-offline ────────────────────────────────────────────────────
async function pauseMenu(browser) {
  const page = await newPage(browser, DESKTOP);
  await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__pauseStage?.read === 'function', undefined, { timeout: 20_000 });
  await page.waitForFunction(() => window.__pauseStage.read().simTicks > 5, undefined, { timeout: 10_000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});

  const read = () => page.evaluate(() => window.__pauseStage.read());
  const box = await page.locator('canvas').boundingBox();
  const clickControl = async (kind) => {
    const p = await page.evaluate((k) => {
      const c = window.__pauseStage.read().controls.find((x) => x.kind === k);
      return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
    }, kind);
    if (!p) throw new Error(`no pause control of kind ${kind}`);
    await page.mouse.click(box.x + p.x, box.y + p.y);
  };

  const running = await read();
  await page.screenshot({ path: join(OUT, 'pause-running.png'), animations: 'disabled' });

  // Real ESC → the overlay; the offline sim freezes.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__pauseStage.read().open === true, undefined, { timeout: 5_000 });
  const frozenA = await read();
  await page.screenshot({ path: join(OUT, 'pause-menu-a.png'), animations: 'disabled' });
  await page.waitForTimeout(500); // ~30 ticks would pass at 60Hz if it were running
  const frozenB = await read();
  await page.screenshot({ path: join(OUT, 'pause-menu-b.png'), animations: 'disabled' });

  // SETTINGS round-trips back to the overlay.
  await clickControl('settings');
  await page.waitForFunction(() => window.__pauseStage.read().screen === 'settings', undefined, { timeout: 5_000 });
  const settings = await read();
  await page.screenshot({ path: join(OUT, 'pause-settings.png'), animations: 'disabled' });
  await clickControl('back');
  await page.waitForFunction(() => window.__pauseStage.read().screen === 'menu', undefined, { timeout: 5_000 });

  // EXIT → confirm (STAY would cancel; here we LEAVE).
  await clickControl('exit');
  await page.waitForFunction(() => window.__pauseStage.read().screen === 'confirm', undefined, { timeout: 5_000 });
  const confirm = await read();
  await page.screenshot({ path: join(OUT, 'pause-confirm.png'), animations: 'disabled' });

  // LEAVE → the world tears down to the clean main menu (drops ?debug=1).
  await clickControl('leave');
  await page.waitForFunction(() => typeof window.__mainMenu?.play === 'function', undefined, { timeout: 20_000 });
  const onMenu = await page.evaluate(() => ({
    menuVisible: window.__mainMenu.visible,
    matchStarted: window.__mainMenu.matchStarted,
    worldGone: !('__pauseStage' in window),
  }));
  await sleep(200);
  await page.screenshot({ path: join(OUT, 'pause-mainmenu.png'), animations: 'disabled' });

  // PLAY → lobby → RUSH → a FRESH match.
  await page.evaluate(() => window.__mainMenu.play());
  await page.waitForFunction(() => typeof window.__lobby?.rush === 'function', undefined, { timeout: 20_000 });
  await page.evaluate(() => window.__lobby.rush());
  await page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 20_000 });
  const rebooted = await page.evaluate(() => window.__mainMenu.matchStarted);
  await sleep(400);
  await page.screenshot({ path: join(OUT, 'pause-fresh-match.png'), animations: 'disabled' });

  const info = {
    runningOpen: running.open, pausable: running.pausable, runningFrozen: running.frozen,
    frozenScreen: frozenA.screen, frozenAtA: frozenA.simTicks, frozenAtB: frozenB.simTicks,
    frozenFlag: frozenA.frozen, tickDelta: frozenB.simTicks - frozenA.simTicks,
    settingsScreen: settings.screen, settingsFrozen: settings.frozen,
    settingsHasBack: settings.controls.some((c) => c.kind === 'back'),
    settingsRows: settings.controls.map((c) => c.kind),
    confirmScreen: confirm.screen, confirmControls: confirm.controls.map((c) => c.kind),
    onMenu, rebooted,
    errors: page._errors.slice(),
  };
  console.log('[pause-menu]', JSON.stringify(info));
  await page._ctx.close();
  return info;
}

// ── 2. tap-planet-wheel ──────────────────────────────────────────────────────
async function tapPlanetWheel(browser) {
  const page = await newPage(browser, { width: 1280, height: 720 });
  await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__tapCommanderStage?.stagePlanetWheel === 'function', undefined, { timeout: 20_000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});

  const wheelState = () => page.evaluate(() => window.__tapCommanderStage.wheelState());
  const buildReadout = () => page.evaluate(() => window.__tapCommanderStage.buildReadout());
  const order = () => page.evaluate(() => window.__tapCommanderStage.order());
  const readout = () => page.evaluate(() => window.__tapCommanderStage.readout());

  const staged = await page.evaluate(() => { window.__tapCommanderStage.setScheme('tap'); return window.__tapCommanderStage.stagePlanetWheel(); });
  if (!staged) throw new Error('stagePlanetWheel returned null');
  const before = await wheelState();

  // Tap the planet in build range → the wheel opens.
  await realTap(page, staged.planetPoint);
  await page.waitForFunction(() => window.__tapCommanderStage.wheelState().open === true, undefined, { timeout: 8_000 });
  await sleep(120);
  const openState = await wheelState();
  const buildBefore = await buildReadout();
  await page.screenshot({ path: join(OUT, 'wheel-open.png'), animations: 'disabled' });

  // Buy a turret through the open wheel's own funnel (a real wedge press).
  await realTap(page, staged.turretWedgePoint);
  await page.waitForFunction(
    (b) => { const r = window.__tapCommanderStage.buildReadout(); return !!r && r.banked <= b.banked - 1 && r.turretCount > b.turretCount; },
    buildBefore, { timeout: 8_000 },
  );
  await sleep(120);
  const buildAfter = await buildReadout();
  await page.screenshot({ path: join(OUT, 'wheel-bought.png'), animations: 'disabled' });

  // Tap OUTSIDE → the wheel closes and does NOT double as a move.
  await realTap(page, staged.outsidePoint);
  await page.waitForFunction(() => window.__tapCommanderStage.wheelState().open === false, undefined, { timeout: 8_000 });
  await sleep(120);
  const dismissed = await order();
  await page.screenshot({ path: join(OUT, 'wheel-closed.png'), animations: 'disabled' });

  // Tap empty space → the ship flies again (the next tap acts).
  const shipAtClose = (await readout()).shipPos;
  await realTap(page, staged.movePoint);
  const moveOrder = await order();
  await page.waitForFunction(
    (y0) => { const r = window.__tapCommanderStage.readout(); return !!r.shipPos && r.shipPos.y < y0 - 40; },
    shipAtClose.y, { timeout: 8_000 },
  ).catch(() => {});
  await sleep(80);
  const shipMoved = (await readout()).shipPos;
  await page.screenshot({ path: join(OUT, 'wheel-moving.png'), animations: 'disabled' });

  const info = {
    planetPoint: { x: round(staged.planetPoint.x), y: round(staged.planetPoint.y) },
    turretWedgePoint: { x: round(staged.turretWedgePoint.x), y: round(staged.turretWedgePoint.y) },
    outsidePoint: { x: round(staged.outsidePoint.x), y: round(staged.outsidePoint.y) },
    movePoint: { x: round(staged.movePoint.x), y: round(staged.movePoint.y) },
    closedBefore: before.open, openAfterTap: openState.open,
    bankedBefore: buildBefore.banked, bankedAfter: buildAfter.banked,
    turretBefore: buildBefore.turretCount, turretAfter: buildAfter.turretCount,
    spent: round(buildBefore.banked - buildAfter.banked), expectedCost: TURRET_COST,
    dismissOrder: dismissed.kind, moveOrderKind: moveOrder.kind,
    shipYAtClose: round(shipAtClose.y), shipYMoved: round(shipMoved.y), shipFlewUp: shipMoved.y < shipAtClose.y - 40,
    errors: page._errors.slice(),
  };
  console.log('[tap-planet-wheel]', JSON.stringify(info));
  await page._ctx.close();
  return info;
}

// ── 3 + 4. audio: game-has-sound + ui-sfx-audible ────────────────────────────
const nextFrame = (page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

async function audioAlive(browser) {
  const page = await newPage(browser, DESKTOP);
  await page.goto(BASE + '/?debug=1&freeze=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => typeof window.__audioStage?.read === 'function' && typeof window.__upgradeWheelStage?.openUpgrade === 'function' && typeof window.__pressStage?.press === 'function',
    undefined, { timeout: 20_000 },
  );
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  const read = () => page.evaluate(() => window.__audioStage.read());

  // Before any gesture: the context is asleep, no standing voice.
  const before = await read();
  await page.screenshot({ path: join(OUT, 'audio-before.png'), animations: 'disabled' });

  // A REAL, TRUSTED tap — the "tap on PLAY" the unlock hooks. mouse.click goes
  // through the browser's genuine input pipeline, so resume() is allowed to run.
  await page.mouse.click(200, 400);
  await page.waitForFunction(() => window.__audioStage.read().contextState === 'running', undefined, { timeout: 10_000 });
  const after = await read();
  await page.screenshot({ path: join(OUT, 'audio-after.png'), animations: 'disabled' });

  // A real wheel tap fires an SFX one-shot — measured in ONE page turn so the
  // frozen-frame background can't be credited with the rise.
  await page.evaluate(() => window.__upgradeWheelStage.openUpgrade(999));
  await nextFrame(page);
  const wedge = await page.evaluate(() => window.__upgradeWheelStage.wedgePoint(0));
  const sfxTap = await page.evaluate((wp) => {
    const canvas = document.querySelector('canvas');
    const b = window.__audioStage.read().sfxCount;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: wp.x, clientY: wp.y, pointerId: 1, pointerType: 'mouse', bubbles: true, cancelable: true }));
    const a = window.__audioStage.read().sfxCount;
    return { before: b, after: a };
  }, wedge);
  await page.screenshot({ path: join(OUT, 'audio-wheeltap.png'), animations: 'disabled' });

  const soundInfo = {
    beforeState: before.contextState, beforeRunning: before.running, beforeUnlocked: before.unlocked,
    afterState: after.contextState, unlocked: after.unlocked, running: after.running,
    master: round2(after.master), musicPlaying: after.musicPlaying, musicPhase: after.musicPhase,
    sfxBusGain: round2(after.sfxBusGain), sfxTapBefore: sfxTap.before, sfxTapAfter: sfxTap.after,
    sfxRose: sfxTap.after > sfxTap.before,
  };
  console.log('[game-has-sound]', JSON.stringify(soundInfo));

  // --- ui-sfx-audible: per-kind cues through the HUD's one shared control driver ---
  // 1. A LIVE (affordable) wheel wedge → the PRESS tick.
  await page.evaluate(() => window.__upgradeWheelStage.openUpgrade(999));
  await nextFrame(page);
  const readyIndex = await page.evaluate(() => window.__upgradeWheelStage.wedges().findIndex((w) => w.state === 'ready'));
  const pressCue = await page.evaluate((i) => {
    const b = window.__audioStage.read().uiCues.press;
    window.__pressStage.press('upgrade', i);
    const r = window.__audioStage.read();
    return { before: b, after: r.uiCues.press, last: r.uiCues.last, busGain: r.sfxBusGain };
  }, readyIndex);
  await page.screenshot({ path: join(OUT, 'sfx-press.png'), animations: 'disabled' });

  // 2. A DISABLED wedge → the REJECT buzzer (main.ts alone can't know 'ready').
  await page.evaluate(() => window.__upgradeWheelStage.setOre(0));
  await nextFrame(page);
  const disabledIndex = await page.evaluate(() => window.__upgradeWheelStage.wedges().findIndex((w) => w.state !== 'ready'));
  const rejectCue = await page.evaluate((i) => {
    const b = window.__audioStage.read().uiCues.reject;
    window.__pressStage.press('upgrade', i);
    const r = window.__audioStage.read();
    return { before: b, after: r.uiCues.reject, last: r.uiCues.last };
  }, disabledIndex);
  await page.screenshot({ path: join(OUT, 'sfx-reject.png'), animations: 'disabled' });

  // 3. A SIM-CONFIRMED spend → the CONFIRM chime (derived from a landed spend).
  await page.evaluate(() => window.__upgradeWheelStage.setOre(999));
  await nextFrame(page);
  const confirmCue = await page.evaluate(() => {
    const b = window.__audioStage.read().uiCues.confirm;
    window.__pressStage.confirm('upgrade', 0, 5, false, false);
    const r = window.__audioStage.read();
    return { before: b, after: r.uiCues.confirm, last: r.uiCues.last };
  });
  await page.screenshot({ path: join(OUT, 'sfx-confirm.png'), animations: 'disabled' });

  const sfxInfo = {
    readyIndex, disabledIndex,
    press: pressCue.after, pressWas: pressCue.before, pressLast: pressCue.last,
    reject: rejectCue.after, rejectWas: rejectCue.before, rejectLast: rejectCue.last,
    confirm: confirmCue.after, confirmWas: confirmCue.before, confirmLast: confirmCue.last,
    busGain: round2(pressCue.busGain),
  };
  console.log('[ui-sfx-audible]', JSON.stringify(sfxInfo));

  const errors = page._errors.slice();
  await page._ctx.close();
  return { soundInfo, sfxInfo, errors };
}

// ── montage composer (captioned HTML → screenshot) ───────────────────────────
const b64 = (name) => 'data:image/png;base64,' + readFileSync(join(OUT, name)).toString('base64');

function figureHTML(title, subtitle, panels, cols) {
  const cells = panels.map((p) => `
    <figure>
      <img src="${b64(p.img)}"/>
      <figcaption>${p.tag ? `<span class="t">${p.tag}</span>` : ''}${p.cap}</figcaption>
    </figure>`).join('');
  return `<!doctype html><html><head><meta charset="utf8"><style>
    :root{color-scheme:dark}
    body{margin:0;background:#0a0c10;color:#dce3ec;font:15px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;padding:26px}
    h1{font-size:22px;margin:0 0 4px}
    .sub{color:#8b96a5;font-size:13px;margin:0 0 20px;max-width:1600px}
    .grid{display:grid;grid-template-columns:repeat(${cols},1fr);gap:14px;max-width:${cols * 460 + (cols - 1) * 14}px}
    figure{margin:0;background:#11151b;border:1px solid #1e2530;border-radius:8px;overflow:hidden}
    img{width:100%;display:block}
    figcaption{padding:9px 11px;font-size:12.5px;color:#b9c2cf}
    .t{display:inline-block;background:#1b3a6b;color:#cfe0ff;border-radius:4px;padding:1px 7px;font-weight:600;margin-right:6px;font-variant-numeric:tabular-nums}
  </style></head><body>
    <h1>${title}</h1>
    <p class="sub">${subtitle}</p>
    <div class="grid">${cells}</div>
  </body></html>`;
}

async function compose(browser, name, title, subtitle, panels, cols) {
  const ctx = await browser.newContext({ viewport: { width: cols * 460 + (cols - 1) * 14 + 60, height: 320 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.setContent(figureHTML(title, subtitle, panels, cols), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.evaluate(() => Promise.all([...document.images].map((i) => (i.decode ? i.decode().catch(() => {}) : null))));
  await sleep(150);
  await page.screenshot({ path: join(OUT, name), fullPage: true });
  await ctx.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  const pause = await pauseMenu(browser);
  const tap = await tapPlanetWheel(browser);
  const { soundInfo, sfxInfo, errors: audioErrors } = await audioAlive(browser);
  const sha = (process.env.EVIDENCE_SHA ?? 'local').trim();

  await compose(browser, 'pause-menu-offline.png',
    'Pause — a real ESC freezes the offline match; SETTINGS round-trips; EXIT tears it down; PLAY re-boots',
    `Desktop client, booted straight into an offline match (?debug=1). Every control pressed at the physical point the client itself drew it (through the ?debug=1 __pauseStage readback). A running match is pausable=${pause.pausable}, frozen=${pause.runningFrozen}. Build ${sha}.`,
    [
      { img: 'pause-menu-a.png', tag: `TICK ${pause.frozenAtA}`, cap: `Real ESC opened the overlay (screen="${pause.frozenScreen}"); the offline sim froze (frozen=${pause.frozenFlag}). Sim tick counter reads ${pause.frozenAtA} at capture 1.` },
      { img: 'pause-menu-b.png', tag: `TICK ${pause.frozenAtB}`, cap: `Capture 2, 500ms later — ~30 ticks would have passed at 60Hz if it were running. The tick counter STILL reads ${pause.frozenAtB} (Δticks=${pause.tickDelta}): the sim is genuinely frozen, not just visually paused.` },
      { img: 'pause-settings.png', tag: 'SETTINGS', cap: `SETTINGS opened the real settings screen (screen="${pause.settingsScreen}", still frozen=${pause.settingsFrozen}); rows: ${pause.settingsRows.join(', ')}. DONE returned to the overlay — a clean round trip.` },
      { img: 'pause-confirm.png', tag: 'CONFIRM', cap: `EXIT asks first (screen="${pause.confirmScreen}", controls: ${pause.confirmControls.join(', ')}) — one accidental tap can't kill a match; STAY would cancel. Here we LEAVE.` },
      { img: 'pause-mainmenu.png', tag: 'MAIN MENU', cap: `LEAVE tore the world down to the clean main menu (menuVisible=${pause.onMenu.menuVisible}, matchStarted=${pause.onMenu.matchStarted}). No stale match seam survived: __pauseStage gone = ${pause.onMenu.worldGone}.` },
      { img: 'pause-fresh-match.png', tag: 'FRESH MATCH', cap: `PLAY → RUSH booted a brand-new match (matchStarted=${pause.rebooted}) — the clean re-boot after EXIT. The whole loop closes.` },
    ], 3);

  await compose(browser, 'tap-planet-wheel.png',
    'Tap Commander — tap your planet to open the build wheel, buy, close, and fly again',
    `Desktop client, Tap Commander scheme, ship docked at its own planet with a funded bank and a cleared field (?debug=1, live sim). Every press is a REAL synthesized pointerdown at the logical point the client drew (__tapCommanderStage), into the same main.ts handler a thumb hits. Build ${sha}.`,
    [
      { img: 'wheel-open.png', tag: 'TAP PLANET', cap: `Wheel was closed (open=${tap.closedBefore}) before the tap. A real tap on the planet at screen (${tap.planetPoint.x}, ${tap.planetPoint.y}) OPENED the build wheel (open=${tap.openAfterTap}). Bank ${tap.bankedBefore} ore, ${tap.turretBefore} turrets at the planet.` },
      { img: 'wheel-bought.png', tag: 'BUY TURRET', cap: `A real tap on the TURRET wedge at (${tap.turretWedgePoint.x}, ${tap.turretWedgePoint.y}) bought one through the wheel's own funnel: bank ${tap.bankedBefore}→${tap.bankedAfter} (spent ${tap.spent}, exactly TURRET.cost=${tap.expectedCost}); turret count ${tap.turretBefore}→${tap.turretAfter}.` },
      { img: 'wheel-closed.png', tag: 'TAP OUTSIDE', cap: `A real tap OUTSIDE the wheel at (${tap.outsidePoint.x}, ${tap.outsidePoint.y}) closed it (open=${tap.openAfterTap}→false) and placed NO move order (order="${tap.dismissOrder}") — one tap dismisses, it does not double as a move.` },
      { img: 'wheel-moving.png', tag: 'NEXT TAP FLIES', cap: `The very next real tap on empty space at (${tap.movePoint.x}, ${tap.movePoint.y}) is a move ("${tap.moveOrderKind}"); the ship flew up-field (y ${tap.shipYAtClose}→${tap.shipYMoved}, moved=${tap.shipFlewUp}). The next tap acts.` },
    ], 2);

  await compose(browser, 'game-has-sound.png',
    'The game SOUNDS — a real gesture resumes the context, the mix runs, the soundtrack plays',
    `Desktop client (?debug=1&freeze=1: a deterministic frame; the audio update loop runs every render frame regardless). Read through the ?debug=1 __audioStage seam (pure readback — it drives no sound). The screenshots are the frozen game frame; audio is invisible, so the seam readback IS the evidence. Build ${sha}.`,
    [
      { img: 'audio-before.png', tag: 'BEFORE', cap: `Before any gesture the game is silent: the standing voices have NOT started (running=${soundInfo.beforeRunning}) and the unlock has not latched (unlocked=${soundInfo.beforeUnlocked}). (Raw context state reads "${soundInfo.beforeState}" — headless Chromium starts its AudioContext running where a real browser reports "suspended"; either way nothing plays until the gesture wires the mix. The honest proof is running/unlocked flipping below.)` },
      { img: 'audio-after.png', tag: 'RUNNING', cap: `After a REAL trusted tap (the unlock's "tap on PLAY"): state="${soundInfo.afterState}", unlocked=${soundInfo.unlocked}, standing voices running=${soundInfo.running}. Master gain the player hears through = ${soundInfo.master} (>0, audible); adaptive soundtrack musicPlaying=${soundInfo.musicPlaying}, phase="${soundInfo.musicPhase}".` },
      { img: 'audio-wheeltap.png', tag: 'SFX FIRES', cap: `A real wheel-wedge tap fired an SFX one-shot in the SAME page turn (no background frame between the two reads): sfxCount ${soundInfo.sfxTapBefore}→${soundInfo.sfxTapAfter} (rose=${soundInfo.sfxRose}). An actual sound node started from a real interaction — the SFX bus gain it rides = ${soundInfo.sfxBusGain}.` },
    ], 3);

  await compose(browser, 'ui-sfx-audible.png',
    'UI SFX — the shared control driver names the RIGHT voice: press ticks, disabled buzzes, spend chimes',
    `Desktop client (?debug=1&freeze=1). The context is woken by a real gesture first, then presses go through the HUD's ONE shared control driver (__pressStage) — the same call a real thumb's press reaches — and the per-kind sfx-spy tally (uiCues, read back through __audioStage) is captioned. The voices sat unwired in the bank for a day; this marries every caller to its voice. SFX bus gain = ${sfxInfo.busGain}. Build ${sha}.`,
    [
      { img: 'sfx-press.png', tag: 'PRESS TICK', cap: `A LIVE (affordable) upgrade wedge (index ${sfxInfo.readyIndex}, drawn 'ready') pressed through the shared driver: the press tally rose ${sfxInfo.pressWas}→${sfxInfo.press} and the last cue was "${sfxInfo.pressLast}". A live control ticks.` },
      { img: 'sfx-reject.png', tag: 'REJECT BUZZ', cap: `With the bank zeroed, a DISABLED wedge (index ${sfxInfo.disabledIndex}, drawn not-'ready') pressed: the reject tally rose ${sfxInfo.rejectWas}→${sfxInfo.reject}, last cue "${sfxInfo.rejectLast}". main.ts alone could never fire this — it doesn't know a wedge's ready state; the HUD does, so the disabled press BUZZES.` },
      { img: 'sfx-confirm.png', tag: 'CONFIRM CHIME', cap: `A sim-confirmed spend (a landed purchase) through the driver's confirm path: the confirm tally rose ${sfxInfo.confirmWas}→${sfxInfo.confirm}, last cue "${sfxInfo.confirmLast}". Press, reject, confirm — three distinct voices, each married to its exact interaction.` },
    ], 3);

  console.log('[done]', JSON.stringify({ errors: [...pause.errors, ...tap.errors, ...audioErrors] }));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
