/**
 * evidence/a2-04-no-hull-turrets/measure-frames.mjs — the frames, as numbers.
 * OWNER: Art Agent (brief a2-06).
 *
 * A picture of a station with no guns on it is only evidence if someone measures
 * it. This reads the panels `capture-frames.mjs` wrote and answers the three
 * questions the developer's amendment actually asks, in pixels rather than in
 * adjectives:
 *
 *  1. **Does the refactor move anything?** `frames-before/` (the Cutterhead with
 *     `src/art/stations.ts` at `origin/main`) against `frames/` (the same hull
 *     through the named parts manifest). Must be zero on every panel — the
 *     manifest is a re-composition, not a redraw.
 *  2. **Is the empty ring distinguishable from a fresh spawn?** `shot-0` against
 *     `bare`. Must be zero: if the hull drew its own guns these two would differ,
 *     because a shot-down turret would still be standing on the steel.
 *  3. **Where does the built/bare difference LIVE?** Every differing pixel's
 *     distance from the station centre. All of it must be outboard of the body
 *     radius — that is "the guns are on the buildings layer" stated as geometry
 *     rather than as a claim about the source.
 *
 * The caption band under each canvas is excluded: it is DOM text, it says
 * different words per panel by design, and comparing it would only ever measure
 * the label. `CANVAS` is the panel's own square at the capture's device scale.
 *
 * Usage:  node evidence/a2-04-no-hull-turrets/measure-frames.mjs
 *         (writes frames-measured.json next to itself)
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Panel size in CSS px and the deviceScaleFactor capture-frames.mjs shot at. */
const PANEL = 420;
const DSF = 2;
/** The canvas is the top square; everything below it is the <figcaption>. */
const CANVAS = PANEL * DSF;
/** The station's collision radius (src/sim/constants.ts STATION.radius), on screen. */
const BODY_RADIUS_PX = 64 * DSF;

const read = (rel) => PNG.sync.read(readFileSync(join(HERE, rel)));
const PANELS = ['bare', 'built-4', 'shot-2', 'shot-0'];

/** Differing pixels between two panels, RGB only, canvas area only. */
function diff(a, b) {
  const out = [];
  for (let y = 0; y < CANVAS; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) {
        out.push([x, y]);
      }
    }
  }
  return out;
}

/** How far each differing pixel sits from the station centre, in screen px. */
function radialSpan(pixels) {
  if (pixels.length === 0) return null;
  const cx = CANVAS / 2;
  const cy = CANVAS / 2;
  let min = Infinity;
  let max = 0;
  for (const [x, y] of pixels) {
    const r = Math.hypot(x - cx, y - cy);
    min = Math.min(min, r);
    max = Math.max(max, r);
  }
  return { minPx: Math.round(min), maxPx: Math.round(max) };
}

/**
 * The beacon ring's width across the centre row — the four panels' zoom, measured
 * rather than asserted.
 *
 * BAND-LIMITED ON PURPOSE. The ring sits at 1.09–1.16 R (140–148 px here) and a
 * built turret's art starts at 155 px, and BOTH carry the roster colour — so an
 * unbounded "leftmost to rightmost azure pixel" probe reads the guns on the
 * panels that have guns and returns a different number for each panel, which
 * says nothing about zoom. Everything inside 152 px is ring.
 */
function beaconSpanPx(png) {
  const y = CANVAS / 2;
  const cx = CANVAS / 2;
  const LIMIT = 152;
  const [pr, pg, pb] = [0x3d, 0x7b, 0xff]; // P1 Azure — src/render PLAYER_COLORS[0]
  let first = -1;
  let last = -1;
  for (let x = 0; x < png.width; x++) {
    if (Math.abs(x - cx) >= LIMIT) continue;
    const i = (y * png.width + x) * 4;
    if (Math.abs(png.data[i] - pr) < 40 && Math.abs(png.data[i + 1] - pg) < 40 && Math.abs(png.data[i + 2] - pb) < 40) {
      if (first < 0) first = x;
      last = x;
    }
  }
  return { spanPx: last - first, from: first, to: last };
}

const report = {
  panelPx: CANVAS,
  bodyRadiusPx: BODY_RADIUS_PX,
  sameZoom: {},
  refactorMovesNothing: {},
  emptyRingVsFreshSpawn: null,
  builtDifferenceIsOutboard: {},
};

for (const k of PANELS) report.sameZoom[k] = beaconSpanPx(read(`frames/${k}.png`));

// 1 — the manifest refactor against origin/main's Cutterhead.
for (const k of PANELS) {
  const before = read(`frames-before/${k}.png`);
  const after = read(`frames/${k}.png`);
  report.refactorMovesNothing[k] = {
    size: `${after.width}x${after.height}`,
    differingPixels: before.width === after.width && before.height === after.height ? diff(before, after).length : 'SIZE MISMATCH',
  };
}

const bare = read('frames/bare.png');

// 2 — the ring shot empty, against a station that never built one.
report.emptyRingVsFreshSpawn = { differingPixels: diff(bare, read('frames/shot-0.png')).length };

// 3 — where the turrets' pixels actually are.
for (const k of ['built-4', 'shot-2']) {
  const pixels = diff(bare, read(`frames/${k}.png`));
  const span = radialSpan(pixels);
  report.builtDifferenceIsOutboard[k] = {
    differingPixels: pixels.length,
    ...span,
    entirelyOutboardOfHull: span === null ? null : span.minPx > BODY_RADIUS_PX,
  };
}

writeFileSync(join(HERE, 'frames-measured.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
