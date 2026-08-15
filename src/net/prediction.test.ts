/**
 * src/net/prediction.test.ts — client-side prediction and reconciliation
 * (GDD §4.2).
 *
 * The two properties the whole feature stands on, and neither of them is
 * observable from a single call:
 *
 *  1. **Replay.** When a snapshot arrives it describes a tick that is already in
 *     the past. Everything the player has pressed since must survive being
 *     rewound onto it — so a client whose prediction was *right* must land back
 *     exactly where it already was, and one whose prediction was wrong must land
 *     on the server's answer with its own recent input still applied on top.
 *  2. **Convergence.** After a divergence the client could not have predicted —
 *     a hit, a shove, a packet the server never got — the error must fall to the
 *     wire's own quantization floor and stay there, rather than oscillating or
 *     settling on a permanent offset.
 *
 * Both are tested against a real authority: a world stepped by the same
 * `step()` the match server calls, fed through the same `InputQueue`, encoded
 * through the same binary snapshot. The only thing faked here is the wire's
 * delay, which is the one thing a unit test can hold still.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass, UpgradeTrack } from '@shared/types';
import type { Action, PlayerId } from '@shared/types';
import {
  ORE_JOURNAL_CAPACITY,
  TICK_DT,
  TURRET,
  createWorld,
  shipCargoCap,
  stockTiers,
  step,
  trackSpec,
} from '../sim';
import type { MiningStation, UpgradeTiers, World, WorldConfig } from '../sim';
import { InputQueue } from './input-queue';
import {
  MAX_LEAD_TICKS,
  MAX_PREDICTED_SHOTS,
  MAX_TRIM_PER_RECONCILE,
  MIN_LEAD_TICKS,
  PredictedMatch,
  SNAP_THRESHOLD,
  applySnapshot,
} from './prediction';
import { DEFAULT_ORDER_TTL_TICKS } from './order-ledger';
import { LOCAL_SHOT_BASE } from './presentation';
import { decodeSnapshot, encodeWorldSnapshot } from './snapshot';
import type { DecodedSnapshot } from './snapshot';
import type { InputMessage, PlayerEconomy } from './transport';

const LOCAL: PlayerId = 0;

/** Two seats and a small field: the arena both sides build from `matchStart`. */
const MATCH: WorldConfig = {
  seed: 7,
  players: [
    { id: 0, shipClass: ShipClass.Vanguard },
    { id: 1, shipClass: ShipClass.Interceptor },
  ],
  asteroidCount: 8,
};

const THRUST: readonly Action[] = [{ type: 'thrust', dir: { x: 1, y: 0 } }];

function shipOf(world: World, id: PlayerId = LOCAL): World['ships'][number] {
  const ship = world.ships.find((s) => s.id === id);
  if (!ship) throw new Error(`no ship ${id}`);
  return ship;
}

function distance(a: World, b: World): number {
  return Math.hypot(shipOf(a).pos.x - shipOf(b).pos.x, shipOf(a).pos.y - shipOf(b).pos.y);
}

/** One broadcast, as it would leave the server: the decoded snapshot plus the
 *  per-client ack that rides in the frame header (`./wire`). */
interface Broadcast {
  snapshot: DecodedSnapshot;
  ackSeq: number;
  /** The tick `ackSeq` was actually simulated at — the alignment half of the ack
   *  (`./transport` `SnapshotMessage.ackTick`). */
  ackTick: number;
}

/**
 * The authoritative side, assembled out of the same parts the match server uses
 * — `InputQueue`, `step`, `encodeWorldSnapshot` — including the two rules that
 * matter to a predicting client: late input is re-filed onto the next
 * unsimulated tick, and the ack names input that has been **run**.
 */
class Authority {
  readonly world = createWorld(MATCH);
  private readonly queue = new InputQueue();
  private acknowledged = 0;
  private acknowledgedAt = 0;
  /** How often a client's input missed its tick — the lateness a lead exists
   *  to prevent. */
  lateArrivals = 0;

  receive(message: InputMessage): void {
    const verdict = this.queue.accept(LOCAL, message, this.world.tick);
    if (verdict !== 'late') return;
    this.lateArrivals++;
    this.queue.accept(LOCAL, { ...message, tick: this.world.tick + 1 }, this.world.tick);
  }

  tick(): void {
    const nextTick = this.world.tick + 1;
    const rows = this.queue.take(nextTick);
    for (const row of rows) {
      if (row.id === LOCAL && row.seq > this.acknowledged) {
        this.acknowledged = row.seq;
        // The tick it is being run at, which a re-filed late arrival makes
        // different from the tick the client asked for (`server/room.ts`).
        this.acknowledgedAt = nextTick;
      }
    }
    step(this.world, rows, TICK_DT);
  }

  broadcast(): Broadcast {
    return {
      snapshot: decodeSnapshot(encodeWorldSnapshot(this.world)),
      ackSeq: this.acknowledged,
      ackTick: this.acknowledgedAt,
    };
  }
}

/** A seeded LCG, so a "150 ms + jitter" run is reproducible frame for frame
 *  rather than depending on `Math.random`. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * A wire with a one-way delay in frames, plus optional additive jitter (never
 * negative — a packet cannot beat the base latency, so jitter only ever delays,
 * the same shape a real jitter buffer sees). Arrivals are drained in `at` order
 * so a jittered packet cannot overtake an earlier one on the same link.
 */
class Link<T> {
  private readonly inflight: { at: number; payload: T }[] = [];
  constructor(
    private readonly delayFrames: number,
    private readonly jitterFrames = 0,
    private readonly rng: () => number = () => 0,
  ) {}

  send(frame: number, payload: T): void {
    const jitter = this.jitterFrames > 0 ? Math.floor(this.rng() * (this.jitterFrames + 1)) : 0;
    this.inflight.push({ at: frame + this.delayFrames + jitter, payload });
  }

  arrivals(frame: number): T[] {
    const due = this.inflight.filter((p) => p.at <= frame).sort((a, b) => a.at - b.at);
    for (const packet of due) this.inflight.splice(this.inflight.indexOf(packet), 1);
    return due.map((p) => p.payload);
  }
}

/** A client and a server, wired together, run frame by frame. */
class Match {
  readonly server = new Authority();
  readonly client = new PredictedMatch({ world: createWorld(MATCH), localPlayer: LOCAL });
  readonly errors: number[] = [];
  /** Every measured input-tick misalignment, in ticks (`ReconcileReport.appliedDelta`);
   *  reconciles that could not be measured are absent rather than zero. */
  readonly alignment: number[] = [];

  private readonly up: Link<InputMessage>;
  private readonly down: Link<Broadcast>;
  private seq = 0;
  private frame = 0;

  constructor(delayFrames = 0, jitterFrames = 0) {
    const rng = lcg(0x5eed);
    this.up = new Link(delayFrames, jitterFrames, rng);
    this.down = new Link(delayFrames, jitterFrames, rng);
  }

  /** One 60 Hz frame: the client presses and predicts, the server runs the tick
   *  it can, and whatever has finished crossing the wire is delivered. */
  run(frames: number, actions: readonly Action[] = THRUST): void {
    for (let i = 0; i < frames; i++) {
      this.frame++;
      const message: InputMessage = {
        type: 'input',
        tick: this.client.tick + 1,
        seq: ++this.seq,
        actions,
      };
      this.up.send(this.frame, message);
      this.client.predict(message.seq, actions);

      for (const inbound of this.up.arrivals(this.frame)) this.server.receive(inbound);
      this.server.tick();
      // 30 Hz broadcast on the 60 Hz sim — the day-0 spike's divisor
      // (docs/netcode-spike.md).
      if (this.server.world.tick % 2 === 0) this.down.send(this.frame, this.server.broadcast());

      for (const inbound of this.down.arrivals(this.frame)) {
        const report = this.client.reconcile(inbound.snapshot, inbound.ackSeq, inbound.ackTick);
        if (report.applied) this.errors.push(report.error);
        if (report.applied && report.appliedDelta !== null) {
          this.alignment.push(report.appliedDelta);
        }
      }
    }
  }
}

describe('prediction', () => {
  it('moves the local ship on the tick the key goes down, with nothing acknowledged', () => {
    const client = new PredictedMatch({ world: createWorld(MATCH), localPlayer: LOCAL });
    const start = { ...shipOf(client.world).pos };

    client.predict(1, THRUST);

    // One tick, no server, no snapshot, no waiting: this is the whole point of
    // predicting (GDD §4.2 — "makes input feel instant").
    expect(client.tick).toBe(1);
    expect(shipOf(client.world).pos).not.toEqual(start);
    expect(client.pendingCount).toBe(1);
  });

  it('replays the pending inputs a snapshot does not acknowledge', () => {
    const server = new Authority();
    const client = new PredictedMatch({ world: createWorld(MATCH), localPlayer: LOCAL });

    // Six ticks, both sides, identical input — a client and a server in perfect
    // agreement, which is the case a correction must not disturb.
    for (let tick = 1; tick <= 6; tick++) {
      server.receive({ type: 'input', tick, seq: tick, actions: THRUST });
      client.predict(tick, THRUST);
      if (tick <= 4) server.tick();
    }
    const predicted = { ...shipOf(client.world).pos };

    const report = client.reconcile(server.broadcast().snapshot, server.broadcast().ackSeq);

    // The snapshot describes tick 4; ticks 5 and 6 are the player's own recent
    // past and are replayed on top of it.
    expect(report.applied).toBe(true);
    expect(report.acknowledged).toBe(4);
    expect(report.replayed).toBe(2);
    expect(client.pendingCount).toBe(2);
    // And the client lands back on the tick it was already flying …
    expect(client.tick).toBe(6);
    // … in the same place, because it predicted correctly. The residue is the
    // wire's integer quantization and nothing else (`./snapshot`).
    expect(shipOf(client.world).pos.x).toBeCloseTo(predicted.x, 0);
    expect(shipOf(client.world).pos.y).toBeCloseTo(predicted.y, 0);
    expect(report.error).toBeLessThan(1);
  });

  it('replays everything past the ack, not everything past the snapshot', () => {
    const server = new Authority();
    const client = new PredictedMatch({ world: createWorld(MATCH), localPlayer: LOCAL });
    for (let tick = 1; tick <= 6; tick++) client.predict(tick, THRUST);
    // The server ran four ticks but only ever heard about the first two: input
    // 3 and 4 were lost, so their effect has not happened anywhere yet.
    for (let tick = 1; tick <= 2; tick++) {
      server.receive({ type: 'input', tick, seq: tick, actions: THRUST });
    }
    for (let tick = 1; tick <= 4; tick++) server.tick();

    const { snapshot, ackSeq } = server.broadcast();
    const report = client.reconcile(snapshot, ackSeq);

    expect(ackSeq).toBe(2);
    expect(report.replayed).toBe(4);
    // Four inputs replayed on tick 4 leaves the client on tick 8 rather than the
    // 6 it was flying — a client holds on to a press until the server admits to
    // having run it, so input the server never got inflates the lead instead of
    // vanishing. That errs in the safe direction (the client stays *ahead* of
    // the server, where its input is early rather than late) and unwinds the
    // moment any later input is acknowledged.
    expect(client.tick).toBe(8);
    // Two ticks of thrust the server never applied means the ship really is
    // somewhere else, and the client is told so.
    expect(report.error).toBeGreaterThan(0);
  });

  it('ignores a snapshot older than one it has already applied', () => {
    const match = new Match();
    match.run(8);
    const stale = match.server.broadcast();
    match.run(8);

    const report = match.client.reconcile(stale.snapshot, stale.ackSeq);

    // Snapshots are full state, not deltas (docs/netcode-spike.md), so an old
    // one has nothing to add and applying it would drag the world backwards.
    expect(report.applied).toBe(false);
    expect(report.replayed).toBe(0);
  });
});

describe('reconciliation', () => {
  it('converges after a divergence the client could not have predicted', () => {
    const match = new Match();
    match.run(10);
    expect(distance(match.client.world, match.server.world)).toBeLessThan(1);

    // The artificial divergence: authority shoves the ship 200 units sideways —
    // stand-in for a collision, a hit, or a tick of input that never landed.
    // Nothing the client knows about, so its prediction is now simply wrong.
    shipOf(match.server.world).pos.x += 200;
    const before = match.errors.length;

    match.run(20);

    const after = match.errors.slice(before);
    // It is *reported* — the client can see how wrong it was …
    expect(Math.max(...after)).toBeGreaterThan(150);
    // … it is corrected on the very next snapshot …
    expect(after[1] ?? 0).toBeLessThan(1);
    // … and it stays corrected, rather than oscillating around the fix.
    expect(Math.max(...after.slice(2))).toBeLessThan(1);
    expect(distance(match.client.world, match.server.world)).toBeLessThan(1);
  });

  it('converges over a laggy wire, and stops the client being late', () => {
    // Three frames each way — 100 ms of round trip, a plausible classroom link.
    const match = new Match(3);
    match.run(40);

    // The client ends up running ahead of the server by roughly the input it has
    // in flight, which is what makes its input arrive *for* the tick it names
    // rather than after it. Nothing sets that lead: it falls out of replaying
    // every unacknowledged input on top of each snapshot.
    expect(match.client.lead).toBeGreaterThan(0);
    const lateAfterWarmup = match.server.lateArrivals;
    match.run(40);
    expect(match.server.lateArrivals).toBe(lateAfterWarmup);

    // And the prediction is right: the client's ship is where the server's is,
    // to within the wire's own rounding.
    expect(match.errors.at(-1)).toBeLessThan(1);
  });

  it('resyncs rather than guesses when the snapshot is outside its history', () => {
    const client = new PredictedMatch({ world: createWorld(MATCH), localPlayer: LOCAL });
    for (let tick = 1; tick <= 4; tick++) client.predict(tick, THRUST);

    // A tick this client has never predicted — a reclaim inside the grace window
    // (GDD §4.2), or a tab that was asleep. There is nothing to correct toward,
    // so authority is taken wholesale.
    const server = new Authority();
    for (let i = 0; i < 300; i++) server.tick();
    const report = client.reconcile(server.broadcast().snapshot, 0);

    expect(report.resynced).toBe(true);
    expect(client.tick).toBe(300);
    // Predictions from the abandoned timeline are dropped, not replayed onto a
    // world five seconds ahead of them.
    expect(client.pendingCount).toBe(0);
    expect(distance(client.world, server.world)).toBeLessThan(1);
  });

  it('blends a small correction out over the blend window and snaps a big one', () => {
    // Small: a shove worth smoothing leaves the renderer an offset to walk off,
    // so the world is authoritative *now* while the picture catches up over
    // RECONCILE_BLEND_FRAMES (M10 reconcile brief).
    const smooth = new Match();
    smooth.run(10);
    shipOf(smooth.server.world).pos.x += 8;
    smooth.run(2);
    expect(Math.hypot(smooth.client.renderOffset.x, smooth.client.renderOffset.y)).toBeGreaterThan(
      0,
    );
    // It decays to sub-pixel — invisible — over the blend window. It need not
    // reach a hard zero: the wire quantizes position to whole units every
    // snapshot, so a well-predicted ship carries a perpetual fraction-of-a-unit
    // offset, which is exactly the twitch the blend exists to hide rather than a
    // divergence to correct. (A slower blend than the old fixed 0.8 decay leaves
    // that residue slightly larger, still far under a pixel.)
    smooth.run(40);
    expect(Math.hypot(smooth.client.renderOffset.x, smooth.client.renderOffset.y)).toBeLessThan(1);

    // Big: a respawn-sized move is not slid across the map. It is snapped —
    // teleport-grade, past SNAP_THRESHOLD — so it leaves no blend offset behind
    // (only the same sub-pixel quantization residue any tick carries).
    const snap = new Match();
    snap.run(10);
    shipOf(snap.server.world).pos.x += 900;
    snap.run(2);
    expect(Math.hypot(snap.client.renderOffset.x, snap.client.renderOffset.y)).toBeLessThan(1);
  });

  it('keeps corrections smooth, never teleport-grade, during normal flight at ~150 ms + jitter', () => {
    // The developer's actual condition, made a permanent test (M10 brief): a gru
    // client on an iad fleet at ~150 ms RTT with jitter. One-way 4 frames (≈67 ms)
    // plus 0–3 frames of additive jitter puts the round trip around 150–220 ms.
    const match = new Match(4, 3);
    match.run(60); // warm up — let the client's lead settle against the latency
    const before = match.errors.length;
    match.run(300, THRUST); // five seconds of steady, ordinary flight

    const flight = match.errors.slice(before);
    expect(flight.length).toBeGreaterThan(60); // the run actually reconciled

    // The guarantee the developer asked for: normal flight never produces a
    // teleport-grade correction. Every reconcile lands inside the smooth-blend
    // regime the renderer hides (< SNAP_THRESHOLD), so a small per-snapshot
    // divergence decays as an offset and is never the "constant server rollback".
    expect(Math.max(...flight)).toBeLessThan(SNAP_THRESHOLD);
    // And the typical correction is tiny — the wire's ~1-unit quantization floor
    // plus the occasional one-tick jitter miss, not a standing divergence.
    const mean = flight.reduce((a, b) => a + b, 0) / flight.length;
    expect(mean).toBeLessThan(5);
  });
});

describe('the alignment instrument', () => {
  it('reads zero while the server is running each input at the tick it was predicted for', () => {
    // The whole point of the number (M10 tick-alignment): a client stamps an input
    // with the tick it predicted it at, the server files it under that tick and runs
    // it there, and the difference is nothing at all. Four frames of one-way delay is
    // the developer's own condition, and the client's lead covers it comfortably.
    const match = new Match(4);
    match.run(60); // warm-up: the opening frames are sent before any lead exists,
    const opening = match.server.lateArrivals; // so a few genuinely do arrive late
    const settled = match.alignment.length;
    match.run(240);

    const flight = match.alignment.slice(settled);
    expect(flight.length).toBeGreaterThan(50);
    // Nothing arrived late once the lead covered the wire…
    expect(match.server.lateArrivals).toBe(opening);
    // …so every input ran at exactly the tick it was predicted for. This is the
    // measurement that took input-tick misalignment off the suspect list for the
    // developer's condition and sent the hunt to the wire's own precision
    // (`./snapshot` `POS_SCALE`).
    expect(Math.max(...flight)).toBe(0);
    expect(Math.min(...flight)).toBe(0);
  });

  it('states the gap in ticks when a late arrival is re-filed onto a later tick', () => {
    // A wire whose delay the client's lead cannot cover: the input lands after its
    // tick has already been simulated, so authority re-files it onto the next free
    // one (`server/room.ts` `acceptInput`) and runs it *there*. The client predicted
    // it somewhere else, and until this instrument existed nothing in the system
    // could say so — the only visible symptom was a correction that never went away.
    const match = new Match(4);
    match.run(60);
    // Freeze the client's clock relative to the server's by stamping input for
    // ticks the server has already passed: the same shape a retransmit stall leaves
    // behind, without needing one.
    const server = match.server;
    const client = match.client;
    const stale: InputMessage = { type: 'input', tick: server.world.tick - 3, seq: 9_000, actions: THRUST };
    const lateBefore = server.lateArrivals;
    server.receive(stale);
    expect(server.lateArrivals).toBe(lateBefore + 1);
    server.tick();

    const broadcast = server.broadcast();
    // Authority ran seq 9000 at its own next tick, not at the tick the message named.
    expect(broadcast.ackSeq).toBe(9_000);
    expect(broadcast.ackTick).toBeGreaterThan(stale.tick);

    // And a client that predicted that seq four ticks earlier is told exactly how
    // far off it is standing.
    client.predict(9_000, THRUST);
    const predictedTick = client.pending.at(-1)!.tick;
    const report = client.reconcile(broadcast.snapshot, broadcast.ackSeq, broadcast.ackTick);
    expect(report.appliedDelta).toBe(broadcast.ackTick - predictedTick);
  });

  it('says null rather than zero when there is nothing to compare', () => {
    const client = new PredictedMatch({ world: createWorld(MATCH), localPlayer: LOCAL });
    const authority = new Authority();
    authority.tick();
    const broadcast = authority.broadcast();

    // No `ackTick` at all — an offline transport, or a wire older than the field.
    expect(client.reconcile(broadcast.snapshot, 0).appliedDelta).toBeNull();
    // An ack naming input this client never held: unmeasurable, and *not* aligned.
    authority.tick();
    const next = authority.broadcast();
    expect(client.reconcile(next.snapshot, 42, 7).appliedDelta).toBeNull();
  });
});

describe('applySnapshot', () => {
  it('writes what the wire carries and leaves alone what it does not', () => {
    const world = createWorld(MATCH);
    const authority = createWorld(MATCH);
    const ship = shipOf(world);
    // State that never streams: the hold, the bank, and the upgrade ladder are
    // the player's own predicted business (`./snapshot` — ships and projectiles
    // only), so a snapshot must not quietly zero them.
    ship.cargo = 2;
    ship.banked = 11;
    shipOf(authority).pos.x += 40;

    applySnapshot(world, decodeSnapshot(encodeWorldSnapshot(authority)));

    expect(ship.pos.x).toBeCloseTo(shipOf(authority).pos.x, 0);
    expect(ship.cargo).toBe(2);
    expect(ship.banked).toBe(11);
  });

  it('deactivates every pooled projectile the snapshot does not name', () => {
    const world = createWorld(MATCH);
    const authority = createWorld(MATCH);
    // The pool grows only when a world fires something, so a client that has
    // predicted no turret fire starts with none at all.
    expect(world.projectiles).toHaveLength(0);
    world.projectiles.push({
      id: 3,
      active: true,
      owner: 1,
      pos: { x: 10, y: 10 },
      vel: { x: 0, y: 0 },
      damage: 0,
      radius: 4,
      life: 1,
    });

    applySnapshot(world, decodeSnapshot(encodeWorldSnapshot(authority)));

    // The pool is sparse and reused: a shot the server no longer lists has
    // landed or expired, and leaving it lit would draw a ghost (`src/sim/state`).
    expect(world.projectiles[0]?.active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The wallet
// ---------------------------------------------------------------------------

/** A wallet as the server would state it (`./transport` EconomyMessage). */
function wallet(held: number, banked: number, tiers: Partial<UpgradeTiers> = {}): PlayerEconomy {
  return { held, banked, tiers: { ...stockTiers(), ...tiers } };
}

describe('the wallet on the wire', () => {
  /** A client and a server in agreement, four ticks in, with two presses the
   *  server has not run yet — the steady state a wallet correction lands in. */
  function flying(): { server: Authority; client: PredictedMatch } {
    const server = new Authority();
    const client = new PredictedMatch({ world: createWorld(MATCH), localPlayer: LOCAL });
    for (let tick = 1; tick <= 6; tick++) {
      server.receive({ type: 'input', tick, seq: tick, actions: THRUST });
      client.predict(tick, THRUST);
      if (tick <= 4) server.tick();
    }
    return { server, client };
  }

  it('re-bases the hold and the bank on authority at the snapshot’s tick', () => {
    const { server, client } = flying();
    // The compounding error this channel exists for: reconciliation rewinds the
    // clock but the snapshot carries no wallet, so ore the client tractored in
    // during its unacked ticks is re-earned once per reconcile it survives. Stand
    // in for however many reconciles it took — the client's hold is simply wrong.
    shipOf(client.world).cargo = 5.5;
    shipOf(client.world).banked = 30;

    client.stageEconomy(wallet(1.25, 12), server.world.tick);
    const { snapshot, ackSeq } = server.broadcast();
    client.reconcile(snapshot, ackSeq);

    // The inflated wallet is gone and authority's 13.25 ore is what the client
    // holds. Not field for field: the ship is parked on its home station, so the
    // two replayed ticks drain a sliver of the hold into the bank
    // (`__oreDepositStage`) — that is the *sim* moving the player's own ore on top
    // of authority's figure, which is exactly what a replay is for.
    const ship = shipOf(client.world);
    expect(ship.cargo + ship.banked).toBeCloseTo(13.25, 6);
    expect(ship.cargo).toBeLessThanOrEqual(1.25);
    expect(ship.banked).toBeGreaterThanOrEqual(12);
    // And it is consumed, not re-applied on every later snapshot.
    expect(client.stagedEconomyTick).toBe(-1);
  });

  it('restores the tiers *and* the ceilings they scale', () => {
    const { server, client } = flying();
    const stock = shipOf(client.world).maxHull;

    client.stageEconomy(wallet(0, 40, { [UpgradeTrack.Hull]: 2, [UpgradeTrack.Cargo]: 1 }), server.world.tick);
    client.reconcile(server.broadcast().snapshot, server.broadcast().ackSeq);

    const ship = shipOf(client.world);
    expect(ship.tiers[UpgradeTrack.Hull]).toBe(2);
    // `maxHull` and `cargoCap` are stored, not derived per read (`src/sim/upgrades`
    // `refreshDerivedStats`): a ship handed only its `tiers` would fly the fight
    // with tier-0 ceilings and mis-predict every hit it takes.
    expect(ship.maxHull).toBeGreaterThan(stock);
    expect(ship.cargoCap).toBe(shipCargoCap(ship));
  });

  it('holds a wallet from a tick the client has not reconciled yet', () => {
    const { server, client } = flying();
    const future = server.world.tick + 20;
    const before = { ...shipOf(client.world) };
    client.stageEconomy(wallet(before.banked + 25, before.banked + 25), future);

    client.reconcile(server.broadcast().snapshot, server.broadcast().ackSeq);

    // Applying it now would stamp a wallet from the future onto the present and
    // then let the replay add to it — the wallet is written in *its own* tick's
    // reconcile or not at all, so the client's own predicted figures stand.
    expect(shipOf(client.world).banked).toBeCloseTo(before.banked, 6);
    expect(client.stagedEconomyTick).toBe(future);
  });

  it('keeps the newest statement when two arrive between snapshots', () => {
    const { server, client } = flying();
    client.stageEconomy(wallet(1, 9), server.world.tick);
    // An older reading, arriving late. It has nothing to say: the wallet is full
    // state, so the newest word is the only one worth keeping.
    client.stageEconomy(wallet(0.5, 0.5), server.world.tick - 2);

    client.reconcile(server.broadcast().snapshot, server.broadcast().ackSeq);

    // 10 ore, from the newest statement — not the 1 the stale one claimed. (Hold
    // and bank are summed for the same home-station drain reason as above.)
    const ship = shipOf(client.world);
    expect(ship.cargo + ship.banked).toBeCloseTo(10, 6);
  });
});

// ---------------------------------------------------------------------------
// A build the server said no to (a0-52)
// ---------------------------------------------------------------------------

/** The tap, with the id the echo will name it by (`./order-ledger`). */
const BUILD_ID = 0x2a;
const TAP: readonly Action[] = [{ type: 'buildOrder', item: 'turret', orderId: BUILD_ID }];
const IDLE: readonly Action[] = [{ type: 'thrust', dir: { x: 0, y: 0 } }];

/** A client parked on its own station with `hold`/`bank` in the wallet — close
 *  enough to order, and holding exactly the ore the test wants it to hold. */
function docked(hold: number, bank: number): { client: PredictedMatch; station: MiningStation } {
  const world = createWorld(MATCH);
  const station = world.stations.find((s) => s.owner === LOCAL)!;
  const ship = shipOf(world);
  ship.pos = { ...station.pos };
  ship.vel = { x: 0, y: 0 };
  ship.cargo = hold;
  ship.banked = bank;
  return { client: new PredictedMatch({ world, localPlayer: LOCAL }), station };
}

/** A snapshot of the client's own world stamped for `tick`: the position
 *  correction is nil, so what a test sees is the wallet and the order handling. */
function selfSnapshot(client: PredictedMatch, tick: number): DecodedSnapshot {
  const world = client.world as World;
  const held = world.tick;
  world.tick = tick;
  const decoded = decodeSnapshot(encodeWorldSnapshot(world));
  world.tick = held;
  return decoded;
}

/** Everything a station has on the ring, standing or still assembling — the
 *  number the wheel prints as `n / 4 BUILT` (GDD §2.5). */
const turretsOn = (station: MiningStation): number => station.turrets.length + station.builds.length;

describe('refused build', () => {
  /**
   * The whole point of the name: a build authority said NO to must cost the player
   * **nothing** — not a turret they did not get, and not the ore for it.
   *
   * The turret half has been true since the action-echo work
   * (`./order-prediction.test.ts` "takes a REFUSED order back at once"). The ore
   * half was not, and a0-52 is what made anyone look. `spendOre` charges on the
   * tick of the press, in the client's own predicted world; the rollback removed
   * the ghost and left the charge — and nothing was coming to correct it, because
   * a refused order does not move the server's wallet and the server stays quiet
   * about a wallet that has not moved (`server/room.ts` `syncEconomy`). A player
   * whose press was refused therefore went on holding less ore than they had, on a
   * wheel that then refused purchases they could afford.
   *
   * Note the sign. This is the *opposite* of the developer's report — it makes the
   * player poorer, not richer — which is exactly why it survived: nobody reports
   * the ore they never noticed was missing.
   */
  it('leaves neither a phantom turret nor missing ore', () => {
    const { client, station } = docked(0, TURRET.cost);

    client.predict(1, TAP);
    // Predicted: the ghost is assembling and the client has paid for it.
    expect(turretsOn(station)).toBe(1);
    expect(shipOf(client.world).banked).toBe(0);

    // Authority ran the same order and refused it — the ship was not docked on the
    // tick that actually got simulated, or the wallet was a chunk behind. Its own
    // wallet never moved, so this echo is the ONLY thing it will say about it.
    client.settleOrder({ orderId: BUILD_ID, accepted: false, tick: 1 });

    // Neither half survives: no turret...
    expect(turretsOn(station)).toBe(0);
    // ...and no missing ore.
    expect(shipOf(client.world).banked).toBe(TURRET.cost);
    expect(shipOf(client.world).cargo).toBe(0);
  });

  it('does not let the next stale statement take the refund back out', () => {
    // The compounding half. The refund is written to the wallet TRAIL as well as
    // to the ship, because a statement stamped BEFORE the press is read as
    // "authority's figure, less whatever this client has spent since"
    // (`outflowSince`) — and a refunded price that still reads as outflow is
    // subtracted a second time, one round trip later, by a correction that thinks
    // it is being careful.
    const { client } = docked(0, TURRET.cost);

    client.predict(1, IDLE);
    client.predict(2, TAP);
    client.predict(3, IDLE);
    client.settleOrder({ orderId: BUILD_ID, accepted: false, tick: 2 });
    expect(shipOf(client.world).banked).toBe(TURRET.cost);

    // Authority's word about tick 1 — before the press, and true: it never spent
    // anything, so it still holds the same 3.
    client.stageEconomy(wallet(0, TURRET.cost), 1);
    client.reconcile(selfSnapshot(client, 1), 0);

    expect(shipOf(client.world).cargo + shipOf(client.world).banked).toBeCloseTo(TURRET.cost, 6);
  });

  it('keeps the ore spent when authority ACCEPTED the order', () => {
    // The other side, and the one that matters more: a refund that fires on an
    // accepted order would hand the player a free turret, which is the developer's
    // report made real by the fix for it. The adopted job takes authority's id and
    // the wallet stays paid.
    const { client, station } = docked(0, TURRET.cost);

    client.predict(1, TAP);
    client.settleOrder({
      orderId: BUILD_ID,
      accepted: true,
      tick: 1,
      build: { id: 77, remaining: TURRET.buildTime, total: TURRET.buildTime },
    });

    expect(station.builds.map((j) => j.id)).toEqual([77]);
    expect(shipOf(client.world).cargo + shipOf(client.world).banked).toBe(0);
  });

  it('refunds an order that expired unanswered, exactly once', () => {
    // Silence is treated as a refusal after the TTL (`./order-ledger`), so it takes
    // the same refund — and the sweep must not pay it twice if a late echo turns up
    // for an id the ledger has already closed.
    const { client, station } = docked(0, TURRET.cost);

    client.predict(1, TAP);
    for (let seq = 2; seq <= DEFAULT_ORDER_TTL_TICKS + 3; seq++) client.predict(seq, IDLE);
    // A snapshot from just behind the client, so the sweep runs on the clock the
    // deadline was set against: reconciling against tick 1 from 93 ticks out would
    // trim the lead instead and never reach the deadline (`trimLead`).
    const at = client.tick - 1;
    client.reconcile(selfSnapshot(client, at), at);

    expect(turretsOn(station)).toBe(0);
    expect(shipOf(client.world).banked).toBe(TURRET.cost);

    // The late echo names an id nothing is waiting on any more: no second refund.
    expect(client.settleOrder({ orderId: BUILD_ID, accepted: false, tick: 1 })).toBeNull();
    expect(shipOf(client.world).banked).toBe(TURRET.cost);
  });

  it('declines to refund rather than guess, when the journal cannot say', () => {
    // The receipt is read off the sim's ore journal, which is a bounded ring: a
    // session with nothing draining it sits at capacity, where an append evicts
    // and the length does not move. There is then no honest way to say what the
    // order cost — so nothing is refunded, which is exactly the behaviour that
    // shipped before this fix. Failing this way costs the refund; failing the
    // other way would hand the player a free turret, which is a0-52 made real.
    const { client, station } = docked(0, TURRET.cost);
    const journal = (client.world as World).oreJournal!;
    // Fill the ring so the spend this tick evicts instead of extending.
    while (journal.events.length < ORE_JOURNAL_CAPACITY) {
      journal.events.push({
        tick: 0,
        player: LOCAL,
        flow: 'mined',
        item: 'chunk',
        amount: 1,
        hold: 0,
        bank: 0,
        holdAfter: 1,
        bankAfter: 0,
      });
    }

    client.predict(1, TAP);
    client.settleOrder({ orderId: BUILD_ID, accepted: false, tick: 1 });

    // The turret half is unconditional and still right...
    expect(turretsOn(station)).toBe(0);
    // ...and the wallet is left exactly where the old behaviour left it, rather
    // than credited from a number nobody can vouch for.
    expect(shipOf(client.world).cargo + shipOf(client.world).banked).toBe(0);
  });

  it('gives back what a refused SHIP UPGRADE cost, which buys no entity at all', () => {
    // An upgrade rolls back with no build job to remove — the wallet is the whole
    // of the rollback, which is why it could go missing without anyone seeing a
    // ghost disappear.
    const cost = trackSpec(UpgradeTrack.Cargo).costs[0]!;
    const { client } = docked(0, cost);
    const upgrade: readonly Action[] = [
      { type: 'upgradeOrder', track: UpgradeTrack.Cargo, orderId: BUILD_ID },
    ];

    client.predict(1, upgrade);
    expect(shipOf(client.world).banked).toBe(0);
    expect(shipOf(client.world).tiers[UpgradeTrack.Cargo]).toBe(1);

    client.settleOrder({ orderId: BUILD_ID, accepted: false, tick: 1 });

    expect(shipOf(client.world).banked).toBe(cost);
  });
});

// ---------------------------------------------------------------------------
// Projectiles (M10 netcode audit item 2b)
// ---------------------------------------------------------------------------

const FIRE: readonly Action[] = [
  { type: 'thrust', dir: { x: 1, y: 0 } },
  { type: 'aim', dir: { x: 1, y: 0 } },
  { type: 'fire', active: true, auto: false },
];

/** Every live shot in a world, as `[slot, owner, kind]`. */
function shotsOf(world: World): [number, PlayerId, string | undefined][] {
  const out: [number, PlayerId, string | undefined][] = [];
  for (let slot = 0; slot < world.projectiles.length; slot++) {
    const p = world.projectiles[slot]!;
    if (p.active) out.push([slot, p.owner, p.kind]);
  }
  return out;
}

describe('the firer\'s own shots', () => {
  it('survive the reconcile that acknowledges the input which fired them', () => {
    // The bug this guards: a predicted shot used to be re-created only from the
    // still-unacknowledged inputs, so one round trip after firing it vanished and
    // the server's copy — a whole RTT behind, and standing still between
    // snapshots — appeared in its place. Two wrong shots instead of one right one.
    const client = new PredictedMatch({ world: createWorld(MATCH), localPlayer: LOCAL });
    const server = createWorld(MATCH);

    // Fire, and keep flying, until a shot exists.
    let seq = 0;
    for (let i = 0; i < 6; i++) client.predict(++seq, FIRE);
    const fired = shotsOf(client.world).filter(([, owner, kind]) => owner === LOCAL && kind === 'ship');
    expect(fired.length).toBeGreaterThan(0);

    // The server runs the same ticks and acknowledges every one of them, then
    // sends a snapshot that does NOT contain the client's own shot (suppressed).
    for (let i = 0; i < 6; i++) step(server, [{ id: LOCAL, actions: FIRE }], TICK_DT);
    const report = client.reconcile(decodeSnapshot(encodeWorldSnapshot(server)), seq);
    expect(report.applied).toBe(true);
    expect(report.replayed).toBe(0); // everything acknowledged: nothing to replay

    const after = shotsOf(client.world).filter(([, owner, kind]) => owner === LOCAL && kind === 'ship');
    expect(after.length).toBeGreaterThan(0);
    // ...and they live where the wire cannot reach them.
    for (const [slot] of after) expect(slot).toBeGreaterThanOrEqual(LOCAL_SHOT_BASE);
  });

  it('are not doubled by the authoritative copy of the same shot', () => {
    const client = new PredictedMatch({ world: createWorld(MATCH), localPlayer: LOCAL });
    const server = createWorld(MATCH);
    let seq = 0;
    for (let i = 0; i < 8; i++) {
      client.predict(++seq, FIRE);
      step(server, [{ id: LOCAL, actions: FIRE }], TICK_DT);
    }
    // The server's world genuinely holds this player's shots...
    const authoritative = decodeSnapshot(encodeWorldSnapshot(server));
    const ownOnWire = authoritative.projectiles.filter((p) => (p.meta & 0b1000) !== 0 && (p.meta & 0b111) === LOCAL);
    expect(ownOnWire.length).toBeGreaterThan(0);

    client.reconcile(authoritative, seq);

    // ...and the client draws exactly its own predicted ones, none of the wire's.
    const mine = shotsOf(client.world).filter(([, owner, kind]) => owner === LOCAL && kind === 'ship');
    expect(mine.length).toBe(ownOnWire.length);
    for (const [slot] of mine) expect(slot).toBeGreaterThanOrEqual(LOCAL_SHOT_BASE);
  });

  it('are capped, so a long match cannot grow the pool without bound', () => {
    const client = new PredictedMatch({ world: createWorld(MATCH), localPlayer: LOCAL });
    const server = createWorld(MATCH);
    let seq = 0;
    for (let round = 0; round < 20; round++) {
      for (let i = 0; i < 6; i++) {
        client.predict(++seq, FIRE);
        step(server, [{ id: LOCAL, actions: FIRE }], TICK_DT);
      }
      client.reconcile(decodeSnapshot(encodeWorldSnapshot(server)), seq);
    }
    const mine = shotsOf(client.world).filter(([, owner, kind]) => owner === LOCAL && kind === 'ship');
    expect(mine.length).toBeLessThanOrEqual(MAX_PREDICTED_SHOTS);
    expect(client.world.projectiles.length).toBeLessThanOrEqual(LOCAL_SHOT_BASE + MAX_PREDICTED_SHOTS);
  });
});

describe('shots the client did not fire', () => {
  it('are taken from the wire, never from the local replay', () => {
    // `step()` runs the whole world, so a replaying client fires *everyone's*
    // turrets locally. Those predicted copies are duplicates of shots already on
    // the wire, drawn a round trip ahead of them — culled outright.
    const client = new PredictedMatch({ world: createWorld(MATCH), localPlayer: LOCAL });
    const world = client.world;

    // Plant a locally-spawned turret shot in a slot the snapshot will not name.
    // (Grow the pool first: a fresh world's pool is empty, so an unqualified push
    // would land in slot 0 — which is exactly the slot the wire names below.)
    for (let i = 0; i < 4; i++) {
      world.projectiles.push({
        id: 0,
        active: false,
        owner: -1,
        pos: { x: 0, y: 0 },
        vel: { x: 0, y: 0 },
        damage: 0,
        radius: 3,
        life: 0,
      });
    }
    world.projectiles.push({
      id: 9_001,
      active: true,
      owner: 1,
      kind: 'turret',
      pos: { x: 10, y: 10 },
      vel: { x: 1, y: 0 },
      damage: 1,
      radius: 3,
      life: 5,
    });
    const planted = world.projectiles.length - 1;

    client.predict(1, THRUST);
    client.reconcile({ tick: 1, ships: [], projectiles: [{ id: 0, posX: 5, posY: 5, meta: 0b0010 }] }, 1);

    expect(world.projectiles[planted]!.active).toBe(false);
    expect(world.projectiles[0]!.active).toBe(true);
    expect(world.projectiles[0]!.kind).toBe('turret');
  });

  it('carry their shot kind off the wire, so the renderer can still tell them apart', () => {
    const world = createWorld(MATCH);
    applySnapshot(world, {
      tick: 3,
      ships: [],
      projectiles: [
        { id: 0, posX: 1, posY: 2, meta: 0b0001 },
        { id: 1, posX: 3, posY: 4, meta: 0b1001 },
      ],
    });
    expect(world.projectiles[0]!.kind).toBe('turret');
    expect(world.projectiles[1]!.kind).toBe('ship');
  });

  it('are all written when nobody asked for suppression — the spectator case', () => {
    const world = createWorld(MATCH);
    const slots = applySnapshot(world, {
      tick: 3,
      ships: [],
      projectiles: [{ id: 0, posX: 1, posY: 2, meta: 0b1000 }],
    });
    expect([...slots]).toEqual([0]);
    expect(world.projectiles[0]!.active).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The lead budget (M10 netcode audit)
// ---------------------------------------------------------------------------

describe('the lead budget', () => {
  it('is sized from the measured round trip, and clamped at both ends', () => {
    const client = new PredictedMatch({ world: createWorld(MATCH), localPlayer: LOCAL });
    expect(client.leadBudget).toBe(MAX_LEAD_TICKS);

    // A LAN: a couple of ticks of round trip, floored so a clean client never
    // starts trimming its own presses.
    expect(client.setLeadBudget(5, 0)).toBe(MIN_LEAD_TICKS);
    // The developer's condition: ~150 ms + jitter ≈ 15 ticks.
    expect(client.setLeadBudget(150, 20)).toBe(Math.ceil((150 + 40) / (TICK_DT * 1000)) + 2);
    // A satellite link: capped, not honoured.
    expect(client.setLeadBudget(5_000, 500)).toBe(MAX_LEAD_TICKS);
    // No measurement changes nothing.
    const held = client.leadBudget;
    expect(client.setLeadBudget(null, null)).toBe(held);
  });

  it('bleeds an over-lead down rather than yanking the ship backwards', () => {
    const client = new PredictedMatch({ world: createWorld(MATCH), localPlayer: LOCAL });
    const server = createWorld(MATCH);
    client.setLeadBudget(20, 0); // a very short budget: MIN_LEAD_TICKS

    // A stall: the client predicts thirty ticks with no snapshot at all.
    let seq = 0;
    for (let i = 0; i < 30; i++) client.predict(++seq, THRUST);
    step(server, [{ id: LOCAL, actions: THRUST }], TICK_DT);
    expect(client.pendingCount).toBe(30);

    // The stall clears. Each reconcile trims at most MAX_TRIM_PER_RECONCILE, so
    // the clock comes back over several of them and never in one jump.
    const first = client.reconcile(decodeSnapshot(encodeWorldSnapshot(server)), 0);
    expect(first.trimmed).toBeLessThanOrEqual(MAX_TRIM_PER_RECONCILE);
    expect(first.snapped).toBe(false);
    expect(client.pendingCount).toBe(30 - first.trimmed);

    for (let i = 0; i < 20; i++) {
      step(server, [{ id: LOCAL, actions: THRUST }], TICK_DT);
      const report = client.reconcile(decodeSnapshot(encodeWorldSnapshot(server)), 0);
      expect(report.trimmed).toBeLessThanOrEqual(MAX_TRIM_PER_RECONCILE);
      // Never a teleport, at any point in the recovery.
      expect(report.snapped).toBe(false);
    }
    expect(client.pendingCount).toBeLessThanOrEqual(MIN_LEAD_TICKS);
  });
});
