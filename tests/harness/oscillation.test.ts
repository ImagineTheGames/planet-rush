/**
 * tests/harness/oscillation.test.ts — the standing "no bot re-litigates a goal
 * forever" invariant. OWNER: Bot Engineer (p11 field report).
 *
 * A third pathology, distinct from the two the trees already guard:
 *
 *  - the **flee/fight flap** is a *state* flip — two behaviors toggling on one
 *    shared boundary — killed by hysteresis (`src/bots/commitment.ts`);
 *  - the **wedge** is *stillness* — a hull pinned against a body at full throttle,
 *    going nowhere — killed by the net-progress stuck detector and escape run,
 *    and gated here: `tests/harness/unstuck.test.ts`;
 *  - the **oscillation** is *movement without progress* — a bot re-choosing the
 *    same unreachable goal, ping-ponging toward it and away, "back and forth …
 *    there were other places to mine." Position variance is high, so the wedge
 *    gate never sees it; the states alternate legitimately, so the hysteresis
 *    never sees it. This is the gate that does.
 *
 * The observable, mirroring `unstuck.test.ts`'s discipline of measuring off the
 * *world* rather than trusting bot internals for the verdict: a bot's committed
 * mine site (`Brain.mineSite`) and its throttle (`Brain.lastThrust`) name *what*
 * it is trying to reach and *whether* it is trying to travel; the world says
 * *where the rock is* and *where the ship is*. A bot that keeps *choosing to
 * mine* one site, with travel intent, for {@link OSC_WINDOW_S} seconds and never
 * once closes to mining range of it is not mining — it is oscillating, and the
 * fix (`src/bots/targeting.ts` threat-aware scoring + the contested-site tabu) is
 * exactly what keeps that from happening: a broken-off approach cools the site,
 * so the next decision commits to a *different* instance and the run resets.
 *
 * An engagement is anchored to *actually choosing to mine*: it opens on a `mine`
 * decision and the flee ticks that punctuate the ping-pong ride along with it,
 * but it closes the moment the bot stops coming back to mine that rock for
 * {@link MINE_GAP} seconds. That is the difference between the pathology (mine →
 * flee → mine → flee, forever, on one rock) and a bot that simply mined a rock
 * once and then spent a long stretch fleeing or defending with `mineSite` left
 * pointing at yesterday's rock — the latter is not oscillation and must not read
 * as it. Measured across the whole shipped cast, the honest worst is ~13s; the
 * window sits well over it and an order of magnitude under the bug.
 *
 * Runs the shipped cast, every seed, whole matches — so a regression that unhooks
 * the tabu or the path scoring fails **here**, in CI, not on the developer's
 * screen.
 */

import { describe, it, expect } from 'vitest';
import { createWorld } from '../../src/sim';
import type { PlayerSpec, World } from '../../src/sim';
import { MINE_STANDOFF } from '../../src/bots/behaviors';
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

/** How many seeds the gate soaks. Each is a full eight-slot shipped-cast match
 *  to its ending — every personality, every hull, and the packed late waves
 *  where a contested rock and a fear on its approach actually co-occur. Sized to
 *  the unit suite's budget, like `unstuck.test.ts`. */
const SEEDS = 24;

/**
 * How long a bot may hold one mine site, with travel intent, before it has to
 * have reached mining range of it. An honest approach — even a slow Hauler
 * crossing the field, even one that detours around a late-wave cluster — closes
 * in a handful of seconds; the tabu resets the commitment the moment a threat
 * turns the bot back, so no *honest* run on a single instance lasts this long.
 * An order of magnitude under a "back and forth for the rest of the match" bug
 * and comfortably over the longest good-faith approach. TUNABLE
 */
const OSC_WINDOW_S = 30;

/**
 * The longest a bot may go *without returning to a `mine` decision* on a site
 * before its engagement is considered closed. Longer than one flee-and-return of
 * the ping-pong (a break-off holds for a couple of seconds before the bot heads
 * back at the rock), short enough that a bot which mined a rock once and then
 * spent half a minute fleeing near home — `mineSite` stale, never coming back to
 * mine — does not read as one long mining commitment it was never making. TUNABLE
 */
const MINE_GAP_S = 8;

/**
 * Distance to the committed rock that counts as *arrived* — reached mining
 * range, so this commitment is being honoured, not oscillated. A shade over the
 * standoff a miner parks at ({@link MINE_STANDOFF}, measured to the rock centre):
 * once a bot gets this close it is mining, and the run is exonerated for good.
 */
const OSC_ARRIVE = MINE_STANDOFF + 40;

/** One bot caught holding a mine site it never reaches — the failure record. */
interface OscReport {
  readonly seed: number;
  readonly id: number;
  readonly personality: string;
  readonly site: number;
  readonly heldS: number;
  readonly closest: number;
  readonly behavior: string;
}

/** A live commitment to one rock instance: when it started, the closest the ship
 *  has come to the rock since, and when it last actually *chose to mine* it —
 *  the recency that keeps a stale flee from masquerading as a mining run. */
interface Commitment {
  site: number;
  startT: number;
  closest: number;
  lastMineT: number;
}

/**
 * Run one shipped-cast match and return the *worst* oscillation any bot suffered
 * — the longest a bot held a single mine site, under travel intent, without ever
 * closing to {@link OSC_ARRIVE} of it. `null` when no bot ever did, which is the
 * pass.
 *
 * A commitment is keyed on the rock id the bot's tree chose (`Brain.mineSite`),
 * and it survives the flee ticks in between — those keep `mineSite` set while the
 * bot backs off — which is the whole point: the ping-pong is one persistent
 * commitment to an unreachable rock, not many short ones. It resets only when the
 * bot commits to a *different* instance (the tabu working), the rock is gone, or
 * the bot switches to a plainly unrelated goal.
 */
function worstOscillation(seed: number): OscReport | null {
  const seats = fillEmptySlots([], MATCH_SLOTS);
  const players: PlayerSpec[] = botLobby(seats);
  const world: World = createWorld({ seed, players });
  const bots: Bot[] = createBots(seats, { seed });
  const byId = new Map(bots.map((b) => [b.seat.id, b]));
  const persona = new Map(seats.map((s) => [s.id, s.personality]));

  const live = new Map<number, Commitment>();
  let worst: OscReport | null = null;

  runHeadlessMatch(world, bots, {
    maxSeconds: 20 * 60,
    onTick: (w: World) => {
      // Rock positions this tick, by id — the world's own truth for "where the
      // committed rock is". Rebuilt per tick; the field is small.
      const rockPos = new Map<number, { x: number; y: number }>();
      for (const a of w.asteroids) rockPos.set(a.id, a.pos);

      for (const ship of w.ships) {
        const brain = byId.get(ship.id)!.brain;
        const site = brain.mineSite;
        const rock = site >= 0 ? rockPos.get(site) : undefined;
        const behavior = brain.lastBehavior;

        // No committed, still-existing rock — or a genuinely different goal, not
        // a flee interruption (a flee keeps `mineSite` set; `retreat`/`mine` are
        // the two faces of the ping-pong). Anything else means the bot moved on:
        // drop the commitment.
        const engaged =
          ship.alive &&
          !ship.eliminated &&
          rock !== undefined &&
          (behavior === 'mine' || behavior === 'retreat');
        if (!engaged) {
          live.delete(ship.id);
          continue;
        }

        const dx = ship.pos.x - rock!.x;
        const dy = ship.pos.y - rock!.y;
        const d = Math.sqrt(dx * dx + dy * dy);

        let c = live.get(ship.id);
        if (!c || c.site !== site) {
          // Only *actually choosing to mine* opens an engagement — a lone flee
          // with a stale `mineSite` is not a mining run. A retreat that finds no
          // matching commitment is just a bot fleeing; leave it uncommitted.
          if (behavior !== 'mine') {
            live.delete(ship.id);
            continue;
          }
          c = { site, startT: w.time, closest: d, lastMineT: w.time };
          live.set(ship.id, c);
        } else {
          if (d < c.closest) c.closest = d;
          if (behavior === 'mine') c.lastMineT = w.time;
          // Stopped coming back to mine this rock: the ping-pong is over (the bot
          // is off doing something else, or fleeing for good). Not oscillation.
          if (w.time - c.lastMineT > MINE_GAP_S) {
            live.delete(ship.id);
            continue;
          }
        }

        // Only a bot that is *trying to travel* can be failing to travel — a
        // parked miner (low throttle) that has already reached its rock is not
        // oscillating, exactly as the wedge gate excludes station-keeping.
        if (brain.lastThrust < STUCK_THROTTLE) continue;
        if (c.closest <= OSC_ARRIVE) continue; // arrived at some point — exonerated

        const heldS = w.time - c.startT;
        if (heldS >= OSC_WINDOW_S && (worst === null || heldS > worst.heldS)) {
          worst = {
            seed,
            id: ship.id,
            personality: PERSONALITIES[persona.get(ship.id)!].id,
            site,
            heldS,
            closest: c.closest,
            behavior,
          };
        }
      }
    },
  });

  return worst;
}

describe('no bot oscillates on an unreachable goal, every seed (p11 field report)', () => {
  it(`keeps every mining commitment under ${OSC_WINDOW_S}s-without-arrival across ${SEEDS} shipped-cast matches`, () => {
    let globalWorst: OscReport | null = null;
    const failures: OscReport[] = [];

    for (let seed = 1; seed <= SEEDS; seed++) {
      const w = worstOscillation(seed);
      if (w === null) continue;
      if (globalWorst === null || w.heldS > globalWorst.heldS) globalWorst = w;
      failures.push(w);
    }

    const describe1 = (r: OscReport): string =>
      `seed ${r.seed}: ${r.personality} (slot ${r.id}) held rock ${r.site} for ${r.heldS.toFixed(1)}s ` +
      `never closer than ${r.closest.toFixed(0)}u while '${r.behavior}'`;

    expect(
      failures.length,
      failures.length === 0
        ? ''
        : `bots re-litigated a mine site past ${OSC_WINDOW_S}s without reaching it ` +
            `(the p11 oscillation — a threat on the path and other fields open):\n  ` +
            failures.map(describe1).join('\n  '),
    ).toBe(0);
  }, 120000);
});
