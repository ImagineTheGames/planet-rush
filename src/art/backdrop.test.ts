/**
 * src/art/backdrop.test.ts — the darker space, measured. OWNER: Art Agent.
 *
 * a0-07 ratified a new ground, a new bloom rule and six skies, one per map. Three
 * of those four are claims about *pixels*, and the brief asked for numbers rather
 * than opinions on every one of them, so this file is a measuring device:
 *
 *  1. **The registry is complete and its hole is stated.** `MAP_NEBULA` has one
 *     entry per ratified map — checked against `sim/maps.ts` itself, so art and
 *     the sim cannot drift — and exactly two skies are left named-but-unassigned
 *     for `a0-12`. A registry with a hole a test asserts is honest; a modulo that
 *     silently repeats is not.
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
  GROUND_COLOR,
  MAP_NEBULA,
  NEBULAE,
  NEBULA_IDS,
  STAR_LAYERS,
  UNASSIGNED_NEBULAE,
  VOID_SEED,
  groundSprite,
  nebulaForMap,
  nebulaSprite,
  nebulaTileSprite,
  starFieldSprite,
  type MapId,
  type NebulaId,
} from './backdrop';
import { MAPS } from '../sim/maps';
import { assertPaletteCompliance, RED_FAMILY, SKY_ALPHA_MAX, SKY_RESERVED_ALPHA_MAX, YELLOW_FAMILY } from './compliance';
import { DERIVED, FLOOR, PALETTE, hex } from './palette';
import { pointInPoly } from './raster';
import type { Shape, SpriteDef } from './shapes';
import { ALL_SPRITES } from './catalogue';

/** The field every sky is measured over — a 16:9 landscape field, the shape a
 *  phone actually plays in (the game is landscape-locked, GDD §4.6). */
const FIELD = { w: 1600, h: 900 } as const;

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

function unpack(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
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
    const a = s.fill.alpha;
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
function skyBrightness(id: NebulaId): { peak: [number, number, number]; peakLuma: number; meanLuma: number } {
  const spec = NEBULAE[id];
  const shapes = nebulaSprite(id, VOID_SEED, FIELD.w, FIELD.h).shapes;
  const COLS = 200;
  const ROWS = 120;
  let peak: [number, number, number] = unpack(GROUND_COLOR);
  let peakY = luma(peak);
  let sum = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = ((c + 0.5) / COLS - 0.5) * FIELD.w;
      const y = ((r + 0.5) / ROWS - 0.5) * FIELD.h;
      const px = compositeAt(shapes, spec.additive, x, y);
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
      return [
        spec.name.padEnd(13),
        `map ${((Object.keys(MAP_NEBULA) as MapId[]).find((m) => MAP_NEBULA[m] === id) ?? '—').padEnd(8)}`,
        `shapes ${String(nebulaSprite(id, VOID_SEED, FIELD.w, FIELD.h).shapes.length).padStart(3)}`,
        `overdraw ${overdrawOf(id).toFixed(3)}`,
        `peak Y′ ${String(b.peakLuma).padStart(5)}`,
        `mean Y′ ${String(b.meanLuma).padStart(5)}`,
        `tax ${`${(tax * 100).toFixed(1)}%`.padStart(5)}`,
        `ΔE ring ${dE(PALETTE.plasma)} / red ${dE(PALETTE.threatRed)} / ore ${dE(PALETTE.signalYellow)}`,
        `reduced ${spec.reducedDensity}`,
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

  it('leaves exactly two skies named and unassigned, for the maps a0-12 is building', () => {
    const assigned = new Set<NebulaId>(Object.values(MAP_NEBULA));
    const free = NEBULA_IDS.filter((id) => !assigned.has(id));
    expect(free).toEqual([...UNASSIGNED_NEBULAE]);
    expect(free).toHaveLength(2);
    // The stated hole IS the point: four maps, six skies, and the two spare ones
    // wait for their maps rather than being doubled up or guessed at.
    expect(Object.keys(MAP_NEBULA)).toHaveLength(NEBULA_IDS.length - free.length);
  });

  it('does not put the costly sky on a derelict-fill board', () => {
    // compass/diamond lay out all eight positions at any roster and carry wrecks
    // plus their debris below eight — the two busiest boards. The additive sky
    // goes anywhere but there (brief).
    const costly = NEBULA_IDS.filter((id) => NEBULAE[id].additive);
    for (const id of costly) {
      const map = (Object.keys(MAP_NEBULA) as MapId[]).find((m) => MAP_NEBULA[m] === id);
      expect(map, `${id} is assigned to ${map}`).not.toBe('compass');
      expect(map, `${id} is assigned to ${map}`).not.toBe('diamond');
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
    expect(GROUND_COLOR).toBe(0x010204);
  });
});

// ---------------------------------------------------------------------------
// 4. Bloom — seeded scatter, subtle
// ---------------------------------------------------------------------------

describe('bloom — seeded scatter, not a brightness threshold', () => {
  const layer = STAR_LAYERS.find((l) => l.key === 'mid')!;
  const def = starFieldSprite(layer, VOID_SEED, 2400, 1600);

  /** Group the sprite's circles into stars (radius in the layer's range) and
   *  their halos (multiples of a star radius, at a fraction of its alpha). */
  function bloomedRadii(): { stars: number; bloomed: number; magnitudes: number[] } {
    let stars = 0;
    let halos = 0;
    const magnitudes: number[] = [];
    for (const s of def.shapes) {
      if (s.path.kind !== 'circle' || !s.fill) continue;
      if (s.path.r <= layer.maxR + 1e-6) {
        stars++;
        magnitudes.push(s.path.r);
      } else {
        halos++;
      }
    }
    return { stars, bloomed: halos / BLOOM.radii.length, magnitudes };
  }

  it('blooms about the scattered fraction of stars', () => {
    const { stars, bloomed } = bloomedRadii();
    expect(stars).toBeGreaterThan(100);
    expect(bloomed / stars).toBeGreaterThan(BLOOM.scatter * 0.7);
    expect(bloomed / stars).toBeLessThan(BLOOM.scatter * 1.3);
  });

  it('picks by seed, not by magnitude — faint stars flare and bright ones do not', () => {
    // The distinguishing property of the ratified rule. Walk the sprite in draw
    // order: a halo is emitted immediately before the star it belongs to, so the
    // star that follows a halo is a bloomed one.
    const bloomedMag: number[] = [];
    const plainMag: number[] = [];
    let pendingHalo = 0;
    for (const s of def.shapes) {
      if (s.path.kind !== 'circle' || !s.fill) continue;
      if (s.path.r > layer.maxR + 1e-6) {
        pendingHalo++;
        continue;
      }
      (pendingHalo > 0 ? bloomedMag : plainMag).push(s.path.r);
      pendingHalo = 0;
    }
    // Both populations span the layer's whole magnitude range: a threshold rule
    // would have made these two disjoint intervals.
    expect(Math.min(...bloomedMag)).toBeLessThan(layer.minR + (layer.maxR - layer.minR) * 0.25);
    expect(Math.max(...plainMag)).toBeGreaterThan(layer.minR + (layer.maxR - layer.minR) * 0.75);
  });

  it('is the SUBTLE tier, and is meant to stay there', () => {
    // Chosen so bloom survives a bright nebula without adding to it. The guard is
    // deliberately tight: nudging these upward is the failure mode this brief
    // named ("do not 'improve' it upward").
    expect(BLOOM.intensity[0]).toBeLessThanOrEqual(0.2);
    expect(BLOOM.intensity[1]).toBeLessThanOrEqual(0.1);
    expect(BLOOM.scatter).toBeLessThanOrEqual(0.25);
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
  const MAX_TAX = 0.1;

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
        expect(
          tax,
          `${sig.what} over ${where}: ${onGround.toFixed(2)}:1 on bare Floor → ${onSky.toFixed(2)}:1`,
        ).toBeLessThan(MAX_TAX);
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
    expect(ratio, `owner ring over the reef's brightest clot = ${ratio.toFixed(2)}:1`).toBeGreaterThan(5);
    expect(dE, `owner ring vs the reef's brightest clot: ΔE ${dE.toFixed(1)}`).toBeGreaterThan(60);
    // And the reason it survives: the reef is bright FOR A SKY, and a sky is a
    // different order of thing from a ring.
    expect(peakLuma).toBeLessThan(luma(unpack(PALETTE.plasma)) / 5);
  });

  it('no sky is ever brighter than the ink every sprite is outlined in', () => {
    // The one invariant that keeps "subtle" from being a matter of taste. The
    // backdrop sits behind the linework; it does not get to out-value it.
    const ink = luma(unpack(DERIVED.rockFissure));
    for (const id of NEBULA_IDS) {
      expect(skyBrightness(id).peakLuma, `${NEBULAE[id].name} vs the ink at ${ink.toFixed(1)}`).toBeLessThan(ink);
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
    // Coalsack is the one sky that only ever DARKENS: it cannot exceed the ground.
    expect(NEBULAE.coalsack.peakLuma).toBe(NEBULAE.none.peakLuma);
  });

  it('a darker ground is strictly better for rock legibility — settled, not re-opened', () => {
    const onVacuum = contrast(unpack(DERIVED.rockBody), unpack(PALETTE.vacuum));
    const onFloor = contrast(unpack(DERIVED.rockBody), unpack(FLOOR));
    expect(onVacuum).toBeCloseTo(2.27, 1);
    expect(onFloor).toBeCloseTo(2.47, 1);
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

  it('the additive sky is the most expensive one, as the brief says it is', () => {
    const byCost = [...NEBULA_IDS].sort((a, b) => NEBULAE[b].overdraw - NEBULAE[a].overdraw);
    expect(NEBULAE[byCost[0]!].additive).toBe(true);
    expect(NEBULAE.none.overdraw).toBe(0);
  });

  it('element counts are fixed per sky, so a wide arena costs what a square one does', () => {
    // Feature SIZE follows the field; feature COUNT does not. That is what makes
    // the overdraw column above a constant rather than a number per map.
    for (const id of NEBULA_IDS) {
      const square = nebulaSprite(id, VOID_SEED, 2000, 2000).shapes.length;
      const wide = nebulaSprite(id, VOID_SEED, 3200, 2000).shapes.length;
      expect(wide, NEBULAE[id].name).toBe(square);
    }
  });

  it('the reduced tier sheds what each sky declares it sheds', () => {
    for (const id of NEBULA_IDS) {
      const spec = NEBULAE[id];
      const full = nebulaSprite(id, VOID_SEED, FIELD.w, FIELD.h, 1).shapes.length;
      if (spec.reducedDensity === 0) {
        // Dropped entirely — the renderer skips the layer, so nothing is built.
        expect(spec.id === 'none' || spec.additive, `${spec.name} drops under reduce`).toBe(true);
        continue;
      }
      const reduced = nebulaSprite(id, VOID_SEED, FIELD.w, FIELD.h, spec.reducedDensity).shapes.length;
      expect(reduced, spec.name).toBeLessThanOrEqual(full);
      if (spec.reducedDensity < 1) expect(reduced, spec.name).toBeLessThan(full);
    }
  });

  it('every sky stays inside the void’s own budget: under 1.5× overdraw', () => {
    // A per-frame full-screen layer on a mobile GPU. One-and-a-half screens of
    // translucent fill is the ceiling the void gets; the fleet needs the rest.
    for (const id of NEBULA_IDS) {
      expect(overdrawOf(id), NEBULAE[id].name).toBeLessThan(1.5);
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

  it('makes the dust dark enough to actually take a star out of the frame', () => {
    // Not decoration: at the lane's core the dust has to overwrite what is behind
    // it, or "stars go missing" is a caption rather than a look.
    const shapes = nebulaSprite('coalsack', VOID_SEED, FIELD.w, FIELD.h).shapes;
    const peakAlpha = Math.max(...shapes.map((s) => s.fill?.alpha ?? 0));
    expect(peakAlpha).toBeGreaterThan(0.7);
    expect(shapes.every((s) => s.fill?.color === GROUND_COLOR)).toBe(true);
  });
});
