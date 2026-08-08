/**
 * src/art/backdrop.ts — the void, v3: the darker space. OWNER: Art Agent.
 *
 * v2 (a2-06) gave the void a body — a layered parallax star-field over a single
 * patina/steel wash. **a0-07 replaces the ground under it and turns the wash
 * into map identity.** Both halves are ratifications off the developer's
 * backdrop compositor (2026-08-07), not explorations:
 *
 * > *"i like floor, (nebula i like all of them including none) i think each map
 * > should get one of these … (seeded scatter), and subtle…"*
 *
 * | axis | picked |
 * |---|---|
 * | Ground | **Floor `#010204`** — replaces Vacuum as the *backdrop* (`./tokens` `FLOOR`) |
 * | Bloom rule | **seeded scatter** — which stars bloom is a pure function of the seed, at any magnitude |
 * | Bloom intensity | **subtle** — the lowest of the three shown ({@link BLOOM}) |
 * | Nebula | **all six, one per map** — including NONE ({@link MAP_NEBULA}) |
 *
 * ## The sky is part of a map's identity, and it is a registry
 *
 * {@link MAP_NEBULA} names one sky per map, by hand. Not a hash of the map id,
 * not `index % 6`: a modulo would silently repeat the day a fifth map lands and
 * would give two maps the same sky without anyone deciding it. Four of the six
 * are assigned here; `a0-12` is building the two maps the other two belong to,
 * and {@link UNASSIGNED_NEBULAE} names them so the hole in the registry is a
 * *stated* hole a test asserts rather than a gap someone fills by guessing.
 *
 * ## What a darker ground does and does not change
 *
 * It does **not** hurt rock legibility, and that was measured rather than
 * argued: a darker ground raises contrast for anything lighter than it, and on
 * this palette that is everything. `rockBody #484E57` reads 2.27:1 on Vacuum and
 * **2.47:1 on Floor** — 8.9% more. No rim light or contrast floor was added,
 * because there is no problem to compensate for (style-guide §1.1).
 *
 * What it does not help with is **additive light in the same hue as a
 * load-bearing colour**, which is independent of how dark the ground is. The
 * owner beacon ring is plasma `#4DC3FF` and Plasma Reef is a cyan additive sky —
 * that collision is the one real check, and `backdrop.test.ts` measures it two
 * ways, because brightness and hue are different questions:
 *
 *  - **contrast** — the ring reads **9.4:1** over the reef's brightest clot,
 *    against 10.4:1 over bare Floor. The sky costs it 9.7% of its contrast.
 *  - **colour** — CIE76 **ΔE 78** between the ring and that same clot, against a
 *    40 floor. Cyan light on a cyan sky is still unmistakably two colours.
 *
 * The first build of the reef failed the first of those at **69%** and is why
 * {@link ADDITIVE_STOPS} exists. If a sky ever fails again, the fix is the
 * *assignment* — give that map a different sky — never the palette and never the
 * ground.
 *
 * ## The palette, including the two warm skies
 *
 * No seventh hue. Stars are the steel value ramp; the skies are patina, plasma,
 * steel, Floor itself — and, for Iron Veil and Deep Ember, threat red at a
 * whisper the audit enforces numerically (style-guide §2.2 / `./compliance`
 * `SKY_RESERVED_ALPHA_MAX`). Signal yellow never appears on the sky at any
 * alpha. Every sky ink is painted on the `sky` role, which no entity may wear.
 *
 * ## It respects the frame budget (GDD §4.3, risk 5)
 *
 * Same discipline as v2, and it has to be stricter because a nebula is a
 * per-frame fill-rate layer on a mobile GPU. Geometry is played into a **static
 * `Graphics` once per layer** at {@link VoidBackdrop.configure}; per frame the
 * only thing touched is each layer's `position`. A sky is authored **per
 * screenful**, not per arena: feature size comes from the viewport and element
 * count from field-area ÷ screen-area, so the developer's own numbers (14
 * sheets, 22 blobs) are what a *phone* sees, and {@link NebulaSpec.overdraw} is
 * a genuine per-frame constant a test can pin on any map. Each sky declares its
 * own {@link NebulaSpec.reducedDensity}: what `VfxAutoQuality` leaves of it when
 * the auto-reducer throttles a device — 0 drops the layer.
 *
 * Sizing to the *field* instead was the first build's mistake and it is worth
 * remembering: on a wide arena the parallax field is ~2.2 screens across, so
 * Plasma Reef's nine clots spread over five screenfuls and the evidence frame
 * came back **with no reef in it**.
 */

import { Container, Graphics } from 'pixi.js';
import { mulberry32 } from '@shared/types';
import { DERIVED, FLOOR, PALETTE, WHITE } from './palette';
import { circle, fill, poly, polyline, round, sprite, stroke, type Shape, type SpriteDef } from './shapes';
import { drawSprite } from './textures';

// ---------------------------------------------------------------------------
// Look constants — the whole void, in one place
// ---------------------------------------------------------------------------

/** A stable seed for the void. The field is procedural but the *same* every
 *  boot (GDD §4.1), so the frozen golden scene is byte-deterministic. */
export const VOID_SEED = 0x5061_6365; // 'Pace' — a wink, and a fixed 32-bit seed.

/**
 * **The ground.** Every layer below is composited over this, and it is drawn as
 * a real opaque quad rather than left to the canvas clear colour — the backdrop
 * owns its own ground, so the void looks the same whatever is behind it.
 */
export const GROUND_COLOR = FLOOR;

/** A star colour: one of the steel-ramp values, dimmed by alpha, not by hue. */
interface StarInk {
  readonly color: number;
  readonly alpha: number;
}

/** One depth layer of the star-field. */
export interface StarLayerSpec {
  /** Stable id — part of the sprite name (texture/pool key) and the layer seed. */
  readonly key: string;
  /** Parallax factor: 0 = fixed to the screen (infinitely far), 1 = locked to
   *  the world (moves with the fleet). Far layers are small, near layers large. */
  readonly parallax: number;
  /** Stars per 1e6 px² of covered area — far layers are dense with faint dust,
   *  near layers sparse with bright points. */
  readonly density: number;
  /** Star radius range, world/screen px. */
  readonly minR: number;
  readonly maxR: number;
  /** The brightness palette a star is drawn from (sampled uniformly). */
  readonly inks: readonly StarInk[];
  /** Fraction of stars in this layer that get a faint diffraction glint (a
   *  short cross through the point) — a touch of sparkle on the brightest layer. */
  readonly glint: number;
}

/**
 * Three depth layers, back to front. Steel value ramp only (style-guide §1):
 * a star is a *bright point*, so it climbs by alpha/whiteness, never by hue.
 */
export const STAR_LAYERS: readonly StarLayerSpec[] = [
  {
    key: 'deep',
    parallax: 0.1,
    density: 92,
    minR: 0.45,
    maxR: 0.95,
    // Faint far dust: dim steel, a hair of lit steel. Never white — distance
    // steals a star's colour before its light.
    inks: [
      { color: PALETTE.hullSteel, alpha: 0.26 },
      { color: PALETTE.hullSteel, alpha: 0.38 },
      { color: DERIVED.hullLight, alpha: 0.3 },
    ],
    glint: 0,
  },
  {
    key: 'mid',
    parallax: 0.26,
    density: 46,
    minR: 0.7,
    maxR: 1.35,
    inks: [
      { color: DERIVED.hullLight, alpha: 0.55 },
      { color: PALETTE.hullSteel, alpha: 0.7 },
      { color: WHITE, alpha: 0.42 },
    ],
    glint: 0.04,
  },
  {
    key: 'near',
    parallax: 0.5,
    density: 13,
    minR: 1.15,
    maxR: 2.2,
    // The closest, brightest points — the ramp's white endpoint carries these.
    inks: [
      { color: WHITE, alpha: 0.88 },
      { color: DERIVED.hullLight, alpha: 0.92 },
      { color: WHITE, alpha: 0.64 },
    ],
    glint: 0.22,
  },
];

/**
 * **Bloom — seeded scatter, subtle** (the developer's pick, a0-07).
 *
 * The compositor showed two rules: bloom by *brightness threshold* (the top N%
 * of stars glow) and bloom by **seeded scatter** (which stars glow is drawn from
 * the seed, at any magnitude). Scatter won, and the difference is not cosmetic:
 * a threshold makes bloom a *property of a star's magnitude*, so the void reads
 * as one uniform material with a bright tier stamped on it. Scatter makes it a
 * property of the star, so a faint far point can flare and a bright near one can
 * sit flat — which is what real fields do, and what stops the near layer from
 * looking like a row of headlights.
 *
 * It is a pure function of the seed, so two players in one match see the same
 * sky and a replay is stable (GDD §4.1) — the whole reason the rule is stated as
 * "seeded" rather than "random".
 *
 * `intensity` is the **lowest of the three magnitudes shown**, and it is meant to
 * stay there. Subtle was chosen so that bloom *survives a bright nebula without
 * adding to it*: over Plasma Reef, a halo at this alpha is still a halo and not a
 * second wash. Do not "improve" it upward.
 */
export const BLOOM = {
  /** Fraction of stars, in every layer, that bloom. Chosen by seed, not by size. */
  scatter: 0.18,
  /** Halo radii, as multiples of the star's own radius (inner ring, outer ring). */
  radii: [2.4, 4.3] as const,
  /** Halo alphas, as fractions of the star's own alpha. **Subtle** — the lowest
   *  of the compositor's three. */
  intensity: [0.16, 0.065] as const,
} as const;

// ---------------------------------------------------------------------------
// The six skies (a0-07) — one per map, including NONE
// ---------------------------------------------------------------------------

/** The six ratified skies, as the developer named them off the compositor. */
export type NebulaId = 'none' | 'coalsack' | 'ironVeil' | 'patinaDrift' | 'plasmaReef' | 'deepEmber';

/**
 * One sky: what it looks like, where it sits in the stack, what it costs, and
 * what the auto-reducer leaves of it. A spec rather than six ad-hoc functions,
 * because the perf story has to be statable per sky (brief) and a table is the
 * only honest way to state it.
 */
export interface NebulaSpec {
  readonly id: NebulaId;
  /** The developer's own name for it. */
  readonly name: string;
  /** One line: what it does to the frame. */
  readonly blurb: string;
  /** Parallax factor — every sky sits further than the farthest stars, except
   *  the one that is *in front* of them (Coalsack), which sits nearer. */
  readonly parallax: number;
  /**
   * True for a sky drawn **over** the star layers, so stars go missing behind
   * it. Only Coalsack: it is dust, and dust occludes. Everything else is light
   * and sits behind the field.
   */
  readonly occludes: boolean;
  /** True for an additive layer (`blendMode = 'add'`). The expensive kind. */
  readonly additive: boolean;
  /**
   * Coverage this sky paints, as a multiple of the field it covers — i.e. its
   * **overdraw**, the number the mobile GPU actually pays. Measured off the
   * generated geometry by `backdrop.test.ts`, which fails if a sky drifts more
   * than 15% from the figure declared here, so this table can never quietly rot.
   */
  readonly overdraw: number;
  /**
   * **How bright this sky ever gets**: the luma (Y′, 0..255) of its brightest
   * composited pixel over Floor, measured by `backdrop.test.ts` and pinned there
   * to within 15%. This is the number "subtle" means, and the ladder it makes is
   * the whole art direction of the set:
   *
   * ```
   *   None / Coalsack  1.9   ← the ground itself; Coalsack only ever darkens
   *   Iron Veil        9.3
   *   Deep Ember       9.7
   *   Patina Drift    15.8
   *   Plasma Reef     17.4   ← the brightest, as the developer described it
   *   ----------------------------------------------------------------
   *   the ink outline 43.4   ← every sky stays under the line every sprite is drawn with
   *   the rock body   77.5
   * ```
   *
   * The invariant the test enforces is that last gap: **no sky is ever brighter
   * than `rockFissure`, the ink every sprite in the game is outlined in.** A
   * backdrop that out-values the linework is a backdrop competing with the fleet.
   */
  readonly peakLuma: number;
  /**
   * What `VfxAutoQuality` leaves of this sky on a throttled device (GDD §4.3
   * risk 5): a multiplier on element count, where **0 drops the layer**. The
   * cheap skies keep their whole selves — dropping an occluding dust lane would
   * make a wall of stars appear mid-match, which is a worse artefact than the
   * cost it saves. The additive one goes, because additive overdraw *is* the
   * cost.
   */
  readonly reducedDensity: number;
  /**
   * The geometry, authored centred on the origin across a `width`×`height` box.
   *
   * `screen` is the viewport the sky will be *seen* through, and it is what the
   * look is authored against: feature size is a fraction of the screen's short
   * side, and the element count is `count × (field area / screen area)` — so the
   * developer's own numbers ("14 sheets", "22 soft blobs") mean **per screenful**,
   * which is how they were seen on the compositor board.
   *
   * That is not a detail. Sized to the *field* instead, a sky on a wide arena
   * spreads its nine clots over five screens' worth of parallax field and a given
   * frame shows one or none of them — which is exactly what the first build did:
   * the Plasma Reef evidence frame came back with no reef in it. Per-screen
   * sizing also makes {@link overdraw} a genuine per-frame constant instead of a
   * number that quietly falls with arena size.
   *
   * `density` scales element counts (1 = full, 0.5 = half); it never changes
   * feature size, so a reduced sky is the same sky with fewer parts.
   */
  build(
    seed: number,
    width: number,
    height: number,
    density: number,
    screenW: number,
    screenH: number,
  ): Shape[];
}

/**
 * How a soft blob fades from centre to rim: `[radius fraction, alpha fraction]`,
 * back to front. A real radial gradient is not expressible in the flat-fill IR
 * (./shapes), so every soft edge in this file is a stack of concentric discs —
 * the same approximation the atmosphere halo uses (./stations), for the same
 * reason: it bakes to one static layer and costs nothing per frame.
 */
const SOFT_STOPS: readonly (readonly [number, number])[] = [
  [1.0, 0.18],
  [0.72, 0.42],
  [0.46, 0.72],
  [0.2, 1.0],
];

/**
 * The same falloff for an **additive** layer, and it is a different table for a
 * reason worth writing down, because getting it wrong is what made the first
 * Plasma Reef a disqualifier.
 *
 * Under normal blending a nested stack *converges*: each disc composites over
 * the last, so a peak alpha of 0.06 stays near 0.06 no matter how many stops are
 * in it. Under **additive** blending it *accumulates* — the four stops of one
 * node add to 2.3× the peak, and five overlapping nodes in a clot add again.
 * The first build of the reef peaked at Y′ 88/255 that way: brighter than the
 * ink outline every sprite in the game is drawn with, and enough to erase the
 * clockwise threat fill it sat behind (measured at 1.10:1 — the frame the brief
 * calls the disqualifier, and it failed).
 *
 * So the additive stops are stated as *increments that sum to one*: the centre
 * of a node adds exactly its declared peak, and the rim adds a seventh of it.
 * Bright stays a decision instead of an accident.
 */
const ADDITIVE_STOPS: readonly (readonly [number, number])[] = [
  [1.0, 0.14],
  [0.72, 0.22],
  [0.46, 0.28],
  [0.2, 0.36],
];

/** A soft disc: a concentric stack faking a radial falloff. */
function softDisc(
  out: Shape[],
  cx: number,
  cy: number,
  radius: number,
  color: number,
  peakAlpha: number,
  stops: readonly (readonly [number, number])[] = SOFT_STOPS,
): void {
  for (const [rFrac, aFrac] of stops) {
    const a = round(peakAlpha * aFrac);
    if (a <= 0) continue;
    out.push(circle(cx, cy, round(radius * rFrac), fill(color, 'sky', a)));
  }
}

/**
 * A **wisp**: an elongated, slightly ragged blob at an angle — the shape a
 * nebula filament actually has, and the reason Patina Drift reads as drift
 * rather than as a row of discs. Built as a stack of scaled radial polygons so
 * it fades like {@link softDisc} does.
 */
function softWisp(
  out: Shape[],
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  angle: number,
  color: number,
  peakAlpha: number,
  ragged: () => number,
): void {
  const VERTS = 14;
  // One ragged radius per vertex, shared by every stop, so the stack nests.
  const jitter: number[] = [];
  for (let i = 0; i < VERTS; i++) jitter.push(0.78 + ragged() * 0.44);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (const [rFrac, aFrac] of SOFT_STOPS) {
    const a = round(peakAlpha * aFrac);
    if (a <= 0) continue;
    const pts: number[] = [];
    for (let i = 0; i < VERTS; i++) {
      const t = (i / VERTS) * Math.PI * 2;
      const ex = Math.cos(t) * rx * rFrac * jitter[i]!;
      const ey = Math.sin(t) * ry * rFrac * jitter[i]!;
      pts.push(round(cx + ex * cos - ey * sin), round(cy + ex * sin + ey * cos));
    }
    out.push(poly(pts, fill(color, 'sky', a)));
  }
}

/** A rotated rectangle (a "sheet"), as a closed quad. */
function sheet(
  out: Shape[],
  cx: number,
  cy: number,
  halfLength: number,
  halfThick: number,
  angle: number,
  color: number,
  alpha: number,
): void {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const pts: number[] = [];
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const ex = sx * halfLength;
    const ey = sy * halfThick;
    pts.push(round(cx + ex * cos - ey * sin), round(cy + ex * sin + ey * cos));
  }
  out.push(poly(pts, fill(color, 'sky', round(alpha))));
}

/** `count` scaled by a reduced-tier density, never below 1 when the sky is kept. */
function scaled(count: number, density: number): number {
  if (density <= 0) return 0;
  return Math.max(1, Math.round(count * density));
}

// --- NONE ------------------------------------------------------------------

/** **NONE** — "darker, nothing else." A legitimate assignment, not an absence:
 *  on the map every device boots into, the pick *is* the ground. */
const NONE: NebulaSpec = {
  id: 'none',
  name: 'None',
  blurb: 'Floor and the star-field. Nothing else — and it costs nothing else.',
  parallax: 0.05,
  occludes: false,
  additive: false,
  overdraw: 0,
  peakLuma: 1.9,
  reducedDensity: 0,
  build: () => [],
};

// --- COALSACK --------------------------------------------------------------

/**
 * **Coalsack** — "dust that occludes: stars go missing behind it, no additive
 * blend." The only sky drawn *over* the star layers, and the only one that is
 * darkness rather than light: seven overlapping lobes of {@link GROUND_COLOR},
 * near-opaque at the core and gone by the rim, so the field it crosses simply
 * stops having stars in it. It adds no light to the frame at all, which is why
 * it is also the sky that survives the auto-reducer whole.
 */
const COALSACK: NebulaSpec = {
  id: 'coalsack',
  name: 'Coalsack',
  blurb: 'A dust lane in front of the field — stars go missing behind it.',
  // Nearer than the deep star layer it eats, so it reads as foreground dust
  // rather than as a hole punched in the far sky.
  parallax: 0.14,
  occludes: true,
  additive: false,
  overdraw: 0.691,
  peakLuma: 1.9,
  // Kept whole. It is the ground colour — one opaque-ish blend, no added light —
  // and shedding it mid-match would make a wall of stars appear at once.
  reducedDensity: 1,
  build(seed, width, height, density, screenW, screenH) {
    const rng = mulberry32((seed ^ 0x0c0a_15ac) >>> 0);
    const out: Shape[] = [];
    const hw = width / 2;
    const hh = height / 2;
    const unit = Math.min(screenW, screenH) / 2;
    const screens = (width * height) / (screenW * screenH);
    // A lane, not a scatter: the lobes walk one line so the dust reads as a body
    // with a direction. The lane spans the whole FIELD (it is one continuous
    // thing) while each lobe is sized off the SCREEN, so the dust is the same
    // size on a phone whatever arena it is over.
    const laneAngle = -0.42 + rng.next() * 0.84;
    const cos = Math.cos(laneAngle);
    const sin = Math.sin(laneAngle);
    const reach = Math.max(hw, hh) * 1.15;
    const lobes = scaled(7 * screens, density);
    for (let i = 0; i < lobes; i++) {
      const t = (i / Math.max(1, lobes - 1)) * 2 - 1; // −1 … +1 along the lane
      const along = t * reach;
      const across = (rng.next() - 0.5) * unit * 0.9;
      const cx = round(along * cos - across * sin);
      const cy = round(along * sin + across * cos);
      const r = round(unit * (0.34 + rng.next() * 0.22));
      // Dense along the lane's middle, thinning at both ends — a body with edges.
      const core = 0.9 * (1 - 0.55 * Math.abs(t));
      softDisc(out, cx, cy, r, GROUND_COLOR, core);
    }
    return out;
  },
};

// --- IRON VEIL -------------------------------------------------------------

/**
 * **Iron Veil** — "a rust band, 14 sheets." Hard-edged where every other sky is
 * soft: fourteen thin flat sheets stacked along one band, iron-grey with rust
 * through it, so the void looks laminated rather than clouded.
 *
 * The rust is threat red at 4–5.5% alpha — the §2.2 sky carve-out, and the whole
 * reason that section exists. At this alpha over Floor it composites to luma ≈
 * 6/255: a seventh of the ink outline every sprite in the game carries, and
 * nothing a player could read as "this hurts". Most of the veil is steel; the
 * rust is the minority of sheets that tints the band warm.
 */
const IRON_VEIL: NebulaSpec = {
  id: 'ironVeil',
  name: 'Iron Veil',
  blurb: 'Fourteen flat sheets in one band — iron with rust through it.',
  parallax: 0.05,
  occludes: false,
  additive: false,
  overdraw: 0.208,
  peakLuma: 9.3,
  // Half the sheets. A band with 7 sheets is still a band; the read survives.
  reducedDensity: 0.5,
  build(seed, width, height, density, screenW, screenH) {
    const rng = mulberry32((seed ^ 0x1207_e011) >>> 0);
    const out: Shape[] = [];
    const hw = width / 2;
    const hh = height / 2;
    const unit = Math.min(screenW, screenH) / 2;
    const screens = (width * height) / (screenW * screenH);
    const band = -0.38; // the band's tilt across the field
    const cos = Math.cos(band);
    const sin = Math.sin(band);
    const sheets = scaled(14 * screens, density);
    // The band's thickness is a screen's business (it has to read as a band on a
    // phone); its length is the field's (it is one band, not one per screenful).
    const reach = Math.max(hw, hh) * 1.1;
    for (let i = 0; i < sheets; i++) {
      const t = i / Math.max(1, sheets - 1);
      // Stagger across the band's thickness, drift along its length.
      const across = (t - 0.5) * unit * 0.86 + (rng.next() - 0.5) * unit * 0.07;
      const along = (rng.next() - 0.5) * reach * 2;
      const cx = round(along * cos - across * sin);
      const cy = round(along * sin + across * cos);
      const halfLen = round(unit * (0.55 + rng.next() * 0.5));
      const halfThick = round(unit * (0.02 + rng.next() * 0.035));
      // Every fourth sheet is rust; the rest are iron. Rust rides the §2.2
      // ceiling (0.06) with headroom, iron rides the ordinary sky ceiling.
      const rusty = i % 4 === 1;
      const color = rusty
        ? PALETTE.threatRed
        : i % 3 === 0
          ? DERIVED.hullShadow
          : DERIVED.hullDark;
      const alpha = rusty ? 0.04 + rng.next() * 0.015 : 0.03 + rng.next() * 0.03;
      sheet(out, cx, cy, halfLen, halfThick, band + (rng.next() - 0.5) * 0.06, color, alpha);
    }
    return out;
  },
};

// --- PATINA DRIFT ----------------------------------------------------------

/**
 * **Patina Drift** — "wispy teal from the palette's own green, 22 soft blobs."
 * The safest sky in the set and the direct descendant of the a2-06 wash: the
 * corroded void, in the one hue §1 already hands to corrosion. Twenty-two
 * elongated wisps at a shared drift angle, patina at the peaks and deep patina
 * in the pockets, none of it above 5%.
 */
const PATINA_DRIFT: NebulaSpec = {
  id: 'patinaDrift',
  name: 'Patina Drift',
  blurb: 'Twenty-two teal wisps on one drift — the corroded void, v2’s wash grown up.',
  parallax: 0.05,
  occludes: false,
  additive: false,
  overdraw: 0.863,
  peakLuma: 15.8,
  // Ten of twenty-two. The drift angle and the ink mix are unchanged, so what is
  // left is the same sky thinned, not a different one.
  reducedDensity: 0.45,
  build(seed, width, height, density, screenW, screenH) {
    const rng = mulberry32((seed ^ 0x9e37_79b9) >>> 0);
    const out: Shape[] = [];
    const unit = Math.min(screenW, screenH) / 2;
    const screens = (width * height) / (screenW * screenH);
    const drift = 0.34;
    const inks: readonly (readonly [number, number])[] = [
      [PALETTE.patina, 0.04],
      [DERIVED.continentShade, 0.036],
      [DERIVED.hullShadow, 0.032],
    ];
    const wisps = scaled(22 * screens, density);
    for (let i = 0; i < wisps; i++) {
      const cx = round((rng.next() - 0.5) * width * 0.94);
      const cy = round((rng.next() - 0.5) * height * 0.94);
      const rx = round(unit * (0.2 + rng.next() * 0.3));
      const ry = round(rx * (0.28 + rng.next() * 0.3));
      const ink = inks[Math.floor(rng.next() * inks.length)]!;
      softWisp(out, cx, cy, rx, ry, drift + (rng.next() - 0.5) * 0.5, ink[0], ink[1], () => rng.next());
    }
    return out;
  },
};

// --- PLASMA REEF -----------------------------------------------------------

/**
 * **Plasma Reef** — "clotted cyan, the brightest and the most expensive." The
 * only additive sky, and the only one that spends the energy hue on the
 * backdrop, which the v2 module header explicitly refused to do. The developer
 * has since picked it, so the refusal is withdrawn and replaced by a *measured*
 * limit: the reef is bright enough to see and nowhere near bright enough to be
 * confused with the thing it shares a hue with. `backdrop.test.ts` pins the
 * owner beacon ring's contrast over the reef's brightest clot; if that number
 * ever fails, the map gets a different sky.
 *
 * Structurally it is clots, not clouds: three broad base washes with tight
 * clusters of small nodes on top, so the light is concentrated instead of
 * smeared — which is what keeps a *bright* sky from becoming a *loud* one.
 */
const PLASMA_REEF: NebulaSpec = {
  id: 'plasmaReef',
  name: 'Plasma Reef',
  blurb: 'Clotted cyan, additive — the brightest sky and the only one that costs real fill.',
  parallax: 0.05,
  occludes: false,
  additive: true,
  overdraw: 1.121,
  peakLuma: 17.4,
  // Dropped. Additive overdraw is the entire cost of this sky, so a fraction of
  // it saves a fraction of nothing; the map keeps its Floor and its stars.
  reducedDensity: 0,
  build(seed, width, height, density, screenW, screenH) {
    const rng = mulberry32((seed ^ 0x51a5_9aee) >>> 0);
    const out: Shape[] = [];
    const unit = Math.min(screenW, screenH) / 2;
    const screens = (width * height) / (screenW * screenH);
    // Three broad, very faint base washes — the water the reef sits in.
    const bases = scaled(3 * screens, density);
    for (let i = 0; i < bases; i++) {
      const cx = round((rng.next() - 0.5) * width * 0.7);
      const cy = round((rng.next() - 0.5) * height * 0.7);
      softDisc(out, cx, cy, round(unit * (0.5 + rng.next() * 0.3)), DERIVED.plasmaDim, 0.018, ADDITIVE_STOPS);
    }
    // Nine clots, each a loose cluster of four small nodes. Loose on purpose:
    // additive light adds, so a node that lands on top of its neighbour costs
    // brightness twice. The spread is wide enough that a clot reads as a knot of
    // light rather than as one bright dot.
    const clots = scaled(9 * screens, density);
    for (let i = 0; i < clots; i++) {
      const cx = (rng.next() - 0.5) * width * 0.82;
      const cy = (rng.next() - 0.5) * height * 0.82;
      const spread = unit * (0.1 + rng.next() * 0.1);
      for (let n = 0; n < 4; n++) {
        const a = (n / 4) * Math.PI * 2 + rng.next() * 1.2;
        const d = spread * (0.45 + rng.next() * 0.55);
        softDisc(
          out,
          round(cx + Math.cos(a) * d),
          round(cy + Math.sin(a) * d),
          round(unit * (0.045 + rng.next() * 0.05)),
          PALETTE.plasma,
          // Tuned DOWN to here, not up: at 0.05+ the reef's brightest clot ate
          // 11.3% of the owner ring's contrast, over the 10% ceiling
          // `backdrop.test.ts` sets. Still the brightest sky in the set.
          0.045 + rng.next() * 0.013,
          ADDITIVE_STOPS,
        );
      }
    }
    return out;
  },
};

// --- DEEP EMBER ------------------------------------------------------------

/**
 * **Deep Ember** — "sparse, low alpha, felt at the edges." The quietest sky:
 * five big, very faint bodies pushed out toward the field's rim, so the middle
 * of the screen — where the fight is — stays clean and the warmth is only ever
 * in the corner of the eye.
 *
 * Threat red at 3–4.5%, under the §2.2 ceiling with room to spare. Composited
 * over Floor its brightest pixel is luma ≈ 5/255: an eighth of the ink outline,
 * a thirtieth of the damage fill it shares a hue with.
 */
const DEEP_EMBER: NebulaSpec = {
  id: 'deepEmber',
  name: 'Deep Ember',
  blurb: 'Five dying coals at the rim — the warmth you notice only at the edges.',
  parallax: 0.05,
  occludes: false,
  additive: false,
  overdraw: 0.746,
  peakLuma: 9.7,
  // Kept whole. Five discs at 4% is already the cheapest coloured sky there is;
  // there is nothing to shed that would buy a frame.
  reducedDensity: 1,
  build(seed, width, height, density, screenW, screenH) {
    const rng = mulberry32((seed ^ 0x0dee_e3be) >>> 0);
    const out: Shape[] = [];
    const hw = width / 2;
    const hh = height / 2;
    const unit = Math.min(screenW, screenH) / 2;
    const screens = (width * height) / (screenW * screenH);
    const bodies = scaled(5 * screens, density);
    // Scattered over the field, with a **hole punched through the middle** — the
    // sky sits at parallax 0.05, so the field's centre is very nearly the screen's
    // centre, which is where the fight is. Rejecting that disc is what makes the
    // warmth something you catch at the edge of the eye instead of something you
    // are staring through. (Rejection-sampled rather than placed on a rim ring:
    // the field is ~2.2 screens across, so a ring on the FIELD's rim would sit
    // entirely outside the visible window and the sky would be invisible.)
    const HOLE = 0.3;
    for (let i = 0; i < bodies; i++) {
      let nx = 0;
      let ny = 0;
      for (let tries = 0; tries < 12; tries++) {
        nx = rng.next() * 2 - 1;
        ny = rng.next() * 2 - 1;
        if (Math.hypot(nx, ny) >= HOLE) break;
      }
      const r = round(unit * (0.42 + rng.next() * 0.24));
      softDisc(out, round(nx * hw), round(ny * hh), r, PALETTE.threatRed, 0.03 + rng.next() * 0.015);
    }
    return out;
  },
};

/** The six, by id. */
export const NEBULAE: Readonly<Record<NebulaId, NebulaSpec>> = {
  none: NONE,
  coalsack: COALSACK,
  ironVeil: IRON_VEIL,
  patinaDrift: PATINA_DRIFT,
  plasmaReef: PLASMA_REEF,
  deepEmber: DEEP_EMBER,
};

/** The six, in the order the developer listed them. */
export const NEBULA_IDS: readonly NebulaId[] = [
  'none',
  'coalsack',
  'ironVeil',
  'patinaDrift',
  'plasmaReef',
  'deepEmber',
];

// ---------------------------------------------------------------------------
// MAP_NEBULA — a map's sky is part of its identity
// ---------------------------------------------------------------------------

/**
 * The ratified map ids (`src/sim/maps.ts` `MAPS`), as art sees them. Stated as a
 * literal union so {@link MAP_NEBULA} cannot compile with a map missing, and
 * cross-checked against the sim's own registry by `backdrop.test.ts` — art does
 * not import the sim at runtime, but the test refuses to let the two drift.
 */
export type MapId = 'octagon' | 'compass' | 'oval' | 'diamond';

/**
 * **One entry per map. A map's sky is part of its identity, like its layout.**
 *
 * A named registry, deliberately — not a hash of the id and not `index % 6`. A
 * modulo would repeat a sky the moment a fifth map lands and would assign it
 * without anyone choosing; this way each line is a decision that can be argued
 * with. The four assigned skies, ranked by measured per-screen overdraw, are
 * NONE `0.000` · Coalsack `0.691` · Patina Drift `0.863` · Plasma Reef `1.121`,
 * and the rule that placed them is: **the cheapest sky goes on the board that
 * runs on the most devices, and the costliest on the board with the fewest
 * entities.** Map by map:
 *
 *  - **`octagon` → NONE.** The Ring is the default: it is what `?debug=1` boots,
 *    what a returning player finds pre-selected, and the first thing a phone
 *    meets. The map that runs on the most devices should cost the least, and
 *    "darker, nothing else" is the purest statement of the pick anyway.
 *  - **`compass` → Coalsack.** The Compass is corner-cover and edge-lanes, and
 *    it is a derelict-fill map, so at any roster below eight it also carries
 *    wrecks and their debris — one of the two busiest boards. It gets the
 *    cheapest sky that is not nothing (0.691), and the only one that **adds no
 *    light to the frame at all**: Coalsack is the ground colour in front of the
 *    stars, so it can never raise a pixel's value (measured peak Y′ 1.9 — the
 *    ground's own) and takes 0% off the contrast of the ring, the threat fill or
 *    the ore. A dust lane also suits a map about cover.
 *  - **`diamond` → Patina Drift.** Double Diamond is the other derelict-fill
 *    board and the most contested centre in the set — the exposed inner homes
 *    sit right on the commons — so it takes the next-cheapest (0.863). No
 *    reserved hue, no additive pass, and the "old system" tint is the right
 *    register for the veteran board with wrecks standing on it.
 *  - **`oval` → Plasma Reef.** The costly sky goes on the *thinnest* map. The
 *    Oval regenerates exactly `count` homes rather than filling to eight, so at
 *    every roster below eight it is the board with the fewest entities on it,
 *    and it is a wide arena whose stations sit spread around a rim with an empty
 *    middle. It is the one board with fill-rate to spare — and under
 *    `VfxAutoQuality` the reef is the sky that drops, so a throttled phone stops
 *    paying for it entirely.
 *
 * Deliberately *not* assigned: {@link UNASSIGNED_NEBULAE}.
 */
export const MAP_NEBULA: Readonly<Record<MapId, NebulaId>> = {
  octagon: 'none',
  compass: 'coalsack',
  diamond: 'patinaDrift',
  oval: 'plasmaReef',
};

/**
 * The two skies with no map yet — **named and unassigned, not guessed**.
 *
 * `a0-12` is building two new 4v4-balanced maps, and these are the skies they
 * take. Leaving the hole stated (and asserted by `backdrop.test.ts`) is the
 * honest shape: a registry with a documented gap says "two maps are coming",
 * where a modulo would have silently given some map a second-hand sky.
 *
 * It is also the safe shape. These are the two skies that spend a RESERVED hue
 * under the style-guide §2.2 carve-out, so as things stand **no map that ships
 * today depends on that carve-out at all** — which gives the Director a clean
 * seam to veto §2.2 on before a live board needs it.
 */
export const UNASSIGNED_NEBULAE: readonly NebulaId[] = ['ironVeil', 'deepEmber'];

/** The sky a map flies under. An unknown id falls back to the default map's, so
 *  a stale saved map key can never crash or blank the backdrop. */
export function nebulaForMap(mapId: string | undefined): NebulaSpec {
  const known = mapId === undefined ? undefined : (MAP_NEBULA as Record<string, NebulaId | undefined>)[mapId];
  return NEBULAE[known ?? MAP_NEBULA.octagon];
}

// ---------------------------------------------------------------------------
// Generators — plain SpriteDef data (deterministic, palette-audited)
// ---------------------------------------------------------------------------

/** A small, stable string hash → 32-bit int, to salt a layer's seed by its key. */
function keySalt(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * One depth layer of stars as a {@link SpriteDef}, authored centred on the
 * origin across a `width`×`height` box. Deterministic in (`spec`, `seed`,
 * `width`, `height`): same inputs, deep-equal output (GDD §4.1). Star count is
 * area-scaled by the layer's density, so a bigger arena gets proportionally
 * more field rather than the same field stretched.
 *
 * Bloom is drawn here, by **seeded scatter** ({@link BLOOM}): each star draws one
 * number, and that number — not its magnitude — decides whether it flares.
 */
export function starFieldSprite(
  spec: StarLayerSpec,
  seed: number,
  width: number,
  height: number,
): SpriteDef {
  const rng = mulberry32((seed ^ keySalt(spec.key)) >>> 0);
  const count = Math.max(1, Math.round((width * height) / 1e6 * spec.density));
  const hw = width / 2;
  const hh = height / 2;
  const shapes: Shape[] = [];
  for (let i = 0; i < count; i++) {
    const x = round(rng.next() * width - hw);
    const y = round(rng.next() * height - hh);
    const r = round(spec.minR + rng.next() * (spec.maxR - spec.minR));
    const ink = spec.inks[Math.floor(rng.next() * spec.inks.length)]!;
    // Bloom first, so the star's own point sits on top of its halo.
    if (rng.next() < BLOOM.scatter) {
      for (let b = BLOOM.radii.length - 1; b >= 0; b--) {
        const a = round(ink.alpha * BLOOM.intensity[b]!);
        if (a <= 0) continue;
        shapes.push(circle(x, y, round(r * BLOOM.radii[b]!), fill(ink.color, 'material', a)));
      }
    }
    shapes.push(circle(x, y, r, fill(ink.color, 'material', ink.alpha)));
    // A faint diffraction cross on a few of the brightest points — sparkle, not
    // noise. Two short strokes through the star at a lower alpha than its body.
    if (spec.glint > 0 && rng.next() < spec.glint) {
      const len = round(r * 3.2);
      const a = ink.alpha * 0.4;
      shapes.push(polyline([x - len, y, x + len, y], stroke(ink.color, 0.4, 'material', a)));
      shapes.push(polyline([x, y - len, x, y + len], stroke(ink.color, 0.4, 'material', a)));
    }
  }
  return sprite(`backdrop/stars/${spec.key}/${round(width)}x${round(height)}`, Math.max(hw, hh), shapes);
}

/**
 * The ground plane: one opaque {@link GROUND_COLOR} quad the whole void is
 * composited over. Drawn rather than left to the canvas clear colour so the
 * backdrop is self-contained — the void looks the same whatever the application
 * background happens to be, and the play-field's ground is a decision that lives
 * in the art layer where it can be audited.
 */
export function groundSprite(width: number, height: number): SpriteDef {
  const hw = round(width / 2);
  const hh = round(height / 2);
  return sprite(`backdrop/ground/${hw}x${hh}`, Math.max(hw, hh), [
    poly([-hw, -hh, hw, -hh, hw, hh, -hw, hh], fill(GROUND_COLOR, 'sky', 1)),
  ]);
}

/**
 * One sky as a {@link SpriteDef}, authored centred on the origin over a
 * `width`×`height` parallax field, as seen through a `screenW`×`screenH`
 * viewport. Deterministic in all six arguments.
 *
 * The screen defaults to the field, which is the right default for a review tile
 * (one screenful, exactly the developer's declared element counts) and the wrong
 * one for the live backdrop — {@link VoidBackdrop.configure} passes the real
 * viewport, so a phone sees the sky at phone scale over any arena. NONE returns
 * an empty sprite rather than null, so every caller has one shape of code.
 */
export function nebulaSprite(
  id: NebulaId,
  seed: number,
  width: number,
  height: number,
  density = 1,
  screenW = width,
  screenH = height,
): SpriteDef {
  const spec = NEBULAE[id];
  return sprite(
    `backdrop/nebula/${id}/${round(width)}x${round(height)}@${round(density)}/${round(screenW)}x${round(screenH)}`,
    Math.max(width, height) / 2,
    spec.build(seed, width, height, density, screenW, screenH),
  );
}

/**
 * A sky as the art review surface sees it: **the whole stack**, in the order the
 * frame composites it — ground, two star layers, and the sky itself either
 * behind them or (Coalsack) in front. A nebula sample on its own would be a
 * near-invisible tile and would say nothing at all about the one sky whose
 * entire point is what it *removes*, so the catalogue shows the composite
 * (./catalogue, ./preview).
 */
export function nebulaTileSprite(id: NebulaId, seed: number, width: number, height: number): SpriteDef {
  const spec = NEBULAE[id];
  const stars: Shape[] = [];
  for (const layer of STAR_LAYERS) {
    if (layer.key === 'near') continue; // two layers is enough at tile scale
    stars.push(...starFieldSprite(layer, seed, width, height).shapes);
  }
  const sky = spec.build(seed, width, height, 1, width, height);
  // The tile is rendered in a SQUARE box of half-width `extent`, so the ground
  // has to fill that square rather than the authoring rectangle — otherwise the
  // review sheet shows the sky letterboxed on two bands of Vacuum, which is the
  // one background this whole brief replaced.
  const extent = Math.max(width, height) / 2;
  return sprite(`backdrop/tile/${id}/${round(width)}x${round(height)}`, extent, [
    ...groundSprite(extent * 2, extent * 2).shapes,
    ...(spec.occludes ? [...stars, ...sky] : [...sky, ...stars]),
  ]);
}

// ---------------------------------------------------------------------------
// Arena-wall integration — the void meets the boundary
// ---------------------------------------------------------------------------

/** One inset band of the arena wall's inner glow: a steel stroke, faded by
 *  distance from the edge, so the wall reads as a lit structure the void presses
 *  against rather than a hairline rectangle floating on black. */
export interface WallBand {
  /** Inset from the arena edge, world units. */
  readonly inset: number;
  readonly width: number;
  readonly alpha: number;
}

/**
 * The arena wall's look: a crisp double frame at the very edge, then a short
 * falloff of ever-fainter steel bands stepping inward — a soft inner glow that
 * ties the wall to the star-field behind it (the brief: "arena wall integrated
 * into the look"). Steel only (style-guide §3: structure is never a player
 * colour, §2: never signal yellow), so it is compliant by construction. The
 * renderer draws these against `world.bounds`; the *look* lives here.
 */
export const ARENA_WALL_BANDS: readonly WallBand[] = [
  { inset: 0, width: 4, alpha: 0.5 }, // the crisp outer frame — the world ends here
  { inset: 6, width: 1, alpha: 0.28 }, // the inner rule
  { inset: 16, width: 10, alpha: 0.05 }, // the glow's near band…
  { inset: 30, width: 14, alpha: 0.03 }, // …fading into the void
];

// ---------------------------------------------------------------------------
// VoidBackdrop — the composited, parallax-scrolling backdrop
// ---------------------------------------------------------------------------

interface Layer {
  readonly gfx: Graphics;
  readonly parallax: number;
}

/** The area a field must span to cover the screen at any camera offset, given a
 *  parallax factor `f`, the viewport size and the arena bound on that axis.
 *  Derivation in the module header: the field, positioned at `f·cameraOffset`,
 *  must overlap `[0, view]` for `cameraOffset ∈ [center − bound, center]`. */
function coverSpan(f: number, view: number, bound: number): number {
  return (2 - f) * view + 2 * f * bound + view * 0.25; // + a quarter-view of slack
}

/**
 * The void backdrop: build once with {@link configure} (idempotent — it rebuilds
 * only when the arena bounds, the viewport, the map or the VFX tier change),
 * then call {@link update} every frame with the camera offset the renderer
 * already computed. Add {@link view} to the scene graph *behind* the world
 * container.
 */
export class VoidBackdrop {
  /** The screen-space root — add behind the world container. */
  readonly view = new Container();

  private layers: Layer[] = [];
  private reduced = false;
  private nebula: NebulaSpec = NEBULAE[MAP_NEBULA.octagon];
  /** The config the current geometry was built for, so a no-op frame rebuilds
   *  nothing (GDD §4.3). `-1` = never built. */
  private builtW = -1;
  private builtH = -1;
  private builtBoundsW = -1;
  private builtBoundsH = -1;
  private builtReduced = false;
  private builtNebula: NebulaId | '' = '';

  constructor(private readonly seed: number = VOID_SEED) {
    this.view.label = 'void-backdrop';
  }

  /** Thin the sky on a throttled device (GDD §4.3 risk 5). Each sky declares
   *  what survives — {@link NebulaSpec.reducedDensity}, 0 to drop it — because
   *  "the nebula" is no longer one thing with one cost. The stars, near-free
   *  once baked, and the ground, which is one opaque quad, always stay.
   *  Rebuilds only on a real change. */
  setReduceVfx(on: boolean): void {
    this.reduced = on;
  }

  /** Point the backdrop at a map, which is what chooses its sky
   *  ({@link MAP_NEBULA}). Cheap and idempotent; the rebuild happens lazily in
   *  {@link configure}. An unknown id falls back to the default map's sky. */
  setMap(mapId: string | undefined): void {
    this.nebula = nebulaForMap(mapId);
  }

  /** The sky currently built (or about to be) — the renderer's read-back, and
   *  what the perf/evidence probes report. */
  get nebulaId(): NebulaId {
    return this.nebula.id;
  }

  /**
   * Build (or rebuild) the field to cover a `viewW`×`viewH` viewport over a
   * `boundsW`×`boundsH` arena. Cheap no-op when nothing changed — safe to call
   * every frame. Geometry is played into static `Graphics` here and only moved
   * thereafter.
   */
  configure(boundsW: number, boundsH: number, viewW: number, viewH: number): void {
    if (
      this.builtW === viewW &&
      this.builtH === viewH &&
      this.builtBoundsW === boundsW &&
      this.builtBoundsH === boundsH &&
      this.builtReduced === this.reduced &&
      this.builtNebula === this.nebula.id &&
      this.layers.length > 0
    ) {
      return;
    }
    this.builtW = viewW;
    this.builtH = viewH;
    this.builtBoundsW = boundsW;
    this.builtBoundsH = boundsH;
    this.builtReduced = this.reduced;
    this.builtNebula = this.nebula.id;

    // Discard any prior build.
    for (const l of this.layers) l.gfx.destroy();
    this.layers = [];
    this.view.removeChildren();

    // The ground, first and always: one opaque Floor quad, fixed to the screen
    // (parallax 0, so it needs no cover slack at all).
    const ground = new Graphics();
    ground.label = 'void-ground';
    drawSprite(ground, groundSprite(viewW + 2, viewH + 2), 1);
    this.view.addChild(ground);
    this.layers.push({ gfx: ground, parallax: 0 });

    const density = this.reduced ? this.nebula.reducedDensity : 1;
    const drawSky = this.nebula.id !== 'none' && density > 0;
    const sky = (): void => {
      if (!drawSky) return;
      const nw = coverSpan(this.nebula.parallax, viewW, boundsW);
      const nh = coverSpan(this.nebula.parallax, viewH, boundsH);
      const g = new Graphics();
      g.label = `void-nebula-${this.nebula.id}`;
      drawSprite(g, nebulaSprite(this.nebula.id, this.seed, nw, nh, density, viewW, viewH), 1);
      if (this.nebula.additive) g.blendMode = 'add';
      this.view.addChild(g);
      this.layers.push({ gfx: g, parallax: this.nebula.parallax });
    };

    // A sky of light sits behind the star-field; a sky of dust sits in front of
    // it and takes stars out of the frame. That ordering IS Coalsack's look.
    if (!this.nebula.occludes) sky();
    for (const spec of STAR_LAYERS) {
      const w = coverSpan(spec.parallax, viewW, boundsW);
      const h = coverSpan(spec.parallax, viewH, boundsH);
      const g = new Graphics();
      g.label = `void-stars-${spec.key}`;
      drawSprite(g, starFieldSprite(spec, this.seed, w, h), 1);
      this.view.addChild(g);
      this.layers.push({ gfx: g, parallax: spec.parallax });
    }
    if (this.nebula.occludes) sky();
  }

  /**
   * Position every layer for this frame. `offX`/`offY` are the world container's
   * screen offset (the renderer's camera offset). A layer at parallax `f` sits
   * at `f·offset`, plus the viewport centre so the origin-centred field lands
   * over the visible area. Allocation-free (GDD §4.3): only transforms move.
   */
  update(offX: number, offY: number, viewW: number, viewH: number): void {
    const cx = viewW / 2;
    const cy = viewH / 2;
    for (const l of this.layers) {
      l.gfx.position.set(cx + offX * l.parallax, cy + offY * l.parallax);
    }
  }

  /** Release every layer's geometry (context loss / teardown). */
  destroy(): void {
    for (const l of this.layers) l.gfx.destroy();
    this.layers = [];
    this.view.removeChildren();
  }
}
