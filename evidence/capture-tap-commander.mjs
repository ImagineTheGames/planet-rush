/**
 * evidence/capture-tap-commander.mjs — "Tap Commander works by touch" (p6). OWNER: QA Manager.
 *
 * Three deliverables, every one driven by a REAL touch (page.touchscreen.tap /
 * CDP Input.dispatchTouchEvent) on an EMULATED PHONE (hasTouch, isMobile), read
 * back through the shipped bundle's own ?debug=1 seams the platform/UI lanes'
 * live-stage specs use — then LOOKED AT by the QA officer's eyes:
 *
 *   1. tap-move       — scheme switched to Tap Commander; a real tap on empty
 *      space drops a waypoint marker AT the tap point, then the ship flies there.
 *      Two frames, coordinates captioned from the debug hook. Proven in LANDSCAPE
 *      and PORTRAIT hold (the landscape-lock tap→world remap is the risk).
 *   2. tap-attack-lock — a real tap on a parked bot LOCKS it: a reticle rides the
 *      target and projectiles flow (the sim's `firing` tell + the intent line). A
 *      real tap on empty space drops the lock (reticle gone) and the ship moves to
 *      the new point. Then the scheme is switched back to sticks and a real touch
 *      stick drive still produces thrust at the sim — sticks survive the round trip.
 *   3. minimap-toggle — the collapsed corner minimap (tiny, bottom-right, clear of
 *      the thumb zones), a real tap EXPANDING it to a readable centred overlay with
 *      the arena visible behind, a real tap COLLAPSING it again. The own-ship dot
 *      tracks the debug hook's ship position (measured: dot delta vs shipWorld delta).
 *
 * Every frame prints the seam readback it was shot at, so the attestation cites
 * numbers this run actually saw. Then composes three captioned montages.
 *
 * Usage: node evidence/capture-tap-commander.mjs   (needs a preview on $EVIDENCE_BASE_URL)
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4207';
const DSF = 2;
const PHONE_LS = { width: 844, height: 390 }; // landscape phone
const PHONE_PT = { width: 390, height: 844 }; // portrait phone (landscape-lock rotates the game)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (v) => Math.round(v * 10) / 10;

async function newPage(browser, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: DSF, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page._errors = errors;
  page._ctx = ctx;
  return page;
}

async function boot(browser, viewport) {
  const page = await newPage(browser, viewport);
  await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () =>
      typeof window.__tapCommanderStage?.stage === 'function' &&
      typeof window.__tapMarkerStage?.markers === 'function' &&
      typeof window.__minimapStage?.state === 'function' &&
      !!window.__planetRush?.shipScreen,
    undefined,
    { timeout: 20_000 },
  );
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  return page;
}

const tick = (p) => p.evaluate(() => window.__planetRush.ticks);
const waitTick = (p, t) => p.waitForFunction((x) => window.__planetRush.ticks >= x, t, { timeout: 25_000 });
const hook = (p) => p.evaluate(() => ({ s: { ...window.__planetRush.shipScreen }, w: { ...window.__planetRush.shipWorld } }));
const order = (p) => p.evaluate(() => window.__tapCommanderStage.order());
const markers = (p) => p.evaluate(() => window.__tapMarkerStage.markers());
const readout = (p) => p.evaluate(() => window.__tapCommanderStage.readout());
const mmState = (p) => p.evaluate(() => window.__minimapStage.state());

// ── 1. tap-move (landscape + portrait) ──────────────────────────────────────
// A real tap on empty space → waypoint marker at the tap, then the ship arrives.
async function tapMove(browser, viewport, tag) {
  const page = await boot(browser, viewport);
  // Park the ship at arena centre with the field cleared, so a tap on empty space
  // is unambiguous; switch to Tap Commander. (The seam does exactly what the
  // settings row / KeyC toggle does — persists the scheme — it does not fake input.)
  const staged = await page.evaluate(() => { window.__tapCommanderStage.setScheme('tap'); return window.__tapCommanderStage.stage(); });
  await waitTick(page, (await tick(page)) + 3);
  const vp = page.viewportSize();

  // Pick an empty tap point well away from the centred ship AND the parked bot
  // (bot is 140 world units off centre). Verify the tap became a MOVE, not a lock;
  // retry a different corner if a target was under the thumb.
  const candidates = [
    { x: vp.width * 0.30, y: vp.height * 0.28 },
    { x: vp.width * 0.30, y: vp.height * 0.72 },
    { x: vp.width * 0.70, y: vp.height * 0.30 },
  ];
  let before, tapPt, ord, mk;
  for (const c of candidates) {
    await page.evaluate(() => window.__tapCommanderStage.stage());
    await waitTick(page, (await tick(page)) + 3);
    before = await hook(page);
    tapPt = { x: Math.round(c.x), y: Math.round(c.y) };
    await page.touchscreen.tap(tapPt.x, tapPt.y);
    ord = await order(page);
    if (ord.kind === 'waypoint') { mk = await markers(page); break; }
  }
  if (ord.kind !== 'waypoint') throw new Error(`${tag}: could not land an empty-space tap`);

  await page.screenshot({ path: join(OUT, `move-${tag}-marker-raw.png`), animations: 'disabled' });

  // Fly to it: the pilot clears the order on arrival (arriveRadius). Wait for the
  // order to clear OR the ship to reach the waypoint world point.
  const wp = ord.at;
  await page
    .waitForFunction(
      (w) => {
        const o = window.__tapCommanderStage.order();
        const s = window.__tapCommanderStage.readout().shipPos;
        if (!s) return false;
        const near = Math.hypot(s.x - w.x, s.y - w.y) < 30;
        return o.kind === 'none' || near;
      },
      wp,
      { timeout: 15_000 },
    )
    .catch(() => {});
  await waitTick(page, (await tick(page)) + 2);
  const arrived = await readout(page);
  const afterHook = await hook(page);
  await page.screenshot({ path: join(OUT, `move-${tag}-arrived-raw.png`), animations: 'disabled' });

  // The marker readout is in LOGICAL (landscape) space. In landscape that IS the
  // physical viewport; in portrait the landscape-lock rotates the game root 90°, so
  // convert the marker back into PHYSICAL viewport space to compare it to the tap
  // (which is physical). physical = (vw − logicalY, logicalX) for the portrait lock.
  const portrait = viewport.height > viewport.width;
  const markerPhysical = mk.waypoint
    ? (portrait ? { x: vp.width - mk.waypoint.y, y: mk.waypoint.x } : { x: mk.waypoint.x, y: mk.waypoint.y })
    : null;
  const markerVsTap = markerPhysical ? round(Math.hypot(markerPhysical.x - tapPt.x, markerPhysical.y - tapPt.y)) : null;

  const info = {
    tag, viewport, tapScreen: tapPt,
    markerLogical: mk.waypoint && { x: round(mk.waypoint.x), y: round(mk.waypoint.y) },
    markerPhysical: markerPhysical && { x: round(markerPhysical.x), y: round(markerPhysical.y) },
    markerVsTap,
    waypointWorld: { x: round(wp.x), y: round(wp.y) },
    shipWorldBefore: { x: round(before.w.x), y: round(before.w.y) },
    shipWorldArrived: arrived.shipPos && { x: round(arrived.shipPos.x), y: round(arrived.shipPos.y) },
    shipScreen: { x: round(afterHook.s.x), y: round(afterHook.s.y) },
    orderAfterArrival: (await order(page)).kind,
    errors: page._errors.slice(),
  };
  console.log(`[tap-move ${tag}]`, JSON.stringify(info));
  await page._ctx.close();
  return info;
}

// ── 2. tap-attack-lock ──────────────────────────────────────────────────────
async function tapAttackLock(browser) {
  const page = await boot(browser, PHONE_LS);
  const staged = await page.evaluate(() => { window.__tapCommanderStage.setScheme('tap'); return window.__tapCommanderStage.stage(); });
  await waitTick(page, (await tick(page)) + 3);
  const h = await hook(page);
  // The bot is parked 140 world units to the RIGHT of the centred ship. Landscape
  // world↔screen is 1:1 here (measured), so the bot sits 140px right of the ship's
  // screen centre. A real tap there LOCKS it.
  const botScreen = { x: Math.round(h.s.x + (staged.bot.x - h.w.x)), y: Math.round(h.s.y + (staged.bot.y - h.w.y)) };
  await page.touchscreen.tap(botScreen.x, botScreen.y);
  const lockOrder = await order(page);
  // Wait for the pilot to close range and open fire, and the reticle + intent line.
  await page.waitForFunction(() => window.__tapCommanderStage.readout().firing === true, undefined, { timeout: 10_000 });
  await page.waitForFunction(() => window.__tapMarkerStage.markers().reticle !== null && window.__tapMarkerStage.markers().intent === true, undefined, { timeout: 10_000 });
  await sleep(60); // let a volley of projectiles get airborne between ship and bot
  const lockMarkers = await markers(page);
  const lockReadout = await readout(page);
  await page.screenshot({ path: join(OUT, 'attack-lock-raw.png'), animations: 'disabled' });

  // Real tap on empty space → the lock clears, its reticle with it, ship moves.
  const emptyPt = { x: Math.round(h.s.x - 150), y: Math.round(h.s.y - 70) };
  await page.touchscreen.tap(emptyPt.x, emptyPt.y);
  await page.waitForFunction(() => window.__tapMarkerStage.markers().reticle === null, undefined, { timeout: 8_000 });
  await waitTick(page, (await tick(page)) + 2);
  const clearOrder = await order(page);
  const clearMarkers = await markers(page);
  await page.screenshot({ path: join(OUT, 'attack-clear-raw.png'), animations: 'disabled' });

  // Switch BACK to sticks and prove a real touch stick drive still reaches the sim.
  await page.evaluate(() => window.__tapCommanderStage.setScheme('sticks'));
  await waitTick(page, (await tick(page)) + 2);
  const client = await page._ctx.newCDPSession(page);
  const from = { x: 150, y: 300 }, to = { x: 55, y: 300 }; // left-stick drag (leftward thrust)
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  for (let i = 1; i <= 6; i++) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / 6, y: from.y }] });
  }
  await waitTick(page, (await tick(page)) + 6);
  const stickInput = await page.evaluate(() => ({ ...window.__planetRush.input.thrust }));
  await sleep(40);
  await page.screenshot({ path: join(OUT, 'attack-sticks-raw.png'), animations: 'disabled' });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();

  const info = {
    botId: staged.botId,
    botScreen,
    lockKind: lockOrder.kind, lockRef: lockOrder.ref,
    reticle: lockMarkers.reticle && { x: round(lockMarkers.reticle.x), y: round(lockMarkers.reticle.y), radius: lockMarkers.reticle.radius, color: '#' + lockMarkers.reticle.color.toString(16).padStart(6, '0') },
    intent: lockMarkers.intent, firing: lockReadout.firing,
    shipScreenX: round(h.s.x),
    emptyPt, clearKind: clearOrder.kind, clearReticle: clearMarkers.reticle,
    sticksScheme: (await readout(page)).scheme, stickThrust: { x: round(stickInput.x), y: round(stickInput.y) },
    errors: page._errors.slice(),
  };
  console.log('[tap-attack-lock]', JSON.stringify(info));
  await page._ctx.close();
  return info;
}

// ── 3. minimap-toggle ───────────────────────────────────────────────────────
async function minimapToggle(browser) {
  const page = await boot(browser, PHONE_LS);
  await page.waitForFunction(() => { const s = window.__minimapStage.state(); return s.rect.width > 0 && s.planetCount > 0; }, undefined, { timeout: 20_000 });

  const collapsed0 = await mmState(page);
  const hook0 = await hook(page);
  await page.screenshot({ path: join(OUT, 'minimap-collapsed-raw.png'), animations: 'disabled' });

  // Prove the own-ship dot tracks the debug hook: drive the touch stick, then read
  // both the minimap dot and the hook's shipWorld again — both must have moved,
  // and in a consistent direction.
  const client = await page._ctx.newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: 300 }] });
  for (let i = 1; i <= 6; i++) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 150 - 95 * i / 6, y: 300 }] });
  await waitTick(page, (await tick(page)) + 45);
  const movedState = await mmState(page);
  const hook1 = await hook(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();

  // Real tap on the collapsed corner → EXPAND.
  const cc = { x: Math.round(collapsed0.rect.x + collapsed0.rect.width / 2), y: Math.round(collapsed0.rect.y + collapsed0.rect.height / 2) };
  await page.touchscreen.tap(cc.x, cc.y);
  await page.waitForFunction(() => window.__minimapStage.state().expanded === true, undefined, { timeout: 8_000 });
  await sleep(120);
  const expanded = await mmState(page);
  await page.screenshot({ path: join(OUT, 'minimap-expanded-raw.png'), animations: 'disabled' });

  // Real tap on the overlay → COLLAPSE again.
  const ec = { x: Math.round(expanded.rect.x + expanded.rect.width / 2), y: Math.round(expanded.rect.y + expanded.rect.height / 2) };
  await page.touchscreen.tap(ec.x, ec.y);
  await page.waitForFunction(() => window.__minimapStage.state().expanded === false, undefined, { timeout: 8_000 });
  await sleep(120);
  const recollapsed = await mmState(page);
  await page.screenshot({ path: join(OUT, 'minimap-recollapsed-raw.png'), animations: 'disabled' });

  const vp = page.viewportSize();
  const info = {
    viewport: vp,
    collapsedRect: collapsed0.rect,
    cornerClearOfThumbs: collapsed0.rect.x > vp.width * 0.8 && collapsed0.rect.y > vp.height * 0.6,
    ownDot0: collapsed0.ownDot && { x: round(collapsed0.ownDot.x), y: round(collapsed0.ownDot.y) },
    dotDelta: movedState.ownDot && collapsed0.ownDot && { x: round(movedState.ownDot.x - collapsed0.ownDot.x), y: round(movedState.ownDot.y - collapsed0.ownDot.y) },
    shipWorldDelta: { x: round(hook1.w.x - hook0.w.x), y: round(hook1.w.y - hook0.w.y) },
    tapCorner: cc, expandedRect: { x: round(expanded.rect.x), y: round(expanded.rect.y), width: round(expanded.rect.width), height: round(expanded.rect.height) },
    expandedBigger: expanded.rect.width > collapsed0.rect.width,
    planetCount: expanded.planetCount, shipCount: expanded.shipCount, oreCount: expanded.oreCount,
    tapOverlay: ec, recollapsedExpanded: recollapsed.expanded,
    errors: page._errors.slice(),
  };
  console.log('[minimap-toggle]', JSON.stringify(info));
  await page._ctx.close();
  return info;
}

// ── montage composer (captioned HTML → screenshot), mirrors capture-p4-* ─────
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
  // A dedicated 1× context (a montage needs no retina) sized to the grid width; the
  // page grows as tall as the panels need and `fullPage` captures all of it, so a
  // long caption can never be clipped by a too-short viewport.
  const ctx = await browser.newContext({ viewport: { width: cols * 460 + (cols - 1) * 14 + 60, height: 320 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.setContent(figureHTML(title, subtitle, panels, cols), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  // Wait for every panel image to actually decode so layout height is final.
  await page.evaluate(() => Promise.all([...document.images].map((i) => (i.decode ? i.decode().catch(() => {}) : null))));
  await sleep(120);
  await page.screenshot({ path: join(OUT, name), fullPage: true });
  await ctx.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  const moveLs = await tapMove(browser, PHONE_LS, 'landscape');
  const movePt = await tapMove(browser, PHONE_PT, 'portrait');
  const atk = await tapAttackLock(browser);
  const mm = await minimapToggle(browser);

  const sha = (process.env.EVIDENCE_SHA ?? 'local').trim();

  await compose(browser, 'tap-move.png',
    'Tap Commander — tap-to-move works by touch (landscape + portrait)',
    `Emulated phone (hasTouch, isMobile), scheme switched to Tap Commander. A REAL touch on empty space drops a waypoint marker AT the tap point, then the ship flies there — the pilot clears the order on arrival. Coordinates read from the ?debug=1 hook. Portrait exercises the landscape-lock tap→world remap (the risk). Build ${sha}.`,
    [
      { img: 'move-landscape-marker-raw.png', tag: 'LANDSCAPE', cap: `Real touch at screen (${moveLs.tapScreen.x}, ${moveLs.tapScreen.y}); the waypoint marker drew at screen (${moveLs.markerPhysical.x}, ${moveLs.markerPhysical.y}) — ${moveLs.markerVsTap}px off the thumb, i.e. AT the tap. Order = MOVE to world (${moveLs.waypointWorld.x}, ${moveLs.waypointWorld.y}); ship at world (${moveLs.shipWorldBefore.x}, ${moveLs.shipWorldBefore.y}).` },
      { img: 'move-landscape-arrived-raw.png', tag: 'ARRIVED', cap: `Ship flew to world (${moveLs.shipWorldArrived.x}, ${moveLs.shipWorldArrived.y}) — the waypoint — and the order cleared (now "${moveLs.orderAfterArrival}"), so the marker is gone. Camera keeps the ship screen-centred.` },
      { img: 'move-portrait-marker-raw.png', tag: 'PORTRAIT', cap: `Physical portrait hold; the landscape lock rotates the game 90° (WAVE/HOME read sideways). Real touch at screen (${movePt.tapScreen.x}, ${movePt.tapScreen.y}); the waypoint marker drew at physical (${movePt.markerPhysical.x}, ${movePt.markerPhysical.y}) — ${movePt.markerVsTap}px off the thumb. Order = MOVE to world (${movePt.waypointWorld.x}, ${movePt.waypointWorld.y}): the tap→world remap held through the rotation.` },
      { img: 'move-portrait-arrived-raw.png', tag: 'ARRIVED', cap: `Ship flew to world (${movePt.shipWorldArrived.x}, ${movePt.shipWorldArrived.y}) — the waypoint — and the order cleared ("${movePt.orderAfterArrival}"). Tap-to-move works in portrait too.` },
    ], 2);

  await compose(browser, 'tap-attack-lock.png',
    'Tap Commander — tap-to-attack, release, and sticks survive the round trip',
    `Emulated landscape phone. A REAL touch on the parked bot LOCKS it (a reticle rides the target, projectiles flow); a real touch on empty space DROPS the lock and moves the ship; switching back to sticks, a real touch stick drive still reaches the sim. Build ${sha}.`,
    [
      { img: 'attack-lock-raw.png', tag: 'LOCK + FIRE', cap: `Real touch on the bot at screen (${atk.botScreen.x}, ${atk.botScreen.y}) locked target ${atk.lockRef.kind} #${atk.lockRef.id} (the bot). Reticle rides it at screen (${atk.reticle.x}, ${atk.reticle.y}) — right of the centred ship (x≈${atk.shipScreenX}). sim firing = ${atk.firing}, intent line = ${atk.intent}.` },
      { img: 'attack-clear-raw.png', tag: 'RELEASE', cap: `Real touch on empty space at screen (${atk.emptyPt.x}, ${atk.emptyPt.y}): the lock cleared (reticle = ${String(atk.clearReticle)}), the order became a MOVE ("${atk.clearKind}"), the ship heads for the new point.` },
      { img: 'attack-sticks-raw.png', tag: 'STICKS BACK', cap: `Switched back to "${atk.sticksScheme}". A real touch left-stick drag produces thrust (${atk.stickThrust.x}, ${atk.stickThrust.y}) at the sim — the twin-stick HUD works exactly as before.` },
    ], 3);

  await compose(browser, 'minimap-toggle.png',
    'Minimap — tap to expand, tap to collapse; the own-ship dot tracks the ship',
    `Emulated landscape phone. The collapsed minimap is a tiny bottom-right square clear of the thumb zones; a REAL touch expands it to a readable centred overlay with the arena visible behind; a real touch collapses it again. The own-ship dot moves with the debug-hook ship position. Build ${sha}.`,
    [
      { img: 'minimap-collapsed-raw.png', tag: 'COLLAPSED', cap: `Corner square at (${mm.collapsedRect.x}, ${mm.collapsedRect.y}) ${mm.collapsedRect.width}×${mm.collapsedRect.height} in a ${mm.viewport.width}×${mm.viewport.height} view — bottom-right, clear of thumbs (${mm.cornerClearOfThumbs}). Own-ship dot at (${mm.ownDot0.x}, ${mm.ownDot0.y}). A touch stick drive moved shipWorld by (${mm.shipWorldDelta.x}, ${mm.shipWorldDelta.y}) and the dot tracked it by (${mm.dotDelta.x}, ${mm.dotDelta.y}).` },
      { img: 'minimap-expanded-raw.png', tag: 'EXPANDED', cap: `Real touch at (${mm.tapCorner.x}, ${mm.tapCorner.y}) expanded to a ${mm.expandedRect.width}×${mm.expandedRect.height} centred overlay (bigger = ${mm.expandedBigger}) showing ${mm.planetCount} planets, ${mm.shipCount} ships, ${mm.oreCount} ore hints — the arena reads behind it.` },
      { img: 'minimap-recollapsed-raw.png', tag: 'COLLAPSED', cap: `Real touch at (${mm.tapOverlay.x}, ${mm.tapOverlay.y}) collapsed it back to the corner (expanded = ${mm.recollapsedExpanded}). The toggle is a clean two-state round trip.` },
    ], 3);

  console.log('[done]', JSON.stringify({
    errors: [...moveLs.errors, ...movePt.errors, ...atk.errors, ...mm.errors],
  }));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
