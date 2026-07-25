/**
 * evidence/capture-round7.mjs — round-7 verification of THE FOUR MAPS and the
 * PLAY-screen picker on the LIVE preview build. OWNER: QA Manager.
 *
 * The developer ratified four arenas (map-layouts.html r2) with `octagon` the
 * default: octagon (A, square ring), compass (B, corners+edge-midpoints),
 * oval (C, wide equal-chord ellipse), diamond (D, wide outer+inner diamonds,
 * VETERAN). This script proves, with pixels:
 *
 *   map-picker  — a CLEAN boot (no ?debug, so the menu is reached) on an
 *                 emulated landscape phone: the PLAY screen with all four map
 *                 cards, `octagon` preselected, `diamond` wearing VETERAN.
 *
 *   map-octagon / map-compass / map-oval / map-diamond — one IN-MATCH wide
 *                 shot per map. The map is chosen the way the game chooses it:
 *                 the picker persists `planet-rush:mapId` to localStorage and
 *                 boot reads it back, so we seed that key (via addInitScript,
 *                 before the page's own scripts) and boot ?debug=1&freeze=1.
 *                 Freeze pins the sim at the seeded tick, giving a deterministic
 *                 static arena. The follow-camera keeps the LOCAL ship centred,
 *                 so we read shipWorld off __planetRush and project the arena's
 *                 fixed world geometry into screen space to crop the whole arena
 *                 wall-to-wall (the ring hugging the margin) and, tighter, two
 *                 ADJACENT home planets with their inboard asteroid fields side
 *                 by side (the p1-09 resource-fairness invariant, per map).
 *
 * The arena geometry below is the SAME math the shipped registry (src/sim/maps.ts)
 * uses — copied here so the crops land on the planets without reaching into the
 * sim. Each shot logs a self-check: the LOCAL planet we computed from the map
 * formula vs. the one implied by the live shipWorld (ship is inboard of its
 * planet by PLANET.orbitOffset along the spoke). They must agree, or the crop is
 * aimed at the wrong board and the attestation would be a lie.
 *
 * Every claim about a shot lives in evidence/manifest.json, written after LOOKING
 * at the PNG. This file only guarantees WHAT WAS ON SCREEN.
 *
 * Usage:  node evidence/capture-round7.mjs [shot-id ...]
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';

// --- Registry geometry (src/sim/constants.ts + maps.ts), fixed for the default
//     8-player match. Copied verbatim so the crops land on the real planets. ---
const PLANET_RADIUS = 64;
const WORLD_EDGE_MARGIN = 220;
const RING_FRACTION = 0.32;
const ORBIT_OFFSET = 96;
const SQUARE = { width: 2400, height: 2400 };
const WIDE = { width: 3200, height: 2000 };
const SLOTS = 8;

const centre = (b) => ({ x: b.width / 2, y: b.height / 2 });
const marginRadius = (b) => Math.min(b.width, b.height) / 2 - PLANET_RADIUS - WORLD_EDGE_MARGIN;

/** Polar homes → planet world positions (ship inboard by ORBIT_OFFSET). */
function fromPolar(b, homes) {
  const c = centre(b);
  return homes.map(({ r, angle }) => ({
    planet: { x: c.x + Math.cos(angle) * r, y: c.y + Math.sin(angle) * r },
    angle,
  }));
}

// The equal-chord ellipse solver, copied verbatim from src/sim/maps.ts so the
// oval crops match the shipped board bit-for-bit.
function ellipseEqualChord(a, b, count) {
  const t = Array.from({ length: count }, (_, i) => (2 * Math.PI * i) / count);
  const px = (u) => a * Math.cos(u);
  const py = (u) => b * Math.sin(u);
  const chord = (i) => {
    const j = (i + 1) % count;
    return Math.hypot(px(t[i]) - px(t[j]), py(t[i]) - py(t[j]));
  };
  const PASSES = 6000;
  const GAIN = 0.05;
  for (let pass = 0; pass < PASSES; pass++) {
    const c = t.map((_, i) => chord(i));
    const mean = c.reduce((s, x) => s + x, 0) / count;
    const next = t.slice();
    for (let i = 0; i < count; i++) {
      const cPrev = c[(i - 1 + count) % count];
      const cNext = c[i];
      next[i] = t[i] + (GAIN * (cNext - cPrev)) / mean;
    }
    for (let i = 0; i < count; i++) t[i] = next[i];
  }
  return t.slice();
}
const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

/** World positions of all 8 home planets for a map id, in slot order. */
function planetsFor(id) {
  if (id === 'octagon') {
    const b = SQUARE, c = centre(b);
    const ringRadius = (Math.min(b.width, b.height) / 2) * 2 * RING_FRACTION; // 768
    const planetRing = Math.min(ringRadius + ORBIT_OFFSET, marginRadius(b)); // 864
    return { bounds: b, planets: Array.from({ length: SLOTS }, (_, i) => {
      const theta = (2 * Math.PI * i) / SLOTS;
      return { planet: { x: c.x + Math.cos(theta) * planetRing, y: c.y + Math.sin(theta) * planetRing }, angle: theta };
    }) };
  }
  if (id === 'compass') {
    const b = SQUARE;
    const rc = marginRadius(b), re = rc / Math.SQRT2;
    const homes = Array.from({ length: SLOTS }, (_, i) => ({ r: i % 2 === 0 ? re : rc, angle: (i * Math.PI) / 4 }));
    return { bounds: b, planets: fromPolar(b, homes) };
  }
  if (id === 'oval') {
    const b = WIDE;
    const a = b.width / 2 - WORLD_EDGE_MARGIN - PLANET_RADIUS;
    const bb = b.height / 2 - WORLD_EDGE_MARGIN - PLANET_RADIUS;
    const ts = ellipseEqualChord(a, bb, SLOTS);
    const homes = ts.map((t) => {
      const x = a * Math.cos(t), y = bb * Math.sin(t);
      return { r: Math.hypot(x, y), angle: Math.atan2(y, x) };
    });
    homes.sort((p, q) => norm(p.angle) - norm(q.angle));
    return { bounds: b, planets: fromPolar(b, homes) };
  }
  if (id === 'diamond') {
    const b = WIDE;
    const rOut = marginRadius(b), rIn = rOut * 0.65;
    const homes = [];
    for (let k = 0; k < 4; k++) {
      homes.push({ r: rOut, angle: -Math.PI / 2 + (k * Math.PI) / 2 }); // outer (even)
      homes.push({ r: rIn, angle: -Math.PI / 4 + (k * Math.PI) / 2 }); // inner (odd)
    }
    return { bounds: b, planets: fromPolar(b, homes) };
  }
  throw new Error('unknown map ' + id);
}

/** Project a world point to screen (CSS px), camera centred on the live ship. */
const toScreen = (w, ship, vp) => ({ x: vp.w / 2 + (w.x - ship.x), y: vp.h / 2 + (w.y - ship.y) });

async function readDebug(page) {
  await page.waitForFunction(() => window.__planetRush?.viewport?.w > 0, undefined, { timeout: 25_000 });
  return page.evaluate(() => ({
    shipWorld: { x: window.__planetRush.shipWorld.x, y: window.__planetRush.shipWorld.y },
    vp: { w: window.__planetRush.viewport.w, h: window.__planetRush.viewport.h },
    ticks: window.__planetRush.ticks,
    build: window.__planetRush.build,
    frozen: window.__planetRush.frozen ?? null,
  }));
}

/** Clamp a clip rect to the viewport so Playwright never throws on an off-canvas box. */
function clampClip(clip, vp) {
  const x = Math.max(0, Math.min(clip.x, vp.w - 1));
  const y = Math.max(0, Math.min(clip.y, vp.h - 1));
  return { x: Math.round(x), y: Math.round(y), width: Math.round(Math.min(clip.width, vp.w - x)), height: Math.round(Math.min(clip.height, vp.h - y)) };
}

/** Build one in-match map shot: pick a viewport that contains the whole arena
 *  (ship-centred, so sized to the farther wall on each axis), boot the map,
 *  crop the arena and a two-planet field detail. */
// The home-field band centre, as a fraction of the reference ring radius:
// mean(homeInnerFraction, homeOuterFraction) = mean(0.44, 0.47) ≈ 0.455 (src/sim/
// constants.ts). On a single-ring map (octagon) rocks sit at FIELD_FRAC·refR from
// the CENTRE on each spoke; on a varying-radius map they sit (1 − FIELD_FRAC)·refR
// INBOARD of each planet (src/sim/waves.ts stampRock / stampRockLocal, refR = the
// smallest planet radius). Used only to AIM the field-detail crop.
const FIELD_FRAC = 0.455;

function mapShot(id) {
  const { bounds, planets } = planetsFor(id);
  const c = centre(bounds);
  // Single-ring (octagon) stamps fields at FIELD_BAND_R from the CENTRE on each
  // spoke; varying-radius maps stamp them (refR − FIELD_BAND_R) INBOARD of each
  // planet, refR = the smallest planet radius (src/sim/waves.ts spawnHomeFields).
  const radii = planets.map((p) => Math.hypot(p.planet.x - c.x, p.planet.y - c.y));
  const singleRing = radii.every((r) => Math.abs(r - radii[0]) <= 1e-6);
  const refR = Math.min(...radii);
  /** World position of planet i's home-field cluster centre. */
  const fieldWorld = (i) => {
    const p = planets[i].planet;
    if (singleRing) return { x: c.x + Math.cos(planets[i].angle) * (FIELD_FRAC * refR), y: c.y + Math.sin(planets[i].angle) * (FIELD_FRAC * refR) };
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    const inboard = ((1 - FIELD_FRAC) * refR) / d; // spoke fraction inboard, toward centre
    return { x: p.x + (c.x - p.x) * inboard, y: p.y + (c.y - p.y) * inboard };
  };
  // Local ship (slot 0) inboard of planet 0 — used only to size the viewport so
  // the whole arena is guaranteed on-canvas; the true ship world is read live.
  const p0 = planets[0].planet;
  const shipR0 = Math.hypot(p0.x - c.x, p0.y - c.y) - ORBIT_OFFSET;
  const ang0 = Math.atan2(p0.y - c.y, p0.x - c.x);
  const ship0 = { x: c.x + Math.cos(ang0) * shipR0, y: c.y + Math.sin(ang0) * shipR0 };
  // Ship at viewport centre ⇒ need half-width ≥ the farther wall on each axis.
  const halfW = Math.max(ship0.x, bounds.width - ship0.x) + 140;
  const halfH = Math.max(ship0.y, bounds.height - ship0.y) + 140;
  const vpW = Math.ceil(halfW * 2), vpH = Math.ceil(halfH * 2);

  return {
    id: `map-${id}`,
    mapId: id,
    device: { viewport: { width: vpW, height: vpH }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    url: '/?debug=1&freeze=1',
    async run(page) {
      const dbg = await readDebug(page);
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(500);
      const vp = dbg.vp;

      // Self-check: the LOCAL planet from the live ship must match a registry planet.
      const shipR = Math.hypot(dbg.shipWorld.x - c.x, dbg.shipWorld.y - c.y);
      const shipAng = Math.atan2(dbg.shipWorld.y - c.y, dbg.shipWorld.x - c.x);
      const liveLocalPlanet = { x: c.x + Math.cos(shipAng) * (shipR + ORBIT_OFFSET), y: c.y + Math.sin(shipAng) * (shipR + ORBIT_OFFSET) };
      const nearest = planets.map((p) => Math.hypot(p.planet.x - liveLocalPlanet.x, p.planet.y - liveLocalPlanet.y)).reduce((a, b) => Math.min(a, b));
      console.log(`[${id}] self-check localPlanet=`, JSON.stringify(liveLocalPlanet), 'nearest-registry-dist=', nearest.toFixed(1), 'vp=', JSON.stringify(vp), 'ship=', JSON.stringify(dbg.shipWorld), 'build=', JSON.stringify(dbg.build), 'frozen=', dbg.frozen);

      const centerScreen = toScreen(c, dbg.shipWorld, vp);
      const planetsScreen = planets.map((p, i) => ({ i, ...toScreen(p.planet, dbg.shipWorld, vp) }));
      console.log(`[${id}] center=`, JSON.stringify(centerScreen), 'planets=', JSON.stringify(planetsScreen.map((p) => ({ i: p.i, x: Math.round(p.x), y: Math.round(p.y) }))));

      // Full frame (context source).
      await page.screenshot({ path: join(OUT, `map-${id}-full.png`) });

      // (a) Whole arena, wall to wall — the ring hugging the margin.
      const arenaClip = clampClip({
        x: centerScreen.x - bounds.width / 2 - 90,
        y: centerScreen.y - bounds.height / 2 - 90,
        width: bounds.width + 180,
        height: bounds.height + 180,
      }, vp);
      await page.screenshot({ path: join(OUT, `map-${id}.png`), clip: arenaClip });
      console.log(`[${id}] arena clip`, JSON.stringify(arenaClip));

      // (b) Two ADJACENT home planets + their inboard fields, side by side.
      //     Field of a planet sits ~halfway toward centre; bound both planets and
      //     both field points, pad generously, so the two 3-rock patterns are
      //     visible together for the identical-by-construction attestation.
      const a = planetsScreen[0], b = planetsScreen[1];
      const fa = toScreen(fieldWorld(0), dbg.shipWorld, vp);
      const fb = toScreen(fieldWorld(1), dbg.shipWorld, vp);
      console.log(`[${id}] fieldWorld 0=`, JSON.stringify(fieldWorld(0)), '1=', JSON.stringify(fieldWorld(1)));
      // On octagon the fields ring the CENTRE far inboard of their planets, so the
      // p1-09 invariant reads best as the whole symmetric field ring: crop centred
      // on the arena centre out to just past the field band, where the N home
      // clusters sit in exact N-fold rotational symmetry (each a rotated copy).
      // On the varying-radius maps the field hugs its planet, so bound both
      // planets and both fields together to show two neighbourhoods side by side.
      let detailClip;
      if (singleRing) {
        const R = FIELD_FRAC * refR + 130; // field band + margin
        detailClip = clampClip({ x: centerScreen.x - R, y: centerScreen.y - R, width: 2 * R, height: 2 * R }, vp);
      } else {
        // Pick the HIGHEST adjacent planet pair (smallest max screen-y) so the
        // detail sits above the bottom-anchored first-match onboarding banner,
        // which otherwise clips a field. Any two planets prove the invariant.
        let best = { i: 0, j: 1, maxY: Infinity };
        for (let i = 0; i < SLOTS; i++) {
          const j = (i + 1) % SLOTS;
          const fi = toScreen(fieldWorld(i), dbg.shipWorld, vp);
          const fj = toScreen(fieldWorld(j), dbg.shipWorld, vp);
          const maxY = Math.max(planetsScreen[i].y, planetsScreen[j].y, fi.y, fj.y);
          if (maxY < best.maxY) best = { i, j, maxY, fi, fj };
        }
        const pi = planetsScreen[best.i], pj = planetsScreen[best.j];
        const pts = [pi, pj, best.fi, best.fj];
        const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
        const PAD = 150;
        detailClip = clampClip({
          x: Math.min(...xs) - PAD,
          y: Math.min(...ys) - PAD,
          width: Math.max(...xs) - Math.min(...xs) + 2 * PAD,
          height: Math.max(...ys) - Math.min(...ys) + 2 * PAD,
        }, vp);
        console.log(`[${id}] field pair planets ${best.i}&${best.j}`);
      }
      await page.screenshot({ path: join(OUT, `map-${id}-fields.png`), clip: detailClip });
      console.log(`[${id}] fields clip`, JSON.stringify(detailClip), 'planets 0&1');

      return { skipShot: true };
    },
  };
}

const SHOTS = [
  {
    // The PLAY screen with the picker — a CLEAN boot (no ?debug) so the menu is
    // reached; emulated landscape phone. octagon preselected, diamond VETERAN.
    id: 'map-picker',
    mapId: null,
    device: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    url: '/',
    async run(page) {
      await page.waitForTimeout(1600);
      await page.evaluate(() => document.fonts?.ready).catch(() => {});
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(OUT, 'map-picker.png') });
      return { skipShot: true };
    },
  },
  mapShot('octagon'),
  mapShot('compass'),
  mapShot('oval'),
  mapShot('diamond'),
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const only = process.argv.slice(2);
  const shots = only.length ? SHOTS.filter((s) => only.includes(s.id) || only.includes(s.mapId)) : SHOTS;
  if (!shots.length) throw new Error(`no shots matched: ${only.join(', ')}`);

  const browser = await chromium.launch();
  try {
    for (const shot of shots) {
      const context = await browser.newContext(shot.device);
      if (shot.mapId) await context.addInitScript((m) => { try { localStorage.setItem('planet-rush:mapId', m); } catch { /* ignore */ } }, shot.mapId);
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
