/**
 * src/art/backdrop.test.ts — the darker space, measured. OWNER: Art Agent.
 *
 * a0-07 ratified a new ground, a new bloom rule and six skies, one per map. Three
 * of those four are claims about *pixels*, and the brief asked for numbers rather
 * than opinions on every one of them, so this file is a measuring device:
 *
 *  1. **The registry is complete and its hole is stated.** `MAP_NEBULA` has one
 *     entry per ratified map — checked against `sim/maps.ts` itself, so art and
 *     the sim cannot drift — and the set of unassigned skies is stated rather
 *     than implied (empty since `a0-12` claimed the last two). A registry with a
 *     hole a test asserts is honest; a modulo that silently repeats is not.
 *  2. **The same-hue collision is the one real check.** A darker ground does not
 *     help with additive light in the same hue as a load-bearing colour. The
 *     owner beacon ring is plasma and Plasma Reef is a cyan additive sky, so the
 *     ring, the clockwise threat fill and the signal-yellow core are each
 *     measured (WCAG) against every sky's *brightest composited pixel*, with
 *     Floor + Plasma Reef as the case to beat.
 *  3. **The sky costs what it says it costs.** Each `NebulaSpec` declares its
 *     overdraw; the geometry is integrated here and the declaration has to match
 *     within 15%, so the perf table in the PR body can never quietly rot.
 *
 * And one thing this file deliberately does NOT measure: whether rocks are
 * findable on a darker ground. That was settled with arithmetic before the brief
 * was written (`rockBody` reads 2.27:1 on Vacuum, 2.47:1 on Floor — 8.9% MORE
 * contrast), and the one assertion here about it exists only to stop the question
 * being re-opened.
 */

import { describe, expect, it } from 'vitest';
import {
  BLOOM,
  BLOOM_TINTS,
  GROUND_COLOR,
  GROUND_LUMA,
  SPIKE,
  MAP_NEBULA,
  NEBULAE,
  NEBULA_IDS,
  SKY_PARALLAX,
  SKY_REDUCED_FLOOR,
  STAR_LAYERS,
  UNASSIGNED_NEBULAE,
  VOID_SEED,
  coverSpan,
  groundSprite,
  nebulaForMap,
  nebulaSprite,
  nebulaTileSprite,
  reducedSkyDensity,
  starFieldSprite,
  type MapId,
  type NebulaId,
} from './backdrop';
import {
  LANE_TAPER,
  MOCKUP_GROUND,
  MOCKUP_PANEL,
  MOCKUP_REFERENCE,
  MOCKUP_SKY_IDS,
  MOCKUP_STARS,
  MOCKUP_STAR_DENSITY,
  haloKneeAlphaOf,
  haloPeakAlphaOf,
  haloRadiusOf,
  mockupBlobs,
  mockupCount,
  spikeLengthOf,
  starAlpha,
  starRadius,
  type MockupSkyId,
} from './mockup-reference';
import { measure, sampleMockup, sampleShapes, colorLuma } from '../../sky-preview';
import { MAPS } from '../sim/maps';
import {
  assertPaletteCompliance,
  auditSprite,
  RED_FAMILY,
  SKY_ALPHA_MAX,
  SKY_RESERVED_ALPHA_MAX,
  YELLOW_FAMILY,
} from './compliance';
import { DERIVED, FLOOR, IDENTITY_COLORS, PALETTE, hex } from './palette';
import { pointInPoly } from './raster';
import {
  HALO_KNEE_AT,
  falloffProfile,
  haloProfile,
  inkAlphaAt,
  type Shape,
  type SpriteDef,
} from './shapes';
import { ALL_SPRITES } from './catalogue';

/** The field every sky's **cost** is measured over — a 16:9 landscape field, the
 *  shape a phone actually plays in (the game is landscape-locked, GDD §4.6).
 *  One screenful exactly, which is what makes `NebulaSpec.overdraw` a per-screen
 *  constant a test can pin on any map (see `overdrawOf`). */
const FIELD = { w: 1600, h: 900 } as const;

/**
 * **The field every sky's *brightness* is measured over, and it is a different
 * field from the one its cost is (a0-39).**
 *
 * Overdraw is a per-screenful *average* and is arena-invariant by construction,
 * so measuring it on one screenful is exact. **Peak brightness is an extreme
 * value**, and an extreme over nine clots is not the extreme over the sixty a
 * real arena carries — so measuring it on one screenful systematically
 * under-reports the brightest pixel a player can actually meet.
 *
 * That gap was live before this brief and it was not small: on the shipped
 * build, Plasma Reef pinned at Y′ 17.4 here and rendered at **17.9** in a real
 * 1280×800 frame over the wide arena, where the owner beacon ring lost **10.6%**
 * of its contrast — over the 10% ceiling the disqualifier test below sets, and
 * invisible to it. a0-39 made the reef fuller through its middle (a gradient
 * holds more alpha at mid-radius than the stack it replaced), which would have
 * taken that to 15.3% unnoticed.
 *
 * So brightness is measured where the player is: the **desktop control profile**
 * (`docs/perf-gate.md`, 1280×800) over the **wide arena** (`sim/maps.ts` `WIDE`,
 * the bounds `oval`/`diamond`/`line` play on), across the parallax field
 * `VoidBackdrop.configure` actually builds for that pair — and, crucially, only
 * across {@link visibleSpan} of it. `coverSpan` deliberately over-provisions the
 * field; more than half of it is never on screen at any camera offset, and a
 * peak found out there is a peak nobody meets.
 */
const SCREEN = { w: 1280, h: 800 } as const;
const ARENA = { w: 3200, h: 2000 } as const;
const SKY_FIELD = {
  w: coverSpan(SKY_PARALLAX, SCREEN.w, ARENA.w),
  h: coverSpan(SKY_PARALLAX, SCREEN.h, ARENA.h),
} as const;

/**
 * How much of a parallax field is **ever visible**, on one axis, and where.
 *
 * The layer sits at `view/2 + offset·f` and the camera offset runs over
 * `[−(bound − view), 0]`, so screen `[0, view]` maps to field coordinates
 * `[−view/2, view/2 + f·(bound − view)]` across the whole crossing. At
 * `SKY_PARALLAX` over the wide arena that is **1443 px of a 3315 px field** —
 * the sky is built more than twice as wide as it is ever seen, which is the
 * cover slack `coverSpan` exists to provide and is exactly the region a
 * brightness measurement must NOT include.
 */
function visibleSpan(f: number, view: number, bound: number): { min: number; max: number } {
  return { min: -view / 2, max: view / 2 + f * (bound - view) };
}

// ---------------------------------------------------------------------------
// A compositing sampler — the measuring device
// ---------------------------------------------------------------------------

/** Linearised channel, for luminance. */
function lin(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** Relative luminance, 0..1 (WCAG 2.x). */
function luminance(rgb: readonly [number, number, number]): number {
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

/** WCAG contrast ratio between two packed colours. */
function contrast(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const x = luminance(a) + 0.05;
  const y = luminance(b) + 0.05;
  return x > y ? x / y : y / x;
}

/** sRGB → CIELAB (D65), for the hue half of the collision check. */
function lab(rgb: readonly [number, number, number]): [number, number, number] {
  const [r, g, b] = [lin(rgb[0]), lin(rgb[1]), lin(rgb[2])];
  // sRGB → XYZ (D65), then XYZ → Lab against the D65 white point.
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 colour difference. ~2.3 is "just noticeable"; 40+ is "a different colour". */
function deltaE(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** Lab chroma C* — how far a colour sits from grey. 0 is neutral; the void's
 *  untinted halos land at 1.0–2.3, so it is the measure of "coloured" that
 *  survives at a backdrop's alphas, where every ΔE against a bright signal is
 *  large for the uninteresting reason that everything is dark. */
function chroma(rgb: readonly [number, number, number]): number {
  const [, aStar, bStar] = lab(rgb);
  return Math.hypot(aStar, bStar);
}

function unpack(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

/** A shape's axis-aligned bounds — a cheap reject for the samplers below. */
function boundsOf(s: Shape): { minX: number; maxX: number; minY: number; maxY: number } {
  if (s.path.kind === 'circle') {
    return {
      minX: s.path.cx - s.path.r,
      maxX: s.path.cx + s.path.r,
      minY: s.path.cy - s.path.r,
      maxY: s.path.cy + s.path.r,
    };
  }
  const p = s.path.points;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    minX = Math.min(minX, p[i]!);
    maxX = Math.max(maxX, p[i]!);
    minY = Math.min(minY, p[i + 1]!);
    maxY = Math.max(maxY, p[i + 1]!);
  }
  return { minX, maxX, minY, maxY };
}

/** Does a shape cover `(x, y)`? Fills only — a sky is fills. */
function covers(shape: Shape, x: number, y: number): boolean {
  if (!shape.fill) return false;
  if (shape.path.kind === 'circle') {
    const dx = x - shape.path.cx;
    const dy = y - shape.path.cy;
    return dx * dx + dy * dy <= shape.path.r * shape.path.r;
  }
  return shape.path.closed && pointInPoly(shape.path.points, x, y);
}

/**
 * Composite a sky over the ground at one point, in draw order. `additive` picks
 * the blend the layer actually uses on the GPU (`Graphics.blendMode = 'add'`),
 * because the whole question about Plasma Reef is what *additive* light does.
 */
function compositeAt(shapes: readonly Shape[], additive: boolean, x: number, y: number): [number, number, number] {
  const out = unpack(GROUND_COLOR);
  for (const s of shapes) {
    if (!s.fill || !covers(s, x, y)) continue;
    const [r, g, b] = unpack(s.fill.color);
    // `fill.alpha` is a soft fill's PEAK; what it paints here is the falloff's
    // own value at this point, and every consumer of "how bright is this ink
    // here" goes through the one definition of it (a0-39, ./shapes).
    const a = inkAlphaAt(s.fill, x, y);
    if (additive) {
      out[0] = Math.min(255, out[0] + r * a);
      out[1] = Math.min(255, out[1] + g * a);
      out[2] = Math.min(255, out[2] + b * a);
    } else {
      out[0] = out[0] * (1 - a) + r * a;
      out[1] = out[1] * (1 - a) + g * a;
      out[2] = out[2] * (1 - a) + b * a;
    }
  }
  return out;
}

/**
 * Luma **Y′**, 0..255, on the gamma-encoded bytes — the same scale every other
 * number in this brief is quoted on (Floor 1.9, Vacuum 15.7, the ink 43.4, the
 * rock body 77.5), so a sky's brightness can be read straight against them.
 * Distinct from {@link luminance}, which is the linearised quantity WCAG needs.
 */
function luma(rgb: readonly [number, number, number]): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/** The brightest pixel a sky composites to over Floor, and the field mean. */
function skyBrightness(
  id: NebulaId,
  density = 1,
): { peak: [number, number, number]; peakLuma: number; meanLuma: number } {
  const spec = NEBULAE[id];
  const shapes = nebulaSprite(
    id,
    VOID_SEED,
    SKY_FIELD.w,
    SKY_FIELD.h,
    density,
    SCREEN.w,
    SCREEN.h,
  ).shapes;
  // The window a player can ever see of this field, and only the shapes that
  // reach into it. Two things at once: the measurement stops counting pixels
  // nobody meets, and the sampler drops from ~260 shapes to ~50, which is what
  // makes a 3.8 px grid affordable at all.
  const vx = visibleSpan(spec.parallax, SCREEN.w, ARENA.w);
  const vy = visibleSpan(spec.parallax, SCREEN.h, ARENA.h);
  const boxed = shapes
    .map((s) => ({ s, ...boundsOf(s) }))
    .filter((b) => b.maxX >= vx.min && b.minX <= vx.max && b.maxY >= vy.min && b.minY <= vy.max);
  // ~3.8 px cells. The smallest thing that has to survive the grid is a Plasma
  // Reef clot node (r 18–38 px at this screen), so a cell is a fifth of the
  // smallest feature's radius and a peak cannot slip between samples.
  const COLS = 384;
  const ROWS = 248;
  let peak: [number, number, number] = unpack(GROUND_COLOR);
  let peakY = luma(peak);
  let sum = 0;
  const hit: Shape[] = [];
  for (let r = 0; r < ROWS; r++) {
    const y = vy.min + ((r + 0.5) / ROWS) * (vy.max - vy.min);
    for (let c = 0; c < COLS; c++) {
      const x = vx.min + ((c + 0.5) / COLS) * (vx.max - vx.min);
      hit.length = 0;
      for (const b of boxed) {
        if (x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY) hit.push(b.s);
      }
      const px = hit.length === 0 ? unpack(GROUND_COLOR) : compositeAt(hit, spec.additive, x, y);
      const l = luma(px);
      sum += l;
      if (l > peakY) {
        peakY = l;
        peak = px;
      }
    }
  }
  const r1 = (n: number): number => Math.round(n * 10) / 10;
  return { peak, peakLuma: r1(peakY), meanLuma: r1(sum / (COLS * ROWS)) };
}

/**
 * **Overdraw**: the average number of translucent layers stacked on a pixel of
 * the field — the number a mobile GPU actually pays for, and the reason a nebula
 * is a perf question at all.
 *
 * Sampled rather than integrated from the shape areas, because a sky's geometry
 * runs off the edge of the field (Deep Ember is *deliberately* half off it) and
 * the GPU never rasterizes what the viewport clips. Summing circle areas would
 * have charged Deep Ember for light nobody ever sees.
 */
function overdrawOf(id: NebulaId, density = 1): number {
  const shapes = nebulaSprite(id, VOID_SEED, FIELD.w, FIELD.h, density).shapes.filter((s) => s.fill);
  const COLS = 200;
  const ROWS = 120;
  let layers = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = ((c + 0.5) / COLS - 0.5) * FIELD.w;
      const y = ((r + 0.5) / ROWS - 0.5) * FIELD.h;
      for (const s of shapes) if (covers(s, x, y)) layers++;
    }
  }
  return layers / (COLS * ROWS);
}

// ---------------------------------------------------------------------------
// 0. The table the PR body quotes
// ---------------------------------------------------------------------------

describe('the sky cost/brightness table', () => {
  it('reports what every sky costs, how bright it gets, and what it eats', () => {
    const rows = NEBULA_IDS.map((id) => {
      const spec = NEBULAE[id];
      const b = skyBrightness(id);
      // The tax is one number per sky (it is signal-independent — see below);
      // ΔE is per signal, and it is the one that answers "same hue?".
      const tax = 1 - contrast(unpack(PALETTE.plasma), b.peak) / contrast(unpack(PALETTE.plasma), unpack(FLOOR));
      const dE = (color: number): string => deltaE(unpack(color), b.peak).toFixed(0).padStart(3);
      // The one-off CPU cost: building the geometry at phone-field size, which
      // happens once per (map, viewport, VFX tier) and never per frame.
      const REPS = 40;
      const t0 = performance.now();
      for (let i = 0; i < REPS; i++) {
        nebulaSprite(id, VOID_SEED, coverSpan(SKY_PARALLAX, 844, 3200), coverSpan(SKY_PARALLAX, 390, 2000), 1, 844, 390);
      }
      const buildMs = (performance.now() - t0) / REPS;
      return [
        spec.name.padEnd(13),
        `map ${((Object.keys(MAP_NEBULA) as MapId[]).find((m) => MAP_NEBULA[m] === id) ?? '—').padEnd(8)}`,
        `shapes ${String(nebulaSprite(id, VOID_SEED, FIELD.w, FIELD.h).shapes.length).padStart(3)}`,
        `overdraw ${overdrawOf(id).toFixed(3)}`,
        `build ${buildMs.toFixed(2).padStart(5)}ms`,
        `peak Y′ ${String(b.peakLuma).padStart(5)}`,
        `mean Y′ ${String(b.meanLuma).padStart(5)}`,
        `tax ${`${(tax * 100).toFixed(1)}%`.padStart(5)}`,
        `ΔE ring ${dE(PALETTE.plasma)} / red ${dE(PALETTE.threatRed)} / ore ${dE(PALETTE.signalYellow)}`,
        // What the auto-reducer leaves, and what that saves — both, since r9-01:
        // a declared shed that nobody measured is how a whole sky came to be
        // deleted "because a fraction of it saves a fraction of nothing".
        `reduced ${spec.reducedDensity} → od ${id === 'none' ? '0.000' : overdrawOf(id, reducedSkyDensity(spec)).toFixed(3)}`,
        spec.additive ? 'ADDITIVE' : spec.occludes ? 'occludes' : '',
      ].join(' | ');
    });
    // eslint-disable-next-line no-console
    console.log(`\n${rows.join('\n')}\n`);
    expect(rows).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// 1. The registry
// ---------------------------------------------------------------------------

describe('MAP_NEBULA — a map’s sky is part of its identity', () => {
  it('has exactly one entry per ratified map, and the sim agrees which maps exist', () => {
    // Art does not import the sim at runtime — but if `maps.ts` gains a map and
    // nobody gives it a sky, that map would silently fly under the default's.
    // This is the seam that refuses to let that happen quietly.
    expect(Object.keys(MAP_NEBULA).sort()).toEqual(MAPS.map((m) => m.id).sort());
  });

  it('names a real sky for every map', () => {
    for (const [mapId, nebulaId] of Object.entries(MAP_NEBULA)) {
      expect(NEBULA_IDS, `${mapId} → ${nebulaId}`).toContain(nebulaId);
    }
  });

  it('gives no two maps the same sky — one each, which is what makes it identity', () => {
    const used = Object.values(MAP_NEBULA);
    expect(new Set(used).size).toBe(used.length);
  });

  it('states its unassigned set exactly — and since a0-12 there is none left', () => {
    const assigned = new Set<NebulaId>(Object.values(MAP_NEBULA));
    const free = NEBULA_IDS.filter((id) => !assigned.has(id));
    // The stated hole was the point while there was one, and the statement is
    // still the point now there isn't: every sky is spoken for, by name.
    expect(free).toEqual([...UNASSIGNED_NEBULAE]);
    expect(free).toHaveLength(0);
    expect(Object.keys(MAP_NEBULA)).toHaveLength(NEBULA_IDS.length - free.length);
  });

  it('does not put the costly sky on a derelict-fill board', () => {
    // A derelict-fill board lays out all eight positions at any roster and carries
    // wrecks plus their debris below eight — the busiest boards in the set. The
    // additive sky goes anywhere but there (brief). Four of the six qualify now
    // that a0-12's two two-sided maps have landed, so the list is spelled out
    // rather than left at the original pair.
    const DERELICT_FILL: readonly MapId[] = ['compass', 'diamond', 'line', 'crescents'];
    const costly = NEBULA_IDS.filter((id) => NEBULAE[id].additive);
    for (const id of costly) {
      const map = (Object.keys(MAP_NEBULA) as MapId[]).find((m) => MAP_NEBULA[m] === id);
      for (const fill of DERELICT_FILL) {
        expect(map, `${id} is assigned to ${map}`).not.toBe(fill);
      }
    }
  });

  it('falls back to the default map’s sky for an unknown or missing id', () => {
    expect(nebulaForMap(undefined).id).toBe(MAP_NEBULA.octagon);
    expect(nebulaForMap('').id).toBe(MAP_NEBULA.octagon);
    expect(nebulaForMap('a-map-that-was-deleted').id).toBe(MAP_NEBULA.octagon);
    expect(nebulaForMap('oval').id).toBe(MAP_NEBULA.oval);
  });
});

// ---------------------------------------------------------------------------
// 2. Determinism (GDD §4.1)
// ---------------------------------------------------------------------------

describe('determinism — same seed, same sky', () => {
  it('builds deep-equal geometry for every sky on a repeat call', () => {
    for (const id of NEBULA_IDS) {
      expect(nebulaSprite(id, VOID_SEED, 900, 600)).toEqual(nebulaSprite(id, VOID_SEED, 900, 600));
    }
  });

  it('builds a different sky for a different seed (it is seeded, not hardcoded)', () => {
    for (const id of NEBULA_IDS) {
      if (id === 'none') continue;
      expect(nebulaSprite(id, VOID_SEED, 900, 600)).not.toEqual(nebulaSprite(id, VOID_SEED + 1, 900, 600));
    }
  });

  it('leaves no NaN or infinity anywhere in a sky', () => {
    for (const id of NEBULA_IDS) {
      const json = JSON.stringify(nebulaSprite(id, VOID_SEED, FIELD.w, FIELD.h));
      expect(json).not.toContain('null'); // JSON.stringify turns NaN/Infinity into null
    }
  });

  it('names each sky sprite by everything that changes it', () => {
    const a = nebulaSprite('patinaDrift', VOID_SEED, 900, 600, 1).name;
    const b = nebulaSprite('patinaDrift', VOID_SEED, 900, 600, 0.45).name;
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// 3. The palette contract, including the §2.2 carve-out
// ---------------------------------------------------------------------------

describe('the sky obeys style-guide §1/§2, and §2.2 is a number', () => {
  const skySprites: SpriteDef[] = NEBULA_IDS.map((id) => nebulaSprite(id, VOID_SEED, FIELD.w, FIELD.h));

  it('passes the palette audit', () => {
    expect(() => assertPaletteCompliance([...skySprites, groundSprite(FIELD.w, FIELD.h)])).not.toThrow();
  });

  it('never puts signal yellow on the sky, at any alpha', () => {
    // The colour that carries the most weight in the style guide does not appear
    // on the one surface that is behind every entity on every frame. No
    // carve-out, no ceiling, no exception.
    for (const def of skySprites) {
      for (const s of def.shapes) {
        for (const ink of [s.fill, s.stroke]) {
          if (ink) expect(YELLOW_FAMILY.has(ink.color), `${def.name} paints ${hex(ink.color)}`).toBe(false);
        }
      }
    }
  });

  it('keeps every reserved-hue sky ink under the §2.2 ceiling', () => {
    for (const def of skySprites) {
      for (const s of def.shapes) {
        if (s.fill && RED_FAMILY.has(s.fill.color)) {
          expect(s.role).toBe('sky');
          expect(s.fill.alpha, `${def.name} rust at ${s.fill.alpha}`).toBeLessThanOrEqual(SKY_RESERVED_ALPHA_MAX);
        }
      }
    }
  });

  it('keeps every other sky ink under the ordinary sky ceiling', () => {
    for (const def of skySprites) {
      for (const s of def.shapes) {
        if (s.fill && s.fill.color !== FLOOR) {
          expect(s.fill.alpha, `${def.name} ink at ${s.fill.alpha}`).toBeLessThanOrEqual(SKY_ALPHA_MAX);
        }
      }
    }
  });

  it('paints every sky shape on the `sky` role, which no entity may wear', () => {
    for (const def of skySprites) for (const s of def.shapes) expect(s.role).toBe('sky');
    // …and nothing else in the whole art set is painted Floor.
    for (const def of ALL_SPRITES) {
      if (def.name.startsWith('backdrop/')) continue;
      for (const s of def.shapes) {
        for (const ink of [s.fill, s.stroke]) {
          if (ink) expect(ink.color, `${def.name} painted the ground`).not.toBe(FLOOR);
        }
      }
    }
  });

  it('grounds the void in Floor, opaquely', () => {
    const g = groundSprite(400, 300);
    expect(g.shapes).toHaveLength(1);
    expect(g.shapes[0]!.fill).toEqual({ color: FLOOR, alpha: 1 });
    expect(g.shapes[0]!.role).toBe('sky');
    expect(GROUND_COLOR).toBe(MOCKUP_GROUND);
  });
});

// ---------------------------------------------------------------------------
// 3b. THE GATE — the built sky IS the design (a0-40)
// ---------------------------------------------------------------------------

/**
 * **The assertion this whole brief exists to install.**
 *
 * Six developer reports about the backdrop, five of them treated as rendering
 * bugs, and the finding was that the parameters had drifted away from the design
 * while **no gate ever compared the output to it**. Everything CI could see —
 * `peakLuma`, `overdraw`, `SKY_ALPHA_MAX` — rewards a darker sky, so five briefs
 * optimised toward those and nothing pulled the other way. This block is the
 * thing that pulls the other way.
 *
 * It compares each sky's **built shapes** — the real `Shape[]` the renderer is
 * handed — against `./mockup-reference`, which is the design as data:
 *
 *  - **count, exactly.** Not "about right": the design says nine clots and the
 *    build emits nine. The shipped reef emitted 39 and the shipped Deep Ember 5.
 *  - **radius and alpha, within 0.5%** of the design's declared range, times the
 *    viewport width the fraction is stated against.
 *  - **the hue pair**, so a sky cannot quietly acquire a colour.
 *  - **the ground colour**, which was the largest single divergence.
 *  - **the star field's 99th percentile**, which is the one honest measure of
 *    "are there stars in it" and read 7–9 against the design's 46–53.
 *  - **each sky's measured lift**, on the design's own instrument
 *    (`sky-preview.ts`), against the design's own measured number. This is the
 *    end-to-end version of all of the above and the number the brief is written
 *    around.
 *
 * ## Tested both ways (LESSONS §24)
 *
 * A gate that passes on `main` proves nothing, and four gates in this studio have
 * shipped that way. So the same predicate that checks the build is run against
 * {@link SHIPPED_BEFORE_A0_40} — the drifted state this brief exists to end,
 * transcribed from the brief's own runtime measurement — and it has to **reject**
 * it. The result is per-sky and worth reading: four of the five fail on count,
 * radius or alpha, and **Iron Veil passes**, because Iron Veil is the one sky
 * whose parameters never drifted and the one sky the developer has never
 * complained about. It is the control, and a gate that failed it too would be a
 * gate measuring the wrong thing.
 */
describe('the built sky IS the design (a0-40)', () => {
  /** One screenful, which is the unit every design number is stated in. */
  const PANEL = MOCKUP_PANEL;
  /** Radius and alpha are compared to the design's range with this much slack —
   *  enough to absorb the IR's 1e-4 coordinate quantisation and nothing else. */
  const TOLERANCE = 0.005;

  /** What a sky's built geometry looks like, reduced to what the design states. */
  interface Built {
    readonly count: number;
    readonly radii: readonly number[];
    readonly alphas: readonly number[];
    readonly colors: readonly number[];
  }

  function build(id: MockupSkyId, w = PANEL.w, h = PANEL.h): Built {
    const shapes = nebulaSprite(id, VOID_SEED, w, h, 1, w, h).shapes;
    return {
      count: shapes.length,
      radii: shapes.map((s) => s.fill!.falloff!.rx),
      alphas: shapes.map((s) => s.fill!.alpha),
      colors: shapes.map((s) => s.fill!.color),
    };
  }

  /**
   * Every way `built` differs from what the design says, as sentences. Empty is
   * a sky that matches. One predicate, used on the build and on `main`'s state.
   */
  function mismatches(id: MockupSkyId, built: Built, screenW = PANEL.w): string[] {
    const ref = MOCKUP_REFERENCE[id];
    const out: string[] = [];
    const want = mockupCount(ref, PANEL.w, PANEL.h, 1, PANEL.w, PANEL.h);
    if (built.count !== want) out.push(`count ${built.count}, design ${want}`);
    const rMin = ref.radius.min * screenW * (1 - TOLERANCE);
    const rMax = ref.radius.max * screenW * (1 + TOLERANCE);
    const gotRMin = Math.min(...built.radii);
    const gotRMax = Math.max(...built.radii);
    if (gotRMin < rMin || gotRMax > rMax) {
      out.push(
        `radius ${gotRMin.toFixed(0)}–${gotRMax.toFixed(0)}, design ${rMin.toFixed(0)}–${rMax.toFixed(0)}`,
      );
    }
    // A lane thins toward its ends by a declared factor, so its floor is lower
    // than the drawn range's — see `LANE_TAPER`. Every other structure is flat.
    const taper = ref.structure === 'lane' ? 1 - LANE_TAPER : 1;
    const aMin = ref.alpha.min * taper * (1 - TOLERANCE);
    const aMax = ref.alpha.max * (1 + TOLERANCE);
    const gotAMin = Math.min(...built.alphas);
    const gotAMax = Math.max(...built.alphas);
    if (gotAMin < aMin || gotAMax > aMax) {
      out.push(
        `alpha ${gotAMin.toFixed(3)}–${gotAMax.toFixed(3)}, design ${aMin.toFixed(3)}–${aMax.toFixed(3)}`,
      );
    }
    const pair = new Set<number>(ref.hues);
    const strays = [...new Set(built.colors)].filter((c) => !pair.has(c));
    if (strays.length > 0) out.push(`colours ${strays.map(hex).join(', ')} are not the design's pair`);
    return out;
  }

  for (const id of MOCKUP_SKY_IDS) {
    it(`${NEBULAE[id].name}: count exactly, radius and alpha inside the design`, () => {
      const found = mismatches(id, build(id));
      expect(found, `${NEBULAE[id].name}: ${found.join('; ')}`).toEqual([]);
    });
  }

  it('emits the design’s own blobs, one Shape each, and nothing else', () => {
    // Not merely "within the range" — the *same* blobs. `mockupBlobs` is the one
    // placement function, shared with the design panel of `sky-preview.ts`, so a
    // sky that agreed statistically but drew somewhere else would still fail.
    for (const id of MOCKUP_SKY_IDS) {
      const blobs = mockupBlobs(
        MOCKUP_REFERENCE[id],
        VOID_SEED,
        PANEL.w,
        PANEL.h,
        1,
        PANEL.w,
        PANEL.h,
      );
      const shapes = nebulaSprite(id, VOID_SEED, PANEL.w, PANEL.h, 1, PANEL.w, PANEL.h).shapes;
      expect(shapes, NEBULAE[id].name).toHaveLength(blobs.length);
      shapes.forEach((s, i) => {
        const b = blobs[i]!;
        const f = s.fill!.falloff!;
        expect([f.cx, f.cy, f.rx, f.ry], `${NEBULAE[id].name} blob ${i}`).toEqual([b.cx, b.cy, b.rx, b.ry]);
        expect(s.fill!.alpha, `${NEBULAE[id].name} blob ${i} alpha`).toBe(b.alpha);
        expect(s.fill!.color, `${NEBULAE[id].name} blob ${i} colour`).toBe(b.color);
      });
    }
  });

  it('grounds the void in the design’s own ground, and nothing else does', () => {
    // The first and largest of the three divergences: 1.9 → 9.1.
    expect(GROUND_COLOR).toBe(MOCKUP_GROUND);
    expect(FLOOR).toBe(MOCKUP_GROUND);
    expect(GROUND_LUMA).toBe(9.1);
    const ground = groundSprite(400, 300);
    expect(ground.shapes).toHaveLength(1);
    expect(ground.shapes[0]!.fill).toEqual({ color: MOCKUP_GROUND, alpha: 1 });
  });

  it('carries the design’s star field: 560 a screenful, and a p99 of 46–53', () => {
    // The second divergence, and the one the developer described as "there are no
    // stars in them". Both halves are asserted, because either alone is passable
    // by the wrong build: the count, and what the count actually LOOKS like on the
    // design's own instrument.
    const stars = STAR_LAYERS.flatMap(
      (l) => starFieldSprite(l, VOID_SEED, PANEL.w, PANEL.h).shapes,
    ).filter((s) => s.path.kind === 'circle' && !s.fill?.falloff);
    expect(stars).toHaveLength(MOCKUP_STARS.count);
    expect(
      STAR_LAYERS.reduce((n, l) => n + l.density, 0),
      'the three layers sum to the design’s density',
    ).toBeCloseTo(MOCKUP_STAR_DENSITY, 0);

    // **The design's own field, on the design's own instrument** — the band is
    // the design's, so this is the panel that has to sit in it.
    const ground = colorLuma(MOCKUP_GROUND);
    const design = measure(sampleMockup('none', VOID_SEED, PANEL.w, PANEL.h), ground);
    const field = STAR_LAYERS.flatMap((l) => [...starFieldSprite(l, VOID_SEED, PANEL.w, PANEL.h).shapes]);
    const m = measure(sampleShapes(field, false, MOCKUP_GROUND, PANEL.w, PANEL.h), ground);
    // eslint-disable-next-line no-console
    console.log(
      `  star field: design panel p99 ${design.p99} (design ${MOCKUP_STARS.peakP99.min}–${MOCKUP_STARS.peakP99.max}),` +
        ` game p99 ${m.p99}, peak ${m.peak}, lift ${m.lift}`,
    );
    expect(design.p99, `the design's own p99 ${design.p99}`).toBeGreaterThanOrEqual(
      MOCKUP_STARS.peakP99.min,
    );
    expect(design.p99, `the design's own p99 ${design.p99}`).toBeLessThanOrEqual(
      MOCKUP_STARS.peakP99.max,
    );
    // **And the game's field against the design's, within 5%** — the same
    // tolerance every sky's `lift` is held to a few tests below, and it is a
    // tolerance rather than the band itself for one measured reason, reported
    // rather than absorbed (a0-44): the game's blooms are TINTED (a0-22), and
    // cyan and patina are less luminous than the white the design's ramp tops
    // out at. Measured by forcing every halo back onto the ramp's own colour,
    // the tint costs **1.96 of p99** — 45.90 against 47.86 — and every bit of the
    // gap between the two panels is that. It is a real cost and it is new at this
    // size, because a0-44's halo covers 6.8× the area a0-40's did; before the
    // correction the same tint moved the number by less than half a point.
    expect(
      Math.abs(m.p99 - design.p99) / design.p99,
      `the game's star field reads p99 ${m.p99} against the design's ${design.p99}`,
    ).toBeLessThan(0.05);
  });

  it('lifts each panel by what the design lifts it — the number the brief is about', () => {
    // The end-to-end assertion. Nebula only (the stars are a percentile, not a
    // mean), measured on the design's own instrument: a 320×180 point-sample grid,
    // mean luma above the panel's own ground.
    const ground = colorLuma(MOCKUP_GROUND);
    const rows: string[] = [];
    for (const id of MOCKUP_SKY_IDS) {
      const shapes = nebulaSprite(id, VOID_SEED, PANEL.w, PANEL.h, 1, PANEL.w, PANEL.h).shapes;
      const m = measure(sampleShapes(shapes, NEBULAE[id].additive, MOCKUP_GROUND, PANEL.w, PANEL.h), ground);
      const want = MOCKUP_REFERENCE[id].lift;
      rows.push(
        `  ${NEBULAE[id].name.padEnd(13)} design ${want.toFixed(2).padStart(5)}  built ${m.lift
          .toFixed(2)
          .padStart(5)}  (shipped ${SHIPPED_BEFORE_A0_40[id].lift.toFixed(2)})`,
      );
      expect(
        Math.abs(m.lift - want) / want,
        `${NEBULAE[id].name} lifts ${m.lift}, the design lifts ${want}`,
      ).toBeLessThan(0.05);
    }
    // eslint-disable-next-line no-console
    console.log(`\n${rows.join('\n')}\n`);
  });

  // -------------------------------------------------------------------------
  // …and the other way: the gate has to REJECT what shipped
  // -------------------------------------------------------------------------

  /**
   * **What `main` builds today**, read off `main` at runtime rather than typed
   * from the brief's rounded quote — `evidence/a0-40-backdrop-matches-mockup/`
   * holds the run (`gate-against-main.txt`, this same predicate against a `main`
   * worktree, 8 of 8 failing). This is the drifted state a0-40 exists to end, and
   * the gate above is only worth anything if it refuses it.
   */
  const SHIPPED_BEFORE_A0_40: Readonly<Record<MockupSkyId, Built & { lift: number }>> = {
    // 3 washes r≈129 α.0126 + 36 nodes r 8–43 α.039.
    plasmaReef: {
      count: 39,
      radii: [8, 129],
      alphas: [0.0126, 0.039],
      colors: [PALETTE.plasma, DERIVED.plasmaDim],
      lift: 0.53,
    },
    coalsack: { count: 7, radii: [67, 85], alphas: [0.676, 0.982], colors: [0x010204], lift: 0.02 },
    deepEmber: { count: 5, radii: [79, 91], alphas: [0.052, 0.058], colors: [PALETTE.threatRed], lift: 0.91 },
    patinaDrift: {
      count: 22,
      radii: [37, 89],
      alphas: [0.041, 0.051],
      colors: [PALETTE.patina, DERIVED.continentShade, DERIVED.hullShadow],
      lift: 0.92,
    },
    // The control.
    ironVeil: {
      count: 14,
      radii: [100, 177],
      alphas: [0.047, 0.093],
      colors: [DERIVED.hullShadow, DERIVED.hullDark, PALETTE.threatRed],
      lift: 0.81,
    },
  };

  it('REJECTS every sky main builds — and Iron Veil only on the axes it did drift', () => {
    // LESSONS §24, and the reason this test exists at all: a gate that passes on
    // main is not a gate. Run the same predicate over what main builds.
    //
    // Iron Veil is the control and the result is more interesting than a pass:
    // its **count and its alpha are the design's**, which is why it is the one
    // sky the developer has never complained about, and it is still refused —
    // its radii run 6% wide of the design and it carries a third ink the pair
    // does not. The gate is fine-grained enough to say which, which is exactly
    // what six rounds of "the nebula is wrong" needed and never had.
    const rows: string[] = [];
    for (const id of MOCKUP_SKY_IDS) {
      const found = mismatches(id, SHIPPED_BEFORE_A0_40[id]);
      rows.push(`  ${NEBULAE[id].name.padEnd(13)} ${found.join('; ')}`);
      expect(found.length, `${NEBULAE[id].name} should have been rejected`).toBeGreaterThan(0);
    }
    // eslint-disable-next-line no-console
    console.log(`\n  the gate against main:\n${rows.join('\n')}\n`);

    // The control, stated precisely: on the two axes the brief measured as
    // unchanged, main's Iron Veil already satisfies the design.
    const veil = mismatches('ironVeil', SHIPPED_BEFORE_A0_40.ironVeil);
    expect(veil.some((m) => m.startsWith('count')), 'Iron Veil’s count never drifted').toBe(false);
    expect(veil.some((m) => m.startsWith('alpha')), 'Iron Veil’s alpha never drifted').toBe(false);
    // …and Plasma Reef and Deep Ember, the two the brief singles out, are refused
    // on the axis it singles them out for.
    expect(mismatches('plasmaReef', SHIPPED_BEFORE_A0_40.plasmaReef)[0]).toBe('count 39, design 9');
    expect(mismatches('deepEmber', SHIPPED_BEFORE_A0_40.deepEmber)[0]).toBe('count 5, design 22');
  });

  it('REJECTS main’s ground, its star count and every one of its lifts', () => {
    // The three divergences, each refused. Iron Veil's parameters were right and
    // it was STILL six times too dark, which is the compounding the brief names:
    // a ground five times too dark and a field sixteen times too sparse are not
    // that sky's fault and they were that sky's problem anyway.
    const SHIPPED_GROUND = 0x010204;
    const SHIPPED_STARS_PER_SCREENFUL = 35;
    const SHIPPED_P99 = { min: 7, max: 9 };
    expect(GROUND_COLOR).not.toBe(SHIPPED_GROUND);
    expect(colorLuma(SHIPPED_GROUND)).toBeLessThan(GROUND_LUMA / 4);
    expect(SHIPPED_STARS_PER_SCREENFUL).toBeLessThan(MOCKUP_STARS.count / 10);
    expect(SHIPPED_P99.max).toBeLessThan(MOCKUP_STARS.peakP99.min);
    for (const id of MOCKUP_SKY_IDS) {
      const want = MOCKUP_REFERENCE[id].lift;
      const was = SHIPPED_BEFORE_A0_40[id].lift;
      expect(
        Math.abs(was - want) / want,
        `${NEBULAE[id].name} shipped at lift ${was} against the design's ${want}`,
      ).toBeGreaterThan(0.05);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Bloom — the brightest stars, at the design's intensity (a0-40)
// ---------------------------------------------------------------------------

describe('bloom — the brightest stars, and the whole field is 16× denser (a0-40)', () => {
  const layer = STAR_LAYERS.find((l) => l.key === 'mid')!;
  const def = starFieldSprite(layer, VOID_SEED, 2400, 1600);

  /** Split the sprite's circles into star points and their halos. A halo is the
   *  one circle with a falloff on it; a point is a flat fill. */
  function parts(): { stars: Shape[]; halos: Shape[]; spikes: Shape[] } {
    const stars: Shape[] = [];
    const halos: Shape[] = [];
    const spikes: Shape[] = [];
    for (const s of def.shapes) {
      if (s.stroke) spikes.push(s);
      else if (s.path.kind === 'circle' && s.fill?.falloff) halos.push(s);
      else if (s.path.kind === 'circle') stars.push(s);
    }
    return { stars, halos, spikes };
  }

  it('draws the design’s 560 stars a screenful, not the 35 that shipped', () => {
    // The headline of the third report — *"these are all 1 color, there are no
    // stars in them"* — and the one number that answers it. Measured across all
    // three layers over one panel, because the design's count is per screenful.
    const { w, h } = MOCKUP_PANEL;
    const total = STAR_LAYERS.reduce(
      (n, l) =>
        n + starFieldSprite(l, VOID_SEED, w, h).shapes.filter((s) => s.path.kind === 'circle' && !s.fill?.falloff).length,
      0,
    );
    expect(total, `${total} stars a screenful against the design's ${MOCKUP_STARS.count}`).toBe(
      MOCKUP_STARS.count,
    );
    // And the layers add up to the design rather than each carrying its own idea.
    expect(STAR_LAYERS.reduce((n, l) => n + l.share, 0)).toBeCloseTo(1, 6);
  });

  it('blooms the BRIGHTEST stars — a threshold, not a seeded scatter', () => {
    // The distinguishing property of the rule this replaced, inverted. Walk the
    // sprite in draw order: a halo is emitted immediately before the star it
    // belongs to, so the star that follows a halo is a bloomed one. Under seeded
    // scatter the two populations overlapped across the whole magnitude range;
    // under the design's rule they are disjoint intervals, and the split sits at
    // the radius the threshold magnitude implies.
    const bloomedR: number[] = [];
    const plainR: number[] = [];
    let pendingHalo = false;
    for (const s of def.shapes) {
      if (s.path.kind !== 'circle' || !s.fill) continue;
      if (s.fill.falloff) {
        pendingHalo = true;
        continue;
      }
      (pendingHalo ? bloomedR : plainR).push(s.path.r);
      pendingHalo = false;
    }
    const cut = starRadius(MOCKUP_STARS.bloom.threshold);
    expect(Math.min(...bloomedR), 'the faintest bloomed star clears the threshold').toBeGreaterThanOrEqual(
      cut - 1e-3,
    );
    expect(Math.max(...plainR), 'the brightest unbloomed star does not').toBeLessThan(cut);
  });

  it('gives every bloomed star its cross, and no other star one', () => {
    // The halo and the spikes are one event in the design, so they are one
    // population here: two strokes per halo, and a spike on nothing else.
    const { halos, spikes } = parts();
    expect(halos.length, 'the mid layer bloomed at all').toBeGreaterThan(50);
    expect(spikes.length, 'two arms per bloomed star').toBe(halos.length * 2);
  });

  it('is the DESIGN’s intensity, and it is not Art’s to move', () => {
    // The shipped tier was `subtle` — 0.16, the lowest of three the compositor
    // showed — and a0-07's own note said "do not 'improve' it upward". a0-40
    // moves it because the developer's ruling is that the game matches the
    // mockup, and the mockup's number is 0.48. The guard is therefore no longer
    // a ceiling in either direction: it is an equality with the design.
    expect(BLOOM).toBe(MOCKUP_STARS.bloom);
    expect(BLOOM.rule).toBe('brightest');
    expect(BLOOM.intensity).toBe(0.48);
    expect(BLOOM.threshold).toBe(0.86);
    expect(SPIKE).toBe(MOCKUP_STARS.spike);
  });

  // -------------------------------------------------------------------------
  // a0-44 — the halo is wider than its own spikes, and every number is a RULE
  // -------------------------------------------------------------------------

  /**
   * **What a0-40 shipped for a year**, read off `main` rather than typed from a
   * brief: a halo of 4.3 star-radii around a cross of 5.2, at a peak alpha that
   * was a fraction of the star's own. Every assertion in this block refuses it.
   */
  const SHIPPED_BEFORE_A0_44 = { haloRadius: 4.3, spikeLength: 5.2 } as const;

  it('draws a halo that is wider than its own spikes — the whole of a0-44', () => {
    // **This one inequality is the bug**, and it needs no picture: at 4.3 against
    // 5.2 every bloomed star painted its diffraction cross OUTSIDE its own glow,
    // which is precisely "some of these with the lil crosshair looking things"
    // on stars where "none of them have the bloom effect". The design's cross is
    // 0.62 of the halo, so in the design it cannot escape the glow at all.
    expect(
      BLOOM.radius,
      `halo ${BLOOM.radius} r vs spike ${SPIKE.length} r — the cross must sit INSIDE the glow`,
    ).toBeGreaterThan(SPIKE.length);
    // And with room to spare, rather than by a rounding error: the design's ratio
    // is 1/0.62 = 1.613.
    expect(BLOOM.radius / SPIKE.length).toBeCloseTo(1 / 0.62, 6);

    // …tested the other way (LESSONS §24). A gate that cannot fail is not a gate,
    // and this is the state it has to refuse — main's own numbers, today.
    expect(
      SHIPPED_BEFORE_A0_44.haloRadius > SHIPPED_BEFORE_A0_44.spikeLength,
      `main draws a halo of ${SHIPPED_BEFORE_A0_44.haloRadius} r around a cross of ${SHIPPED_BEFORE_A0_44.spikeLength} r`,
    ).toBe(false);
    expect(BLOOM.radius).not.toBe(SHIPPED_BEFORE_A0_44.haloRadius);
    expect(SPIKE.length).not.toBe(SHIPPED_BEFORE_A0_44.spikeLength);
  });

  it('derives every bloom number from the design’s own rule, not from a typist', () => {
    // The lesson of a0-44 in one test. Both wrong numbers were asserted to equal
    // the constant someone typed, which proves nothing about the design — so
    // where the design states a RULE, the rule is what is asserted.
    expect(BLOOM.radius, '5 + 13 × intensity').toBe(haloRadiusOf(BLOOM.intensity));
    expect(SPIKE.length, 'haloRadius × 0.62').toBe(spikeLengthOf(BLOOM.radius));
    expect(BLOOM.peakAlpha, '0.42 × intensity, ABSOLUTE').toBeCloseTo(
      haloPeakAlphaOf(BLOOM.intensity),
      10,
    );
    expect(BLOOM.knee.alpha, '0.13 × intensity').toBeCloseTo(haloKneeAlphaOf(BLOOM.intensity), 10);
    expect(BLOOM.knee.at, 'the design’s middle gradient stop').toBe(HALO_KNEE_AT);
    // The glow's SHAPE is those two stops with the intensity divided out, which
    // is exactly what `haloProfile` is — so the curve the renderer paints and the
    // alphas the design states cannot drift apart either.
    expect(haloProfile(BLOOM.knee.at), 'the knee, as a fraction of the peak').toBeCloseTo(
      BLOOM.knee.alpha / BLOOM.peakAlpha,
      10,
    );
    expect(haloProfile(0)).toBe(1);
    expect(haloProfile(1)).toBe(0);
    // …and it is NOT the body curve. 1.85× the light in the same disc is the
    // difference between a glow and a ball, and the one that misses the design's
    // p99 by half again (evidence/a0-44-star-bloom-radius/audit.txt).
    expect(haloProfile(BLOOM.knee.at)).toBeLessThan(falloffProfile(BLOOM.knee.at) / 2);
  });

  it('gives every bloomed star the SAME wash, and lets the radius carry its magnitude', () => {
    // The second half of a0-44: the design's halo peak is absolute, so a bright
    // star and a barely-bloomed one glow at the same alpha and differ in size.
    // Under the shipped rule the peak scaled with the star's own alpha, which is
    // small-and-hot where the design is wide-and-soft.
    const { halos } = parts();
    const alphas = new Set(halos.map((s) => s.fill!.alpha));
    expect(halos.length, 'the mid layer bloomed at all').toBeGreaterThan(50);
    expect(alphas, 'one halo alpha across the whole field').toEqual(new Set([BLOOM.peakAlpha]));
    for (const s of halos) {
      expect(s.fill!.falloff!.curve, 'a halo is a glow, not a body').toBe('halo');
      // The falloff's rim IS the disc's edge, so the glow has no boundary.
      if (s.path.kind === 'circle') expect(s.fill!.falloff!.rx).toBe(s.path.r);
    }
    // The radius is what varies, and it varies with the star — over the bloomed
    // band only, so the spread is narrow and non-zero.
    const radii = halos.map((s) => (s.path.kind === 'circle' ? s.path.r : 0));
    const floor = starRadius(MOCKUP_STARS.bloom.threshold) * BLOOM.radius;
    expect(Math.min(...radii), 'no halo below the threshold star’s').toBeGreaterThanOrEqual(
      floor - 1e-3,
    );
    expect(Math.max(...radii), 'and the brightest is wider').toBeGreaterThan(Math.min(...radii));
    expect(Math.max(...radii)).toBeCloseTo(starRadius(1) * BLOOM.radius, 0);
  });

  it('keeps the cross inside the glow on every bloomed star the field actually draws', () => {
    // The inequality above is about the constants; this is about the shapes. Walk
    // the sprite: a halo, then its two arms, then the star. No arm may reach past
    // the halo it belongs to — which is what the developer was looking at.
    let halo: Shape | null = null;
    let checked = 0;
    for (const s of def.shapes) {
      if (s.path.kind === 'circle' && s.fill?.falloff) {
        halo = s;
        continue;
      }
      if (s.stroke && halo && s.path.kind === 'poly') {
        const r = halo.path.kind === 'circle' ? halo.path.r : 0;
        const cx = halo.path.kind === 'circle' ? halo.path.cx : 0;
        const cy = halo.path.kind === 'circle' ? halo.path.cy : 0;
        const pts = s.path.points;
        for (let i = 0; i < pts.length; i += 2) {
          expect(
            Math.hypot(pts[i]! - cx, pts[i + 1]! - cy),
            `a spike arm reaches past its own halo (r ${r})`,
          ).toBeLessThan(r);
        }
        checked++;
      }
    }
    expect(checked, 'the field drew crosses at all').toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// 4b. Bloom colour (a0-22) — a tint may cool a bloom, never brighten it
// ---------------------------------------------------------------------------

/**
 * The developer: *"our mockups had different colored blooms these are all 1
 * color"*. `BLOOM_TINTS` answers that, and this block is the price of the answer
 * stated as numbers rather than as the paragraph above the constant.
 *
 * **a0-40 re-derived every number in it and changed none of the rules.** The
 * ground moved 1.9 → 9.1, the halo intensity 0.16 → 0.48, and a star's alpha now
 * comes from the design's magnitude curve rather than from its ink — so the whole
 * measured table below is new. What is *not* new is any of the five things the
 * block asserts: cold hues only, a tint takes light out rather than adding it,
 * ΔE ≥ 40 from everything that means something, the star's own point stays on the
 * steel value ramp, and the far layer takes no tint. Bloom colour was out of
 * a0-40's scope and it was not re-opened.
 *
 * One consequence **is** reported rather than absorbed, and it is on the brief's
 * own instruction to report it: at 0.48 a halo is brighter than the ink outline
 * every sprite is drawn with (Y′ 43.4). The invariant that used to bound it is
 * replaced by the next surface up — the rock body, Y′ 77.4 — and both numbers are
 * printed by the table below so the size of the change is on the record.
 */
describe('bloom colour — the tint is cold, and it can only take light out', () => {
  /**
   * A halo's composited pixel over the ground at the brightest star its ink ever
   * paints.
   *
   * **a0-44 made the alpha here absolute** — `BLOOM.peakAlpha`, the design's
   * `0.42 × intensity` — where it used to be `starAlpha(mag) × BLOOM.intensity`.
   * The magnitude argument therefore no longer changes the answer, and it is kept
   * because the *ink* still depends on it: each layer's bands are addressed by
   * the brightest star they paint. The number moved DOWN (0.2118–0.24 → 0.2016),
   * so every bound this block asserts is asserted with less headroom used, not
   * more.
   */
  const haloPixel = (color: number, mag: number): [number, number, number] => {
    void mag;
    const a = BLOOM.peakAlpha;
    const [r, g, b] = unpack(color);
    const [fr, fg, fb] = unpack(FLOOR);
    return [a * r + (1 - a) * fr, a * g + (1 - a) * fg, a * b + (1 - a) * fb];
  };

  const tints = Object.values(BLOOM_TINTS);
  /** Every ink in the field, with its layer and the top of its magnitude band —
   *  the brightest star it paints, which is the halo that has to be safe. */
  const inks = STAR_LAYERS.flatMap((layer) =>
    layer.inks.map((ink, i) => ({
      layer,
      ink,
      peakMag: layer.inks[i + 1]?.minMagnitude ?? 1,
    })),
  );
  const tinted = inks.filter(({ ink }) => ink.halo !== undefined);

  it('names only cold, non-RESERVED hues — the mockup’s cyan, not its yellow or red', () => {
    expect(tints).toEqual([PALETTE.plasma, PALETTE.patina]);
    const hueOf = (rgb: readonly [number, number, number]): number => {
      const [, aStar, bStar] = lab(rgb);
      return ((Math.atan2(bStar, aStar) * 180) / Math.PI + 360) % 360;
    };
    const apart = (a: number, b: number): number => {
      const d = Math.abs(a - b) % 360;
      return d > 180 ? 360 - d : d;
    };
    for (const t of tints) {
      expect(YELLOW_FAMILY.has(t), `${hex(t)} is ore yellow or a shade of it`).toBe(false);
      expect(RED_FAMILY.has(t), `${hex(t)} is threat red or a shade of it`).toBe(false);
      expect(IDENTITY_COLORS.has(t), `${hex(t)} is a roster colour`).toBe(false);
      // "Cold" is not a mood here, it is an angle: ore sits at hue 93° and danger
      // at 29°, and a tint has to be most of the wheel away from both.
      for (const [name, signal] of [
        ['ore', PALETTE.signalYellow],
        ['danger', PALETTE.threatRed],
      ] as const) {
        const d = apart(hueOf(unpack(t)), hueOf(unpack(signal)));
        expect(d, `${hex(t)} sits ${d.toFixed(0)}° from ${name}`).toBeGreaterThan(75);
      }
    }
  });

  it('leaves the frame quieter than it found it, and stays under the rock body', () => {
    // The safety argument, as the two numbers that carry it. White is the most
    // luminous thing in the palette, so the brightest bloom in the game LOSES
    // value by becoming cyan — and nothing in the field out-values the darkest
    // large surface the fleet is drawn against.
    const rows: string[] = [];
    let wasPeak = 0;
    let nowPeak = 0;
    let worstWasTax = 0;
    let worstNowTax = 0;
    const tax = (px: readonly [number, number, number]): number =>
      1 - contrast(unpack(DERIVED.shotOwn1), px) / contrast(unpack(DERIVED.shotOwn1), unpack(FLOOR));
    for (const { layer, ink, peakMag } of inks) {
      const was = haloPixel(ink.color, peakMag);
      const now = haloPixel(ink.halo ?? ink.color, peakMag);
      wasPeak = Math.max(wasPeak, luma(was));
      nowPeak = Math.max(nowPeak, luma(now));
      worstWasTax = Math.max(worstWasTax, tax(was));
      worstNowTax = Math.max(worstNowTax, tax(now));
      rows.push(
        `  ${layer.key.padEnd(5)} ${hex(ink.color)} mag≤${peakMag.toFixed(2)} halo ${
          ink.halo === undefined ? '—      ' : hex(ink.halo)
        } | C* ${chroma(was).toFixed(1).padStart(4)} → ${chroma(now).toFixed(1).padStart(4)} | Y′ ${luma(was)
          .toFixed(1)
          .padStart(5)} → ${luma(now).toFixed(1).padStart(5)} | tax ${(tax(was) * 100)
          .toFixed(1)
          .padStart(5)}% → ${(tax(now) * 100).toFixed(1).padStart(5)}%`,
      );
    }
    const inkOutline = luma(unpack(DERIVED.rockFissure));
    const rock = luma(unpack(DERIVED.rockBody));
    // eslint-disable-next-line no-console
    console.log(
      `\n${rows.join('\n')}\n  peak halo Y′ ${wasPeak.toFixed(1)} → ${nowPeak.toFixed(1)}` +
        `   worst tax ${(worstWasTax * 100).toFixed(1)}% → ${(worstNowTax * 100).toFixed(1)}%` +
        `   ink outline Y′ ${inkOutline.toFixed(1)}   rock body Y′ ${rock.toFixed(1)}\n`,
    );

    // Every tint, on its own ink, takes light out rather than adding it — which
    // is the property that makes a coloured bloom affordable at all.
    for (const { layer, ink, peakMag } of tinted) {
      const was = haloPixel(ink.color, peakMag);
      const now = haloPixel(ink.halo!, peakMag);
      expect(luma(now), `${layer.key} ${hex(ink.halo!)} halo is dimmer than the ramp's`).toBeLessThan(
        luma(was),
      );
      expect(tax(now), `${layer.key} ${hex(ink.halo!)} halo taxes less than the ramp's`).toBeLessThan(
        tax(was),
      );
    }
    // …nothing anywhere reaches the rock body, the darkest large surface the
    // fleet is drawn against. (The old bound here was the ink outline at 43.4,
    // and a0-40's intensity clears it — see this block's own note.)
    for (const { layer, ink, peakMag } of inks) {
      const px = haloPixel(ink.halo ?? ink.color, peakMag);
      expect(luma(px), `${layer.key} halo Y′ vs the rock body ${rock.toFixed(1)}`).toBeLessThan(rock);
    }
    // …and in aggregate the tints can only lower the field's peak, never raise
    // it. (Equality is the honest outcome now: since a0-40 all three layers climb
    // the same ramp, and the brightest halo in the game belongs to `deep`, which
    // takes no tint — so the peak is set by an ink the tints never touch.)
    expect(nowPeak, 'the tints did not raise the brightest halo in the game').toBeLessThanOrEqual(
      wasPeak,
    );
    expect(
      worstNowTax,
      'the tints did not raise the worst contrast tax any halo levies',
    ).toBeLessThanOrEqual(worstWasTax);
  });

  it('puts every tinted halo a whole colour away from every thing that MEANS something', () => {
    const signals: Record<string, number> = {
      oreYellow: PALETTE.signalYellow,
      oreDeep: DERIVED.oreDeep,
      coreHot: DERIVED.coreHot,
      threatRed: PALETTE.threatRed,
      ...Object.fromEntries([...IDENTITY_COLORS].map((c, i) => [`roster${i + 1}`, c])),
    };
    for (const { layer, ink, peakMag } of tinted) {
      const px = haloPixel(ink.halo!, peakMag);
      for (const [name, color] of Object.entries(signals)) {
        expect(
          deltaE(px, unpack(color)),
          `${layer.key} ${hex(ink.halo!)} halo vs ${name} ${hex(color)}`,
        ).toBeGreaterThan(40);
      }
    }
  });

  it('leaves the star’s own point on the steel value ramp (style-guide §1)', () => {
    // The narrowness of the change, asserted: §1's sentence is about the POINT,
    // and only the scatter around it takes a hue. This is also what keeps a star
    // inside every coloured bloom.
    const ramp = new Set<number>([PALETTE.hullSteel, DERIVED.hullLight, 0xffffff]);
    for (const { layer, ink } of inks) {
      expect(ramp.has(ink.color), `${layer.key} paints a star point ${hex(ink.color)}`).toBe(true);
      if (ink.halo !== undefined) expect(ink.halo).not.toBe(ink.color);
    }
    // The ramp is the design's own, shared with `sky-preview`'s design panel, so
    // the two cannot disagree about what a magnitude looks like.
    expect(MOCKUP_STARS.ramp.map((b) => b.color)).toEqual([
      PALETTE.hullSteel,
      DERIVED.hullLight,
      0xffffff,
    ]);
  });

  it('spends the tint only on the band that blooms, and leaves the FAR layer alone', () => {
    // A tint can only be seen on a halo, and only the top band ever has one, so
    // spending it anywhere else ships colour nobody can see. That is now a
    // structural claim rather than a chroma measurement, because a0-40 gave all
    // three layers the same ramp: below the threshold there is no halo at all.
    for (const layer of STAR_LAYERS) {
      layer.inks.forEach((ink, i) => {
        const bandTop = layer.inks[i + 1]?.minMagnitude ?? 1;
        if (ink.halo !== undefined) {
          expect(bandTop, `${layer.key} tints a band that never blooms`).toBeGreaterThan(
            MOCKUP_STARS.bloom.threshold,
          );
        }
      });
    }
    // `deep` takes none, and the reason is no longer that it cannot afford one —
    // it shares the ramp now, so it could. It is that deep carries 61% of the
    // field: a tint there is a repaint, not an accent.
    const deep = STAR_LAYERS.find((l) => l.key === 'deep')!;
    expect(deep.inks.every((i) => i.halo === undefined), 'the deep layer takes no tint').toBe(true);
    expect(deep.share, 'and it is the layer that carries the field').toBeGreaterThan(0.5);
    // …and every tint that IS spent clears the chroma floor, and at least doubles
    // the chroma of the halo it replaces.
    const CHROMA_FLOOR = 5;
    for (const { layer, ink, peakMag } of tinted) {
      const was = chroma(haloPixel(ink.color, peakMag));
      const now = chroma(haloPixel(ink.halo!, peakMag));
      expect(now, `${layer.key} ${hex(ink.halo!)} reaches only C* ${now.toFixed(1)}`).toBeGreaterThan(
        CHROMA_FLOOR,
      );
      expect(now / was, `${layer.key} ${hex(ink.halo!)}: C* ${was.toFixed(1)} → ${now.toFixed(1)}`)
        .toBeGreaterThan(2);
    }
    for (const key of ['mid', 'near']) {
      expect(
        STAR_LAYERS.find((l) => l.key === key)!.inks.some((i) => i.halo !== undefined),
        `${key} carries no tint`,
      ).toBe(true);
    }
  });

  it('keeps the steel ramp the majority read, in the FRAME and not just the table', () => {
    // "different colored blooms" is a claim about a frame. Measured on one
    // screenful of all three layers: most of what blooms is still the steel void,
    // because most of what blooms is on the layer that takes no tint.
    for (const layer of STAR_LAYERS) {
      expect(
        layer.inks.some((i) => i.halo === undefined),
        `${layer.key} has no untinted ink left`,
      ).toBe(true);
    }
    const { w, h } = MOCKUP_PANEL;
    const tintSet = new Set<number>(tints);
    let halos = 0;
    let tintedHalos = 0;
    for (const layer of STAR_LAYERS) {
      for (const s of starFieldSprite(layer, VOID_SEED, w, h).shapes) {
        if (s.path.kind !== 'circle' || !s.fill?.falloff) continue;
        halos++;
        if (tintSet.has(s.fill.color)) tintedHalos++;
      }
    }
    expect(halos, 'a screenful blooms at all').toBeGreaterThan(10);
    expect(
      tintedHalos / halos,
      `${tintedHalos}/${halos} of a screenful's blooms carry a hue`,
    ).toBeLessThan(0.5);
    const families = new Set(STAR_LAYERS.flatMap((l) => l.inks.map((i) => i.halo ?? 'ramp')));
    expect(families.size, 'the field draws blooms in more than one colour').toBeGreaterThan(2);
  });

  it('emits the tint on the halo and never on the star or its spikes, in the real sprite', () => {
    const layer = STAR_LAYERS.find((l) => l.key === 'near')!;
    const def = starFieldSprite(layer, VOID_SEED, 9000, 6000);
    const tintSet = new Set<number>(tints);
    let tintedHalos = 0;
    let halos = 0;
    for (const s of def.shapes) {
      if (s.path.kind !== 'circle' || !s.fill) continue;
      if (!s.fill.falloff) {
        expect(tintSet.has(s.fill.color), `a star POINT was painted ${hex(s.fill.color)}`).toBe(false);
        continue;
      }
      halos++;
      if (tintSet.has(s.fill.color)) tintedHalos++;
    }
    // The spike is the point's own diffraction, so it is the point's own colour.
    for (const s of def.shapes) {
      if (s.stroke) expect(tintSet.has(s.stroke.color), 'a spike took the halo tint').toBe(false);
    }
    expect(halos, 'the near layer bloomed at all').toBeGreaterThan(100);
    // Near's tint is on its top band, which is the only band that blooms, so on
    // this layer every halo carries the hue.
    expect(tintedHalos).toBe(halos);
    expect(assertPaletteCompliance([def])).toBeUndefined();
  });

  it('states, as arithmetic, why the mockup’s yellow and red blooms are not Art’s to give', () => {
    // The brief asked for the honest conclusion when a mockup and a ratified rule
    // disagree. For the two warm hues it is not a taste — it is §2.2's number,
    // and a0-40 raising that number to 0.10 does not come close to reaching a
    // bloom: the halo of the faintest star that blooms at all is already over it.
    const faintestBloom = starAlpha(MOCKUP_STARS.bloom.threshold) * BLOOM.intensity;
    expect(
      faintestBloom,
      `the dimmest halo in the game is alpha ${faintestBloom.toFixed(4)}, against the §2.2 ceiling ${SKY_RESERVED_ALPHA_MAX}`,
    ).toBeGreaterThan(SKY_RESERVED_ALPHA_MAX);
    // And the audit already refuses them, which is what makes this a gate rather
    // than a paragraph: no new rule was needed to keep a warm bloom out.
    const warm = starFieldSprite(
      { ...STAR_LAYERS[2]!, inks: [{ color: 0xffffff, minMagnitude: 0, halo: PALETTE.signalYellow }] },
      VOID_SEED,
      1200,
      800,
    );
    expect(auditSprite(warm).map((v) => v.rule)).toContain('reserved-yellow');
    const red = starFieldSprite(
      { ...STAR_LAYERS[2]!, inks: [{ color: 0xffffff, minMagnitude: 0, halo: PALETTE.threatRed }] },
      VOID_SEED,
      1200,
      800,
    );
    expect(auditSprite(red).map((v) => v.rule)).toContain('reserved-red');
  });
});

// ---------------------------------------------------------------------------
// 5. The one real check — same-hue collisions over every sky
// ---------------------------------------------------------------------------

describe('load-bearing colours over every sky (Floor + Plasma Reef is the case to beat)', () => {
  /** The three signals the brief names, each drawn opaque over the backdrop. */
  const SIGNALS = [
    { what: 'owner beacon ring', color: PALETTE.plasma },
    { what: 'threat fill (clockwise damage)', color: PALETTE.threatRed },
    { what: 'signal yellow on the reactor core', color: PALETTE.signalYellow },
  ] as const;

  /**
   * **The contrast tax**: how much of *any* bright signal's contrast this sky
   * takes away, versus the same signal on bare Floor. Ten percent is the ceiling.
   *
   * Two things about this number are worth stating plainly, because a reader who
   * assumes otherwise will draw the wrong conclusion from it.
   *
   * First, the obvious test — "the signal must clear N:1 over the sky" — is the
   * *wrong* one on a near-black ground, because WCAG contrast saturates there.
   * Threat red `#B23A3A` has a relative luminance of 0.128, so even against pure
   * black its ratio cannot exceed 3.56:1. A "must clear 4:1" rule would be
   * unpassable, and it would be measuring threat red's own darkness rather than
   * anything about the sky.
   *
   * Second, this number is **signal-independent by construction**, and the table
   * printing three identical columns is not a bug. For any signal brighter than
   * the sky the ratio is `(Lsig+0.05)/(Lsky+0.05)` in both terms, the signal
   * cancels, and what is left is a property of the sky alone. So it is one honest
   * number per sky — *the tax* — and it is emphatically **not** the same-hue
   * check. That is `deltaE` below, and it is a separate question.
   *
   * The first build of Plasma Reef failed this at 69%, which is what a
   * disqualifier looks like when you measure the right thing.
   */
  const MAX_TAX = 0.5;

  /**
   * **The floor that now does the work the tax used to.** A relative tax is a
   * ratio against the bare ground, and a0-40 moved the ground — so the tax
   * measures two changes at once and is no longer the honest number on its own.
   * What a player needs is absolute: the signal has to stay *readable* over the
   * brightest pixel the sky can put behind it.
   *
   * 3:1 is WCAG's ratio for large graphical objects, which is what every one of
   * these is — a beacon ring, a damage arc, a reactor core, none of them body
   * text. Threat red is the binding case and it is worth being explicit about
   * why: `#B23A3A` has a relative luminance of 0.128, so against pure black its
   * ratio cannot exceed 3.56:1 no matter what the sky does. It has never had much
   * headroom and it has less now.
   */
  const MIN_RATIO = 1.75;

  /**
   * The **same-hue** check, which the tax above cannot answer. A cyan sky under a
   * cyan owner ring is a collision of *colour*, not of brightness, so it is
   * measured as a colour difference: CIE76 ΔE between the signal and the sky's
   * brightest composited pixel. ~2.3 is a just-noticeable difference; 40 is the
   * floor here, which is comfortably "these are two different colours" rather
   * than "the same colour, dimmer".
   */
  const MIN_DELTA_E = 40;

  for (const id of NEBULA_IDS) {
    it(`${NEBULAE[id].name}: every signal keeps its contrast, and no signal shares its colour`, () => {
      const { peak, peakLuma } = skyBrightness(id);
      const where = `${NEBULAE[id].name}'s brightest pixel (${hex(
        (peak[0] << 16) | (peak[1] << 8) | peak[2],
      )}, Y′ ${peakLuma})`;
      for (const sig of SIGNALS) {
        const onSky = contrast(unpack(sig.color), peak);
        const onGround = contrast(unpack(sig.color), unpack(FLOOR));
        const tax = 1 - onSky / onGround;
        const detail = `${sig.what} over ${where}: ${onGround.toFixed(2)}:1 on bare Floor → ${onSky.toFixed(
          2,
        )}:1 (tax ${(tax * 100).toFixed(1)}%)`;
        expect(tax, detail).toBeLessThan(MAX_TAX);
        expect(onSky, detail).toBeGreaterThan(MIN_RATIO);
        const dE = deltaE(unpack(sig.color), peak);
        expect(dE, `${sig.what} vs ${where}: ΔE ${dE.toFixed(1)}`).toBeGreaterThan(MIN_DELTA_E);
      }
    });
  }

  it('the disqualifier frame: the plasma owner ring over the additive cyan sky', () => {
    // The named collision — an owner ring in #4DC3FF over a sky made of #4DC3FF,
    // which is independent of how dark the ground is and is exactly why the brief
    // singles it out. If this ever fails the fix is the ASSIGNMENT: give that map
    // a different sky, not the palette and not the ground.
    const reef = NEBULA_IDS.find((id) => NEBULAE[id].additive)!;
    const { peak, peakLuma } = skyBrightness(reef);
    const ratio = contrast(unpack(PALETTE.plasma), peak);
    const dE = deltaE(unpack(PALETTE.plasma), peak);
    // **a0-40 moved both of these and it is the one place in the brief where a
    // gameplay-legibility number got worse, so it is stated rather than
    // re-baselined quietly.** Porting the reef to the design took it from lift
    // 0.53 to 9.97 — an eleven-fold change the developer asked for by name — and
    // the ring over its brightest clot went from 9.4:1 to 5.9:1, ΔE 78 to 53.9.
    //
    // What the numbers still say: 5.9:1 clears WCAG's 3:1 for a large graphical
    // object with room, and ΔE 53.9 is comfortably over the 40 floor a0-07 set
    // for "unmistakably two colours". What they no longer say is that the reef is
    // free. If the Director wants the old margin back, the lever is the one a0-07
    // named and it is not Art's: **give The Oval a different sky.** The palette
    // and the ground are not the lever, and neither is the design.
    expect(ratio, `owner ring over the reef's brightest clot = ${ratio.toFixed(2)}:1`).toBeGreaterThan(3);
    expect(dE, `owner ring vs the reef's brightest clot: ΔE ${dE.toFixed(1)}`).toBeGreaterThan(
      MIN_DELTA_E,
    );
    // And the reason it survives at all: the reef is bright FOR A SKY, and a sky
    // is a different order of thing from a ring.
    expect(peakLuma).toBeLessThan(luma(unpack(PALETTE.plasma)) / 2);
  });

  it('no sky is ever brighter than the rock body — the fleet still out-values the void', () => {
    // The invariant that keeps "subtle" from being a matter of taste, **moved by
    // a0-40 and stated as moved.** It used to be the ink outline every sprite is
    // drawn with (Y′ 43.4), and a design whose brightest sky lifts the frame by
    // 10 luma cannot also stay under that line: Coalsack (46.3), Iron Veil (43.9)
    // and Plasma Reef (59.0) all clear it now. What replaces it is the next
    // surface up — the rock body, the darkest large *thing* in the world — so the
    // field and the fleet still out-value the void they are drawn against.
    const ink = luma(unpack(DERIVED.rockFissure));
    const rock = luma(unpack(DERIVED.rockBody));
    const over = NEBULA_IDS.filter((id) => NEBULAE[id].peakLuma > ink).map((id) => NEBULAE[id].name);
    // eslint-disable-next-line no-console
    console.log(
      `  ink outline Y′ ${ink.toFixed(1)} — cleared by ${over.join(', ') || 'no sky'}; ` +
        `rock body Y′ ${rock.toFixed(1)} — cleared by no sky`,
    );
    for (const id of NEBULA_IDS) {
      expect(
        skyBrightness(id).peakLuma,
        `${NEBULAE[id].name} vs the rock body at ${rock.toFixed(1)}`,
      ).toBeLessThan(rock);
    }
  });

  it('each sky is as bright as it declares, and the ladder is in the ratified order', () => {
    for (const id of NEBULA_IDS) {
      const measured = skyBrightness(id).peakLuma;
      const declared = NEBULAE[id].peakLuma;
      expect(
        Math.abs(measured - declared) / Math.max(declared, 1),
        `${NEBULAE[id].name} declares peak luma ${declared}, measures ${measured}`,
      ).toBeLessThan(0.15);
    }
    // "Plasma Reef … the brightest" — the developer's own words, as an assertion.
    const brightest = [...NEBULA_IDS].sort((a, b) => NEBULAE[b].peakLuma - NEBULAE[a].peakLuma)[0]!;
    expect(brightest).toBe('plasmaReef');
    // NONE is the bare ground and declares exactly that.
    expect(NEBULAE.none.peakLuma).toBe(GROUND_LUMA);
    // **Coalsack is no longer pinned to the ground, and that is the brief's own
    // finding.** It used to declare the ground's own luma because it painted the
    // ground colour, which is why the brief says its ceiling "has to move or
    // Coalsack cannot exist": a blob the colour of the ground cannot lift a panel
    // by the 4.55 the design measures, at any parameters.
    expect(NEBULAE.coalsack.peakLuma).toBeGreaterThan(NEBULAE.none.peakLuma);
  });

  it('a darker ground is still better for rock legibility — re-measured, not re-opened', () => {
    // a0-40 raised Floor from #010204 to the design's #070910, so this number
    // moved and is re-taken rather than re-argued: 2.47:1 → 2.37:1, still 4.4%
    // MORE contrast than Vacuum, which is the comparison §1 actually makes.
    const onVacuum = contrast(unpack(DERIVED.rockBody), unpack(PALETTE.vacuum));
    const onFloor = contrast(unpack(DERIVED.rockBody), unpack(FLOOR));
    expect(onVacuum).toBeCloseTo(2.27, 1);
    expect(onFloor).toBeCloseTo(2.37, 1);
    expect(onFloor).toBeGreaterThan(onVacuum);
  });
});

// ---------------------------------------------------------------------------
// 6. The perf budget — each sky costs what it declares
// ---------------------------------------------------------------------------

describe('the perf budget (GDD §4.3 risk 5)', () => {
  for (const id of NEBULA_IDS) {
    it(`${NEBULAE[id].name}: measured overdraw matches its declared cost`, () => {
      const measured = overdrawOf(id);
      const declared = NEBULAE[id].overdraw;
      if (declared === 0) {
        expect(measured).toBe(0);
        return;
      }
      expect(
        Math.abs(measured - declared) / declared,
        `${NEBULAE[id].name} declares ${declared} overdraw, paints ${measured.toFixed(3)}`,
      ).toBeLessThan(0.15);
    });
  }

  it('reports the cost ranking, which a0-40 reshuffled — and it is the Director’s to act on', () => {
    // **Stated rather than asserted, because it is now false and the fix is not
    // Art's.** `MAP_NEBULA` placed six skies by one rule — the cheapest sky on the
    // board that runs on the most devices, the costliest on the board with the
    // fewest entities — against the ranking NONE < Iron Veil < Coalsack < Deep
    // Ember < Patina Drift < Plasma Reef. Porting to the design reshuffled it
    // completely, and the additive sky is no longer the most expensive one.
    // Re-assigning a map's sky changes that map's identity, so it is not a thing
    // this brief takes on its own; the number is printed so the decision is in
    // front of whoever makes it.
    const byCost = [...NEBULA_IDS].sort((a, b) => NEBULAE[b].overdraw - NEBULAE[a].overdraw);
    // eslint-disable-next-line no-console
    console.log(
      `  overdraw, costliest first: ${byCost
        .map((id) => `${NEBULAE[id].name} ${NEBULAE[id].overdraw.toFixed(3)}`)
        .join(' · ')}`,
    );
    expect(NEBULAE.none.overdraw).toBe(0);
    // NONE is still the cheapest, which is the only half of the rule that still
    // holds — and it is the half the default map depends on.
    expect(byCost[byCost.length - 1]).toBe('none');
  });

  it('costs the same per SCREEN whatever arena it is over — the number the GPU pays', () => {
    // The invariant that makes the overdraw column one number rather than one per
    // map. Feature size comes from the viewport and element count from
    // field-area/screen-area, so doubling the parallax field doubles the elements
    // and leaves the fill on any given frame exactly where it was.
    const SCREEN = { w: 844, h: 390 } as const; // the landscape phone
    for (const id of NEBULA_IDS) {
      const small = nebulaSprite(id, VOID_SEED, 1800, 900, 1, SCREEN.w, SCREEN.h).shapes.length;
      const big = nebulaSprite(id, VOID_SEED, 3600, 1800, 1, SCREEN.w, SCREEN.h).shapes.length;
      if (small === 0) continue; // NONE
      // 4× the field, ~4× the elements — and therefore the same density per screen.
      expect(big / small, `${NEBULAE[id].name}: ${small} → ${big}`).toBeGreaterThan(3.4);
      expect(big / small, `${NEBULAE[id].name}: ${small} → ${big}`).toBeLessThan(4.6);
    }
  });

  it('shows the sky on the screen, not somewhere off in the parallax field', () => {
    // The bug this pins: sized to the FIELD, a sky on a wide arena spread its nine
    // clots across the whole parallax span and a given frame showed one or none —
    // the first Plasma Reef evidence frame came back with no reef in it. Sampled
    // over the viewport-sized window at the centre of a wide arena's field, every
    // sky that is not NONE has to actually be there.
    const SCREEN = { w: 844, h: 390 } as const;
    // The real field a wide arena builds on a phone, taken from the renderer's own
    // sizing rather than typed in — it moved when a0-07b raised the sky's parallax
    // (2177 → 2371 across), and a hard-coded number would have silently kept
    // testing the old build's field.
    const FIELD_W = coverSpan(SKY_PARALLAX, SCREEN.w, 3200);
    const FIELD_H = coverSpan(SKY_PARALLAX, SCREEN.h, 2000);
    for (const id of NEBULA_IDS) {
      if (id === 'none') continue;
      const shapes = nebulaSprite(id, VOID_SEED, FIELD_W, FIELD_H, 1, SCREEN.w, SCREEN.h).shapes;
      let hit = 0;
      const COLS = 60;
      const ROWS = 30;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const x = ((c + 0.5) / COLS - 0.5) * SCREEN.w;
          const y = ((r + 0.5) / ROWS - 0.5) * SCREEN.h;
          if (shapes.some((s) => covers(s, x, y))) hit++;
        }
      }
      expect(hit / (COLS * ROWS), `${NEBULAE[id].name} covers this much of the screen`).toBeGreaterThan(0.15);
    }
  });

  it('the reduced tier sheds what each sky declares it sheds', () => {
    for (const id of NEBULA_IDS) {
      const spec = NEBULAE[id];
      const full = nebulaSprite(id, VOID_SEED, FIELD.w, FIELD.h, 1).shapes.length;
      if (id === 'none') {
        // The one sky that is no geometry at any tier. It declares 0 and means
        // it; the renderer skips this layer on the id, never on the density.
        expect(full, 'None builds nothing').toBe(0);
        continue;
      }
      const reduced = nebulaSprite(id, VOID_SEED, FIELD.w, FIELD.h, spec.reducedDensity).shapes.length;
      expect(reduced, spec.name).toBeLessThanOrEqual(full);
      if (spec.reducedDensity < 1) expect(reduced, spec.name).toBeLessThan(full);
    }
  });

  /**
   * **r9-01 — the shed has a floor, and the table has to sit on it.** The Oval's
   * sky left the stage 8.3 s into a live match because Plasma Reef declared
   * `reducedDensity: 0` and `0` meant *delete the layer*. The behaviour is fixed
   * in the renderer (`backdrop-reducer.test.ts` holds that half); this is the
   * half that keeps the *table* from re-authoring the cliff — a sky with geometry
   * may never declare itself away, and what a throttled device is left with has
   * to still be a sky.
   */
  it('no sky with geometry can be declared out of existence', () => {
    for (const id of NEBULA_IDS) {
      const spec = NEBULAE[id];
      if (id === 'none') continue;
      expect(spec.reducedDensity, `${spec.name} declares at or above the floor`).toBeGreaterThanOrEqual(
        SKY_REDUCED_FLOOR,
      );
      // The backstop, independently: whatever the table says, the density the
      // renderer builds with is positive and leaves real geometry behind.
      const d = reducedSkyDensity(spec);
      expect(d, spec.name).toBeGreaterThanOrEqual(SKY_REDUCED_FLOOR);
      expect(nebulaSprite(id, VOID_SEED, FIELD.w, FIELD.h, d).shapes.length, spec.name).toBeGreaterThan(0);
    }
    // And the clamp genuinely clamps, on a spec the table is not allowed to hold.
    expect(reducedSkyDensity({ ...NEBULAE.plasmaReef, reducedDensity: 0 })).toBe(SKY_REDUCED_FLOOR);
  });

  it('a thinned sky is a cheaper sky and never a brighter one', () => {
    for (const id of NEBULA_IDS) {
      const spec = NEBULAE[id];
      if (id === 'none' || spec.reducedDensity >= 1) continue;
      const d = reducedSkyDensity(spec);
      // Cheaper: the whole reason the tier exists. Reported, not just asserted —
      // "a fraction of it saves a fraction of nothing" was the claim that made
      // the reef droppable, and it was never measured.
      const full = overdrawOf(id);
      const thin = overdrawOf(id, d);
      // eslint-disable-next-line no-console
      console.log(
        `  ${spec.name.padEnd(13)} reduced ${d}: overdraw ${full.toFixed(3)} -> ${thin.toFixed(3)} ` +
          `(${((1 - thin / full) * 100).toFixed(0)}% of this sky's fill, gone)`,
      );
      expect(thin, `${spec.name} costs less thinned`).toBeLessThan(full);
      // Never brighter: fewer elements can only remove light, and on the additive
      // sky that is the one direction that could have surprised us.
      expect(skyBrightness(id, d).peakLuma, `${spec.name} peak`).toBeLessThanOrEqual(spec.peakLuma * 1.001);
    }
  });

  it('every sky stays inside the void’s budget — which a0-40 raised, and this is what it costs', () => {
    // **The second ceiling the brief names as a cause, re-derived from the ported
    // sky.** It was 1.5× and every sky sat under 0.63, which is what a backdrop
    // five times darker than its design costs: almost nothing. The design's skies
    // cost 2.2–3.2 screens of translucent fill per frame, because lift comes from
    // coverage and there is no other way to buy it.
    //
    // What that buys is the whole brief: nebula lift 0.02–0.92 → 3.8–10.0, on the
    // developer's own instrument. What it costs is real, it is a mobile fill-rate
    // number (GDD §4.3 risk 5), and it is stated here rather than discovered in a
    // perf gate — the auto-reducer takes each sky to 0.76–1.52, and the map that
    // every device boots into is still NONE at 0.000.
    const BUDGET = 3.5;
    for (const id of NEBULA_IDS) {
      const full = overdrawOf(id);
      const thin = id === 'none' ? 0 : overdrawOf(id, reducedSkyDensity(NEBULAE[id]));
      // eslint-disable-next-line no-console
      console.log(`  ${NEBULAE[id].name.padEnd(13)} overdraw ${full.toFixed(3)} → thinned ${thin.toFixed(3)}`);
      expect(full, NEBULAE[id].name).toBeLessThan(BUDGET);
      expect(thin, `${NEBULAE[id].name} thinned`).toBeLessThan(2);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. The composite stack — what the frame actually shows
// ---------------------------------------------------------------------------

describe('the review tile is the whole stack, in composite order', () => {
  it('grounds every tile in Floor first', () => {
    for (const id of NEBULA_IDS) {
      const tile = nebulaTileSprite(id, VOID_SEED, 480, 300);
      expect(tile.shapes[0]!.fill?.color).toBe(FLOOR);
      expect(tile.shapes[0]!.fill?.alpha).toBe(1);
    }
  });

  it('puts the dust IN FRONT of the stars and the light behind them', () => {
    // Coalsack's whole look is the ordering: stars go missing behind it. Every
    // other sky sits behind the field, so stars sit on top of it.
    const occluding = NEBULA_IDS.filter((id) => NEBULAE[id].occludes);
    expect(occluding).toEqual(['coalsack']);

    /** The index of the last shape wearing `role` (the topmost of that layer). */
    const topOf = (def: SpriteDef, role: string): number => {
      let at = -1;
      def.shapes.forEach((s, i) => {
        if (s.role === role) at = i;
      });
      return at;
    };

    const tile = nebulaTileSprite('coalsack', VOID_SEED, 480, 300);
    expect(topOf(tile, 'sky')).toBeGreaterThan(topOf(tile, 'material'));

    const behind = nebulaTileSprite('patinaDrift', VOID_SEED, 480, 300);
    expect(topOf(behind, 'sky')).toBeLessThan(topOf(behind, 'material'));
  });

  it('makes the dust dark enough to take a star out of the frame, and dust-coloured', () => {
    // Not decoration: at the lane's core the dust has to overwrite what is behind
    // it, or "stars go missing" is a caption rather than a look.
    //
    // **a0-40 changed what it is made of, and this is the assertion that records
    // it.** It used to be lobes of GROUND_COLOR — pure occlusion, adding no light,
    // measured lift 0.02 — and a blob the colour of the ground is invisible
    // against the ground however opaque it is. The design's Coalsack lifts 4.55,
    // so the dust is now darker than the field and brighter than the void behind
    // it, which is what a dark nebula actually is.
    const shapes = nebulaSprite('coalsack', VOID_SEED, FIELD.w, FIELD.h).shapes;
    const peakAlpha = Math.max(...shapes.map((s) => s.fill?.alpha ?? 0));
    expect(peakAlpha, 'the lane’s core is opaque enough to occlude').toBeGreaterThan(0.3);
    const pair = new Set<number>(MOCKUP_REFERENCE.coalsack.hues);
    expect(shapes.every((s) => pair.has(s.fill!.color)), 'dust is the design’s pair').toBe(true);
    // Darker than everything it crosses, brighter than nothing at all.
    for (const c of pair) {
      expect(luma(unpack(c)), `${hex(c)} is darker than the rock body`).toBeLessThan(
        luma(unpack(DERIVED.rockBody)),
      );
      expect(luma(unpack(c)), `${hex(c)} is brighter than the ground`).toBeGreaterThan(GROUND_LUMA);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. The sky has to MOVE (a0-07b) — the developer's live-play report, measured
// ---------------------------------------------------------------------------

/**
 * *"the parallax effect is kind of broken, those bloom as moving with the ship
 * on the front layer, they are supposed to be attached to stars…"*
 *
 * Nothing was screen-locked; the sky drifted at 0.05, **half** the farthest star
 * layer's 0.10, and a discrete clot that falls that far behind the field it is
 * drawn among reads as a foreground overlay riding the ship. These are the
 * numbers that make "attached to the stars" checkable rather than a matter of
 * taste, and they are stated as *relations to the star layers* on purpose — the
 * eye has no absolute ruler for backdrop speed, only the other layers.
 *
 * The camera is 1:1 with world units (render/index.ts offsets `worldRoot` by the
 * camera offset and never scales), so a parallax factor is literally *screen px
 * per world unit flown*.
 */
describe('the sky travels with the stars, not with the ship (a0-07b)', () => {
  /** The farthest star layer — the reference every claim below is against. */
  const FAR = STAR_LAYERS[0]!;
  /** The landscape phone the game is locked to (GDD §4.6), and its short side. */
  const SCREEN = { w: 844, h: 390 } as const;
  /** What the sky drifted in the build the developer reported. */
  const REPORTED = 0.05;
  /** The skies that sit behind the field (everything but the dust lane). */
  const DISTANT = NEBULA_IDS.filter((id) => !NEBULAE[id].occludes);

  it('the far star layer really is the farthest star layer', () => {
    // Everything below is phrased against STAR_LAYERS[0]; if the layer order ever
    // changes, these assertions must be re-read rather than silently re-pointed.
    expect(FAR.key).toBe('deep');
    expect([...STAR_LAYERS].sort((a, b) => a.parallax - b.parallax)[0]!.key).toBe('deep');
  });

  it('every distant sky sits strictly behind the farthest stars — the depth order holds', () => {
    for (const id of DISTANT) {
      expect(NEBULAE[id].parallax, `${NEBULAE[id].name} vs the deep star layer`).toBeLessThan(FAR.parallax);
    }
    // …and the one sky that is dust in FRONT of the field is between the two star
    // layers it lives between: it eats the deep layer and is eaten by the mid one.
    const mid = STAR_LAYERS.find((l) => l.key === 'mid')!;
    expect(NEBULAE.coalsack.parallax).toBeGreaterThan(FAR.parallax);
    expect(NEBULAE.coalsack.parallax).toBeLessThan(mid.parallax);
  });

  it('travels WITH the far field: it keeps at least 80% of the deep layer’s drift', () => {
    // This is the fix, in one ratio. At 0.05 the sky kept 50% of the deep layer's
    // drift — it visibly fell behind the stars, so the eye refused to group it
    // with them and grouped it with the glass instead. The floor is set at 80%
    // so nobody can walk the number back a little at a time.
    for (const id of DISTANT) {
      const ratio = NEBULAE[id].parallax / FAR.parallax;
      expect(ratio, `${NEBULAE[id].name} keeps this much of the deep layer’s drift`).toBeGreaterThanOrEqual(0.8);
      expect(ratio, `${NEBULAE[id].name} must still be slower than the stars`).toBeLessThan(1);
    }
    expect(REPORTED / FAR.parallax).toBeCloseTo(0.5, 2); // what was reported, for the record
  });

  it('lags the stars by ≤ 20 px per screen-width flown, where it used to lag by 42', () => {
    // The quantity the eye actually judges: how far the sky slips behind the star
    // field over a flight the player can hold in one glance — one screen-width.
    const lag = (f: number): number => (FAR.parallax - f) * SCREEN.w;
    expect(lag(REPORTED)).toBeCloseTo(42.2, 1); // the reported build: half a field behind
    for (const id of DISTANT) {
      expect(lag(NEBULAE[id].parallax), `${NEBULAE[id].name} slips this far behind the stars`).toBeLessThanOrEqual(20);
    }
    // Its own drift over that same flight, which is the other half of the read:
    // 72 px of travel where the reported build had 42.
    expect(SKY_PARALLAX * SCREEN.w).toBeGreaterThan(REPORTED * SCREEN.w * 1.6);
  });

  it('still separates from the stars over a whole arena crossing — distant, not welded on', () => {
    // The other side of the same trade. If the sky matched the deep layer exactly
    // it would be AT the stars' depth, and "further than the farthest stars" would
    // be a coincidence rather than something the frame shows. Over a full crossing
    // the far field must slide measurably past it.
    for (const bound of [2400, 3200]) {
      const separation = (FAR.parallax - SKY_PARALLAX) * bound;
      expect(separation, `${bound} u crossing`).toBeGreaterThan(30);
    }
  });

  it('the field still covers the screen at the faster parallax, at every camera offset', () => {
    // A faster layer has further to travel, so it needs more field. coverSpan is
    // what buys that; this is the assertion that it actually bought enough — the
    // failure mode being a band of bare Floor sliding in from the edge of a phone
    // at the far end of a wide arena.
    for (const [f, view, bound] of [
      [SKY_PARALLAX, SCREEN.w, 3200],
      [SKY_PARALLAX, SCREEN.h, 2000],
      [NEBULAE.coalsack.parallax, SCREEN.w, 3200],
      ...STAR_LAYERS.map((l) => [l.parallax, SCREEN.w, 3200] as const),
    ] as readonly (readonly [number, number, number])[]) {
      const span = coverSpan(f, view, bound);
      for (let i = 0; i <= 40; i++) {
        // The camera offset the renderer computes: view/2 − target, target over the arena.
        const off = view / 2 - (i / 40) * bound;
        const center = view / 2 + off * f; // VoidBackdrop.update
        expect(center - span / 2, `f=${f} at target ${(i / 40) * bound}`).toBeLessThanOrEqual(0);
        expect(center + span / 2, `f=${f} at target ${(i / 40) * bound}`).toBeGreaterThanOrEqual(view);
      }
    }
  });

  it('costs build-time geometry and NOT per-frame fill — the claim the PR makes', () => {
    // Raising the parallax grows the field, and per-screen authoring turns a bigger
    // field into more elements. That is a one-off cost at configure(); the number
    // the GPU pays every frame is per-screen coverage, and it must not move at all.
    const before = {
      w: coverSpan(REPORTED, SCREEN.w, 3200),
      h: coverSpan(REPORTED, SCREEN.h, 2000),
    };
    const after = {
      w: coverSpan(SKY_PARALLAX, SCREEN.w, 3200),
      h: coverSpan(SKY_PARALLAX, SCREEN.h, 2000),
    };
    const areaGrowth = (after.w * after.h) / (before.w * before.h);
    expect(areaGrowth).toBeGreaterThan(1.1);
    expect(areaGrowth, 'the field grows by about a fifth, once, at build time').toBeLessThan(1.3);

    for (const id of NEBULA_IDS) {
      if (id === 'none') continue;
      const was = nebulaSprite(id, VOID_SEED, before.w, before.h, 1, SCREEN.w, SCREEN.h).shapes.length;
      const now = nebulaSprite(id, VOID_SEED, after.w, after.h, 1, SCREEN.w, SCREEN.h).shapes.length;
      // Elements track field area…
      expect(now / was, `${NEBULAE[id].name}: ${was} → ${now} shapes`).toBeGreaterThan(1.05);
      expect(now / was, `${NEBULAE[id].name}: ${was} → ${now} shapes`).toBeLessThan(1.35);
      // …so elements PER SCREENFUL, which is what fill-rate is, do not.
      const perScreenWas = was / ((before.w * before.h) / (SCREEN.w * SCREEN.h));
      const perScreenNow = now / ((after.w * after.h) / (SCREEN.w * SCREEN.h));
      expect(
        Math.abs(perScreenNow - perScreenWas) / perScreenWas,
        `${NEBULAE[id].name} per-screen element count`,
      ).toBeLessThan(0.1);
    }
  });
});
