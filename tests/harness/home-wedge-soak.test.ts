/**
 * tests/harness/home-wedge-soak.test.ts — the no-wedge invariant, extended to
 * HOME states. OWNER: Gameplay Engineer (developer report p14).
 *
 * The standing wedge gate (`tests/harness/unstuck.test.ts`) keys off the bot's
 * own throttle: a ship *asking to travel* (`lastThrust >= STUCK_THROTTLE`) that
 * goes nowhere trips it. That definition, by design, EXEMPTS a low-throttle ship
 * as deliberate station-keeping — and that is exactly the blind spot the p14
 * report fell into. A home-bound bot decelerating onto its own station (defend
 * post, deposit approach, repair park) reports a LOW throttle: it thinks it has
 * arrived. So the throttle gate never sees it grind into its own station's rim
 * and sit there — the screenshot.
 *
 * This gate closes that hole by measuring off the SIM's ground truth instead of
 * the bot's intent: for EVERY ship, in EVERY state including home ones, sustained
 * CONTACT with any solid body (a station — own or enemy — or an asteroid) while
 * ground to near-stillness is a failure, whatever the throttle says. "At home" is
 * not exempt from "doing something". The physics floor (`reflectOffCircle`,
 * `WEDGE_SLIDE_*`) is what keeps this green: a ship pressed into a body and
 * stilled by it earns a tangential slide off the rim, so it can never rack up
 * sustained motionless contact — the invariant this file asserts, over full
 * shipped-cast matches, every seed, so a regression that removes the floor fails
 * HERE in CI instead of in a developer's screenshot.
 */

import { describe, it, expect } from 'vitest';
import { createWorld } from '../../src/sim';
import { SHIP_RADIUS } from '../../src/sim';
import type { PlayerSpec, World } from '../../src/sim';
import {
  MATCH_SLOTS,
  PERSONALITIES,
  botLobby,
  createBots,
  fillEmptySlots,
  runHeadlessMatch,
} from '../../src/bots';
import type { Bot } from '../../src/bots';

/** Full eight-slot matches soaked. Each runs to its ending across every
 *  personality and hull and into the late waves that pack the map centre and
 *  drive damaged bots home — where the home-rim wedge lived. */
const SEEDS = 16;

/** "In contact." A ship whose hull surface is within this of a body's surface is
 *  grinding it, not passing it — the separation the collision response leaves a
 *  pressed-in hull sitting at (touching, plus a hair for the push-out). */
const CONTACT_SLOP = 4;

/** "Ground to near-stillness." A dead pin creeps at a few u/s; the escape-hatch
 *  slide runs several times this. Set cleanly between the two so a genuine pin
 *  trips and a ship sliding off the rim (doing something) does not. */
const STILL_SPEED = 30;

/** "For more than T seconds." The floor clears a pin in a fraction of a second;
 *  this sits an order of magnitude above honest recovery and half the throttle
 *  gate's ceiling, so a real home-rim pin fails loudly and nothing else flakes. */
const PIN_LIMIT_S = 6;

interface PinReport {
  readonly seed: number;
  readonly id: number;
  readonly personality: string;
  readonly heldS: number;
  readonly body: string;
  readonly at: { x: number; y: number };
}

/** The bodies a ship can collide with (GDD §4.1): stations and asteroids. Turrets
 *  and satellites are not colliders, so they cannot wedge a hull. */
function nearestContact(
  ship: { pos: { x: number; y: number }; radius: number },
  w: World,
): { body: string; surfaceGap: number } | null {
  let best: { body: string; surfaceGap: number } | null = null;
  const consider = (bodyR: number, cx: number, cy: number, label: string): void => {
    const gap = Math.hypot(ship.pos.x - cx, ship.pos.y - cy) - bodyR - ship.radius;
    if (gap <= CONTACT_SLOP && (best === null || gap < best.surfaceGap)) best = { body: label, surfaceGap: gap };
  };
  for (const st of w.stations) consider(st.radius, st.pos.x, st.pos.y, `station#${st.owner}`);
  for (const a of w.asteroids) consider(a.radius, a.pos.x, a.pos.y, `rock#${a.id}`);
  return best;
}

/** Run one shipped-cast match and return the worst motionless-contact any ship
 *  suffered: the longest it stayed in contact with a body while near-still,
 *  regardless of what its throttle claimed. `null` == no ship ever pinned (pass). */
function worstPin(seed: number): PinReport | null {
  const seats = fillEmptySlots([], MATCH_SLOTS);
  const players: PlayerSpec[] = botLobby(seats);
  const world: World = createWorld({ seed, players });
  const bots: Bot[] = createBots(seats, { seed });
  const persona = new Map(seats.map((s) => [s.id, s.personality]));

  // Per-ship pin clock: how long it has held motionless contact. Reset the moment
  // it breaks contact OR gets moving — either is "doing something".
  const pin = new Map<number, { since: number; body: string }>();
  let worst: PinReport | null = null;

  runHeadlessMatch(world, bots, {
    maxSeconds: 20 * 60,
    onTick: (w: World) => {
      for (const ship of w.ships) {
        if (!ship.alive || ship.eliminated) {
          pin.delete(ship.id);
          continue;
        }
        const contact = nearestContact({ pos: ship.pos, radius: ship.radius ?? SHIP_RADIUS }, w);
        const still = Math.hypot(ship.vel.x, ship.vel.y) < STILL_SPEED;
        if (contact === null || !still) {
          pin.delete(ship.id);
          continue;
        }
        const p = pin.get(ship.id);
        if (!p) {
          pin.set(ship.id, { since: w.time, body: contact.body });
          continue;
        }
        const heldS = w.time - p.since;
        if (worst === null || heldS > worst.heldS) {
          worst = {
            seed,
            id: ship.id,
            personality: PERSONALITIES[persona.get(ship.id)!].id,
            heldS,
            body: p.body,
            at: { x: ship.pos.x, y: ship.pos.y },
          };
        }
      }
    },
  });

  return worst;
}

describe('no ship stays pinned motionless against a body, HOME states included (p14)', () => {
  it(`keeps every ship under ${PIN_LIMIT_S}s of motionless contact across ${SEEDS} matches`, () => {
    let globalWorst: PinReport | null = null;
    const failures: PinReport[] = [];

    for (let seed = 1; seed <= SEEDS; seed++) {
      const w = worstPin(seed);
      if (w === null) continue;
      if (globalWorst === null || w.heldS > globalWorst.heldS) globalWorst = w;
      if (w.heldS > PIN_LIMIT_S) failures.push(w);
    }

    const describe1 = (r: PinReport): string =>
      `seed ${r.seed}: ${r.personality} (slot ${r.id}) pinned ${r.heldS.toFixed(1)}s ` +
      `on ${r.body} at (${r.at.x.toFixed(0)},${r.at.y.toFixed(0)})`;

    // Soak summary (pasted in the PR): the single worst motionless-contact seen.
    // eslint-disable-next-line no-console
    console.log(
      `[home-wedge soak] ${SEEDS} matches, limit ${PIN_LIMIT_S}s — worst transient: ` +
        (globalWorst === null ? 'none (no ship ever pinned)' : describe1(globalWorst)),
    );

    expect(
      failures.length,
      failures.length === 0
        ? ''
        : `ships pinned motionless past ${PIN_LIMIT_S}s (a home-rim wedge — see report p14):\n  ` +
            failures.map(describe1).join('\n  '),
    ).toBe(0);

    // Canary: even the worst transient contact must sit well under the ceiling,
    // so a slow regression trips before it reaches the hard limit.
    if (globalWorst !== null) {
      expect(globalWorst.heldS, `worst transient: ${describe1(globalWorst)}`).toBeLessThan(PIN_LIMIT_S);
    }
  }, 120000);
});
