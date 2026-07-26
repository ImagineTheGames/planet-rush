/**
 * evidence/capture-round8.mjs — round-8 verification of the two v0.1.3 field
 * reports on the LIVE preview build. OWNER: QA Manager.
 *
 * Two developer field reports:
 *
 *   ore-hud-under-ship  — "show ore held on ship UNDER the ship, not top-left;
 *                          top-left is the TOTAL." Two moments, both live (no
 *                          ?freeze — the deposit drain must actually run):
 *                            (a) MINE: local ship carrying a hold far from home;
 *                                the under-ship pip indicator must appear at
 *                                screen-centre (the follow camera holds the ship
 *                                there), while the top-left shows the banked TOTAL.
 *                            (b) DOCK: park at home; the sim auto-drains the hold —
 *                                the under-ship pips fall while the top-left TOTAL
 *                                rises by the same ore. Two DISTINCT numbers, both
 *                                read back off the live sim via __oreHudStage.
 *
 *   turret-far-side-engage — "another enemy came on the OTHER SIDE of the planet
 *                          and the turret didn't engage." Root cause (per commit
 *                          c62ef2a): threat detection measured range from the
 *                          turret's CURRENT rim spot, so a far-side threat was
 *                          invisible. Fix: detection is PLANET-centric — a ship
 *                          inside planetThreatRadius (orbit radius + range) is a
 *                          valid target even outside beam range of where the
 *                          turret sits, and the turret SLIDES around the rim to
 *                          the facing-normal point and fires with clean LOS.
 *
 *                          Staged live: build a turret on the home planet (mount
 *                          slot 0 → EAST rim, since home angle = planet.angle 0),
 *                          then park an attacker on the WEST (FAR) rim with the
 *                          __healthbarStage.damageEnemy seam — well outside beam
 *                          range of the east mount but inside planetThreatRadius.
 *                          If the fix holds the turret slides ~180° around the
 *                          planet body and fires from the WEST rim, its beam
 *                          pointing outward at the attacker (never through the
 *                          core). We chart the muzzle origin every frame to prove
 *                          the slide (east mount → west rim) and the settle (no
 *                          idle gap, no thrash), then crop the fire frame.
 *
 *                          HONESTY NOTE captured in the manifest: no debug seam
 *                          parks TWO attackers around one turreted planet, so the
 *                          simultaneous two-attacker priority SPLIT (§3/§4) is not
 *                          reproducible as live pixels; it is proven by the pure
 *                          sim suite tests/sim/turret-coverage.test.ts. What THIS
 *                          shot proves with pixels is the field report's literal
 *                          root cause: a far-side threat is now reached and fired
 *                          on, beam clean of the planet body, with no idle gap.
 *
 * Every claim about a shot lives in evidence/manifest.json, written after LOOKING
 * at the PNG. This file only guarantees WHAT WAS ON SCREEN.
 *
 * Usage:  node evidence/capture-round8.mjs [shot-id ...]
 */
import { chromium } from '@playwright/test';
import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** Wait for the ?debug=1 instrument to be live. */
async function waitDebug(page) {
  await page.waitForFunction(() => window.__planetRush?.viewport?.width > 0, undefined, {
    timeout: 25_000,
  });
}

// ── Shot 1/2: the ore HUD split — MINE then DOCK, on a desktop viewport. ───────
const ORE_HUD = {
  id: 'ore-hud',
  device: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  url: '/?debug=1',
  async run(page) {
    await waitDebug(page);
    await page.waitForFunction(() => typeof window.__oreHudStage?.mine === 'function', undefined, {
      timeout: 20_000,
    });
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    const vp = page.viewportSize();

    // --- (a) MINE: carry a hold away from home so it does NOT drain. ----------
    // Mine 5 while the boot bank is 3, so the under-ship count (5) and the
    // top-left TOTAL (3) are DISTINCT numbers — not a coincidental match.
    const MINED = 5;
    const staged = await page.evaluate((ore) => window.__oreHudStage.mine(ore), MINED);
    // Wait for the HUD to draw the under-ship indicator with the staged fill.
    const hold = await page
      .waitForFunction(
        (want) => {
          const h = window.__oreHudStage.hold();
          return h && h.filled === want ? h : null;
        },
        MINED,
        { timeout: 20_000 },
      )
      .then((h) => h.jsonValue());
    const totalWhileCarrying = await page.evaluate(() => window.__oreHudStage.total());
    const readoutMine = await page.evaluate(() => window.__oreHudStage.readout());
    console.log('[ore-hud] MINE staged=', JSON.stringify(staged), 'hold=', JSON.stringify(hold),
      'total=', totalWhileCarrying, 'readout=', JSON.stringify(readoutMine), 'vp=', JSON.stringify(vp));

    await page.waitForTimeout(300);
    // Full frame + a crop around the ship (screen centre) that also catches the
    // top-left TOTAL, so both numbers are in one honest image.
    await page.screenshot({ path: join(OUT, 'ore-hud-mine-full.png') });
    await page.screenshot({
      path: join(OUT, 'ore-hud-mine.png'),
      clip: clampClip({ x: 0, y: 0, width: Math.min(vp.width, vp.width / 2 + 260), height: vp.height }, vp),
    });

    // --- (b) DOCK: park at home; the sim drains the hold into the bank. -------
    const DOCKED = 6;
    const docked = await page.evaluate((ore) => window.__oreHudStage.dock(ore), DOCKED);
    const bankBefore = docked.banked;
    // Mid-drain: fewer filled pips than staged AND the top-left TOTAL has risen.
    const mid = await page
      .waitForFunction(
        (arg) => {
          const s = window.__oreHudStage;
          const h = s.hold();
          if (!h) return null;
          // Wait for a well-SEPARATED frame: the hold drained to a couple of pips
          // AND the TOTAL climbed well above where it started, so the two numbers
          // are visibly distinct (e.g. ~2 held under the ship, ~7 banked top-left).
          if (h.filled <= 2 && s.total() >= arg.bankBefore + 4) {
            return { filled: h.filled, slots: h.slots, x: h.x, y: h.y, total: s.total() };
          }
          return null;
        },
        { staged: DOCKED, bankBefore },
        { timeout: 20_000 },
      )
      .then((h) => h.jsonValue());
    const readoutDock = await page.evaluate(() => window.__oreHudStage.readout());
    console.log('[ore-hud] DOCK docked=', JSON.stringify(docked), 'mid=', JSON.stringify(mid),
      'readout=', JSON.stringify(readoutDock));

    await page.screenshot({ path: join(OUT, 'ore-hud-dock-full.png') });
    await page.screenshot({
      path: join(OUT, 'ore-hud-dock.png'),
      clip: clampClip({ x: 0, y: 0, width: Math.min(vp.width, vp.width / 2 + 260), height: vp.height }, vp),
    });

    return {
      skipShot: true,
      facts: { staged, hold, totalWhileCarrying, readoutMine, docked, mid, readoutDock },
    };
  },
};

// ── Shot 3: the turret far-side engage. ───────────────────────────────────────
const TURRET_FAR_SIDE = {
  id: 'turret-far-side',
  device: { viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  url: '/?debug=1',
  async run(page) {
    await waitDebug(page);
    await page.waitForTimeout(1500);
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
    const vp0 = page.viewportSize();
    if (wheel) {
      await page.mouse.click(wheel.x + wheel.width / 2, wheel.y + wheel.height / 2 - (wheel.width / 2) * 0.6);
    } else {
      await page.mouse.click(vp0.width / 2, vp0.height / 2 - 140);
    }
    await page.waitForTimeout(500); // ORE 3 → 0, turret queued
    await page.keyboard.down('KeyE'); // close the wheel
    await page.waitForTimeout(400);
    await page.keyboard.up('KeyE');
    // Let the 10 s (600-tick) build finish so the turret exists on the rim.
    await page.waitForFunction(() => (window.__planetRush?.ticks ?? 0) >= 700, undefined, {
      timeout: 30_000,
    });

    // Nudge the ship WEST of home so the parked bot (ship + 120u) lands due WEST
    // of the planet — the FAR side, opposite the turret's east mount — a clear
    // ~130u OUT from the west rim (not jammed against it), so the turret's own
    // muzzle beam (barrel tip → attacker surface) is a long, legible segment that
    // points OUTWARD, well inside the 240u planet-centric threat radius.
    await page.keyboard.down('KeyA');
    await page.waitForFunction((h) => window.__planetRush.shipWorld.x <= h.x - 200, home, {
      timeout: 30_000,
    });
    await page.keyboard.up('KeyA');
    await page.keyboard.down('KeyD'); // arrest + settle
    await page.waitForTimeout(300);
    await page.keyboard.up('KeyD');

    // My HOME turret's muzzle only: filter the world beam set to turret beams
    // whose origin sits near MY home planet centre (home.x+90, home.y), so bots'
    // turrets firing elsewhere never pollute the slide trail. The turret rides a
    // rim ring of radius (planetR 64 + mount 12 + turretR 12)=88, so 170u of the
    // centre captures it on any rim spot and its muzzle offset, nothing further.
    const HOME_C = { x: home.x + 90, y: home.y };

    const readMuzzle = (hc) => {
      const pr = window.__planetRush;
      window.__healthbarStage?.damageEnemy(0.6);
      const near = (b) => Math.hypot(b.origin.x - hc.x, b.origin.y - hc.y) <= 170;
      const t = (pr.beams ?? []).filter((b) => b.source === 'turret').find(near);
      return {
        shipX: Math.round(pr.shipWorld.x),
        muzzle: t ? { ox: Math.round(t.origin.x), oy: Math.round(t.origin.y), ex: Math.round(t.end.x), ey: Math.round(t.end.y), hit: t.hit ? { x: Math.round(t.hit.x), y: Math.round(t.hit.y) } : null } : null,
      };
    };

    // Slide phase: re-park the far-side attacker every frame and densely poll the
    // muzzle origin so we chart the slide (east mount → west rim). ~3 s covers the
    // ~180° glide (orbitSpeed 1.2 rad/s ⇒ π rad ≈ 2.6 s).
    const trail = [];
    for (let i = 0; i < 60; i++) {
      const s = await page.evaluate(readMuzzle, HOME_C);
      trail.push(s.muzzle);
      await page.waitForTimeout(50);
    }

    // Beam-catch burst IMMEDIATELY (before roaming bots drift into range and steal
    // the turret's pick): the muzzle is a 1-tick flash (~3 % of frames), so rapid-
    // fire clipped screenshots while re-parking. Tag frames where a home-turret
    // muzzle was present AND pointing WEST (ex < ox) — the far-side attacker — so
    // we can LOOK through them and copy the clearest clean-beam frame by hand.
    const burstDir = '/tmp/pwburst';
    mkdirSync(burstDir, { recursive: true });
    const vpB = page.viewportSize();
    const burst = [];
    const westRim = HOME_C.x - 88; // planet centre − (planetR+mount+turretR)
    for (let i = 0; i < 110; i++) {
      const st = await page.evaluate(readMuzzle, HOME_C);
      const m = st.muzzle;
      const west = m && m.ex < m.ox - 8 && m.ox <= HOME_C.x - 40; // firing outward from the west rim
      const psx = vpB.width / 2 + (HOME_C.x - st.shipX);
      // Tight crop: planet + west rim + the due-west attacker only, short in Y so
      // roaming bots firing north of the scene stay out of frame.
      await page.screenshot({
        path: join(burstDir, `f${String(i).padStart(2, '0')}${m ? (west ? '-WEST' : '-fire') : ''}.png`),
        clip: clampClip({ x: psx - 300, y: vpB.height / 2 - 150, width: 420, height: 300 }, vpB),
      });
      if (m) burst.push({ i, west, ...m });
      await page.waitForTimeout(15);
    }
    console.log('[turret-far-side] burst muzzles:', JSON.stringify(burst));

    // Settle proof: the tail of the slide trail — the muzzle origin should have
    // STOPPED moving (few distinct positions) on the west rim, not thrash.
    const settle = trail.filter(Boolean).slice(-12).map((m) => ({ ox: m.ox, oy: m.oy }));

    const firstOrigin = trail.filter(Boolean)[0] ?? null;
    const distinct = new Set(settle.map((p) => `${p.ox},${p.oy}`));
    const westBurst = burst.filter((b) => b.west);
    const summary = {
      home,
      planetCentreX: home.x + 90,
      westRimWorldX: westRim,
      firstMuzzleOrigin: firstOrigin ? { x: firstOrigin.ox, y: firstOrigin.oy } : null,
      settledMuzzleOrigin: settle.length ? settle[settle.length - 1] : null,
      settleSamples: settle.length,
      settleDistinctPositions: distinct.size,
      fireFramesInSlidePhase: trail.filter(Boolean).length,
      burstMuzzles: burst.length,
      burstWestMuzzles: westBurst.length,
      bestWestFrame: westBurst[0] ?? null,
    };
    console.log('[turret-far-side] summary:', JSON.stringify(summary));
    console.log('[turret-far-side] slide trail:', JSON.stringify(trail));
    console.log('[turret-far-side] settle tail:', JSON.stringify(settle));

    // The engage image IS the best burst frame where the home turret fired WEST
    // (outward from the west rim, at the far-side attacker) — copied straight from
    // /tmp, so the pixels are a real fire frame, not a fresh re-shoot that might
    // land on a non-fire tick. Fall back to the first muzzle frame, else a plain
    // tight crop of the settled scene.
    const pick = westBurst[0] ?? burst[0] ?? null;
    if (pick) {
      const tag = pick.west ? '-WEST' : '-fire';
      copyFileSync(join(burstDir, `f${String(pick.i).padStart(2, '0')}${tag}.png`), join(OUT, 'turret-far-side-engage.png'));
    }
    await page.screenshot({ path: join(OUT, 'turret-far-side-full.png') });
    if (!pick) {
      const vp = page.viewportSize();
      const st = await page.evaluate((hc) => ({ shipX: Math.round(window.__planetRush.shipWorld.x) }), HOME_C);
      const cropCx = vp.width / 2 + (home.x + 90 - st.shipX);
      await page.screenshot({
        path: join(OUT, 'turret-far-side-engage.png'),
        clip: clampClip({ x: cropCx - 300, y: vp.height / 2 - 150, width: 420, height: 300 }, vp),
      });
    }

    return { skipShot: true, facts: summary };
  },
};

const SHOTS = [ORE_HUD, TURRET_FAR_SIDE];

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
      const build = await page.evaluate(() => window.__planetRush?.build ?? null);
      console.log(JSON.stringify({ id: shot.id, url: shot.url, viewport: shot.device.viewport, build, errors }));
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
