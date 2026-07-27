/**
 * tests/harness/unstuck.test.ts — the standing "no bot stays wedged" invariant.
 * OWNER: Bot Engineer (GDD §2.9; v0.2.2 field report, screenshot #2).
 *
 * The field report photographed a bot pinned motionless against a body for the
 * rest of a match: a *pathing* trap, distinct from the flee/fight flap
 * (`src/bots/commitment.ts`). The fix is three-layered — obstacle-aware steering,
 * a net-progress stuck detector, and an escape run down the open lane
 * (`src/bots/{tree,behaviors,steering}.ts`) — and this file is the layer the
 * field report calls the *class-killer*:
 *
 *   > NO bot with a movement intent stays within R of the same position for more
 *   > than T seconds, entire match, every seed.
 *
 * It is a standing assertion over full shipped-cast matches, so any future
 * regression that re-wedges a bot fails **here**, in CI, instead of reaching the
 * developer's screenshots. Before the fix the worst offender sat wedged for
 * ~120–220 s at full throttle; after it, the worst *transient* — a bot detecting
 * the wedge and running out of it — is ~5 s, so the {@link WEDGE_LIMIT_S} ceiling
 * sits an order of magnitude below the bug and comfortably above honest recovery.
 *
 * "Movement intent" is the bot's own recorded throttle ({@link Brain.lastThrust}
 * ≥ {@link STUCK_THROTTLE}) — the exact definition the recovery logic gates on,
 * so a bot that is *trying* to travel and going nowhere is what trips it, while a
 * miner parked at its rock or a defender holding a ring (low throttle) never does.
 */

import { describe, it, expect } from 'vitest';
import { createWorld } from '../../src/sim';
import type { PlayerSpec, World } from '../../src/sim';
import {
  MATCH_SLOTS,
  PERSONALITIES,
  STUCK_THROTTLE,
  botLobby,
  createBots,
  fillEmptySlots,
  runHeadlessMatch,
} from '../../src/bots';
import type { Bot } from '../../src/bots';

/** How many distinct seeds the standing gate soaks. Each is a full eight-slot
 *  shipped-cast match run to its ending, so the run covers every personality,
 *  every hull, and the late waves that pack the map centre — where the wedge
 *  lived. Kept to a size that stays inside the unit suite's budget while
 *  exercising the tail; the release soak (`harness/soak.ts`) runs far more. */
const SEEDS = 24;

/** "Within R of the same position." A wedged hull grinds inside a handful of
 *  units; a recovering one clears this ring in a fraction of a second. */
const WEDGE_R = 8;

/** "For more than T seconds." An order of magnitude under the field-report bug
 *  and ~2× over the worst honest detect-and-escape transient, so a real wedge
 *  fails loudly and a normal recovery never flakes. */
const WEDGE_LIMIT_S = 12;

/** One live bot found sitting still while asking to move — the failure record. */
interface WedgeReport {
  readonly seed: number;
  readonly id: number;
  readonly personality: string;
  readonly heldS: number;
  readonly behavior: string;
  readonly at: { x: number; y: number };
}

/**
 * Run one shipped-cast match and return the *worst* wedge any bot suffered —
 * the longest a bot stayed inside {@link WEDGE_R} of a fixed anchor while its
 * throttle said it wanted to travel. `null` when no bot ever held still under
 * intent, which is the pass.
 */
function worstWedge(seed: number): WedgeReport | null {
  const seats = fillEmptySlots([], MATCH_SLOTS);
  const players: PlayerSpec[] = botLobby(seats);
  const world: World = createWorld({ seed, players });
  const bots: Bot[] = createBots(seats, { seed });
  const byId = new Map(bots.map((b) => [b.seat.id, b]));
  const persona = new Map(seats.map((s) => [s.id, s.personality]));

  // Per-ship progress anchor, mirroring the bot's own net-progress detector but
  // measured off the *world* position rather than trusting bot internals.
  const anchor = new Map<number, { x: number; y: number; since: number }>();
  let worst: WedgeReport | null = null;

  runHeadlessMatch(world, bots, {
    maxSeconds: 20 * 60,
    onTick: (w: World) => {
      for (const ship of w.ships) {
        if (!ship.alive || ship.eliminated) {
          anchor.delete(ship.id);
          continue;
        }
        // Not asking to travel is station-keeping, not a wedge (GDD §2.9).
        if (byId.get(ship.id)!.brain.lastThrust < STUCK_THROTTLE) {
          anchor.delete(ship.id);
          continue;
        }
        const a = anchor.get(ship.id);
        if (!a) {
          anchor.set(ship.id, { x: ship.pos.x, y: ship.pos.y, since: w.time });
          continue;
        }
        const dx = ship.pos.x - a.x;
        const dy = ship.pos.y - a.y;
        if (dx * dx + dy * dy > WEDGE_R * WEDGE_R) {
          // Real headway: re-anchor here and start the clock over.
          anchor.set(ship.id, { x: ship.pos.x, y: ship.pos.y, since: w.time });
          continue;
        }
        const heldS = w.time - a.since;
        if (worst === null || heldS > worst.heldS) {
          worst = {
            seed,
            id: ship.id,
            personality: PERSONALITIES[persona.get(ship.id)!].id,
            heldS,
            behavior: byId.get(ship.id)!.brain.lastBehavior,
            at: { x: ship.pos.x, y: ship.pos.y },
          };
        }
      }
    },
  });

  return worst;
}

describe('no bot stays wedged, every seed (v0.2.2 field report §3)', () => {
  it(`keeps every bot under ${WEDGE_LIMIT_S}s pinned across ${SEEDS} shipped-cast matches`, () => {
    let globalWorst: WedgeReport | null = null;
    const failures: WedgeReport[] = [];

    for (let seed = 1; seed <= SEEDS; seed++) {
      const w = worstWedge(seed);
      if (w === null) continue;
      if (globalWorst === null || w.heldS > globalWorst.heldS) globalWorst = w;
      if (w.heldS > WEDGE_LIMIT_S) failures.push(w);
    }

    const describe1 = (r: WedgeReport): string =>
      `seed ${r.seed}: ${r.personality} (slot ${r.id}) wedged ${r.heldS.toFixed(1)}s ` +
      `at (${r.at.x.toFixed(0)},${r.at.y.toFixed(0)}) while '${r.behavior}'`;

    expect(
      failures.length,
      failures.length === 0
        ? ''
        : `bots wedged past ${WEDGE_LIMIT_S}s (a pathing trap — see the field report):\n  ` +
            failures.map(describe1).join('\n  '),
    ).toBe(0);

    // Even the worst *transient* must sit well under the ceiling — a canary that
    // fails before a slow regression creeps up to the hard limit.
    if (globalWorst !== null) {
      expect(globalWorst.heldS, `worst transient wedge: ${describe1(globalWorst)}`).toBeLessThan(
        WEDGE_LIMIT_S,
      );
    }
  }, 120000);
});
