/**
 * src/art/vfx/showcase.ts — the VFX review sheet, frozen. OWNER: Art Agent.
 *
 * `?freeze=1` pins the sim at a seeded tick so a screenshot is reproducible
 * (`@platform/freeze`), and the golden scene is where the art of this game gets
 * *looked at* — the ships, the rocks, the station furniture and the defence
 * showcase are all in that frame for exactly one reason: they are simply there,
 * so a human can review them without playing a match.
 *
 * A frozen world has no deltas, so the tell observer — which derives every effect
 * by diffing successive worlds (`./observer`) — correctly emits nothing, and the
 * VFX layer would be an empty container in every baseline. That is the wrong
 * answer twice over: the one subsystem this milestone wired would be the one
 * subsystem the review sheet cannot show, and a regression that silently unwired
 * it again would move no pixels.
 *
 * So this file does for particles what `stampDefenseShowcase` does for turrets:
 * it stages a **fixed, deterministic** moment of the effect set into the field,
 * through the real router (`./field` `consume`), from real tells. Nothing here
 * fakes a particle — it pushes the same two tells the observer pushes when a ship
 * dies and when ore is tractored in, and lets the shipped code draw them.
 *
 * **Determinism.** The field is reset (which reseeds its scatter RNG), then the
 * schedule below is played at a *fixed* timestep — never the wall clock — so the
 * pool lands in a byte-identical state on every boot and every machine. The
 * caller must then stop updating the field for as long as the freeze holds:
 * particles animate off `dt`, and a pool that keeps ageing between boot and
 * capture is a golden that flickers. See `src/main.ts` (`flags.freeze`).
 *
 * **Two effects, on purpose** (a2-07 scope): the brief's `explosion` and
 * `oreCollect`, at their true magnitudes — not scaled up to photograph better.
 * Tuning the other twenty-three by eye is a follow-up with the developer's eyes
 * on it, and a showcase that flattered them would be the wrong evidence for it.
 */

import { TELL, type TellQueue } from '../tells';
import type { VfxField } from './field';

/** A point in world units — the local ship, which the camera holds at centre. */
export interface ShowcaseAnchor {
  readonly x: number;
  readonly y: number;
}

/** The fixed timestep the schedule is played at. Never the real frame delta. */
export const VFX_SHOWCASE_DT = 1 / 60;

/**
 * Steps to pre-roll. Eight (~0.13 s) is chosen so the explosion is caught mid-
 * bang rather than mid-fade: its flare (ttl 0.16 s) is still lit, its shock ring
 * has opened to about half its final radius, and its embers have thrown far
 * enough to read as debris. One frame later everything is dimmer; twenty frames
 * later it is smoke.
 */
export const VFX_SHOWCASE_STEPS = 8;

/** Ore chunks in the staged stream — four arrivals, two frames apart. */
const ORE_CHUNKS = 4;

/** Where each effect sits, in world units from the anchor. Both to the left of
 *  the ship, clear of the station furniture, and inside the narrowest viewport
 *  in the device matrix (the landscape phone) — a showcase off the edge of the
 *  phone baseline would only be reviewed on the desktop one. */
const EXPLOSION_AT = { dx: -240, dy: 110 } as const;
const ORE_AT = { dx: -240, dy: -110 } as const;

/**
 * Stage the frozen VFX review sheet into `field`.
 *
 * Resets the field first (so the result cannot depend on what the boot drew
 * before the freeze settled), then plays the schedule at {@link VFX_SHOWCASE_DT}.
 * The queue is borrowed and left clear.
 *
 * @param field  The live field — the same one the match feeds.
 * @param tells  The frame's tell queue, borrowed for the staging.
 * @param at     The camera anchor, in world units (the local ship).
 * @param player The slot the effects are attributed to (identity colour).
 */
export function stageVfxShowcase(
  field: VfxField,
  tells: TellQueue,
  at: ShowcaseAnchor,
  player = 0,
): void {
  field.reset();

  for (let step = 0; step < VFX_SHOWCASE_STEPS; step++) {
    tells.clear();

    // A ship died here: `magnitude` is hull radius / 16 (`../tells` payload), so
    // 1 is the biggest explosion the game actually makes, not a bigger one.
    if (step === 0) {
      tells.push(TELL.shipExplode, at.x + EXPLOSION_AT.dx, at.y + EXPLOSION_AT.dy, 0, 1, player);
    }

    // Ore arriving one chunk at a time (GDD §2.3 tractor collection) — one tell
    // per chunk, which is what the observer emits, staggered so the stream reads
    // as a stream. `angle` is the chunk → ship direction; `magnitude` is how full
    // the hold now is, climbing as the chunks land.
    const chunk = step / 2;
    if (step % 2 === 0 && chunk < ORE_CHUNKS) {
      const angle = (chunk / ORE_CHUNKS) * Math.PI * 2;
      tells.push(
        TELL.oreCollect,
        at.x + ORE_AT.dx,
        at.y + ORE_AT.dy,
        angle,
        (chunk + 1) / ORE_CHUNKS,
        player,
      );
    }

    field.consume(tells);
    field.update(VFX_SHOWCASE_DT);
  }

  tells.clear();
}
