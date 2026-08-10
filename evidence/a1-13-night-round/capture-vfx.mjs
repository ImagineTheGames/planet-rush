/**
 * evidence/a1-13-night-round/capture-vfx.mjs — the effects are DRAWN, on the
 * SERVED build. OWNER: QA Manager (a1-13 §1; a2-07 / #371).
 *
 * a2-07 proved the effect set on its own stage. This asks the narrower and harder
 * question: does the bundle at `https://imaginethegames.github.io/planet-rush/` —
 * sha established by `./verify-served-source.mjs` before a shutter fired — put
 * marks on the screen when the simulation does something.
 *
 * NOT `?freeze=1`. Frozen stages `stageVfxShowcase` (src/main.ts ~2268), which is
 * a2-07's own review sheet and is exactly what this round may not rest on. Live
 * match, `?debug=1`.
 *
 * WHAT IS STAGED AND WHAT IS NOT. Two seams push the SIM: `__endScreenStage
 * .killLocalShip()` (the sim's own `killShip`, the path a fatal hit takes) and
 * `__oreHudStage.mine(n)` (ore into the local hold, which is what tractor
 * collection does). Nothing here draws a particle, names an emitter, or touches
 * the VFX field. Every mark photographed got on screen because the shipped client
 * noticed a sim delta — the wire that was dead for six milestones.
 *
 * ── TWO SHUTTERS WERE TRIED AND FAILED BEFORE THIS ONE. WORTH THE WORDS. ──
 *
 * 1. `page.screenshot()` in a loop. On this box (SwiftShader, no GPU) one costs
 *    ~1.1 s. The earliest frame it could take landed 1169 ms after the kill, by
 *    which time the burst was over and the RESPAWNING banner was over the wreck.
 *    The tally said `shipExplode: 2` and the picture showed no explosion — the
 *    exact shape of evidence that cannot be checked from its own image. An effect
 *    that lasts under a second cannot be photographed by a shutter slower than a
 *    second.
 *
 * 2. CDP `Page.startScreencast`. Faster (~4 frames/s) and still not enough, and
 *    worse, ITS CLOCK DID NOT AGREE WITH THE PAGE'S. The in-page tally moved 79 ms
 *    after the kill was staged, while screencast frames stamped 248, 475 and
 *    721 ms still showed the ship alive and intact. Two instruments disagreeing
 *    about when a thing happened cannot jointly prove that it happened; a frame is
 *    only evidence for a counter if the two are on one clock.
 *
 * ── THE SHUTTER THIS FILE USES, AND ITS ONE DISCLOSED INTERVENTION ────────
 *
 * Frames are taken INSIDE the page, in the same `requestAnimationFrame` callback
 * that reads the tally, so the picture and the number are the same instant by
 * construction. Each frame is one `drawImage` of the live game canvas into a ring
 * of 2D canvases — a copy, cheap enough to run every frame — and they are encoded
 * to PNG afterwards, at leisure, once the event is over.
 *
 * THE INTERVENTION, STATED PLAINLY: an init script patches
 * `HTMLCanvasElement.prototype.getContext` to force `preserveDrawingBuffer: true`
 * on the WebGL context. Without it the drawing buffer is cleared after compositing
 * and `drawImage` yields black. This changes whether the buffer is KEPT after it
 * has been drawn; it does not change what is drawn into it, which emitter runs, or
 * whether the layer is on the stage. It is the only modification this round makes
 * to the served page, and every image in the VFX item was taken through it.
 *
 * ── AND WHY ATTRIBUTION IS RECORDED AT ALL ───────────────────────────────
 * On a live board eight ships are dying and mining, so "the counter went up" is a
 * claim about the match, not about the staged event. The recorder keeps the exact
 * sample at which each kind's tally FIRST moves together with `drawnBy` at that
 * instant, so the burst is attributed to the local seat rather than to the board.
 *
 *   node evidence/a1-13-night-round/capture-vfx.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGES = resolve(HERE, '..', 'images');
const BASE = process.env.A1_13_BASE_URL ?? 'https://imaginethegames.github.io/planet-rush/';

const VIEW = { width: 1280, height: 800 };
/** The follow-camera keeps the local ship at the visible centre, so a crop about
 *  the centre is a crop about the ship — by construction, not by luck. */
const CROP = { w: 600, h: 440 };
/** The magnified inset: this much of the crop's centre, at 2x nearest-neighbour,
 *  because a 27-particle burst on a 600 px plate is small and the round is
 *  supposed to be checkable from its own image. */
const ZOOM = { w: 260, h: 200, scale: 2 };
/** Frames kept per event: a few before the trigger, the rest after. */
const RING = 40;
const LOCAL_PLAYER = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(IMAGES, { recursive: true });

const out = { base: BASE, capturedAt: new Date().toISOString(), view: VIEW, crop: CROP, errors: [] };

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });

// THE ONE INTERVENTION — see the header. Keeps the drawn buffer readable; does
// not touch what is drawn into it.
await context.addInitScript(() => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
      return orig.call(this, type, { ...(attrs ?? {}), preserveDrawingBuffer: true });
    }
    return orig.call(this, type, attrs);
  };
});

const page = await context.newPage();
page.on('pageerror', (e) => out.errors.push({ kind: 'pageerror', message: e.message }));
page.on('console', (m) => {
  if (m.type() === 'error') out.errors.push({ kind: 'console.error', message: m.text() });
});

const readVfx = () => page.evaluate(() => window.__vfxStage?.read() ?? null);

await page.goto(`${BASE}?debug=1`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
await page.waitForFunction(() => window.__planetRush?.build?.sha, undefined, { timeout: 90_000 });
out.build = await page.evaluate(() => ({ ...window.__planetRush.build }));

// The wire itself: `attached` was false for the whole life of the bug this
// milestone closes. A layer that exists but hangs off nothing draws exactly as
// much as one that was never constructed.
await page.waitForFunction(() => window.__vfxStage !== undefined, undefined, { timeout: 90_000 });
out.atBoot = await readVfx();

// ---------------------------------------------------------------------------
// The in-page recorder: one rAF, one tally read, one frame copy.
// ---------------------------------------------------------------------------
await page.evaluate(
  ({ crop, ring, kinds, local }) => {
    const w = window;
    const canvases = Array.from(document.querySelectorAll('canvas'));
    const game = canvases.sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const buf = Array.from({ length: ring }, () => {
      const c = document.createElement('canvas');
      c.width = crop.w;
      c.height = crop.h;
      return { c, ctx: c.getContext('2d'), meta: null };
    });

    const rec = {
      i: 0,
      armed: null, // kind we are waiting to move
      trigger: null, // the sample at which it moved
      stopAt: 0, // ring index to stop at, once triggered
      running: false,
      first: {},
      canvas: { w: game.width, h: game.height, cssW: game.clientWidth, cssH: game.clientHeight },
    };
    w.__a1_13 = rec;

    const tick = () => {
      requestAnimationFrame(tick);
      if (!rec.running) return;
      const r = w.__vfxStage?.read();
      if (!r) return;
      const slot = buf[rec.i % ring];
      // The crop is centred on the CANVAS centre; the follow-camera keeps the
      // local ship there. Source is the backing store, so scale by dpr.
      const sx = game.width / 2 - crop.w / 2;
      const sy = game.height / 2 - crop.h / 2;
      slot.ctx.clearRect(0, 0, crop.w, crop.h);
      slot.ctx.drawImage(game, sx, sy, crop.w, crop.h, 0, 0, crop.w, crop.h);
      const meta = { t: Date.now(), seq: rec.i, particles: r.particles, sprites: r.sprites };
      for (const k of kinds) {
        meta[k] = r.drawn[k];
        meta[`${k}By`] = r.drawnBy[k];
      }
      slot.meta = meta;

      const prev = buf[(rec.i - 1 + ring) % ring].meta;
      // ATTRIBUTION IS PART OF THE TRIGGER, not a check afterwards. On a live
      // board bots mine constantly: the first `oreCollect` increment after arming
      // belonged to seat 1 on the previous run, and triggering on it would have
      // photographed a bot's sparkle and called it the staged one. The tally must
      // move AND the seat that owns the new tell must be the local seat.
      if (
        rec.armed &&
        prev &&
        !rec.trigger &&
        meta[rec.armed] > prev[rec.armed] &&
        meta[`${rec.armed}By`] === local
      ) {
        rec.trigger = { ...meta, from: prev[rec.armed] };
        rec.first[rec.armed] = rec.trigger;
        // Keep rolling for two thirds of the ring, so the burst's whole life is
        // in the buffer with a handful of "before" frames still ahead of it.
        rec.stopAt = rec.i + Math.floor((ring * 2) / 3);
      }
      if (rec.trigger && rec.i >= rec.stopAt) rec.running = false;
      rec.i++;
    };
    requestAnimationFrame(tick);

    w.__a1_13_start = (kind) => {
      rec.i = 0;
      rec.armed = kind;
      rec.trigger = null;
      rec.stopAt = 0;
      for (const s of buf) s.meta = null;
      rec.running = true;
    };
    w.__a1_13_done = () => rec.running === false && rec.trigger !== null;
    /** Frames in capture order, oldest first, as PNG data URLs. Encoded only
     *  after the event is over — never on the frame budget. */
    w.__a1_13_frames = () => {
      const kept = buf.filter((s) => s.meta).sort((a, b) => a.meta.seq - b.meta.seq);
      return kept.map((s) => ({ meta: s.meta, url: s.c.toDataURL('image/png') }));
    };
  },
  { crop: CROP, ring: RING, kinds: ['shipExplode', 'oreCollect'], local: LOCAL_PLAYER },
);

out.canvas = await page.evaluate(() => window.__a1_13.canvas);

// Let a real match run: bots fight, and that unstaged tally is half the answer to
// "which of the twenty-five are wired".
await sleep(12_000);
out.afterIdle = await readVfx();

/** Arm the recorder on one kind, stage the event, wait for the ring to close. */
async function event(kind, stage) {
  await page.evaluate((k) => window.__a1_13_start(k), kind);
  await sleep(500); // a few "before" frames in the same ring
  const stagedAt = Date.now();
  const staged = await stage();
  await page.waitForFunction(() => window.__a1_13_done(), undefined, { timeout: 45_000 });
  const frames = await page.evaluate(() => window.__a1_13_frames());
  const trigger = await page.evaluate(() => window.__a1_13.trigger);
  return { kind, staged, stagedAt, trigger, frames };
}

/** Nearest-neighbour 2x of the crop's centre — no interpolation, so every pixel
 *  in the inset is a pixel the client actually drew, just bigger. */
function zoomOf(src) {
  const x0 = Math.round(src.width / 2 - ZOOM.w / 2);
  const y0 = Math.round(src.height / 2 - ZOOM.h / 2);
  const W = ZOOM.w * ZOOM.scale;
  const H = ZOOM.h * ZOOM.scale;
  const dst = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const s = ((y0 + Math.floor(y / ZOOM.scale)) * src.width + (x0 + Math.floor(x / ZOOM.scale))) * 4;
      const d = (y * W + x) * 4;
      dst.data[d] = src.data[s];
      dst.data[d + 1] = src.data[s + 1];
      dst.data[d + 2] = src.data[s + 2];
      dst.data[d + 3] = 255;
    }
  }
  return dst;
}

/** Write one frame, and a grid of all of them in capture order. */
function writeFrames(ev, tag, cols) {
  const imgs = ev.frames.map((f) =>
    PNG.sync.read(Buffer.from(f.url.replace(/^data:image\/png;base64,/, ''), 'base64')),
  );
  const rows = Math.ceil(imgs.length / cols);
  const G = 3;
  const W = cols * CROP.w + (cols + 1) * G;
  const H = rows * CROP.h + (rows + 1) * G;
  const dst = new PNG({ width: W, height: H });
  dst.data.fill(0);
  for (let i = 3; i < dst.data.length; i += 4) dst.data[i] = 255;
  imgs.forEach((src, i) => {
    const ox = G + (i % cols) * (CROP.w + G);
    const oy = G + Math.floor(i / cols) * (CROP.h + G);
    for (let y = 0; y < CROP.h; y++) {
      for (let x = 0; x < CROP.w; x++) {
        const s = (y * src.width + x) * 4;
        const d = ((oy + y) * W + (ox + x)) * 4;
        dst.data[d] = src.data[s];
        dst.data[d + 1] = src.data[s + 1];
        dst.data[d + 2] = src.data[s + 2];
      }
    }
  });
  const sheetFile = `a1-13-${tag}-sheet.png`;
  writeFileSync(join(IMAGES, sheetFile), PNG.sync.write(dst));

  // The frames that bracket the burst, written singly and at 2x, because those
  // are the ones the attestation is about. "Peak" is the busiest frame WITHIN
  // 700 ms of the trigger — not the busiest of the whole ring, which on the last
  // run was a frame a full second later showing somebody else's fight.
  const ti = ev.frames.findIndex((f) => f.meta.seq === ev.trigger.seq);
  const near = ev.frames.filter((f) => Math.abs(f.meta.t - ev.trigger.t) <= 700);
  const peak = near.reduce((a, b) => (b.meta.particles > a.meta.particles ? b : a), near[0]);
  const pi = ev.frames.indexOf(peak);

  const singles = [];
  for (let i = Math.max(0, ti - 2); i <= Math.min(ev.frames.length - 1, ti + 5); i++) {
    const rel = i - ti;
    const label = rel < 0 ? `m${-rel}` : `p${rel}`;
    const file = `a1-13-${tag}-${label}.png`;
    writeFileSync(join(IMAGES, file), PNG.sync.write(imgs[i]));
    const zf = `a1-13-${tag}-${label}-2x.png`;
    writeFileSync(join(IMAGES, zf), PNG.sync.write(zoomOf(imgs[i])));
    singles.push({
      rel,
      image: `images/${file}`,
      zoom: `images/${zf}`,
      relMs: ev.frames[i].meta.t - ev.trigger.t,
      particles: ev.frames[i].meta.particles,
      [ev.kind]: ev.frames[i].meta[ev.kind],
      [`${ev.kind}By`]: ev.frames[i].meta[`${ev.kind}By`],
    });
  }

  return {
    sheet: `images/${sheetFile}`,
    triggerIndex: ti,
    singles,
    peak: { image: singles.find((s) => ev.frames.indexOf(peak) - ti === s.rel)?.image ?? null, index: pi, ...peak.meta, relMs: peak.meta.t - ev.stagedAt },
    frames: ev.frames.map((f) => ({
      seq: f.meta.seq,
      relMs: f.meta.t - ev.stagedAt,
      particles: f.meta.particles,
      [ev.kind]: f.meta[ev.kind],
      [`${ev.kind}By`]: f.meta[`${ev.kind}By`],
    })),
  };
}

// --- shipExplode ----------------------------------------------------------
// Through the sim's own killShip. NOT `damageShip`: real damage meets the ten
// seconds of spawn protection every match opens with and is refused in full, and
// the explosions that then arrive belong to bots (a2-07 hit exactly that).
const ev1 = await event('shipExplode', () =>
  page.evaluate(() => window.__endScreenStage?.killLocalShip() ?? null),
);
out.explode = {
  staged: ev1.staged,
  stagedAt: ev1.stagedAt,
  trigger: ev1.trigger,
  ...writeFrames(ev1, 'vfx-explode', 5),
};

// --- oreCollect -----------------------------------------------------------
// Ore arriving in the LOCAL hold is what tractor collection does (GDD §2.3); the
// shipped observer derives the tell off the delta. Wait for the ship back first —
// it just died, and a sparkle needs something to sparkle on.
await page.waitForFunction(() => window.__endScreenStage?.shipAlive?.() === true, undefined, {
  timeout: 60_000,
});
await sleep(2500);
const ev2 = await event('oreCollect', () =>
  page.evaluate(() => window.__oreHudStage?.mine(6) ?? null),
);
out.ore = {
  staged: ev2.staged,
  stagedAt: ev2.stagedAt,
  trigger: ev2.trigger,
  ...writeFrames(ev2, 'vfx-ore', 5),
};

await sleep(4000);
out.final = await readVfx();
out.localPlayer = LOCAL_PLAYER;

await browser.close();
writeFileSync(join(HERE, 'readback-vfx.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      build: out.build,
      attachedAtBoot: out.atBoot?.attached,
      explode: { staged: out.explode.staged, trigger: out.explode.trigger, peak: out.explode.peak },
      ore: { staged: out.ore.staged, trigger: out.ore.trigger, peak: out.ore.peak },
      errors: out.errors,
    },
    null,
    2,
  ),
);
