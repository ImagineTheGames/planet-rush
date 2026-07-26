/**
 * src/art/palette.ts — Cold Vacuum, as code. OWNER: Art & Audio Agent.
 *
 * The six material colours of `style-guide.md` §1, the 8-slot player identity
 * roster (§3.1), and the **only** sanctioned way to make a new shade: a value
 * ramp on one of the six. Every generator in `src/art/` draws from here and
 * nowhere else, which is what makes the palette-compliance test (§2, the
 * RESERVED rule) a mechanical check rather than an eyeball pass.
 *
 * The rule this file exists to keep honest:
 *
 * > **Signal yellow `#F2D24B` means ore or danger, and nothing else. Ever.**
 *
 * Structurally enforced: every {@link Shape} carries a {@link PaintRole}, and
 * `assertPaletteCompliance` (./compliance) refuses signal yellow on any role
 * but `ore` / `danger` / `core`, threat red on anything but `danger`, and a
 * player roster colour on anything but `identity`.
 *
 * **No seventh hue.** Derived shades (§1: "no seventh material colour enters
 * the game without the Director") are strictly *value* operations — a mix
 * toward Vacuum (darker) or toward white (lighter). They add no hue to the
 * world, and every one of them is declared with its recipe below and recomputed
 * by the test, so a hand-edited hex can never quietly smuggle a new colour in.
 *
 * The six colours, the ramp endpoint, and the identity roster are sourced from
 * {@link ./tokens} — the art-direction single source. This file is the *ramp*:
 * it turns those inputs into the shades every generator paints with.
 */

import { PALETTE as TOKEN_PALETTE, PLAYER_ROSTER, WHITE as TOKEN_WHITE } from './tokens';

// ---------------------------------------------------------------------------
// The six (frozen — style-guide §1), sourced from tokens.ts
// ---------------------------------------------------------------------------

/**
 * The six Cold Vacuum material colours. This is the whole world palette.
 * Re-exported from {@link ./tokens} so a material hex is written in exactly one
 * place; changing it there changes it everywhere the ramp and the audit reach.
 */
export const PALETTE = TOKEN_PALETTE;

export type PaletteKey = keyof typeof PALETTE;

/**
 * The light end of the value ramp. Not a material colour and never used raw:
 * it exists only as the `toward` endpoint of a lightening mix, the same way
 * Vacuum is the endpoint of a darkening one.
 */
export const WHITE = TOKEN_WHITE;

/**
 * The 8-slot player identity roster (style-guide §3.1), indexed by `PlayerId`.
 * Identity is an **additive trim layer** over the steel fleet, never a repaint:
 * these appear only on wing tips, cockpit glass, engine flame, weapon tint,
 * planet beacon ring and HP bar — and always alongside the hull number decal,
 * so no player is ever identified by hue alone. Sourced from {@link ./tokens}.
 */
export const PLAYER_COLORS = PLAYER_ROSTER;

/** The identity colour for a slot, wrapping so an out-of-range id is still safe. */
export function playerColor(id: number): number {
  const i = ((id % PLAYER_COLORS.length) + PLAYER_COLORS.length) % PLAYER_COLORS.length;
  return PLAYER_COLORS[i]!;
}

// ---------------------------------------------------------------------------
// Value ramp — the only sanctioned shade maker
// ---------------------------------------------------------------------------

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Per-channel linear blend of two packed RGB colours. `t = 0` is all `a`. */
export function mix(a: number, b: number, t: number): number {
  const k = clamp01(t);
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * k);
  const g = Math.round(ag + (bg - ag) * k);
  const bl = Math.round(ab + (bb - ab) * k);
  return (r << 16) | (g << 8) | bl;
}

/** Darken toward Vacuum. The shadow half of the ramp. */
export function shade(color: number, t: number): number {
  return mix(color, PALETTE.vacuum, t);
}

/** Lighten toward white. The highlight half of the ramp. */
export function tint(color: number, t: number): number {
  return mix(color, WHITE, t);
}

// ---------------------------------------------------------------------------
// Derived shades — declared as recipes, so the test can recompute them
// ---------------------------------------------------------------------------

/** A derived shade's provenance: a value operation on exactly one of the six. */
export interface Recipe {
  /** Which of the six it is a shade *of*. */
  readonly base: PaletteKey;
  /** `'vacuum'` darkens, `'white'` lightens. Nothing else is a legal endpoint. */
  readonly toward: 'vacuum' | 'white';
  /** Blend amount, 0..1. */
  readonly t: number;
  /** What it is for — so a reader can tell whether a shade earns its place. */
  readonly why: string;
}

/**
 * Every non-palette colour any generator is allowed to use, with its recipe.
 * `DERIVED` below holds the literal results; the compliance test recomputes
 * each one from its recipe and fails on a mismatch.
 */
export const DERIVED_RECIPES = {
  hullLight: { base: 'hullSteel', toward: 'white', t: 0.3, why: 'Lit edge / top plating on hulls and turrets.' },
  hullShadow: { base: 'hullSteel', toward: 'vacuum', t: 0.4, why: 'Underside plating; separates overlapping hull parts.' },
  hullDark: { base: 'hullSteel', toward: 'vacuum', t: 0.62, why: 'Panel gaps, thruster wells, a dead planet core.' },
  decalInk: { base: 'hullSteel', toward: 'vacuum', t: 0.78, why: 'The player-number hull decal, stencilled into the steel.' },

  rockBody: { base: 'hullSteel', toward: 'white', t: 0.16, why: 'Asteroid mineral body — neutral steel-grey (§6).' },
  rockShadow: { base: 'hullSteel', toward: 'vacuum', t: 0.32, why: 'Asteroid facets, so a rock reads as a solid at 24px.' },
  rockFissure: { base: 'hullSteel', toward: 'vacuum', t: 0.72, why: 'Crack lines across the three mining stages (§6).' },

  oceanSteel: { base: 'hullSteel', toward: 'vacuum', t: 0.42, why: 'Planet oceans — steel-blue, inside the palette (§5).' },
  oceanDeep: { base: 'hullSteel', toward: 'vacuum', t: 0.62, why: 'Limb darkening / night side of a planet.' },
  continentShade: { base: 'patina', toward: 'vacuum', t: 0.38, why: 'Coastline under-shadow on patina continents.' },
  continentLight: { base: 'patina', toward: 'white', t: 0.2, why: 'Sunward continent highlight.' },

  oreDeep: { base: 'signalYellow', toward: 'vacuum', t: 0.38, why: 'Shadowed facet of an ore vein or chunk — still ore.' },
  coreHot: { base: 'signalYellow', toward: 'white', t: 0.35, why: 'The lit centre of a planet core — still the win condition.' },
  plasmaDim: { base: 'plasma', toward: 'vacuum', t: 0.45, why: 'Unpowered energy parts: cold barrel, idle shield ring.' },
  plasmaHot: { base: 'plasma', toward: 'white', t: 0.45, why: 'The hot centre of a torch/muzzle flare.' },

  wreckBody: { base: 'hullSteel', toward: 'vacuum', t: 0.7, why: 'A dead planet: ash-grey and cold. The game goes quiet (§8).' },
  wreckCrust: { base: 'hullSteel', toward: 'vacuum', t: 0.55, why: 'Broken crust plates on a wreck.' },
} as const satisfies Record<string, Recipe>;

export type DerivedKey = keyof typeof DERIVED_RECIPES;

/**
 * The derived shades, as literal hex. Literal on purpose: these are the values
 * the sprites actually carry, and the test proves each equals its recipe — so
 * the ramp is verified, not merely asserted in a comment.
 */
export const DERIVED = {
  hullLight: 0xa5acb4,
  hullShadow: 0x515861,
  hullDark: 0x383e45,
  decalInk: 0x262a31,

  rockBody: 0x939ba5,
  rockShadow: 0x5a626b,
  rockFissure: 0x2d3239,

  oceanSteel: 0x4f565f,
  oceanDeep: 0x383e45,
  continentShade: 0x36695e,
  continentLight: 0x72b3a2,

  oreDeep: 0x9b8836,
  coreHot: 0xf7e28a,
  plasmaDim: 0x307296,
  plasmaHot: 0x9ddeff,

  wreckBody: 0x2f343b,
  wreckCrust: 0x40464e,
} as const satisfies Record<DerivedKey, number>;

/** Recompute a derived shade from its recipe. The compliance test's oracle. */
export function derive(key: DerivedKey): number {
  const r: Recipe = DERIVED_RECIPES[key];
  const base = PALETTE[r.base];
  return r.toward === 'white' ? tint(base, r.t) : shade(base, r.t);
}

// ---------------------------------------------------------------------------
// Membership sets (the compliance test's allow-lists)
// ---------------------------------------------------------------------------

/** The six material colours, as a lookup. */
export const MATERIAL_COLORS: ReadonlySet<number> = new Set(Object.values(PALETTE));

/** The eight identity colours, as a lookup. */
export const IDENTITY_COLORS: ReadonlySet<number> = new Set(PLAYER_COLORS);

/** Every colour any sprite is allowed to carry: six + derived + roster + white. */
export const ALLOWED_COLORS: ReadonlySet<number> = new Set<number>([
  ...Object.values(PALETTE),
  ...Object.values(DERIVED),
  ...PLAYER_COLORS,
  WHITE,
]);

/** `0x7e8894` → `'#7e8894'`. For the SVG artifacts (./svg). */
export function hex(color: number): string {
  return `#${(color >>> 0).toString(16).padStart(6, '0')}`;
}
