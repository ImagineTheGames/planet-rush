/**
 * src/art/satellite.ts — the radar satellite, generated. OWNER: Art & Audio Agent.
 *
 * The radar satellite is the station's **eyes**: an orbiting sensor structure that
 * scans the claim. Its whole job as an entity is legibility — you must be able to
 * pick it out of a ring of turrets at a glance and know instantly *"that one's the
 * radar."* So it is built to the same **5.5 structure language** the turret pool
 * lives in (steel footing, player-colour trim, plasma for energy, one shared
 * threat/state telegraph — see `buildings.ts`), but with a silhouette that shares
 * nothing with a gun:
 *
 *  - **A DISH, not a barrel.** Every turret in the pool reads as a cannon — a
 *    drum with a barrel proud along +x (breech / twin / rail) or a convex bunker
 *    dome. The satellite is the inverse: a **concave parabolic dish** whose mouth
 *    opens along +x, a feed horn on a boom at its focus, and no barrel anywhere.
 *    Convex dome vs. concave bowl is the cleanest silhouette split available, so
 *    the dome bunker (the one barrel-less turret) still never reads as the dish.
 *  - **It scans, it doesn't shoot.** The turret telegraph is muzzle state (cold
 *    bore → plasma charge → red flash). The satellite's telegraph is the *sweep*:
 *    a plasma sweep arm fanning across the mouth (`sweeping`) and a concentric
 *    return pulse past the rim (`pinging`). Both are plasma/`energy` — a satellite
 *    never wears threat red, because it does not fire; red stays enemy fire (§2).
 *    The renderer rotates the whole sprite by the scan angle, so a static sweep
 *    wedge plus that rotation reads as a live radar sweep at zero per-frame cost.
 *
 * Like every station structure it **orbits on the ring band** and is placed and
 * scaled by the render layer exactly as a turret is (`turretOrbitPos`); its health
 * reads the same way a turret's does — a bar and numerals riding the orbit
 * position, and a damaged body fading toward the vacuum rather than recolouring
 * (threat red is a damage *event*, never a standing object). This file owns only
 * the body and its states; the orbit, the bar and the fade are the render layer's.
 *
 * ## The death moment — losing your eyes
 *
 * A satellite is not a home, so its death is arcade, not the three-second hush
 * (that belongs to `stationDeath`/`./vfx/death-moment` and nothing else). But it
 * is your *sight*, so it earns a real beat: the destruction throws the same
 * firework burst a ship does and leaves a **cold debris remnant** drawn in the
 * wreck language (`wrecks.ts`) — a collapsed dish, dark and quiet, no yellow and
 * no red. A satellite carries no ore bank, so unlike a station wreck its debris
 * has *nothing to loot*: it is pure absence, the hole where your scouting was.
 *
 * **Sound seam (for the Sound Agent, `src/art/audio/`).** This file adds no new
 * {@link TELL} kind — the sim has no satellite entity yet, so there is no world
 * diff to derive one from, and a half-wired tell would break the audio bank's
 * per-kind coverage test. When the satellite ships as a sim entity, three moments
 * want a voice, and the observer should route them onto tells you already sound:
 *   - **ping** (a scan return) → a soft sensor blip; a *new* `TELL.satellitePing`
 *     is the clean home if you want it distinct from the HUD.
 *   - **under-attack** (the dish taking fire) → reuse {@link TELL.weaponHit} /
 *     {@link TELL.shotImpact}, same as a turret being chipped.
 *   - **destruction** → reuse {@link TELL.turretDown} (a mounted structure picked
 *     off) layered over {@link TELL.shipExplode}'s firework, so losing your eyes
 *     lands as hard as it should. Flagged here so the seam is designed, not found.
 */

import { mulberry32 } from '@shared/types';
import { DERIVED, PALETTE, playerColor } from './palette';
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
// Satellite
// ---------------------------------------------------------------------------

/**
 * What the dish is doing this frame — the sensor telegraph, the satellite's
 * answer to the turret's muzzle states. `building` is the scaffold; `idle` is a
 * cold, dark dish; `sweeping` fans the plasma scan arm across the mouth; `pinging`
 * throws the concentric return pulse past the rim (a contact, made visible).
 */
export type SatelliteState = 'building' | 'idle' | 'sweeping' | 'pinging';

export interface SatelliteSpriteOptions {
  /** The owning slot: dish trim takes its player's colour, hull stays steel. */
  readonly playerId: number;
  readonly state: SatelliteState;
}

function box(cx: number, cy: number, hw: number, hh: number): number[] {
  return [cx - hw, cy - hh, cx + hw, cy - hh, cx + hw, cy + hh, cx - hw, cy + hh];
}

// The dish is the left-facing arc of a circle centred just to +x of the origin,
// so its concave mouth opens along +x (the scan direction the renderer rotates).
const DISH_CX = 0.55;
const DISH_OUTER = 0.72;
const DISH_INNER = 0.56;
const DISH_FROM = Math.PI * 0.7; // 126° — upper rim tip
const DISH_TO = Math.PI * 1.3; //  234° — lower rim tip
/** The feed horn sits on the dish axis, in front of the bowl at the focus. */
const FEED_X = 0.34;

/** The steel footing every orbiting structure sits on — the shared 5.5 plated ring. */
function structureFooting(): Shape[] {
  return [
    circle(0, 0, 0.86, fill(DERIVED.hullShadow, 'material')),
    poly(annulusPoints(0, 0, 0.86, 0.7, 0, Math.PI * 2, 28), fill(PALETTE.hullSteel, 'material')),
    circle(0, 0, 0.62, fill(DERIVED.hullDark, 'material')),
  ];
}

/**
 * The sweep telegraph, the satellite's shared state grammar (cold feed → plasma
 * sweep arm → return pulse), mirroring how {@link muzzleTelegraph} unifies the
 * turret pool. All plasma/`energy`: a dish scans, it never fires, so no red ever
 * touches it. Returns the shapes and how far past the rim the state reaches, so
 * the caller sizes the sprite's extent to the ping.
 */
function sweepTelegraph(state: SatelliteState): { shapes: Shape[]; reach: number } {
  const rim = DISH_CX + DISH_OUTER * Math.cos(DISH_FROM); // mouth-plane x
  if (state === 'sweeping') {
    // A bright plasma arm fanning from the feed across the mouth — the sweep,
    // caught mid-arc. Renderer rotation carries it around; this is one frame of it.
    return {
      shapes: [
        poly(
          [FEED_X, 0, round(FEED_X + 0.62), -0.22, round(FEED_X + 0.72), 0, round(FEED_X + 0.62), 0.22],
          fill(PALETTE.plasma, 'energy', 0.3),
        ),
        polyline(
          [FEED_X, 0, round(FEED_X + 0.7), round(-0.14)],
          stroke(DERIVED.plasmaHot, 0.03, 'energy', 0.85),
        ),
        circle(FEED_X, 0, 0.07, fill(DERIVED.plasmaHot, 'energy', 0.9)),
      ],
      reach: round(FEED_X + 0.72),
    };
  }
  if (state === 'pinging') {
    // A contact: concentric return arcs radiating past the rim, feed white-hot.
    const shapes: Shape[] = [circle(FEED_X, 0, 0.09, fill(DERIVED.plasmaHot, 'energy', 0.95))];
    const arcs = [0.9, 1.15, 1.4];
    for (let i = 0; i < arcs.length; i++) {
      shapes.push(
        polyline(
          arcPoints(0, 0, arcs[i]!, -0.7, 0.7, 12),
          stroke(PALETTE.plasma, 0.035, 'energy', 0.7 - i * 0.16),
        ),
      );
    }
    return { shapes, reach: arcs[arcs.length - 1]! };
  }
  // idle: a cold feed glow, so the dish reads as a sensor even dark — the same
  // trick the turret idle bore uses so a mount is never a dead grey lump.
  return { shapes: [circle(FEED_X, 0, 0.06, fill(DERIVED.plasmaDim, 'energy', 0.6))], reach: rim };
}

/**
 * The construction scaffold — the `building` state, per the a2-05 scaffold grammar
 * shared with the turret (`buildings.ts` `turretScaffold`): a hazard-striped
 * footing under a crane-strut lattice with a *ghosted* dish, so it reads
 * unmistakably as "under construction, not yet an eye" (GDD §2.5, ~10 s build).
 * Signal yellow is legal here — hazard stripes are a named allowance of the
 * RESERVED rule (§2), and a half-built sensor is exactly a hazard: it draws fire
 * and sees nothing.
 */
function satelliteScaffold(playerId: number): SpriteDef {
  const shapes: Shape[] = [circle(0, 0, 0.86, fill(DERIVED.hullShadow, 'material'))];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    shapes.push(
      poly(annulusPoints(0, 0, 0.84, 0.72, a, a + Math.PI / 6, 4), fill(PALETTE.signalYellow, 'danger', 0.85)),
    );
  }
  // Ghosted dish: the sensor that isn't there yet — a faint bowl arc, so it never
  // reads as ready. Same convex-back curve the finished dish wears, one shade.
  shapes.push(
    poly(
      annulusPoints(DISH_CX, 0, DISH_OUTER, DISH_INNER, DISH_FROM, DISH_TO, 16),
      fill(DERIVED.hullShadow, 'material', 0.35),
    ),
    // Crane-strut lattice: two legs to a raised apex bar, cross-braced.
    polyline([-0.5, 0.32, -0.14, -0.62], stroke(PALETTE.hullSteel, 0.05, 'material', 0.9)),
    polyline([0.5, 0.32, 0.14, -0.62], stroke(PALETTE.hullSteel, 0.05, 'material', 0.9)),
    polyline([-0.14, -0.62, 0.14, -0.62], stroke(PALETTE.hullSteel, 0.05, 'material', 0.9)),
    polyline([-0.34, -0.16, 0.34, -0.16], stroke(DERIVED.hullDark, 0.04, 'material', 0.85)),
    // Player-colour tag on the footing, so a scaffold still reads as *whose*.
    poly(box(0, 0.28, 0.16, 0.05), fill(playerColor(playerId), 'identity', 0.9)),
    circle(0, 0, 0.28, fill(DERIVED.hullShadow, 'material')),
  );
  return sprite(`satellite/p${playerId}/building`, 1, shapes);
}

/**
 * A radar satellite at unit radius, its dish mouth opening along +x (the renderer
 * rotates by the scan/orbit angle). The silhouette is a concave parabolic dish on
 * a gimbal pedestal — a DISH at a glance, distinct from every turret in the pool —
 * owner-tinted on its rim band and base collar; the sweep state is the telegraph.
 */
export function satelliteSprite(options: SatelliteSpriteOptions): SpriteDef {
  const { state, playerId } = options;
  if (state === 'building') return satelliteScaffold(playerId);

  const id = playerColor(playerId);
  const shapes: Shape[] = [...structureFooting()];

  // Gimbal pedestal lifting the dish off the footing, with a player-colour collar.
  shapes.push(
    poly(box(0, 0, 0.16, 0.2), fill(DERIVED.hullDark, 'material')),
    poly(box(0, 0.06, 0.2, 0.05), fill(id, 'identity', 0.9)),
  );

  // The dish shell: convex steel back, a lit concave inner face so it reads as a
  // bowl and not a disc, and a dark rim seam. Authored as one thick arc annulus.
  shapes.push(
    poly(
      annulusPoints(DISH_CX, 0, DISH_OUTER, DISH_INNER, DISH_FROM, DISH_TO, 22),
      fill(PALETTE.hullSteel, 'material'),
    ),
    // Inner face, one value up, laid just inside the mouth so the concavity reads.
    poly(
      annulusPoints(DISH_CX, 0, DISH_INNER, round(DISH_INNER - 0.12), DISH_FROM, DISH_TO, 22),
      fill(DERIVED.hullLight, 'material', 0.7),
    ),
    // Rim seam along the back of the bowl.
    polyline(arcPoints(DISH_CX, 0, DISH_OUTER, DISH_FROM, DISH_TO, 22), stroke(DERIVED.hullDark, 0.03, 'material', 0.9)),
  );

  // Support ribs fanning from the feed to the rim — a dish, structurally.
  for (const t of [DISH_FROM + 0.35, Math.PI, DISH_TO - 0.35]) {
    shapes.push(
      polyline(
        [FEED_X, 0, round(DISH_CX + DISH_OUTER * Math.cos(t)), round(DISH_OUTER * Math.sin(t))],
        stroke(DERIVED.hullDark, 0.025, 'material', 0.8),
      ),
    );
  }

  // Feed boom + horn at the focus: the axial arm that carries the sweep, and the
  // player-colour trim band around the outer rim (the satellite's identity read).
  shapes.push(
    polyline([round(DISH_CX - DISH_INNER + 0.02), 0, FEED_X, 0], stroke(PALETTE.hullSteel, 0.03, 'material', 0.9)),
    poly(box(FEED_X, 0, 0.05, 0.07), fill(DERIVED.hullDark, 'material')),
    polyline(
      arcPoints(DISH_CX, 0, round(DISH_OUTER + 0.02), DISH_FROM, DISH_TO, 22),
      stroke(id, 0.035, 'identity', 0.9),
    ),
  );

  const tel = sweepTelegraph(state);
  shapes.push(...tel.shapes);

  // Extent tracks the ping so pooling never clips a return pulse.
  return sprite(`satellite/p${playerId}/${state}`, round(Math.max(0.9, tel.reach + 0.08)), shapes);
}

// ---------------------------------------------------------------------------
// The death remnant — a cold, gutted dish (the wreck language)
// ---------------------------------------------------------------------------

/**
 * What a destroyed satellite leaves: a **collapsed dish**, drawn in the wreck
 * language (`wrecks.ts`) — cold ash-steel, no fire, no ore, no threat red. A
 * satellite is your sight, so its loss reads as an absence, not a threat; and
 * because it carries no ore bank there is nothing to scavenge here (unlike a
 * station wreck's ore-laden debris) — pure hole in the map. Full-radius and solid
 * so the renderer can swap it in for the live dish at the same scale and place.
 *
 * @param seed Structure identity, so two downed dishes never buckle identically.
 */
export function satelliteWreckSprite(seed = 0): SpriteDef {
  const s = Math.abs(Math.trunc(seed)) % 4;
  const rng = mulberry32((0x27d4eb2f ^ (s * 0x165667b1)) >>> 0);
  const crust = fill(DERIVED.wreckCrust, 'material');
  const seam = stroke(DERIVED.rockFissure, 0.03, 'material', 0.95);

  const shapes: Shape[] = [
    // The footing, gone cold and ashed over.
    circle(0, 0, 0.82, fill(DERIVED.wreckBody, 'material')),
    circle(0, 0, 0.82, stroke(DERIVED.rockFissure, 0.045, 'material', 0.8)),
    // The buckled dish: the same bowl arc, dropped and cracked open, ash-grey.
    poly(
      annulusPoints(round(DISH_CX - 0.1), round(0.06), DISH_OUTER, round(DISH_INNER + 0.04), DISH_FROM + 0.2, DISH_TO - 0.1, 18),
      crust,
    ),
    // A snapped feed boom hanging off the axis — the eye put out.
    polyline([round(DISH_CX - 0.3), round(0.06), round(FEED_X - 0.06), round(0.22)], seam),
    poly(box(round(FEED_X - 0.06), 0.24, 0.05, 0.05), crust),
  ];

  // Fracture lines across the dead mount, and a few loose plates buckled off it —
  // debris per the wreck language, cold hull with nothing to loot.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rng.next() * 0.6;
    const r = 0.4 + rng.next() * 0.36;
    shapes.push(
      polyline(
        [round(Math.cos(a) * 0.16), round(Math.sin(a) * 0.16), round(Math.cos(a) * r), round(Math.sin(a) * r)],
        seam,
      ),
    );
  }
  for (let i = 0; i < 5; i++) {
    const a = rng.next() * Math.PI * 2;
    const d = 0.5 + rng.next() * 0.34;
    const cx = round(Math.cos(a) * d);
    const cy = round(Math.sin(a) * d);
    const w = round(0.05 + rng.next() * 0.05);
    shapes.push(poly(box(cx, cy, w, round(w * 0.6)), crust));
  }

  return sprite(`satellite/wreck/${s}`, 1, shapes);
}
