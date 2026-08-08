/**
 * src/art/wrecks.ts — what is left of a home. OWNER: Art & Audio Agent.
 *
 * This is the one file in `src/art/` written against the *ache* half of the
 * tone contract rather than the arcade half (style-guide §8, GDD §4.7):
 *
 * > *Ships are toys, explosions are fireworks … But homes are the one serious
 * > thing in it — when a station dies, the game goes briefly quiet, the wreck
 * > stays on the map all match, and nobody jokes for three seconds.*
 *
 * So the wreck is **cold**. No fire, no embers, no threat red: red is the
 * under-attack tell (§2) and a wreck is not a threat — it is an absence, and it
 * has to still read as one twelve minutes later. The core is *out*: dark steel
 * where signal yellow used to be, which is the single strongest thing this
 * palette can say. A player flying past a wreck at minute nine should feel the
 * hole in the map, and the only yellow left in the frame is the ore-laden
 * debris around it — legal (§2: ore), and the reason anyone comes here at all
 * (GDD §2.7: "fights over a fresh wreck are a feature, not a bug").
 */

import { mulberry32 } from '@shared/types';
import { STATION_ART_EXTENT, cutterheadShapes, stationVariantFor } from './stations';
import { DERIVED, PALETTE } from './palette';
import {
  annulusPoints,
  blob,
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

/**
 * The cold halo a wreck sits in: the dust the rig shook loose when it died,
 * still hanging. Stacked as six faint discs rather than one, for the same reason
 * the collection field is forty and not five (`./stations`, `HALO_STEPS`) — a
 * single translucent disc has a findable edge, and a findable edge around a
 * station is a ring the player will try to read a rule off.
 */
const SHROUD_RADIUS = 1.35;
const SHROUD_STEPS = 6;
const SHROUD_ALPHA = 0.036;

/**
 * A dead facility, at the same unit radius as the living one — the wreck keeps
 * its position and radius and stays solid (GDD §2.7), so the two sprites are
 * interchangeable at the same scale and the death is a straight swap.
 *
 * This is the **derelict of the ratified board** (`facility-concepts-r2.html`,
 * Direction D, picked 2026-08-07): the same cutterhead, gone cold. It is drawn
 * by the same generator as the living rig under the dead palette map, which is
 * what makes it recognisably *that* station rather than a generic dead disc —
 * the arrangement, the hoppers, the boom's bearing and the corrosion are the
 * ones it had while it was working. Losing a stranger's rig and losing the one
 * you spent the match next to should not look identical.
 *
 * The board's own caption is the spec, and every clause of it is drawn:
 *
 * > *Cold. The core is out and the throat is dark, three teeth are gone and two
 * > lugs are snapped, the boom is broken mid-span with its outer half adrift,
 * > one hopper has split and run its ore onto the deck. Patina has the rest. No
 * > red, because a wreck is not a threat — it is an absence; the only yellow
 * > left is ore, which is why anyone comes.*
 *
 * The same sprite serves both kinds of wreck the ruleset has: a killed player's
 * home, and the **lootable derelicts** that fill unused board positions on the
 * compass and diamond maps at fewer than eight players (GDD §2.1, §2.7).
 */
export function stationWreckSprite(variant: number): SpriteDef {
  const v = stationVariantFor(variant);
  const rng = mulberry32((0x1b873593 ^ (v * 0xc2b2ae35)) >>> 0);

  const shapes: Shape[] = [];
  for (let i = 0; i < SHROUD_STEPS; i++) {
    const r = round(SHROUD_RADIUS * (1 - (i / SHROUD_STEPS) * 0.34));
    shapes.push(circle(0, 0, r, fill(DERIVED.wreckCrust, 'material', SHROUD_ALPHA)));
  }
  shapes.push(...cutterheadShapes({ variant: v, dead: true }));

  // Fracture lines running out of the dead throat: the crack that killed it.
  // Seeded off the wreck rather than the rig, so two stations that died the same
  // way did not die identically.
  const seam = stroke(DERIVED.rockFissure, 0.035, 'material', 0.95);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rng.next() * 0.5;
    const r = 0.55 + rng.next() * 0.42;
    const kink = a + (rng.next() - 0.5) * 0.6;
    shapes.push(
      polyline(
        [
          round(Math.cos(a) * 0.2),
          round(Math.sin(a) * 0.2),
          round(Math.cos(kink) * r * 0.6),
          round(Math.sin(kink) * r * 0.6),
          round(Math.cos(a) * r),
          round(Math.sin(a) * r),
        ],
        seam,
      ),
    );
  }

  // Plate torn off the deck, drifting just clear of the rim — the silhouette
  // keeps breaking up as you look at it, which is what "abandoned" is made of.
  for (let i = 0; i < 5; i++) {
    const a = rng.next() * Math.PI * 2;
    const d = 1.02 + rng.next() * 0.24;
    shapes.push(
      poly(
        blob(round(Math.cos(a) * d), round(Math.sin(a) * d), 6, () => 0.045 + rng.next() * 0.05),
        fill(DERIVED.wreckCrust, 'material', 0.9),
      ),
    );
  }

  return sprite(`wreck/station/v${v}`, STATION_ART_EXTENT, shapes);
}

/**
 * The scavengeable debris field around a fresh wreck (GDD §2.7): ore-laden, and
 * the only yellow in the frame. Small cargo holds mean nobody hauls a dead
 * player's fortune away in one trip, so this ring is a *place* — it has to read
 * as contested from a distance.
 *
 * @param seed Wreck identity, so two debris fields never look the same.
 */
export function debrisFieldSprite(seed = 0): SpriteDef {
  const rng = mulberry32((0x85ebca6b ^ (seed * 0x9e3779b9)) >>> 0);
  const shapes: Shape[] = [
    // A faint band marking the scavenge zone.
    poly(annulusPoints(0, 0, 1.5, 1.12, 0, Math.PI * 2, 44), fill(DERIVED.wreckCrust, 'material', 0.22)),
  ];
  for (let i = 0; i < 14; i++) {
    const a = rng.next() * Math.PI * 2;
    const d = 1.14 + rng.next() * 0.34;
    const cx = round(Math.cos(a) * d);
    const cy = round(Math.sin(a) * d);
    const r = 0.05 + rng.next() * 0.07;
    // Two in five bits of debris carry ore; the rest are dead hull plate.
    if (rng.next() < 0.4) {
      shapes.push(poly(blob(cx, cy, 5, () => r * 1.2), fill(PALETTE.signalYellow, 'ore', 0.95)));
    } else {
      shapes.push(poly(blob(cx, cy, 5, () => r), fill(DERIVED.wreckCrust, 'material')));
    }
  }
  return sprite(`wreck/debris/${seed}`, 1.55, shapes);
}
