/**
 * allocator/registry.ts — the room registry. OWNER: Netcode Engineer
 * (GDD §4.2; docs/hosting-plan.md, Task 3).
 *
 * **This is a cache, not a database, and that is the design.** Every Machine
 * already knows which rooms it hosts, so the allocator does not *store* the
 * fleet — it *learns* it, by listening to the heartbeats each Machine sends. An
 * allocator that restarts holds nothing, and yet comes back whole within one
 * heartbeat interval: the next round of heartbeats rebuilds the entire picture.
 * That is precisely why the launch footprint carries no stateful service — lose
 * the registry and you lose nothing that a heartbeat won't restate.
 *
 * The one thing the registry genuinely *owns* — the one fact no heartbeat can
 * restate — is the leased {@link Reservation}: the gap between "go to Machine X
 * for room R" and "Machine X has a room R to show for it". In that gap the room
 * exists only as the allocator's intent; a heartbeat cannot report a room that
 * has not booted yet. So the registry holds the lease, uses it to answer
 * {@link RoomRegistry.locate} until reality catches up, and retires it the
 * moment the reserving Machine's heartbeat lists the room. If the Machine never
 * shows, the lease simply lapses at its TTL and the slot frees.
 *
 * **Clockless.** Nothing here reads `Date.now()`; every method takes `now`
 * (epoch-ms) as an argument, so liveness and lease expiry are judged against a
 * clock the caller injects and a seeded test controls exactly.
 *
 * `RoomRegistry` stays an *interface* on purpose: a single allocator instance
 * needs only the in-memory cache below, but a second instance would have to
 * share this state through Redis. Keeping the seam means that day arrives as a
 * new implementation, not a rewrite. **Zero new dependencies** — two `Map`s.
 */

import type { RoomCode } from '../src/net/transport';
import type { MachineId } from '../src/net/ticket';

/**
 * How long a Machine stays in the fleet after its last heartbeat before the
 * cache forgets it. Three missed 5 s beats: long enough to ride out one dropped
 * heartbeat, short enough that a genuinely dead host stops being routed to
 * quickly. Tunable per registry via {@link RegistryConfig}.
 */
export const DEFAULT_LIVENESS_MS = 15_000;

/**
 * How long a {@link Reservation} covers a room before it lapses. Sized to a
 * Machine's boot-and-first-heartbeat window: enough time for a freshly-placed
 * room to come up and be reported, after which the lease is either retired by
 * that report or abandoned as failed placement.
 */
export const DEFAULT_RESERVATION_TTL_MS = 15_000;

/** A room as a Machine reports it in a heartbeat: its code and live occupancy. */
export interface Room {
  /** The room code players type to join (src/net/room-code.ts). */
  readonly code: RoomCode;
  /** Current occupancy — data the fleet controller reads for load-aware placement. */
  readonly players: number;
  /**
   * Match size (N, 2..8) — the seat count the room was opened at (variable-slots
   * Task C3). Optional so a heartbeat from a pre-variable-size Machine still
   * ingests; the advertisement (`Allocator.roomInfo`) reports it when present.
   */
  readonly size?: number;
  /** Match mode (`'ffa' | 'teams'`), advertised so a lobby can show/refuse a room
   *  before dialing (Task C3). A bare string here — the sim owns the union. */
  readonly mode?: string;
  /** Seats a new human can still take right now: open lobby seats, 0 once the
   *  match is live or full (Task C3). What a lobby refuses an incompatible join on. */
  readonly joinableSeats?: number;
}

/**
 * What a Machine tells the allocator every interval: who it is, what it hosts
 * right now, and how much more it will take. The `rooms` list is *state, not a
 * delta* — each heartbeat is the full truth of that Machine's rooms, so the
 * registry replaces rather than accumulates.
 */
export interface Heartbeat {
  /** The Machine speaking — matches a provider id (allocator/provider.ts). */
  readonly machine: MachineId;
  /** Region the Machine runs in, echoed from the provider. */
  readonly region: string;
  /** Max rooms this Machine will host — the ceiling the fleet controller places under. */
  readonly capacity: number;
  /** Every room this Machine hosts at heartbeat time; the complete set. */
  readonly rooms: readonly Room[];
}

/** The allocator's live view of one Machine, derived from its latest heartbeat. */
export interface MachineView {
  readonly machine: MachineId;
  readonly region: string;
  readonly capacity: number;
  readonly rooms: readonly Room[];
  /** Epoch-ms of the heartbeat this view was learned from — drives liveness. */
  readonly lastSeen: number;
}

/**
 * A lease the allocator holds while a placed room is in flight — the one thing
 * the registry owns that heartbeats cannot rebuild. It names the room, the
 * Machine it was placed on, and the instant the lease lapses if the room never
 * shows.
 */
export interface Reservation {
  readonly room: RoomCode;
  readonly machine: MachineId;
  /** Epoch-ms after which the lease no longer covers the room. */
  readonly expiresAt: number;
  /** The requested size the room will boot at, carried so the room is
   *  advertisable during the boot gap — before its first heartbeat restates it
   *  (variable-slots Task C1/C3). Optional; absent for a default-size room. */
  readonly size?: number;
  /** The requested mode the room will boot at, same purpose as {@link size}. */
  readonly mode?: string;
}

/** The requested config for a new room, threaded from the allocate request into
 *  the lease so the boot gap is advertisable (variable-slots Task C1/C3). */
export interface ReserveConfig {
  readonly size?: number;
  readonly mode?: string;
}

/** Tuning for a {@link RoomRegistry}; both fields default to the constants above. */
export interface RegistryConfig {
  readonly livenessMs?: number;
  readonly reservationTtlMs?: number;
}

/**
 * The registry seam. One allocator instance is served by the in-memory cache
 * ({@link InMemoryRoomRegistry}); a second instance would implement this same
 * interface over shared storage (Redis). Every method takes the clock.
 */
export interface RoomRegistry {
  /** Ingest a Machine's heartbeat: learn/refresh it and retire any lease it fulfils. */
  observe(hb: Heartbeat, now: number): void;
  /** The live fleet at `now` — Machines heard from within the liveness window. */
  machines(now: number): MachineView[];
  /** Which live Machine hosts `room`, by heartbeat first then lease, or `null`. */
  locate(room: RoomCode, now: number): MachineId | null;
  /** Lease `room` to `machine`, covering the gap until a heartbeat confirms it.
   *  `config` records the size/mode the room will boot at, so a join in the gap
   *  can be advertised the room's shape before its first heartbeat (Task C1/C3). */
  reserve(room: RoomCode, machine: MachineId, now: number, config?: ReserveConfig): Reservation;
  /** The currently-outstanding leases at `now` (lapsed ones excluded). */
  reservations(now: number): Reservation[];
}

/**
 * The single-instance cache. Holds only what a heartbeat can restate (the
 * fleet) plus the one thing it can't (outstanding reservations). Both are
 * pruned lazily on read against the injected clock, so there is no timer and no
 * background sweep — the cache is exactly as fresh as the last question asked of
 * it.
 */
export class InMemoryRoomRegistry implements RoomRegistry {
  private readonly views = new Map<MachineId, MachineView>();
  private readonly leases = new Map<RoomCode, Reservation>();
  private readonly livenessMs: number;
  private readonly reservationTtlMs: number;

  constructor(config: RegistryConfig = {}) {
    this.livenessMs = config.livenessMs ?? DEFAULT_LIVENESS_MS;
    this.reservationTtlMs = config.reservationTtlMs ?? DEFAULT_RESERVATION_TTL_MS;
  }

  observe(hb: Heartbeat, now: number): void {
    this.views.set(hb.machine, {
      machine: hb.machine,
      region: hb.region,
      capacity: hb.capacity,
      rooms: hb.rooms,
      lastSeen: now,
    });
    // Any lease this Machine has now made good on is retired: the Machine has a
    // room to show for the "go to Machine X" it was handed.
    for (const room of hb.rooms) {
      const lease = this.leases.get(room.code);
      if (lease !== undefined && lease.machine === hb.machine) {
        this.leases.delete(room.code);
      }
    }
  }

  machines(now: number): MachineView[] {
    const live: MachineView[] = [];
    for (const [id, view] of this.views) {
      if (this.isLive(view, now)) live.push(view);
      else this.views.delete(id); // forget the dead lazily
    }
    return live;
  }

  locate(room: RoomCode, now: number): MachineId | null {
    // Reality first: a live Machine whose heartbeat lists the room.
    for (const view of this.views.values()) {
      if (this.isLive(view, now) && view.rooms.some((r) => r.code === room)) {
        return view.machine;
      }
    }
    // Then intent: an unlapsed lease still covering the gap.
    const lease = this.leases.get(room);
    if (lease !== undefined && lease.expiresAt > now) return lease.machine;
    return null;
  }

  reserve(room: RoomCode, machine: MachineId, now: number, config: ReserveConfig = {}): Reservation {
    // A fresh reservation replaces any prior one for the room — re-placing a
    // room onto a new Machine simply re-points the lease.
    const lease: Reservation = {
      room,
      machine,
      expiresAt: now + this.reservationTtlMs,
      ...(config.size !== undefined ? { size: config.size } : {}),
      ...(config.mode !== undefined ? { mode: config.mode } : {}),
    };
    this.leases.set(room, lease);
    return lease;
  }

  reservations(now: number): Reservation[] {
    const live: Reservation[] = [];
    for (const [room, lease] of this.leases) {
      if (lease.expiresAt > now) live.push(lease);
      else this.leases.delete(room); // drop lapsed leases lazily
    }
    return live;
  }

  /** A view is live if its last heartbeat is within the liveness window at `now`. */
  private isLive(view: MachineView, now: number): boolean {
    return now - view.lastSeen <= this.livenessMs;
  }
}
