/**
 * evidence/a1-08-parallax/measure-flight.mjs — a1-08, the instrument. OWNER: QA Manager.
 *
 * a1-05 filed `a1-05-sky-parallax-not-camera-locked` **inconclusive** for one
 * stated reason: it flew an arena with no sky, so it could only ever watch the
 * STARS move. This flies an arena that HAS one, and watches the sky itself.
 *
 * ── Why the first attempt could not do this by differencing whole frames ────
 * A frame contains the ground, three star layers, the sky, and a live world, all
 * moving at DIFFERENT rates (0, 0.10, 0.26, 0.50, 0.085, 1.0). Cross-correlating
 * two such frames returns whichever layer owns the most contrast — a1-05 got
 * 0.259 of camera travel, which is the MID star layer's 0.26, not the sky's.
 * So the sky has to be isolated before it can be measured.
 *
 * ── The isolation (a1-07's instrument, re-pointed) ──────────────────────────
 * a1-07 established that the live Pixi scene graph can be reached read-only
 * through pixi.js 8.6.6's own devtools hook — `globalThis.__PIXI_APP_INIT__`,
 * called from `ApplicationInitHook.init` with the Application as `this` — claimed
 * from a Playwright init-script before any page script runs. NOTHING IN `src/`
 * IS TOUCHED, here or there.
 *
 * a1-07 isolated a layer by hiding it and differencing two frozen frames. A
 * flight cannot be frozen (freeze pins the ship, so the camera never moves), so
 * this goes one better and isolates by SUBTRACTION OF EVERYTHING ELSE: at each
 * camera stop it hides every sibling of the void container (world, HUD, badge)
 * and every void layer but one, so the screenshot IS that single layer, alone,
 * over black. No differencing, nothing mixed in, nothing to attribute.
 *
 * ── What each stop records ──────────────────────────────────────────────────
 *   all      the player's frame, build badge in shot (context, not measurement)
 *   ground   `void-ground`   — parallax 0. THE NULL CONTROL, twice over:
 *            it is what "glued to the camera" actually measures as (0 px), and
 *            if any live element leaked past the hiding it cannot come back
 *            byte-identical between two camera positions.
 *   nebula   `void-nebula-*` — the subject.
 *   deep     `void-stars-deep` — 0.10, the layer the sky must travel with.
 *   mid      `void-stars-mid`  — 0.26   (what a1-05 actually measured)
 *   near     `void-stars-near` — 0.50
 *
 * Alongside every stop it reads each layer's live `position` and the world
 * container's position — which IS the camera offset (`Renderer.centerCamera`
 * writes `worldRoot.x = offset.x`). The camera is 1:1 and Pixi `autoDensity`
 * puts the stage in CSS px, so ONE WORLD UNIT IS ONE CSS PIXEL and the frames
 * are shot at deviceScaleFactor 1 — image px = CSS px = world units, no
 * conversion anywhere. (a1-05 reported "219 px" against 844 u without saying
 * which; that ambiguity is not repeated here.)
 *
 * The pixel measurement (measure-drift.mjs) and this readback are INDEPENDENT:
 * one is what the transform says, the other is where the ink actually landed.
 *
 *   node evidence/a1-08-parallax/measure-flight.mjs [port] [mapId] [outName]
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'frames');
const PORT = process.argv[2] ?? '4291';
const MAP = process.argv[3] ?? 'line';
const NAME = process.argv[4] ?? MAP;
const BASE = `http://127.0.0.1:${PORT}`;

/** One screen-width, the unit the a0-07b table is written in (backdrop.ts:205). */
const SCREEN_WIDTH_U = 844;
/** Four camera stops: 0, ½, 1 and 1½ screen-widths. Several baselines, because
 *  a1-07's compass attempt showed a single short one is not enough to trust. */
const MARKS = [0, SCREEN_WIDTH_U / 2, SCREEN_WIDTH_U, SCREEN_WIDTH_U * 1.5];

const LAYERS = [
  { tag: 'ground', match: 'void-ground', parallax: 0.0, note: 'null control — camera-locked' },
  { tag: 'nebula', match: 'void-nebula-', parallax: null, note: 'the subject' },
  { tag: 'deep', match: 'void-stars-deep', parallax: 0.1, note: 'the layer the sky must travel with' },
  { tag: 'mid', match: 'void-stars-mid', parallax: 0.26, note: 'what a1-05 measured' },
  { tag: 'near', match: 'void-stars-near', parallax: 0.5, note: '' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Settle by counting frames, not by timing them (a0-07b, via a1-07). */
const settle = (page, n = 8) =>
  page.evaluate(
    (frames) =>
      new Promise((done) => {
        let i = 0;
        const tick = () => (++i < frames ? requestAnimationFrame(tick) : done());
        requestAnimationFrame(tick);
      }),
    n,
  );

// ── in-page helpers (serialised into the browser) ───────────────────────────

/** Locate the void container and remember the chain of ancestors, so the
 *  isolation knows exactly which nodes are "everything else". */
const LOCATE = `
  (() => {
    const app = globalThis.__qaApp;
    if (!app || !app.stage) return null;
    let hit = null;
    const walk = (node, chain, depth) => {
      if (hit || depth > 24) return;
      const kids = node.children || [];
      if (kids.some((c) => c.label === 'void-ground')) { hit = { node, chain }; return; }
      for (const c of kids) walk(c, chain.concat([node]), depth + 1);
    };
    walk(app.stage, [], 0);
    return hit;
  })()
`;

/** Read the live transform of every void layer, plus the camera offset. */
const READ_STATE = () => {
  const app = globalThis.__qaApp;
  let hit = null;
  const walk = (node, chain, depth) => {
    if (hit || depth > 24) return;
    const kids = node.children || [];
    if (kids.some((c) => c.label === 'void-ground')) {
      hit = { node, chain };
      return;
    }
    for (const c of kids) walk(c, chain.concat([node]), depth + 1);
  };
  walk(app.stage, [], 0);
  if (!hit) return { error: 'void container not found' };
  const voidRoot = hit.node;
  // The world container is the void's sibling that carries the camera offset:
  // Renderer.centerCamera writes worldRoot.x/y = the offset it just computed.
  const parent = voidRoot.parent;
  const sibs = (parent?.children || []).filter((c) => c !== voidRoot);
  const world = sibs.find((c) => (c.children || []).some((k) => k.label === 'boundary')) || null;
  const pr = globalThis.__planetRush;
  return {
    layers: voidRoot.children.map((c) => ({
      label: typeof c.label === 'string' ? c.label : null,
      visible: c.visible !== false,
      x: c.position?.x ?? null,
      y: c.position?.y ?? null,
      alpha: c.alpha,
      blendMode: c.blendMode ?? null,
    })),
    camera: world ? { x: world.position.x, y: world.position.y, label: world.label ?? null } : null,
    shipWorld: pr?.shipWorld ?? null,
    shipScreen: pr?.shipScreen ?? null,
    viewport: pr?.viewport ? { w: pr.viewport.w, h: pr.viewport.h } : null,
    ticks: pr?.ticks ?? null,
    fps: pr?.fps ?? null,
    build: pr?.build ?? null,
  };
};

/** Show ONLY the void layer whose label starts with `match`; hide every sibling
 *  of the void container and every ancestor's other children, all the way up.
 *  `match === '*'` restores the whole stage to fully visible. */
const ISOLATE = (match) => {
  const app = globalThis.__qaApp;
  let hit = null;
  const walk = (node, chain, depth) => {
    if (hit || depth > 24) return;
    const kids = node.children || [];
    if (kids.some((c) => c.label === 'void-ground')) {
      hit = { node, chain };
      return;
    }
    for (const c of kids) walk(c, chain.concat([node]), depth + 1);
  };
  walk(app.stage, [], 0);
  if (!hit) return { error: 'void container not found' };

  const restore = globalThis.__qaRestore || (globalThis.__qaRestore = new Map());
  const set = (node, v) => {
    if (!restore.has(node)) restore.set(node, node.visible);
    node.visible = v;
  };

  if (match === '*') {
    for (const [node, v] of restore) node.visible = v;
    restore.clear();
    return { restored: true };
  }

  // Everything outside the void container's ancestry: off.
  const onPath = new Set([...hit.chain, hit.node]);
  const hidden = [];
  for (const anc of hit.chain) {
    for (const c of anc.children || []) {
      if (!onPath.has(c) && c.visible) {
        set(c, false);
        hidden.push(c.label || c.constructor?.name || '?');
      }
    }
  }
  // Inside it: exactly one layer on.
  const shown = [];
  for (const c of hit.node.children) {
    const l = typeof c.label === 'string' ? c.label : '';
    const on = l.startsWith(match);
    set(c, on);
    if (on) shown.push(l);
  }
  return { hidden, shown };
};

// ── the run ────────────────────────────────────────────────────────────────

mkdirSync(OUT, { recursive: true });

const served = await (await fetch(`${BASE}/version.json`)).json();
console.log(`served ${BASE}/version.json = ${JSON.stringify(served)}   map=${MAP}\n`);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1, // image px = CSS px = world units. No conversion, anywhere.
});
await ctx.addInitScript(`
  try { localStorage.setItem('planet-rush:mapId', ${JSON.stringify(MAP)}); } catch (e) {}
  globalThis.__PIXI_APP_INIT__ = function (app) { globalThis.__qaApp = app; };
`);
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => {
  pageErrors.push(e.message);
  console.log('   [page error]', e.message);
});

await page.goto(`${BASE}/?debug=1`, { waitUntil: 'load' });
await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
await page.waitForFunction(() => !!window.__planetRush?.shipWorld, undefined, { timeout: 30_000 });
await page.evaluate(() => document.fonts?.ready);
await sleep(1500);
await settle(page, 20);

const located = await page.evaluate(LOCATE);
if (!located) throw new Error('the Pixi devtools hook did not fire — no live stage to read');

const shipX = () => page.evaluate(() => window.__planetRush.shipWorld.x);
const x0 = await shipX();
// Heading is an argument, because the room available differs per arena: on
// `line` the local home sits at x≈683 with the far wall at x≈2613, so east has
// the room; on `compass` the ship starts at x≈1772 with the wall at x≈2384 and
// east runs out after ~600 u — which pins the ship and turns three camera
// positions into two (a1-07 hit exactly this and said so).
const dir = (process.argv[5] ?? 'east') === 'west' ? -1 : +1;
console.log(`ship starts at x=${x0.toFixed(1)}; flying ${dir > 0 ? 'east' : 'west'} to marks ${MARKS.join(', ')} u\n`);

/** Fly until `flown` world units have been covered, then come to a full stop.
 *  The stop matters: a coasting ship moves the camera BETWEEN the readback and
 *  the shutter, and every px of that is error in the answer. */
async function flyTo(flown) {
  if (flown > 0) {
    const key = dir > 0 ? 'KeyD' : 'KeyA';
    const deadline = Date.now() + 40_000;
    await page.keyboard.down(key);
    let x = await shipX();
    while ((x - x0) * dir < flown && Date.now() < deadline) {
      await sleep(60);
      x = await shipX();
    }
    await page.keyboard.up(key);
  }
  // Rest: five consecutive polls that do not move the ship more than 0.05 u.
  const deadline = Date.now() + 15_000;
  let still = 0;
  let last = await shipX();
  while (still < 5 && Date.now() < deadline) {
    await sleep(120);
    const now = await shipX();
    still = Math.abs(now - last) < 0.05 ? still + 1 : 0;
    last = now;
  }
  await settle(page, 6);
  return { rested: still >= 5 };
}

const report = {
  brief: 'a1-08',
  base: BASE,
  served,
  map: MAP,
  capturedAt: new Date().toISOString(),
  viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
  note: 'deviceScaleFactor 1 on purpose: image px = CSS px = world units, so every number below is in one unit.',
  screenWidthU: SCREEN_WIDTH_U,
  marks: MARKS,
  layers: LAYERS,
  stops: [],
  pageErrors,
};

for (let i = 0; i < MARKS.length; i++) {
  const target = MARKS[i];
  console.log(`── stop ${i} — target ${target} u`);
  const { rested } = await flyTo(target);

  const before = await page.evaluate(READ_STATE);

  // LIVENESS GUARD. A match can end under the harness's feet — on the first
  // compass attempt the ship was destroyed mid-flight and the ELIMINATED
  // summary replaced the arena, so two "camera positions" were really two
  // screenshots of a menu. `shipWorld` keeps reporting the last value, so the
  // flight looks rested and nothing else gives it away. The void container
  // going missing does. Stop the run rather than file a frame of a menu as a
  // measurement of the sky.
  if (before.error || !before.layers?.length) {
    console.log(`   *** the void container is gone — the match ended. Stopping after ${i} stop(s).`);
    report.abortedAt = { index: i, reason: 'no void container on the stage — the match ended mid-flight' };
    await page.screenshot({ path: join(OUT, `${NAME}-aborted-stop${i}.png`) });
    break;
  }

  // PINNED GUARD. A ship held against the arena wall gives a camera position
  // identical to the last one — three stops that are really two (a1-07). Flag
  // it here so nothing downstream can count it as an independent baseline.
  const prev = report.stops[report.stops.length - 1];
  const pinned = prev && Math.abs(before.camera.x - prev.before.camera.x) < 1;
  if (pinned) console.log(`   *** camera did not move since stop ${prev.index} — ship is pinned. Not an independent baseline.`);

  const stop = {
    index: i,
    targetU: target,
    rested,
    pinned: !!pinned,
    pinnedAgainst: pinned ? prev.index : null,
    before,
    frames: {},
    isolation: {},
  };

  // The player's frame first, with the build badge in shot — context, not a
  // measurement: it is what a person actually sees at this camera position.
  await page.evaluate(ISOLATE, '*');
  await settle(page, 6);
  {
    const f = `${NAME}-stop${i}-all.png`;
    await page.screenshot({ path: join(OUT, f) });
    stop.frames.all = f;
  }

  for (const L of LAYERS) {
    const iso = await page.evaluate(ISOLATE, L.match);
    await settle(page, 6);
    // Read back what is ACTUALLY visible at shutter time — a container the
    // renderer re-shows every frame would silently poison the isolation.
    const at = await page.evaluate(READ_STATE);
    stop.isolation[L.tag] = {
      shown: iso.shown,
      hiddenCount: iso.hidden?.length ?? 0,
      visibleVoidLayers: at.layers.filter((l) => l.visible).map((l) => l.label),
    };
    const f = `${NAME}-stop${i}-${L.tag}.png`;
    await page.screenshot({ path: join(OUT, f) });
    stop.frames[L.tag] = f;
    await page.evaluate(ISOLATE, '*');
  }

  await page.evaluate(ISOLATE, '*');
  await settle(page, 4);
  const after = await page.evaluate(READ_STATE);
  stop.after = after;

  // The same liveness guard again, AFTER the shutter. The first compass re-fly
  // died in exactly this gap: the readback found a healthy stage, then the
  // reactor was destroyed while the six frames were being taken, so every
  // "isolated layer" is a screenshot of the ELIMINATED summary. The tell is
  // that all five then score identically — but the harness should not need the
  // measuring script to notice its own frames are worthless.
  if (after.error || !after.layers?.length) {
    console.log(`   *** the match ended DURING the shots — stop ${i}'s frames are of the summary screen, not the void.`);
    stop.invalid = true;
    stop.invalidReason = 'the match ended between the readback and the shutter; these frames are not the void';
    report.abortedAt = { index: i, reason: stop.invalidReason };
    report.stops.push(stop);
    break;
  }
  // The drift guard: if the camera moved while the six frames were being taken,
  // the frames are not all of one camera position and the stop is not usable.
  stop.cameraDriftDuringShots = before.camera &&
    after.camera && {
      dx: +(after.camera.x - before.camera.x).toFixed(3),
      dy: +(after.camera.y - before.camera.y).toFixed(3),
    };

  console.log(
    `   ship x=${before.shipWorld.x.toFixed(1)} y=${before.shipWorld.y.toFixed(1)}  ` +
      `flown=${(before.shipWorld.x - x0).toFixed(1)} u  rested=${rested}  ` +
      `camera=(${before.camera.x.toFixed(2)}, ${before.camera.y.toFixed(2)})  ` +
      `drift during shots=(${stop.cameraDriftDuringShots.dx}, ${stop.cameraDriftDuringShots.dy})`,
  );
  console.log(`   layers: ${before.layers.map((l) => `${l.label}@${l.x.toFixed(2)}`).join('  ')}`);
  report.stops.push(stop);
}

report.x0 = x0;
report.direction = dir > 0 ? 'east' : 'west';
writeFileSync(join(OUT, `${NAME}-flight.json`), `${JSON.stringify(report, null, 2)}\n`);
await browser.close();

// ── the readback arithmetic, in the open ───────────────────────────────────
console.log('\n── what the live transforms say (scene graph, not pixels) ──────────');
const s0 = report.stops[0];
for (const stop of report.stops.slice(1)) {
  const dCam = stop.before.camera.x - s0.before.camera.x;
  const flown = stop.before.shipWorld.x - s0.before.shipWorld.x;
  console.log(`\n  stop 0 → stop ${stop.index}:  ship flew ${flown.toFixed(1)} u,  camera offset moved ${dCam.toFixed(2)} px`);
  for (const L of LAYERS) {
    const a = s0.before.layers.find((l) => (l.label || '').startsWith(L.match));
    const b = stop.before.layers.find((l) => (l.label || '').startsWith(L.match));
    if (!a || !b) continue;
    const d = b.x - a.x;
    const f = dCam === 0 ? NaN : d / dCam;
    console.log(
      `    ${(a.label || '').padEnd(24)} moved ${d.toFixed(2).padStart(8)} px   ` +
        `= ${f.toFixed(4)} × camera   (declared ${L.parallax ?? '?'})`,
    );
  }
}
console.log(`\nwrote ${OUT}/${NAME}-flight.json`);
