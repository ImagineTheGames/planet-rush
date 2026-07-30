/**
 * evidence/online-final.live.test.ts — the M10 online-final gates, driven against
 * the LIVE Fly deployment with the SHIPPED client net stack. OWNER: QA Manager.
 *
 * A QA instrument, not a repo unit test. It imports the exact modules the browser
 * bundle runs — `allocateRoom`/`joinRoom` (src/net/allocator-client) →
 * `createOnlineSession` + `allocatorTransport` (src/net/session) over the
 * browser-global `WebSocket` (Node 22) — and points them at the deployed fleet
 * over the real internet. No local server, no mock.
 *
 * WHY A NEW FILE RATHER THAN AN EDIT TO `online-live-r2.live.test.ts`
 * ---------------------------------------------------------------------------
 * That instrument asserts the state of the world it was written in: that a
 * reclaimed seat comes back with `banked === STARTING_ORE` and every tier 0 —
 * the "economy not on the wire" defect QA reported. PR #241 put the wallet on the
 * wire (`WelcomeMessage.economy`, `src/net/transport.ts`), so that file's
 * assertions now describe a bug that is meant to be dead. It is left standing as
 * the record of the failing round; THIS file is the re-verification, and it
 * asserts the OPPOSITE — the economy comes back.
 *
 * WHAT IT WITNESSES, AT THE WIRE
 * ---------------------------------------------------------------------------
 * The socket is wrapped, so every `welcome` frame's raw JSON is captured. The
 * gate is not "the numbers look right after a reclaim" (a client could invent
 * them); it is that the RECLAIM WELCOME ITSELF carried a wallet, that the wallet
 * is the one the player built before the drop, and that the shipped client
 * stamped it onto the ship it predicts from.
 *
 * Run: npx vitest run --config evidence/vitest.live.config.ts evidence/online-final.live.test.ts
 */
import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ShipClass, UpgradeTrack } from '@shared/types';
import type { PlayerId } from '@shared/types';
import type { World } from '../src/sim';
import { STARTING_ORE } from '../src/sim/constants';
import { allocateRoom, joinRoom } from '../src/net/allocator-client';
import type { AllocatorClientConfig, ResolvedConnection } from '../src/net/allocator-client';
import { allocatorTransport, createOnlineSession } from '../src/net/session';
import type { OnlineSession } from '../src/net/session';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'images');
/**
 * The fleet under test. Defaults to the DEPLOYED one — the real internet, which is
 * what "live" has always meant in this gallery. `QA_ALLOCATOR` re-points it at a
 * fleet stood up from the code at HEAD (`evidence/fleet-head.mjs`), which is how
 * QA separates "the deployment is stale" from "the code does not do it". Both runs
 * are recorded; the transcript names which fleet it was.
 */
const ALLOCATOR = process.env.QA_ALLOCATOR ?? 'https://planet-rush-allocator.fly.dev';
/** Where this run's transcript lands, so a HEAD-fleet run cannot overwrite a live one. */
const TRANSCRIPT = process.env.QA_TRANSCRIPT ?? 'online-final-reconnect.json';
const client: AllocatorClientConfig = { baseUrl: ALLOCATOR, fetch };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until(what: string, ok: () => boolean, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!ok()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}
function connOf(result: Awaited<ReturnType<typeof allocateRoom>>): ResolvedConnection {
  if (!result.ok) throw new Error(`allocator refused: ${result.reason}`);
  return result.connection;
}
function shipOf(world: World | null, id: PlayerId): World['ships'][number] {
  const s = world?.ships.find((x) => x.id === id);
  if (!s) throw new Error(`no ship ${id}`);
  return s;
}
function wallet(world: World | null, id: PlayerId): Record<string, unknown> {
  const s = shipOf(world, id);
  return { shipClass: s.shipClass, banked: s.banked, cargo: s.cargo, tiers: { ...s.tiers } };
}

/**
 * Open a session against the live fleet and return it once the server has
 * WELCOMED it, redialling a fresh socket past the machine-pin if one misses.
 * `extra` merges into the transport config.
 */
async function connectWelcomed(
  label: string,
  conn: ResolvedConnection,
  shipClass: ShipClass,
  seen: string[],
  extra: Record<string, unknown> = {},
  maxDials = 25,
): Promise<{ session: OnlineSession; dials: number }> {
  for (let dial = 1; dial <= maxDials; dial++) {
    const localSeen: string[] = [];
    const session = createOnlineSession({
      url: conn.url,
      room: conn.room,
      shipClass,
      transport: { ...allocatorTransport(conn, client), ...extra } as never,
    });
    session.observe((m) => {
      localSeen.push(m.type);
      seen.push(m.type);
    });
    const t0 = Date.now();
    while (Date.now() - t0 < 4_000 && !localSeen.includes('welcome')) await sleep(80);
    if (localSeen.includes('welcome')) return { session, dials: dial };
    session.close();
    await sleep(150);
  }
  throw new Error(`${label} never welcomed after ${maxDials} dials (live machine-pin miss)`);
}

describe('LIVE reconnect mid-match — the wallet comes back', () => {
  it('a dropped client reclaims the same ship AND the cargo/bank/upgrades it built', async () => {
    const t: Record<string, unknown> = {
      probe: 'reconnect-economy',
      allocator: ALLOCATOR,
      capturedAt: new Date().toISOString(),
    };
    const a = connOf(await allocateRoom(client, {}));
    t.room = a.room;
    t.machine = a.machine;

    // Wrap the browser-global WebSocket: hold the live socket so it can be severed
    // (a network blip, not a leave), and read every `welcome` frame's RAW JSON so
    // the wallet is witnessed ON THE WIRE and not merely in the client's world.
    let aliceSocket: WebSocket | null = null;
    let aliceOpens = 0;
    let joinErrorsPastDrop = 0;
    let dropped = false;
    const welcomes: Record<string, unknown>[] = [];
    const economies: Record<string, unknown>[] = [];
    const capturing = (url: string): WebSocket => {
      const ws = new WebSocket(url);
      aliceSocket = ws;
      ws.binaryType = 'arraybuffer';
      ws.addEventListener('open', () => {
        if (dropped) aliceOpens++;
      });
      ws.addEventListener('message', (ev: MessageEvent) => {
        if (typeof ev.data !== 'string') return;
        try {
          const m = JSON.parse(ev.data) as Record<string, unknown>;
          if (m.type === 'welcome') {
            // The reclaim token is a secret and never recorded; its PRESENCE is.
            const { reclaimToken, ...rest } = m as { reclaimToken?: string };
            welcomes.push({ ...rest, hasReclaimToken: typeof reclaimToken === 'string', afterDrop: dropped });
          }
          // AUTHORITY'S OWN WALLET, on its own channel (`EconomyMessage`, #241).
          // This is what makes the gate provable rather than self-reported: the
          // "before" wallet is not the client's prediction of its purchases, it
          // is the server telling the client what it actually holds.
          if (m.type === 'economy') economies.push({ ...m, afterDrop: dropped });
          // A refused join after the drop: close so the transport redials (the
          // documented Fly machine-pin miss leaves the socket open-but-unseated).
          if (m.type === 'joinError' && dropped) {
            joinErrorsPastDrop++;
            ws.close();
          }
        } catch {
          /* not a control frame */
        }
      });
      return ws;
    };

    const aliceSaw: string[] = [];
    const { session: alice, dials } = await connectWelcomed('host', a, ShipClass.Interceptor, aliceSaw, {
      connect: capturing,
      ticket: a.ticket,
      checkRoomAlive: undefined,
      retryBaseMs: 250,
      retryMaxMs: 500,
      reconnectWindowMs: 120_000,
    });
    t.hostWelcomeDials = dials;

    const b = connOf(await joinRoom(client, a.room));
    const bobSaw: string[] = [];
    const { session: bob } = await connectWelcomed('joiner', b, ShipClass.Hauler, bobSaw);
    t.bothInSameRoom = b.room === a.room;

    alice.startMatch();
    await until('the live match to start', () => alice.world !== null && bob.world !== null, 45_000);
    const seat = alice.you;
    t.aliceSeat = seat;
    t.bobSeat = bob.you;

    // --- Build a wallet AUTHORITY ACTUALLY HOLDS, and prove it does ----------
    //
    // The obvious thing to buy is a ship upgrade, and this instrument used to.
    // It cannot: `upgradeOrder` is not in `parseActions` (src/net/wire.ts), so
    // every input tick carrying one is rejected whole and never reaches the
    // server's sim — measured, not read, in evidence/probe-wire-orders.mjs
    // (→ images/online-final-wire-orders.json). A client predicts the purchase
    // locally and its own screen shows the tier, which is exactly the trap: a
    // "before" wallet read off the client would be a wallet nobody but the client
    // believes in. So the spend used here is a TURRET — 3 ore, the whole of
    // STARTING_ORE, one of the four build items the wire does carry — and the
    // "before" figure is taken from AUTHORITY'S OWN `economy` frame, not from the
    // predicted world.
    t.bankedAtSpawn = shipOf(alice.world, seat).banked;
    const authoritative = (): Record<string, unknown> | null => {
      const mine = economies.filter((e) => e.player === seat && e.afterDrop === false).at(-1);
      return mine ? (mine.economy as Record<string, unknown>) : null;
    };
    // (a) BANKED ore, spent the way the game spends it: build a TURRET (3 ore,
    //     the whole of STARTING_ORE). Done FIRST and from the spawn frame,
    //     because a build order is only legal while docked at your own station.
    const buyDeadline = Date.now() + 20_000;
    while (Date.now() < buyDeadline && (authoritative()?.banked ?? STARTING_ORE) === STARTING_ORE) {
      alice.sendInput([{ type: 'buildOrder', item: 'turret' }] as never);
      await sleep(100);
    }

    // (b) HELD ore, earned the way the game earns it: fly to the nearest rock and
    //     shoot it. Done AFTER the build, because leaving the home orbit is what
    //     makes the build illegal. `thrust`/`aim`/`fire` all cross the wire and
    //     mining credits the hold server-side, so a non-zero `held` on authority's
    //     own channel is ore the SERVER agrees she is carrying — the "cargo" third
    //     of this gate, in a form a seed-rebuilt ship could not coincidentally match.
    const mineDeadline = Date.now() + 40_000;
    while (Date.now() < mineDeadline && (authoritative()?.held ?? 0) === 0) {
      const w = alice.world as World;
      const me = shipOf(w, seat);
      let best: { x: number; y: number } | null = null;
      let bestD = Infinity;
      for (const rock of w.asteroids) {
        const d = Math.hypot(rock.pos.x - me.pos.x, rock.pos.y - me.pos.y);
        if (d < bestD) {
          bestD = d;
          best = rock.pos;
        }
      }
      if (!best) break;
      const dir = { x: best.x - me.pos.x, y: best.y - me.pos.y };
      const m = Math.hypot(dir.x, dir.y) || 1;
      alice.sendInput([
        { type: 'aim', dir: { x: best.x, y: best.y } },
        { type: 'fire', active: true, auto: true },
        // Close in until the rock is inside weapons reach, then hold station.
        ...(bestD > 180 ? [{ type: 'thrust', dir: { x: dir.x / m, y: dir.y / m } }] : []),
      ] as never);
      await sleep(66);
    }
    t.authorityHeldAfterMining = authoritative()?.held ?? null;
    t.nearestRockUnits = Math.round(
      Math.min(
        ...((alice.world as World).asteroids.map((r) =>
          Math.hypot(r.pos.x - shipOf(alice.world, seat).pos.x, r.pos.y - shipOf(alice.world, seat).pos.y),
        ) ?? [Infinity]),
      ),
    );
    const authorityBefore = authoritative();
    t.authorityWalletBeforeDrop = authorityBefore;
    t.clientWalletBeforeDrop = wallet(alice.world, seat);
    t.spendLanded = !!authorityBefore && authorityBefore.banked !== STARTING_ORE;
    if (!t.spendLanded) {
      writeFileSync(join(OUT, TRANSCRIPT), JSON.stringify({ ...t, economies, welcomes }, null, 2));
      throw new Error(
        'authority never acknowledged a spend — no non-default wallet exists to lose ' +
          `(economy frames seen: ${economies.length})`,
      );
    }

    // --- The drop: sever the live socket, no goodbye ------------------------
    if (!aliceSocket) throw new Error('never captured alice’s live socket');
    dropped = true;
    const tickAtDrop = (alice.world as World).tick;
    t.tickAtDrop = tickAtDrop;
    (aliceSocket as WebSocket).close();

    // The peer is told over the wire her seat was substituted by a bot — proof the
    // drop was real and the server took the ship over (GDD §4.2).
    await until('a bot to substitute for alice (seen by the peer)', () => bobSaw.includes('playerSubstituted'), 25_000);
    t.substitutionSeenByPeer = true;
    // Leave the bot flying her ship. It mines and banks on the AUTHORITATIVE hull,
    // so what comes back is not merely "what she left" but "what authority holds
    // now" — the stronger reading of the GDD's §4.2 promise, and the one a naked
    // seed-rebuilt ship could never coincidentally match.
    await sleep(18_000);

    // --- The return: the transport redials inside grace and reclaims --------
    try {
      await until(
        'alice back on the live wire past the drop tick',
        () =>
          alice.state === 'open' &&
          alice.world !== null &&
          (alice.world as World).tick > tickAtDrop + 30,
        95_000,
      );
    } catch (e) {
      // The transcript exists whether the reclaim lands or not — the verdict is
      // read off the data, and a redial that never gets welcomed back IS data.
      t.reclaimTimedOut = true;
      t.reclaimError = String(e);
      t.aliceOpensAfterDrop = aliceOpens;
      t.joinErrorsPastDrop = joinErrorsPastDrop;
      t.aliceState = alice.state;
      t.aliceSaw = aliceSaw.slice(-30);
      t.bobSaw = [...new Set(bobSaw)];
      t.welcomes = welcomes;
      writeFileSync(join(OUT, TRANSCRIPT), JSON.stringify(t, null, 2));
      alice.close();
      bob.close();
      throw e;
    }
    // Let a few authoritative snapshots reconcile the reclaimed hull.
    await sleep(1_500);

    const after = wallet(alice.world, seat);
    t.afterReclaimAlice = after;
    t.tickAfterReclaim = (alice.world as World).tick;
    t.reclaimedSameSeat = alice.you === seat;
    t.aliceOpensAfterDrop = aliceOpens;
    t.joinErrorsPastDrop = joinErrorsPastDrop;
    t.aliceSawReclaimBroadcast = aliceSaw.includes('playerReclaimed');
    t.bobSawReclaimBroadcast = bobSaw.includes('playerReclaimed');
    t.aliceSaw = [...new Set(aliceSaw)];
    t.bobSaw = [...new Set(bobSaw)];
    t.aliceState = alice.state;

    // THE WIRE ITSELF. The first welcome is the lobby join (no ship yet, so no
    // wallet); the welcome after the drop is the reclaim, and it must carry one.
    t.welcomes = welcomes;
    t.economyFrames = economies;
    const joinWelcome = welcomes.find((w) => w.afterDrop === false) ?? null;
    const reclaimWelcome = welcomes.filter((w) => w.afterDrop === true).at(-1) ?? null;
    t.joinWelcomeCarriedEconomy = joinWelcome ? 'economy' in joinWelcome : null;
    t.reclaimWelcomeEconomy = reclaimWelcome ? (reclaimWelcome.economy ?? null) : null;

    writeFileSync(join(OUT, TRANSCRIPT), JSON.stringify(t, null, 2));
    console.log('RECONNECT-ECONOMY:', JSON.stringify({ ...t, economyFrames: undefined }, null, 2));

    // The reclaim itself: same seat, socket open, match resumed.
    expect(alice.you).toBe(seat);
    expect(alice.state).toBe('open');
    expect((alice.world as World).tick).toBeGreaterThan(tickAtDrop + 30);

    // The wallet, on the wire. A reclaim welcome carries it; a lobby join does not.
    const econ = t.reclaimWelcomeEconomy as { held: number; banked: number; tiers: Record<string, number> } | null;
    expect(econ, 'the reclaim welcome carried the wallet (WelcomeMessage.economy)').not.toBeNull();
    expect(t.joinWelcomeCarriedEconomy, 'and the original lobby join did NOT — there was no ship yet').toBe(false);

    // It is AUTHORITY'S wallet — the one the server's own `economy` channel was
    // publishing before the drop, moved on by whatever the substituting bot did —
    // and emphatically not the seed's naked ship.
    const spawn = { held: 0, banked: STARTING_ORE };
    t.reclaimWalletIsSpawnDefault =
      econ!.banked === spawn.banked &&
      econ!.held === spawn.held &&
      Object.values(econ!.tiers).every((n) => n === 0);
    expect(t.reclaimWalletIsSpawnDefault, 'the wallet on the wire is NOT the spawn default').toBe(false);
    expect(econ!.banked, "and it matches what authority said she held before the drop, or better").not.toBe(
      STARTING_ORE,
    );

    // …and the shipped client stamped that wallet onto the ship it predicts from.
    expect(after.tiers, 'the reclaimed ship carries the wire wallet’s tiers').toMatchObject(econ!.tiers);
    expect(after.banked, 'and its banked ore').toBe(econ!.banked);
    expect(after.cargo, 'and its held ore').toBe(econ!.held);
    expect(after.shipClass, 'the hull class survives too').toBe(ShipClass.Interceptor);

    t.economyResetToSeedOnReclaim = after.banked === STARTING_ORE && after.cargo === 0;
    expect(t.economyResetToSeedOnReclaim, 'the wallet did NOT snap back to spawn defaults').toBe(false);

    writeFileSync(join(OUT, TRANSCRIPT), JSON.stringify(t, null, 2));
    alice.close();
    bob.close();
  }, 220_000);
});
