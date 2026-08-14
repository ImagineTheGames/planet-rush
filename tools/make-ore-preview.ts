/**
 * tools/make-ore-preview.ts — the ore-chunk review page. OWNER: Art & Audio Agent.
 *
 *   npx vite-node tools/make-ore-preview.ts        # writes assets/preview/ore-in-scene.html
 *
 * ## Why this file exists twice
 *
 * The a0-41 brief quotes this generator by name as the place the ratified
 * crystalline chunk was drawn — the page the developer reviewed before saying
 * *"ok crystaline with these options"* — and instructs the port to take the shape
 * from it rather than re-derive one. **It was not in the repository**: no commit
 * on any ref ever added `tools/make-ore-preview.ts` or `assets/preview/ore-in-scene.html`,
 * and no branch carried them. The review happened; the instrument was never
 * committed, which is precisely the failure mode `docs/dark-matter-scan.md` is
 * about, one level up — a decision whose evidence lives nowhere a later session
 * can reach.
 *
 * So a0-41 writes it back, and writes it back in the one shape that cannot rot:
 * **every variant on this page is derived from the shipped `oreChunkSprite`**,
 * by adding and removing shapes from the sprite IR (`src/art/shapes`) rather
 * than by re-implementing the options beside it. A `SpriteDef` is plain data, so
 * "drop the halo" is a filter and "make the rim subtle" is a scaled alpha. The
 * page therefore cannot show a chunk the game does not draw, and the ratified
 * cell of the matrix is the shipped sprite itself, untouched.
 *
 * ## What is on the page
 *
 * Every FACET × RIM × HALO combination, on three grounds, at the chunk's **real
 * sim radius of 6 world units** beside the 64-unit station — because the whole
 * point of the review was that a chunk is small, and a decision taken on a
 * 128 px tile is a decision about a picture nobody sees.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { oreChunkSprite } from '../src/art/asteroids';
import { NEBULAE } from '../src/art/backdrop';
import { MOCKUP_GROUND } from '../src/art/mockup-reference';
import { PALETTE } from '../src/art/palette';
import type { Shape, SpriteDef } from '../src/art/shapes';
import { shapeToSvg } from '../src/art/svg';
import { CHUNK, STATION } from '../src/sim/constants';

// ---------------------------------------------------------------------------
// The option matrix, as transforms of the shipped sprite
// ---------------------------------------------------------------------------

/** The developer's pick, per the ruling — the cell this page exists to justify. */
const RATIFIED = { facet: 'three-tone', rim: 'dark', halo: 'strong' } as const;

type Facet = 'flat' | 'two-tone' | 'three-tone';
type Rim = 'none' | 'dark';
type Halo = 'none' | 'subtle' | 'strong';

const FACETS: readonly Facet[] = ['flat', 'two-tone', 'three-tone'];
const RIMS: readonly Rim[] = ['none', 'dark'];
const HALOS: readonly Halo[] = ['none', 'subtle', 'strong'];

/** How much the **Strong** halo multiplies the subtle one's alphas by (the ruling). */
const STRONG_OVER_SUBTLE = 2.1;

/**
 * The shipped sprite, taken apart. The layer order in `oreChunkSprite` is fixed
 * and documented there: two halo discs, the rimmed body, the shadowed facet, the
 * lit facet. Asserted rather than assumed — if the generator ever grows a sixth
 * layer this throws instead of silently drawing five sixths of the chunk.
 */
function layers(seed: number): {
  halo: readonly Shape[];
  body: Shape;
  shadow: Shape;
  lit: Shape;
} {
  const def: SpriteDef = oreChunkSprite(seed);
  if (def.shapes.length !== 5) {
    throw new Error(`oreChunkSprite now has ${def.shapes.length} layers; this page assumes 5`);
  }
  const [h0, h1, body, shadow, lit] = def.shapes as readonly Shape[] & { length: 5 };
  return { halo: [h0!, h1!], body: body!, shadow: shadow!, lit: lit! };
}

/** One cell of the matrix, as a shape list in the sprite's own unit space. */
function variant(seed: number, facet: Facet, rim: Rim, halo: Halo): Shape[] {
  const { halo: haloShapes, body, shadow, lit } = layers(seed);
  const out: Shape[] = [];

  if (halo !== 'none') {
    const k = halo === 'strong' ? 1 : 1 / STRONG_OVER_SUBTLE;
    for (const h of haloShapes) {
      out.push({ ...h, fill: { ...h.fill!, alpha: h.fill!.alpha * k } });
    }
  }

  // The rim is a STROKE on the body, never a polygon scaled up behind it: on a
  // seven-sided silhouette a scaled polygon shows its corners where a stroke
  // follows the edge. Dropping it is therefore dropping the stroke, not a shape.
  out.push(rim === 'dark' ? body : { path: body.path, role: body.role, fill: body.fill });

  if (facet !== 'flat') out.push(shadow);
  if (facet === 'three-tone') out.push(lit);
  return out;
}

// ---------------------------------------------------------------------------
// The three grounds
// ---------------------------------------------------------------------------

const luma = (c: number): number =>
  0.2126 * ((c >> 16) & 0xff) + 0.7152 * ((c >> 8) & 0xff) + 0.0722 * (c & 0xff);

/** Mix `a` toward `b` by `t`, per channel. */
function mix(a: number, b: number, t: number): number {
  const ch = (sh: number): number =>
    Math.round(((a >> sh) & 0xff) * (1 - t) + ((b >> sh) & 0xff) * t) << sh;
  return ch(16) | ch(8) | ch(0);
}

/**
 * The brightest ground an ore chunk is ever drawn on: Floor lifted to the
 * brightest sky's own measured `peakLuma` (`src/art/backdrop` `NebulaSpec`), in
 * that sky's hue. Not invented — solved against the number `backdrop.test.ts`
 * pins, so the review's worst case is the game's worst case.
 */
function brightestSky(): { color: number; label: string } {
  const spec = [...Object.values(NEBULAE)].sort((a, b) => b.peakLuma - a.peakLuma)[0]!;
  const target = spec.peakLuma;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const t = (lo + hi) / 2;
    if (luma(mix(MOCKUP_GROUND, PALETTE.plasma, t)) < target) lo = t;
    else hi = t;
  }
  return {
    color: mix(MOCKUP_GROUND, PALETTE.plasma, (lo + hi) / 2),
    label: `${spec.name} at its brightest — Y′ ${target.toFixed(1)}, the ceiling backdrop.test.ts pins`,
  };
}

const GROUNDS = [
  { color: MOCKUP_GROUND, label: `Floor — the ground the play-field is drawn on (Y′ ${luma(MOCKUP_GROUND).toFixed(1)})` },
  { color: PALETTE.vacuum, label: `Vacuum — the §1 contrast rule's reference (Y′ ${luma(PALETTE.vacuum).toFixed(1)})` },
  brightestSky(),
];

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** A shape list placed at `(cx, cy)` with unit radius `1` mapped to `r` px. */
function place(shapes: readonly Shape[], cx: number, cy: number, r: number): string {
  return `<g transform="translate(${cx} ${cy}) scale(${r})">${shapes.map(shapeToSvg).join('')}</g>`;
}

/**
 * One in-scene band: the station at its real radius and a scatter of chunks at
 * theirs, at `zoom` screen px per world unit. `STATION.radius` is 64 and
 * `CHUNK.radius` is 6 — the ratio is the whole reason this page exists, and it
 * is read from the sim's own constants so it can never be drawn flattering.
 */
function scene(ground: { color: number; label: string }, shapes: readonly Shape[][], zoom: number): string {
  const w = 620;
  const h = 190;
  const parts = [`<rect width="${w}" height="${h}" fill="${hex(ground.color)}"/>`];
  // The station's disc, as a plain silhouette — this page is about the ore, and a
  // full cutterhead here would review the facility instead.
  parts.push(
    `<circle cx="70" cy="${h / 2}" r="${STATION.radius * zoom}" fill="${hex(0x2d3239)}" stroke="${hex(0x484e57)}" stroke-width="2"/>`,
  );
  const spread = [
    [190, 60],
    [250, 120],
    [320, 45],
    [370, 140],
    [430, 85],
    [490, 35],
    [520, 150],
    [560, 100],
  ];
  for (let i = 0; i < spread.length; i++) {
    const [x, y] = spread[i]!;
    parts.push(place(shapes[i % shapes.length]!, x!, y!, CHUNK.radius * zoom));
  }
  return `<figure><svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join('')}</svg><figcaption>${ground.label} · ${zoom}× — station r${STATION.radius}, ore r${CHUNK.radius}</figcaption></figure>`;
}

/** One matrix cell: the chunk at a reviewable size, on the given ground. */
function tile(ground: number, shapes: readonly Shape[], label: string, ratified: boolean): string {
  const size = 104;
  const svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="${hex(ground)}"/>${place(shapes, size / 2, size / 2, size / 2 / 1.05)}</svg>`;
  return `<figure class="${ratified ? 'pick' : ''}">${svg}<figcaption>${label}${ratified ? ' ← PICKED' : ''}</figcaption></figure>`;
}

function page(): string {
  const seeds = [0, 1, 2, 3];
  const shipped = seeds.map((s) => variant(s, RATIFIED.facet, RATIFIED.rim, RATIFIED.halo));

  const bands = GROUNDS.map((g) => [scene(g, shipped, 1), scene(g, shipped, 4)].join('')).join('');

  const matrix = GROUNDS.map((g) => {
    const cells: string[] = [];
    for (const facet of FACETS) {
      for (const rim of RIMS) {
        for (const halo of HALOS) {
          const ratified = facet === RATIFIED.facet && rim === RATIFIED.rim && halo === RATIFIED.halo;
          cells.push(tile(g.color, variant(0, facet, rim, halo), `${facet} · rim ${rim} · halo ${halo}`, ratified));
        }
      }
    }
    return `<h3>${g.label}</h3><div class="grid">${cells.join('')}</div>`;
  }).join('');

  const chunks = seeds
    .map((s) => tile(MOCKUP_GROUND, variant(s, RATIFIED.facet, RATIFIED.rim, RATIFIED.halo), `seed ${s}`, false))
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Ore chunk — in scene (a0-41)</title>
<style>
 body { background:${hex(PALETTE.vacuum)}; color:#dce3ec; font:14px/1.5 system-ui,sans-serif; margin:24px 32px; max-width:1100px }
 h1,h2,h3 { font-weight:600; letter-spacing:.02em }
 h1 { font-size:20px } h2 { font-size:16px; margin-top:32px } h3 { font-size:13px; color:#7e8894; margin-top:24px }
 figure { display:inline-block; margin:0 12px 16px 0; vertical-align:top }
 figcaption { font-size:11px; color:#7e8894; margin-top:4px; max-width:200px }
 .pick figcaption { color:${hex(PALETTE.signalYellow)} }
 .pick svg { outline:2px solid ${hex(PALETTE.signalYellow)} }
 .grid { display:flex; flex-wrap:wrap }
 p { color:#9aa4b0; max-width:70ch }
</style></head><body>
<h1>Ore chunk — in scene</h1>
<p>Generated by <code>tools/make-ore-preview.ts</code> off the shipped
<code>oreChunkSprite</code>. Every variant below is the shipped sprite with shapes
added or removed, so nothing here is a picture the game cannot draw.</p>
<p>The ruling: <strong>CRYSTALLINE, three-tone facet, dark rim, strong halo</strong>
— seven facets at unit radius 0.62, shadowed lower-right at <code>oreDeep</code> α.9,
lit upper-left at <code>coreHot</code> α.9, rim
<code>filledStroke(signalYellow, oreDeep, 0.09, 'ore')</code>, halo α 0.21/0.336 at
r 0.98/0.72.</p>
<h2>In scene — real radii</h2>
${bands}
<h2>The four chunks</h2>
<p>Four seeds carry a 120-chunk field; the variety has to live in four shapes or
the field reads as tiling.</p>
<div class="grid">${chunks}</div>
<h2>The matrix — FACET × RIM × HALO</h2>
${matrix}
</body></html>
`;
}

const OUT = resolve(import.meta.dirname, '../assets/preview/ore-in-scene.html');
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, page());
process.stdout.write(`wrote ${OUT}\n`);
