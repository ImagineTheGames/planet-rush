/**
 * evidence/online-close.live.test.ts — the `online-reconnect` gate, ALL THREE
 * THIRDS IN ONE RUN, against the LIVE Fly deployment. OWNER: QA Manager.
 *
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * `online-final.live.test.ts` proved two thirds live (the bank and the held
 * cargo) and could not prove the third, for a reason that was not QA's to fix:
 * `parseActions` (src/net/wire.ts) had no case for `upgradeOrder`, so every
 * input tick carrying one was rejected WHOLE and no tier a player bought could
 * ever exist on authority. `online-upgrade-reclaim.live.test.ts` then spent nine
 * live substitution windows trying to make a stand-in bot buy the tier the wire
 * refused, and the bot never earned above its endowment.
 *
 * PR #250 (`net(m10): the wire learns upgradeOrder and satellite`) landed that
 * case. So the honest instrument is no longer a bot-wrangling contraption: the
 * PLAYER buys her own upgrade over her own socket, exactly as the shipped client
 * does it, and the gate is asked the plain question it always meant to ask.
 *
 * WHAT IT WITNESSES, AT THE WIRE
 * ---------------------------------------------------------------------------
 * Every wallet figure quoted here is AUTHORITY'S — read off the server's own
 * `economy` channel (`EconomyMessage`, src/net/transport.ts) and off the raw
 * `welcome` frame's JSON, never off the client's optimistic prediction. A client
 * that predicted a purchase the server refused would show the tier on its own
 * screen and prove nothing; the server naming the tier is the whole point.
 *
 *   1. UPGRADES — docked at her own station, Alice orders CARGO tier 1 (cost 2,
 *      the cheapest rung in the ladder: `UPGRADES[Cargo].costs[0]`, and the only
 *      one affordable out of `STARTING_ORE` = 3). Authority's economy frame must
 *      report `tiers.cargo >= 1`.
 *   2. BANK — the same frame reports `banked` moved off the spawn default of 3.
 *   3. CARGO — she then flies out and shoots the nearest rock until authority
 *      reports `held >= 1`.
 *
 * Then the socket is severed with no goodbye, a stand-in flies her ship, and she
 * redials inside grace. The reclaim welcome must carry the wallet, the tier must
 * still be there, and the shipped client must stamp all of it onto the ship it
 * predicts from.
 *
 * Tiers can only ever go UP while she is away (nothing in the sim clears them —
 * `respawn` deliberately leaves `ship.tiers` alone, src/sim/step.ts), so the
 * assertion is `>= 1`, and the exact wallet is asserted against the wire's own
 * numbers rather than against a remembered "before".
 *
 * Run: npx vitest run --config evidence/vitest.live.config.ts evidence/online-close.live.test.ts
 */
import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ShipClass, UpgradeTrack } from '@shared/types';
import type { PlayerId } from '@shared/types';
import type { World } from '../src/sim';
import { STARTING_ORE, UPGRADES } from '../src/sim/constants';
import { allocateRoom, joinRoom } from '../src/net/allocator-client';
import type { AllocatorClientConfig, ResolvedConnection } from '../src/net/allocator-client';
import { allocatorTransport, createOnlineSession } from '../src/net/session';
import type { OnlineSession } from '../src/net/session';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'images');
const ALLOCATOR = process.env.QA_ALLOCATOR ?? 'https://planet-rush-allocator.fly.dev';
const TRANSCRIPT = process.env.QA_TRANSCRIPT ?? 'online-close-reconnect.json';
/**
 * How long the stand-in is left flying her ship before she redials. 18 s is the
 * default and the harder case — long enough that the bot mines and BANKS the ore
 * she was holding, so what comes back is "what authority holds now" rather than
 * "what she left" (the stronger reading of GDD §4.2). A SHORT window is the more
 * legible case for the cargo third specifically: the hold is still full when she
 * returns, so `held` comes back as HELD ore and not as bank. Both are run.
 */
const AWAY_MS = Number(process.env.QA_AWAY_MS ?? 18_000);
const client: AllocatorClientConfig = { baseUrl: ALLOCATOR, fetch };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** The cheapest rung in the whole upgrade ladder, read from the shipped table. */
const CARGO_T1_COST = UPGRADES[UpgradeTrack.Cargo].costs[0];

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
  return {
    shipClass: s.shipClass,
    banked: s.banked,
    cargo: s.cargo,
    cargoCap: s.cargoCap,
    tiers: { ...s.tiers },
    // A held-ore figure is only readable next to whether the ship was still
    // flying: death drops the hold (GDD §2.7), so `cargo: 0` on a dead ship is
    // the rules working, not the reclaim failing.
    alive: s.alive,
    hull: s.hull,
  };
}

/** Open a session against the live fleet and return it once the server has
 *  WELCOMED it, redialling a fresh socket past the machine-pin if one misses. */
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

describe('LIVE reconnect mid-match — bank, cargo AND upgrades come back', () => {
  it('a player buys a tier over the wire, drops, and reclaims the whole wallet', async () => {
    const t: Record<string, unknown> = {
      probe: 'reconnect-all-three-thirds',
      allocator: ALLOCATOR,
      capturedAt: new Date().toISOString(),
      cargoTier1Cost: CARGO_T1_COST,
      startingOre: STARTING_ORE,
    };
    const a = connOf(await allocateRoom(client, {}));
    t.room = a.room;
    t.machine = a.machine;

    let aliceSocket: WebSocket | null = null;
    let aliceOpens = 0;
    let joinErrorsPastDrop = 0;
    /** WHY a refused redial was refused, verbatim. A count alone cannot tell
     *  `bad-ticket` (Fly's edge landed the redial on the wrong Machine — the
     *  fleet's socket-hop pin, not the client) from `grace-expired` or
     *  `room-full` (which would be the client returning too late or to the wrong
     *  room). The reclaim third is only readable next to this reason. */
    const joinErrorReasonsPastDrop: string[] = [];
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
            const { reclaimToken, ...rest } = m as { reclaimToken?: string };
            welcomes.push({ ...rest, hasReclaimToken: typeof reclaimToken === 'string', afterDrop: dropped });
          }
          if (m.type === 'economy') economies.push({ ...m, afterDrop: dropped });
          if (m.type === 'joinError' && dropped) {
            joinErrorsPastDrop++;
            joinErrorReasonsPastDrop.push(String(m.reason ?? 'unstated'));
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
    t.bankedAtSpawn = shipOf(alice.world, seat).banked;
    t.tiersAtSpawn = { ...shipOf(alice.world, seat).tiers };
    t.cargoCapAtSpawn = shipOf(alice.world, seat).cargoCap;

    /** The last wallet AUTHORITY published for this seat before the drop. */
    const authoritative = (): Record<string, unknown> | null => {
      const mine = economies.filter((e) => e.player === seat && e.afterDrop === false).at(-1);
      return mine ? (mine.economy as Record<string, unknown>) : null;
    };
    const authTier = (track: UpgradeTrack): number => {
      const tiers = (authoritative()?.tiers ?? {}) as Record<string, number>;
      return tiers[track] ?? 0;
    };

    // --- (1) UPGRADES: the third that could not be shown until PR #250 -------
    //
    // Ordered from the spawn frame, because `buyUpgrade` refuses an undocked ship
    // (src/sim/buildings.ts). CARGO tier 1 costs 2 of her 3 starting ore — the
    // only rung she can afford before mining, and one whose effect is visible in
    // a second place (`cargoCap`, recomputed from the tiers) so a phantom tier
    // could not pass unnoticed.
    const upgradeDeadline = Date.now() + 25_000;
    while (Date.now() < upgradeDeadline && authTier(UpgradeTrack.Cargo) < 1) {
      alice.sendInput([{ type: 'upgradeOrder', track: UpgradeTrack.Cargo }] as never);
      await sleep(100);
    }
    t.authorityTierAfterOrder = authTier(UpgradeTrack.Cargo);
    t.authorityWalletAfterUpgrade = authoritative();
    t.upgradeLanded = authTier(UpgradeTrack.Cargo) >= 1;
    if (!t.upgradeLanded) {
      writeFileSync(join(OUT, TRANSCRIPT), JSON.stringify({ ...t, economies, welcomes }, null, 2));
      throw new Error(
        `authority never acknowledged the upgrade — tiers.cargo stayed ${authTier(UpgradeTrack.Cargo)} ` +
          `(economy frames seen: ${economies.length})`,
      );
    }

    // --- (3) CARGO: ore the SERVER agrees she is carrying --------------------
    const mineDeadline = Date.now() + 45_000;
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
        ...(bestD > 180 ? [{ type: 'thrust', dir: { x: dir.x / m, y: dir.y / m } }] : []),
      ] as never);
      await sleep(66);
    }
    t.authorityHeldAfterMining = authoritative()?.held ?? null;

    const authorityBefore = authoritative();
    t.authorityWalletBeforeDrop = authorityBefore;
    t.clientWalletBeforeDrop = wallet(alice.world, seat);
    // (2) BANK: the wallet authority holds is not the wallet the seed makes.
    t.bankMovedOffSpawnDefault = !!authorityBefore && authorityBefore.banked !== STARTING_ORE;

    // --- The drop: sever the live socket, no goodbye ------------------------
    if (!aliceSocket) throw new Error('never captured alice’s live socket');
    dropped = true;
    const tickAtDrop = (alice.world as World).tick;
    t.tickAtDrop = tickAtDrop;
    (aliceSocket as WebSocket).close();

    await until('a bot to substitute for alice (seen by the peer)', () => bobSaw.includes('playerSubstituted'), 25_000);
    t.substitutionSeenByPeer = true;
    t.awayMs = AWAY_MS;
    await sleep(AWAY_MS);

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
      t.reclaimTimedOut = true;
      t.reclaimError = String(e);
      t.aliceOpensAfterDrop = aliceOpens;
      t.joinErrorsPastDrop = joinErrorsPastDrop;
      t.joinErrorReasonsPastDrop = joinErrorReasonsPastDrop;
      t.aliceState = alice.state;
      t.aliceSaw = aliceSaw.slice(-30);
      t.bobSaw = [...new Set(bobSaw)];
      t.welcomes = welcomes;
      writeFileSync(join(OUT, TRANSCRIPT), JSON.stringify(t, null, 2));
      alice.close();
      bob.close();
      throw e;
    }
    // WAIT FOR THE WALLET TO STOP MOVING BEFORE COMPARING IT TO ANYTHING.
    // Banking is continuous (ore deposits over several ticks), so mid-deposit the
    // client's ship and authority's newest frame are both correct and merely a
    // fraction of a second apart — comparing them exactly then measures the read
    // instant, not the reclaim. Settle for a quiet window instead: no new economy
    // frame for QUIESCE_MS, up to a bounded wait.
    const QUIESCE_MS = 1_500;
    const quiesceDeadline = Date.now() + 12_000;
    let lastCount = -1;
    let quietSince = Date.now();
    while (Date.now() < quiesceDeadline) {
      if (economies.length !== lastCount) {
        lastCount = economies.length;
        quietSince = Date.now();
      } else if (Date.now() - quietSince >= QUIESCE_MS) break;
      await sleep(100);
    }
    t.walletQuiescedMs = Date.now() - quietSince;
    t.walletQuiesced = Date.now() - quietSince >= QUIESCE_MS;

    const after = wallet(alice.world, seat);
    t.afterReclaimAlice = after;
    t.tickAfterReclaim = (alice.world as World).tick;
    t.reclaimedSameSeat = alice.you === seat;
    t.aliceOpensAfterDrop = aliceOpens;
    t.joinErrorsPastDrop = joinErrorsPastDrop;
    t.joinErrorReasonsPastDrop = joinErrorReasonsPastDrop;
    t.aliceSawReclaimBroadcast = aliceSaw.includes('playerReclaimed');
    t.bobSawReclaimBroadcast = bobSaw.includes('playerReclaimed');
    t.aliceSaw = [...new Set(aliceSaw)];
    t.bobSaw = [...new Set(bobSaw)];
    t.aliceState = alice.state;
    t.welcomes = welcomes;
    t.economyFrames = economies;

    const joinWelcome = welcomes.find((w) => w.afterDrop === false) ?? null;
    const reclaimWelcome = welcomes.filter((w) => w.afterDrop === true).at(-1) ?? null;
    t.joinWelcomeCarriedEconomy = joinWelcome ? 'economy' in joinWelcome : null;
    t.reclaimWelcomeEconomy = reclaimWelcome ? (reclaimWelcome.economy ?? null) : null;

    // THE WALLET THE SHIP SHOULD MATCH IS AUTHORITY'S LATEST, NOT THE WELCOME'S.
    // The reclaim welcome is a snapshot at the reclaim tick; the match does not
    // pause for it. If authority sends another `economy` frame in the settle
    // window — she is shot and drops the hold, or a chunk banks — the ship
    // correctly follows that one, and asserting it against the welcome's stale
    // figure fails a client that did exactly the right thing. (Observed live,
    // 2026-07-30 room 638B: a tick-1018 frame moved held 1 → 0 with banked
    // unchanged, and the earlier form of this assertion charged it to the client.)
    const laterEconomy =
      (economies.filter((e) => e.player === seat && e.afterDrop === true).at(-1) as
        | { economy: { held: number; banked: number; tiers: Record<string, number> } }
        | undefined) ?? null;
    t.economyMovedAfterReclaimWelcome =
      laterEconomy !== null &&
      JSON.stringify(laterEconomy.economy) !== JSON.stringify(t.reclaimWelcomeEconomy);
    t.authoritysLatestWallet = laterEconomy ? laterEconomy.economy : t.reclaimWelcomeEconomy;

    // WAS THE HELD THIRD ACTUALLY PROVEN, OR ONLY NOT DISPROVEN? `cargo === held`
    // is satisfied by 0 === 0, which is what a run says when the stand-in banked
    // the hold before the reclaim. That run proves the BANK third twice and the
    // HOLD third not at all, so it is recorded as such rather than counted green.
    const latest = t.authoritysLatestWallet as { held: number } | null;
    t.heldThirdProven = latest !== null && latest.held > 0;

    writeFileSync(join(OUT, TRANSCRIPT), JSON.stringify(t, null, 2));
    console.log('RECONNECT-THREE-THIRDS:', JSON.stringify({ ...t, economyFrames: undefined }, null, 2));

    // The reclaim itself: same seat, socket open, match resumed.
    expect(alice.you).toBe(seat);
    expect(alice.state).toBe('open');
    expect((alice.world as World).tick).toBeGreaterThan(tickAtDrop + 30);

    // The wallet, on the wire. A reclaim welcome carries it; a lobby join does not.
    const econ = t.reclaimWelcomeEconomy as { held: number; banked: number; tiers: Record<string, number> } | null;
    expect(econ, 'the reclaim welcome carried the wallet (WelcomeMessage.economy)').not.toBeNull();
    expect(t.joinWelcomeCarriedEconomy, 'and the original lobby join did NOT — there was no ship yet').toBe(false);

    // THE THIRD THIRD: the tier she bought over the wire is still on the wire.
    expect(econ!.tiers[UpgradeTrack.Cargo] ?? 0, 'the CARGO tier survived the drop').toBeGreaterThanOrEqual(1);

    // Not the seed's naked ship.
    t.reclaimWalletIsSpawnDefault =
      econ!.banked === STARTING_ORE &&
      econ!.held === 0 &&
      Object.values(econ!.tiers).every((n) => n === 0);
    expect(t.reclaimWalletIsSpawnDefault, 'the wallet on the wire is NOT the spawn default').toBe(false);

    // …and the shipped client stamped that wallet onto the ship it predicts from,
    // derived stats included: a restored CARGO tier that did not move `cargoCap`
    // would be a number in a field, not an upgrade.
    const live = t.authoritysLatestWallet as { held: number; banked: number; tiers: Record<string, number> };
    expect(after.tiers, 'the reclaimed ship carries the wire wallet’s tiers').toMatchObject(live.tiers);
    expect(after.banked, 'and its banked ore').toBe(live.banked);
    expect(after.cargo, 'and its held ore — against authority’s LATEST frame').toBe(live.held);
    expect(after.shipClass, 'the hull class survives too').toBe(ShipClass.Interceptor);
    expect(after.cargoCap as number, 'and the hold really is bigger than a stock one').toBeGreaterThan(
      t.cargoCapAtSpawn as number,
    );

    writeFileSync(join(OUT, TRANSCRIPT), JSON.stringify(t, null, 2));
    alice.close();
    bob.close();
  }, 260_000);
});
