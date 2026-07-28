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
import { continentPolygons } from './stations';
import { DERIVED, PALETTE } from './palette';
import {
  annulusPoints,
  arcPoints,
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
 * A dead station, at the same unit radius as the living one — the wreck keeps
 * its position and radius and stays solid (GDD §2.7), so the two sprites are
 * interchangeable at the same scale and the death is a straight swap.
 *
 * The variant is carried through so a wreck is recognisably *that* world: the
 * same coastlines, ashed over. Losing a stranger's station and losing the one
 * you spent the match next to should not look identical.
 */
export function stationWreckSprite(variant: number): SpriteDef {
  const v = Math.abs(Math.trunc(variant)) % 4;
  const rng = mulberry32((0x1b873593 ^ (v * 0xc2b2ae35)) >>> 0);
  const crust = fill(DERIVED.wreckCrust, 'material');
  const seam = stroke(DERIVED.rockFissure, 0.035, 'material', 0.95);

  const shapes: Shape[] = [
    circle(0, 0, 1, fill(DERIVED.wreckBody, 'material')),
    // The old coastlines, one shade above the ash — the world is still legible
    // under what happened to it.
    ...continentPolygons(v).map((p) => poly(p, crust)),
    circle(0, 0, 1, stroke(DERIVED.rockFissure, 0.05, 'material', 0.8)),
  ];

  // Fracture lines radiating from the dead core: the crack that killed it.
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

  // Broken-crust ribs curving across the corpse — the "ribcage wreck" of the
  // scene gallery (docs/art-direction, Wreck-scavenging moment), read into a body
  // that GDD §2.7 keeps solid and full-radius. One shade above the ash, partial
  // sweeps, so the shell reads as cracked open without the wreck ceasing to be
  // one solid mass.
  const rib = stroke(DERIVED.wreckCrust, 0.045, 'material', 0.9);
  for (let i = 0; i < 3; i++) {
    const r = 0.42 + i * 0.2;
    const from = rng.next() * Math.PI * 2;
    shapes.push(polyline(arcPoints(0, 0, r, from, from + 1.3 + rng.next() * 0.5, 9), rib));
  }

  // The core, gone out. Dark steel where the yellow was — the quiet, drawn.
  shapes.push(
    circle(0, 0, 0.26, fill(DERIVED.hullDark, 'material')),
    circle(0, 0, 0.26, stroke(DERIVED.rockFissure, 0.05, 'material')),
    circle(0, 0, 0.12, fill(PALETTE.vacuum, 'material')),
  );

  return sprite(`wreck/station/v${v}`, 1, shapes);
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
