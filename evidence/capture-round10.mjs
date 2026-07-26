/**
 * evidence/capture-round10.mjs — round 10: turret NATURAL siege + player nameplates.
 * OWNER: QA Manager. Build 038457b.
 *
 * ROUND-10 RULE: no staged placements for behaviour claims. Behaviour evidence
 * uses NATURAL matches. Nothing here places an attacker, damages a core, or moves
 * a bot. Every seam touched is READ-ONLY:
 *   __planetRush.ticks, .coreHp(p), .beams (turret muzzles), .shipWorld, .shipScreen,
 *   __healthbarStage.bars() (drawn bars → on-screen ship screen positions),
 *   __nameplateStage.plates()/names() (drawn labels).
 *
 * The camera renders 1:1 and holds the LOCAL ship centred; the local ship is left
 * IDLE at its home for the whole run, so a large viewport is simply a wide-angle
 * window onto the real eight-planet ring fighting on its own.
 *
 * DISAMBIGUATION (the round-8 lesson): the grey turret disc on a rim and a bot's
 * own grey ship hovering near its planet look alike zoomed out. So the turret is
 * identified with SEAM CERTAINTY, not by eye: a turret muzzle in `beams` carries
 * `shooter === planetOwner` and an `origin` that is the turret's exact rim pixel
 * this tick, plus an `end`/`hit` that is what it fires at. A burst is triggered
 * only when a planet's OWN turret (shooter === p) is caught firing WHILE an enemy
 * ship besieges that planet; each frame logs every muzzle origin (the turret's
 * bearing, seam-certain) and every enemy ship position (the besieger), so the
 * slide is proven by the origin bearing track and the screenshots merely confirm
 * the disc sits where the seam says the turret is.
 *
 * Usage: node evidence/capture-round10.mjs [seconds]
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4174';
const SECONDS = Number(process.argv[2] ?? 240);
const VP = { width: 2560, height: 2560 };
const NAMES_FALLBACK = ['YOU', 'Rusty', 'Bolt', 'Foreman', 'Patch', 'Sable', 'Vulture', 'Warden'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Read the world in SCREEN space (camera 1:1, ship centred). Turret beams carry
 *  their shooter (== planet owner) and origin (rim pixel) + end (what it fires at). */
const SNAP = () => {
  const pr = window.__planetRush;
  const sw = pr.shipWorld, ss = pr.shipScreen;
  const S = (wx, wy) => ({ x: Math.round(ss.x + (wx - sw.x)), y: Math.round(ss.y + (wy - sw.y)) });
  const cores = [];
  for (let p = 0; p < 8; p++) cores.push(pr.coreHp(p));
  const turret = (pr.beams ?? []).filter((b) => b.source === 'turret').map((b) => {
    const o = S(b.origin.x, b.origin.y), e = S(b.end.x, b.end.y);
    return { shooter: b.shooter, ox: o.x, oy: o.y, ex: e.x, ey: e.y, hit: !!b.hit };
  });
  const bars = (window.__healthbarStage?.bars?.() ?? []).map((b) => ({ o: b.owner, x: Math.round(b.x), y: Math.round(b.y), f: +b.fraction.toFixed(2), local: b.local }));
  return { tick: pr.ticks, cores, turret, bars };
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  const CAP = '/tmp/muzzle';
  mkdirSync(CAP, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__planetRush?.viewport?.width > 0, undefined, { timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__planetRush?.coreHp === 'function', undefined, { timeout: 20_000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  const build = await page.evaluate(() => window.__planetRush?.build ?? null);

  // --- player-nameplates: a clean wide frame early, everyone near home. -------
  await page.waitForFunction(() => (window.__planetRush?.ticks ?? 0) >= 780, undefined, { timeout: 60_000 });
  const plateSnap = await page.evaluate(() => {
    const plates = (window.__nameplateStage?.plates?.() ?? []).map((p) => ({
      owner: p.owner, text: p.text, kind: p.kind, x: Math.round(p.x), y: Math.round(p.y), color: p.color,
    }));
    return { plates, names: window.__nameplateStage?.names?.() ?? [], tick: window.__planetRush.ticks };
  });
  await page.screenshot({ path: join(OUT, 'player-nameplates-full.png') });
  writeFileSync(join(CAP, 'nameplates.json'), JSON.stringify(plateSnap, null, 2));
  const NAMES = plateSnap.names.length ? plateSnap.names : NAMES_FALLBACK;
  console.log('[nameplates] tick', plateSnap.tick, 'names', JSON.stringify(NAMES));

  // Per-planet screen centre estimate: running mean of that owner's muzzle origins.
  const centre = Array.from({ length: 8 }, () => ({ sx: 0, sy: 0, n: 0 }));
  const feedCentre = (t) => { const c = centre[t.shooter]; c.sx += t.ox; c.sy += t.oy; c.n++; };
  const centreOf = (s) => (centre[s].n ? { x: Math.round(centre[s].sx / centre[s].n), y: Math.round(centre[s].sy / centre[s].n) } : null);

  // Is an enemy ship (not the planet owner, not local) besieging planet p right now?
  const besiegerNear = (snap, p, c) => {
    if (!c) return null;
    let best = null, bd = Infinity;
    for (const b of snap.bars) {
      if (b.local || b.o === p) continue;
      const d = Math.hypot(b.x - c.x, b.y - c.y);
      if (d < 420 && d < bd) { bd = d; best = { o: b.o, x: b.x, y: b.y, d: Math.round(d), f: b.f }; }
    }
    return best;
  };

  const episodes = [];
  const cooldownUntil = new Array(8).fill(0);
  const hasTurret = new Array(8).fill(false); // set once we ever see that owner's muzzle
  const enemyWasNear = new Array(8).fill(false); // rising-edge detector per planet
  const t0 = Date.now();
  let epi = 0;

  while ((Date.now() - t0) / 1000 < SECONDS && epi < 20) {
    const s = await page.evaluate(SNAP);
    for (const t of s.turret) { feedCentre(t); if (t.shooter > 0) hasTurret[t.shooter] = true; }
    // Trigger on the RISING EDGE of a besieger approaching a known, turreted,
    // non-local planet — so the burst catches the turret from REST as the enemy
    // arrives, through the slide. (Catch pre-siege, not mid-siege.)
    let fire = null;
    for (let p = 1; p < 8; p++) {
      const c = centreOf(p);
      if (!c || !hasTurret[p]) { enemyWasNear[p] = false; continue; }
      const enemy = besiegerNear(s, p, c);
      const near = !!enemy;
      const rising = near && !enemyWasNear[p] && s.tick >= cooldownUntil[p];
      enemyWasNear[p] = near;
      if (rising) { fire = { p, c, enemy }; break; }
    }
    if (fire) {
      const { p } = fire;
      const dir = join(CAP, `epi${String(epi).padStart(2, '0')}_p${p}_${NAMES[p]}`);
      mkdirSync(dir, { recursive: true });
      const frames = [];
      // Burst ~2.6s @55ms: dense disc frames + every muzzle origin we can catch.
      for (let i = 0; i < 48; i++) {
        const fs = await page.evaluate(SNAP);
        for (const t of fs.turret) feedCentre(t);
        const path = join(dir, `f${String(i).padStart(2, '0')}.png`);
        await page.screenshot({ path });
        const c = centreOf(p);
        const ownTurret = fs.turret.filter((t) => t.shooter === p);
        // Store ALL on-screen ship positions (incl the planet owner's OWN ship),
        // so a disc on the rim can be proven NOT to be a ship (round-8 lesson).
        const ships = fs.bars.map((b) => ({ o: b.o, x: b.x, y: b.y, f: b.f, local: b.local,
          d: c ? Math.round(Math.hypot(b.x - c.x, b.y - c.y)) : null }));
        frames.push({ i, path, tick: fs.tick, core: fs.cores[p], centre: c, ownTurret, ships });
        await sleep(50);
      }
      const meta = { episode: epi, planet: p, owner: NAMES[p], build, centre: centreOf(p), frames };
      writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
      const muzzleFrames = frames.filter((f) => f.ownTurret.length).length;
      const coreStart = frames[0].core, coreEnd = frames[frames.length - 1].core;
      console.log(`[siege] epi${epi} p${p} ${NAMES[p]} muzzleFrames=${muzzleFrames}/48 core ${coreStart?.toFixed(1)}->${coreEnd?.toFixed(1)} centre=${JSON.stringify(centreOf(p))}`);
      episodes.push({ epi, planet: p, owner: NAMES[p], dir, muzzleFrames, coreStart, coreEnd });
      cooldownUntil[p] = s.tick + 200;
      epi++;
    }
    prev = s;
    await sleep(45);
  }

  writeFileSync(join(CAP, 'episodes.json'), JSON.stringify({ build, names: NAMES, episodes, errors: errors.slice(0, 5) }, null, 2));
  console.log('[done] episodes:', episodes.length, 'errors:', errors.slice(0, 3));
  await browser.close();
}
let prev;
main().catch((e) => { console.error(e); process.exit(1); });
