/**
 * src/art/buildings.ts — turrets and shields. OWNER: Art & Audio Agent.
 *
 * Style-guide §6: **"Turrets must read as cannons at a glance and telegraph
 * their threat while spinning."** Both halves are mechanical requirements, not
 * flavour, because the siege model depends on them (GDD §2.6): "turrets deter;
 * the ship defends." A deterrent that isn't legible deters nobody — an attacker
 * has to be able to count the guns from outside their range and decide, and a
 * defender has to see at a glance which of their mounts survived the last pass.
 *
 * So the turret is drawn as a **long barrel on a squat base**: the barrel is
 * over half the sprite's length and sits proud of the ring, because barrel-ness
 * is the entire read at minimap scale. The threat telegraph is the barrel's
 * state, not an added effect:
 *
 *  - `building` — a ghost: no barrel yet, hazard-striped footing. It isn't a
 *    gun until it finishes (GDD §2.5, ~10 s), and the art must not lie about that.
 *  - `idle`     — barrel dark and cold.
 *  - `tracking` — plasma charge at the muzzle: it has you, and you have a
 *    moment to leave.
 *  - `firing`   — a threat-red muzzle flash. Red is enemy fire by contract (§2).
 *
 * Shields (GDD §2.5) are the other half: a bubble that stacks to two and
 * regenerates only after 8 undamaged seconds. Because "pressure beats
 * regeneration" is a *design rule* the player must be able to feel, the bubble
 * is drawn at three visible strengths — full, weakened, and down-to-a-shimmer —
 * so an attacker can see their pressure working before the shield pops.
 */

import { DERIVED, PALETTE, playerColor } from './palette';
import { ringDamageShapes } from './rings';
import {
  annulusPoints,
  arcPoints,
  circle,
  fill,
  poly,
  polyline,
  round,
  sprite,
  stroke,
  type Shape,
  type SpriteDef,
} from './shapes';

// ---------------------------------------------------------------------------
// Turret
// ---------------------------------------------------------------------------

/** What the barrel is doing this frame — the threat telegraph (style-guide §6). */
export type TurretState = 'building' | 'idle' | 'tracking' | 'firing';

export interface TurretSpriteOptions {
  /** The owning slot: turret trim takes its player's colour, hull stays steel. */
  readonly playerId: number;
  readonly state: TurretState;
}

function box(cx: number, cy: number, hw: number, hh: number): number[] {
  return [cx - hw, cy - hh, cx + hw, cy - hh, cx + hw, cy + hh, cx - hw, cy + hh];
}

/**
 * A turret at unit radius, barrel along +x (the renderer rotates by
 * `Turret.angle`, which the sim turn-rate-limits toward its target — the
 * "spinning" the style guide asks the threat read to survive).
 */
export function turretSprite(options: TurretSpriteOptions): SpriteDef {
  const { state } = options;
  const id = playerColor(options.playerId);
  const underConstruction = state === 'building';

  const shapes: Shape[] = [
    // Footing ring — steel, always.
    circle(0, 0, 0.86, fill(DERIVED.hullShadow, 'material')),
    poly(annulusPoints(0, 0, 0.86, 0.7, 0, Math.PI * 2, 28), fill(PALETTE.hullSteel, 'material')),
    circle(0, 0, 0.62, fill(DERIVED.hullDark, 'material')),
  ];

  if (underConstruction) {
    // Hazard stripes on the footing: signal yellow, legally — "hazard stripes"
    // is one of the named allowances of the RESERVED rule (style-guide §2), and
    // a half-built turret is exactly a hazard: it takes damage and shoots back
    // at nothing.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      shapes.push(
        poly(annulusPoints(0, 0, 0.84, 0.72, a, a + Math.PI / 6, 4), fill(PALETTE.signalYellow, 'danger', 0.85)),
      );
    }
    shapes.push(circle(0, 0, 0.3, fill(DERIVED.hullShadow, 'material')));
    return sprite(`turret/p${options.playerId}/building`, 1, shapes);
  }

  // Mount, barrel, and muzzle. The barrel runs 0.2 → 1.0: over half the sprite,
  // because at minimap scale the barrel *is* the turret.
  const barrelCold = state === 'idle';
  shapes.push(
    poly(box(0.1, 0, 0.34, 0.3), fill(PALETTE.hullSteel, 'material')),
    poly(box(0.1, 0, 0.34, 0.3), stroke(DERIVED.hullDark, 0.04, 'material', 0.9)),
    poly(box(0.62, 0, 0.42, 0.13), fill(DERIVED.hullShadow, 'material')),
    poly(box(0.62, 0, 0.42, 0.13), stroke(DERIVED.hullDark, 0.035, 'material', 0.9)),
    // Lit top edge on the barrel, so it reads as a cylinder rather than a slab.
    poly(box(0.62, -0.09, 0.42, 0.035), fill(DERIVED.hullLight, 'material', 0.8)),
    poly(box(1.0, 0, 0.08, 0.17), fill(DERIVED.hullDark, 'material')),
    // Player-colour trim: two collar bands on the mount. Trim only (§3.2).
    poly(box(0.2, 0, 0.05, 0.29), fill(id, 'identity')),
    poly(box(0.34, 0, 0.04, 0.16), fill(id, 'identity', 0.9)),
  );

  if (state === 'tracking') {
    shapes.push(
      circle(1.02, 0, 0.13, fill(PALETTE.plasma, 'energy', 0.35)),
      circle(1.02, 0, 0.07, fill(DERIVED.plasmaHot, 'energy', 0.9)),
    );
  } else if (state === 'firing') {
    // Muzzle flash: threat red, because enemy fire is red by contract (§2).
    shapes.push(
      poly([1.02, 0.18, 1.5, 0.07, 1.62, 0, 1.5, -0.07, 1.02, -0.18], fill(PALETTE.threatRed, 'danger', 0.9)),
      poly([1.04, 0.09, 1.34, 0.03, 1.4, 0, 1.34, -0.03, 1.04, -0.09], fill(DERIVED.plasmaHot, 'energy', 0.85)),
    );
  } else if (barrelCold) {
    shapes.push(circle(1.0, 0, 0.06, fill(DERIVED.plasmaDim, 'energy', 0.6)));
  }

  return sprite(`turret/p${options.playerId}/${state}`, state === 'firing' ? 1.7 : 1.1, shapes);
}

// ---------------------------------------------------------------------------
// Shield
// ---------------------------------------------------------------------------

/**
 * How much bubble is left, as the three states a player can act on. The sim
 * owns the HP; this is the banding that makes "pressure beats regeneration"
 * (GDD §2.6) visible from outside weapon range.
 */
export type ShieldStrength = 'full' | 'weakened' | 'failing';

/** Band a 0..1 shield fraction into the three visible strengths. */
export function shieldStrength(fraction: number): ShieldStrength {
  if (fraction > 0.66) return 'full';
  if (fraction > 0.25) return 'weakened';
  return 'failing';
}

export interface ShieldSpriteOptions {
  readonly playerId: number;
  readonly strength: ShieldStrength;
  /** Second generator in the stack (GDD §2.5, "stacks to two") — drawn wider. */
  readonly stackIndex?: number;
}

const SHIELD_ALPHA: Readonly<Record<ShieldStrength, number>> = {
  full: 1,
  weakened: 0.62,
  failing: 0.34,
};

/**
 * The share of the layer's pool that has drained, by band — what the gauge ring
 * fills red (ratified p11). `full` is whole (no red); `weakened` is filled to
 * about half; `failing` is nearly gone, an outermost layer about to die before
 * the core has begun to fill. The precise pool lives in the sim; these are the
 * three steps an attacker reads from outside weapon range (GDD §2.6).
 */
const SHIELD_LOST: Readonly<Record<ShieldStrength, number>> = {
  full: 0,
  weakened: 0.5,
  failing: 0.8,
};

/**
 * The bubble over the core, at unit radius. The body is plasma by contract (§1:
 * "weapon fire, cockpits, **energy**"); its deterioration speaks the ratified
 * ring-damage grammar (p11) — an owner-colour gauge ring the same threat red
 * FILLS as the pool drains, identical to the core's, so a defender reads the
 * siege outermost-first ({@link ringDamageShapes}). The equator that once merely
 * tinted the bubble is now that gauge, doing double duty as identity and health.
 */
export function shieldSprite(options: ShieldSpriteOptions): SpriteDef {
  const a = SHIELD_ALPHA[options.strength];
  const stack = options.stackIndex ?? 0;
  const r = 1 + stack * 0.09;

  const shapes: Shape[] = [
    circle(0, 0, r, fill(PALETTE.plasma, 'energy', 0.1 * a)),
    poly(annulusPoints(0, 0, r, r - 0.05, 0, Math.PI * 2, 48), fill(PALETTE.plasma, 'energy', 0.85 * a)),
    // Facet highlights: three arcs, so the bubble reads as a sphere and its
    // strength reads as brightness rather than as a number nobody can see.
    ...[0.35, 1.6, 3.2].map((from) =>
      polyline(
        arcPoints(0, 0, r - 0.11, from, from + 0.7, 10),
        stroke(DERIVED.plasmaHot, 0.045, 'energy', 0.7 * a),
      ),
    ),
    // The deterioration gauge: owner-colour base, red fill by pool lost (p11).
    // A full ring at 32 segments so it reads as a ring, not a facet.
    ...ringDamageShapes({
      playerId: options.playerId,
      lost: SHIELD_LOST[options.strength],
      outer: r - 0.02,
      inner: r - 0.09,
      segments: 32,
    }),
  ];

  if (options.strength === 'failing') {
    // A failing bubble is visibly holed: gaps you can already shoot through.
    for (let i = 0; i < 3; i++) {
      const from = i * 2.094 + 0.6;
      shapes.push(
        poly(annulusPoints(0, 0, r + 0.01, r - 0.06, from, from + 0.42, 6), fill(PALETTE.vacuum, 'material', 0.9)),
      );
    }
  }

  return sprite(`shield/p${options.playerId}/${options.strength}/s${stack}`, round(r + 0.06), shapes);
}

/**
 * The construction ghost shared by both buildables (GDD §2.5: "construction
 * takes time … defenses are bought before the attack, not during it"). A
 * progress arc in patina — the "old system" tint, and the colour the repair
 * channel already owns, so *work happening* has one colour across the game.
 *
 * @param progress 0..1, quantised to 10% so the texture pool isn't defeated.
 */
export function buildProgressSprite(progress: number): SpriteDef {
  const p = Math.round(Math.max(0, Math.min(1, progress)) * 10) / 10;
  const start = -Math.PI / 2;
  const shapes: Shape[] = [
    poly(annulusPoints(0, 0, 1, 0.88, 0, Math.PI * 2, 36), fill(DERIVED.hullDark, 'material', 0.7)),
  ];
  if (p > 0) {
    shapes.push(
      poly(
        annulusPoints(0, 0, 1, 0.88, start, start + Math.PI * 2 * p, Math.max(2, Math.round(36 * p))),
        fill(PALETTE.patina, 'material', 0.95),
      ),
    );
  }
  return sprite(`build/progress/${Math.round(p * 100)}`, 1.05, shapes);
}
