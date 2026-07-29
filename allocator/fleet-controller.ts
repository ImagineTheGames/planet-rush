/**
 * allocator/fleet-controller.ts — the fleet controller. OWNER: Netcode Engineer
 * (GDD §4.2; docs/hosting-plan.md, Task 10).
 *
 * **It ships disabled, and that is the honest setting rather than a hedge.** The
 * netcode spike (docs/netcode-spike.md) measured 64 rooms per Machine, so two
 * Machines hold ~128 concurrent rooms — roughly a thousand players. This loop
 * would not fire for a long time. It exists now so that turning it on later is a
 * config change (`FLEET_AUTOSCALE=on`) rather than a project, and so that when it
 * does fire it has been tested. Every path below is exercised by
 * `tests/allocator/fleet-controller.test.ts` against the in-memory provider fake.
 *
 * The controller adds **no verb to the gameplay path**. Allocation
 * (allocator/allocator.ts) is synchronous and never calls this loop; the loop
 * runs on its own timer, off to the side, reconciling the fleet toward demand. A
 * player therefore *never waits on Machine creation* — the two are decoupled by
 * construction. What the loop reads is a {@link FleetSignal} (the fleet's worst
 * event-loop lag) and the room registry (live occupancy); what it does is call
 * the vendor-blind {@link MachineProvider} to start, create, cordon and stop
 * hosts.
 *
 * Two rules shape it, both from the brief:
 *
 *   • **Scale UP on event-loop lag, not CPU.** A Machine whose 60 Hz
 *     authoritative loop falls behind is the first, load-independent sign the
 *     fleet is saturating — earlier and truer than a free-slot count. Free slots
 *     are a *floor* beneath that signal, not the primary trigger. On a scale-up
 *     the loop **starts a stopped spare** (fast — the host already exists) and
 *     only then **replenishes the pool** by creating a fresh spare, so the fast
 *     path never blocks on provisioning.
 *
 *   • **Scale DOWN by draining, never by killing.** Web-style autoscaling would
 *     evict eight players mid-match. Instead the loop **cordons** the least-loaded
 *     Machine (no *new* room is placed on it — see the placement seam below), lets
 *     every live match reach its natural end (matches are bounded at 10–15 min,
 *     GDD §2), and only then **stops** it. A drained Machine is *stopped*, not
 *     destroyed — it returns to the pool as a warm spare. The loop drains one
 *     Machine at a time and never drops below {@link FleetControllerConfig.minRunning}.
 *
 * **The cordon placement seam.** Cordoning only matters if new rooms stop landing
 * on a draining host. The controller owns the cordon set and exposes
 * {@link FleetController.isCordoned}; wiring that as the {@link Allocator}'s
 * `excludeMachine` predicate is what makes a cordon bite. Existing rooms are
 * untouched — a client re-joining by code still routes to its Machine (that path
 * never consults the cordon), so a drain never strands a live match.
 *
 * **Clockless and deterministic.** Every method takes `now` (epoch-ms) and the
 * lag signal as arguments; nothing reads a wall clock or `Math.random()`. Machine
 * choice breaks ties on id, so a seeded test reconciles the same fleet every run.
 * **Zero new dependencies.**
 */

import type { MachineId } from '../src/net/ticket';
import { roomSeatWeight } from './allocator';
import { CapacityError, type Machine, type MachineProvider } from './provider';
import type { RoomRegistry, MachineView, Reservation } from './registry';

/**
 * Event-loop lag above which the fleet is judged to be saturating, in
 * milliseconds. The sim integrates at 60 Hz (a 16.67 ms budget, GDD §4.1); a
 * loop lagging this far behind is many ticks in arrears, which is real backlog
 * rather than a scheduling blip. Tunable via {@link FleetControllerConfig}.
 */
export const DEFAULT_LAG_THRESHOLD_MS = 100;

/**
 * The floor beneath the lag signal: if free room slots across the live fleet
 * drop below this, scale up even when lag is quiet. Lag leads; this catches the
 * case where demand is climbing steadily without yet stalling any single loop.
 */
export const DEFAULT_MIN_FREE_SLOTS = 8;

/**
 * Free slots above which the fleet is judged over-provisioned and a drain begins.
 * Defaulted to one Machine's measured capacity (64 rooms, docs/netcode-spike.md),
 * so a whole idle Machine's worth of slack is what triggers scaling down — never
 * a transient dip.
 */
export const DEFAULT_SCALE_DOWN_FREE_SLOTS = 64;

/** How many stopped spares to keep ready for a fast start. One is enough for the
 *  spike's demand curve; a burstier launch would raise it. */
export const DEFAULT_POOL_SIZE = 1;

/** Never drain below this many running Machines — keep the fleet warm so the next
 *  player is not paying for a cold start. */
export const DEFAULT_MIN_RUNNING = 1;

/**
 * The load signal the controller scales on. It is *injected* into
 * {@link FleetController.reconcile}, not read from a clock or a global, so the
 * loop stays pure and testable. The allocator process derives it from the fleet
 * (the worst per-Machine loop lag it has heard) and hands it in each tick.
 */
export interface FleetSignal {
  /**
   * The worst event-loop lag, in milliseconds, observed across the running
   * fleet this tick — the PRIMARY scale-up trigger. A Machine reports its own
   * lag; the process takes the max and passes it here.
   */
  readonly loopLagMs: number;
}

/** Everything the controller needs, all injected so it stays deterministic. */
export interface FleetControllerConfig {
  /** The vendor-blind lifecycle seam — start/create/stop/list (allocator/provider.ts). */
  readonly provider: MachineProvider;
  /** The live fleet view, learned from heartbeats (allocator/registry.ts). */
  readonly registry: RoomRegistry;
  /**
   * The master switch. Ships `false`; `FLEET_AUTOSCALE=on` flips it. When
   * `false`, {@link FleetController.reconcile} observes and reports but takes no
   * action — the whole point of shipping it off.
   */
  readonly enabled: boolean;
  /** Region new spares are created in (the provider's datacentre code). */
  readonly region: string;
  /** Container image a new spare boots — the Dockerized match server. */
  readonly image: string;
  /** Loop lag scale-up threshold; defaults to {@link DEFAULT_LAG_THRESHOLD_MS}. */
  readonly lagThresholdMs?: number;
  /** Free-slot floor beneath the lag signal; defaults to {@link DEFAULT_MIN_FREE_SLOTS}. */
  readonly minFreeSlots?: number;
  /** Free-slot drain line; defaults to {@link DEFAULT_SCALE_DOWN_FREE_SLOTS}. */
  readonly scaleDownFreeSlots?: number;
  /** Stopped spares kept ready; defaults to {@link DEFAULT_POOL_SIZE}. */
  readonly poolSize?: number;
  /** Minimum running Machines a drain will never go below; {@link DEFAULT_MIN_RUNNING}. */
  readonly minRunning?: number;
}

/**
 * What one {@link FleetController.reconcile} pass did — an operator's log line and
 * a test's assertion surface. Counts and ids describe *this pass only*; the
 * running/free figures are the observation the decisions were made against.
 */
export interface ReconcileReport {
  /** Whether the loop was armed. `false` means observe-only, no actions taken. */
  readonly enabled: boolean;
  /** Running Machines at observation time (before this pass acted). */
  readonly running: number;
  /** Free room slots across the live fleet at observation time. */
  readonly freeSlots: number;
  /** Machines started this pass (a spare brought up for capacity). */
  readonly started: readonly MachineId[];
  /** Count of Machines created this pass (scale-up fallback and/or pool replenish). */
  readonly created: number;
  /** Machines newly cordoned this pass (drain begun). */
  readonly cordoned: readonly MachineId[];
  /** Machines stopped this pass (drain completed — stopped, never destroyed). */
  readonly stopped: readonly MachineId[];
  /** A region reported out of capacity this pass ({@link CapacityError} caught). */
  readonly capacityUnavailable: boolean;
}

/** A spare is a host that exists but is not serving — bootable fast on scale-up. */
function isSpare(m: Machine): boolean {
  return m.state === 'created' || m.state === 'stopped';
}

export class FleetController {
  private readonly provider: MachineProvider;
  private readonly registry: RoomRegistry;
  private readonly enabled: boolean;
  private readonly region: string;
  private readonly image: string;
  private readonly lagThresholdMs: number;
  private readonly minFreeSlots: number;
  private readonly scaleDownFreeSlots: number;
  private readonly poolSize: number;
  private readonly minRunning: number;

  /** Machines being drained. The one fact this loop owns across ticks: a cordon
   *  outlives the pass that set it, until the Machine drains and is stopped. */
  private readonly cordon = new Set<MachineId>();

  constructor(config: FleetControllerConfig) {
    this.provider = config.provider;
    this.registry = config.registry;
    this.enabled = config.enabled;
    this.region = config.region;
    this.image = config.image;
    this.lagThresholdMs = config.lagThresholdMs ?? DEFAULT_LAG_THRESHOLD_MS;
    this.minFreeSlots = config.minFreeSlots ?? DEFAULT_MIN_FREE_SLOTS;
    this.scaleDownFreeSlots = config.scaleDownFreeSlots ?? DEFAULT_SCALE_DOWN_FREE_SLOTS;
    this.poolSize = config.poolSize ?? DEFAULT_POOL_SIZE;
    this.minRunning = config.minRunning ?? DEFAULT_MIN_RUNNING;
  }

  /** Whether a Machine is currently cordoned (draining). The placement seam the
   *  allocator consults so no *new* room lands on a host on its way out. */
  isCordoned(machine: MachineId): boolean {
    return this.cordon.has(machine);
  }

  /** The Machines currently draining — a snapshot, safe for the caller to keep. */
  cordoned(): readonly MachineId[] {
    return [...this.cordon];
  }

  /**
   * Reconcile the fleet toward demand once. Reads the injected lag signal and the
   * live registry, then — only if enabled — scales up (start a spare, replenish),
   * or scales down (cordon and drain), and advances any in-flight drains. Safe to
   * call on a timer; the caller supplies `now` and catches anything but
   * {@link CapacityError}, which this method already treats as a fact.
   */
  async reconcile(signal: FleetSignal, now: number): Promise<ReconcileReport> {
    const machines = await this.provider.list(now);
    const views = this.registry.machines(now);
    const running = machines.filter((m) => m.state === 'started');
    const freeSlots = this.freeSlots(views, now);

    const started: MachineId[] = [];
    const cordoned: MachineId[] = [];
    const stopped: MachineId[] = [];
    let created = 0;
    let capacityUnavailable = false;

    if (!this.enabled) {
      return {
        enabled: false,
        running: running.length,
        freeSlots,
        started,
        created,
        cordoned,
        stopped,
        capacityUnavailable,
      };
    }

    const scaleUp = signal.loopLagMs >= this.lagThresholdMs || freeSlots < this.minFreeSlots;

    if (scaleUp) {
      // Fast path first: bring up an existing spare, which the host already
      // provisioned — no player is waiting on this, but capacity lands sooner.
      const spare = machines.find(isSpare);
      if (spare !== undefined) {
        await this.provider.start(spare.id, now);
        started.push(spare.id);
      } else {
        // No spare to start — create one and start it (the degraded path). The
        // pool is replenished below so the next scale-up has a spare again.
        const fresh = await this.tryCreate(now);
        if (fresh === null) capacityUnavailable = true;
        else {
          created += 1;
          await this.provider.start(fresh.id, now);
          started.push(fresh.id);
        }
      }
    } else if (this.cordon.size === 0 && running.length > this.minRunning) {
      // Scale down — but never while a drain is already in flight (one at a time),
      // and never below the running floor. Cordon the least-loaded running host.
      const victim = this.leastLoaded(running, views);
      if (victim !== undefined && freeSlots >= this.scaleDownFreeSlots) {
        this.cordon.add(victim.id);
        cordoned.push(victim.id);
      }
    }

    // Advance every drain: a cordoned host that now hosts no room is done — stop
    // it (never destroy). A host still hosting a match is left to finish.
    for (const machine of running) {
      if (!this.cordon.has(machine.id)) continue;
      if (this.roomsOn(machine.id, views) > 0) continue;
      await this.provider.stop(machine.id, now);
      this.cordon.delete(machine.id);
      stopped.push(machine.id);
    }

    // Replenish the spare pool so the next scale-up has a warm host to start.
    // This is the slow, off-path work — done after capacity has already landed.
    if (!capacityUnavailable) {
      const refreshed = await this.provider.list(now);
      let spares = refreshed.filter(isSpare).length;
      while (spares < this.poolSize) {
        const fresh = await this.tryCreate(now);
        if (fresh === null) {
          capacityUnavailable = true;
          break;
        }
        created += 1;
        spares += 1;
      }
    }

    return {
      enabled: true,
      running: running.length,
      freeSlots,
      started,
      created,
      cordoned,
      stopped,
      capacityUnavailable,
    };
  }

  /** Create a spare, or return `null` if the region is out of capacity — a fact
   *  the caller records, per the brief, rather than a crash. */
  private async tryCreate(now: number): Promise<Machine | null> {
    try {
      return await this.provider.create({ region: this.region, image: this.image }, now);
    } catch (e) {
      if (e instanceof CapacityError) return null;
      throw e; // anything else is a genuine fault — surface it loudly.
    }
  }

  /** Free capacity across the live fleet, in full-room-equivalents: total capacity
   *  minus load in flight (heartbeat rooms plus outstanding reservations), each
   *  **weighted by its seats** ({@link roomSeatWeight}, Task F1) rather than counted
   *  one flat unit per room — the same honest, seat-aware accounting the allocator
   *  places under. A fleet of small matches thus reports the real seat headroom a
   *  flat room count would hide (unknown-size rooms still weigh a whole room, so
   *  the drain/scale-up thresholds keep their pre-F1 meaning until sizes flow). */
  private freeSlots(views: readonly MachineView[], now: number): number {
    const leases: readonly Reservation[] = this.registry.reservations(now);
    let capacity = 0;
    let occupied = 0;
    for (const lease of leases) occupied += roomSeatWeight(lease.size);
    for (const view of views) {
      capacity += view.capacity;
      for (const room of view.rooms) occupied += roomSeatWeight(room.size);
    }
    return capacity - occupied;
  }

  /** How many rooms a Machine hosts per its latest heartbeat (0 if it has none). */
  private roomsOn(machine: MachineId, views: readonly MachineView[]): number {
    return views.find((v) => v.machine === machine)?.rooms.length ?? 0;
  }

  /** The least-loaded running, un-cordoned Machine — the cheapest to drain. Ties
   *  break on id so the choice is deterministic. Returns `undefined` if none. */
  private leastLoaded(
    running: readonly Machine[],
    views: readonly MachineView[],
  ): Machine | undefined {
    const drainable = running.filter((m) => !this.cordon.has(m.id));
    if (drainable.length === 0) return undefined;
    return drainable.reduce((best, m) => {
      const dl = this.roomsOn(m.id, views) - this.roomsOn(best.id, views);
      if (dl < 0) return m;
      if (dl > 0) return best;
      return m.id < best.id ? m : best;
    });
  }
}
