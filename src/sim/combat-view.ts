/**
 * src/sim/combat-view.ts — the muzzle-flash read model. OWNER: Gameplay Engineer.
 *
 * A pure selector over authoritative sim state that answers one question the
 * renderer, the audio layer, and any HUD keep asking: **which turrets fired this
 * tick, and where is the flash?** It reads the world; it never writes it.
 *
 * This exists because of a real field bug (build 5254cfe): enemy fire and turret
 * fire were invisible. The client was building its combat visuals from the local
 * player's *input* instead of from sim combat state, so only your own shot ever
 * drew. The fix is to drive visuals from combat state, and this selector is the
 * single source every consumer reads: walk the world, emit one {@link MuzzleFlash}
 * per firing turret. Miss nobody, invent nobody.
 *
 * Since the ratified amendment v0.3 (mining is a projectile, the laser retired as
 * a mechanism) a **ship** no longer carries any shot geometry — its shots are
 * drawn from the projectile pool, and `Ship.firing` is a bare boolean tell. So
 * this model emits only the **turret muzzle** flash (`Turret.muzzle`), for every
 * turret that looses a shot, whoever the camera follows.
 *
 * The result is deliberately render-agnostic — plain `Muzzle` geometry plus who
 * fired it. Colour, pooling, and Pixi geometry are the render layer's business (a
 * per-player tint keyed off `shooter`); this module owns only the truth of the
 * shot.
 */

import type { Muzzle, PlayerId } from '@shared/types';
import type { World } from './state';

/**
 * One turret's muzzle flash this tick: the shared `Muzzle` geometry (origin, unit
 * direction, clamped hit point and length) plus the slot that fired it. `shooter`
 * is the turret owner's player slot, so a renderer can tint the flash in that
 * player's colour (style-guide §3) and the fog/audio layers can attribute the
 * shot.
 */
export interface MuzzleFlash extends Muzzle {
  readonly shooter: PlayerId;
}

/**
 * Every turret muzzle flash in the world this tick — one per turret that fired —
 * for a renderer to draw and an audio layer to sound.
 *
 * Sourced entirely from sim state (`Turret.muzzle`), never from input, so a rival
 * turret spitting shots shows up exactly like your own does. A turret only
 * contributes on the tick it actually looses a shot.
 *
 * Allocates a fresh array (and one record per live flash) — this is a per-frame
 * *render* helper, off the sim's zero-allocation hot path, and the count is
 * bounded by the entity caps (≤32 turrets, GDD §4.3). A caller that wants to pool
 * can read `Turret.muzzle` off the world directly; this is the convenient,
 * correct default.
 */
export function muzzleFlashes(world: World): MuzzleFlash[] {
  const out: MuzzleFlash[] = [];

  for (const planet of world.planets) {
    for (const turret of planet.turrets) {
      const muzzle = turret.muzzle;
      if (turret.hp <= 0 || !muzzle) continue;
      out.push({
        shooter: turret.owner,
        origin: muzzle.origin,
        dir: muzzle.dir,
        hitPoint: muzzle.hitPoint,
        length: muzzle.length,
      });
    }
  }

  return out;
}
