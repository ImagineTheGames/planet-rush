/**
 * src/art/vfx/shots.ts — the DAMAGE-tier shot ramp. OWNER: Art & Audio Agent.
 *
 * RATIFIED (developer, p11-06): **"the upgrades for weapon damage change the
 * colours of the shots."** Power you can SEE — yours as satisfaction, the
 * enemy's as a readable threat level. A shooter's DAMAGE tier (the `Power` /
 * DAMAGE upgrade on a ship, the Mk on a turret) tints the projectile it looses:
 * the higher the tier, the hotter and brighter the shot, so at a glance you read
 * *how strong* a shot is — not just whose it is.
 *
 * ## The two rules the ramp must never break (style-guide §2)
 *
 *  1. **Signal yellow stays reserved** for ore and danger. The ramp brightens by
 *     lightening the family base toward WHITE, which walks plasma cyan → pale
 *     cyan and threat red → hot pink-white; neither path ever passes through
 *     yellow. `shots.test.ts` proves it (no ramp colour is in the yellow family).
 *  2. **"Whose shot" stays instant.** The tier ramp modulates *within* each
 *     side's palette — {@link ShotFamily} `own` climbs the **plasma** family
 *     (energy), `enemy` climbs the **threat-red** family (danger). So a brighter
 *     shot is a stronger shot of the *same side*, never a shot that changed
 *     hands. Threat red keeps its enemy-danger meaning at every rung.
 *
 * ## How it stays free (GDD §4.3)
 *
 * Each (family, tier) is one baked {@link SpriteDef} — a soft glow over a bright
 * core, both in the rung's declared shade. A renderer keys its pooled shot
 * sprite by `${family}:${tier}` and rebuilds geometry only when a slot's shot
 * changes family or tier (the same discipline the asteroid pool uses), so a
 * firefight of hundreds of shots costs transforms per frame and nothing else.
 * The tier is stamped from sim state at spawn — a shot's `damage` never changes
 * in flight — so the tint is decided once and read forever after.
 *
 * The rung colours themselves live in `../palette` (`DERIVED`, declared with
 * recipes and recomputed by the palette audit) and are walked by the palette
 * compliance test through the catalogue, so the ramp is verified, not asserted.
 */

import { DERIVED, PALETTE } from '../palette';
import { circle, fill, sprite, type PaintRole, type SpriteDef } from '../shapes';

/**
 * Whose shot this is, from the viewer's seat: `own` fire (the viewer's, and any
 * ally's) reads in the plasma energy family; `enemy` fire reads in the threat-red
 * danger family. A renderer resolves this per shot (`areEnemies`), never the art.
 */
export type ShotFamily = 'own' | 'enemy';

/** Both families, for the catalogue and any exhaustive walk. */
export const SHOT_FAMILIES: readonly ShotFamily[] = ['own', 'enemy'];

/**
 * The tier ramp, per family: index `i` is DAMAGE tier `i` (tier 0 = the family
 * base, at full saturation), brightening toward white as the tier climbs. Four
 * rungs — a base plus the three upgrade tiers the DAMAGE ladder promises
 * (GDD §2.5) — clamped for any tier past the top. `own` rung 3 is `plasmaHot`,
 * the hottest plasma already declared; every other rung is its own declared
 * shade (`../palette` DERIVED), so the whole ramp is on the palette allow-list.
 */
export const SHOT_TIER_COLORS: Readonly<Record<ShotFamily, readonly number[]>> = {
  own: [PALETTE.plasma, DERIVED.shotOwn1, DERIVED.shotOwn2, DERIVED.plasmaHot],
  enemy: [PALETTE.threatRed, DERIVED.shotEnemy1, DERIVED.shotEnemy2, DERIVED.shotEnemy3],
};

/** The top rung index — a tier past this reads as the hottest shot. */
export const SHOT_MAX_TIER: number = SHOT_TIER_COLORS.own.length - 1;

/** All tier indices, for the catalogue and tests. */
export const SHOT_TIERS: readonly number[] = SHOT_TIER_COLORS.own.map((_, i) => i);

/** The paint role each family wears — so the compliance audit keeps enemy fire
 *  on `danger` (threat red is reserved for it) and own fire on `energy`. */
const SHOT_ROLE: Readonly<Record<ShotFamily, PaintRole>> = { own: 'energy', enemy: 'danger' };

/** A tier clamped into the ramp — a missing/`NaN`/over-max tier reads as the
 *  nearest rung, the same clamp the sim uses on `Turret.tier` / an upgrade tier.
 *  So an untagged or wire-decoded shot is never a crash, just tier 0. */
export function clampShotTier(tier: number): number {
  if (!Number.isFinite(tier)) return 0;
  return Math.max(0, Math.min(Math.floor(tier), SHOT_MAX_TIER));
}

/** The shot colour for a family at a DAMAGE tier — the rung on the ramp. */
export function shotTierColor(family: ShotFamily, tier: number): number {
  return SHOT_TIER_COLORS[family][clampShotTier(tier)]!;
}

/**
 * How much the shot's glow overhangs its collision radius at a tier — the halo
 * grows with the tier, so a stronger shot reads bigger and hotter, not only
 * brighter. `1` at tier 0 (glow sits at the shot radius); a fifth wider per rung.
 * Baked into {@link shotSprite}'s halo radius; a renderer needs it only if it
 * tints a flat sprite instead of baking the ramp.
 */
export function shotGlowScale(tier: number): number {
  return 1 + clampShotTier(tier) * 0.16;
}

/**
 * The baked shot sprite for a (family, tier): a soft glow over a bright core, both
 * in the rung's shade — the lighter the shade (higher tier), the hotter the core
 * reads, and the halo grows with the tier ({@link shotGlowScale}). Authored in
 * unit space where radius `1` is the projectile's collision radius; the glow
 * overhangs it (that is why the sprite's `extent` is the halo radius). One sprite
 * per rung, so the shot pool bakes it once and shares it across every shot of that
 * family and tier.
 */
export function shotSprite(family: ShotFamily, tier: number): SpriteDef {
  const t = clampShotTier(tier);
  const color = SHOT_TIER_COLORS[family][t]!;
  const role = SHOT_ROLE[family];
  const halo = shotGlowScale(t);
  return sprite(`vfx:shot:${family}:${t}`, halo, [
    // Soft outer glow — grows with the tier so the shot reads bigger as it bites
    // harder. Low alpha: it is light spilling off the core, not a second body.
    circle(0, 0, halo, fill(color, role, 0.3)),
    // The bright core: the rung's shade at near-full alpha. A lighter (higher-tier)
    // shade at this alpha is what reads as a hotter, more powerful shot.
    circle(0, 0, 0.62, fill(color, role, 0.95)),
  ]);
}
