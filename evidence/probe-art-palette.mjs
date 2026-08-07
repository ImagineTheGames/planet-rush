/**
 * evidence/probe-art-palette.mjs — measure, don't squint. OWNER: QA Manager.
 *
 * The art-vs-boards gate turns on value and hue, and a screenshot shown at 78%
 * in a review pane is not something to judge a shade from. This reads the PNGs
 * back with pngjs and reports, for each region of interest:
 *
 *   - the top opaque colours by pixel count, as hex, with their share
 *   - the nearest named token from style-guide.md / src/art/tokens.ts, and the
 *     RGB distance to it, so "close to hullSteel" is a number
 *
 * It also sweeps every column of a full-frame live capture for the VERTICAL SEAM
 * visible at ~83% width in every live screenshot, reporting the column index, its
 * mean colour and the delta against its neighbours — so the seam is either a
 * measured artifact of the shipped renderer or measurably absent.
 *
 * Output: images/palette-readback.json (committed) + a console table.
 * Usage: node evidence/probe-art-palette.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMG = join(HERE, 'images');

/** The contract's shades, from style-guide.md §1–§3 and the GAP-ANALYSIS tables. */
const TOKENS = {
  vacuum: '#0D1015',
  ink: '#262C34',
  hullSteel: '#7E8894',
  hullLightBoard: '#8F99A6',
  hullLightCurrent: '#A5ACB4',
  hullDark: '#383E45',
  bone: '#C6CDD6',
  signalGold: '#F2D24B',
  ore: '#FFC93E',
  plasma: '#4DC3FF',
  danger: '#E24A3B',
  threat: '#B23A3A',
  rockBodyBoard: '#454E59',
  // Shipped rock body as of c2d401f, after a3-01 pulled DERIVED.rockBody to 0x484e57.
  rockBodyShipped: '#484E57',
  // The pre-fix value, kept ONLY so a stray sighting of it is labelled for what it
  // is rather than matched to some unrelated token. Nothing should read this in the
  // asteroid family any more; if the rock rows start matching it again, that is a
  // regression of a3-01.
  rockBodyPreFix: '#939BA5',
  oceanBoard: '#2E6E9E',
  oceanCurrent: '#4F565F',
};

const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
const parse = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const dist = (a, b) => Math.round(Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2));

function nearestToken(rgb) {
  let best = null, bestD = Infinity;
  for (const [name, h] of Object.entries(TOKENS)) {
    const d = dist(rgb, parse(h));
    if (d < bestD) { bestD = d; best = name; }
  }
  return { token: best, hex: TOKENS[best], distance: bestD };
}

/** Top-N colours in a region, quantised to a 6-level-per-channel grid so
 *  anti-aliasing does not shatter one fill into forty near-identical entries. */
function topColours(png, region, n = 8, minAlpha = 200) {
  const { x = 0, y = 0, w = png.width, h = png.height } = region ?? {};
  const bins = new Map();
  let total = 0;
  for (let yy = y; yy < Math.min(y + h, png.height); yy++) {
    for (let xx = x; xx < Math.min(x + w, png.width); xx++) {
      const i = (yy * png.width + xx) * 4;
      if (png.data[i + 3] < minAlpha) continue;
      const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
      const key = `${r >> 3}_${g >> 3}_${b >> 3}`;
      let e = bins.get(key);
      if (!e) { e = { r: 0, g: 0, b: 0, n: 0 }; bins.set(key, e); }
      e.r += r; e.g += g; e.b += b; e.n++;
      total++;
    }
  }
  return [...bins.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, n)
    .map((e) => {
      const rgb = [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)];
      return { hex: hex(...rgb), share: +(e.n / total).toFixed(4), pixels: e.n, nearest: nearestToken(rgb) };
    });
}

/** Colours excluding near-background, so a mostly-empty space frame still
 *  reports the SUBJECT rather than fourteen shades of vacuum. */
function subjectColours(png, region, bgHex = '#0D1015', tol = 26, n = 8) {
  const bg = parse(bgHex);
  const all = topColours(png, region, 400);
  return all.filter((c) => dist(parse(c.hex), bg) > tol).slice(0, n);
}

const read = (p) => PNG.sync.read(readFileSync(join(IMG, p)));

// ---------------------------------------------------------------------------
// The vertical-seam sweep: per-column mean over the mid band of a full frame.
// ---------------------------------------------------------------------------
function columnSweep(png, y0, y1) {
  const cols = [];
  for (let x = 0; x < png.width; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y1; y++) {
      const i = (y * png.width + x) * 4;
      r += png.data[i]; g += png.data[i + 1]; b += png.data[i + 2]; n++;
    }
    cols.push([r / n, g / n, b / n]);
  }
  // A seam is a column that differs from the local background by more than its
  // neighbours do from each other. Score against a window 12px either side.
  const spikes = [];
  for (let x = 14; x < cols.length - 14; x++) {
    const left = cols[x - 14], right = cols[x + 14];
    const bgMean = [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2, (left[2] + right[2]) / 2];
    const d = dist(cols[x].map(Math.round), bgMean.map(Math.round));
    if (d >= 6) spikes.push({ x, mean: hex(...cols[x].map((v) => Math.round(v))), delta: d });
  }
  // Collapse runs of adjacent columns into one reported band.
  const bands = [];
  for (const s of spikes) {
    const last = bands[bands.length - 1];
    if (last && s.x - last.x1 <= 3) { last.x1 = s.x; last.peak = Math.max(last.peak, s.delta); last.cols.push(s); }
    else bands.push({ x0: s.x, x1: s.x, peak: s.delta, cols: [s] });
  }
  return bands.map((b) => ({ x0: b.x0, x1: b.x1, width: b.x1 - b.x0 + 1, peakDelta: b.peak,
                             mean: b.cols[Math.floor(b.cols.length / 2)].mean }));
}

const out = { tokens: TOKENS, regions: {}, seam: {} };

// --- ROCK: the live asteroid field vs the board's rocks ---------------------
{
  const live = read('live/scene-field-crop.png');
  out.regions.rockLive = subjectColours(live, null, TOKENS.vacuum, 26, 8);
  const board = read('boards/scene-00.png'); // "Mining run" — rocks fill the frame
  out.regions.rockBoard = subjectColours(board, { x: 0, y: 0, w: board.width, h: Math.round(board.height * 0.72) }, '#0D1015', 26, 8);
}

// --- HULL: each live hull crop vs the matching board card SVG ---------------
{
  const names = ['hull-0-interceptor', 'hull-1-vanguard', 'hull-2-excavator', 'hull-3-hauler'];
  out.regions.hullLive = {};
  for (const nme of names) {
    const p = read(`live/${nme}.png`);
    // Left 55% only: the home planet's blue rim intrudes on the right of the crop.
    out.regions.hullLive[nme] = subjectColours(p, { x: 0, y: 0, w: Math.round(p.width * 0.55), h: p.height }, TOKENS.vacuum, 26, 8);
  }
  out.regions.hullBoard = {};
  for (let i = 0; i < 4; i++) {
    const p = read(`boards/hull-svg-${i}.png`);
    out.regions.hullBoard[`hull-svg-${i}`] = subjectColours(p, null, TOKENS.vacuum, 26, 8);
  }
}

// --- PLANET: the live home vs the board's siege planet ----------------------
// Measured off the SIEGE frame, not the raw pinned one. `?freeze=1` pins the sim
// at tick 120 — two seconds, inside SPAWN_PROTECTION_S — and render/index.ts:656
// draws a spawn-protected station at alpha 0.75, so the pinned frame's planet is
// a quarter faded. `__repairStage.siege()` lifts the protection first, so this is
// the paint. (A first pass read the ocean off the pinned frame and got #2C4F6A;
// the same pixels un-faded are measured below.)
{
  const live = read('live/scene-siege-home.png');
  const c = Math.round(live.width / 2);
  out.regions.planetLive = topColours(live, { x: c - 150, y: c - 150, w: 300, h: 300 }, 8);
  out.regions.planetLiveFadedForContrast = topColours(read('live/scene-home-defended.png'),
    { x: c - 150, y: c - 150, w: 300, h: 300 }, 4);
  const board = read('boards/scene-02.png');
  out.regions.planetBoard = topColours(board, { x: Math.round(board.width * 0.60), y: Math.round(board.height * 0.20),
                                                w: Math.round(board.width * 0.22), h: Math.round(board.width * 0.22) }, 8);
}

// --- HUD chrome: the top strip of the live match vs the board's mockup ------
{
  const live = read('live/ui-match-hud-full.png');
  out.regions.hudLive = subjectColours(live, { x: 0, y: 0, w: live.width, h: 240 }, TOKENS.vacuum, 26, 10);
  const board = read('boards/ui-svg-00.png');
  out.regions.hudBoard = subjectColours(board, { x: 0, y: 0, w: board.width, h: 240 }, '#0D1015', 26, 10);
}

// --- The vertical seam ------------------------------------------------------
for (const f of ['live/ui-match-hud-full.png', 'live/scene-arena-full.png', 'live/scene-alarm-full.png', 'live/ui-menu-title.png']) {
  const png = read(f);
  const bands = columnSweep(png, Math.round(png.height * 0.28), Math.round(png.height * 0.42));
  out.seam[f] = { width: png.width, height: png.height,
                  bands: bands.filter((b) => b.peakDelta >= 6).map((b) => ({ ...b, xFrac: +(b.x0 / png.width).toFixed(3) })) };
}

writeFileSync(join(IMG, 'palette-readback.json'), JSON.stringify(out, null, 2));

const line = (label, arr) => console.log(label.padEnd(26), (arr ?? []).slice(0, 5)
  .map((c) => `${c.hex} ${(c.share * 100).toFixed(1)}% ~${c.nearest.token}/${c.nearest.distance}`).join('  '));
console.log('=== ROCK ===');
line('live field', out.regions.rockLive);
line('board scene-00', out.regions.rockBoard);
console.log('=== HULLS (live) ===');
for (const [k, v] of Object.entries(out.regions.hullLive)) line(k, v);
console.log('=== HULLS (board) ===');
for (const [k, v] of Object.entries(out.regions.hullBoard)) line(k, v);
console.log('=== PLANET ===');
line('live home (siege, unfaded)', out.regions.planetLive);
line('live home (spawn-faded)', out.regions.planetLiveFadedForContrast);
line('board scene-02', out.regions.planetBoard);
console.log('=== HUD TOP STRIP ===');
line('live match', out.regions.hudLive);
line('board mockup', out.regions.hudBoard);
console.log('=== VERTICAL SEAM SWEEP ===');
for (const [k, v] of Object.entries(out.seam)) console.log(k.padEnd(30), JSON.stringify(v.bands));
