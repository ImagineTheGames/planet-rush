/**
 * evidence/capture-round9.mjs — round-9 verification of the v0.2 "projectile era"
 * report wave on the LIVE preview build. OWNER: QA Manager.
 *
 * Every claim about a shot is written in evidence/manifest.json AFTER looking at
 * the PNG. This file only guarantees WHAT WAS PUT ON SCREEN and reads back the
 * plain sim/HUD facts each attestation quotes. No game code, no test code — it
 * only drives the ?debug=1 live-stage seams the client already installs.
 *
 * The six report-wave gates and how each is reached on THIS build (de2fa64):
 *
 *  projectile-dodge   — LIVE (no freeze), AFTER the 10 s spawn-protection window
 *                       (`SPAWN_PROTECTION_S`; before it, every shot passes over
 *                       everything). Park one enemy beside the local ship, hold
 *                       fire east, and burst-capture: a ship-weapon shot is a red
 *                       dot with NO beam (mining is the only beam), so a red dot
 *                       partway between shooter and target IS a projectile in
 *                       flight. The enemy, live under bot AI, strafes off the
 *                       shot line — travel time lets it evade. Composited beside
 *                       a mining frame (a real beam) to attest "mining is STILL a
 *                       beam."
 *
 *  upgrade-wheel      — ?debug=1&freeze=1, `__upgradeWheelStage.openUpgrade` — the
 *                       new radial UPGRADE wheel, tiers + costs read back from the
 *                       drawn wedges, beside the Build wheel for the same language.
 *
 *  wheel-cycle-robust — open/close BOTH wheels 16× each and assert the drawn wheel
 *                       still `interactive()` after every cycle (the exact field
 *                       bug: rapid open/close wedging the menu shut).
 *
 *  map-in-lobby       — CLEAN boot (no ?debug=1): main menu → PLAY → the lobby,
 *                       one screen with the roster slots, the hull picker AND the
 *                       arena row. No separate picker step.
 *
 *  damage-all-classes — PARTIAL. The `damageEnemy` seam only ever reaches owner 1
 *                       (Hauler) and force-revives it, so the player can be shown
 *                       damaging ONE class from its own fire; the other three
 *                       cannot be brought under player fire, and placeholder ships
 *                       are visually identical, so class is not pixel-readable.
 *                       Captured honestly; the manifest verdict says so.
 *
 *  repair-core        — PARTIAL. No seam damages the local core and there is no
 *                       coreHp readback for the "captioned numbers"; the build
 *                       wheel's REPAIR CORE wedge is captured and the gap is
 *                       recorded in the manifest.
 *
 * Usage:  node evidence/capture-round9.mjs [shot-id ...]
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
function clampClip(clip, vp) {
  const x = clamp(clip.x, 0, vp.width - 1);
  const y = clamp(clip.y, 0, vp.height - 1);
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(Math.min(clip.width, vp.width - x)),
    height: Math.round(Math.min(clip.height, vp.height - y)),
  };
}

async function waitDebug(page) {
  await page.waitForFunction(() => window.__planetRush?.viewport?.width > 0, undefined, { timeout: 25_000 });
}
/** Wait past the 10 s spawn-protection window so shots actually land. */
async function waitPastSpawnProtection(page) {
  await page.waitForFunction(() => (window.__planetRush?.ticks ?? 0) >= 680, undefined, { timeout: 60_000 });
}

/** Nearest light-grey asteroid blob to screen centre, in the play area only
 *  (skips the HUD rows). Returns screen {x,y} or null. */
function nearestRock(path) {
  const png = PNG.sync.read(readFileSync(path));
  const { width, height, data } = png;
  const cx = width / 2, cy = height / 2;
  const grey = (x, y) => {
    const i = (y * width + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
    return r > 120 && r < 205 && Math.abs(r - g) < 14 && Math.abs(g - b) < 14;
  };
  let best = Infinity, bx = null, by = null;
  for (let y = 140; y < height - 120; y += 4) {
    for (let x = 4; x < width - 4; x += 4) {
      if (!grey(x, y)) continue;
      let c = 0; // require a small cluster so stray HUD-text greys are rejected
      for (let dy = -6; dy <= 6; dy += 3) for (let dx = -6; dx <= 6; dx += 3) {
        if (grey(clamp(x + dx, 0, width - 1), clamp(y + dy, 0, height - 1))) c++;
      }
      if (c < 12) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d > 60 && d < best) { best = d; bx = x; by = y; }
    }
  }
  return bx == null ? null : { x: bx, y: by, d: best };
}

/** Wait for two rendered frames so a just-changed HUD state is on stage before
 *  a debug read. */
async function twoFrames(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Threat-red projectile pixels in a PNG crop → their x-span (or null). */
function redSpan(path) {
  const png = PNG.sync.read(readFileSync(path));
  const { width, height, data } = png;
  let min = Infinity, max = -Infinity, n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i] > 150 && data[i + 1] < 90 && data[i + 2] < 90) {
        if (x < min) min = x;
        if (x > max) max = x;
        n++;
      }
    }
  }
  return n ? { n, min, max } : null;
}

/** Stitch PNGs side by side (equal heights assumed) into one image. */
function stitchH(paths, outPath, gap = 6, bg = [10, 12, 16]) {
  const imgs = paths.map((p) => PNG.sync.read(readFileSync(p)));
  const h = Math.max(...imgs.map((i) => i.height));
  const w = imgs.reduce((s, i) => s + i.width, 0) + gap * (imgs.length - 1);
  const out = new PNG({ width: w, height: h });
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = bg[0]; out.data[i + 1] = bg[1]; out.data[i + 2] = bg[2]; out.data[i + 3] = 255;
  }
  let ox = 0;
  for (const im of imgs) {
    for (let y = 0; y < im.height; y++) {
      for (let x = 0; x < im.width; x++) {
        const si = (y * im.width + x) * 4;
        const di = (y * w + (ox + x)) * 4;
        out.data[di] = im.data[si]; out.data[di + 1] = im.data[si + 1];
        out.data[di + 2] = im.data[si + 2]; out.data[di + 3] = 255;
      }
    }
    ox += im.width + gap;
  }
  writeFileSync(outPath, PNG.sync.write(out));
}

// ── projectile-dodge ──────────────────────────────────────────────────────────
const PROJECTILE_DODGE = {
  id: 'projectile-dodge',
  device: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  url: '/?debug=1',
  async run(page) {
    await waitDebug(page);
    await page.waitForFunction(() => typeof window.__healthbarStage?.damageEnemy === 'function', undefined, { timeout: 20_000 });
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    await page.waitForFunction(() => (window.__planetRush?.ticks ?? 0) >= 200, undefined, { timeout: 40_000 });
    const vp = page.viewportSize();
    const cy = vp.height / 2;
    const burstDir = '/tmp/pw9dodge';
    mkdirSync(burstDir, { recursive: true });
    const minePath = join(burstDir, 'mine.png');

    // ── Mining IS a beam (do this FIRST, while the ship is fresh near its home
    // field). Steer the local ship onto an asteroid (detected from the drawn frame,
    // with a wander fallback when none is in view) and hold fire: over rock the
    // weapon is the mining beam — a drawn LINE (source:'ship', origin→hit), not a
    // traveling dot. Confirm via __planetRush.beams and catch a drawn frame.
    let miningBeam = null, rock = null, noRock = 0, wander = 0;
    await page.mouse.down();
    for (let i = 0; i < 240 && !miningBeam; i++) {
      const cur = join(burstDir, 'scan.png');
      await page.screenshot({ path: cur });
      const r = nearestRock(cur);
      if (r) { rock = r; noRock = 0; } else { noRock++; }
      if (rock && noRock < 4) {
        await page.mouse.move(rock.x, rock.y); // aim at the rock
        const keys = [];
        if (rock.x < vp.width / 2 - 30) keys.push('KeyA'); else if (rock.x > vp.width / 2 + 30) keys.push('KeyD');
        if (rock.y < cy - 30) keys.push('KeyW'); else if (rock.y > cy + 30) keys.push('KeyS');
        for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) { if (keys.includes(k)) await page.keyboard.down(k); else await page.keyboard.up(k); }
      } else {
        // No rock in view — wander so a home-field asteroid comes on screen.
        const dir = ['KeyW', 'KeyA', 'KeyS', 'KeyD'][Math.floor(wander / 6) % 4];
        for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) { if (k === dir) await page.keyboard.down(k); else await page.keyboard.up(k); }
        wander++;
      }
      miningBeam = await page.evaluate(() => (window.__planetRush.beams ?? []).find((x) => x.source === 'ship' && x.shooter === 0) ?? null);
      await page.waitForTimeout(45);
    }
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) await page.keyboard.up(k);
    if (miningBeam) {
      for (let i = 0; i < 60; i++) { // burst to land on a frame where the beam is drawn
        if (rock) await page.mouse.move(rock.x, rock.y);
        const present = await page.evaluate(() => (window.__planetRush.beams ?? []).some((x) => x.source === 'ship' && x.shooter === 0));
        if (present) { await page.screenshot({ path: minePath, clip: clampClip({ x: vp.width / 2 - 250, y: cy - 80, width: 420, height: 160 }, vp) }); break; }
        await page.waitForTimeout(20);
      }
    } else {
      await page.screenshot({ path: minePath, clip: clampClip({ x: vp.width / 2 - 250, y: cy - 80, width: 420, height: 160 }, vp) });
    }
    await page.mouse.up();

    // ── Combat (past the 10 s spawn-protection window). Aim due east; hold fire.
    const clip = { x: 520, y: 320, width: 420, height: 160 };
    const shipCropX = vp.width / 2 - clip.x; // 640 - 520 = 120
    const inCrop = (bx) => bx != null && bx > clip.x + 40 && bx < clip.x + clip.width - 40;
    await waitPastSpawnProtection(page);
    // Park the ship stationary at its own planet so the shot geometry is clean and
    // the follow camera holds it centred (it drifted while mining).
    await page.evaluate(() => window.__oreDepositStage.stage(0));
    await page.mouse.move(1120, cy);
    await page.mouse.down();

    // Phase A — target held STILL (re-park ship + re-pin enemy every frame): the
    // projectile takes real time to cross the gap, so a frame catches a red dot
    // MID-WAY between the ship and the stationary enemy — a shot in flight, not a
    // hitscan line.
    const phaseA = [];
    for (let i = 0; i < 45; i++) {
      await page.evaluate(() => { window.__oreDepositStage.stage(0); window.__healthbarStage.damageEnemy(0.9); });
      await page.mouse.move(1120, cy);
      const path = join(burstDir, `a${String(i).padStart(2, '0')}.png`);
      await page.screenshot({ path, clip });
      const bar = await page.evaluate(() => window.__healthbarStage.bars()[0] ?? null);
      phaseA.push({ i, path, red: redSpan(path), barx: bar ? Math.round(bar.x) : null });
      await page.waitForTimeout(20);
    }
    // Phase B — target RELEASED: the enemy flies under its own bot AI while the ship
    // stays parked and keeps firing due east. Travel time lets it slide off the shot
    // line — a red dot flies past where it no longer is (a miss), the whole point of
    // the projectile switch.
    const phaseB = [];
    for (let i = 0; i < 75; i++) {
      await page.evaluate(() => window.__oreDepositStage.stage(0)); // keep the SHIP still; enemy free
      await page.mouse.move(1120, cy);
      const path = join(burstDir, `b${String(i).padStart(2, '0')}.png`);
      await page.screenshot({ path, clip });
      const bar = await page.evaluate(() => window.__healthbarStage.bars()[0] ?? null);
      phaseB.push({ i, path, red: redSpan(path), barx: bar ? Math.round(bar.x) : null, f: bar ? +bar.fraction.toFixed(3) : null });
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
    // Dodge, as DATA: a moving target under continuous eastward fire barely loses
    // hull, because a traveling shot cannot catch a mover (contrast: the still
    // target in Phase A is hit every pass). The enemy is released at ~0.9 hull.
    const bF = phaseB.map((f) => f.f).filter((v) => v != null);
    const dodgeData = bF.length ? { released: 0.9, phaseBHullMin: Math.min(...bF), phaseBHullLast: bF[bF.length - 1], phaseBShots: phaseB.filter((f) => f.red).length } : null;

    // IN-FLIGHT: a red dot mid-gap — east of the ship AND clearly west of the still
    // enemy (the shot hasn't reached it yet).
    const inflight = phaseA.find((fr) => fr.red && inCrop(fr.barx)
      && fr.red.min > shipCropX + 25 && (fr.barx - clip.x) - fr.red.max > 10);
    // EVADED: enemy in frame, a red dot east of it by a clear margin (a miss past the
    // spot it vacated). Pick the largest such gap.
    // Prefer a frame where the enemy is a DISTINCT eastern ship (well right of the
    // ship centre) with a red shot flown past it — reads unambiguously as a dodge.
    const evadedCands = phaseB.filter((fr) => fr.red && fr.barx != null
      && fr.barx > vp.width / 2 + 55 && fr.barx < clip.x + clip.width - 20
      && fr.red.max > (fr.barx - clip.x) + 25)
      .sort((p, q) => (q.red.max - (q.barx - clip.x)) - (p.red.max - (p.barx - clip.x)));
    const evaded = evadedCands[0]
      ?? phaseB.filter((fr) => fr.red && inCrop(fr.barx) && fr.red.max > (fr.barx - clip.x) + 40)
        .sort((p, q) => (q.red.max - (q.barx - clip.x)) - (p.red.max - (p.barx - clip.x)))[0];

    const pickA = inflight ?? phaseA.find((fr) => fr.red && inCrop(fr.barx) && fr.red.min > shipCropX + 25) ?? phaseA.find((fr) => fr.red);
    const pickB = evaded ?? [...phaseB].reverse().find((fr) => fr.red && inCrop(fr.barx)) ?? pickA;
    const frames = [...phaseA, ...phaseB];

    // Composite: IN FLIGHT | EVADED | MINING BEAM (three real frames).
    const composite = join(OUT, 'projectile-dodge.png');
    stitchH([pickA.path, pickB.path, minePath], composite);
    // Also keep the two raw combat frames for the record.
    writeFileSync(join(OUT, 'projectile-inflight.png'), readFileSync(pickA.path));
    writeFileSync(join(OUT, 'projectile-evaded.png'), readFileSync(pickB.path));
    writeFileSync(join(OUT, 'mining-beam.png'), readFileSync(minePath));

    const facts = {
      shipCropX,
      inflight: pickA ? { i: pickA.i, redCropX: pickA.red, enemyScreenX: pickA.barx } : null,
      evaded: pickB ? { i: pickB.i, redCropX: pickB.red, enemyScreenX: pickB.barx } : null,
      enemyScreenXRange: [Math.min(...frames.map((f) => f.barx).filter((x) => x != null)), Math.max(...frames.map((f) => f.barx).filter((x) => x != null))],
      framesWithProjectile: frames.filter((f) => f.red).length,
      dodgeData,
      miningBeam: miningBeam ? { source: miningBeam.source, origin: miningBeam.origin, end: miningBeam.end, hit: miningBeam.hit } : null,
    };
    console.log('[projectile-dodge]', JSON.stringify(facts));
    return { skipShot: true, facts };
  },
};

// ── upgrade-wheel ─────────────────────────────────────────────────────────────
const UPGRADE_WHEEL = {
  id: 'upgrade-wheel',
  device: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  url: '/?debug=1&freeze=1',
  async run(page) {
    await waitDebug(page);
    await page.waitForFunction(() => typeof window.__upgradeWheelStage?.openUpgrade === 'function', undefined, { timeout: 20_000 });
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    const upOpen = await page.evaluate(() => window.__upgradeWheelStage.openUpgrade(999));
    await page.waitForTimeout(400);
    const wedges = await page.evaluate(() => window.__upgradeWheelStage.wedges());
    const interactive = await page.evaluate(() => window.__upgradeWheelStage.interactive());
    await page.screenshot({ path: join(OUT, 'upgrade-wheel.png') });
    // The Build wheel beside it, for the same-language attestation.
    await page.evaluate(() => window.__upgradeWheelStage.close());
    await page.evaluate(() => window.__upgradeWheelStage.openBuild());
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, 'build-wheel-language.png') });
    const facts = { upOpen, interactive, wedges };
    console.log('[upgrade-wheel]', JSON.stringify(facts));
    return { skipShot: true, facts };
  },
};

// ── wheel-cycle-robust ────────────────────────────────────────────────────────
const WHEEL_CYCLE = {
  id: 'wheel-cycle-robust',
  device: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  url: '/?debug=1&freeze=1',
  async run(page) {
    await waitDebug(page);
    await page.waitForFunction(() => typeof window.__upgradeWheelStage?.openBuild === 'function', undefined, { timeout: 20_000 });
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    const CYCLES = 16;
    let buildFails = 0, upgradeFails = 0;
    // `interactive()` reads what the HUD DREW; let a frame render after each open
    // before reading it, else the read races the render and reports a false stale
    // `false` on a wheel that is in fact open (measurement artifact, not the bug).
    for (let i = 0; i < CYCLES; i++) {
      const bo = await page.evaluate(() => window.__upgradeWheelStage.openBuild());
      await twoFrames(page);
      const bi = await page.evaluate(() => window.__upgradeWheelStage.interactive());
      if (!bo?.open || !bi) buildFails++;
      await page.evaluate(() => window.__upgradeWheelStage.close());
      await twoFrames(page);
    }
    for (let i = 0; i < CYCLES; i++) {
      const uo = await page.evaluate(() => window.__upgradeWheelStage.openUpgrade(999));
      await twoFrames(page);
      const ui = await page.evaluate(() => window.__upgradeWheelStage.interactive());
      if (!uo?.open || !ui) upgradeFails++;
      await page.evaluate(() => window.__upgradeWheelStage.close());
      await twoFrames(page);
    }
    // Leave a wheel OPEN and interactive as the proof frame after all the cycling.
    await page.evaluate(() => window.__upgradeWheelStage.openBuild());
    await page.waitForTimeout(300);
    const finalInteractive = await page.evaluate(() => window.__upgradeWheelStage.interactive());
    await page.screenshot({ path: join(OUT, 'wheel-cycle-robust.png') });
    const facts = { cyclesEach: CYCLES, buildFails, upgradeFails, finalInteractive };
    console.log('[wheel-cycle-robust]', JSON.stringify(facts));
    return { skipShot: true, facts };
  },
};

// ── map-in-lobby ──────────────────────────────────────────────────────────────
const MAP_IN_LOBBY = {
  id: 'map-in-lobby',
  device: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  url: '/', // CLEAN boot — the menu/lobby only exist without ?debug=1
  async run(page) {
    await page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, { timeout: 20_000 });
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    await page.evaluate(() => window.__mainMenu.play());
    await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 20_000 });
    await page.waitForTimeout(600);
    const lobby = await page.evaluate(() => {
      const l = window.__lobby;
      return {
        slotCount: l.slotCount, selectedClass: l.selectedClass, classOrder: l.classOrder,
        selectedMapId: l.selectedMapId, mapOrder: l.mapOrder, mapCards: l.mapCards?.length,
        veteranMapId: l.veteranMapId, counting: l.counting,
      };
    });
    await page.screenshot({ path: join(OUT, 'map-in-lobby.png') });
    console.log('[map-in-lobby]', JSON.stringify(lobby));
    return { skipShot: true, facts: lobby };
  },
};

// ── damage-all-classes (PARTIAL — honest) ─────────────────────────────────────
const DAMAGE_CLASSES = {
  id: 'damage-all-classes',
  device: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  url: '/?debug=1',
  async run(page) {
    await waitDebug(page);
    await page.waitForFunction(() => typeof window.__healthbarStage?.damageEnemy === 'function', undefined, { timeout: 20_000 });
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    await waitPastSpawnProtection(page);
    const vp = page.viewportSize();
    const cy = vp.height / 2;
    // Pin owner-1 (Hauler) at 0.98, screenshot the "before". Then hold fire (aim at
    // the sprite, screen-centre Y), preserving accumulated player damage each frame
    // so the bar visibly falls under the player's own projectiles.
    const staged = await page.evaluate(() => window.__healthbarStage.damageEnemy(0.98));
    await page.waitForTimeout(80);
    let bar = await page.evaluate(() => window.__healthbarStage.bars()[0] ?? null);
    const beforeClip = clampClip({ x: (bar?.x ?? 900) - 130, y: cy - 110, width: 260, height: 160 }, vp);
    const beforePath = '/tmp/pw9dmg-before.png';
    await page.screenshot({ path: beforePath, clip: beforeClip });
    const beforeFrac = staged?.fraction ?? null;

    await page.mouse.move(bar.x, cy);
    await page.mouse.down();
    const trace = [beforeFrac];
    for (let i = 0; i < 40; i++) {
      const cur = await page.evaluate(() => { const b = window.__healthbarStage.bars()[0]; return b ? b.fraction : null; });
      const f = cur == null ? 0.98 : Math.min(cur, 0.98);
      await page.evaluate((x) => window.__healthbarStage.damageEnemy(x), f);
      const nb = await page.evaluate(() => window.__healthbarStage.bars()[0] ?? null);
      if (nb) await page.mouse.move(nb.x, cy);
      trace.push(+f.toFixed(3));
      await page.waitForTimeout(35);
    }
    await page.mouse.up();
    bar = await page.evaluate(() => window.__healthbarStage.bars()[0] ?? null);
    const afterClip = clampClip({ x: (bar?.x ?? 900) - 130, y: cy - 110, width: 260, height: 160 }, vp);
    const afterPath = '/tmp/pw9dmg-after.png';
    await page.screenshot({ path: afterPath, clip: afterClip });
    stitchH([beforePath, afterPath], join(OUT, 'damage-all-classes.png'));
    const facts = { stagedOwner: staged?.owner, ownerClass: 'hauler', beforeFrac, afterFrac: trace[trace.length - 1], trace };
    console.log('[damage-all-classes]', JSON.stringify(facts));
    return { skipShot: true, facts };
  },
};

// ── repair-core (PARTIAL — honest) ────────────────────────────────────────────
const REPAIR_CORE = {
  id: 'repair-core',
  device: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  url: '/?debug=1&freeze=1',
  async run(page) {
    await waitDebug(page);
    await page.waitForFunction(() => typeof window.__upgradeWheelStage?.openBuild === 'function', undefined, { timeout: 20_000 });
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    await page.evaluate(() => window.__upgradeWheelStage.openBuild());
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, 'repair-core.png') });
    // Enumerate the seams present so the manifest can state the gap precisely.
    const seams = await page.evaluate(() => Object.keys(window).filter((k) => k.startsWith('__')));
    const facts = { seamsPresent: seams, note: 'no core-damage seam, no coreHp readback' };
    console.log('[repair-core]', JSON.stringify(facts));
    return { skipShot: true, facts };
  },
};

const SHOTS = [PROJECTILE_DODGE, UPGRADE_WHEEL, WHEEL_CYCLE, MAP_IN_LOBBY, DAMAGE_CLASSES, REPAIR_CORE];

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
