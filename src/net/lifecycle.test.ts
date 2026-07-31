/**
 * src/net/lifecycle.test.ts — **entity lifecycle is on the wire** (M10, the
 * developer's gru playtest). OWNER: Netcode Engineer.
 *
 * Two findings from one capture, and they are the same bug seen from two ends.
 *
 * *"at t=63 s corr jumps 0.5 → 288 → 509 units with mispred=1.0 for FIVE SECONDS,
 * one snap that does not take."* Five seconds is `RESPAWN_S`, exactly, and that is
 * the whole diagnosis: the server killed and respawned the ship, the client kept
 * predicting a ship that authority had lying at a death site, and the correction
 * between them could not converge because the two sims were no longer simulating
 * the same ship. The same shape shows up a second time at t=38 s in the RXS3
 * capture — two independent captures of one fault. On a rival's hull the identical
 * bug is *"dead enemies linger"*: a corpse the client quietly revived.
 *
 * *"ore goes super fast to base online."* The deposit courier is a position
 * integrated one tick at a time, and a reconcile replays every unacknowledged tick
 * over it — so at 150 ms it flew about ten times too fast and the whole banking
 * beat collapsed into a snap.
 *
 * Both are tested here against a real authority: a world stepped by the same
 * `step()` the match server calls, fed through the same `InputQueue`, encoded
 * through the same binary snapshot, and emitting the same lifecycle events
 * `server/static-events.ts` emits. The only thing faked is the wire's delay.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import type { Action, PlayerId } from '@shared/types';
import {
  DEPOSIT,
  RESPAWN_S,
  TICK_DT,
  createWorld,
  killShip,
  stationOf,
  step,
} from '../sim';
import type { OreChunk, World, WorldConfig } from '../sim';
import { combatantGetsBar } from '../ui/healthbar';
import { shipLifecycleOf } from './entity-events';
import { InputQueue } from './input-queue';
import { RemoteInterpolator } from './interpolation';
import { PredictedMatch, SNAP_THRESHOLD } from './prediction';
import { PresentationLayer } from './presentation';
import { SHIP_FLAG, decodeSnapshot, encodeWorldSnapshot } from './snapshot';
import type { DecodedSnapshot, ShipSnap } from './snapshot';
import type { EntityEventMessage, InputMessage, PlayerEconomy } from './transport';

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

const THRUST: readonly Action[] = [{ type: 'thrust', dir: { x: 1, y: 0 } }];
const IDLE: readonly Action[] = [];

function shipOf(world: World, id: PlayerId = LOCAL): World['ships'][number] {
  const ship = world.ships.find((s) => s.id === id);
  if (!ship) throw new Error(`no ship ${id}`);
  return ship;
}

/** One broadcast as it leaves the room: the lifecycle events since the last one
 *  (the server sends them *ahead* of the snapshot — `server/room.ts` `tick`),
 *  then the snapshot and its ack. */
interface Frame {
  readonly events: readonly EntityEventMessage[];
  /** The wallet's own channel, sent immediately ahead of the snapshot for the same
   *  tick (`./transport` EconomyMessage) — without it a replay re-drains the hold
   *  once per unacknowledged tick and the banking beat is measured on a lie. */
  readonly economy: PlayerEconomy;
  readonly snapshot: DecodedSnapshot;
  readonly ackSeq: number;
  readonly ackTick: number;
}

/** The authoritative side, out of the same parts the match server uses — plus the
 *  `alive`-flag differ that is the M10 lifecycle channel (`ShipLifecycleTracker`). */
class Authority {
  readonly world = createWorld(MATCH);
  private readonly queue = new InputQueue();
  private readonly alive = new Map<PlayerId, boolean>();
  private readonly outbox: EntityEventMessage[] = [];
  private acknowledged = 0;
  private acknowledgedAt = 0;

  constructor() {
    for (const ship of this.world.ships) this.alive.set(ship.id, ship.alive);
  }

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
    this.diffLifecycle();
  }

  /** Kill a ship the way a shot does (`src/sim/damage.ts`), so the death this test
   *  drives is the sim's own death and not a hand-written flag. */
  kill(id: PlayerId): void {
    killShip(this.world, shipOf(this.world, id));
    this.diffLifecycle();
  }

  broadcast(): Frame {
    const ship = shipOf(this.world);
    return {
      events: this.outbox.splice(0),
      economy: { held: ship.cargo, banked: ship.banked, tiers: { ...ship.tiers } },
      snapshot: decodeSnapshot(encodeWorldSnapshot(this.world)),
      ackSeq: this.acknowledged,
      ackTick: this.acknowledgedAt,
    };
  }

  private diffLifecycle(): void {
    for (const ship of this.world.ships) {
      if (this.alive.get(ship.id) === ship.alive) continue;
      this.alive.set(ship.id, ship.alive);
      this.outbox.push({
        type: 'entityEvent',
        tick: this.world.tick,
        kind: 'ship',
        op: ship.alive ? 'spawn' : 'destroy',
        data: shipLifecycleOf(ship, this.world.tick),
      });
    }
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

/** A client and a server, wired together, run frame by frame — with the lifecycle
 *  channel delivered ahead of the snapshot, as the room sends it. */
class Match {
  readonly server = new Authority();
  readonly client: PredictedMatch;
  /** Correction magnitude per applied reconcile, and the client tick it landed at. */
  readonly errors: { tick: number; error: number; snapped: boolean }[] = [];

  private readonly up: Link<InputMessage>;
  private readonly down: Link<Frame>;
  private seq = 0;
  private frameIndex = 0;

  constructor(delayFrames = 0) {
    this.client = new PredictedMatch({ world: createWorld(MATCH), localPlayer: LOCAL });
    this.up = new Link(delayFrames);
    this.down = new Link(delayFrames);
  }

  get frame(): number {
    return this.frameIndex;
  }

  /** One 60 Hz frame. `onFrame` sees the client world after everything has landed
   *  — which is what a renderer would draw. */
  run(
    frames: number,
    actions: readonly Action[] = THRUST,
    onFrame?: (frame: number) => void,
  ): void {
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
        for (const event of inbound.events) this.client.applyEvent(event);
        this.client.stageEconomy(inbound.economy, inbound.snapshot.tick);
        const report = this.client.reconcile(inbound.snapshot, inbound.ackSeq, inbound.ackTick);
        if (report.applied) {
          this.errors.push({ tick: this.client.tick, error: report.error, snapped: report.snapped });
        }
      }
      onFrame?.(this.frameIndex);
    }
  }
}

// ---------------------------------------------------------------------------
// 1. Death and respawn — the t=63 s signature
// ---------------------------------------------------------------------------

/** The two wires the M10 acceptance gate names, one way in frames — the brief asks
 *  for the kill/respawn cycle at both, because the ghost's cost is the distance the
 *  two ships drift apart while the news is in flight, and that scales with the trip. */
const WIRES = [
  { name: '100 ms', delayFrames: 3 },
  { name: '250 ms', delayFrames: 8 },
];

describe.each(WIRES)(
  'death and respawn are authority\'s at $name (GDD §2.7; M10 lifecycle wire)',
  ({ delayFrames: DELAY_FRAMES }) => {
    it('stops predicting the dead ship instead of reviving it on the next tick', () => {
      const match = new Match(DELAY_FRAMES);
      match.run(40);
      match.server.kill(LOCAL);

      // The whole respawn window, plus the round trip it takes to hear about it.
      let clientDead = 0;
      let serverDead = 0;
      match.run(Math.round(RESPAWN_S / TICK_DT) + 20, THRUST, () => {
        if (!shipOf(match.client.world).alive) clientDead++;
        if (!shipOf(match.server.world).alive) serverDead++;
      });

      // The ship comes back — and not one tick before the countdown says so. The old
      // client revived it on its very next predicted tick, so `clientDead` was 0 or 1
      // against a server that held it dead for the whole five seconds.
      expect(shipOf(match.server.world).alive).toBe(true);
      expect(shipOf(match.client.world).alive).toBe(true);
      expect(serverDead).toBeGreaterThan(Math.round(RESPAWN_S / TICK_DT) - 2);
      // The client's window is the server's, shifted by the one round trip the news
      // spends on the wire — never a fraction of it.
      expect(clientDead).toBeGreaterThan(serverDead - DELAY_FRAMES * 2 - 2);
    });

    it('keeps the correction bounded through the death — the t=63 s regression', () => {
      const match = new Match(DELAY_FRAMES);
      match.run(40);
      const deathFrame = match.frame;
      match.server.kill(LOCAL);
      match.run(Math.round(RESPAWN_S / TICK_DT) + 30);

      // Everything reconciled after the death lands. The capture's signature is
      // `corr > 100` held with `mispred 1.0`; the gate is the snap threshold, which
      // is the line between "a correction" and "the ship teleported" (`./prediction`).
      const after = match.errors.filter((e) => e.tick > deathFrame);
      expect(after.length).toBeGreaterThan(20);
      const worst = Math.max(...after.map((e) => e.error));
      expect(worst).toBeLessThan(SNAP_THRESHOLD);
      // And it is not merely under the ceiling — it converges. A death the client
      // honours costs a correction while the news crosses the wire, and nothing after.
      const settled = after.slice(6);
      expect(Math.max(...settled.map((e) => e.error))).toBeLessThan(2);
      // Nothing teleported: `snapped` is the counter the M10 acceptance gate reads.
      expect(after.filter((e) => e.snapped).length).toBe(0);
    });

    it('runs the offline countdown, from authority\'s tick', () => {
      const match = new Match(DELAY_FRAMES);
      match.run(40);
      match.server.kill(LOCAL);

      const countdown: number[] = [];
      match.run(Math.round(RESPAWN_S / TICK_DT) + 10, THRUST, () => {
        const left = match.client.respawnIn(LOCAL);
        if (left !== null) countdown.push(left);
      });

      // A countdown at all — the death presentation has something to count.
      expect(countdown.length).toBeGreaterThan(60);
      // It opens near the design's five seconds (GDD §2.7) …
      expect(countdown[0]!).toBeGreaterThan(RESPAWN_S - 0.5);
      expect(countdown[0]!).toBeLessThanOrEqual(RESPAWN_S);
      // … never runs backwards …
      for (let i = 1; i < countdown.length; i++) {
        expect(countdown[i]!).toBeLessThanOrEqual(countdown[i - 1]! + 1e-9);
      }
      // … and reaches zero.
      expect(countdown[countdown.length - 1]!).toBeLessThan(0.2);
      // The world's own timer is the same number, so the offline death presentation
      // reads it exactly where it always did (`Ship.respawnTimer`).
      expect(match.client.isDead(LOCAL)).toBe(false);
    });

    it('clears a dead rival instead of leaving a corpse flying', () => {
      const match = new Match(DELAY_FRAMES);
      match.run(40);
      match.server.kill(RIVAL);

      let aliveWhileDead = 0;
      match.run(60, THRUST, () => {
        if (shipOf(match.server.world, RIVAL).alive) return;
        if (shipOf(match.client.world, RIVAL).alive) aliveWhileDead++;
      });

      // Every frame authority had the rival dead, this client had it dead too — bar
      // the round trip the news spends on the wire.
      expect(aliveWhileDead).toBeLessThanOrEqual(DELAY_FRAMES * 2 + 2);
      expect(shipOf(match.client.world, RIVAL).alive).toBe(false);
      expect(match.client.isDead(RIVAL)).toBe(true);
    });

    it('holds the corpse where it fell, not where prediction had flown it', () => {
      const match = new Match(DELAY_FRAMES);
      match.run(40);
      const deathSite = { ...shipOf(match.server.world).pos };
      match.server.kill(LOCAL);
      match.run(30);

      const drawn = shipOf(match.client.world).pos;
      expect(Math.hypot(drawn.x - deathSite.x, drawn.y - deathSite.y)).toBeLessThan(1);
      // The hull reads as dead, so the health bar and the death presentation agree
      // with the wire rather than with a locally revived ship.
      expect(shipOf(match.client.world).hull).toBe(0);
    });

    it('survives a lost death event: the snapshot\'s own flag is the backstop', () => {
      const match = new Match(DELAY_FRAMES);
      match.run(40);
      match.server.kill(LOCAL);
      // Drop every lifecycle event on the floor — the client sees only the alive bit.
      const swallow = match.client.applyEvent.bind(match.client);
      (match.client as unknown as { applyEvent: (m: EntityEventMessage) => boolean }).applyEvent = (
        message: EntityEventMessage,
      ): boolean => (message.kind === 'ship' ? false : swallow(message));

      let aliveWhileDead = 0;
      match.run(Math.round(RESPAWN_S / TICK_DT), THRUST, () => {
        if (shipOf(match.server.world).alive) return;
        if (shipOf(match.client.world).alive) aliveWhileDead++;
      });

      // The countdown a flag-only client runs is an estimate, but the thing that must
      // never happen — a ghost flying against a corpse — still cannot.
      expect(aliveWhileDead).toBeLessThanOrEqual(DELAY_FRAMES * 2 + 2);
    });
  },
);

// ---------------------------------------------------------------------------
// 2. Ore flights — "ore goes super fast to base online"
// ---------------------------------------------------------------------------

/** How far from the station body the parked ship sits: well inside the atmosphere
 *  and well outside the core, so a courier has a real flight to make. */
const PARK_OFFSET = 200;

/**
 * Park `ship` inside its own station's collection field with a full hold, so the
 * auto-deposit drain runs and spins couriers (GDD §2.3, `DEPOSIT`), and return the
 * ore it is actually holding.
 *
 * A *full* hold rather than an arbitrary number: `cargoCap` is the ceiling, and
 * `refreshDerivedStats` clamps anything above it (`src/sim/upgrades.ts`) — which a
 * reconcile calls on every wallet it applies. Over-filling the fixture therefore does
 * not test a big deposit, it tests the clamp, and the ore above the line vanishes at
 * the first snapshot instead of flying home.
 */
function parkForBanking(world: World): number {
  const ship = shipOf(world);
  const station = stationOf(world, LOCAL);
  if (!station) throw new Error('no home station');
  ship.pos.x = station.pos.x + PARK_OFFSET;
  ship.pos.y = station.pos.y;
  ship.vel.x = 0;
  ship.vel.y = 0;
  ship.cargo = ship.cargoCap;
  return ship.cargo;
}

/**
 * How many ticks the first deposit courier takes from spawn to absorption, as
 * sampled once per frame off `world`. Null when none flew.
 *
 * Couriers are tracked by **object identity**, never by id: a rewind puts
 * `world.nextEntityId` back with the rest of the clock, so two different chunks in one
 * match can legitimately carry the same id (`./prediction` `thawClocks`).
 */
function courierFlightTicks(samples: readonly (readonly OreChunk[])[]): number | null {
  let firstSeen: number | null = null;
  let courier: OreChunk | null = null;
  for (let frame = 0; frame < samples.length; frame++) {
    const couriers = samples[frame]!.filter((c) => c.deposit === true);
    if (courier === null) {
      const first = couriers[0];
      if (!first) continue;
      courier = first;
      firstSeen = frame;
      continue;
    }
    if (!couriers.includes(courier)) return frame - firstSeen!;
  }
  return null;
}

describe('ore flights run on the sim\'s clock, online and off (GDD §2.3)', () => {
  /** The offline truth: one world, stepped, nothing reconciled. */
  function offlineFlight(): { ticks: number; couriers: number } {
    const world = createWorld(MATCH);
    const cargo = parkForBanking(world);
    const samples: OreChunk[][] = [];
    const seen = new Set<OreChunk>();
    for (let i = 0; i < 400; i++) {
      step(world, [{ id: LOCAL, actions: IDLE }], TICK_DT);
      samples.push(world.chunks.slice());
      for (const chunk of world.chunks) if (chunk.deposit === true) seen.add(chunk);
    }
    const ticks = courierFlightTicks(samples);
    if (ticks === null) throw new Error('no courier flew offline — the fixture is wrong');
    expect(seen.size).toBe(Math.floor(cargo));
    return { ticks, couriers: seen.size };
  }

  it('takes the same number of ticks online as offline, within one tick', () => {
    const offline = offlineFlight();
    // Sanity: a real flight, not an instant one — `PARK_OFFSET` units at `flightSpeed`,
    // less the station body the courier is absorbed at.
    expect(offline.ticks).toBeGreaterThan(
      Math.floor((PARK_OFFSET - 64) / (DEPOSIT.flightSpeed * TICK_DT)) - 4,
    );

    // 100 ms and 250 ms round trips: the developer's condition and the worst the
    // acceptance gate admits (M10).
    for (const delayFrames of [3, 8]) {
      const match = new Match(delayFrames);
      parkForBanking(match.client.world);
      parkForBanking(match.server.world);
      const samples: OreChunk[][] = [];
      match.run(400, IDLE, () => {
        samples.push(match.client.world.chunks.slice());
      });
      const online = courierFlightTicks(samples);
      expect(online).not.toBeNull();
      // Before the fix a reconcile flew every courier once per unacknowledged tick,
      // so at 150 ms this landed at roughly a tenth of the offline figure.
      expect(Math.abs(online! - offline.ticks)).toBeLessThanOrEqual(1);
    }
  });

  it('spawns one courier per unit banked, however often it reconciles', () => {
    const offline = offlineFlight();
    for (const delayFrames of [3, 8]) {
      const match = new Match(delayFrames);
      const cargo = parkForBanking(match.client.world);
      parkForBanking(match.server.world);

      const seen = new Set<OreChunk>();
      match.run(400, IDLE, () => {
        for (const chunk of match.client.world.chunks) {
          if (chunk.deposit === true) seen.add(chunk);
        }
      });

      // The telegraph is conserved: one sprite per whole unit that left the hold
      // (field report p8) — the same count the offline match draws. A replay that
      // re-ran the drain used to mint extras; discarding the replay's chunk work
      // whole used to eat the ones whose boundary only a replay crossed.
      expect(seen.size).toBe(Math.floor(cargo));
      expect(seen.size).toBe(offline.couriers);
      expect(shipOf(match.client.world).cargo).toBeLessThan(1e-6);
    }
  });
});

// ---------------------------------------------------------------------------
// 3 & 4. One entity, one instant — the flickering bar and the lingering corpse
// ---------------------------------------------------------------------------

/**
 * *"HP bars/numbers flicker"* and *"dead enemies linger"* are the same defect as the
 * two above, seen by the renderer instead of by the simulation: a remote ship's body
 * was drawn from the interpolation buffer while its hull, its life and its trigger
 * were read off the newest snapshot. Two clocks on one entity.
 *
 * These run the real seam — {@link RemoteInterpolator} feeding
 * {@link PresentationLayer} — and judge the result with the actual visibility rule the
 * HUD applies (`src/ui/healthbar.ts` `combatantGetsBar`), because "the bar flickers"
 * is a statement about that predicate and nothing else.
 */

/** One remote ship's wire record. */
function snap(over: Partial<ShipSnap> = {}): ShipSnap {
  return {
    id: RIVAL,
    posX: 1000,
    posY: 1000,
    velX: 0,
    velY: 0,
    heading: 0,
    hull: 80,
    flags: SHIP_FLAG.alive | SHIP_FLAG.firing,
    ...over,
  };
}

function frameOf(tick: number, ship: ShipSnap): DecodedSnapshot {
  return { tick, ships: [ship], projectiles: [] };
}

/** The HUD's own rule, fed from a presented world exactly as `src/main.ts` feeds it:
 *  hull, max hull, alive, and `firing` as the in-combat tell. */
function getsBar(world: World, id: PlayerId): boolean {
  const ship = shipOf(world, id);
  return combatantGetsBar(
    {
      owner: ship.id,
      hp: ship.hull,
      maxHp: ship.maxHull,
      alive: ship.alive,
      inCombat: ship.firing,
      pos: { x: 0, y: 0 },
      radius: 10,
    },
    LOCAL,
  );
}

describe('a remote ship is drawn from one instant (M10 lifecycle wire)', () => {
  const DELAY = 100;
  /** Snapshot cadence, ms — 30 Hz, against a 60 Hz render loop. */
  const SNAP_MS = 1000 / 30;
  const FRAME_MS = 1000 / 60;

  /** The interpolator, the presentation layer, and a world to draw into. */
  function seam(): {
    world: World;
    interp: RemoteInterpolator;
    layer: PresentationLayer;
    draw: (nowMs: number) => void;
  } {
    const world = createWorld(MATCH);
    const interp = new RemoteInterpolator({ local: LOCAL, delayMs: DELAY });
    const layer = new PresentationLayer(LOCAL);
    return {
      world,
      interp,
      layer,
      draw: (nowMs: number): void => {
        layer.apply(world, {
          localOffset: { x: 0, y: 0 },
          remotes: interp.sample(nowMs),
          shots: interp.sampleShots(nowMs),
        });
      },
    };
  }

  it('keeps the damage flag steady while the rival holds its trigger down', () => {
    const { world, interp, layer, draw } = seam();
    const rival = shipOf(world, RIVAL);
    // Authority: a damaged rival, firing, in every snapshot. Nothing about what the
    // player should see changes across this whole run.
    for (let i = 0; i < 12; i++) {
      interp.record(frameOf(i * 2, snap({ hull: 80 - i })), i * SNAP_MS);
    }

    const bars: boolean[] = [];
    const hulls: number[] = [];
    for (let frame = 0; frame < 20; frame++) {
      const nowMs = DELAY + frame * FRAME_MS;
      // What a predicted tick does to a rival between reconciles: `step()` clears
      // the trigger of a ship this client has no input for, and runs its own
      // collision guess over the hull. Both are what the bar used to read.
      rival.firing = false;
      rival.hull = 5;
      draw(nowMs);
      bars.push(getsBar(world, RIVAL));
      hulls.push(rival.hull);
      layer.restore(world);
      // …and the simulation is untouched by the picture, as always.
      expect(rival.firing).toBe(false);
      expect(rival.hull).toBe(5);
    }

    // The bar is up for every frame of it — no 30 Hz strobe over an enemy that has
    // been firing the whole time.
    expect(bars.every((up) => up)).toBe(true);
    // And the number beside it only ever moves the way authority moved it: down,
    // through values that came off the wire, never through the local guess.
    expect(hulls.every((h) => h !== 5)).toBe(true);
    for (let i = 1; i < hulls.length; i++) expect(hulls[i]!).toBeLessThanOrEqual(hulls[i - 1]!);
  });

  it('clears a corpse when the render clock reaches the death, not seconds later', () => {
    const { world, interp, layer, draw } = seam();
    // Alive for three snapshots, then dead — the flag bit the death event doubles.
    for (let i = 0; i < 3; i++) interp.record(frameOf(i * 2, snap()), i * SNAP_MS);
    const deathMs = 3 * SNAP_MS;
    interp.record(frameOf(6, snap({ flags: 0, hull: 0 })), deathMs);
    for (let i = 4; i < 12; i++) {
      interp.record(frameOf(i * 2, snap({ flags: 0, hull: 0 })), i * SNAP_MS);
    }

    let clearedAt: number | null = null;
    for (let frame = 0; frame < 40; frame++) {
      const nowMs = frame * FRAME_MS;
      draw(nowMs);
      const alive = shipOf(world, RIVAL).alive;
      if (!alive && clearedAt === null) clearedAt = nowMs;
      // A corpse gets no bar, and a living rival at 80/120 does.
      expect(getsBar(world, RIVAL)).toBe(alive);
      layer.restore(world);
    }

    expect(clearedAt).not.toBeNull();
    // The corpse clears one interpolation delay after the death arrived — the same
    // delay the body itself is drawn at — and inside a frame of it either way.
    expect(clearedAt!).toBeGreaterThanOrEqual(deathMs + DELAY - FRAME_MS);
    expect(clearedAt!).toBeLessThanOrEqual(deathMs + DELAY + FRAME_MS);
  });
});
