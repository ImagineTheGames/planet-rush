/**
 * src/sim/waves.test.ts — the commons wave field: is the map centre reachable?
 * OWNER: Gameplay Engineer.
 *
 * `waves.ts` places every commons asteroid and had no test file of its own; the
 * only coverage was `match.test.ts` §4, which pins CONTAINMENT (each wave lands
 * inside its own shrinking disc) and says nothing about PASSABILITY. This file
 * pins passability, because the build has a live defect there.
 *
 * ## What this file pins, and why it asserts a defect on purpose
 *
 * The late commons waves seal the map centre: a ship at the centre when wave 4
 * lands cannot leave, by any route, for the rest of the match. That is measured,
 * structural, and currently SHIPPED — see `docs/wave-commons-entombment.md` for
 * the geometry (wave 5's ring is 3.66x oversubscribed with rock, so no placement
 * fix exists) and `docs/gdd-conformance.md` §7 Q-6 for the decision it is
 * waiting on. Fixing it means changing late-wave rock size or count, which is a
 * balance call this lane cannot make unilaterally.
 *
 * So this is a CHARACTERISATION test: it asserts what the build does today, not
 * what it should do. If it goes red because the centre is now escapable, that is
 * probably GOOD NEWS — someone fixed the trap. Update this file, the defect
 * report, and Q-6 together; do not "repair" the test in isolation.
 *
 * ## Why it measures reachability rather than reusing the wedge gate
 *
 * `tests/harness/unstuck.test.ts` is the only other instrument that sees this
 * defect, and it sees it by accident: it flags a bot that stays within
 * `WEDGE_R = 8` of one spot while asking to travel. That is a proxy, and it
 * under-reports the trap in two ways this file does not.
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
 * ## This file has no dependence on the a0-59 branch it was written on
 *
 * It steps the world with no inputs, so no ship ever dies and
 * `DEATH_ORE_DROP_FRACTION` — the whole of a0-59 — never executes. Verified, not
 * assumed: checked out into a detached worktree at `origin/main` it typechecks
 * clean and passes with the identical verdicts (`npx vitest run src/sim` →
 * 376/376). It is green on `main` *because it characterises a defect `main` has*.
 * Cherry-pick it out whenever the trap is briefed; it does not need PR #436.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import { createWorld, step } from './index';
import { SHIP_RADIUS } from './constants';
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

// Includes seed 15 — the seed the standing wedge gate fails on, and the one
// every measurement in the defect report is anchored to.
const SEEDS = [1, 15, 42];

describe('commons waves: reachability of the map centre', () => {
  it('leaves the centre escapable through wave 3', () => {
    for (const seed of SEEDS) {
      const byWave = escapableByWave(seed, 3);
      expect(
        byWave,
        `seed ${seed}: the centre should still have a route out through wave 3 ` +
          `(got ${JSON.stringify(byWave)}). If this is red, the trap has moved EARLIER ` +
          `than wave 4 — re-measure docs/wave-commons-entombment.md before anything else.`,
      ).toEqual([true, true, true]);
    }
  });

  it('seals the centre from wave 4 onward — KNOWN DEFECT, see docs/wave-commons-entombment.md', () => {
    for (const seed of SEEDS) {
      const byWave = escapableByWave(seed, 5);
      expect(
        byWave.slice(3),
        `seed ${seed}: expected the map centre to be SEALED after waves 4 and 5 ` +
          `(got ${JSON.stringify(byWave)} for waves 1..5).\n` +
          `If the centre is escapable again, the entombment defect may be FIXED — that is ` +
          `good news, not a broken test. Update this expectation, docs/wave-commons-entombment.md, ` +
          `and Q-6 in docs/gdd-conformance.md together.\n` +
          `If instead you widened the eye or the spoke gap and the wedge gate went green, ` +
          `note that this check is deliberately blind to cell SIZE: a bigger sealed pocket ` +
          `is not an exit.`,
      ).toEqual([false, false]);
    }
  });
});
