/**
 * src/art/buildings.ts — turrets and shields. OWNER: Art & Audio Agent.
 *
 * Style-guide §5.5: **"Turrets must read as cannons at a glance and telegraph
 * their threat while spinning."** Both halves are mechanical requirements, not
 * flavour, because the siege model depends on them (GDD §2.6): "turrets deter;
 * the ship defends." A deterrent that isn't legible deters nobody — an attacker
 * has to be able to count the guns from outside their range and decide, and a
 * defender has to see at a glance which of their mounts survived the last pass.
 *
 * **The ratified pool (docs/art-direction §5.5).** The board named four
 * silhouettes by hand — T5 Breech Cannon, T7 Twin Cannon, T3b Rail Spike,
 * T6 Dome Bunker — and the whole point is that they read as *cannons*, and that
 * upgrading one reads as *more gun*. So the pool is mapped deliberately onto the
 * turret Mk ladder (`TURRET_TIERS`, sim/constants) so the body and the shot-tier
 * ramp (p11-06) tell one escalating story:
 *
 *  - **Mk I → Breech Cannon** — one thick barrel with a muzzle brake on a
 *    skirted drum. The unambiguous baseline "this is a cannon"; slowest fire.
 *  - **Mk II → Twin Cannon** — paired stacked barrels on the same drum. The
 *    "more dakka" upgrade read: at a glance, *this one got better*.
 *  - **Mk III → Rail Spike** — a long charge-rail proud of the mount, its charge
 *    lights climbing toward the muzzle. The apex: longest reach, tightest aim,
 *    the loudest telegraph — a shot you can see coming from across the field.
 *
 * **T6 Dome Bunker** is built and catalogued too (the board ratified all four),
 * but held off the player ladder — a barrel-less fortified emplacement, proposed
 * as the enemy-field / derelict variant so a rival's guns can read distinct from
 * yours. Selectable by silhouette; not wired to a tier (see the PR proposal).
 *
 * The threat telegraph is the muzzle's state, not an added effect, and it is
 * shared across every silhouette so the read is one grammar:
 *
 *  - `building` — a scaffold: hazard-striped footing under a strut lattice and a
 *    ghosted barrel. It isn't a gun until it finishes (GDD §2.5, ~10 s), and the
 *    art must not lie about that.
 *  - `idle`     — muzzle dark and cold.
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

/** What the muzzle is doing this frame — the threat telegraph (style-guide §5.5). */
export type TurretState = 'building' | 'idle' | 'tracking' | 'firing';

/**
 * The ratified pool by name (docs/art-direction §5.5). `breech`/`twin`/`rail`
 * are the three player-ladder silhouettes; `dome` is the reserved fortified
 * emplacement (built + catalogued, off the tier ladder).
 */
export type TurretSilhouette = 'breech' | 'twin' | 'rail' | 'dome';

/**
 * The deliberate map of the Mk ladder onto the pool (see file header): index `i`
 * is tier `i`'s silhouette. Three rungs, so Mk III shares the top; `dome` is not
 * here on purpose. Mirrors the sim's `TURRET_TIERS` length without importing it
 * (art stays free of sim) — {@link turretSilhouetteForTier} clamps to range.
 */
export const TURRET_TIER_SILHOUETTE: readonly TurretSilhouette[] = ['breech', 'twin', 'rail'];

/** The pool silhouette a turret tier wears — a tier past the top reads as Mk III,
 *  a missing/negative tier as Mk I, the same clamp the sim uses on `Turret.tier`. */
export function turretSilhouetteForTier(tier: number): TurretSilhouette {
  if (!Number.isFinite(tier)) return TURRET_TIER_SILHOUETTE[0]!;
  const i = Math.max(0, Math.min(Math.floor(tier), TURRET_TIER_SILHOUETTE.length - 1));
  return TURRET_TIER_SILHOUETTE[i]!;
}

export interface TurretSpriteOptions {
  /** The owning slot: turret trim takes its player's colour, hull stays steel. */
  readonly playerId: number;
  readonly state: TurretState;
  /** Mk on the ladder (`Turret.tier`); picks the pool silhouette. Default Mk I. */
  readonly tier?: number;
  /** Force a specific pool silhouette, ignoring `tier` — how `dome` (off-ladder)
   *  and the catalogue reach a body directly. */
  readonly silhouette?: TurretSilhouette;
}

function box(cx: number, cy: number, hw: number, hh: number): number[] {
  return [cx - hw, cy - hh, cx + hw, cy - hh, cx + hw, cy + hh, cx - hw, cy + hh];
}

/**
 * The muzzle's telegraph, shared by every silhouette so the threat read is one
 * grammar (cold dot → plasma charge → red flash) regardless of the gun. `tipX`
 * is where the barrel ends; `tipY` offsets it for a stacked/twin barrel. Returns
 * the shapes and how far past the tip the state reaches, so the caller can size
 * the sprite's extent to the flash.
 */
function muzzleTelegraph(tipX: number, tipY: number, state: TurretState): { shapes: Shape[]; reach: number } {
  if (state === 'tracking') {
    return {
      shapes: [
        circle(tipX + 0.02, tipY, 0.13, fill(PALETTE.plasma, 'energy', 0.35)),
        circle(tipX + 0.02, tipY, 0.07, fill(DERIVED.plasmaHot, 'energy', 0.9)),
      ],
      reach: tipX + 0.15,
    };
  }
  if (state === 'firing') {
    // Muzzle flash: threat red, because enemy fire is red by contract (§2).
    return {
      shapes: [
        poly(
          [tipX + 0.02, tipY + 0.18, tipX + 0.5, tipY + 0.07, tipX + 0.62, tipY, tipX + 0.5, tipY - 0.07, tipX + 0.02, tipY - 0.18],
          fill(PALETTE.threatRed, 'danger', 0.9),
        ),
        poly(
          [tipX + 0.04, tipY + 0.09, tipX + 0.34, tipY + 0.03, tipX + 0.4, tipY, tipX + 0.34, tipY - 0.03, tipX + 0.04, tipY - 0.09],
          fill(DERIVED.plasmaHot, 'energy', 0.85),
        ),
      ],
      reach: tipX + 0.62,
    };
  }
  // idle: a cold bore glow, so the muzzle reads even dark.
  return { shapes: [circle(tipX, tipY, 0.06, fill(DERIVED.plasmaDim, 'energy', 0.6))], reach: tipX };
}

/** The steel footing every standing turret sits on — a squat plated ring. */
function turretFooting(): Shape[] {
  return [
    circle(0, 0, 0.86, fill(DERIVED.hullShadow, 'material')),
    poly(annulusPoints(0, 0, 0.86, 0.7, 0, Math.PI * 2, 28), fill(PALETTE.hullSteel, 'material')),
    circle(0, 0, 0.62, fill(DERIVED.hullDark, 'material')),
  ];
}

/**
 * The construction scaffold — the `building` state for every silhouette (a build
 * is always a fresh Mk I, so the scaffold is one look). Hazard-striped footing
 * under a strut lattice with a ghosted barrel: it reads *unmistakably* as "under
 * construction, not yet a gun" (GDD §2.5). Signal yellow is legal here — "hazard
 * stripes" is a named allowance of the RESERVED rule (§2), and a half-built
 * turret is exactly a hazard: it takes damage and shoots back at nothing.
 */
function turretScaffold(playerId: number): SpriteDef {
  const shapes: Shape[] = [circle(0, 0, 0.86, fill(DERIVED.hullShadow, 'material'))];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    shapes.push(
      poly(annulusPoints(0, 0, 0.84, 0.72, a, a + Math.PI / 6, 4), fill(PALETTE.signalYellow, 'danger', 0.85)),
    );
  }
  shapes.push(
    // Ghosted barrel: the gun that isn't there yet — faint, so it never reads as ready.
    poly(box(0.5, 0, 0.34, 0.11), fill(DERIVED.hullShadow, 'material', 0.35)),
    // Strut lattice: two legs to a raised apex bar, cross-braced — a crane frame.
    polyline([-0.5, 0.32, -0.14, -0.62], stroke(PALETTE.hullSteel, 0.05, 'material', 0.9)),
    polyline([0.5, 0.32, 0.14, -0.62], stroke(PALETTE.hullSteel, 0.05, 'material', 0.9)),
    polyline([-0.14, -0.62, 0.14, -0.62], stroke(PALETTE.hullSteel, 0.05, 'material', 0.9)),
    polyline([-0.34, -0.16, 0.34, -0.16], stroke(DERIVED.hullDark, 0.04, 'material', 0.85)),
    // Player-colour tag on the footing, so a scaffold still reads as *whose*.
    poly(box(0, 0.28, 0.16, 0.05), fill(playerColor(playerId), 'identity', 0.9)),
    circle(0, 0, 0.28, fill(DERIVED.hullShadow, 'material')),
  );
  return sprite(`turret/p${playerId}/building`, 1, shapes);
}

// --- Pool bodies (unit radius, barrel/slit along +x) -----------------------

/** T5 Breech Cannon (Mk I): skirted drum, one thick barrel + muzzle brake, a
 *  counterweight breech behind. The baseline "this is a cannon." */
function breechBody(id: number): { shapes: Shape[]; tip: [number, number] } {
  const shapes: Shape[] = [
    // Counterweight breech behind the drum.
    poly(box(-0.5, 0, 0.2, 0.2), fill(DERIVED.hullDark, 'material')),
    poly(box(-0.5, 0, 0.2, 0.2), stroke(DERIVED.hullShadow, 0.035, 'material', 0.9)),
    // Rotating drum.
    circle(0, 0, 0.5, fill(PALETTE.hullSteel, 'material')),
    circle(0, 0, 0.5, stroke(DERIVED.hullDark, 0.045, 'material', 0.9)),
    // Thick barrel.
    poly(box(0.64, 0, 0.4, 0.15), fill(DERIVED.hullShadow, 'material')),
    poly(box(0.64, 0, 0.4, 0.15), stroke(DERIVED.hullDark, 0.035, 'material', 0.9)),
    poly(box(0.64, -0.1, 0.4, 0.04), fill(DERIVED.hullLight, 'material', 0.8)),
    // Muzzle brake — wider than the bore, the "cannon" tell at the tip.
    poly(box(1.02, 0, 0.09, 0.21), fill(DERIVED.hullDark, 'material')),
    poly(box(1.0, -0.12, 0.03, 0.05), fill(DERIVED.hullShadow, 'material')),
    poly(box(1.0, 0.12, 0.03, 0.05), fill(DERIVED.hullShadow, 'material')),
    // Player trim: a collar band at the barrel root.
    poly(box(0.28, 0, 0.06, 0.28), fill(id, 'identity')),
  ];
  return { shapes, tip: [1.11, 0] };
}

/** T7 Twin Cannon (Mk II): paired stacked barrels on the drum — the "more dakka"
 *  upgrade read. Both muzzles telegraph. */
function twinBody(id: number): { shapes: Shape[]; tips: Array<[number, number]> } {
  const barrel = (cy: number): Shape[] => [
    poly(box(0.66, cy, 0.4, 0.09), fill(DERIVED.hullShadow, 'material')),
    poly(box(0.66, cy, 0.4, 0.09), stroke(DERIVED.hullDark, 0.03, 'material', 0.9)),
    poly(box(0.66, cy - 0.06, 0.4, 0.025), fill(DERIVED.hullLight, 'material', 0.8)),
    poly(box(1.04, cy, 0.06, 0.12), fill(DERIVED.hullDark, 'material')),
  ];
  const shapes: Shape[] = [
    poly(box(-0.46, 0, 0.18, 0.24), fill(DERIVED.hullDark, 'material')),
    circle(0, 0, 0.5, fill(PALETTE.hullSteel, 'material')),
    circle(0, 0, 0.5, stroke(DERIVED.hullDark, 0.045, 'material', 0.9)),
    ...barrel(-0.15),
    ...barrel(0.15),
    // Player trim: collar spanning both barrels.
    poly(box(0.3, 0, 0.06, 0.3), fill(id, 'identity')),
  ];
  return { shapes, tips: [[1.1, -0.15], [1.1, 0.15]] };
}

/** T3b Rail Spike (Mk III): a long charge-rail proud of a compact mount, charge
 *  lights climbing toward the muzzle. The apex — longest reach, loudest tell. */
function railBody(id: number, state: TurretState): { shapes: Shape[]; tip: [number, number] } {
  const charged = state === 'tracking' || state === 'firing';
  const shapes: Shape[] = [
    // Compact mount.
    circle(0, 0, 0.42, fill(PALETTE.hullSteel, 'material')),
    circle(0, 0, 0.42, stroke(DERIVED.hullDark, 0.045, 'material', 0.9)),
    // Twin rails running long down +x.
    poly(box(0.85, -0.1, 0.7, 0.028), fill(PALETTE.hullSteel, 'material')),
    poly(box(0.85, -0.1, 0.7, 0.028), stroke(DERIVED.hullLight, 0.02, 'material', 0.8)),
    poly(box(0.85, 0.1, 0.7, 0.028), fill(PALETTE.hullSteel, 'material')),
    poly(box(0.85, 0.1, 0.7, 0.028), stroke(DERIVED.hullLight, 0.02, 'material', 0.8)),
    // Yoke where the rails meet the mount.
    poly(box(0.3, 0, 0.08, 0.16), fill(DERIVED.hullShadow, 'material')),
    // Player trim: collar on the mount.
    poly(box(0.16, 0, 0.05, 0.24), fill(id, 'identity')),
  ];
  // Charge lights climbing the rail — brighter and more of them the closer to a
  // shot; the "charge lights climb before each shot" telegraph made literal.
  const stops = [0.45, 0.75, 1.05, 1.3];
  for (let i = 0; i < stops.length; i++) {
    const lit = charged || i < 1; // idle keeps only the root light warm
    const grow = 0.03 + (i / stops.length) * 0.03;
    shapes.push(
      circle(stops[i]!, 0, grow, fill(lit ? PALETTE.plasma : DERIVED.plasmaDim, 'energy', charged ? 0.9 : 0.5)),
    );
  }
  return { shapes, tip: [1.5, 0] };
}

/** T6 Dome Bunker (reserved): a barrel-less fortified dome with a recessed lens
 *  slit that glows and fires. Menacing in a quiet way — the off-ladder variant. */
function domeBody(id: number): { shapes: Shape[]; tip: [number, number] } {
  const shapes: Shape[] = [
    // The dome — a plated half-shell on the footing.
    poly(arcPoints(0, 0.06, 0.74, Math.PI, Math.PI * 2, 24), fill(PALETTE.hullSteel, 'material')),
    poly(arcPoints(0, 0.06, 0.74, Math.PI, Math.PI * 2, 24), stroke(DERIVED.hullDark, 0.04, 'material', 0.9)),
    // Sunward inner shell, so the dome reads round not flat.
    poly(arcPoints(0, 0.02, 0.5, Math.PI * 1.15, Math.PI * 1.9, 16), fill(DERIVED.hullLight, 'material', 0.55)),
    // Recessed slit housing — a dark brow the lens sits in.
    poly(box(0.42, -0.14, 0.3, 0.08), fill(DERIVED.hullDark, 'material')),
    // Player trim: a band across the dome base.
    poly(box(0, 0.03, 0.6, 0.045), fill(id, 'identity', 0.9)),
  ];
  return { shapes, tip: [0.72, -0.14] };
}

/**
 * A turret at unit radius, barrel/slit along +x (the renderer rotates by
 * `Turret.angle`, which the sim turn-rate-limits toward its target — the
 * "spinning" the style guide asks the threat read to survive). The silhouette is
 * the tier (or an explicit `silhouette`); the muzzle state is the telegraph.
 */
export function turretSprite(options: TurretSpriteOptions): SpriteDef {
  const { state, playerId } = options;
  if (state === 'building') return turretScaffold(playerId);

  const silhouette = options.silhouette ?? turretSilhouetteForTier(options.tier ?? 0);
  const id = playerColor(playerId);
  const shapes: Shape[] = [...turretFooting()];
  let reach = 1;

  if (silhouette === 'twin') {
    const body = twinBody(id);
    shapes.push(...body.shapes);
    for (const [tx, ty] of body.tips) {
      const t = muzzleTelegraph(tx, ty, state);
      shapes.push(...t.shapes);
      reach = Math.max(reach, t.reach);
    }
  } else {
    const body =
      silhouette === 'rail' ? railBody(id, state) : silhouette === 'dome' ? domeBody(id) : breechBody(id);
    shapes.push(...body.shapes);
    const t = muzzleTelegraph(body.tip[0], body.tip[1], state);
    shapes.push(...t.shapes);
    reach = t.reach;
  }

  // Extent tracks the muzzle flash so pooling never clips a firing turret.
  return sprite(`turret/p${playerId}/${silhouette}/${state}`, round(Math.max(1.1, reach + 0.08)), shapes);
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
  /**
   * Include the p11 deterioration gauge ring (default `true`). The render layer
   * draws the *bubble* from this generator but keeps drawing its own CONTINUOUS
   * gauge (`drawDamageFill`) so the health read is smooth, not three-step — so it
   * asks for the bubble alone (`gauge: false`) and there is one ring, not two.
   */
  readonly gauge?: boolean;
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
    // A full ring at 32 segments so it reads as a ring, not a facet. Omitted when
    // the caller (the render layer) supplies its own continuous gauge.
    ...(options.gauge === false
      ? []
      : ringDamageShapes({
          playerId: options.playerId,
          lost: SHIELD_LOST[options.strength],
          outer: r - 0.02,
          inner: r - 0.09,
          segments: 32,
        })),
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

  const gaugeTag = options.gauge === false ? '/bubble' : '';
  return sprite(`shield/p${options.playerId}/${options.strength}/s${stack}${gaugeTag}`, round(r + 0.06), shapes);
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
