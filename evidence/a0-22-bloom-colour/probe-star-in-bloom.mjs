/**
 * evidence/a0-22-bloom-colour/probe-star-in-bloom.mjs — a0-22, the instrument.
 * OWNER: Art Agent.
 *
 * The developer, from live play: *"the bloom is still messed up … our mockups had
 * different colored blooms these are all 1 color **there are no stars in them**"*.
 *
 * The second half of that sentence is a claim about PIXELS, and `starFieldSprite`
 * pushes the halo first and the star's own point second at the same `x,y`, so a
 * star *should* sit in every bloom. This asks the running build both questions
 * that separates:
 *
 *  1. **Is a star submitted inside every halo?** — the a0-18 geometry read-back,
 *     extended to carry each fill's COLOUR, which is the other half of this round.
 *  2. **Does that star reach the frame as something an eye can find?** — for every
 *     bloomed star, sample the rendered PNG at its own centre and in the two halo
 *     annuli, and report the contrast between them. A star that is submitted but
 *     lands at, say, Δ2 of luma over its own halo is a star that is *there* and
 *     is not *visible*, and those are different findings with different fixes.
 *
 * The frame is the void ALONE: every child of the stage but the backdrop root is
 * hidden, so no rock, ship or station can be mistaken for a star or sit on top of
 * one. (a1-07 measured that the soft grey discs the developer described in an
 * earlier round were the asteroids; this probe removes them from the question by
 * construction rather than by argument.)
 *
 * The stage is reached through Pixi's own devtools hook — `__PIXI_APP_INIT__`,
 * set from a Playwright init script before any page script runs. **Nothing in
 * `src/` is touched**, so the same file measures the served bundle of any commit.
 *
 *   node evidence/a0-22-bloom-colour/probe-star-in-bloom.mjs <port> <label>
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = process.argv[2] ?? '4922';
const LABEL = process.argv[3] ?? 'shipped';
const BASE = `http://localhost:${PORT}`;
const OUT = join(HERE, 'frames', LABEL);

/** The developer's desktop, dpr 2 — a0-18 and a1-07's viewport, so the three
 *  rounds are directly comparable. */
const VP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const DPR = VP.deviceScaleFactor;

/** Two arenas: the default (sky `none` — the goldens' scene, stars only) and one
 *  with a lit sky, because a sky behind a halo is the case "subtle" was picked
 *  for and the case where a faint core has the most to compete with. */
const MAPS = [
  { id: 'octagon', sky: 'none' },
  { id: 'oval', sky: 'plasmaReef' },
];

const settle = (page, n = 12) =>
  page.evaluate(
    (frames) =>
      new Promise((done) => {
        let i = 0;
        const tick = () => (++i < frames ? requestAnimationFrame(tick) : done());
        requestAnimationFrame(tick);
      }),
    n,
  );

const initScript = (mapId) => `
  try { localStorage.setItem('planet-rush:mapId', ${JSON.stringify(mapId)}); } catch (e) {}
  globalThis.__PIXI_APP_INIT__ = function (app) { globalThis.__qaApp = app; };
`;

/** The container holding `void-ground` — the backdrop's own root. */
const FIND_VOID = `
  (() => {
    const app = globalThis.__qaApp;
    if (!app || !app.stage) return null;
    let found = null;
    const walk = (node, depth) => {
      if (found || depth > 24) return;
      const kids = node.children || [];
      if (kids.some((c) => c.label === 'void-ground')) { found = node; return; }
      for (const c of kids) walk(c, depth + 1);
    };
    walk(app.stage, 0);
    return found;
  })()
`;

/**
 * Every fill each star layer submitted, grouped by centre, WITH its colour — and
 * the layer's own world transform, so an authored centre can be turned into a
 * device pixel without guessing at the parallax offset.
 */
const READ_STARS = `
  (() => {
    const void_ = ${FIND_VOID};
    if (!void_) return { error: 'no void container on the stage' };
    const layers = [];
    for (const c of void_.children) {
      const label = typeof c.label === 'string' ? c.label : '';
      if (!label.startsWith('void-stars-')) continue;
      const ctx = c.context;
      if (!ctx || !ctx.instructions) { layers.push({ label, error: 'no GraphicsContext instructions' }); continue; }
      const groups = new Map();
      for (const ins of ctx.instructions) {
        if (ins.action !== 'fill') continue;
        const path = ins.data && ins.data.path;
        const list = (path && path.instructions) || [];
        const circle = list.find((p) => p.action === 'circle');
        if (!circle) continue;
        const [x, y, r] = circle.data;
        const key = x + ',' + y;
        const g = groups.get(key) || { x, y, fills: [] };
        g.fills.push({
          r,
          alpha: ins.data.style ? ins.data.style.alpha : null,
          color: ins.data.style ? ins.data.style.color : null,
        });
        groups.set(key, g);
      }
      const t = c.worldTransform;
      layers.push({
        label,
        visible: c.visible !== false,
        transform: { a: t.a, b: t.b, c: t.c, d: t.d, tx: t.tx, ty: t.ty },
        stars: [...groups.values()],
      });
    }
    // The OTHER round soft things in the frame, at the same scale, from the same
    // instruction list: the sky's own discs. "There are no stars in them" is true
    // of these by construction — a nebula clot has no star — so their SIZE against
    // a bloom's is what says whether the report can be about a bloom at all.
    const sky = [];
    for (const c of void_.children) {
      const label = typeof c.label === 'string' ? c.label : '';
      if (!label.startsWith('void-nebula-')) continue;
      const ctx = c.context;
      if (!ctx || !ctx.instructions) continue;
      const radii = [];
      for (const ins of ctx.instructions) {
        if (ins.action !== 'fill') continue;
        const list = (ins.data && ins.data.path && ins.data.path.instructions) || [];
        const circle = list.find((p) => p.action === 'circle');
        if (circle) radii.push(circle.data[2]);
      }
      radii.sort((a, b) => a - b);
      sky.push({
        label,
        discs: radii.length,
        minDiameterCssPx: radii.length ? radii[0] * 2 : null,
        medianDiameterCssPx: radii.length ? radii[radii.length >> 1] * 2 : null,
        maxDiameterCssPx: radii.length ? radii[radii.length - 1] * 2 : null,
      });
    }
    const pr = globalThis.__planetRush;
    return {
      layers,
      sky,
      order: void_.children.map((c) => (typeof c.label === 'string' ? c.label : '?')),
      build: pr && pr.build ? pr.build.sha : null,
      viewport: pr && pr.viewport ? { w: pr.viewport.w, h: pr.viewport.h } : null,
    };
  })()
`;

/** Hide every child of the stage except the backdrop's own root, so the frame is
 *  the void and nothing else. Visibility is written on Pixi nodes only — the sim
 *  is frozen and never consulted. */
const VOID_ONLY = `
  (() => {
    const app = globalThis.__qaApp;
    const void_ = ${FIND_VOID};
    if (!app || !void_) return { error: 'no stage' };
    const hidden = [];
    const isAncestorOfVoid = (n) => {
      let p = void_;
      while (p) { if (p === n) return true; p = p.parent; }
      return false;
    };
    const walk = (node) => {
      for (const c of node.children || []) {
        if (c === void_) continue;
        if (isAncestorOfVoid(c)) { walk(c); continue; }
        if (c.visible !== false) { c.visible = false; hidden.push(typeof c.label === 'string' ? c.label : '?'); }
      }
    };
    walk(app.stage);
    return { hidden };
  })()
`;

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Mean luma of the disc of radius `r` (device px) centred on (`cx`,`cy`), and
 *  the mean over the annulus `r0`..`r1`. Sub-pixel radii are handled by taking
 *  the single nearest pixel — which is exactly what the eye gets. */
function sampleDisc(png, cx, cy, r) {
  const { width, height, data } = png;
  let sum = 0;
  let n = 0;
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(width - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(height - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy > r2) continue;
      const o = (y * width + x) * 4;
      sum += luma(data[o], data[o + 1], data[o + 2]);
      n++;
    }
  }
  if (n === 0) {
    const x = Math.round(cx - 0.5);
    const y = Math.round(cy - 0.5);
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    const o = (y * width + x) * 4;
    return { mean: luma(data[o], data[o + 1], data[o + 2]), n: 1 };
  }
  return { mean: sum / n, n };
}

function sampleAnnulus(png, cx, cy, r0, r1) {
  const { width, height, data } = png;
  let sum = 0;
  let n = 0;
  const x0 = Math.max(0, Math.floor(cx - r1));
  const x1 = Math.min(width - 1, Math.ceil(cx + r1));
  const y0 = Math.max(0, Math.floor(cy - r1));
  const y1 = Math.min(height - 1, Math.ceil(cy + r1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < r0 * r0 || d2 > r1 * r1) continue;
      const o = (y * width + x) * 4;
      sum += luma(data[o], data[o + 1], data[o + 2]);
      n++;
    }
  }
  return n ? { mean: sum / n, n } : null;
}

/** Peak luma anywhere inside the disc — "the brightest thing in the orb". */
function peakDisc(png, cx, cy, r) {
  const { width, height, data } = png;
  let peak = -1;
  const r2 = r * r;
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(height - 1, Math.ceil(cy + r)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(width - 1, Math.ceil(cx + r)); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy > r2) continue;
      const o = (y * width + x) * 4;
      const l = luma(data[o], data[o + 1], data[o + 2]);
      if (l > peak) peak = l;
    }
  }
  return peak < 0 ? null : peak;
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r4 = (x) => (x === null || x === undefined ? null : Math.round(x * 1e4) / 1e4);
const r2f = (x) => (x === null || x === undefined ? null : Math.round(x * 100) / 100);

async function run() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const report = { label: LABEL, base: BASE, viewport: VP, maps: [] };

  for (const map of MAPS) {
    const ctx = await browser.newContext(VP);
    await ctx.addInitScript(initScript(map.id));
    const page = await ctx.newPage();
    await page.goto(`${BASE}/?debug=1&freeze=1`, { waitUntil: 'load' });
    await page.waitForFunction('!!globalThis.__qaApp && !!globalThis.__planetRush', null, { timeout: 20000 });
    await settle(page, 24);

    const read = await page.evaluate(READ_STARS);
    const hid = await page.evaluate(VOID_ONLY);
    await settle(page, 8);
    const framePath = join(OUT, `${map.id}-void-only.png`);
    await page.screenshot({ path: framePath });
    const png = PNG.sync.read(readFileSync(framePath));

    const layers = [];
    for (const layer of read.layers ?? []) {
      const t = layer.transform;
      const bloomed = [];
      let plain = 0;
      for (const star of layer.stars) {
        // Authored (x,y) → screen css px → device px. The layers carry a pure
        // translation (VoidBackdrop.update writes only `position`), so the
        // transform is applied in full rather than assumed to be one.
        const sx = (t.a * star.x + t.c * star.y + t.tx) * DPR;
        const sy = (t.b * star.x + t.d * star.y + t.ty) * DPR;
        if (star.fills.length < 3) { plain++; continue; }
        if (sx < 24 || sy < 24 || sx > png.width - 24 || sy > png.height - 24) continue;
        const radii = star.fills.map((f) => f.r).sort((a, b) => b - a);
        const [outerR, innerR, coreR] = radii;
        const core = star.fills.find((f) => f.r === coreR);
        const inner = star.fills.find((f) => f.r === innerR);
        const outer = star.fills.find((f) => f.r === outerR);
        const corePeak = peakDisc(png, sx, sy, Math.max(coreR * DPR, 1));
        const coreMean = sampleDisc(png, sx, sy, Math.max(coreR * DPR, 0.7));
        const innerRing = sampleAnnulus(png, sx, sy, coreR * DPR * 1.35, innerR * DPR);
        const outerRing = sampleAnnulus(png, sx, sy, innerR * DPR * 1.1, outerR * DPR);
        const background = sampleAnnulus(png, sx, sy, outerR * DPR * 1.3, outerR * DPR * 2.2);
        bloomed.push({
          x: r2f(sx),
          y: r2f(sy),
          coreR: r4(coreR),
          innerR: r4(innerR),
          outerR: r4(outerR),
          haloDiameterCssPx: r2f(outerR * 2),
          coreDiameterCssPx: r2f(coreR * 2),
          coreDiameterDevicePx: r2f(coreR * 2 * DPR),
          colors: {
            core: core?.color ?? null,
            inner: inner?.color ?? null,
            outer: outer?.color ?? null,
          },
          alphas: { core: r4(core?.alpha), inner: r4(inner?.alpha), outer: r4(outer?.alpha) },
          luma: {
            corePeak: r2f(corePeak),
            coreMean: r2f(coreMean?.mean),
            innerRing: r2f(innerRing?.mean),
            outerRing: r2f(outerRing?.mean),
            background: r2f(background?.mean),
          },
          // The whole question, as one number per star: how far the star's own
          // point rises above the halo it sits in.
          coreOverHalo: r2f(corePeak !== null && innerRing ? corePeak - innerRing.mean : null),
          haloOverBackground: r2f(innerRing && background ? innerRing.mean - background.mean : null),
        });
      }
      const distinctColors = [
        ...new Set(layer.stars.flatMap((s) => s.fills.map((f) => f.color)).filter((c) => c !== null)),
      ].sort((a, b) => a - b);
      layers.push({
        label: layer.label,
        stars: layer.stars.length,
        bloomed: bloomed.length + 0,
        plain,
        onScreenBloomed: bloomed.length,
        distinctColorsHex: distinctColors.map((c) => '#' + c.toString(16).padStart(6, '0')),
        medianCoreOverHalo: r2f(median(bloomed.map((b) => b.coreOverHalo).filter((v) => v !== null))),
        medianHaloOverBackground: r2f(median(bloomed.map((b) => b.haloOverBackground).filter((v) => v !== null))),
        medianCorePeak: r2f(median(bloomed.map((b) => b.luma.corePeak).filter((v) => v !== null))),
        medianCoreDiameterDevicePx: r2f(median(bloomed.map((b) => b.coreDiameterDevicePx))),
        medianHaloDiameterCssPx: r2f(median(bloomed.map((b) => b.haloDiameterCssPx))),
        // A core that never clears its own halo by 1/255 is a core no eye finds.
        coresBelow1: bloomed.filter((b) => (b.coreOverHalo ?? 0) < 1).length,
        coresBelow4: bloomed.filter((b) => (b.coreOverHalo ?? 0) < 4).length,
        bloomedStars: bloomed,
      });
    }

    report.maps.push({
      map: map.id,
      sky: map.sky,
      build: read.build,
      order: read.order,
      skyDiscs: read.sky ?? [],
      hiddenFromStage: hid.hidden,
      frame: `frames/${LABEL}/${map.id}-void-only.png`,
      layers,
    });
    await ctx.close();
  }

  await browser.close();
  const path = join(HERE, `star-in-bloom.${LABEL}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2));

  // A short human read-out, so the number is visible without opening the JSON.
  for (const m of report.maps) {
    console.log(`\n=== ${m.map} (sky ${m.sky}) build ${m.build} ===`);
    for (const s of m.skyDiscs ?? []) {
      console.log(
        `  ${s.label.padEnd(18)} ${String(s.discs).padStart(4)} soft discs, Ø ${s.minDiameterCssPx?.toFixed(
          1,
        )}–${s.maxDiameterCssPx?.toFixed(1)} css px (median ${s.medianDiameterCssPx?.toFixed(1)}) — no star in any of them`,
      );
    }
    for (const l of m.layers) {
      console.log(
        `  ${l.label.padEnd(18)} stars ${String(l.stars).padStart(4)}  on-screen bloomed ${String(
          l.onScreenBloomed,
        ).padStart(3)}  colours ${l.distinctColorsHex.join(' ')}`,
      );
      console.log(
        `  ${''.padEnd(18)} halo Ø ${String(l.medianHaloDiameterCssPx).padStart(6)} css  core Ø ${String(
          l.medianCoreDiameterDevicePx,
        ).padStart(5)} dev  core peak Y′ ${String(l.medianCorePeak).padStart(6)}  core−halo ${String(
          l.medianCoreOverHalo,
        ).padStart(6)}  halo−bg ${String(l.medianHaloOverBackground).padStart(6)}  cores<1 ${l.coresBelow1}/${l.onScreenBloomed}`,
      );
    }
  }
  console.log(`\nwrote ${path}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
