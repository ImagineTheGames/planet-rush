/**
 * src/sim/combat-view.ts — the combat-beam read model. OWNER: Gameplay Engineer.
 *
 * A pure selector over authoritative sim state that answers one question the
 * renderer, the audio layer, and any HUD keep asking: **who is firing right
 * now, and where does their beam go?** It reads the world; it never writes it.
 *
 * This exists because of a real field bug (build 5254cfe): enemy lasers and
 * turret fire were invisible. The client was building its beam visuals from the
 * local player's *input* instead of from sim combat state, so only your own
 * shot ever drew. The fix is to drive visuals from combat state, and this
 * selector is the single source every consumer reads: walk the world, emit one
 * {@link CombatBeam} per shooter. Miss nobody, invent nobody.
 *
 * Since the ratified amendment v0.3 (mining is a projectile, the beam retired as
 * a mechanism) `Ship.beam` is a pure **mining indicator** — non-null only while a
 * ship is cutting a rock, never on a combat shot (combat is a pooled projectile
 * the renderer draws from the shot pool). So the ship loop below emits a
 * `CombatBeam` only for *miners*; a ship shooting an enemy contributes nothing
 * here. Alongside it, the **turret muzzle** flash (`Turret.muzzle`, still a
 * `Beam`) is emitted for every turret that looses a shot, whoever the camera
 * follows.
 *
 * The result is deliberately render-agnostic — plain `Beam` geometry plus who
 * fired it and what kind of emitter it was. Colour, pooling, and Pixi geometry
 * are the render layer's business (a per-player beam tint keyed off `shooter`);
 * this module owns only the truth of the shot.
 */

import type { Beam, PlayerId } from '@shared/types';
import type { World } from './state';

/** What kind of emitter a combat beam came from — a ship's shared shoot/mine
 *  beam, or a turret's muzzle flash (GDD §2.3, §2.6). Lets a consumer style the
 *  two differently (a long cutting torch vs. a short muzzle bloom) without a
 *  second query. */
export type CombatBeamSource = 'ship' | 'turret';

/**
 * One firing emitter's beam this tick: the shared `Beam` geometry (origin, unit
 * direction, clamped hit point and length) plus the slot that fired it and the
 * kind of emitter. `shooter` is the player slot — the ship's own id, or the
 * turret owner's — so a renderer can tint the beam in that player's colour
 * (style-guide §3) and the fog/audio layers can attribute the shot.
 */
export interface CombatBeam extends Beam {
  readonly shooter: PlayerId;
  readonly source: CombatBeamSource;
}

/**
 * Every active combat beam in the world this tick — one per firing ship and one
 * per turret that fired — for a renderer to draw and an audio layer to sound.
 *
 * Sourced entirely from sim state (`Ship.beam`, `Turret.muzzle`), never from
 * input, so an enemy ship carving your core and a rival turret spitting shots
 * both show up exactly like your own beam does. A ship that is not firing (or is
 * dead) has a null `beam` and contributes nothing; a turret only contributes on
 * the tick it actually looses a shot.
 *
 * Allocates a fresh array (and one record per live beam) — this is a per-frame
 * *render* helper, off the sim's zero-allocation hot path, and the shot count is
 * bounded by the entity caps (≤8 ships, ≤32 turrets, GDD §4.3). A caller that
 * wants to pool can read the same two fields off the world directly; this is the
 * convenient, correct default.
 */
export function combatBeams(world: World): CombatBeam[] {
  const out: CombatBeam[] = [];

  for (const ship of world.ships) {
    const beam = ship.beam;
    if (!ship.alive || !beam) continue;
    out.push({
      shooter: ship.id,
      source: 'ship',
      origin: beam.origin,
      dir: beam.dir,
      hitPoint: beam.hitPoint,
      length: beam.length,
    });
  }

  for (const planet of world.planets) {
    for (const turret of planet.turrets) {
      const muzzle = turret.muzzle;
      if (turret.hp <= 0 || !muzzle) continue;
      out.push({
        shooter: turret.owner,
        source: 'turret',
        origin: muzzle.origin,
        dir: muzzle.dir,
        hitPoint: muzzle.hitPoint,
        length: muzzle.length,
      });
    }
  }

  return out;
}
