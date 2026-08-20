/**
 * evidence/a0-110-friend-or-foe-minimap/hues.mjs — WHICH HUES ARE ON THE MAP.
 * OWNER: UI Engineer (a0-110). Analysis tool, not a golden and not a test.
 *
 * The before/after pair is the argument, but "the map is a rainbow" and "the map
 * is blue and red" are claims a reader should not have to take on trust from two
 * thumbnails. This counts them.
 *
 * ## Method
 *
 * A first pass classified by HUE ANGLE and was thrown away: the map's own backdrop
 * (`#0D1015` Cold Vacuum) and its coverage wash (`#1F2329`) both sit in the blue
 * hue band, so 73% of every crop came back "P1 Azure" in BOTH halves. A measurement
 * that reports the same wrong number before and after is worse than none.
 *
 * So this matches in RGB against the marks as they are ACTUALLY DRAWN. A mark is
 * one of the project's own colours composited at one of `./src/ui/minimap.ts`'s own
 * alpha constants over the map's own backdrop — all three sets are constants, none
 * of them invented here:
 *
 *   COLOURS  the 8 roster identity colours (style-guide §3.1 / `PLAYER_COLORS`),
 *            `plasma` (friendly), `#CB7979` (hostile, the `shotEnemy2` rung),
 *            `hullSteel` (a derelict — nobody's side), `signalYellow` (ore),
 *            `patina`, `threatRed` (the collapse ring)
 *   ALPHAS   MINIMAP_DOT_ALPHA .95, DERELICT .55, SPAWN_PROTECT .4, REMEMBERED .3,
 *            ORE .28, REMEMBERED_ORE .14
 *   OVER     the three backdrop tones the crops actually contain
 *
 * Every (colour x alpha x backdrop) variant is composited, and a pixel is counted
 * for the nearest variant within TOLERANCE in RGB. Everything else — backdrop,
 * wash, antialiased edges, the frame chrome — is left uncounted rather than
 * distributed into the buckets, so the numbers under-count marks slightly and
 * never over-count them. That is the safe direction for this claim.
 *
 * The one ambiguity worth stating: `threatRed` and the hostile `#CB7979` are
 * different tones and separate cleanly, but a dimmed roster blue and a dimmed
 * plasma can land within a few units of each other. Both halves are measured with
 * the identical script, so that error is common-mode.
 *
 * Usage:  node evidence/a0-110-friend-or-foe-minimap/hues.mjs <png> [...]
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { PNG } from 'pngjs';

/** Straight out of src/render/index.ts, src/art/palette.ts and src/ui/lobby.ts.
 *  Each colour carries ONLY the alphas src/ui/minimap.ts can actually draw it at —
 *  a live mark is never drawn at the ore alpha, and pretending otherwise is what
 *  let the first version of this script match empty space. */
const LIVE = [0.95, 0.4, 0.3]; // full, spawn-protected, remembered
const COLOURS = [
  ['P1 Azure', 0x3d7bff, 'roster', LIVE], ['P2 Cyan', 0x22d3c5, 'roster', LIVE],
  ['P3 Spring', 0x3dd68c, 'roster', LIVE], ['P4 Violet', 0x9b5de5, 'roster', LIVE],
  ['P5 Magenta', 0xf15bb5, 'roster', LIVE], ['P6 Orange', 0xff8a3d, 'roster', LIVE],
  ['P7 Chalk', 0xdce3ec, 'roster', LIVE], ['P8 SlateBlue', 0x5c6ce0, 'roster', LIVE],
  ['SIDE friendly (plasma)', 0x4dc3ff, 'side', LIVE],
  ['SIDE hostile (shotEnemy2)', 0xcb7979, 'side', LIVE],
  ['NEUTRAL wreck (hullSteel)', 0x7e8894, 'neutral', [0.55, 0.3]],
  ['ore (signalYellow)', 0xf2d24b, 'reserved', [0.28]],
  // Chrome, declared so it is not misread as a roster hue: the frame rule and the
  // coverage-ring stroke sit near P2 Cyan and would otherwise be counted as a
  // player's identity colour that never left.
  ['chrome (patina)', 0x4fa08b, 'chrome', LIVE],
  ['chrome (own rim, plasmaHot)', 0x9ddeff, 'chrome', LIVE],
  // The radar-coverage disc: plasma, but at the coverage alphas (feature f1) — a
  // side mark is only ever drawn at a LIVE alpha, so the two separate cleanly and
  // the ring stops being counted as somebody's identity colour.
  ['chrome (coverage disc, plasma)', 0x4dc3ff, 'chrome', [0.34, 0.16]],
];
/** The backdrop tones the crops actually contain (vacuum, coverage wash, fogged,
 *  the frame plate). Declared as a CLASS, not as a threshold: a pixel whose nearest
 *  variant is one of these is empty space and is skipped, which is what stops a
 *  dimmed mark tone from swallowing half the map. */
const BACKDROPS = [[13, 16, 21], [31, 35, 41], [7, 9, 16], [32, 40, 45], [22, 25, 31], [20, 23, 29]];
/** Euclidean RGB. Tight on purpose — see the note on under-counting. */
const TOLERANCE = 18;

const variants = [];
for (const [name, hex, family, alphas] of COLOURS) {
  const c = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  for (const a of alphas) {
    for (const bg of BACKDROPS) {
      variants.push({ name, family, rgb: c.map((v, i) => a * v + (1 - a) * bg[i]) });
    }
  }
}
for (const bg of BACKDROPS) variants.push({ name: 'backdrop', family: 'backdrop', rgb: bg });

for (const path of process.argv.slice(2)) {
  const png = PNG.sync.read(readFileSync(path));
  const counts = new Map(COLOURS.map(([name]) => [name, 0]));
  let matched = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
    let best = null, bestD = Infinity;
    for (const v of variants) {
      const d = (r - v.rgb[0]) ** 2 + (g - v.rgb[1]) ** 2 + (b - v.rgb[2]) ** 2;
      if (d < bestD) { bestD = d; best = v; }
    }
    if (!best || best.family === 'backdrop') continue; // empty space, not a mark
    if (Math.sqrt(bestD) <= TOLERANCE) { counts.set(best.name, counts.get(best.name) + 1); matched++; }
  }
  console.log(`\n${basename(path)}  —  ${matched} mark px matched of ${png.width}x${png.height}`);
  for (const [name, , family] of COLOURS) {
    const n = counts.get(name);
    if (n === 0) continue;
    console.log(`  ${String(n).padStart(6)}  ${((n / matched) * 100).toFixed(1).padStart(5)}%  ${name}  [${family}]`);
  }
  const roster = COLOURS.filter(([name, , f]) => f === 'roster' && counts.get(name) > 0);
  const rosterPx = roster.reduce((t, [name]) => t + counts.get(name), 0);
  console.log(`  -> ROSTER identity: ${roster.length} distinct hue(s), ${rosterPx} px (${((rosterPx / matched) * 100).toFixed(1)}%)` +
    (roster.length ? ` — ${roster.map(([n]) => n).join(', ')}` : ''));
  const sidePx = COLOURS.filter(([, , f]) => f === 'side').reduce((t, [name]) => t + counts.get(name), 0);
  console.log(`  -> SIDE colours:    ${sidePx} px (${((sidePx / matched) * 100).toFixed(1)}%)`);
}
