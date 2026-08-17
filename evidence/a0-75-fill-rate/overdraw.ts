/**
 * evidence/a0-75-fill-rate/overdraw.ts — the void's fill, counted rather than
 * timed. OWNER: Art Agent (a0-75).
 *
 * `./sweep.mjs` and `./attribute.mjs` time the frame on a box with no GPU. This
 * file needs no GPU at all: it walks the **same `SpriteDef`s the game builds**
 * and adds up the area every shape covers, so the answer to *"which layer is the
 * fill"* is arithmetic on the shipped geometry rather than a millisecond off
 * somebody's machine. It is the number that travels: a fragment shaded on the
 * developer's ultrawide is the same fragment shaded here.
 *
 *   npx vite-node evidence/a0-75-fill-rate/overdraw.ts
 *
 * ## What "overdraw" means here
 *
 * The area a layer paints, divided by the area of the field it paints it over.
 * Because the void is authored **per screenful** (`backdrop.ts`
 * `NebulaSpec.build`: feature size from the viewport, element count from
 * field-area ÷ screen-area) the ratio is the same over the whole field as it is
 * over one screen — so it is also **the number of times the GPU touches each
 * screen pixel for that layer, every frame**. That is the whole of a0-75 in one
 * sentence: overdraw is viewport-INDEPENDENT, so per-frame cost is
 * `pixels × Σ overdraw`, and pixels is the only thing that moves when the
 * developer drags the window corner.
 */
import { writeFileSync } from 'node:fs';
import {
  MAP_NEBULA,
  NEBULAE,
  NEBULA_IDS,
  STAR_LAYERS,
  VOID_SEED,
  coverSpan,
  nebulaSprite,
  reducedSkyDensity,
  starFieldSprite,
  type NebulaId,
} from '../../src/art/backdrop';
import type { Shape, SpriteDef } from '../../src/art/shapes';

/** The wide arena (`src/sim/maps.ts` `WIDE`) — oval and diamond fly over it, and
 *  it is the bigger of the two boards, so it is the honest denominator. */
const WIDE = { width: 3200, height: 2000 };
const SQUARE = { width: 2400, height: 2400 };

/** The sweep the brief names, plus the phone the same build runs smoothly on. */
const VIEWPORTS = [
  { name: 'phone (798×384)', w: 798, h: 384 },
  { name: '1280×720', w: 1280, h: 720 },
  { name: '1920×1080', w: 1920, h: 1080 },
  { name: '2560×1440', w: 2560, h: 1440 },
  { name: '3440×1440', w: 3440, h: 1440 },
  { name: '5120×1440', w: 5120, h: 1440 },
];

/** The polygon's own area, by the shoelace formula. */
function polyArea(points: readonly number[]): number {
  let a = 0;
  const n = points.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += points[2 * i]! * points[2 * j + 1]! - points[2 * j]! * points[2 * i + 1]!;
  }
  return Math.abs(a) / 2;
}

/** The polyline's length — what a stroke's area is width times. */
function polyLength(points: readonly number[], closed: boolean): number {
  let len = 0;
  const n = points.length / 2;
  for (let i = 0; i + 1 < n; i++) {
    len += Math.hypot(points[2 * i + 2]! - points[2 * i]!, points[2 * i + 3]! - points[2 * i + 1]!);
  }
  if (closed && n > 1) {
    len += Math.hypot(points[0]! - points[2 * n - 2]!, points[1]! - points[2 * n - 1]!);
  }
  return len;
}

/**
 * The area one shape asks the rasteriser to shade, px².
 *
 * A soft fill counts its **whole** path, not some effective radius: alpha
 * reaching zero at the rim costs a blend exactly like alpha 1 does. That is the
 * point a "subtle" layer keeps getting the benefit of the doubt on, and it is
 * why a sky that no one can see is still the most expensive thing in the frame.
 */
export function shapeArea(shape: Shape): number {
  let area = 0;
  if (shape.fill) {
    area += shape.path.kind === 'circle' ? Math.PI * shape.path.r ** 2 : polyArea(shape.path.points);
  }
  if (shape.stroke) {
    const len =
      shape.path.kind === 'circle'
        ? 2 * Math.PI * shape.path.r
        : polyLength(shape.path.points, shape.path.closed);
    area += len * shape.stroke.width;
  }
  return area;
}

export function spriteArea(def: SpriteDef): number {
  let a = 0;
  for (const s of def.shapes) a += shapeArea(s);
  return a;
}

/** One layer's contribution to the frame. */
export interface LayerCost {
  readonly key: string;
  /** Shapes in the whole baked field — what the vertex stage sees each frame. */
  readonly shapes: number;
  /** Area painted, px², over the whole field. */
  readonly area: number;
  /** The field this layer covers, px². */
  readonly fieldArea: number;
  /** `area / fieldArea` — times each screen pixel is touched, per frame. */
  readonly overdraw: number;
}

export interface BackdropCost {
  readonly nebula: NebulaId;
  readonly viewport: string;
  readonly width: number;
  readonly height: number;
  readonly layers: readonly LayerCost[];
  readonly overdraw: number;
  /** Fragments blended per frame at this viewport, 1× (no MSAA). */
  readonly fragments: number;
}

/** Split a star field into its two populations, so the bloom can be priced on
 *  its own — the halo disc and the diffraction cross are what a0-44/a0-45 made
 *  big and bright, and the brief asks whether that cost is where it went. */
function splitStars(def: SpriteDef): { points: Shape[]; bloom: Shape[] } {
  const points: Shape[] = [];
  const bloom: Shape[] = [];
  for (const s of def.shapes) {
    const isSpike = s.path.kind === 'poly' && !s.path.closed;
    const isHalo = Boolean(s.fill?.falloff);
    (isSpike || isHalo ? bloom : points).push(s);
  }
  return { points, bloom };
}

export function backdropCost(
  nebula: NebulaId,
  viewW: number,
  viewH: number,
  bounds = WIDE,
  density = 1,
): BackdropCost {
  const layers: LayerCost[] = [];

  // The ground: one opaque quad the size of the viewport. Overdraw 1 by
  // construction, and it is the only layer here that is not a blend.
  layers.push({
    key: 'ground',
    shapes: 1,
    area: (viewW + 2) * (viewH + 2),
    fieldArea: viewW * viewH,
    overdraw: ((viewW + 2) * (viewH + 2)) / (viewW * viewH),
  });

  if (nebula !== 'none') {
    const spec = NEBULAE[nebula];
    const nw = coverSpan(spec.parallax, viewW, bounds.width);
    const nh = coverSpan(spec.parallax, viewH, bounds.height);
    const def = nebulaSprite(nebula, VOID_SEED, nw, nh, density, viewW, viewH);
    layers.push({
      key: `sky/${nebula}${spec.additive ? ' (additive)' : ''}`,
      shapes: def.shapes.length,
      area: spriteArea(def),
      fieldArea: nw * nh,
      overdraw: spriteArea(def) / (nw * nh),
    });
  }

  for (const spec of STAR_LAYERS) {
    const w = coverSpan(spec.parallax, viewW, bounds.width);
    const h = coverSpan(spec.parallax, viewH, bounds.height);
    const def = starFieldSprite(spec, VOID_SEED, w, h);
    const { points, bloom } = splitStars(def);
    const areaOf = (ss: Shape[]): number => ss.reduce((a, s) => a + shapeArea(s), 0);
    layers.push({
      key: `stars/${spec.key} points`,
      shapes: points.length,
      area: areaOf(points),
      fieldArea: w * h,
      overdraw: areaOf(points) / (w * h),
    });
    layers.push({
      key: `stars/${spec.key} bloom`,
      shapes: bloom.length,
      area: areaOf(bloom),
      fieldArea: w * h,
      overdraw: areaOf(bloom) / (w * h),
    });
  }

  const overdraw = layers.reduce((a, l) => a + l.overdraw, 0);
  return {
    nebula,
    viewport: `${viewW}×${viewH}`,
    width: viewW,
    height: viewH,
    layers,
    overdraw,
    fragments: overdraw * viewW * viewH,
  };
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

function fmt(n: number, w = 8, d = 3): string {
  return n.toFixed(d).padStart(w);
}

const lines: string[] = [];
const say = (s = ''): void => {
  lines.push(s);
  console.log(s);
};

say('a0-75 — the void\'s per-frame fill, counted off the shipped geometry');
say('='.repeat(78));
say();
say('OVERDRAW IS VIEWPORT-INDEPENDENT — the same layer stack at six sizes');
say('(sky: Plasma Reef, the wide arena. "×" = times each screen pixel is blended)');
say();
say(`${'viewport'.padEnd(18)}${'Mpx'.padStart(7)}${'ground'.padStart(9)}${'sky'.padStart(9)}${'stars'.padStart(9)}${'bloom'.padStart(9)}${'TOTAL ×'.padStart(10)}${'Mfrag/fr'.padStart(11)}`);
const perViewport: BackdropCost[] = [];
for (const vp of VIEWPORTS) {
  const c = backdropCost('plasmaReef', vp.w, vp.h);
  perViewport.push(c);
  const sum = (pred: (k: string) => boolean): number =>
    c.layers.filter((l) => pred(l.key)).reduce((a, l) => a + l.overdraw, 0);
  say(
    vp.name.padEnd(18) +
      fmt((vp.w * vp.h) / 1e6, 7, 2) +
      fmt(sum((k) => k === 'ground'), 9) +
      fmt(sum((k) => k.startsWith('sky/')), 9) +
      fmt(sum((k) => k.includes('points')), 9) +
      fmt(sum((k) => k.includes('bloom')), 9) +
      fmt(c.overdraw, 10) +
      fmt(c.fragments / 1e6, 11, 1),
  );
}
say();
say('The overdraw column does not move. The fragment column is a straight line');
say('through the pixel count — which is exactly the report: "it gets worse the');
say('larger the playing area is on my screen".');
say();

say('EVERY SKY, AT 3440×1440 ON THE WIDE ARENA');
say();
say(
  `${'sky'.padEnd(14)}${'map'.padEnd(11)}${'shapes'.padStart(8)}${'sky ×'.padStart(9)}${'+ground'.padStart(9)}${'+stars'.padStart(9)}${'TOTAL ×'.padStart(10)}${'reduced ×'.padStart(11)}`,
);
const mapOf = (id: NebulaId): string =>
  Object.entries(MAP_NEBULA).find(([, v]) => v === id)?.[0] ?? '—';
const skyRows: Record<string, unknown>[] = [];
for (const id of NEBULA_IDS) {
  const full = backdropCost(id, 3440, 1440);
  const spec = NEBULAE[id];
  const reduced = backdropCost(id, 3440, 1440, WIDE, id === 'none' ? 1 : reducedSkyDensity(spec));
  const skyOd = full.layers.filter((l) => l.key.startsWith('sky/')).reduce((a, l) => a + l.overdraw, 0);
  const starOd = full.layers.filter((l) => l.key.startsWith('stars/')).reduce((a, l) => a + l.overdraw, 0);
  const shapes = full.layers.filter((l) => l.key.startsWith('sky/')).reduce((a, l) => a + l.shapes, 0);
  say(
    spec.name.padEnd(14) +
      mapOf(id).padEnd(11) +
      String(shapes).padStart(8) +
      fmt(skyOd, 9) +
      fmt(1, 9) +
      fmt(starOd, 9) +
      fmt(full.overdraw, 10) +
      fmt(reduced.overdraw, 11),
  );
  skyRows.push({ sky: spec.name, id, map: mapOf(id), shapes, skyOd, starOd, total: full.overdraw, reduced: reduced.overdraw });
}
say();
say('THE STAR FIELD, BY POPULATION (3440×1440, wide arena)');
say();
const stars = backdropCost('none', 3440, 1440);
say(`${'layer'.padEnd(24)}${'shapes'.padStart(9)}${'overdraw ×'.padStart(12)}`);
for (const l of stars.layers) {
  if (l.key === 'ground') continue;
  say(l.key.padEnd(24) + String(l.shapes).padStart(9) + fmt(l.overdraw, 12, 4));
}
say();
say('SQUARE ARENA (octagon/compass/crescents/line), 3440×1440');
say();
for (const id of NEBULA_IDS) {
  const c = backdropCost(id, 3440, 1440, SQUARE);
  say(`  ${NEBULAE[id].name.padEnd(14)}${fmt(c.overdraw, 9)} ×   ${fmt(c.fragments / 1e6, 8, 1)} Mfrag/frame`);
}

writeFileSync(new URL('./overdraw.json', import.meta.url), `${JSON.stringify({ perViewport, skyRows, stars }, null, 2)}\n`);
writeFileSync(new URL('./overdraw.txt', import.meta.url), `${lines.join('\n')}\n`);
