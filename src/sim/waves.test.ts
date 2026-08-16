/**
 * src/sim/waves.test.ts — the commons wave field: is the map centre reachable?
 * OWNER: Gameplay Engineer.
 *
 * `waves.ts` places every commons asteroid and had no test file of its own; the
 * only coverage was `match.test.ts` §4, which pins CONTAINMENT (each wave lands
 * inside its own shrinking disc) and says nothing about PASSABILITY. This file
 * pins passability.
 *
 * ## What this file pins
 *
 * **A ship at the map centre can always leave it.** The late commons waves used
 * to seal the centre — a ship caught there when wave 4 landed could not get out,
 * by any route, for the rest of the match, on 100 seeds out of 100 — and this
 * file was written as a CHARACTERISATION test asserting that defect while it was
 * shipped. a0-65 fixed it (`WAVE.lastRadiusFraction` 0.25 → 0.5 plus
 * `ringSizeScale` in `./waves`), so the expectation is now the invariant it
 * always should have been: escapable after every wave, not sealed after wave 4.
 * The geometry, the measurement and the rejected fixes are in
 * `docs/wave-commons-entombment.md`.
 *
 * If this goes red, the trap is back. It is a real defect, not a stale
 * expectation — do not "repair" it by relaxing the assertion.
 *
 * ## Why it measures reachability rather than reusing the wedge gate
 *
 * `tests/harness/unstuck.test.ts` is the only other instrument that sees this
 * defect, and it sees it by accident: it flags a bot that stays within
 * `WEDGE_R = 8` of one spot while asking to travel. That is a proxy, and it
 * under-reported the trap in two ways this file does not — which is why a green
 * wedge gate is not evidence that the centre is open.
 *
 *   - It only fires once wave 5 shrinks the sealed cell to a few tens of units.
 *     At wave 4 the cell is 68-108 u across, so an entombed ship flies around
 *     inside it and looks perfectly healthy. Entombment starts a whole wave
 *     before anything detects it.
 *   - Because it is a size threshold, ANY change that enlarges the cell past
 *     8 u reads as a fix. Reserving the commons eye by rock body rather than
 *     rock centre does exactly that: it doubles the pocket, opens zero exits,
 *     and turns the wedge gate green (a0-59 thirteenth session). This file is
 *     immune to that, because it asks whether the ship can get OUT, not whether
 *     it has room to move.
 *
 * The measurement is a flood fill of free CONFIGURATION space — the positions a
 * hull centre may legally occupy — so it admits any weaving path, not just the
 * straight lines a ray cast can see.
 *
 * ## This file has no dependence on the ore-drop change it was written beside
 *
 * It steps the world with no inputs, so no ship ever dies and
 * `DEATH_ORE_DROP_FRACTION` — the whole of a0-59 — never executes. That is what
 * makes it the honest instrument for this trap: the entombment is pure map
 * geometry, present identically at a drop fraction of 0.5 and of 1, and the
 * measurement here cannot be confounded by the economy change on the same branch.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import { createWorld, step } from './index';
import { SHIP_RADIUS, WAVE_COUNT } from './constants';
import type { World } from './state';

/** A cast big enough to make the commons its shipped shape: the sector count —
 *  and so the rock count per ring — is the station count (`spawnWave`). */
const EIGHT = Array.from({ length: 8 }, (_, i) => ({ id: i, shipClass: ShipClass.Vanguard }));

/** Grid pitch for the flood fill, world units. Well under the tens-of-units
 *  gaps that decide passability, and the whole sweep costs ~0.1 s. */
const CELL = 2;

/**
 * Can a hull centred on the map centre reach open space outside the field?
 *
 * Free configuration space is every point further than `rock.radius +
 * SHIP_RADIUS` from every rock centre — i.e. where a hull may sit without
 * overlapping rock. Flood-filling it from the centre and asking whether the
 * component reaches past the field edge is exactly "is there a route out",
 * independent of steering, speed or intent.
 */
function centreCanEscape(world: World): boolean {
  const cx = world.bounds.width / 2;
  const cy = world.bounds.height / 2;
  const reach = world.fieldRadius + 120;
  const n = Math.ceil((2 * reach) / CELL);
  const ox = cx - reach;
  const oy = cy - reach;

  const free = new Uint8Array(n * n);
  for (let iy = 0; iy < n; iy++) {
    const y = oy + (iy + 0.5) * CELL;
    for (let ix = 0; ix < n; ix++) {
      const x = ox + (ix + 0.5) * CELL;
      let ok = true;
      for (const a of world.asteroids) {
        const dx = a.pos.x - x;
        const dy = a.pos.y - y;
        const r = a.radius + SHIP_RADIUS;
        if (dx * dx + dy * dy < r * r) {
          ok = false;
          break;
        }
      }
      free[iy * n + ix] = ok ? 1 : 0;
    }
  }

  const mid = Math.floor(n / 2);
  const start = mid * n + mid;
  if (!free[start]) return false; // centre is inside a rock body: no worse case

  const seen = new Uint8Array(n * n);
  const queue: number[] = [start];
  seen[start] = 1;
  while (queue.length > 0) {
    const c = queue.pop()!;
    const ix = c % n;
    const iy = (c - ix) / n;
    const x = ox + (ix + 0.5) * CELL;
    const y = oy + (iy + 0.5) * CELL;
    // Clear of the outermost wave ring with room to spare: this hull is loose.
    if (Math.hypot(x - cx, y - cy) > world.fieldRadius + 40) return true;
    const nb = [c - 1, c + 1, c - n, c + n];
    for (let k = 0; k < 4; k++) {
      const d = nb[k]!;
      if (d < 0 || d >= n * n) continue;
      if (k < 2 && Math.abs((d % n) - ix) !== 1) continue; // no wrap across rows
      if (!seen[d] && free[d]) {
        seen[d] = 1;
        queue.push(d);
      }
    }
  }
  return false;
}

/** Escapability of the map centre after each wave has landed, waves 1..`upTo`. */
function escapableByWave(seed: number, upTo: number): boolean[] {
  const world = createWorld({ seed, players: EIGHT });
  const out: boolean[] = [];
  for (let n = 1; n <= upTo; n++) {
    // Coarse dt: the sim is dt-parametric and with no input only the wave
    // metronome moves, so this settles the field without running a match.
    while (world.match.wavesSpawned < n) step(world, [], 1);
    out.push(centreCanEscape(world));
  }
  return out;
}

// Includes seed 15 — the seed the standing wedge gate failed on, and the one
// every measurement in the defect report is anchored to. The rest spread the
// draw; the taper is uniform per wave, so a handful of seeds is a real sample.
const SEEDS = [1, 7, 15, 23, 42];

describe('commons waves: reachability of the map centre', () => {
  it('leaves the centre escapable after every wave', () => {
    for (const seed of SEEDS) {
      const byWave = escapableByWave(seed, WAVE_COUNT);
      expect(
        byWave,
        `seed ${seed}: a ship at the map centre must have a route out after EVERY ` +
          `wave, and after wave ${byWave.indexOf(false) + 1} it does not ` +
          `(got ${JSON.stringify(byWave)} for waves 1..${WAVE_COUNT}).\n` +
          `This is the entombment trap coming back (docs/wave-commons-entombment.md). ` +
          `The two things holding it open are WAVE.lastRadiusFraction — the final ring ` +
          `needs a circumference to spend — and ringSizeScale in waves.ts, which shrinks ` +
          `a wave's rocks when its own ring cannot carry them. Check both before ` +
          `anything else; lowering the first or raising WAVE.ringCorridorAllowance ` +
          `re-seals the centre.\n` +
          `Note this check is deliberately blind to cell SIZE: it asks whether the ship ` +
          `can get OUT, not whether it has room to move, so a bigger sealed pocket does ` +
          `not satisfy it and neither does a green tests/harness/unstuck.test.ts.`,
      ).toEqual(new Array(WAVE_COUNT).fill(true));
    }
  });
});
