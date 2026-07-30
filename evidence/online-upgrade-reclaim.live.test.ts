/**
 * evidence/online-upgrade-reclaim.live.test.ts — the THIRD third of the
 * `online-reconnect` gate: do UPGRADE TIERS come back on a reclaim?
 * OWNER: QA Manager.
 *
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * `online-final.live.test.ts` proves the bank and the held cargo survive a
 * mid-match drop. It cannot prove the same of upgrade tiers, and not for want of
 * trying: **a player cannot buy an upgrade online at all.** `parseActions`
 * (src/net/wire.ts) switches on thrust/aim/fire/build/buildOrder and
 * `default: return null`, and one bad action rejects the whole message — so
 * every input tick carrying an `upgradeOrder` is discarded entire by the server.
 * Measured, not read: evidence/probe-wire-orders.mjs. That is a live defect, it
 * is Netcode's, and it is reported. But it also means a tier bought by the
 * PLAYER can never exist on authority, so "tiers: all 0 before, all 0 after" is
 * not evidence of restoration — it is evidence of nothing.
 *
 * THE WAY IN: THE STAND-IN BUYS IT
 * ---------------------------------------------------------------------------
 * Bots run INSIDE authority's own sim. They do not cross `parseActions`, so the
 * `upgradeOrder` the wire rejects is one a bot issues freely
 * (src/bots/behaviors.ts `purchaseAction`). When a player drops, the room seats a
 * Medium stand-in on their ship (server/room.ts `substituteFor`). So the tier
 * this gate needs can be put on the ship by the very bot that is flying it while
 * the player is away — which is not a workaround but the truer test: the wallet
 * that must come back is "what authority holds NOW", not "what the player left".
 *
 * MAKING THE STAND-IN BUY AN UPGRADE, AND NOTHING ELSE
 * ---------------------------------------------------------------------------
 * Two shipped rules decide this, and the instrument steers by both rather than
 * around them:
 *
 *  1. **Endowment** (src/bots/tree.ts:229, behaviors.ts:353) — "a stand-in never
 *     spends the ore it inherited". The bot books the spendable it sat down with
 *     and only spends ABOVE it. So the player drops BROKE: banked 0, held 0,
 *     endowment 0, and every ore the stand-in spends is ore it mined itself.
 *  2. **Per-item affordability** (src/bots/medium.ts `mediumSpendPlan`) — the
 *     ladder is repair → turret(3) → shield(5) → upgrades → bank, and EACH rung
 *     carries its own `spendable >= cost` guard, so a rung the bot cannot afford
 *     is SKIPPED rather than saved for. The player therefore builds the turret
 *     rung OUT of the ladder before dropping: `MEDIUM_TURRET_TARGET` is 2
 *     (src/bots/medium.ts:67), so with two turrets already standing the stand-in
 *     skips turrets, cannot afford the 5-ore shield on one small haul, and lands
 *     on the cheapest rung of the upgrade ladder: CARGO tier 1, cost 2
 *     (src/sim/constants.ts UPGRADES[Cargo].costs[0]).
 *
 * So the player mines her own two turrets up, spends down to near-broke, and
 * drops. Nothing here is stubbed, patched or privileged — the bot is the shipped
 * bot, running on the deployed server, spending by its own published plan. The
 * FIRST attempt at this instrument left the turret rung standing and the stand-in
 * duly spent its 42 s mining toward a turret it never afforded; three attempts
 * bought nothing (images/online-final-reclaim-upgrades-turretrung.json). That is
 * why the player now builds the station up first.
 *
 * WHAT IS ASSERTED
 * ---------------------------------------------------------------------------
 * That the reclaim welcome's `economy.tiers` carries the tier the stand-in
 * bought — a NON-ZERO tier, witnessed in the raw welcome frame off the wire —
 * and that the shipped client stamps it onto the ship it predicts from.
 *
 * Run: npx vitest run --config evidence/vitest.live.config.ts evidence/online-upgrade-reclaim.live.test.ts
 */
import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ShipClass } from '@shared/types';
import type { PlayerId } from '@shared/types';
import type { World } from '../src/sim';
import { STARTING_ORE } from '../src/sim/constants';
import { allocateRoom, joinRoom } from '../src/net/allocator-client';
import type { AllocatorClientConfig, ResolvedConnection } from '../src/net/allocator-client';
import { allocatorTransport, createOnlineSession } from '../src/net/session';
import type { OnlineSession } from '../src/net/session';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'images');
const ALLOCATOR = process.env.QA_ALLOCATOR ?? 'https://planet-rush-allocator.fly.dev';
const TRANSCRIPT = process.env.QA_TRANSCRIPT ?? 'online-final-reclaim-upgrades.json';
const client: AllocatorClientConfig = { baseUrl: ALLOCATOR, fetch };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * How long the stand-in is left flying. The server holds a dropped seat for
 * DEFAULT_GRACE_MS (~60 s, server/room.ts), and the reclaim must land INSIDE
 * that — so this is the largest window that still leaves room to redial. A
 * Medium bot mines a hold and docks well inside it.
 */
const SUBSTITUTE_WINDOW_MS = Number(process.env.QA_SUB_WINDOW_MS ?? 42_000);
/** Independent attempts at a stand-in purchase before the run is called. */
const ATTEMPTS = Number(process.env.QA_ATTEMPTS ?? 3);

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
const nonZeroTier = (tiers: Record<string, number> | undefined): boolean =>
  !!tiers && Object.values(tiers).some((n) => n > 0);

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

/** One full attempt: fresh room, drop broke, let the stand-in earn and spend,
 *  reclaim, and report what the reclaim welcome carried. */
async function attempt(n: number): Promise<Record<string, unknown>> {
  const t: Record<string, unknown> = { attempt: n, at: new Date().toISOString() };
  const a = connOf(await allocateRoom(client, {}));
  t.room = a.room;
  t.machine = a.machine;

  let aliceSocket: WebSocket | null = null;
  let dropped = false;
  const welcomes: Record<string, unknown>[] = [];
  const economies: Record<string, unknown>[] = [];
  const capturing = (url: string): WebSocket => {
    const ws = new WebSocket(url);
    aliceSocket = ws;
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('message', (ev: MessageEvent) => {
      if (typeof ev.data !== 'string') return;
      try {
        const m = JSON.parse(ev.data) as Record<string, unknown>;
        if (m.type === 'welcome') {
          const { reclaimToken, ...rest } = m as { reclaimToken?: string };
          welcomes.push({ ...rest, hasReclaimToken: typeof reclaimToken === 'string', afterDrop: dropped });
        }
        if (m.type === 'economy') economies.push({ ...m, afterDrop: dropped });
        if (m.type === 'joinError' && dropped) ws.close();
      } catch {
        /* not a control frame */
      }
    });
    return ws;
  };

  const aliceSaw: string[] = [];
  const { session: alice } = await connectWelcomed('host', a, ShipClass.Interceptor, aliceSaw, {
    connect: capturing,
    ticket: a.ticket,
    checkRoomAlive: undefined,
    retryBaseMs: 250,
    retryMaxMs: 500,
    reconnectWindowMs: 120_000,
  });
  const b = connOf(await joinRoom(client, a.room));
  const bobSaw: string[] = [];
  const { session: bob } = await connectWelcomed('joiner', b, ShipClass.Hauler, bobSaw);

  alice.startMatch();
  await until('the live match to start', () => alice.world !== null && bob.world !== null, 45_000);
  const seat = alice.you;
  t.aliceSeat = seat;

  const authoritative = (): Record<string, unknown> | null => {
    const mine = economies.filter((e) => e.player === seat && e.afterDrop === false).at(-1);
    return mine ? (mine.economy as Record<string, unknown>) : null;
  };

  // --- Build the turret rung out of the stand-in's ladder -----------------
  //
  // Mine, haul, bank and buy TURRETS until two stand — all with verbs the wire
  // actually carries (thrust/aim/fire/buildOrder). Every ore spent here is also
  // an ore the stand-in will not inherit, which is the second half of the setup:
  // the lower the wallet at the drop, the lower its endowment, and the sooner
  // what it mines lifts `spendable` past it.
  const myStation = (): { pos: { x: number; y: number }; turrets: number; builds: number } => {
    const w = alice.world as World;
    const st = w.stations.find((s) => s.owner === seat)!;
    // `turrets` and `builds` are arrays ON the station (src/sim/state.ts:437,450)
    // — the same two counts `mediumSpendPlan` reads before it decides.
    return { pos: st.pos, turrets: st.turrets?.length ?? 0, builds: st.builds?.length ?? 0 };
  };
  const DOCK_RANGE = 160;
  //
  // THE ENDOWMENT IS A DIAL, AND IT POINTS THE OTHER WAY FROM THE OBVIOUS.
  // The first version of this dropped BROKE, reasoning that endowment 0 frees
  // the stand-in to spend everything. It does — but it also means the bot must
  // mine a WHOLE cargo tier's worth (2.0) before `spendable` clears the price,
  // and ore is fractional: three live attempts banked 2.0, 2.0 and 1.9 and
  // bought nothing (images/online-final-reclaim-upgrades-endowment0.json).
  // Leaving ~2 ore behind inverts it: endowment ~2, so the FIRST ore the bot
  // mines lifts `spendable` past its endowment AND past the 2-ore cargo tier at
  // the same moment. It still spends only what it earned — the shipped rule is
  // untouched; the player just leaves the bar where one haul clears it.
  const ENDOWMENT_FLOOR = 2;
  /** Below the 5-ore shield rung, which the stand-in must keep skipping. */
  const ENDOWMENT_CEILING = 4.5;
  const setupDeadline = Date.now() + 180_000;
  let turretsOrdered = 0;
  while (Date.now() < setupDeadline) {
    const w = alice.world as World;
    const me = shipOf(w, seat);
    const st = myStation();
    // `builds` counts a turret still under construction — `mediumSpendPlan`
    // counts it too, so the rung is filled the moment the order lands.
    const standing = st.turrets + st.builds;
    const bank = (authoritative()?.banked ?? 0) as number;
    if (standing >= 2 && bank >= ENDOWMENT_FLOOR && bank < ENDOWMENT_CEILING) break;

    const dHome = Math.hypot(st.pos.x - me.pos.x, st.pos.y - me.pos.y);
    const docked = dHome <= DOCK_RANGE;

    // Docked with the price of a turret and a rung still to fill: buy it.
    if (docked && standing < 2 && bank >= 3) {
      alice.sendInput([{ type: 'buildOrder', item: 'turret' }] as never);
      turretsOrdered++;
      await sleep(600);
      continue;
    }
    // Rung filled and the bank still over the shield price: burn it down on
    // another turret (cap 4) rather than hand the stand-in a shield it could buy.
    if (docked && standing >= 2 && bank >= ENDOWMENT_CEILING) {
      alice.sendInput([{ type: 'buildOrder', item: 'turret' }] as never);
      turretsOrdered++;
      await sleep(600);
      continue;
    }
    // Hold full, or carrying ore the bank still needs: go home and deposit.
    if (me.cargo >= me.cargoCap - 1e-9 || (me.cargo > 0 && standing >= 2 && bank < ENDOWMENT_FLOOR)) {
      const dir = { x: st.pos.x - me.pos.x, y: st.pos.y - me.pos.y };
      const m = Math.hypot(dir.x, dir.y) || 1;
      alice.sendInput([
        { type: 'fire', active: false, auto: false },
        ...(dHome > DOCK_RANGE * 0.5 ? [{ type: 'thrust', dir: { x: dir.x / m, y: dir.y / m } }] : []),
      ] as never);
      await sleep(66);
      continue;
    }
    // Otherwise mine — but NOT the rocks closest to home. The stand-in has only
    // the 60 s grace to fly out, earn its first ore and get back inside dock
    // range, and the player who mines her own doorstep bare spends that budget
    // for it: run v3 left a perfect setup (two turrets, exactly 2.0 inherited)
    // and the bot returned the wallet UNTOUCHED after 50 s
    // (images/online-final-reclaim-upgrades-nearrocks.json). So the setup haul
    // goes to rocks well outside the home neighbourhood and leaves the near ore
    // standing for the stand-in.
    const HOME_ORE_RESERVE = 320;
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const rock of w.asteroids) {
      const dHomeRock = Math.hypot(rock.pos.x - st.pos.x, rock.pos.y - st.pos.y);
      if (dHomeRock < HOME_ORE_RESERVE) continue;
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

  const before = authoritative();
  const stAtDrop = myStation();
  t.authorityWalletBeforeDrop = before;
  t.turretsStandingAtDrop = stAtDrop.turrets;
  t.turretBuildsAtDrop = stAtDrop.builds;
  t.turretsOrdered = turretsOrdered;
  t.bankedAtDrop = before ? before.banked : null;
  t.tiersBeforeDrop = before ? (before.tiers as Record<string, number>) : null;
  // The setup is good enough when the turret rung is filled and the wallet the
  // stand-in inherits sits between the cargo tier it should buy and the shield
  // rung it must keep skipping.
  const bankAtDrop = ((before?.banked as number) ?? 0) + ((before?.held as number) ?? 0);
  t.spendableInheritedByStandIn = bankAtDrop;
  t.setupReady =
    stAtDrop.turrets + stAtDrop.builds >= 2 && bankAtDrop >= ENDOWMENT_FLOOR && bankAtDrop < ENDOWMENT_CEILING;

  if (!t.setupReady) {
    alice.close();
    bob.close();
    return { ...t, aborted: 'never got two turrets up with a spendable in the target band', economies };
  }

  // --- Park the ship ON the ore before letting go of it -------------------
  //
  // The stand-in has 60 s of grace to earn its first ore AND get back inside
  // dock range to spend it, and where the ship is sitting when the socket dies
  // decides whether that is possible. Dropped docked at home, the bot returned
  // the wallet untouched in 50 s and 52 s, twice
  // (images/online-final-reclaim-upgrades-athome.json); dropped beside a rock in
  // the very first run of the sibling instrument it mined and banked inside 18 s.
  // So the ship is flown to the asteroid CLOSEST TO ITS OWN STATION — ore within
  // arm's reach, and the shortest possible haul home to spend.
  const parkTarget = ((): { x: number; y: number } | null => {
    const w = alice.world as World;
    const st = myStation();
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const rock of w.asteroids) {
      const d = Math.hypot(rock.pos.x - st.pos.x, rock.pos.y - st.pos.y);
      if (d < bestD) {
        bestD = d;
        best = rock.pos;
      }
    }
    t.parkRockDistanceFromHome = Math.round(bestD);
    return best;
  })();
  if (parkTarget) {
    const parkDeadline = Date.now() + 30_000;
    while (Date.now() < parkDeadline) {
      const me = shipOf(alice.world, seat);
      const d = Math.hypot(parkTarget.x - me.pos.x, parkTarget.y - me.pos.y);
      if (d <= 120) break;
      const dir = { x: parkTarget.x - me.pos.x, y: parkTarget.y - me.pos.y };
      const m = Math.hypot(dir.x, dir.y) || 1;
      // Fly there, guns cold: a shot fired now is ore the stand-in should mine.
      alice.sendInput([
        { type: 'fire', active: false, auto: false },
        { type: 'thrust', dir: { x: dir.x / m, y: dir.y / m } },
      ] as never);
      await sleep(66);
    }
    const me = shipOf(alice.world, seat);
    t.parkedWithinUnitsOfRock = Math.round(Math.hypot(parkTarget.x - me.pos.x, parkTarget.y - me.pos.y));
  }

  // --- The drop -----------------------------------------------------------
  if (!aliceSocket) throw new Error('never captured alice’s live socket');
  dropped = true;
  const tickAtDrop = (alice.world as World).tick;
  t.tickAtDrop = tickAtDrop;
  (aliceSocket as WebSocket).close();
  await until('a bot to substitute (seen by the peer)', () => bobSaw.includes('playerSubstituted'), 25_000);
  t.substitutionSeenByPeer = true;

  // Leave the stand-in to mine a hold and dock. It is invisible from here — the
  // economy channel only ever addresses the seat's own socket (server/room.ts
  // `sendTo`), and that socket is severed — so the purchase is read on return.
  // …but it is NOT invisible from the PEER's seat. Bob is still connected and
  // every snapshot he receives carries Alice's ship, so the stand-in's whole
  // shift is watchable from the other client: where it flew, what it was
  // holding, whether it was alive. Five windows in a row returned the wallet
  // byte-identical, and a guess about why is worth less than a sample.
  t.substituteWindowMs = SUBSTITUTE_WINDOW_MS;
  const shift: Record<string, unknown>[] = [];
  const shiftEnd = Date.now() + SUBSTITUTE_WINDOW_MS;
  while (Date.now() < shiftEnd) {
    const bw = bob.world as World | null;
    const her = bw?.ships.find((s) => s.id === seat);
    if (her) {
      shift.push({
        tick: bw!.tick,
        x: Math.round(her.pos.x),
        y: Math.round(her.pos.y),
        hull: Number(her.hull.toFixed(1)),
        alive: her.alive,
        cargo: Number(her.cargo.toFixed(2)),
      });
    }
    await sleep(500);
  }
  const moved = shift.length > 1 ? Math.round(Math.hypot(shift.at(-1)!.x as number - (shift[0].x as number), (shift.at(-1)!.y as number) - (shift[0].y as number))) : 0;
  const path = shift.reduce(
    (acc, s, i) => (i === 0 ? 0 : acc + Math.hypot((s.x as number) - (shift[i - 1].x as number), (s.y as number) - (shift[i - 1].y as number))),
    0,
  );
  t.standInShift = {
    samples: shift.length,
    netDisplacementUnits: moved,
    pathLengthUnits: Math.round(path),
    everDied: shift.some((s) => s.alive === false),
    maxCargoSeen: Math.max(0, ...shift.map((s) => s.cargo as number)),
    minHullSeen: Math.min(...shift.map((s) => s.hull as number)),
    first: shift[0] ?? null,
    last: shift.at(-1) ?? null,
  };
  t.standInShiftSamples = shift;

  // --- The return ---------------------------------------------------------
  try {
    await until(
      'alice back on the live wire past the drop tick',
      () => alice.state === 'open' && alice.world !== null && (alice.world as World).tick > tickAtDrop + 30,
      60_000,
    );
  } catch (e) {
    t.reclaimTimedOut = true;
    t.reclaimError = String(e);
    alice.close();
    bob.close();
    return { ...t, welcomes, economies };
  }
  await sleep(1_500);

  const me = shipOf(alice.world, seat);
  const reclaimWelcome = welcomes.filter((w) => w.afterDrop === true).at(-1) ?? null;
  const econ = reclaimWelcome ? ((reclaimWelcome.economy ?? null) as Record<string, unknown> | null) : null;
  t.reclaimedSameSeat = alice.you === seat;
  t.reclaimWelcomeEconomy = econ;
  t.wireTiers = econ ? (econ.tiers as Record<string, number>) : null;
  t.clientTiersAfterReclaim = { ...me.tiers };
  t.clientBankedAfterReclaim = me.banked;
  t.clientCargoAfterReclaim = me.cargo;
  t.clientShipClassAfterReclaim = me.shipClass;
  t.standInBoughtAnUpgrade = nonZeroTier(t.wireTiers as Record<string, number>);
  t.welcomes = welcomes;
  t.economyFramesAfterReclaim = economies.filter((e) => e.afterDrop === true);

  alice.close();
  bob.close();
  return t;
}

describe('LIVE reclaim — the upgrade TIERS come back too', () => {
  it('a tier the stand-in bought is on the reclaim welcome and on the reclaimed ship', async () => {
    const runs: Record<string, unknown>[] = [];
    let winner: Record<string, unknown> | null = null;
    for (let n = 1; n <= ATTEMPTS && !winner; n++) {
      const r = await attempt(n);
      runs.push(r);
      if (r.standInBoughtAnUpgrade) winner = r;
      writeFileSync(join(OUT, TRANSCRIPT), JSON.stringify({ probe: 'reclaim-upgrades', runs }, null, 2));
    }
    writeFileSync(
      join(OUT, TRANSCRIPT),
      JSON.stringify({ probe: 'reclaim-upgrades', attempts: runs.length, foundUpgrade: !!winner, runs }, null, 2),
    );
    console.log('RECLAIM-UPGRADES:', JSON.stringify(runs.map((r) => ({ ...r, welcomes: undefined, economyFramesAfterReclaim: undefined })), null, 2));

    expect(winner, 'a stand-in bought at least one upgrade tier in one of the attempts').not.toBeNull();
    const wireTiers = winner!.wireTiers as Record<string, number>;
    const clientTiers = winner!.clientTiersAfterReclaim as Record<string, number>;

    // The tier was NOT there when the player dropped — so it is authority's own
    // movement of the wallet, not something the client could have remembered.
    expect(nonZeroTier(winner!.tiersBeforeDrop as Record<string, number>)).toBe(false);
    // …and it IS on the raw reclaim welcome frame, off the wire.
    expect(nonZeroTier(wireTiers), 'the reclaim welcome carried a non-zero upgrade tier').toBe(true);
    // …and the shipped client stamped it onto the ship it predicts from.
    expect(clientTiers, 'the reclaimed ship carries the wire wallet’s tiers').toMatchObject(wireTiers);
    expect(winner!.reclaimedSameSeat).toBe(true);
  }, 600_000);
});
