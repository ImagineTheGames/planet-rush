/**
 * tests/net/online-orders.test.ts — can an online player BUY anything? OWNER:
 * Netcode Engineer (GDD §2.5, §4.2; M10 QA "the wire refuses verbs the game
 * speaks").
 *
 * The regression this pins is not subtle and it was not visible: `parseActions`
 * switched on five verbs with `default: return null`. `upgradeOrder` was not one
 * of them, and `BUILD_ITEMS` was `[turret, shield, repair, bank]` — no
 * `satellite`. So in an online match a player could buy **no ship upgrade at all**
 * and build **no radar satellite**, and because one unrecognized action rejected
 * the whole message, the tick they tried it on also lost their thrust, aim and
 * fire. Nothing errored. The button simply did nothing, forever.
 *
 * `tests/net/satellite-visibility.test.ts` proves a satellite *reaches* both
 * clients — but it puts the build job on the server by hand, so it never touches
 * the wire and could not have caught this. This file orders both purchases the
 * way a player does: `sendInput` on the client, through `WebSocketTransport`, the
 * real codec, `MatchServer`'s front door, the input queue, and `step()`. Nothing
 * below the wire is mocked.
 *
 * What it records, end to end:
 *
 *  - **A weapon upgrade bought online is bought.** The order crosses the socket,
 *    the server charges the wallet and writes the tier, and the tier comes back
 *    down the economy channel — so the *client's* ship carries it. That is the
 *    shot colour: `src/render/index.ts` `shotTier()` tints a ship shot by exactly
 *    `world.ships[owner].tiers[UpgradeTrack.Power]`, read off this world.
 *  - **A satellite built online is born, and both clients see it.** The order
 *    crosses the same socket, the station takes the job, and the finished body
 *    arrives on the entity-event stream at the owner *and* at the rival who has
 *    to be able to hunt it (feature f1).
 *  - **The wallet moved.** Both purchases are charged, so "it worked" cannot mean
 *    "the order was quietly ignored and nothing was spent".
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ShipClass, UpgradeTrack } from '@shared/types';
import type { Action, PlayerId } from '@shared/types';
import { SATELLITE, ledgerAdd, nextUpgradeCost } from '../../src/sim';
import type { World } from '../../src/sim';
import { createOnlineSession } from '../../src/net/session';
import type { OnlineSession } from '../../src/net/session';
import { nodeWebSocket, startMatchServer, until } from './node-websocket';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Enough ore in the bank to afford both purchases with room to spare — a mining
 *  montage is not what is under test here. Added through the ledger, so the
 *  world's ore accounting stays coherent (`src/sim/ore-ledger`). */
const STAKE = 40;

function shipOf(world: World, id: PlayerId): World['ships'][number] {
  const ship = world.ships.find((s) => s.id === id);
  if (!ship) throw new Error(`no ship ${id}`);
  return ship;
}

/** Satellites standing at seat `seat`'s station, or -1 when that world has no
 *  such station (a different failure entirely). */
function satelliteCount(world: World | null, seat: PlayerId): number {
  const station = world?.stations.find((s) => s.owner === seat);
  if (!station) return -1;
  return station.satellites?.length ?? 0;
}

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

describe('buying things in an online match', () => {
  it('buys a weapon upgrade and builds a satellite over a real socket', async () => {
    const harness = await startMatchServer({ seed: 4242, slots: 2, asteroidCount: 10 });
    const sessions: OnlineSession[] = [];
    let pump: ReturnType<typeof setInterval> | null = null;
    cleanup = async (): Promise<void> => {
      if (pump) clearInterval(pump);
      for (const session of sessions) session.close();
      await harness.stop();
    };

    // --- Two clients, one room, one match ----------------------------------
    const alice = createOnlineSession({
      url: harness.url,
      room: 'BUYIT',
      shipClass: ShipClass.Interceptor,
      transport: { connect: nodeWebSocket },
    });
    sessions.push(alice);
    await until('alice to be seated', () => harness.matches.room('BUYIT') !== undefined);

    const bob = createOnlineSession({
      url: harness.url,
      room: 'BUYIT',
      shipClass: ShipClass.Hauler,
      transport: { connect: nodeWebSocket },
    });
    sessions.push(bob);
    const room = harness.matches.room('BUYIT');
    if (!room) throw new Error('the room was never created');
    await until('both seats to be filled', () => room.humanCount === 2);

    alice.startMatch();
    await until('both clients to have a world', () => alice.world !== null && bob.world !== null);

    const authority = room.world;
    if (!authority) throw new Error('the room never started its match');
    const aliceShip = shipOf(authority, 0);
    const station = authority.stations.find((s) => s.owner === 0);
    if (!station) throw new Error("no station for alice's seat");

    // Ships spawn docked at their own station, which is the one precondition both
    // purchases share — assert it rather than assume it, so a future spawn change
    // makes this test say "not docked" instead of "the wire is broken".
    expect(Math.hypot(aliceShip.pos.x - station.pos.x, aliceShip.pos.y - station.pos.y)).toBeLessThan(160);

    // Stake the wallet. The economy channel carries it down to alice's client on
    // the next change (`server/room.ts` syncEconomy), so her prediction agrees
    // with authority about what she can afford.
    const upgradeCost = nextUpgradeCost(aliceShip, UpgradeTrack.Power);
    if (upgradeCost === null) throw new Error('DAMAGE is already maxed at spawn');
    ledgerAdd(authority, 'mined', STAKE);
    aliceShip.banked += STAKE;
    const wallet = aliceShip.banked;

    // --- The player's hands: a 60 Hz input loop that carries one-shot orders --
    // Drained on send, so a wheel confirmation goes out on exactly one tick —
    // which is what a one-shot order is, and what makes "charged once" testable.
    let pending: readonly Action[] = [];
    pump = setInterval(() => {
      const actions = pending;
      pending = [];
      alice.sendInput(actions);
      bob.sendInput([]);
    }, 1000 / 60);

    await sleep(250); // let the stake reach the client
    // The baseline everything below moves off: no tier, no satellite, on the
    // server and on both clients.
    expect(aliceShip.tiers[UpgradeTrack.Power]).toBe(0);
    expect(shipOf(alice.world!, 0).tiers[UpgradeTrack.Power]).toBe(0);
    expect(satelliteCount(authority, 0)).toBe(0);
    expect(satelliteCount(bob.world, 0)).toBe(0);

    // --- 1. Buy a weapon upgrade, online ------------------------------------
    // This is the verb the wire did not speak. One press, one tick.
    pending = [{ type: 'upgradeOrder', track: UpgradeTrack.Power }];
    await until(
      'the server to write the DAMAGE tier the client bought',
      () => aliceShip.tiers[UpgradeTrack.Power] === 1,
    );
    // Charged, not merely acknowledged.
    expect(aliceShip.banked).toBeCloseTo(wallet - upgradeCost, 6);

    await sleep(400); // the economy channel's trip home
    // THE VISIBLE PROOF: the tier is on the *client's* ship, which is the exact
    // expression the DAMAGE ramp reads to tint a shot
    // (`src/render/index.ts` shotTier → `owner.tiers[UpgradeTrack.Power]`).
    // Before the fix this stayed 0 for the whole match, in every online game.
    expect(shipOf(alice.world!, 0).tiers[UpgradeTrack.Power]).toBe(1);
    // Bought once, not once per replayed tick: prediction replays pending input
    // every frame until it is acknowledged, and a one-shot order that re-charged
    // on each replay would show up here as tier 2+.
    expect(aliceShip.tiers[UpgradeTrack.Power]).toBe(1);

    // --- 2. Build a satellite, online ---------------------------------------
    const afterUpgrade = aliceShip.banked;
    pending = [{ type: 'buildOrder', item: 'satellite' }];
    await until(
      'the station to take the satellite order off the wire',
      () => station.builds.some((job) => job.kind === 'satellite'),
    );
    expect(aliceShip.banked).toBeCloseTo(afterUpgrade - SATELLITE.cost, 6);

    // The wire is what this test is about; the 12 s construction clock is the
    // feature's business (`SATELLITE.buildTime`). Wind the accepted job down so
    // the test does not sit out a real build.
    for (const job of station.builds) if (job.kind === 'satellite') job.remaining = 1 / 60;
    await until('the server to finish building it', () => satelliteCount(authority, 0) === 1);

    await sleep(600); // several of the entity stream's 10 Hz intervals
    // The owner sees the satellite she paid for…
    expect(satelliteCount(alice.world, 0)).toBe(1);
    // …and so does the rival who has to be able to shoot it (feature f1).
    expect(satelliteCount(bob.world, 0)).toBe(1);
    // And it is the server's satellite, not a hopeful client-side ghost.
    const serverSat = station.satellites?.[0];
    const bobSat = bob.world?.stations.find((s) => s.owner === 0)?.satellites?.[0];
    if (!serverSat || !bobSat) throw new Error('the satellite went missing mid-test');
    expect(bobSat.id).toBe(serverSat.id);
    expect(bobSat.owner).toBe(0);
  }, 30_000);
});
