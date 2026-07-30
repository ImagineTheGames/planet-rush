/**
 * src/net/hull-authority.test.ts — health never goes down and then back up.
 * OWNER: Netcode Engineer (GDD §2.2, §4.2; M10 action-echo).
 *
 * *"My health went down then back up after taking damage."*
 *
 * That is prediction working exactly as designed, on the one quantity it must not
 * touch. The client runs the same `step()` the server runs, and `step()` resolves
 * collisions — so a shot the client can see arriving takes HP off the local hull
 * the frame it lands. The next snapshot then states the hull the server actually
 * has, read one round trip earlier, before that shot resolved, and the bar pops back
 * up. Thirty times a second, for the length of the exchange.
 *
 * The rule this file holds: **hull is authority's**, written by the snapshot,
 * re-asserted after every predicted tick and every replay, never moved by anything
 * local. There is no correction to blend because there is no local guess to correct.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import type { Action, PlayerId } from '@shared/types';
import { createWorld } from '../sim';
import type { World, WorldConfig } from '../sim';
import { PredictedMatch } from './prediction';
import { decodeSnapshot, encodeWorldSnapshot } from './snapshot';
import type { DecodedSnapshot } from './snapshot';

const LOCAL: PlayerId = 0;
const RIVAL: PlayerId = 1;

const MATCH: WorldConfig = {
  seed: 21,
  players: [
    { id: 0, shipClass: ShipClass.Vanguard },
    { id: 1, shipClass: ShipClass.Interceptor },
  ],
  asteroidCount: 4,
};

const THRUST: readonly Action[] = [{ type: 'thrust', dir: { x: 1, y: 0 } }];

/** A snapshot stating each seat's hull, stamped for `tick` — built by encoding a
 *  scratch world so it goes through the real codec, quantization and all. */
function hullSnapshot(tick: number, hulls: Record<number, number>): DecodedSnapshot {
  const scratch = createWorld(MATCH);
  scratch.tick = tick;
  for (const ship of scratch.ships) {
    const hull = hulls[ship.id];
    if (hull !== undefined) ship.hull = hull;
  }
  return decodeSnapshot(encodeWorldSnapshot(scratch));
}

function standUp(): { match: PredictedMatch; world: World } {
  const world = createWorld(MATCH);
  return { match: new PredictedMatch({ world, localPlayer: LOCAL }), world };
}

const hullOf = (world: World, id: PlayerId): number => world.ships.find((s) => s.id === id)!.hull;

describe('hull is authority’s', () => {
  it('never moves on a predicted tick — only a snapshot moves it', () => {
    const { match, world } = standUp();
    match.reconcile(hullSnapshot(match.tick, { [LOCAL]: 40, [RIVAL]: 50 }), 0);
    expect(hullOf(world, LOCAL)).toBe(40);

    // A local hit, applied by the client's own `step()`. Whatever the sim decides
    // about it, the *displayed* hull is not the client's to decide.
    world.ships.find((s) => s.id === LOCAL)!.hull = 12;
    match.predict(1, THRUST);
    expect(hullOf(world, LOCAL)).toBe(40);
  });

  it('follows authority DOWN, and never back up in between', () => {
    const { match, world } = standUp();
    const seen: number[] = [];

    // A fight: authority walks the hull down over four snapshots while the client
    // predicts and replays between each one. The reported hull must be monotone —
    // every value the player ever reads is one the server actually stated.
    const authority = [50, 44, 44, 31, 20];
    for (let i = 0; i < authority.length; i++) {
      match.reconcile(hullSnapshot(match.tick, { [LOCAL]: authority[i]! }), i);
      seen.push(hullOf(world, LOCAL));
      for (let t = 0; t < 3; t++) {
        // Between snapshots the client keeps predicting — and a local collision
        // resolution takes a bite out of the hull on the way through.
        world.ships.find((s) => s.id === LOCAL)!.hull -= 5;
        match.predict(i * 4 + t + 1, THRUST);
        seen.push(hullOf(world, LOCAL));
      }
    }

    expect(seen).toEqual([50, 50, 50, 50, 44, 44, 44, 44, 44, 44, 44, 44, 31, 31, 31, 31, 20, 20, 20, 20]);
    // The property, stated as the player would: it never went back up.
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeLessThanOrEqual(seen[i - 1]!);
  });

  it('goes back up when authority says so — a respawn is a real heal', () => {
    const { match, world } = standUp();
    match.reconcile(hullSnapshot(match.tick, { [LOCAL]: 8 }), 0);
    expect(hullOf(world, LOCAL)).toBe(8);

    // Free and fast, upgrades intact (GDD §2.7). The bar refilling here is the
    // truth, and the rule was never "hull only falls" — it was "hull is authority's".
    match.reconcile(hullSnapshot(match.tick + 1, { [LOCAL]: 50 }), 1);
    expect(hullOf(world, LOCAL)).toBe(50);
  });

  it('holds every OTHER ship’s hull at authority’s word too', () => {
    const { match, world } = standUp();
    match.reconcile(hullSnapshot(match.tick, { [LOCAL]: 50, [RIVAL]: 30 }), 0);
    // A rival's bar floats over their hull for everyone to read (GDD §2.2), and the
    // client has even less business guessing at theirs than at its own.
    world.ships.find((s) => s.id === RIVAL)!.hull = 3;
    match.predict(1, THRUST);
    expect(hullOf(world, RIVAL)).toBe(30);
  });

  it('leaves a ship alone until authority has said anything at all', () => {
    const { match, world } = standUp();
    const spawn = hullOf(world, LOCAL);
    match.predict(1, THRUST);
    // No snapshot yet: the spawn hull is the best answer there is, and inventing a
    // zero would be worse than waiting one broadcast interval.
    expect(hullOf(world, LOCAL)).toBe(spawn);
  });
});
