/**
 * src/net/ore-authority.test.ts — **the hold has one owner** (M10, the developer's
 * gru playtest, room SNA4). OWNER: Netcode Engineer (GDD §2.3, §4.2).
 *
 * Two ore findings from one session, and only one of them turned out to be a bug.
 *
 * *"Picked up ore, the HUD briefly showed the hold FULL, then it corrected to the
 * real amount."* Held ore was flapping between a predicted value and authority's —
 * the same fault the hull had (`./hull-authority`, M10-15b) with the sign flipped.
 * The mechanism is the chunk field: a rewind restores the world's scalars, and
 * `thawClocks` deliberately puts the chunk field back **exactly as the replay found
 * it** (`./prediction` `FrozenClocks.chunks`, the ore-flight fix). So a chunk the
 * replay tractored into the hold was handed back to the field afterwards while the
 * ore it paid stayed in `cargo`, and the next reconcile looted the same restored
 * chunk again. At 150 ms that is five re-loots a snapshot: measured here before the
 * fix, **a single 1-ore chunk read 2.000 in a 2-slot hold within two frames** and
 * stayed pinned at the cap until authority's own statement dragged it back down.
 *
 * *"An enemy stole my ore from my live ship."* There is no such mechanic (GDD §2.3:
 * ore drops on death; loose chunks are anyone's) and, as the second half of this
 * file shows with the sim's own ore ledger, no such code path either — a live hold
 * is debited by exactly three things, all of them the player's own: an order's
 * price, the atmosphere drain, and dying. What the wire *could* do was show the
 * player ore that was never theirs and then take it away, which from the pilot's
 * seat is indistinguishable from being robbed. That is the bug above, and this file
 * holds both ends of it shut.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import type { Action, PlayerId } from '@shared/types';
import {
  CHUNK,
  DEPOSIT_RANGE,
  TICK_DT,
  createWorld,
  killShip,
  oreResidual,
  stationOf,
  step,
} from '../sim';
import type { OreChunk, World, WorldConfig } from '../sim';
import { InputQueue } from './input-queue';
import { PredictedMatch } from './prediction';
import { decodeSnapshot, encodeWorldSnapshot } from './snapshot';
import type { DecodedSnapshot } from './snapshot';
import type { InputMessage, PlayerEconomy } from './transport';

const LOCAL: PlayerId = 0;
const RIVAL: PlayerId = 1;

const MATCH: WorldConfig = {
  seed: 11,
  players: [
    { id: 0, shipClass: ShipClass.Vanguard },
    { id: 1, shipClass: ShipClass.Interceptor },
  ],
  asteroidCount: 6,
};

const IDLE: readonly Action[] = [];

/** One way in frames at 60 Hz: the brief's wire, a 150 ms round trip. */
const WIRE_FRAMES = 5;

function shipOf(world: World, id: PlayerId = LOCAL): World['ships'][number] {
  const ship = world.ships.find((s) => s.id === id);
  if (!ship) throw new Error(`no ship ${id}`);
  return ship;
}

/** Park a ship, dead still, at a spot both copies of the world agree on. */
function park(world: World, id: PlayerId, x: number, y: number): void {
  const ship = shipOf(world, id);
  ship.pos.x = x;
  ship.pos.y = y;
  ship.vel.x = 0;
  ship.vel.y = 0;
}

/** One loose chunk of mined ore, the shape `chipAsteroid` leaves behind. */
function dropChunk(world: World, id: number, x: number, y: number, amount = CHUNK.ore): OreChunk {
  const chunk: OreChunk = { id, pos: { x, y }, vel: { x: 0, y: 0 }, amount, radius: CHUNK.radius };
  world.chunks.push(chunk);
  return chunk;
}

/** Open space, well clear of every station's atmosphere — so a hold that moves
 *  moved because of the tractor, and not because the ship was quietly banking. */
function openSpace(world: World): { x: number; y: number } {
  const spot = { x: world.bounds.width / 2, y: world.bounds.height / 2 };
  for (const station of world.stations) {
    const d = Math.hypot(station.pos.x - spot.x, station.pos.y - spot.y);
    if (d < DEPOSIT_RANGE * 2) throw new Error('fixture spot is inside an atmosphere');
  }
  return spot;
}

/** One broadcast as the room sends it: the wallet channel first, when authority has
 *  moved it, then the snapshot for the same tick (`server/room.ts` `syncEconomy`). */
interface Frame {
  /** Null when the wallet has not moved — a quiet channel is the normal case, and it
   *  is exactly why a client that invents ore may never be corrected at all. */
  readonly economy: PlayerEconomy | null;
  readonly snapshot: DecodedSnapshot;
  readonly ackSeq: number;
  readonly ackTick: number;
}

/** The authoritative side, out of the parts the match server uses: the same
 *  `step()`, the same `InputQueue`, the same binary snapshot, and the same
 *  change-detected wallet channel. Only the wire's delay is faked. */
class Authority {
  readonly world = createWorld(MATCH);
  private readonly queue = new InputQueue();
  private acknowledged = 0;
  private acknowledgedAt = 0;
  private wallet: PlayerEconomy | null = null;

  receive(message: InputMessage): void {
    if (this.queue.accept(LOCAL, message, this.world.tick) !== 'late') return;
    this.queue.accept(LOCAL, { ...message, tick: this.world.tick + 1 }, this.world.tick);
  }

  tick(): void {
    const nextTick = this.world.tick + 1;
    const rows = this.queue.take(nextTick);
    for (const row of rows) {
      if (row.id === LOCAL && row.seq > this.acknowledged) {
        this.acknowledged = row.seq;
        this.acknowledgedAt = nextTick;
      }
    }
    step(this.world, rows, TICK_DT);
  }

  broadcast(): Frame {
    const ship = shipOf(this.world);
    const wallet: PlayerEconomy = {
      held: ship.cargo,
      banked: ship.banked,
      tiers: { ...ship.tiers },
    };
    const moved =
      !this.wallet || this.wallet.held !== wallet.held || this.wallet.banked !== wallet.banked;
    if (moved) this.wallet = wallet;
    return {
      economy: moved ? wallet : null,
      snapshot: decodeSnapshot(encodeWorldSnapshot(this.world)),
      ackSeq: this.acknowledged,
      ackTick: this.acknowledgedAt,
    };
  }
}

/** A one-way wire with a fixed delay in frames, FIFO. */
class Link<T> {
  private readonly inflight: { at: number; payload: T }[] = [];
  constructor(private readonly delayFrames: number) {}

  send(frame: number, payload: T): void {
    this.inflight.push({ at: frame + this.delayFrames, payload });
  }

  arrivals(frame: number): T[] {
    const out: T[] = [];
    while (this.inflight.length > 0 && this.inflight[0]!.at <= frame) {
      out.push(this.inflight.shift()!.payload);
    }
    return out;
  }
}

/** A client and a server, wired together and run frame by frame. */
class Match {
  readonly server = new Authority();
  readonly client: PredictedMatch;

  private readonly up: Link<InputMessage>;
  private readonly down: Link<Frame>;
  private seq = 0;
  private frameIndex = 0;

  constructor(delayFrames = WIRE_FRAMES) {
    this.client = new PredictedMatch({ world: createWorld(MATCH), localPlayer: LOCAL });
    this.up = new Link(delayFrames);
    this.down = new Link(delayFrames);
  }

  get frame(): number {
    return this.frameIndex;
  }

  /** Set the same fixture up on both sides — the two worlds are built from one
   *  config and must stay identical, or the test measures its own asymmetry. */
  bothWorlds(setUp: (world: World) => void): void {
    setUp(this.client.world);
    setUp(this.server.world);
  }

  /** One 60 Hz frame. `onFrame` sees the client world after everything has landed —
   *  which is the world a renderer would draw and the HUD would read. */
  run(frames: number, actions: readonly Action[] = IDLE, onFrame?: (frame: number) => void): void {
    for (let i = 0; i < frames; i++) {
      this.frameIndex++;
      const message: InputMessage = {
        type: 'input',
        tick: this.client.tick + 1,
        seq: ++this.seq,
        actions,
      };
      this.up.send(this.frameIndex, message);
      this.client.predict(message.seq, actions);

      for (const inbound of this.up.arrivals(this.frameIndex)) this.server.receive(inbound);
      this.server.tick();
      if (this.server.world.tick % 2 === 0) this.down.send(this.frameIndex, this.server.broadcast());

      for (const inbound of this.down.arrivals(this.frameIndex)) {
        if (inbound.economy) this.client.stageEconomy(inbound.economy, inbound.snapshot.tick);
        this.client.reconcile(inbound.snapshot, inbound.ackSeq, inbound.ackTick);
      }
      onFrame?.(this.frameIndex);
    }
  }

  /** The hold the HUD reads, per frame (`src/ui/hud.ts` draws `frame.cargo`). */
  holdTrace(frames: number, actions: readonly Action[] = IDLE): number[] {
    const seen: number[] = [];
    this.run(frames, actions, () => seen.push(shipOf(this.client.world).cargo));
    return seen;
  }
}

const rises = (series: readonly number[]): boolean =>
  series.every((v, i) => i === 0 || v >= series[i - 1]! - 1e-9);

const falls = (series: readonly number[]): boolean =>
  series.every((v, i) => i === 0 || v <= series[i - 1]! + 1e-9);

// ---------------------------------------------------------------------------
// 1. The blip — a pickup the HUD read as a full hold
// ---------------------------------------------------------------------------

describe('held ore has one owner, at 150 ms (M10; GDD §2.3)', () => {
  it('reads a 1-ore chunk as 1 ore, never as a full hold', () => {
    const match = new Match();
    const spot = openSpace(match.server.world);
    match.bothWorlds((world) => {
      park(world, LOCAL, spot.x, spot.y);
      park(world, RIVAL, spot.x + 4000, spot.y); // far away: this pickup is uncontested
      dropChunk(world, 90_001, spot.x + 60, spot.y);
    });

    const seen = match.holdTrace(60);
    const cap = shipOf(match.client.world).cargoCap;

    // The regression, stated as the developer saw it: one chunk, one ore, and a hold
    // that read FULL. Before the fix this series reached `cap` (2.000) within two
    // frames of the pickup and stayed pinned there — one mint per reconcile.
    expect(Math.max(...seen)).toBeLessThan(cap);
    expect(Math.max(...seen)).toBeCloseTo(CHUNK.ore, 6);
    // Monotonic: every value the player reads is one they keep. Nothing overshoots,
    // so there is nothing to correct back down.
    expect(rises(seen)).toBe(true);
    // And it does land — authority's word, one wire trip after the chunk arrived.
    expect(shipOf(match.client.world).cargo).toBeCloseTo(CHUNK.ore, 6);
    expect(shipOf(match.client.world).cargo).toBeCloseTo(shipOf(match.server.world).cargo, 6);
  });

  it('agrees with authority chunk after chunk, and never runs ahead of it', () => {
    const match = new Match();
    const spot = openSpace(match.server.world);
    match.bothWorlds((world) => {
      park(world, LOCAL, spot.x, spot.y);
      park(world, RIVAL, spot.x + 4000, spot.y);
      // A whole hold's worth, arriving from different bearings — the shape of mining
      // a rock out (`chipAsteroid` scatters chunks around it).
      dropChunk(world, 90_001, spot.x + 60, spot.y);
      dropChunk(world, 90_002, spot.x - 70, spot.y + 20);
    });

    const seen: number[] = [];
    match.run(90, IDLE, () => {
      const client = shipOf(match.client.world).cargo;
      seen.push(client);
      // The invariant under the whole rule: the client's hold is never *ahead* of the
      // server's. A hold that leads is a hold that will have to be taken back.
      expect(client).toBeLessThanOrEqual(shipOf(match.server.world).cargo + 1e-9);
    });

    expect(rises(seen)).toBe(true);
    expect(shipOf(match.client.world).cargo).toBeCloseTo(2 * CHUNK.ore, 6);
    expect(shipOf(match.client.world).cargo).toBeCloseTo(shipOf(match.server.world).cargo, 6);
  });

  it('conserves ore on the client: the field plus the hold is what was put in', () => {
    // The mechanism stated as accounting rather than as a HUD reading. A chunk the
    // replay tractors in is handed back to the field by `thawClocks` — so if the ore
    // it paid stays in the hold, the client's own world is holding *more ore than
    // exists in it*, and that is the mint the developer watched fill the bar. The
    // client's books have to balance every frame, chunk in the field or ore in the
    // hold, exactly like the server's (`src/sim/ore-ledger` `liveOre`).
    const match = new Match();
    const spot = openSpace(match.server.world);
    match.bothWorlds((world) => {
      park(world, LOCAL, spot.x, spot.y);
      park(world, RIVAL, spot.x + 4000, spot.y);
      dropChunk(world, 90_001, spot.x + 60, spot.y);
    });

    const put = CHUNK.ore;
    match.run(120, IDLE, () => {
      const world = match.client.world;
      const loose = world.chunks.filter((c) => !c.deposit).reduce((n, c) => n + c.amount, 0);
      // Never *more* than was put in. The client may briefly hold less — for the one
      // wire trip between the chunk arriving and authority stating the hold, the ore
      // is in flight and shows in neither place, which is the cost of the rule and is
      // paid in the honest direction. Holding more is the mint, and cannot happen.
      expect(shipOf(world).cargo + loose).toBeLessThanOrEqual(put + 1e-9);
    });
    // And it ends where it must: the chunk gone from the field, its ore in the hold.
    expect(match.client.world.chunks.length).toBe(0);
    expect(shipOf(match.client.world).cargo).toBeCloseTo(put, 6);
  });

  it('still shows the hold draining at once when the player banks it', () => {
    // The other half of the rule, and the reason the hold is not simply authority's
    // outright: ore *leaving* runs on the player's own timeline — their thrusters put
    // them in the atmosphere — and the deposit telegraph is keyed to the hold's
    // integer boundaries (`src/sim/step.ts` `updateDeposits`). A hold that waited a
    // round trip to fall would take the banking beat with it.
    const match = new Match();
    match.bothWorlds((world) => {
      const station = stationOf(world, LOCAL)!;
      park(world, LOCAL, station.pos.x, station.pos.y);
      park(world, RIVAL, station.pos.x + 4000, station.pos.y);
      shipOf(world, LOCAL).cargo = 2;
    });

    const seen: number[] = [];
    // The couriers are watched *while* they fly: they are absorbed at the station
    // (`updateDepositFlight`), so a field read after the drain has finished is empty
    // however well the telegraph worked.
    let couriers = 0;
    match.run(120, IDLE, () => {
      seen.push(shipOf(match.client.world).cargo);
      couriers = Math.max(couriers, match.client.world.chunks.filter((c) => c.deposit).length);
    });

    // It falls, it never bounces back up, and it empties.
    expect(falls(seen)).toBe(true);
    expect(shipOf(match.client.world).cargo).toBeLessThan(1e-6);
    expect(shipOf(match.client.world).banked).toBeCloseTo(shipOf(match.server.world).banked, 3);
    // And the telegraph the drain owes: the client drew couriers, so the player saw
    // the ore fly home rather than watching a number change (field report p8).
    expect(couriers).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. "An enemy stole my ore from my live ship"
// ---------------------------------------------------------------------------

/** A per-tick sim log of every ore flow the ledger tracks — the evidence the
 *  investigation is answered with, rather than a guess (`src/sim/ore-ledger`). */
interface OreLog {
  readonly tick: number;
  readonly mine: number;
  readonly theirs: number;
  readonly looted: number;
  readonly deposited: number;
  readonly spent: number;
  readonly residual: number;
}

function logOre(world: World): OreLog {
  const ledger = world.ledger!;
  return {
    tick: world.tick,
    mine: shipOf(world, LOCAL).cargo,
    theirs: shipOf(world, RIVAL).cargo,
    looted: ledger.looted,
    deposited: ledger.deposited,
    spent: ledger.spent,
    residual: oreResidual(world),
  };
}

describe('nothing takes ore out of a live hold (GDD §2.3; the SNA4 theft report)', () => {
  it('a contested chunk goes to whoever is nearer — and never out of a hold', () => {
    // The likely reading of the report (a): a loose chunk beside the player, tractored
    // in by the enemy who was nearer to it. Legal — a mined chunk belongs to nobody
    // until someone touches it (GDD §2.3) — and this is what it looks like in the
    // ledger, so it can be told apart from a hold being debited.
    const world = createWorld(MATCH);
    const spot = openSpace(world);
    park(world, LOCAL, spot.x, spot.y);
    park(world, RIVAL, spot.x + 150, spot.y);
    shipOf(world, LOCAL).cargo = 1; // the player is already carrying ore
    // A chunk in the gap, nearer the rival. Both ships are within tractor range of it
    // (`TRACTOR.range` is 120): a genuine contest, decided by distance.
    dropChunk(world, 90_001, spot.x + 100, spot.y);

    // The fixture hands out ore the ledger never saw arrive, so conservation is
    // measured from where the fixture leaves it: the residual must not *move*.
    const opening = oreResidual(world);
    const log: OreLog[] = [];
    for (let t = 0; t < 240; t++) {
      step(world, [], TICK_DT);
      log.push(logOre(world));
    }

    const last = log[log.length - 1]!;
    // The rival got the loose chunk…
    expect(last.theirs).toBeCloseTo(CHUNK.ore, 6);
    expect(last.looted).toBeCloseTo(CHUNK.ore, 6);
    // …and the ore in the player's hold never moved. Not on one of the 240 ticks.
    expect(log.every((row) => row.mine === 1)).toBe(true);
    // The economy balances the whole way: no ore minted, none lost (`./ore-ledger`).
    expect(Math.max(...log.map((r) => Math.abs(r.residual - opening)))).toBeLessThan(1e-6);
  });

  it('an enemy sitting on top of a loaded ship takes nothing from it', () => {
    // The report as stated (b): if a live hold could be debited by an enemy, the way
    // to see it is to put one on the player's hull for four seconds and watch the
    // ledger. Every ore flow the sim has is recorded there, so a debit could not hide.
    const world = createWorld(MATCH);
    const spot = openSpace(world);
    park(world, LOCAL, spot.x, spot.y);
    park(world, RIVAL, spot.x + 30, spot.y); // hull to hull, well inside tractor range
    shipOf(world, LOCAL).cargo = 2; // a full 2-slot hold: the tempting target
    shipOf(world, LOCAL).hull = 999; // survive the scrape, so this stays a theft test

    const log: OreLog[] = [];
    for (let t = 0; t < 240; t++) {
      step(world, [], TICK_DT);
      log.push(logOre(world));
    }

    expect(log.every((row) => row.mine === 2)).toBe(true);
    expect(log.every((row) => row.theirs === 0)).toBe(true);
    // Nothing looted, deposited or spent: there is no flow in this simulation that
    // moves ore from one live ship to another, and this is the ledger saying so.
    const last = log[log.length - 1]!;
    expect(last.looted).toBe(0);
    expect(last.deposited).toBe(0);
    expect(last.spent).toBe(0);
  });

  it('drops the hold only on death — and then it is loose ore, not the killer’s', () => {
    // The one mechanic the GDD does have (§2.3, §2.7): half the hold bursts as debris
    // where the ship exploded. It goes to the *field*, not to the killer — whoever
    // reaches it first, exactly like any other loose chunk.
    const world = createWorld(MATCH);
    const spot = openSpace(world);
    park(world, LOCAL, spot.x, spot.y);
    park(world, RIVAL, spot.x + 900, spot.y); // out of tractor range: nobody collects yet
    shipOf(world, LOCAL).cargo = 2;
    const opening = oreResidual(world); // the fixture's own ore, off the ledger's books

    killShip(world, shipOf(world, LOCAL));
    step(world, [], TICK_DT);

    expect(shipOf(world, LOCAL).cargo).toBe(0);
    expect(shipOf(world, RIVAL).cargo).toBe(0); // the killer is handed nothing
    const loose = world.chunks.filter((c) => !c.deposit).reduce((n, c) => n + c.amount, 0);
    expect(loose).toBeGreaterThan(0);
    // Half the hold to the field, half destroyed with the ship (`killShip`) — both
    // halves accounted for, so the death drop is a transfer and a sink, not a leak.
    expect(Math.abs(oreResidual(world) - opening)).toBeLessThan(1e-6);
  });

  it('the wire never debits a live hold either, over five seconds at 150 ms', () => {
    // The half of the report the wire *could* have caused, and did: a hold the client
    // had inflated to the cap, losing the difference the moment authority spoke —
    // which, from the pilot's seat with an enemy on screen, is ore going missing.
    // Held ore now falls only when the player banks it, spends it or dies, none of
    // which happens here, so the series never steps backwards at any latency.
    const match = new Match();
    const spot = openSpace(match.server.world);
    match.bothWorlds((world) => {
      park(world, LOCAL, spot.x, spot.y);
      park(world, RIVAL, spot.x + 40, spot.y); // an enemy right on top of the player
      dropChunk(world, 90_001, spot.x + 60, spot.y + 10);
    });

    const seen = match.holdTrace(300);
    expect(rises(seen)).toBe(true);
    expect(shipOf(match.client.world).cargo).toBeCloseTo(shipOf(match.server.world).cargo, 6);
  });
});
