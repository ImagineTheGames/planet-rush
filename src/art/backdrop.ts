/**
 * src/art/backdrop.ts — The void, v2. OWNER: Art & Audio Agent.
 *
 * The play-field is drawn on near-black Vacuum (`#0D1015`, style-guide §1), and
 * until now that black was *empty* — the arena wall floated on nothing and the
 * ships flew over a void with no depth. This module gives the void a body: a
 * **layered parallax star-field** and a few **nebula washes**, keyed to the
 * cold-vacuum element studies (docs/art-direction/cold-vacuum-elements-r2.html —
 * "slow parallax layer", the deep panel/ink cool-greys `#141922`/`#262C34` that
 * sit a hair above Vacuum). It is space you can feel move behind the fleet.
 *
 * ## It stays inside the six colours (style-guide §1, §2)
 *
 * The void adds **no seventh hue**. Stars are the steel value ramp only —
 * `hullSteel`, its lit shade `hullLight`, and the ramp's white endpoint — read
 * as points of light purely by *value*, brightest near, dimmest far. The nebula
 * washes are `patina` (the "old system" tint — a dead, corroded void wears it
 * honestly) and neutral steel shade, at a *whisper* of alpha (2–6%), so they
 * never compete with an entity and never read as ore, danger, or energy. Plasma
 * is deliberately kept OFF the backdrop: energy blue is a gameplay signal
 * (beams, shields, muzzles), and the void must not dilute it. Every colour here
 * is a declared member of {@link ALLOWED_COLORS}, painted on role `material`, so
 * the compliance audit (./compliance) covers the sample tiles in the catalogue.
 *
 * ## It respects the frame budget (GDD §4.3, risk 5)
 *
 * A star-field is a trap for the per-frame allocator. So it is built the way the
 * renderer builds everything hot: geometry is played into a **static `Graphics`
 * once** (per depth layer) at {@link VoidBackdrop.configure}, and per frame the
 * only thing touched is each layer's `position` — a parallax offset, zero
 * allocation (matching the render layer's pooling discipline). On a device the
 * auto-reducer has throttled ({@link VoidBackdrop.setReduceVfx}), the nebula —
 * the one fill-rate cost here, big translucent discs — is dropped, exactly the
 * overdraw the atmosphere-halo tier sheds; the stars, nearly free once baked,
 * stay.
 *
 * ## Depth by parallax
 *
 * The backdrop lives in *screen* space, behind the world container. Each depth
 * layer scrolls at a fraction of the camera offset: a far layer barely moves
 * (feels distant), a near layer almost keeps pace with the world. The field is
 * sized from the arena bounds + viewport so it covers the screen at any camera
 * position without wrapping — one static build, repositioned per frame.
 */

import { Container, Graphics } from 'pixi.js';
import { mulberry32 } from '@shared/types';
import { DERIVED, PALETTE, WHITE } from './palette';
import { circle, fill, polyline, round, sprite, stroke, type Shape, type SpriteDef } from './shapes';
import { drawSprite } from './textures';

// ---------------------------------------------------------------------------
// Look constants — the whole void, in one place
// ---------------------------------------------------------------------------

/** A stable seed for the void. The field is procedural but the *same* every
 *  boot (GDD §4.1), so the frozen golden scene is byte-deterministic. */
export const VOID_SEED = 0x5061_6365; // 'Pace' — a wink, and a fixed 32-bit seed.

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

/** The nebula wash layer — a slow, deep haze. Very small parallax: it feels
 *  further than the farthest stars. */
const NEBULA_PARALLAX = 0.05;

/** One nebula wash colour, painted as a soft stack of concentric discs. `material`
 *  role: patina is "the old system tint" (§1), steel is neutral dust. */
interface WashInk {
  readonly color: number;
  /** Peak alpha at the blob centre — the stack fades from here to zero at the rim. */
  readonly alpha: number;
}

const NEBULA_INKS: readonly WashInk[] = [
  { color: PALETTE.patina, alpha: 0.055 }, // teal deep-dust — the corroded void
  { color: DERIVED.continentShade, alpha: 0.05 }, // a darker patina pocket
  { color: DERIVED.hullShadow, alpha: 0.045 }, // neutral steel haze
];

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
 * The nebula wash as a {@link SpriteDef}: a handful of seeded soft blobs, each a
 * back-to-front stack of translucent concentric discs that fake a radial
 * gradient in the flat-fill IR — the same approximation the atmosphere halo uses
 * (./stations), for the same reason (a real gradient is not expressible here,
 * and the stack bakes to one static texture). Authored centred on the origin.
 */
export function nebulaWashSprite(seed: number, width: number, height: number): SpriteDef {
  const rng = mulberry32((seed ^ 0x9e37_79b9) >>> 0);
  const hw = width / 2;
  const hh = height / 2;
  // A blob count that scales gently with area — a small tile gets 2, the full
  // arena field a handful. Kept low: the nebula is a wash, not a texture.
  const blobs = Math.max(2, Math.round((width * height) / 1e6 * 0.9));
  const shapes: Shape[] = [];
  // How the stack fades from centre to rim: [radius fraction, alpha fraction].
  const stops: readonly (readonly [number, number])[] = [
    [1.0, 0.0],
    [0.7, 0.4],
    [0.42, 0.72],
    [0.18, 1.0],
  ];
  for (let i = 0; i < blobs; i++) {
    const cx = round(rng.next() * width - hw);
    const cy = round(rng.next() * height - hh);
    const radius = round(Math.min(hw, hh) * (0.32 + rng.next() * 0.4));
    const ink = NEBULA_INKS[Math.floor(rng.next() * NEBULA_INKS.length)]!;
    for (const [frac, aFrac] of stops) {
      const a = round(ink.alpha * aFrac);
      if (a <= 0) continue;
      shapes.push(circle(cx, cy, round(radius * frac), fill(ink.color, 'material', a)));
    }
  }
  return sprite(`backdrop/nebula/${round(width)}x${round(height)}`, Math.max(hw, hh), shapes);
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
  /** Whether this layer is a nebula (dropped under reduced VFX). */
  readonly nebula: boolean;
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
 * only when the arena bounds, the viewport, or the VFX tier change), then call
 * {@link update} every frame with the camera offset the renderer already
 * computed. Add {@link view} to the scene graph *behind* the world container.
 */
export class VoidBackdrop {
  /** The screen-space root — add behind the world container. */
  readonly view = new Container();

  private layers: Layer[] = [];
  private reduced = false;
  /** The config the current geometry was built for, so a no-op frame rebuilds
   *  nothing (GDD §4.3). `-1` = never built. */
  private builtW = -1;
  private builtH = -1;
  private builtBoundsW = -1;
  private builtBoundsH = -1;
  private builtReduced = false;

  constructor(private readonly seed: number = VOID_SEED) {
    this.view.label = 'void-backdrop';
  }

  /** Drop the nebula (its translucent-disc overdraw is the one fill-rate cost
   *  here) on a throttled device; keep the near-free baked stars. Rebuilds only
   *  on a real change. */
  setReduceVfx(on: boolean): void {
    this.reduced = on;
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
      this.layers.length > 0
    ) {
      return;
    }
    this.builtW = viewW;
    this.builtH = viewH;
    this.builtBoundsW = boundsW;
    this.builtBoundsH = boundsH;
    this.builtReduced = this.reduced;

    // Discard any prior build.
    for (const l of this.layers) l.gfx.destroy();
    this.layers = [];
    this.view.removeChildren();

    // Nebula first (furthest back), unless the reduced tier drops it.
    if (!this.reduced) {
      const nw = coverSpan(NEBULA_PARALLAX, viewW, boundsW);
      const nh = coverSpan(NEBULA_PARALLAX, viewH, boundsH);
      const g = new Graphics();
      g.label = 'void-nebula';
      drawSprite(g, nebulaWashSprite(this.seed, nw, nh), 1);
      this.view.addChild(g);
      this.layers.push({ gfx: g, parallax: NEBULA_PARALLAX, nebula: true });
    }

    // Then the star layers, far → near.
    for (const spec of STAR_LAYERS) {
      const w = coverSpan(spec.parallax, viewW, boundsW);
      const h = coverSpan(spec.parallax, viewH, boundsH);
      const g = new Graphics();
      g.label = `void-stars-${spec.key}`;
      drawSprite(g, starFieldSprite(spec, this.seed, w, h), 1);
      this.view.addChild(g);
      this.layers.push({ gfx: g, parallax: spec.parallax, nebula: false });
    }
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
