/**
 * evidence/a0-07b-sky-parallax/render-parallax-strip.ts — the motion figure.
 * OWNER: Art Agent (a0-07b).
 *
 * The complaint is about MOTION, so a still frame cannot answer it. The brief
 * asks for the same scene at three camera positions along a straight flight —
 * far left, centre, far right — for the current build and for the fix, so the
 * proof is what the clots do relative to the stars between frames.
 *
 * This is the DETERMINISTIC half of that evidence. It drives the shipped
 * generators (`src/art/backdrop.ts`) and the shipped placement rule
 * (`VoidBackdrop.update`: a layer at parallax `f` sits at `viewCentre +
 * f·cameraOffset`) directly, composites ground + sky + the three star layers
 * into SVG at 1:1, and rasterises the lot in headless Chromium. Same geometry,
 * same field sizes, same camera arithmetic as the game; no sim, no bots, no
 * clock, so the two rows differ in exactly one number — the sky's parallax —
 * and nothing else can be blamed for what they show. The LIVE half
 * (`shoot-live-flight.mjs`) shoots the same flight through the real shipped
 * renderer, where everything else is moving too.
 *
 * ── HOW TO READ THE FIGURE ─────────────────────────────────────────────────
 * Each row is one build's three camera positions. In every frame there is a
 * thin steel ring, and the ring is **drawn into the deep star layer**: it is a
 * fixed point in the star field, placed to sit exactly on the tracked sky clot
 * in the first frame. So the ring is where the stars say that clot should still
 * be. Fly, and watch the gap:
 *
 *   BEFORE (parallax 0.05) — the clot falls out of its ring almost at once. It
 *   is not travelling with the stars, so the eye assigns it to the only other
 *   plane on offer: the glass in front of the player.
 *   AFTER (0.085) — the clot stays in its ring across the whole crossing and
 *   drifts out of it slowly, which is what something behind the stars does.
 *
 * The caption under each frame reports that gap in pixels, measured off the
 * same arithmetic the renderer runs.
 *
 *   npx vite-node evidence/a0-07b-sky-parallax/render-parallax-strip.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import {
  NEBULAE,
  SKY_PARALLAX,
  STAR_LAYERS,
  VOID_SEED,
  coverSpan,
  groundSprite,
  nebulaSprite,
  starFieldSprite,
  type NebulaId,
} from '../../src/art/backdrop';
import { shapeToSvg } from '../../src/art/svg';
import { hex, DERIVED, FLOOR } from '../../src/art/palette';
import { pointInPoly } from '../../src/art/raster';
import type { Shape } from '../../src/art/shapes';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'frames');

/** The landscape phone the game is locked to on mobile (GDD §4.6). */
const VIEW = { w: 844, h: 390 } as const;

/** The parallax the developer reported, kept here so the BEFORE row is the real
 *  old number rather than a re-render of the new one with a caption. */
const REPORTED_PARALLAX = 0.05;

/** Where along the flight the three frames are taken: far left, centre, far right. */
const STOPS = [0.15, 0.5, 0.85] as const;

interface Case {
  readonly sky: NebulaId;
  readonly map: string;
  readonly bounds: { readonly width: number; readonly height: number };
  readonly why: string;
}

/** Two skies, per the brief: the most object-like one, and a sparse one. */
const CASES: readonly Case[] = [
  {
    sky: 'plasmaReef',
    map: 'oval',
    bounds: { width: 3200, height: 2000 },
    why: 'the most object-like sky — nine discrete clots of additive cyan',
  },
  {
    sky: 'deepEmber',
    map: 'line',
    bounds: { width: 3200, height: 2000 },
    why: 'one of the sparse ones — five big soft bodies pushed to the rim',
  },
];

/** One rigid layer of the composite: geometry authored centred on the origin,
 *  plus the parallax factor that decides where it lands this frame. */
interface Layer {
  readonly shapes: readonly Shape[];
  readonly parallax: number;
  readonly additive: boolean;
}

/** The camera offset the renderer computes for a target at `x`, `y` (camera.ts
 *  `writeCameraOffset`, with the visual viewport's origin at 0). */
function cameraOffset(x: number, y: number): { x: number; y: number } {
  return { x: VIEW.w / 2 - x, y: VIEW.h / 2 - y };
}

/** Where a layer sits this frame (`VoidBackdrop.update`). */
function layerPos(f: number, off: { x: number; y: number }): { x: number; y: number } {
  return { x: VIEW.w / 2 + off.x * f, y: VIEW.h / 2 + off.y * f };
}

/** The whole void, for one sky at one parallax, over one arena. */
function buildLayers(sky: NebulaId, skyParallax: number, bounds: Case['bounds']): Layer[] {
  const spec = NEBULAE[sky];
  const nw = coverSpan(skyParallax, VIEW.w, bounds.width);
  const nh = coverSpan(skyParallax, VIEW.h, bounds.height);
  const layers: Layer[] = [
    { shapes: groundSprite(VIEW.w + 2, VIEW.h + 2).shapes, parallax: 0, additive: false },
    {
      shapes: nebulaSprite(sky, VOID_SEED, nw, nh, 1, VIEW.w, VIEW.h).shapes,
      parallax: skyParallax,
      additive: spec.additive,
    },
  ];
  for (const l of STAR_LAYERS) {
    layers.push({
      shapes: starFieldSprite(l, VOID_SEED, coverSpan(l.parallax, VIEW.w, bounds.width), coverSpan(l.parallax, VIEW.h, bounds.height)).shapes,
      parallax: l.parallax,
      additive: false,
    });
  }
  return layers;
}

/** The centre of a shape, in its layer's own field coordinates. */
function shapeCentre(s: Shape): { x: number; y: number } {
  if (s.path.kind === 'circle') return { x: s.path.cx, y: s.path.cy };
  let x = 0;
  let y = 0;
  const n = s.path.points.length / 2;
  for (let i = 0; i < n; i++) {
    x += s.path.points[i * 2]!;
    y += s.path.points[i * 2 + 1]!;
  }
  return { x: x / n, y: y / n };
}

/**
 * The clot to follow: the sky element closest to the middle of the screen at the
 * *centre* camera stop, so it is on screen in all three frames and near enough
 * to the eye's own reference point to be the one a player would have watched.
 *
 * Elements wider than a tenth of the screen are skipped. Every soft body in this
 * file is a nested stack of discs faking a radial falloff, and its outermost
 * stop — or, on Plasma Reef, one of the three broad base washes the reef sits in
 * — is hundreds of px across. Ringing one of those marks half the frame and
 * shows nothing. The small stops share their body's centre, so following one
 * follows the body.
 */
function trackedFeature(layers: readonly Layer[], skyParallax: number, bounds: Case['bounds']): { x: number; y: number; r: number } {
  const sky = layers[1]!;
  const off = cameraOffset(STOPS[1] * bounds.width, bounds.height / 2);
  const pos = layerPos(skyParallax, off);
  const MAX_R = 30;
  const NEAR = 300;
  let best = { x: 0, y: 0, r: 12 };
  let bestScore = -Infinity;
  for (const s of sky.shapes) {
    const r = s.path.kind === 'circle' ? s.path.r : 14;
    if (r > MAX_R) continue;
    const c = shapeCentre(s);
    const d = Math.hypot(pos.x + c.x - VIEW.w / 2, pos.y + c.y - VIEW.h / 2);
    if (d > NEAR) continue;
    // Brightest first, nearest as the tie-break. A soft body's innermost stop is
    // its brightest, so this lands on the CORE of a real clot rather than on the
    // invisible small stop of one of the three broad base washes — which is a
    // legitimate shape of the sky and a useless thing to ask anyone to look at.
    const score = (s.fill?.alpha ?? 0) * 1000 - d / NEAR;
    if (score > bestScore) {
      bestScore = score;
      best = { x: c.x, y: c.y, r };
    }
  }
  return best;
}

/** How much of the visible window this sky paints at all, this frame — the
 *  control on "did the sky get denser?", since the two rows necessarily show
 *  different parts of a differently-sized field. */
function screenCoverage(sky: Layer, off: { x: number; y: number }): number {
  const pos = layerPos(sky.parallax, off);
  const COLS = 84;
  const ROWS = 39;
  let hit = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = ((c + 0.5) / COLS) * VIEW.w - pos.x;
      const y = ((r + 0.5) / ROWS) * VIEW.h - pos.y;
      if (sky.shapes.some((s) => covers(s, x, y))) hit++;
    }
  }
  return hit / (COLS * ROWS);
}

/** Does a shape cover `(x, y)`? Fills only — a sky is fills. (backdrop.test.ts’s
 *  sampler, in the one form this figure needs.) */
function covers(shape: Shape, x: number, y: number): boolean {
  if (!shape.fill) return false;
  if (shape.path.kind === 'circle') {
    const dx = x - shape.path.cx;
    const dy = y - shape.path.cy;
    return dx * dx + dy * dy <= shape.path.r * shape.path.r;
  }
  return shape.path.closed && pointInPoly(shape.path.points, x, y);
}

/** A zoomed window onto the frame, in screen px, for the detail strips. */
interface Crop {
  readonly cx: number;
  readonly cy: number;
  readonly w: number;
  readonly h: number;
  readonly zoom: number;
}

/** One frame as an SVG document, at 1:1 — or cropped and zoomed. */
function frameSvg(
  layers: readonly Layer[],
  off: { x: number; y: number },
  marker: { x: number; y: number; r: number } | null,
  crop?: Crop,
): string {
  const box = crop
    ? { x: crop.cx - crop.w / 2, y: crop.cy - crop.h / 2, w: crop.w, h: crop.h, sw: crop.w * crop.zoom, sh: crop.h * crop.zoom }
    : { x: 0, y: 0, w: VIEW.w, h: VIEW.h, sw: VIEW.w, sh: VIEW.h };
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${box.sw}" height="${box.sh}" ` +
      `viewBox="${box.x.toFixed(2)} ${box.y.toFixed(2)} ${box.w} ${box.h}">`,
    // The ground is a screen-fixed quad sized to the viewport, so a crop that
    // walks off it would show page background; paint the box itself first.
    `<rect x="${box.x.toFixed(2)}" y="${box.y.toFixed(2)}" width="${box.w}" height="${box.h}" fill="${hex(FLOOR)}"/>`,
  ];
  for (const l of layers) {
    const p = layerPos(l.parallax, off);
    const blend = l.additive ? ' style="mix-blend-mode: plus-lighter"' : '';
    parts.push(`<g transform="translate(${p.x.toFixed(3)} ${p.y.toFixed(3)})"${blend}>`);
    parts.push(l.shapes.map(shapeToSvg).join(''));
    // The reference ring rides the DEEP star layer — a fixed point in the star
    // field, so the gap between it and the clot IS the sky's slip against the stars.
    if (marker && l.parallax === STAR_LAYERS[0]!.parallax) {
      const r = 24; // one size for every figure, so two rows' rings compare by eye
      parts.push(
        `<circle cx="${marker.x.toFixed(3)}" cy="${marker.y.toFixed(3)}" r="${r.toFixed(2)}" ` +
          `fill="none" stroke="${hex(DERIVED.hullLight)}" stroke-width="1" stroke-opacity="0.6" stroke-dasharray="4 4"/>`,
      );
    }
    parts.push('</g>');
  }
  parts.push('</svg>');
  return parts.join('');
}

/** One build's rows: the three frames, then the same three zoomed on the ring. */
function row(label: string, sub: string, c: Case, skyParallax: number): string {
  const layers = buildLayers(c.sky, skyParallax, c.bounds);
  const feature = trackedFeature(layers, skyParallax, c.bounds);
  const off0 = cameraOffset(STOPS[0] * c.bounds.width, c.bounds.height / 2);
  // The ring is placed in deep-layer coordinates so that at the FIRST stop it
  // sits exactly on the tracked clot.
  const deep = STAR_LAYERS[0]!.parallax;
  const marker = {
    x: feature.x + off0.x * (skyParallax - deep),
    y: feature.y + off0.y * (skyParallax - deep),
    r: feature.r,
  };
  const cells = STOPS.map((t, i) => {
    const off = cameraOffset(t * c.bounds.width, c.bounds.height / 2);
    const slip = Math.abs((off.x - off0.x) * (skyParallax - deep));
    const skyPx = Math.abs((off.x - off0.x) * skyParallax);
    const starPx = Math.abs((off.x - off0.x) * deep);
    const cover = screenCoverage(layers[1]!, off);
    return `<figure>
      ${frameSvg(layers, off, marker)}
      <figcaption>
        <b>${['far left', 'centre', 'far right'][i]}</b> — ship at x = ${Math.round(t * c.bounds.width)} u<br/>
        sky moved <b>${skyPx.toFixed(0)} px</b> · far stars moved ${starPx.toFixed(0)} px<br/>
        slipped out of its ring by <b>${slip.toFixed(0)} px</b><br/>
        <span class="ctrl">control — sky over ${(cover * 100).toFixed(0)}% of this frame</span>
      </figcaption>
    </figure>`;
  });
  // The same three frames, zoomed on the ring — which is a fixed point in the
  // star field, so the crop is anchored to the STARS. Whatever drifts away from
  // the middle of these crops is drifting away from the star field.
  const details = STOPS.map((t, i) => {
    const off = cameraOffset(t * c.bounds.width, c.bounds.height / 2);
    const ring = layerPos(deep, off);
    const slip = Math.abs((off.x - off0.x) * (skyParallax - deep));
    return `<figure>
      ${frameSvg(layers, off, marker, { cx: ring.x + marker.x, cy: ring.y + marker.y, w: 232, h: 168, zoom: 2.4 })}
      <figcaption>${['far left', 'centre', 'far right'][i]} — off-centre by <b>${slip.toFixed(0)} px</b></figcaption>
    </figure>`;
  });
  return `<section>
    <h2>${label} <span class="sub">${sub}</span></h2>
    <div class="strip">${cells.join('')}</div>
    <h3>the same three frames, 2.4× on the ring — the crop is anchored to the STARS</h3>
    <div class="strip detail">${details.join('')}</div>
  </section>`;
}

const CSS = `
  body { margin: 0; padding: 28px 24px 34px; background: #14181d; color: #b9c2cc;
         font-family: 'Oxanium', ui-monospace, monospace; }
  h1 { font-size: 19px; margin: 0 0 4px; color: #4DC3FF; font-weight: 600; }
  .lede { font-size: 12.5px; margin: 0 0 22px; max-width: 2560px; line-height: 1.55; color: #8b96a3; }
  .lede b { color: #b9c2cc; }
  h2 { font-size: 14px; margin: 20px 0 8px; color: #e7edf3; font-weight: 600; }
  h2 .sub { color: #7E8894; font-weight: 400; font-size: 12px; }
  .strip { display: flex; gap: 14px; }
  figure { margin: 0; }
  figure svg { display: block; border: 1px solid #2b333c; }
  figcaption { font-size: 11px; line-height: 1.5; padding-top: 6px; color: #8b96a3; }
  figcaption b { color: #cfd7e0; font-weight: 600; }
  figcaption .ctrl { color: #6d7783; }
  h3 { font-size: 11.5px; margin: 14px 0 6px; color: #7E8894; font-weight: 400; }
  .detail figure svg { border-color: #39424c; }
`;

function page(c: Case): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
    <h1>${NEBULAE[c.sky].name} — the same flight, before and after (a0-07b)</h1>
    <p class="lede">
      ${c.why}. The map is <b>${c.map}</b> (${c.bounds.width}×${c.bounds.height} u) on the landscape phone
      (${VIEW.w}×${VIEW.h}), the ship flies straight east down the middle, and the three frames are the
      camera at 15%, 50% and 85% across the board. Both rows are the same seed, the same sky, the same
      stars, the same camera arithmetic — <b>one number differs</b>.
      The dashed ring is drawn <b>into the deep star layer</b> at the clot's position in the first frame:
      it is where the star field says that clot should still be. Watch it fall out of the ring.
      <br/>
      Two rows cannot show the same clots, and that is not a cheat: a faster layer needs a wider field
      (<b>coverSpan</b>), so the field's size follows the parallax and the two builds draw a differently
      sized field from the same seed. What must NOT differ is how much sky there is, and the control
      under each frame is that number — the fraction of the visible window the sky paints at all. It is
      a per-screenful property by construction, and it does not move.
    </p>
    ${row('BEFORE — parallax 0.05', 'what the developer reported: half the speed of the farthest stars', c, REPORTED_PARALLAX)}
    ${row('AFTER — parallax 0.085', 'just behind the far star layer, so it travels with the field', c, SKY_PARALLAX)}
  </body></html>`;
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 2680, height: 1200 }, deviceScaleFactor: 1 });
const tab = await ctx.newPage();
for (const c of CASES) {
  const html = page(c);
  writeFileSync(join(OUT, `strip-${c.sky}.html`), html);
  await tab.setContent(html, { waitUntil: 'load' });
  const name = `1-strip-${c.sky}-before-vs-after.png`;
  await tab.screenshot({ path: join(OUT, name), fullPage: true });
  console.log(`  ${name}`);
}
await browser.close();

// The numbers the figure is captioned with, on stdout too, so the PR body can
// quote them without anybody re-reading them off a picture.
const deep = STAR_LAYERS[0]!.parallax;
console.log('\n  per screen-width flown (844 u), on the landscape phone:');
for (const [label, f] of [
  ['before  0.05 ', REPORTED_PARALLAX],
  ['after   0.085', SKY_PARALLAX],
] as const) {
  console.log(
    `    ${label}: sky ${(f * VIEW.w).toFixed(0)} px · far stars ${(deep * VIEW.w).toFixed(0)} px · ` +
      `slip ${((deep - f) * VIEW.w).toFixed(0)} px (${(((deep - f) / deep) * 100).toFixed(0)}% of the field's own travel)`,
  );
}
