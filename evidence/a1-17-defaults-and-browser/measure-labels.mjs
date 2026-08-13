/**
 * evidence/a1-17-defaults-and-browser/measure-labels.mjs — "IT FITS" AS A NUMBER.
 * OWNER: QA Manager (a1-17 §5; a0-32 / #403).
 *
 * a0-32 argues in measured pixels — *"the room is 63.6px and the word is
 * 67.8px"* — so the evidence for it should be measured pixels too, off the
 * frames the served client actually drew. Two clearances, both read from the
 * captured PNGs with no reference to the code that drew them:
 *
 *  1. `& UPGRADE` inside the BUILD button's circle. The circle's interior is
 *     found on the image (the rim is a bright ring); the glyph run is found on
 *     the image (bright pixels on the row band the second line occupies); the
 *     answer is the gap between them, per side.
 *  2. `UPGRADE` inside its wedge, RESTING and SELECTED. Wheel labels are upright
 *     while the wedge is radial, so the constraint is radial: how far from the
 *     hub the furthest glyph pixel reaches, against how far the wheel's own
 *     outer rim reaches on the same ray.
 *
 * A negative clearance is a label crossing its container — the defect a0-32 was
 * filed for. A positive one is the fix, in pixels, on the shipped build.
 *
 *   node evidence/a1-17-defaults-and-browser/measure-labels.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGES = resolve(HERE, '..', 'images');
const readback = JSON.parse(readFileSync(join(HERE, 'readback-labels.json'), 'utf8'));

const load = (name) => PNG.sync.read(readFileSync(join(IMAGES, name)));
const px = (png, x, y) => {
  const i = (png.width * y + x) << 2;
  return { r: png.data[i], g: png.data[i + 1], b: png.data[i + 2] };
};
/** A glyph pixel: the type is near-white on this HUD, and brighter than both the
 *  wedge face it sits on and the rim it must not cross. */
const isGlyph = (p) => p.r > 185 && p.g > 185 && p.b > 185;
/** Anything the wheel or the button drew, as opposed to the black field behind
 *  it — used to find where the shape ENDS. */
const isDrawn = (p) => p.r + p.g + p.b > 96;

const out = { measuredFrom: readback.fullImage, viewport: readback.viewport, results: {} };

// ---------------------------------------------------------------------------
// 1. `& UPGRADE` inside the BUILD button.
// ---------------------------------------------------------------------------
{
  const png = load('a1-17-labels-390-wheel-open.png');
  const b = readback.buildButtonBounds;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;

  // `& UPGRADE` is the button's DIM line — the same ink as the rim it must not
  // cross — so brightness alone cannot separate the two. What separates them is
  // that the rim is the OUTERMOST run on each row and the type is everything
  // inside it. Runs are found per row and the outer one on each side is the rim.
  const lit = (x, y) => {
    const p = px(png, x, y);
    return (p.r + p.g + p.b) / 3 > 100;
  };
  const x0 = Math.round(b.x) - 14;
  const x1 = Math.round(b.x + b.width) + 14;
  const perRow = [];
  for (let y = Math.round(cy) + 4; y < Math.round(b.y + b.height); y += 1) {
    const runs = [];
    let start = null;
    for (let x = x0; x <= x1; x += 1) {
      if (lit(x, y)) {
        if (start === null) start = x;
      } else if (start !== null) {
        runs.push([start, x - 1]);
        start = null;
      }
    }
    if (start !== null) runs.push([start, x1]);
    // A row that shows only the two rim runs carries no type.
    if (runs.length >= 3) {
      perRow.push({ y, rimLeft: runs[0][1], rimRight: runs.at(-1)[0], glyphMinX: runs[1][0], glyphMaxX: runs.at(-2)[1], runs: runs.length });
    }
  }
  const band = { top: perRow[0]?.y ?? null, bottom: perRow.at(-1)?.y ?? null };
  const glyphMinX = Math.min(...perRow.map((r) => r.glyphMinX));
  const glyphMaxX = Math.max(...perRow.map((r) => r.glyphMaxX));
  // The rim's inner edge on the rows the type actually occupies — the narrowest
  // the interior gets anywhere the word is, which is the room the word has.
  const rimInnerLeft = Math.max(...perRow.map((r) => r.rimLeft));
  const rimInnerRight = Math.min(...perRow.map((r) => r.rimRight));

  out.results.buildButton = {
    publishedBounds: b,
    secondLineRowBand: band,
    rowsMeasured: perRow.length,
    glyphRun: { minX: glyphMinX, maxX: glyphMaxX, width: glyphMaxX - glyphMinX + 1 },
    rimInnerEdgeOverThoseRows: { left: rimInnerLeft, right: rimInnerRight, interiorWidth: rimInnerRight - rimInnerLeft - 1 },
    clearanceLeftPx: glyphMinX - rimInnerLeft - 1,
    clearanceRightPx: rimInnerRight - glyphMaxX - 1,
    perRow,
  };
  console.log(
    `BUILD button, "& UPGRADE" (rows ${band.top}-${band.bottom}, ${perRow.length} rows): glyphs span x ${glyphMinX}..${glyphMaxX} = ${glyphMaxX - glyphMinX + 1} px wide; the rim's inner edge over those rows is ${rimInnerLeft + 1}..${rimInnerRight - 1} = ${rimInnerRight - rimInnerLeft - 1} px of room. Clearance left ${glyphMinX - rimInnerLeft - 1} px, right ${rimInnerRight - glyphMaxX - 1} px.`,
  );
}

// ---------------------------------------------------------------------------
// 2. `UPGRADE` inside its wedge — resting, then selected.
// ---------------------------------------------------------------------------
for (const [state, file] of [
  ['resting', 'a1-17-labels-390-wheel-open.png'],
  ['selected', 'a1-17-labels-390-wedge-selected.png'],
]) {
  const png = load(file);
  const cx = readback.viewport.width / 2;
  const cy = readback.viewport.height / 2;

  // The wheel's outer rim, measured along the ray the nine-o'clock wedge points
  // down (180 degrees) and a few either side, on this very frame.
  const rimSamples = [];
  for (const deg of [168, 174, 180, 186, 192]) {
    const a = (deg * Math.PI) / 180;
    let r = 20;
    let last = 20;
    while (r < 260) {
      const x = Math.round(cx + Math.cos(a) * r);
      const y = Math.round(cy + Math.sin(a) * r);
      if (x < 0 || y < 0 || x >= png.width || y >= png.height) break;
      if (isDrawn(px(png, x, y))) last = r;
      r += 1;
    }
    rimSamples.push({ deg, rimRadius: last });
  }
  const rim = Math.min(...rimSamples.map((s) => s.rimRadius));

  // The glyph pixels of the wedge's NAME lines. Restricted to the sector the
  // wedge occupies and to radii outside the hub, so the hub's own numerals and
  // the neighbouring wedges cannot contribute.
  let glyphMaxR = -Infinity;
  let glyphMinR = Infinity;
  let count = 0;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx, dy);
      if (r < 55 || r > rim + 25) continue;
      let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (deg < 0) deg += 360;
      if (deg < 145 || deg > 215) continue; // the nine-o'clock wedge's sector
      if (!isGlyph(px(png, x, y))) continue;
      count += 1;
      glyphMaxR = Math.max(glyphMaxR, r);
      glyphMinR = Math.min(glyphMinR, r);
    }
  }

  out.results[`upgradeShipWedge_${state}`] = {
    frame: file,
    hub: { x: cx, y: cy },
    rimSamples,
    outerRimRadiusPx: rim,
    glyphPixels: count,
    glyphRadiusRange: { min: Number(glyphMinR.toFixed(1)), max: Number(glyphMaxR.toFixed(1)) },
    radialClearanceToRimPx: Number((rim - glyphMaxR).toFixed(1)),
  };
  console.log(
    `UPGRADE SHIP wedge (${state}): ${count} glyph px between r=${glyphMinR.toFixed(1)} and r=${glyphMaxR.toFixed(1)}; the wheel's own rim on those rays is r=${rim}. Radial clearance ${(rim - glyphMaxR).toFixed(1)} px.`,
  );
}

writeFileSync(join(HERE, 'measured-labels.json'), JSON.stringify(out, null, 2));
console.log('wrote measured-labels.json');
