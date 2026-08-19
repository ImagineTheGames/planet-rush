import { chromium } from '@playwright/test';

const URL_BASE = process.env.BASE ?? 'http://localhost:4199/';

const DEVICES = {
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  phone:   { viewport: { width: 390, height: 844 },  deviceScaleFactor: 3, isMobile: true,  hasTouch: true },
};

// The shipped geometry, quoted so the post-process asks the same question the
// gate's own punch does: is any part of the overlay still on the screen?
const DOOR = { widthOfVw: 0.94, widthOfVh: 1.36, aspect: 1.62, frame: 0.094, chamferX: 0.13, chamferY: 0.22 };
const OPENING_SCALE = 1 - 2 * DOOR.frame;
function openingPolygon(view, scale) {
  const width = Math.min(DOOR.widthOfVw * view.width, DOOR.widthOfVh * view.height) * scale;
  const w = width * OPENING_SCALE;
  const h = (width / DOOR.aspect) * OPENING_SCALE;
  const x0 = view.width / 2 - w / 2;
  const y0 = view.height / 2 - h / 2;
  const { chamferX: cx, chamferY: cy } = DOOR;
  return [[0, cy], [cx, 0], [1 - cx, 0], [1, cy], [1, 1 - cy], [1 - cx, 1], [cx, 1], [0, 1 - cy]]
    .map(([px, py]) => ({ x: x0 + px * w, y: y0 + py * h }));
}
function inside(poly, p) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross === 0) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s; else if (s !== sign) return false;
  }
  return true;
}
/** Does the doorway cover every corner of the screen? Then no gate pixel is on it. */
function clear(view, scale) {
  const poly = openingPolygon(view, scale);
  return [[0, 0], [view.width, 0], [0, view.height], [view.width, view.height]]
    .every(([x, y]) => inside(poly, { x, y }));
}

const INIT = () => {
  const W = window;
  W.__probe = { audio: [], samples: [], paints: [], press: null, mount: null };
  const rec = (kind, when, ctx) => {
    W.__probe.audio.push({
      kind,
      due: performance.now() + Math.max(0, (when ?? 0) - (ctx?.currentTime ?? 0)) * 1000,
    });
  };
  for (const name of ['OscillatorNode', 'AudioBufferSourceNode']) {
    const C = W[name];
    if (!C) continue;
    const orig = C.prototype.start;
    C.prototype.start = function (when, ...rest) {
      try { rec(name, when, this.context); } catch {}
      return orig.call(this, when, ...rest);
    };
  }
  // The press, stamped in the page at the instant the browser delivered it —
  // not when the driver asked for it.
  addEventListener('pointerdown', () => { if (W.__probe.press === null) W.__probe.press = performance.now(); }, true);

  W.__probeStart = () => {
    const root = document.getElementById('pr-title-gate');
    const sky = document.getElementById('pr-title-gate-sky');
    const door = document.getElementById('pr-title-gate-door');
    const g = sky ? sky.getContext('2d', { willReadFrequently: true }) : null;
    W.__probe.mount = performance.now();
    // Time-based: a CSS transition advances on the wall clock, so a sampler that
    // does not wait for a frame reads the same numbers a 60 Hz phone paints.
    const tick = () => {
      const cs = getComputedStyle(door).transform;
      let scale = null;
      if (cs && cs !== 'none') { try { scale = Math.abs(new DOMMatrixReadOnly(cs).a); } catch {} }
      W.__probe.samples.push({ at: performance.now(), scale, pe: root.style.pointerEvents, vis: root.style.visibility });
    };
    W.__probeTimer = setInterval(tick, 8);
    // …and a per-FRAME read of the punched canvas, which is the picture itself.
    const paint = () => {
      const cw = sky.width, ch = sky.height;
      let a = 255;
      if (g && cw > 1 && ch > 1) {
        a = 0;
        for (const [x, y] of [[0, 0], [cw - 1, 0], [0, ch - 1], [cw - 1, ch - 1]]) {
          a = Math.max(a, g.getImageData(x, y, 1, 1).data[3]);
        }
      }
      W.__probe.paints.push({ at: performance.now(), cornerAlpha: a });
      requestAnimationFrame(paint);
    };
    requestAnimationFrame(paint);
  };
};

async function boot(browser, name) {
  const ctx = await browser.newContext(DEVICES[name]);
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  await page.goto(URL_BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__mainMenu && !!document.getElementById('pr-title-gate'), null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  return { ctx, page };
}

const view = async (page) =>
  page.evaluate(() => ({ ...window.__mainMenu.logicalViewport, rotated: window.__mainMenu.rotated }));

async function timeline(browser, name) {
  const { ctx, page } = await boot(browser, name);
  const v = await view(page);
  await page.evaluate(() => window.__probeStart());
  const c = await page.evaluate(() => {
    const r = document.getElementById('pr-title-gate').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(6500);
  const probe = await page.evaluate(() => { clearInterval(window.__probeTimer); return window.__probe; });
  await ctx.close();

  const press = probe.press;
  const rel = (t) => +(t - press).toFixed(0);
  const S = probe.samples.filter((s) => s.at >= press);
  const looksOpen = S.find((s) => s.scale !== null && clear(v, s.scale));
  const takesInput = S.find((s) => s.pe === 'none');
  const paintClear = probe.paints.filter((p) => p.at >= press).find((p) => p.cornerAlpha === 0);
  const cues = [];
  for (const a of probe.audio) {
    const t = a.due - press;
    if (t < -50) continue;
    const last = cues[cues.length - 1];
    if (last && t - last.last < 200) { last.last = t; last.n++; } else cues.push({ first: +t.toFixed(0), last: t, n: 1 });
  }
  return {
    device: name,
    logicalViewport: v,
    samples: S.length,
    looksOpenMs: looksOpen ? rel(looksOpen.at) : null,
    looksOpenScale: looksOpen ? looksOpen.scale : null,
    paintClearMs: paintClear ? rel(paintClear.at) : null,
    pingMs: cues.length ? cues[cues.length - 1].first : null,
    cueStartsMs: cues.map((c) => c.first),
    takesInputMs: takesInput ? rel(takesInput.at) : null,
  };
}

async function clickAt(browser, name, delayMs) {
  const { ctx, page } = await boot(browser, name);
  const target = await page.evaluate(() => {
    const cs = window.__mainMenu.controls;
    const c = cs.find((x) => x.kind === 'hangar') ?? cs[0];
    return { id: c.kind, x: c.physicalCenter.x, y: c.physicalCenter.y, all: cs.map((k) => k.kind) };
  });
  const c = await page.evaluate(() => {
    const r = document.getElementById('pr-title-gate').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.evaluate(() => { window.__probe.press = null; });
  await page.mouse.click(c.x, c.y);
  const press = await page.evaluate(() => window.__probe.press);
  await page.waitForFunction((d) => performance.now() - window.__probe.press >= d, delayMs, { timeout: 20000, polling: 5 });
  const at = await page.evaluate((p) => performance.now() - p, press);
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(500);
  const screen = await page.evaluate(() => window.__mainMenu.screen);
  await ctx.close();
  return { device: name, target: target.id, controls: target.all, clickedAtMs: +at.toFixed(0), screenAfter: screen };
}

/**
 * The brief's lead, measured: `Escape` reseals, the leaves drive shut, and the
 * lock throws once they are measurably home. If `home` never arrived this would
 * sit on SEAL_CAP_MS (3200 ms past `closing`, i.e. ~4660 ms past the Escape).
 */
async function reseal(browser, name) {
  const { ctx, page } = await boot(browser, name);
  const c = await page.evaluate(() => {
    const r = document.getElementById('pr-title-gate').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(c.x, c.y);
  await page.waitForFunction(() => getComputedStyle(document.getElementById('pr-title-gate')).pointerEvents === 'none',
    null, { timeout: 20000, polling: 16 });
  await page.evaluate(() => { window.__probe.escape = performance.now(); });
  await page.keyboard.press('Escape');
  const lockedAt = await page.evaluate(async () => {
    const root = document.getElementById('pr-title-gate');
    const t0 = window.__probe.escape;
    return await new Promise((res) => {
      const poll = () => {
        // `locked` is the only phase that puts the rotor back to 0deg.
        if (root.style.getPropertyValue('--pr-gate-hub-rot') === '0deg') res(performance.now() - t0);
        else if (performance.now() - t0 > 12000) res(null);
        else setTimeout(poll, 8);
      };
      poll();
    });
  });
  await ctx.close();
  return { device: name, lockedAfterEscapeMs: lockedAt === null ? null : +lockedAt.toFixed(0) };
}

/** A screenshot `delayMs` after the opening press — what the player is looking
 *  at while the menu is (or is not) ignoring them. */
async function shot(browser, name, delayMs, tag) {
  const { ctx, page } = await boot(browser, name);
  const c = await page.evaluate(() => {
    const r = document.getElementById('pr-title-gate').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.evaluate(() => { window.__probe.press = null; });
  await page.mouse.click(c.x, c.y);
  await page.waitForFunction((d) => window.__probe.press !== null && performance.now() - window.__probe.press >= d,
    delayMs, { timeout: 20000, polling: 5 });
  const at = await page.evaluate(() => performance.now() - window.__probe.press);
  // Read BEFORE the screenshot: a software-GL capture costs several hundred ms,
  // which is longer than the window being measured.
  const live = await page.evaluate(() => document.getElementById('pr-title-gate').style.pointerEvents === 'none');
  await page.screenshot({ path: `${process.env.SHOTS ?? '.'}/${tag}-${name}-${delayMs}ms.png` });
  await ctx.close();
  return { device: name, delayMs, shotAtMs: +at.toFixed(0), takesAPress: live };
}

const browser = await chromium.launch();
const out = { timelines: [], clicks: [], reseals: [], shots: [] };
if (!process.env.ONLY) {
  for (const d of ['desktop', 'phone']) out.timelines.push(await timeline(browser, d));
  for (const d of ['desktop', 'phone']) out.reseals.push(await reseal(browser, d));
}
if (process.argv[2] === 'click' || process.env.CLICKS) {
  for (const d of ['desktop', 'phone']) {
    for (const delay of (process.env.DELAYS ?? '2600,3000,3300,3700').split(',').map(Number)) {
      out.clicks.push(await clickAt(browser, d, delay));
    }
  }
}
if (process.env.SHOTS) {
  for (const d of ['desktop', 'phone']) {
    for (const delay of (process.env.SHOT_AT ?? '3000').split(',').map(Number)) {
      out.shots.push(await shot(browser, d, delay, process.env.TAG ?? 'shot'));
    }
  }
}
await browser.close();
console.log(JSON.stringify(out, null, 2));
