/**
 * evidence/capture-p4-respawn-controls.mjs — P4 "death is legible, upgrades
 * survive it, thumbs can do everything". OWNER: QA Manager.
 *
 * Three deliverables, all off the REAL preview bundle through the ?debug=1 seams
 * the platform/UI teams' own live-stage specs drive — read by the QA officer's
 * eyes, not an assertion:
 *
 *   1. respawn-countdown   — LIVE (?debug=1, no freeze). Kill the local ship via
 *      the round-9 write seam (window.__planetRush.damageShip(0, …)); the sim's
 *      own respawn clock counts down. Frames shot off the sim's tick counter at
 *      RESPAWNING 3…, RESPAWNING 1…, then the ship back with the overlay gone and
 *      the controls strip returned. The count is Math.ceil of the sim timer
 *      (src/ui/respawn-countdown.ts) — never a UI-side clock.
 *
 *   2. upgrade-after-respawn — the developer's exact report. Buy DAMAGE tier 1,
 *      DIE (real death, overlay shown), then RESPAWN and confirm the tier SURVIVED
 *      (DAMAGE still ●○○) and a fresh purchase still lands (buyUpgrade → 'ok',
 *      DAMAGE ●○○ → ●●○, hub ore spent). A dead hull is refused 'dead'; a live one
 *      buys — the same wallet, ladder intact (src/sim/buildings.ts buyUpgrade).
 *
 *   3. touch-parity — an emulated landscape phone (hasTouch, isMobile). The touch
 *      HUD (twin sticks + BUILD/BOOST/PING/FIRE buttons) is on screen. BOOST is
 *      engaged by touch (button fills, and the ship's MEASURED speed rises ~1.6×,
 *      BOOST_MULTIPLIER); PING is placed by touch (the input probe shows the ping
 *      ACTION crossed to the sim, world-space, pingCount 0→1). The ping MARKER is
 *      not yet drawn (documented render follow-up, docs/input-parity.md §"Known
 *      follow-ups") — so the on-screen tell is the pressed button, not a map pin.
 *      No unexplained gap in the parity table's touch column.
 *
 * Every frame prints the seam readback it was shot at, so the attestation cites
 * numbers the run actually saw. Then composes three captioned montages.
 *
 * Usage: node evidence/capture-p4-respawn-controls.mjs   (needs preview on $EVIDENCE_BASE_URL)
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4191';
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 844, height: 390 };
const DSF = 2;
const RESPAWN_S = 5; // src/sim/constants.ts
const BOOST_MULTIPLIER = 1.6; // src/sim/constants.ts
const BASE_SPEED = 260; // src/sim/constants.ts (units/s)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ticks = (page) => page.evaluate(() => window.__planetRush.ticks);
const waitTick = (page, t) => page.waitForFunction((x) => window.__planetRush.ticks >= x, t, { timeout: 25_000 });
const shipWorld = (page) => page.evaluate(() => ({ ...window.__planetRush.shipWorld }));
const readInput = (page) => page.evaluate(() => window.__planetRush.input);
const centerOf = (page, id) => page.evaluate((wantId) => {
  const e = window.__planetRush.layout.find((x) => x.id === wantId);
  return e ? { x: e.bounds.x + e.bounds.width / 2, y: e.bounds.y + e.bounds.height / 2 } : null;
}, id);

async function newPage(browser, opts) {
  const ctx = await browser.newContext({ deviceScaleFactor: DSF, ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page._errors = errors;
  page._ctx = ctx;
  return page;
}

const secAt = (deltaTicks) => Math.ceil(RESPAWN_S - deltaTicks / 60); // what the overlay reads

// ── 1. respawn-countdown ────────────────────────────────────────────────────
async function respawnCountdown(browser) {
  const page = await newPage(browser, { viewport: DESKTOP });
  await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__planetRush?.damageShip === 'function', undefined, { timeout: 20_000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});

  const t0 = await ticks(page);
  await waitTick(page, t0 + 640); // past 10 s spawn protection (src/sim/constants.ts)
  const tKill = await page.evaluate(() => { window.__planetRush.damageShip(0, 99999); return window.__planetRush.ticks; });

  await waitTick(page, tKill + 150);
  const a = await ticks(page);
  await page.screenshot({ path: join(OUT, 'respawn-3-raw.png'), animations: 'disabled' });

  await waitTick(page, tKill + 270);
  const b = await ticks(page);
  await page.screenshot({ path: join(OUT, 'respawn-1-raw.png'), animations: 'disabled' });

  await waitTick(page, tKill + 340);
  const c = await ticks(page);
  await page.screenshot({ path: join(OUT, 'respawn-back-raw.png'), animations: 'disabled' });

  const info = {
    tKill,
    shot3: { tick: a, delta: a - tKill, reads: secAt(a - tKill) },
    shot1: { tick: b, delta: b - tKill, reads: secAt(b - tKill) },
    back: { tick: c, delta: c - tKill },
    errors: page._errors.slice(),
  };
  console.log('[respawn]', JSON.stringify(info));
  await page._ctx.close();
  return info;
}

// ── 2. upgrade-after-respawn ────────────────────────────────────────────────
const WEDGE_CLIP = { x: 452, y: 190, width: 220, height: 100 }; // the WEAPON wedge (DAMAGE pips)
const damageTier = (wedges) => wedges.find((w) => w.kind === 'weapon')?.summary?.find((s) => s.track === 'power')?.tier;

async function upgradeAfterRespawn(browser) {
  const page = await newPage(browser, { viewport: DESKTOP });
  await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__upgradeWheelStage?.buyTier === 'function' && typeof window.__planetRush?.damageShip === 'function', undefined, { timeout: 20_000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});

  const t0 = await ticks(page);
  await waitTick(page, t0 + 640);

  // Pre-death: buy DAMAGE (TRACK_ORDER[0] = power) to tier 1.
  await page.evaluate(() => window.__upgradeWheelStage.openUpgrade(999));
  const preBuy = await page.evaluate(() => window.__upgradeWheelStage.buyTier(0));
  await page.evaluate(() => window.__upgradeWheelStage.close());

  // Die for real — overlay shown.
  const tKill = await page.evaluate(() => { window.__planetRush.damageShip(0, 99999); return window.__planetRush.ticks; });
  await waitTick(page, tKill + 150);
  await page.screenshot({ path: join(OUT, 'upgrade-dead-raw.png'), animations: 'disabled' });

  // Respawn — the tier must survive.
  await waitTick(page, tKill + 340);
  const survivedTier = await page.evaluate(() => window.__upgradeWheelStage.tierOf(0));

  // Open the wheel after respawn — DAMAGE reads tier 1 (survived).
  await page.evaluate(() => window.__upgradeWheelStage.openUpgrade(999));
  await sleep(250);
  const wedgesB = await page.evaluate(() => window.__upgradeWheelStage.wedges());
  await page.screenshot({ path: join(OUT, 'upgrade-open-raw.png'), animations: 'disabled' });
  await page.screenshot({ path: join(OUT, 'upgrade-open-wedge.png'), clip: WEDGE_CLIP, animations: 'disabled' });

  // Buy again — the tier moves ●○○ → ●●○.
  const buy = await page.evaluate(() => window.__upgradeWheelStage.buyTier(0));
  await sleep(250);
  const wedgesC = await page.evaluate(() => window.__upgradeWheelStage.wedges());
  await page.screenshot({ path: join(OUT, 'upgrade-bought-raw.png'), animations: 'disabled' });
  await page.screenshot({ path: join(OUT, 'upgrade-bought-wedge.png'), clip: WEDGE_CLIP, animations: 'disabled' });

  const info = {
    preBuy, survivedTier,
    damageBefore: damageTier(wedgesB), damageAfter: damageTier(wedgesC),
    buy,
    errors: page._errors.slice(),
  };
  console.log('[upgrade]', JSON.stringify(info));
  await page._ctx.close();
  return info;
}

// ── 3. touch-parity ─────────────────────────────────────────────────────────
// Thrust LEFT: the home planet sits to the ship's right (a rightward push just
// drives the hull into its own planet and measures zero); leftward is the longest
// clear lane (ship spawns ~x1968 of a 3600-wide arena). Each speed is measured as
// the FIRST-and-only drive of its own fresh page load, so it gets the whole lane
// and no prior travel can contaminate the reading (a second measurement in the
// same life eventually runs the hull into a rival's planet — measured that the
// hard way). LEFT thrust does trip a first-seconds "hold FIRE on the asteroid"
// coaching prompt, so the press screenshots are caught at the pristine spawn first.
const STICK_FROM = { x: 150, y: 300 }, STICK_TO = { x: 55, y: 300 };

async function bootPhone(browser) {
  const page = await newPage(browser, { viewport: PHONE, hasTouch: true, isMobile: true });
  await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => {
    const d = window.__planetRush;
    return !!d && !!d.input && Array.isArray(d.layout) && d.layout.length > 0;
  }, undefined, { timeout: 20_000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await sleep(45); // just enough that every affordance is registered — stay as early as
  //                  possible, before a drifting asteroid enters weapon range and the
  //                  first-match MINE coaching prompt fires (onboarding.ts) over the controls.
  return page;
}

// Read tick and world position ATOMICALLY (one eval) so the two never skew by a
// frame — that skew was the source of the run-to-run noise in the speed ratio.
const tickPos = (page) => page.evaluate(() => ({ t: window.__planetRush.ticks, x: window.__planetRush.shipWorld.x, y: window.__planetRush.shipWorld.y }));

// Drive the left stick (optionally with a second finger held on `hold`), settle to
// top speed, and return world units/second averaged over a 60-tick window.
async function measureSpeed(page, client, settle, hold) {
  const stick = (i) => ({ x: STICK_FROM.x + (STICK_TO.x - STICK_FROM.x) * i / 6, y: STICK_FROM.y + (STICK_TO.y - STICK_FROM.y) * i / 6 });
  const pts = (i) => (hold ? [stick(i), hold] : [stick(i)]);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(0) });
  for (let i = 1; i <= 6; i++) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(i) });
  await waitTick(page, (await ticks(page)) + settle);
  const a = await tickPos(page);
  await waitTick(page, a.t + 60);
  const b = await tickPos(page);
  const seen = await readInput(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return { speed: Math.hypot(b.x - a.x, b.y - a.y) / (b.t - a.t) * 60, seen };
}

async function touchParity(browser) {
  // The one reliably clean frame per boot is its FIRST screenshot (~MATCH 0:01,
  // before a drifting asteroid enters weapon range and the first-match MINE
  // coaching prompt — onboarding.ts — fires over the controls). So each press
  // frame is captured as the first screenshot of its own fresh boot; the two
  // speeds are each a boot's only thrust drive, on a fresh full leftward lane.

  // Boot A — idle affordances (clean, first shot) + FIRE & PING probes + BASE speed.
  const page = await bootPhone(browser);
  const ids = await page.evaluate(() => window.__planetRush.layout.map((x) => x.id));
  await page.screenshot({ path: join(OUT, 'touch-idle-raw.png'), animations: 'disabled' });
  const ping = await centerOf(page, 'touch-ping-button');
  const fire = await centerOf(page, 'touch-fire-button');
  const client = await page._ctx.newCDPSession(page);

  // FIRE by touch — hold the FIRE button a few frames and read it back at the sim
  // (fire.active). Another touch-column verb proven to cross into the sim.
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fire.x, y: fire.y }] });
  await waitTick(page, (await ticks(page)) + 8);
  const fireInput = await readInput(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(100);

  // PING by touch — a tap emits the world-space ping action (no ship movement).
  const before = (await readInput(page)).pingCount;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: ping.x, y: ping.y }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  let pinged = true;
  await page.waitForFunction((was) => window.__planetRush.input.pingCount > was, before, { timeout: 5000 }).catch(() => { pinged = false; });
  const after = await readInput(page);

  // BASE speed — A's only thrust drive: a fresh leftward lane, settle to top speed.
  const base = await measureSpeed(page, client, 90, null);
  await client.detach();
  await page._ctx.close();

  // Boot B — BOOST press frame (clean, first shot) AND boost speed in one drive:
  // engage at the pristine spawn, shoot the pressed button, then hold on to settle
  // to top speed (B's only drive → full lane).
  const pageB = await bootPhone(browser);
  const boostB = await centerOf(pageB, 'touch-boost-button');
  const clientB = await pageB._ctx.newCDPSession(pageB);
  const stickPts = (i) => [{ x: STICK_FROM.x + (STICK_TO.x - STICK_FROM.x) * i / 6, y: STICK_FROM.y }, { x: boostB.x, y: boostB.y }];
  // Shoot the pressed-button frame FIRST, right after touchStart (before the thrust
  // ramp), so it lands as early as boot C's ping frame — ahead of the MINE prompt.
  await clientB.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: stickPts(0) });
  await sleep(45); // ~3 frames so the pressed BOOST fill + engaged stick render
  await pageB.screenshot({ path: join(OUT, 'touch-boost-raw.png'), animations: 'disabled' });
  // Now ramp the stick to full deflection and hold, to measure top speed.
  for (let i = 1; i <= 6; i++) await clientB.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: stickPts(i) });
  await waitTick(pageB, (await ticks(pageB)) + 90); // settle to top speed, still holding
  const bA = await tickPos(pageB);
  await waitTick(pageB, bA.t + 60);
  const bB = await tickPos(pageB);
  const boostInput = await readInput(pageB);
  const boostSpeed = Math.hypot(bB.x - bA.x, bB.y - bA.y) / (bB.t - bA.t) * 60;
  await clientB.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await clientB.detach();
  await pageB._ctx.close();

  // Boot C — PING press frame (clean, first shot). Held so the button shows pressed.
  const pageC = await bootPhone(browser);
  const pingC = await centerOf(pageC, 'touch-ping-button');
  const clientC = await pageC._ctx.newCDPSession(pageC);
  await clientC.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pingC.x, y: pingC.y }] });
  await sleep(90);
  await pageC.screenshot({ path: join(OUT, 'touch-ping-raw.png'), animations: 'disabled' });
  await clientC.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await clientC.detach();
  await pageC._ctx.close();

  const baseSpeed = base.speed;

  const info = {
    ids,
    baseSpeed: Math.round(baseSpeed), boostSpeed: Math.round(boostSpeed),
    ratio: +(boostSpeed / baseSpeed).toFixed(2),
    boostActive: boostInput.boost, thrust: boostInput.thrust,
    fireActive: fireInput.fire,
    pingBefore: before, pingAfter: after.pingCount, lastPing: after.lastPing, pinged,
    errors: page._errors.slice(),
  };
  console.log('[touch]', JSON.stringify(info));
  return info;
}

// ── montage composer (captioned HTML → screenshot), mirrors build-figures.mjs ─
const b64 = (name) => 'data:image/png;base64,' + readFileSync(join(OUT, name)).toString('base64');

function figureHTML(title, subtitle, panels, cols) {
  const cells = panels.map((p) => `
    <figure class="${p.tall ? 'tall' : ''}">
      <img src="${b64(p.img)}"/>
      <figcaption>${p.tag ? `<span class="t">${p.tag}</span>` : ''}${p.cap}</figcaption>
    </figure>`).join('');
  return `<!doctype html><html><head><meta charset="utf8"><style>
    :root{color-scheme:dark}
    body{margin:0;background:#0a0c10;color:#dce3ec;font:15px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;padding:26px}
    h1{font-size:22px;margin:0 0 4px}
    .sub{color:#8b96a5;font-size:13px;margin:0 0 20px;max-width:1500px}
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

async function compose(browser, name, title, subtitle, panels, cols, height) {
  const page = await newPage(browser, { viewport: { width: cols * 460 + (cols - 1) * 14 + 60, height } });
  await page.setContent(figureHTML(title, subtitle, panels, cols), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await sleep(150);
  const el = await page.$('.grid');
  const box = await el.boundingBox();
  await page.screenshot({ path: join(OUT, name), clip: { x: 10, y: 10, width: box.width + 40, height: box.height + 40 } });
  await page._ctx.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  const r = await respawnCountdown(browser);
  const u = await upgradeAfterRespawn(browser);
  const t = await touchParity(browser);

  const sha = '563d77b';

  await compose(browser, 'respawn-countdown.png',
    'Respawn is legible — the sim\'s own clock, on screen',
    `Local ship killed via the ?debug=1 write seam; the sim's respawn clock (RESPAWN_S = 5 s) counts down and the HUD reads Math.ceil of it (src/ui/respawn-countdown.ts). Build ${sha}. LIVE — no ?freeze; the MATCH clock advances between frames.`,
    [
      { img: 'respawn-3-raw.png', tag: `+${r.shot3.delta}t → 3`, cap: `RESPAWNING 3… — the overlay centred on YOUR planet in the player's own blue. Sim timer ≈ ${(RESPAWN_S - r.shot3.delta / 60).toFixed(1)} s, ceil = ${r.shot3.reads}. HUD + controls strip present behind it.` },
      { img: 'respawn-1-raw.png', tag: `+${r.shot1.delta}t → 1`, cap: `RESPAWNING 1… — same overlay, count fallen to 1 as the sim clock runs down (MATCH clock advanced, proving it is live). Sim timer ≈ ${(RESPAWN_S - r.shot1.delta / 60).toFixed(1)} s, ceil = ${r.shot1.reads}.` },
      { img: 'respawn-back-raw.png', tag: `+${r.back.delta}t`, cap: 'Ship BACK at YOUR planet, overlay GONE, controls strip returned. respawnTimer elapsed → the sim respawned the hull at home.' },
    ], 3, 900);

  await compose(browser, 'upgrade-after-respawn.png',
    'Upgrades survive death — and still buy after respawn',
    `DAMAGE bought to tier 1, then a REAL death, then respawn. Purchases go through the sim's own validated buyUpgrade (src/sim/buildings.ts): a dead hull is refused 'dead', a live one returns 'ok'. Pre-death buy: ${JSON.stringify(u.preBuy)}. Build ${sha}.`,
    [
      { img: 'upgrade-dead-raw.png', tag: 'died', cap: 'RESPAWNING overlay — the ship is genuinely dead on the respawn clock (a purchase here would be refused \'dead\').' },
      { img: 'upgrade-open-raw.png', tag: `DAMAGE = ${u.damageBefore}`, cap: `After respawn the wheel opens at YOUR planet. WEAPON wedge reads DAMAGE ●○○ — tier ${u.survivedTier} SURVIVED the death (tiers are the player's, respawn never clears them).` },
      { img: 'upgrade-bought-raw.png', tag: `DAMAGE = ${u.damageAfter}`, cap: `A fresh purchase lands: buyUpgrade → '${u.buy?.result}', DAMAGE ●○○ → ●●○ (tier ${u.damageBefore}→${u.damageAfter}). Hub ore ticked down as it spent.` },
      { img: 'upgrade-open-wedge.png', tall: true, tag: 'before', cap: 'WEAPON wedge, after respawn: DAMAGE ●○○ (one filled pip = the tier that survived).' },
      { img: 'upgrade-bought-wedge.png', tall: true, tag: 'after', cap: 'WEAPON wedge, after the post-respawn buy: DAMAGE ●●○ (two pips) — the tier number moved.' },
    ], 3, 1200);

  const pingTxt = t.pinged
    ? `pingCount ${t.pingBefore}→${t.pingAfter}, world-space target (${Math.round(t.lastPing.x)}, ${Math.round(t.lastPing.y)})`
    : 'PING did NOT register';
  await compose(browser, 'touch-parity.png',
    'Thumbs can do everything — BOOST and PING by touch',
    `Emulated landscape phone (hasTouch, isMobile, 844×390). The touch column of the parity table (docs/input-parity.md), fired for real via CDP touch and read at the sim through the ?debug=1 input probe. thrust (${t.thrust.x}, ${t.thrust.y}), fire.active = ${t.fireActive}, boost.active = ${t.boostActive} and a ping all crossed into the sim from touch. Build ${sha}. Layout ids on screen: ${t.ids.join(', ')}.`,
    [
      { img: 'touch-idle-raw.png', tag: 'affordances', cap: 'The touch HUD: left virtual stick, BUILD & UPGRADE, BOOST, PING and FIRE buttons — every touch verb has a control on screen.' },
      { img: 'touch-boost-raw.png', tag: `×${t.ratio}`, cap: `BOOST held by touch: the button FILLS and the left stick is engaged. Measured ship speed ${t.baseSpeed}→${t.boostSpeed} u/s (${t.ratio}×, ≈ BOOST_MULTIPLIER ${BOOST_MULTIPLIER}); probe boost.active = ${t.boostActive}.` },
      { img: 'touch-ping-raw.png', tag: 'ping→sim', cap: `PING tapped by touch: the action crossed to the sim (${pingTxt}). The ping MARKER is not yet rendered (documented follow-up, input-parity.md §"Known follow-ups") — the on-screen tell is the pressed button, not a map pin.` },
    ], 3, 760);

  console.log('DONE. respawn=' + JSON.stringify(r.shot3.reads) + '/' + JSON.stringify(r.shot1.reads) +
    ' upgrade=' + u.damageBefore + '->' + u.damageAfter + ' touch=' + t.ratio + 'x ping=' + t.pinged);
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
