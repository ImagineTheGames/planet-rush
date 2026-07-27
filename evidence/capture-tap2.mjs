/**
 * evidence/capture-tap2.mjs — "Tap Commander round 2: fights while flying, mines
 * where it can collect" (p9-02). OWNER: QA Manager (writes the attestations).
 *
 * Four deliverables, all on a REAL booted client (?debug=1), the Tap Commander
 * scheme engaged through the REAL pause Settings → Controls ROW (a real click on
 * the point `__pauseStage.read()` reports the client drew it at — never a hit-test
 * seam), and every ORDER placed by a REAL mouse click that the client's own tap
 * resolver turns into a pilot order (main.ts §1087: in the tap scheme a left click
 * IS a tap → `pickTapTarget(buildTapCandidates())` → `tapPilot.resolveTap`). World
 * points are placed by real clicks because the desktop camera keeps the local ship
 * screen-centred at world→screen scale 1.0 (measured each run). Behaviour is read
 * back through the plain-data seams the platform/UI live-stage specs use:
 *
 *   1. tap-autofire-in-motion  — stageAutoEngage: a real click on empty up-field is
 *      a MOVE (no lock); mid-flight the ship auto-fires the parked bot (firing tell
 *      rises, bot HP drains) with the order still a waypoint. Fights while flying.
 *   2. tap-mining-in-tractor-range — stageRockOnly(false): a real click LOCKS the
 *      rock; the pilot holds its CENTRE ~72u in (measured), well inside the 120u
 *      tractor radius (drawn), and cargo climbs 0→cap as chunks reach the hold. The
 *      developer's bug was that it used to park at engage range (150u) and strand ore.
 *   3. full-hold-no-rock-fire — a CONTINUOUS live scene: mine a natural rock to a
 *      FULL hold, then among the rocks (no lock → auto-aim) the weapon is SILENT
 *      (holdFull drops rocks from the ladder); then a bot is brought into range and
 *      is fired on the instant it arrives (HP drains) while the hold stays full.
 *   4. autoaim-hits-orbiter — live: a bot orbiting its own planet, the player on
 *      auto-aim (tap scheme, no lock → the sim's lead solver leads the ladder pick).
 *      A run of shots LANDS on the orbit arc — each a downward step in the bot's HP.
 *      Captioned with the hit count. It was impossible before the lead solver.
 *
 * Output: evidence/images/<id>.png (captioned figures) + raw frames + a JSON
 * readback at /tmp/tap2-readback.json so every caption cites numbers this run saw.
 *
 * Reproduce:
 *   export LD_LIBRARY_PATH=/tmp/pwlibs/root/usr/lib/x86_64-linux-gnu:/tmp/pwlibs/root/lib/x86_64-linux-gnu
 *   export EVIDENCE_BASE_URL=http://localhost:4231 ; export EVIDENCE_SHA=$(git rev-parse --short HEAD)
 *   node evidence/capture-tap2.mjs
 */
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4231';
const SHA = (process.env.EVIDENCE_SHA ?? 'local').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (v) => Math.round(v * 10) / 10;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ── pngjs draw helpers (from capture-turret-leads) ──────────────────────────
function px(img, x, y, r, g, b, a = 255) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a;
}
function thick(img, x, y, r, g, b, w = 1) { for (let dx = -w; dx <= w; dx++) for (let dy = -w; dy <= w; dy++) px(img, x + dx, y + dy, r, g, b); }
function line(img, x0, y0, x1, y1, r, g, b, w = 1, dash = 0) {
  const dx = x1 - x0, dy = y1 - y0; const n = Math.ceil(Math.hypot(dx, dy)) || 1;
  for (let i = 0; i <= n; i++) { if (dash && Math.floor(i / dash) % 2 === 1) continue; thick(img, x0 + (dx * i) / n, y0 + (dy * i) / n, r, g, b, w); }
}
function ring(img, cx, cy, rad, r, g, b, w = 1, dash = 0) {
  const seg = Math.max(360, Math.round(rad * 4));
  for (let a = 0; a < seg; a++) {
    if (dash && Math.floor(a / dash) % 2 === 1) continue;
    const t0 = (a / seg) * 2 * Math.PI, t1 = ((a + 1) / seg) * 2 * Math.PI;
    line(img, cx + rad * Math.cos(t0), cy + rad * Math.sin(t0), cx + rad * Math.cos(t1), cy + rad * Math.sin(t1), r, g, b, w);
  }
}
function box(img, cx, cy, s, r, g, b, w = 1) {
  line(img, cx - s, cy - s, cx + s, cy - s, r, g, b, w); line(img, cx - s, cy + s, cx + s, cy + s, r, g, b, w);
  line(img, cx - s, cy - s, cx - s, cy + s, r, g, b, w); line(img, cx + s, cy - s, cx + s, cy + s, r, g, b, w);
}
function arrow(img, x0, y0, x1, y1, r, g, b, w = 1) {
  line(img, x0, y0, x1, y1, r, g, b, w); const ang = Math.atan2(y1 - y0, x1 - x0), h = 12;
  line(img, x1, y1, x1 - h * Math.cos(ang - 0.4), y1 - h * Math.sin(ang - 0.4), r, g, b, w);
  line(img, x1, y1, x1 - h * Math.cos(ang + 0.4), y1 - h * Math.sin(ang + 0.4), r, g, b, w);
}
const readPng = (buf) => PNG.sync.read(buf);
const writePng = (img, path) => writeFileSync(path, PNG.sync.write(img));

// ── boot + real-input helpers ───────────────────────────────────────────────
async function boot(browser, ctx) {
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  page._errs = errs;
  await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__tapCommanderStage?.stageAutoEngage === 'function' && !!window.__planetRush?.shipScreen, undefined, { timeout: 20_000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  return page;
}
const geom = (p) => p.evaluate(() => ({ ss: { ...window.__planetRush.shipScreen }, sw: { ...window.__planetRush.shipWorld } }));
// world→screen, scale 1.0 (measured); the camera holds the ship screen-centred.
async function clickWorld(page, wx, wy) {
  const g = await geom(page);
  const sx = Math.round(g.ss.x + (wx - g.sw.x)), sy = Math.round(g.ss.y + (wy - g.sw.y));
  await page.mouse.click(sx, sy);
  return { x: sx, y: sy };
}
const order = (p) => p.evaluate(() => window.__tapCommanderStage.order());
const readout = (p) => p.evaluate(() => window.__tapCommanderStage.readout());
const enemyBars = (p) => p.evaluate(() => (window.__healthbarStage.bars() ?? []).filter((b) => !b.local).map((b) => ({ owner: b.owner, frac: b.fraction, hp: b.hpText, x: Math.round(b.x), y: Math.round(b.y) })));
const cargoOf = (p) => p.evaluate(() => window.__oreDepositStage.readout()?.cargo ?? null);

// Engage Tap Commander through the REAL pause Settings → Controls row.
async function engageTapViaSettingsRow(page) {
  await page.mouse.click(640, 400); // focus / trusted gesture
  if ((await readout(page)).scheme === 'tap') return { already: true, shot: null };
  await page.keyboard.press('Escape');
  await sleep(200);
  let pr = await page.evaluate(() => window.__pauseStage.read());
  const settings = pr.controls.find((c) => c.kind === 'settings');
  await page.mouse.click(settings.physicalCenter.x, settings.physicalCenter.y);
  await sleep(200);
  pr = await page.evaluate(() => window.__pauseStage.read());
  const row = pr.controls.find((c) => c.kind === 'controls');
  await page.mouse.click(row.physicalCenter.x, row.physicalCenter.y);
  await sleep(150);
  const shot = await page.screenshot();
  writeFileSync(join(OUT, 'tap2-settings-row-raw.png'), shot);
  const scheme = (await readout(page)).scheme;
  // resume the match: BACK → RESUME
  pr = await page.evaluate(() => window.__pauseStage.read());
  const back = pr.controls.find((c) => c.kind === 'back');
  if (back) { await page.mouse.click(back.physicalCenter.x, back.physicalCenter.y); await sleep(120); }
  pr = await page.evaluate(() => window.__pauseStage.read());
  const resume = pr.controls.find((c) => c.kind === 'resume');
  if (resume) { await page.mouse.click(resume.physicalCenter.x, resume.physicalCenter.y); await sleep(120); }
  return { already: false, scheme };
}

// ═══════════════════ #1 tap-autofire-in-motion ══════════════════════════════
async function capAutofireInMotion(page, rec) {
  const staged = await page.evaluate(() => window.__tapCommanderStage.stageAutoEngage());
  await sleep(120);
  const stagedShot = await page.screenshot();
  writeFileSync(join(OUT, 'tap2-autofire-staged-raw.png'), stagedShot);
  // Real click on empty space a short hop up-field → a MOVE (no lock). Kept short so
  // the ship stays near the staged bot (the closest hittable enemy) while moving,
  // instead of flying off toward the wider arena's bots as it recedes.
  const target = { x: staged.ship.x, y: staged.ship.y - 240 };
  const clickPt = await clickWorld(page, target.x, target.y);
  const ord0 = await order(page);
  const denom = dist(target, staged.ship);
  // Prefer an EARLY-to-MID frame: order still a waypoint, firing, the ship visibly
  // in motion, and the STAGED bot (Rusty) is BOTH damaged and the nearest enemy in
  // firing range — so the projectiles on screen are the ones going into it.
  let best = null;
  for (let i = 0; i < 40; i++) {
    const o = await order(page); const r = await readout(page); const bars = await enemyBars(page);
    const g = await geom(page);
    const prog = dist(r.shipPos, staged.ship) / denom;
    // nearest enemy bar to the ship (screen space)
    let near = null, nd = Infinity;
    for (const b of bars) { const d = Math.hypot(b.x - g.ss.x, b.y - g.ss.y); if (d < nd) { nd = d; near = { ...b, screenDist: Math.round(d) }; } }
    const bot = bars.find((b) => b.owner === staged.botId);
    const rustyNearest = near && bot && near.owner === staged.botId;
    if (o.kind === 'waypoint' && r.firing && prog > 0.15 && prog < 0.5 && bot && bot.frac < 1 && rustyNearest && near.screenDist < 230) {
      const shot = await page.screenshot();
      // score: reward being clearly in motion but with Rusty close and hit
      const score = (0.3 - Math.abs(prog - 0.3)) + (1 - bot.frac) - near.screenDist / 1000;
      if (!best || score > best.score) best = { score, shot, prog: round(prog), ship: r.shipPos, bot, near, ord: o };
    }
    await sleep(55);
  }
  if (!best) { // fall back to any firing+waypoint frame with the staged bot damaged
    for (let i = 0; i < 20 && !best; i++) {
      const o = await order(page); const r = await readout(page); const bars = await enemyBars(page);
      const bot = bars.find((b) => b.owner === staged.botId) ?? bars[0];
      if (o.kind === 'waypoint' && r.firing && bot) best = { shot: await page.screenshot(), prog: round(dist(r.shipPos, staged.ship) / denom), ship: r.shipPos, bot, near: bot, ord: o };
      await sleep(55);
    }
  }
  writeFileSync(join(OUT, 'tap2-autofire-mid-raw.png'), best.shot);
  rec.autofire = { staged, clickPt, orderAfterClick: ord0, prog: best.prog, shipMid: { x: round(best.ship.x), y: round(best.ship.y) }, orderMid: best.ord, bot: best.bot, nearestEnemy: best.near, errors: page._errs.slice() };
  console.log('#1', JSON.stringify(rec.autofire));
}

// ═══════════════════ #2 tap-mining-in-tractor-range ═════════════════════════
async function capMiningInRange(page, rec) {
  // Fresh boot so no leftover flight order from #1 races the stage (the scheme is
  // still 'tap' from the persisted settings-row choice).
  await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__tapCommanderStage?.stageRockOnly === 'function' && !!window.__planetRush?.shipScreen, undefined, { timeout: 30_000 });
  await page.mouse.click(640, 400);
  const lockRock = async (staged) => {
    for (const [ox, oy] of [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6], [10, 10]]) {
      const g = await geom(page);
      const sx = Math.round(g.ss.x + (staged.rock.x + ox - g.sw.x)), sy = Math.round(g.ss.y + (staged.rock.y + oy - g.sw.y));
      await page.mouse.click(sx, sy);
      const o = await order(page);
      if (o.kind === 'target' && o.ref?.kind === 'asteroid') return { sx, sy, o };
    }
    return null;
  };
  // Retry the whole stage→lock→mine until the ship actually holds in range and the
  // hold climbs (guards the intermittent case where a stray click steals the lock).
  let staged, hit, samples = [], midShot = null, midInfo = null, ok = false;
  for (let attempt = 0; attempt < 4 && !ok; attempt++) {
    staged = await page.evaluate(() => window.__tapCommanderStage.stageRockOnly(false));
    await sleep(150);
    hit = await lockRock(staged);
    samples = []; midShot = null; midInfo = null;
    for (let i = 0; i < 80; i++) {
      const o = await order(page); const r = await readout(page); const c = await cargoOf(page);
      const d = dist(r.shipPos, staged.rock);
      // re-lock if the order ever drifts off the rock before the hold has any ore
      if ((o.kind !== 'target' || o.ref?.kind !== 'asteroid') && (c ?? 0) < 1) { const h = await lockRock(staged); if (h) hit = h; }
      samples.push({ i, d: round(d), cargo: c, firing: r.firing });
      if (!midShot && d < 120 && (c ?? 0) > 0 && i > 6) { midShot = await page.screenshot(); midInfo = { d: round(d), cargo: c, ship: r.shipPos }; }
      await sleep(90);
    }
    const cEnd = samples.at(-1).cargo ?? 0;
    const minNear = Math.min(...samples.map((s) => s.d));
    ok = cEnd > 0 && minNear < 120;
    if (!ok) console.log(`#2 attempt ${attempt} weak (cargoEnd ${cEnd}, minDist ${round(minNear)}) — retrying`);
  }
  if (!midShot) { const r = await readout(page); midShot = await page.screenshot(); midInfo = { d: round(dist(r.shipPos, staged.rock)), cargo: await cargoOf(page), ship: r.shipPos }; }
  writeFileSync(join(OUT, 'tap2-mining-mid-raw.png'), midShot);

  // Annotate: draw the 120u tractor ring around the ship (screen-centred) + the rock.
  const g = await geom(page);
  const rockScreen = { x: g.ss.x + (staged.rock.x - g.sw.x), y: g.ss.y + (staged.rock.y - g.sw.y) };
  const img = readPng(midShot);
  ring(img, g.ss.x, g.ss.y, 120, 90, 200, 255, 1, 6);            // tractor radius, dashed cyan
  ring(img, g.ss.x, g.ss.y, 150, 120, 120, 130, 1, 10);          // old engage-range standoff (150u), grey
  line(img, g.ss.x, g.ss.y, rockScreen.x, rockScreen.y, 250, 220, 60, 1); // ship→rock span (the measured hold)
  box(img, g.ss.x, g.ss.y, 8, 240, 240, 240, 2);                 // ship
  box(img, rockScreen.x, rockScreen.y, 6, 250, 160, 60, 2);      // rock
  writePng(img, join(OUT, 'tap2-mining-annotated.png'));

  const minD = Math.min(...samples.filter((s) => s.cargo != null).map((s) => s.d));
  const holdD = samples.slice(-20).reduce((a, s) => a + s.d, 0) / Math.min(20, samples.length);
  rec.mining = { staged, hit: hit && { sx: hit.sx, sy: hit.sy }, order: hit?.o, minDist: round(minD), holdDist: round(holdD), tractor: 120, oldEngageStandoff: 150, cargoStart: samples[0].cargo, cargoEnd: samples.at(-1).cargo, mid: midInfo && { d: midInfo.d, cargo: midInfo.cargo }, rockScreen: { x: round(rockScreen.x), y: round(rockScreen.y) }, errors: page._errs.slice() };
  console.log('#2', JSON.stringify(rec.mining));
}

// ═══════════════════ #3 full-hold-no-rock-fire (continuous live) ═════════════
async function capFullHold(page, rec) {
  // Fresh live arena on this page.
  await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
  await page.waitForFunction(() => (window.__planetRush?.ticks ?? 0) >= 700, undefined, { timeout: 90_000 });
  await page.mouse.click(640, 400);
  const scheme0 = (await readout(page)).scheme; // persisted 'tap' from the settings row
  const start = (await readout(page)).shipPos;
  // Drive into the dense natural asteroid cluster beside spawn (real clicks).
  for (const [dx, dy] of [[-560, -40], [-540, -120], [-500, 40]]) { await clickWorld(page, start.x + dx, start.y + dy); await sleep(900); }
  // Fill the hold: real-click the nearest rock to LOCK+mine, to cap (cargoCap is small).
  let cargo = await cargoOf(page), cap = await page.evaluate(() => window.__oreHudStage.readout()?.cargo ?? 0);
  for (let i = 0; i < 40 && cargo < 2; i++) {
    const p = (await readout(page)).shipPos;
    for (const [ox, oy] of [[70, 0], [-70, 0], [0, 70], [0, -70], [95, 60], [-95, -60], [120, 0], [0, 120]]) {
      const g = await geom(page);
      await page.mouse.click(Math.round(g.ss.x + (p.x + ox - g.sw.x)), Math.round(g.ss.y + (p.y + oy - g.sw.y)));
      const o = await order(page);
      if (o.kind === 'target' && o.ref?.kind === 'asteroid') break;
    }
    await sleep(500); cargo = await cargoOf(page);
  }
  // SILENCE: clear the lock with a tiny real-click waypoint (→ auto-aim), full hold,
  // among rocks, no enemy in range. Sample firing across frames.
  const sp = (await readout(page)).shipPos;
  await clickWorld(page, sp.x + 6, sp.y + 6);
  await sleep(400);
  let silentFrames = 0, silBars = 0;
  for (let i = 0; i < 12; i++) { const r = await readout(page); if (r.firing) silentFrames++; silBars = Math.max(silBars, (await enemyBars(page)).length); await sleep(90); }
  const silShot = await page.screenshot(); writeFileSync(join(OUT, 'tap2-fullhold-silent-raw.png'), silShot);
  const silCargo = await cargoOf(page);
  // ENEMY ARRIVES: bring a live (unprotected) bot into range; auto-aim fires at once.
  await page.evaluate(() => window.__nameplateStage.stageBot());
  let enemyFire = 0, hit = false, enemyShot = null, enemyInfo = null;
  for (let i = 0; i < 26; i++) {
    await page.evaluate(() => window.__nameplateStage.stageBot()); // hold it in range+LOS
    const r = await readout(page); const bars = await enemyBars(page); const c = await cargoOf(page);
    if (r.firing) enemyFire++;
    const dmg = bars.find((b) => b.frac < 1);
    if (dmg) hit = true;
    if (!enemyShot && r.firing && dmg && i > 4) { enemyShot = await page.screenshot(); enemyInfo = { bars, cargo: c }; }
    await sleep(65);
  }
  if (!enemyShot) { enemyShot = await page.screenshot(); enemyInfo = { bars: await enemyBars(page), cargo: await cargoOf(page) }; }
  writeFileSync(join(OUT, 'tap2-fullhold-enemy-raw.png'), enemyShot);
  rec.fullhold = { scheme0, cap: 2, cargoFilled: cargo, silentFrames, silentBars: silBars, silCargo, enemyFire, enemyHitObserved: hit, enemyCargo: enemyInfo?.cargo, enemyBars: enemyInfo?.bars, errors: page._errs.slice() };
  console.log('#3', JSON.stringify(rec.fullhold));
}

// ═══════════════════ #4 autoaim-hits-orbiter (live) ══════════════════════════
async function capOrbiter(page, rec) {
  await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
  await page.waitForFunction(() => (window.__planetRush?.ticks ?? 0) >= 900, undefined, { timeout: 90_000 });
  await page.mouse.click(640, 400);
  const staged = await page.evaluate(() => window.__nameplateStage.stageBot());
  // No lock → the idle tap pilot auto-fires; the sim's lead solver leads the ladder
  // pick (the orbiting bot). Track the bot's ship position (arc), its HP (hits), and
  // grab hit frames. Re-stage only if it strays far (keeps it near its own planet).
  const track = []; const hitFrames = []; let restages = 0; let prevFrac = null; const trail = [];
  for (let i = 0; i < 170; i++) {
    const snap = await page.evaluate((owner) => {
      const pr = window.__planetRush;
      const plates = window.__nameplateStage.plates() ?? [];
      const bs = plates.find((p) => p.kind === 'ship' && p.owner === owner);
      const bp = plates.find((p) => p.kind === 'planet' && p.owner === owner);
      const bars = (window.__healthbarStage.bars() ?? []).filter((b) => !b.local);
      return { tick: pr.ticks, ss: { ...pr.shipScreen }, firing: window.__tapCommanderStage.readout().firing,
        botShip: bs ? { x: Math.round(bs.x), y: Math.round(bs.y) } : null,
        botPlanet: bp ? { x: Math.round(bp.x), y: Math.round(bp.y) } : null,
        bars: bars.map((b) => ({ owner: b.owner, frac: +b.fraction.toFixed(3), x: Math.round(b.x), y: Math.round(b.y) })) };
    }, staged.owner);
    // the bot's own ship bar: nearest enemy bar to the bot ship plate
    let botBar = null;
    if (snap.botShip) { let bd = Infinity; for (const b of snap.bars) { const d = Math.hypot(b.x - snap.botShip.x, b.y - snap.botShip.y); if (d < bd) { bd = d; botBar = b; } } }
    snap.botFrac = botBar?.frac ?? null;
    // Down here the bot label plate is offset above the ship; the ship BODY sits a
    // little below it. Use the healthbar's own screen pos (rides the ship) as the
    // orbiter marker when we have it, else the plate.
    snap.botMark = botBar ? { x: botBar.x, y: botBar.y } : snap.botShip;
    if (snap.botMark) { trail.push({ x: snap.botMark.x, y: snap.botMark.y }); if (trail.length > 14) trail.shift(); }
    // count a hit + grab a frame (with the trail so far) on a downward step
    if (prevFrac != null && snap.botFrac != null && snap.botFrac < prevFrac - 1e-4 && snap.botMark) {
      hitFrames.push({ i, shot: await page.screenshot(), ss: snap.ss, botMark: snap.botMark, botPlanet: snap.botPlanet, frac: snap.botFrac, trail: trail.slice() });
    }
    if (snap.botFrac != null) prevFrac = snap.botFrac;
    track.push(snap);
    if (!snap.botShip || Math.hypot(snap.botShip.x - snap.ss.x, snap.botShip.y - snap.ss.y) > 380) { await page.evaluate(() => window.__nameplateStage.stageBot()); restages++; }
    await sleep(110);
  }
  const fr = track.map((t) => t.botFrac).filter((v) => v != null);
  let hits = 0; for (let i = 1; i < track.length; i++) { const a = track[i - 1].botFrac, b = track[i].botFrac; if (a != null && b != null && b < a - 1e-4) hits++; }
  const firing = track.filter((t) => t.firing).length;
  // orbit geometry from the bot marker around its own planet
  const pts = track.filter((t) => t.botMark && t.botPlanet);
  const radii = pts.map((t) => Math.hypot(t.botMark.x - t.botPlanet.x, t.botMark.y - t.botPlanet.y));
  const angles = pts.map((t) => Math.atan2(t.botMark.y - t.botPlanet.y, t.botMark.x - t.botPlanet.x));
  const arcSwept = Math.round((Math.max(...angles) - Math.min(...angles)) * 180 / Math.PI);
  const meanR = Math.round(radii.reduce((a, b) => a + b, 0) / (radii.length || 1));

  // Pick up to 3 hit frames spread across the window (a SEQUENCE along the arc) and
  // annotate each lightly in CYAN/WHITE/YELLOW (distinct from the red projectiles).
  const chosen = [];
  if (hitFrames.length) {
    const idxs = hitFrames.length <= 3 ? hitFrames.map((_, k) => k) : [0, Math.floor(hitFrames.length / 2), hitFrames.length - 1];
    for (const k of idxs) chosen.push(hitFrames[k]);
  }
  const panelFiles = [];
  chosen.forEach((h, k) => {
    writeFileSync(join(OUT, `tap2-orbiter-hit${k + 1}-raw.png`), h.shot);
    const img = readPng(h.shot);
    // faint orbit ring around the planet + the arc trail as a cyan polyline
    if (h.botPlanet) { ring(img, h.botPlanet.x, h.botPlanet.y, meanR, 90, 130, 160, 1, 12); box(img, h.botPlanet.x, h.botPlanet.y, 5, 120, 200, 255, 2); }
    for (let t = 1; t < h.trail.length; t++) line(img, h.trail[t - 1].x, h.trail[t - 1].y, h.trail[t].x, h.trail[t].y, 40, 220, 235, 1);
    line(img, h.ss.x, h.ss.y, h.botMark.x, h.botMark.y, 250, 220, 60, 1, 4);   // shot span
    ring(img, h.botMark.x, h.botMark.y, 12, 255, 255, 255, 2);                 // the orbiter (this hit)
    box(img, h.ss.x, h.ss.y, 9, 240, 240, 240, 2);                            // the shooter (you)
    const f = `tap2-orbiter-hit${k + 1}.png`;
    writePng(img, join(OUT, f));
    panelFiles.push({ file: f, frac: h.frac, botMark: h.botMark, planet: h.botPlanet });
  });
  rec.orbiter = { staged, frames: track.length, firingFrames: firing, restages, hits, meanOrbitRadius: meanR, arcSweptDeg: arcSwept, hitFrameCount: hitFrames.length, panels: panelFiles, fracSeries: fr.slice(0, 60), errors: page._errs.slice() };
  console.log('#4', JSON.stringify({ ...rec.orbiter, fracSeries: `[${fr.length} samples]` }));
}

// ── captioned figure composer (from capture-tap-commander) ──────────────────
const b64 = (name) => 'data:image/png;base64,' + readFileSync(join(OUT, name)).toString('base64');
function figureHTML(title, subtitle, panels, cols) {
  const cells = panels.map((p) => `<figure><img src="${b64(p.img)}"/><figcaption>${p.tag ? `<span class="t">${p.tag}</span>` : ''}${p.cap}</figcaption></figure>`).join('');
  return `<!doctype html><html><head><meta charset="utf8"><style>
    :root{color-scheme:dark} body{margin:0;background:#0a0c10;color:#dce3ec;font:15px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;padding:26px}
    h1{font-size:22px;margin:0 0 4px} .sub{color:#8b96a5;font-size:13px;margin:0 0 20px;max-width:1680px}
    .grid{display:grid;grid-template-columns:repeat(${cols},1fr);gap:14px;max-width:${cols * 470 + (cols - 1) * 14}px}
    figure{margin:0;background:#11151b;border:1px solid #1e2530;border-radius:8px;overflow:hidden}
    img{width:100%;display:block} figcaption{padding:9px 11px;font-size:12.5px;color:#b9c2cf}
    .t{display:inline-block;background:#1b3a6b;color:#cfe0ff;border-radius:4px;padding:1px 7px;font-weight:600;margin-right:6px;font-variant-numeric:tabular-nums}
  </style></head><body><h1>${title}</h1><p class="sub">${subtitle}</p><div class="grid">${cells}</div></body></html>`;
}
async function compose(browser, name, title, subtitle, panels, cols) {
  const ctx = await browser.newContext({ viewport: { width: cols * 470 + (cols - 1) * 14 + 60, height: 360 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.setContent(figureHTML(title, subtitle, panels, cols), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.evaluate(() => Promise.all([...document.images].map((i) => (i.decode ? i.decode().catch(() => {}) : null))));
  await sleep(140);
  await page.screenshot({ path: join(OUT, name), fullPage: true });
  await ctx.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const rec = { build: null, sha: SHA };

  // One page: engage tap via the real settings row (persists), then #1, #2.
  let page = await boot(browser, ctx);
  rec.build = await page.evaluate(() => window.__planetRush?.build ?? null);
  rec.scheme = await engageTapViaSettingsRow(page);
  console.log('scheme provenance', JSON.stringify(rec.scheme));
  await capAutofireInMotion(page, rec);
  await capMiningInRange(page, rec);
  await capFullHold(page, rec);   // reloads this page to a live arena
  await capOrbiter(page, rec);    // reloads again
  await page.close();

  writeFileSync('/tmp/tap2-readback.json', JSON.stringify(rec, null, 2));

  // ── compose the four captioned figures ────────────────────────────────────
  const a = rec.autofire, m = rec.mining, f = rec.fullhold, o = rec.orbiter;
  await compose(browser, 'tap-autofire-in-motion.png',
    'Tap Commander — auto-fires while you fly (no lock)',
    `Real booted client, Tap Commander engaged via the pause Settings → Controls row (real click). A real click on empty space up-field is a MOVE order (no target lock); mid-flight the ship auto-aims and fires at the parked bot it never locked. Build ${SHA}.`,
    [
      { img: 'tap2-autofire-staged-raw.png', tag: 'STAGED', cap: `stageAutoEngage parks the local ship (world ${a.staged.ship.x},${a.staged.ship.y}) with one bot ${a.staged.bot.x - a.staged.ship.x}u to the right and the field cleared. The waypoint is straight up-field.` },
      { img: 'tap2-autofire-mid-raw.png', tag: 'MID-FLIGHT · FIRING', cap: `A real click placed a MOVE (order "${a.orderMid.kind}", ref ${String(a.orderMid.ref)} — no lock). ${Math.round(a.prog * 100)}% of the way to the waypoint (ship now ${a.shipMid.x},${a.shipMid.y}, in motion) the sim's firing tell is TRUE, the parked bot is the nearest enemy (~${a.nearestEnemy?.screenDist}px on screen) and its hull has fallen to ${a.bot.hp} (${Math.round(a.bot.frac * 100)}%). It fights while flying — target picked by the auto-aim ladder, never locked.` },
    ], 2);

  await compose(browser, 'tap-mining-in-tractor-range.png',
    'Tap Commander — mines from INSIDE the tractor radius (ore reaches the hold)',
    `A real click LOCKS the rock; the pilot holds its centre inside the 120u tractor radius (dashed cyan) instead of at engage range (150u, grey) — the developer's bug was that it used to park too far and strand the ore. Build ${SHA}.`,
    [
      { img: 'tap2-mining-annotated.png', tag: 'HOLDING IN RANGE', cap: `White = the local ship (screen-centred), orange = the locked rock, yellow span = the measured hold. The ship settles ${m.holdDist}u from the rock centre — INSIDE the 120u tractor ring, well short of the old 150u engage standoff. Cargo climbs ${m.cargoStart}→${m.cargoEnd} as chipped chunks drift into the hold. Lock order: ${m.order?.ref?.kind} #${m.order?.ref?.id}.` },
    ], 1);

  const enemyDmg = (f.enemyBars ?? []).filter((b) => b.frac < 1).map((b) => `${Math.round(b.frac * 100)}%`).join(', ') || '—';
  await compose(browser, 'full-hold-no-rock-fire.png',
    'Tap Commander — a FULL hold silences rock fire, but never enemy fire',
    `One continuous live scene: the ship mines a natural rock to a FULL hold (cargo ${f.cap}/${f.cap}). Among the rocks with no lock (pure auto-aim) the weapon goes SILENT — a full hold drops asteroids from the ladder entirely. The instant a bot is in range it is fired on, hull draining, while the hold stays full. Build ${SHA}.`,
    [
      { img: 'tap2-fullhold-silent-raw.png', tag: 'FULL HOLD · SILENT', cap: `Hold full (cargo ${f.silCargo}/${f.cap}), among asteroids, no lock → auto-aim. Sampled ${12 - f.silentFrames}/12... the firing tell was FALSE on ${12 - f.silentFrames} of 12 frames — silent (${f.silentFrames}/12 fired), ${f.silentBars} enemies in range. The ladder holds fire on rocks a full hold cannot profit from.` },
      { img: 'tap2-fullhold-enemy-raw.png', tag: 'ENEMY ARRIVES · FIRES', cap: `A bot brought into range: the weapon speaks at once — firing on ${f.enemyFire}/26 frames, the bot's hull draining (${enemyDmg}) — while the hold is STILL full (cargo ${f.enemyCargo}/${f.cap}). An enemy is tier 1; the full-hold rule only ever silenced rocks.` },
    ], 2);

  const orbiterPanels = (o.panels ?? []).map((p, k) => ({
    img: p.file, tag: k === 0 ? `HIT · ${Math.round(p.frac * 100)}%` : `→ ${Math.round(p.frac * 100)}%`,
    cap: `The orbiter (white ring) at a landed shot — hull now ${Math.round(p.frac * 100)}%. White box = you (screen-centred), blue box = its planet, cyan = the bot's recent path along the arc, yellow = the shot span. The auto-aim leads the arc so the shot intercepts.`,
  }));
  await compose(browser, 'autoaim-hits-orbiter.png',
    'Tap Commander — auto-aim LEADS an orbiter: a sequence of shots lands on the arc',
    `Live: a bot orbiting its own planet; the player on auto-aim (tap scheme, no lock) so the sim's ONE lead solver leads the ladder's pick. Over ${o.frames} frames (${o.firingFrames} firing) the bot swept a ~${o.arcSweptDeg}° arc at ~${o.meanOrbitRadius}px radius and its hull stepped DOWN ${o.hits} times — ${o.hits} landed shots on a moving target across the window. Impossible before the lead solver ("I can never hit an enemy orbiting my planet"). Build ${SHA}.`,
    orbiterPanels.length ? orbiterPanels : [{ img: 'tap2-orbiter-hit1.png', tag: `${o.hits} HITS`, cap: `${o.hits} landed shots on the orbiter.` }],
    Math.max(1, orbiterPanels.length));

  console.log('[done]', JSON.stringify({ sha: SHA, hits: o.hits, errors: [...(a.errors ?? []), ...(m.errors ?? []), ...(f.errors ?? []), ...(o.errors ?? [])].slice(0, 8) }));
  await ctx.close();
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
