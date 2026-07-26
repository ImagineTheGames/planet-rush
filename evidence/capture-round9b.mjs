/**
 * evidence/capture-round9b.mjs — round 9b: the two gates round 9 REFUSED to fake,
 * now witnessable on build 884bca1 (p3-04 shipped the write seams). OWNER: QA Manager.
 *
 * Round 9 marked `damage-all-classes` and `repair-core-works` inconclusive because
 * nothing on the ?debug=1 surface could (a) damage an arbitrary owner's ship or
 * (b) damage/read a core. p3-04 added, on the same `window.__planetRush` handle,
 * three write/read seams routed through the sim's OWN ratified damage functions on
 * a tick boundary (off the net wire):
 *   - damageShip(owner, amount)  — WRITE any owner's ship hull
 *   - damageCore(player, amount) — WRITE any player's planet core
 *   - coreHp(player)             — READ any core's HP
 *
 * This file only DRIVES those seams (plus the pre-existing positioning/ore/wheel
 * seams) and reads back the plain sim/HUD numbers each attestation quotes. Every
 * claim about a pixel is written in the manifest AFTER looking at the PNG. No game
 * code, no test code.
 *
 * damage-all-classes — LIVE (no freeze; the write seams queue an Action drained
 *   once per fixed step, so the sim must be stepping). Past 10 s spawn protection,
 *   cycle owners 1..7: the positioning seam __healthbarStage.damageEnemy parks the
 *   current first-live enemy beside the centred local ship; damageShip(owner, …)
 *   drives THAT owner's hull bar down; screenshot its identity-coloured bar; then
 *   damageCore(owner, huge) eliminates that player so the next owner steps forward.
 *   Class-distinct silhouettes are the a2-02 art pass — until then per-owner
 *   coverage (a distinct roster colour per owner) is the claim. Plus one UNSTAGED
 *   frame: the local ship's own projectile weapon drops an enemy bar from 1.00, no
 *   damage seam touching its hull (the enemy is only re-framed, hull preserved).
 *
 * repair-core-works — LIVE. Fund the bank, watch the REPAIR CORE wedge grey on a
 *   full core and un-grey the instant damageCore(0, …) puts damage on it, then
 *   press REPAIR through the REAL pointer path (a click on the repair segment) and
 *   watch coreHp(0) rise while __oreDepositStage.readout().banked falls together.
 *
 * Usage:  node evidence/capture-round9b.mjs [shot-id ...]
 *   env EVIDENCE_BASE_URL (default http://localhost:4174)
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4174';

// Roster identity colours (src/art/tokens.ts PLAYER_ROSTER), indexed by owner id.
const ROSTER = [
  { name: 'Azure', hex: 0x3d7bff },      // 0 local
  { name: 'Cyan', hex: 0x22d3c5 },       // 1
  { name: 'Spring-green', hex: 0x3dd68c },// 2
  { name: 'Violet', hex: 0x9b5de5 },     // 3
  { name: 'Magenta', hex: 0xf15bb5 },    // 4
  { name: 'Orange', hex: 0xff8a3d },     // 5
  { name: 'Chalk', hex: 0xdce3ec },      // 6
  { name: 'Slate-Blue', hex: 0x5c6ce0 }, // 7
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
function clampClip(clip, vp) {
  const x = clamp(clip.x, 0, vp.width - 1);
  const y = clamp(clip.y, 0, vp.height - 1);
  return {
    x: Math.round(x), y: Math.round(y),
    width: Math.round(Math.min(clip.width, vp.width - x)),
    height: Math.round(Math.min(clip.height, vp.height - y)),
  };
}
const frames = (page, n = 2) =>
  page.evaluate(
    (k) => new Promise((r) => { let i = 0; const s = () => { i++; i >= k ? r() : requestAnimationFrame(s); }; requestAnimationFrame(s); }),
    n,
  );
async function waitDebug(page) {
  await page.waitForFunction(() => window.__planetRush?.viewport?.width > 0, undefined, { timeout: 25_000 });
}
async function waitPastSpawnProtection(page) {
  await page.waitForFunction(() => (window.__planetRush?.ticks ?? 0) >= 700, undefined, { timeout: 45_000 });
}

/** Threat-red projectile pixels in a PNG (the ship/turret shot dot) → x-span. */
function redSpan(path) {
  const png = PNG.sync.read(readFileSync(path));
  const { width, height, data } = png;
  let min = Infinity, max = -Infinity, n = 0, sy = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i] > 150 && data[i + 1] < 90 && data[i + 2] < 90) {
        if (x < min) min = x; if (x > max) max = x; sy += y; n++;
      }
    }
  }
  return n ? { n, min, max, cy: Math.round(sy / n) } : null;
}

/** The dominant saturated bar colour sampled in a crop's upper band (where the
 *  floated hull bar draws) → nearest roster owner, for a colour cross-check. */
function dominantBarColor(path, bandTop, bandBottom) {
  const png = PNG.sync.read(readFileSync(path));
  const { width, height, data } = png;
  const lo = clamp(bandTop | 0, 0, height - 1), hi = clamp(bandBottom | 0, 0, height - 1);
  let br = 0, bg = 0, bb = 0, n = 0;
  for (let y = lo; y < hi; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx > 110 && mx - mn > 45) { br += r; bg += g; bb += b; n++; } // saturated & bright
    }
  }
  if (!n) return null;
  const r = Math.round(br / n), g = Math.round(bg / n), b = Math.round(bb / n);
  let best = Infinity, who = null;
  for (let id = 1; id < ROSTER.length; id++) {
    const c = ROSTER[id].hex, dr = ((c >> 16) & 255) - r, dg = ((c >> 8) & 255) - g, db = (c & 255) - b;
    const d = dr * dr + dg * dg + db * db;
    if (d < best) { best = d; who = id; }
  }
  return { rgb: [r, g, b], nearestOwner: who, nearestName: ROSTER[who].name, samples: n };
}

/** Stitch PNGs side by side into one strip (equal-ish heights). */
function stitchH(paths, outPath, gap = 6, bg = [10, 12, 16]) {
  const imgs = paths.map((p) => PNG.sync.read(readFileSync(p)));
  const h = Math.max(...imgs.map((i) => i.height));
  const w = imgs.reduce((s, i) => s + i.width, 0) + gap * (imgs.length - 1);
  const out = new PNG({ width: w, height: h });
  for (let i = 0; i < out.data.length; i += 4) { out.data[i] = bg[0]; out.data[i + 1] = bg[1]; out.data[i + 2] = bg[2]; out.data[i + 3] = 255; }
  let ox = 0;
  for (const im of imgs) {
    for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
      const si = (y * im.width + x) * 4, di = (y * w + (ox + x)) * 4;
      out.data[di] = im.data[si]; out.data[di + 1] = im.data[si + 1]; out.data[di + 2] = im.data[si + 2]; out.data[di + 3] = 255;
    }
    ox += im.width + gap;
  }
  writeFileSync(outPath, PNG.sync.write(out));
}

// ── damage-all-classes ────────────────────────────────────────────────────────
const DAMAGE_ALL = {
  id: 'damage-all-classes',
  device: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  url: '/?debug=1',
  async run(page) {
    await waitDebug(page);
    await page.waitForFunction(() => typeof window.__healthbarStage?.damageEnemy === 'function', undefined, { timeout: 20_000 });
    await page.waitForFunction(() => typeof window.__planetRush?.damageShip === 'function', undefined, { timeout: 20_000 });
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    await waitPastSpawnProtection(page);
    const vp = page.viewportSize();
    const cy = vp.height / 2;
    const PANEL = { w: 240, h: 210 };
    const cropAround = (bx) => clampClip({ x: bx - PANEL.w / 2, y: cy - 130, width: PANEL.w, height: PANEL.h }, vp);
    mkdirSync('/tmp/pw9b', { recursive: true });

    // ── UNSTAGED own-fire frame (enemies still all alive). Park local at home so
    //    the camera holds still; bring one enemy into frame at FULL hull; hold fire.
    //    From here NO seam touches the enemy hull — damageEnemy is called only with
    //    the enemy's CURRENT fraction (re-frame, hull preserved), so every point it
    //    loses is the player's own projectile weapon.
    await page.evaluate(() => window.__oreDepositStage.stage(0));
    let s = await page.evaluate(() => window.__healthbarStage.damageEnemy(1.0));
    await frames(page, 2);
    let bar = await page.evaluate((o) => window.__healthbarStage.bars().find((b) => b.owner === o) ?? null, s.owner);
    await page.mouse.move(bar ? bar.x : vp.width / 2 + 120, cy);
    await page.mouse.down();
    const fireFrames = [];
    for (let i = 0; i < 70; i++) {
      const b = await page.evaluate((o) => window.__healthbarStage.bars().find((x) => x.owner === o) ?? null, s.owner);
      const frac = b ? b.fraction : 1;
      await page.evaluate(([o, f]) => { window.__oreDepositStage.stage(0); const bb = window.__healthbarStage.bars().find((x) => x.owner === o); if (bb) window.__healthbarStage.damageEnemy(bb.fraction); }, [s.owner, frac]);
      const nb = await page.evaluate((o) => window.__healthbarStage.bars().find((x) => x.owner === o) ?? null, s.owner);
      if (nb) await page.mouse.move(nb.x, cy);
      const path = join('/tmp/pw9b', `fire${String(i).padStart(2, '0')}.png`);
      await page.screenshot({ path, clip: cropAround(nb ? nb.x : vp.width / 2 + 120) });
      fireFrames.push({ i, path, frac: nb ? +nb.fraction.toFixed(3) : null, red: redSpan(path), bx: nb ? Math.round(nb.x) : null });
      await page.waitForTimeout(30);
    }
    await page.mouse.up();
    // Pick a frame with a red projectile visible AND the bar already below full
    // (own weapon has bitten): the "projectiles landing" proof.
    const fireHit = fireFrames.filter((f) => f.red && f.frac != null && f.frac < 0.985)
      .sort((a, b) => (b.red.n - a.red.n))[0]
      ?? fireFrames.filter((f) => f.red).sort((a, b) => b.red.n - a.red.n)[0]
      ?? [...fireFrames].reverse().find((f) => f.frac != null && f.frac < 0.985)
      ?? fireFrames[fireFrames.length - 1];
    writeFileSync(join(OUT, 'own-fire-unstaged.png'), readFileSync(fireHit.path));
    const fireFracs = fireFrames.map((f) => f.frac).filter((v) => v != null);
    const ownFire = { startFrac: 1.0, minFrac: fireFracs.length ? Math.min(...fireFracs) : null, owner: s.owner, ownerColor: ROSTER[s.owner].name, framePicked: fireHit.i, redAtPick: fireHit.red };

    // ── Per-owner montage: cycle owners 1..7 via damageShip (drive the bar) +
    //    damageCore (eliminate to advance). Each panel is that owner's identity-
    //    coloured bar at a distinct, clearly-damaged fill.
    const panels = [];
    const covered = [];
    for (let round = 0; round < 8 && covered.length < 7; round++) {
      const st = await page.evaluate(() => { window.__oreDepositStage.stage(0); return window.__healthbarStage.damageEnemy(0.85); });
      if (!st) break;
      const owner = st.owner;
      if (covered.some((c) => c.owner === owner)) break; // no progress guard
      // Drive THIS owner's hull down with the write seam; re-frame (preserve frac).
      let frac = 0.85;
      const target = 0.30 + owner * 0.045; // stagger targets a touch so panels differ
      for (let k = 0; k < 18; k++) {
        await page.evaluate((o) => window.__planetRush.damageShip(o, 5), owner);
        await frames(page, 3);
        let b = await page.evaluate((o) => window.__healthbarStage.bars().find((x) => x.owner === o) ?? null, owner);
        if (!b) { await page.evaluate(([o, f]) => window.__healthbarStage.damageEnemy(f), [owner, frac]); await frames(page, 2); b = await page.evaluate((o) => window.__healthbarStage.bars().find((x) => x.owner === o) ?? null, owner); }
        if (b) frac = b.fraction;
        if (frac <= target) break;
        await page.evaluate(([o, f]) => { window.__oreDepositStage.stage(0); window.__healthbarStage.damageEnemy(f); }, [owner, frac]);
        await frames(page, 1);
      }
      // Settle framed and shoot the panel.
      await page.evaluate(([o, f]) => { window.__oreDepositStage.stage(0); window.__healthbarStage.damageEnemy(f); }, [owner, frac]);
      await frames(page, 3);
      const b = await page.evaluate((o) => window.__healthbarStage.bars().find((x) => x.owner === o) ?? null, owner);
      const bx = b ? b.x : vp.width / 2;
      const clip = cropAround(bx);
      const path = join('/tmp/pw9b', `owner${owner}.png`);
      await page.screenshot({ path, clip });
      // Bar draws floated above the ship; sample the top band for its colour.
      const barBandTop = (b ? b.y : cy) - clip.y - 4;
      const col = dominantBarColor(path, barBandTop, barBandTop + 22);
      panels.push({ owner, path, fraction: b ? +b.fraction.toFixed(3) : null, color: ROSTER[owner].name, colorCheck: col });
      covered.push({ owner, fraction: b ? +b.fraction.toFixed(3) : null });
      // Eliminate this player's core so the next owner becomes first-live.
      if (covered.length < 7) {
        for (let e = 0; e < 20; e++) {
          await page.evaluate((o) => window.__planetRush.damageCore(o, 100000), owner);
          await frames(page, 3);
          const n = await page.evaluate(() => window.__healthbarStage.damageEnemy(0.85));
          if (!n || n.owner !== owner) break;
        }
      }
    }
    // Order panels by owner and stitch.
    panels.sort((a, b) => a.owner - b.owner);
    stitchH(panels.map((p) => p.path), join(OUT, 'damage-all-classes.png'));

    const facts = { ownersCovered: panels.map((p) => p.owner), perOwner: panels.map((p) => ({ owner: p.owner, color: p.color, fraction: p.fraction, colorNearest: p.colorCheck?.nearestOwner, colorRgb: p.colorCheck?.rgb })), ownFire };
    console.log('[damage-all-classes]', JSON.stringify(facts));
    return { skipShot: true, facts };
  },
};

// ── repair-core-works ─────────────────────────────────────────────────────────
const REPAIR_CORE = {
  id: 'repair-core-works',
  device: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  url: '/?debug=1',
  async run(page) {
    await waitDebug(page);
    await page.waitForFunction(() => typeof window.__planetRush?.coreHp === 'function', undefined, { timeout: 20_000 });
    await page.waitForFunction(() => typeof window.__upgradeWheelStage?.openBuild === 'function', undefined, { timeout: 20_000 });
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    await waitPastSpawnProtection(page);
    const vp = page.viewportSize();

    // Repair segment (index 2 of turret/shield/repair/upgrade/bank) screen point:
    // wheel centred, radius clamp(min(w,h)*0.36,120,230)=230; segmentAngle(2) = 54°.
    const cx = vp.width / 2, cyc = vp.height / 2, R = clamp(Math.min(vp.width, vp.height) * 0.36, 120, 230);
    const ang = -Math.PI / 2 + 2 * ((2 * Math.PI) / 5);
    const repairPt = { x: Math.round(cx + R * 0.62 * Math.cos(ang)), y: Math.round(cyc + R * 0.62 * Math.sin(ang)) };

    const BANK0 = 26;
    const full = await page.evaluate(() => window.__planetRush.coreHp(0));
    await page.evaluate((o) => window.__upgradeWheelStage.setOre(o), BANK0); // fund the bank
    // Open the Build wheel on the FULL core → REPAIR CORE greyed (inactive).
    await page.evaluate(() => window.__upgradeWheelStage.openBuild());
    await frames(page, 4);
    const greyedPath = join(OUT, 'repair-wedge-greyed.png');
    await page.screenshot({ path: greyedPath });
    const coreFull = await page.evaluate(() => window.__planetRush.coreHp(0));

    // Damage OWN core with the write seam. The wedge must un-grey (damage exists).
    const HIT = Math.floor(full * 0.7);
    await page.evaluate((h) => window.__planetRush.damageCore(0, h), HIT);
    let damaged = full;
    for (let i = 0; i < 50; i++) { await frames(page, 2); const hp = await page.evaluate(() => window.__planetRush.coreHp(0)); if (hp < full - 1) { damaged = hp; break; } }
    await page.evaluate(() => window.__upgradeWheelStage.openBuild()); // keep docked + open
    await frames(page, 4);
    const readyPath = join(OUT, 'repair-wedge-ready.png');
    await page.screenshot({ path: readyPath });
    const bankBefore = (await page.evaluate(() => window.__oreDepositStage.readout())).banked;

    // Press REPAIR through the REAL pointer path (click the repair segment).
    await page.mouse.move(repairPt.x, repairPt.y);
    await page.mouse.down();
    await page.mouse.up();

    // Watch coreHp rise and the bank fall together. Capture a clear mid-repair frame.
    const trace = [];
    let progressPath = null, midCore = damaged, midBank = bankBefore;
    for (let i = 0; i < 80; i++) {
      await frames(page, 4);
      const hp = await page.evaluate(() => window.__planetRush.coreHp(0));
      const ro = await page.evaluate(() => window.__oreDepositStage.readout());
      trace.push({ coreHp: +hp.toFixed(2), banked: +ro.banked.toFixed(2) });
      if (hp > damaged + Math.min(28, (full - damaged) * 0.6)) {
        midCore = hp; midBank = ro.banked;
        progressPath = join(OUT, 'repair-in-progress.png');
        await page.screenshot({ path: progressPath });
        break;
      }
    }
    if (!progressPath) { // fell short (bank drained) — still capture the best frame
      progressPath = join(OUT, 'repair-in-progress.png');
      await page.screenshot({ path: progressPath });
      const last = trace[trace.length - 1]; if (last) { midCore = last.coreHp; midBank = last.banked; }
    }
    stitchH([greyedPath, readyPath, progressPath], join(OUT, 'repair-core-works.png'));

    const facts = {
      coreFull: +coreFull.toFixed(2), damagedTo: +damaged.toFixed(2), repairedTo: +midCore.toFixed(2),
      bank0: BANK0, bankBefore: +bankBefore.toFixed(2), bankAfter: +midBank.toFixed(2),
      repairPt, deltaCore: +(midCore - damaged).toFixed(2), deltaBank: +(bankBefore - midBank).toFixed(2),
      traceHead: trace.slice(0, 3), traceTail: trace.slice(-3),
    };
    console.log('[repair-core-works]', JSON.stringify(facts));
    return { skipShot: true, facts };
  },
};

const SHOTS = [DAMAGE_ALL, REPAIR_CORE];

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
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(BASE + shot.url, { waitUntil: 'load' });
      const result = await shot.run(page);
      if (!result?.skipShot) await page.screenshot({ path: join(OUT, `${shot.id}.png`) });
      const build = await page.evaluate(() => window.__planetRush?.build ?? null).catch(() => null);
      console.log(JSON.stringify({ id: shot.id, url: shot.url, build, errors: errors.slice(0, 4) }));
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
