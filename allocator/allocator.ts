/**
 * allocator/allocator.ts — the allocation logic. OWNER: Netcode Engineer
 * (GDD §4.2; docs/hosting-plan.md, Task 5).
 *
 * The match server has no "create room" verb: an unknown code creates the room,
 * and exactly one message — `join` — puts a client in a match (src/net/transport.ts).
 * That decision is preserved here. The allocator adds **no verb**; it answers a
 * question that only exists once there is more than one Machine: *which one?*
 * Two operations, matching the two ways a client arrives:
 *
 *   • {@link Allocator.allocate} — a client wants a *new* room. The allocator
 *     picks a region and a Machine with room to spare, mints a globally-unique
 *     code, reserves it, and signs a ticket. The room itself does not exist yet;
 *     it is created when the client's `join` reaches the Machine with that code.
 *   • {@link Allocator.join} — a client has a code and wants the *existing* room.
 *     The allocator locates the Machine hosting it and signs a ticket for that
 *     Machine. It creates nothing and reserves nothing.
 *
 * **Code minting lives here, and only here, because uniqueness must be global.**
 * A Machine can promise a code is unique among *its own* rooms; it cannot know
 * another Machine did not mint the same four letters. The allocator sees the
 * whole fleet (via the registry), so it is the only place the guarantee can be
 * made — which is the one thing the room-level code minter moves up to (the
 * match server keeps minting for the single-Machine offline path).
 *
 * **Out of the gameplay path, by construction.** The allocator only *reads* the
 * fleet the registry learned from heartbeats and *reserves* codes; it never
 * provisions a Machine (that is the fleet controller's job, behind
 * {@link MachineProvider}). Once a client holds its ticket and its socket, this
 * whole process can vanish and every live match carries on.
 *
 * **Clockless and atomic.** Every method takes `now` (epoch-ms); nothing reads a
 * wall clock, so a seeded test is exact. `allocate` is deliberately synchronous
 * end-to-end — capacity check, code mint, reservation happen with no `await`
 * between them — so in Node's single thread two concurrent allocations cannot
 * both claim the last slot or the same code. **Zero new dependencies.**
 */

import type { Rng } from '@shared/types';
import type { RoomCode } from '../src/net/transport';
import type { MachineId } from '../src/net/ticket';
import { signTicket } from '../src/net/ticket';
import { makeRoomCode } from '../src/net/room-code';
import type { RoomRegistry, MachineView, Reservation } from './registry';

/**
 * How long a signed ticket stays valid after issue. A ticket only has to survive
 * the walk from "allocator answered" to "socket open on the Machine" — seconds,
 * not minutes — so this is short: a leaked or stale ticket is useless almost at
 * once. Judged against the verifier's clock in {@link verifyTicket}.
 */
export const DEFAULT_TICKET_TTL_MS = 30_000;

/** How many times code minting retries past a collision before giving up. With
 *  ~1M codes and a classroom-sized fleet, one retry is already vanishingly rare;
 *  this bound only exists so a pathologically full keyspace fails loudly. */
export const DEFAULT_MAX_CODE_ATTEMPTS = 100;

/** What the allocator hands back: the signed routing decision a client acts on. */
export interface Allocation {
  /** The room the client is bound to (new, or the one it asked to join). */
  readonly room: RoomCode;
  /** The Machine that room lives on — the decision the client may not make itself. */
  readonly machine: MachineId;
  /** The datacentre that Machine runs in (the client/router may route on it). */
  readonly region: string;
  /** The HMAC-signed ticket proving the allocator made this decision (ticket.ts). */
  readonly ticket: string;
  /** Epoch-ms the ticket goes stale — `now` at issue plus the configured TTL. */
  readonly expiresAt: number;
}

/** One region's live capacity, as a region picker reads it (GET /regions). */
export interface RegionCapacity {
  readonly region: string;
  /** Live Machines in the region. */
  readonly machines: number;
  /** Total room slots across those Machines. */
  readonly capacity: number;
  /** Rooms currently occupying slots (heartbeat rooms plus outstanding leases). */
  readonly rooms: number;
  /** Slots still free — `capacity - rooms`. */
  readonly free: number;
}

/** Why an allocation could not be answered — maps straight to an HTTP status. */
export type AllocatorErrorReason = 'no-capacity' | 'not-found';

/**
 * A refusal the HTTP layer turns into a status: `no-capacity` → 503 (the fleet
 * is full, try later / scale up), `not-found` → 404 (no live Machine hosts that
 * code). Carrying the reason as a field keeps `allocator/index.ts` free of
 * string-matching on messages.
 */
export class AllocatorError extends Error {
  constructor(
    readonly reason: AllocatorErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'AllocatorError';
  }
}

/** Everything an {@link Allocator} needs, all injected so it stays deterministic. */
export interface AllocatorConfig {
  /** The live view of the fleet, learned from heartbeats (allocator/registry.ts). */
  readonly registry: RoomRegistry;
  /** Deterministic source for code minting — the ratified `mulberry32`. */
  readonly rng: Rng;
  /** The allocator↔Machine shared key that signs tickets (src/net/ticket.ts). */
  readonly secret: string;
  /** Ticket lifetime; defaults to {@link DEFAULT_TICKET_TTL_MS}. */
  readonly ticketTtlMs?: number;
  /** Code-mint retry bound; defaults to {@link DEFAULT_MAX_CODE_ATTEMPTS}. */
  readonly maxCodeAttempts?: number;
  /**
   * The cordon placement seam. When set, a Machine for which this returns `true`
   * is excluded from *new-room* placement — it is draining (fleet-controller.ts)
   * and must not take on more matches on its way out. Only {@link Allocator.allocate}
   * consults it; {@link Allocator.join} never does, so a client re-joining an
   * existing room still routes to a cordoned Machine and a drain never strands a
   * live match. Unset (the default), no Machine is ever cordoned.
   */
  readonly excludeMachine?: (machine: MachineId) => boolean;
}

/** What a room needs to be placed: an optional preferred region. */
export interface AllocateOptions {
  /**
   * Preferred datacentre. A *preference*, not a demand: if the region has room
   * the room goes there, but a full region falls back to the least-loaded
   * Machine anywhere rather than failing — a placed match beats a refused one.
   */
  readonly region?: string;
}

export class Allocator {
  private readonly registry: RoomRegistry;
  private readonly rng: Rng;
  private readonly secret: string;
  private readonly ticketTtlMs: number;
  private readonly maxCodeAttempts: number;
  private readonly excludeMachine: (machine: MachineId) => boolean;

  constructor(config: AllocatorConfig) {
    this.registry = config.registry;
    this.rng = config.rng;
    this.secret = config.secret;
    this.ticketTtlMs = config.ticketTtlMs ?? DEFAULT_TICKET_TTL_MS;
    this.maxCodeAttempts = config.maxCodeAttempts ?? DEFAULT_MAX_CODE_ATTEMPTS;
    this.excludeMachine = config.excludeMachine ?? (() => false);
  }

  /**
   * Place a *new* room and return the signed decision. Synchronous by design so
   * the choose→mint→reserve sequence is atomic in the single-threaded runtime.
   *
   * @throws {AllocatorError} `no-capacity` when no live Machine has a free slot.
   */
  allocate(opts: AllocateOptions, now: number): Allocation {
    const machine = this.pickMachine(opts.region, now);
    if (machine === null) {
      throw new AllocatorError('no-capacity', 'no live machine has a free room slot');
    }
    const code = this.mintCode(now);
    // Reserve *before* anyone else can allocate: the lease both covers the
    // boot gap (join can locate the room before its first heartbeat) and counts
    // against this Machine's capacity for the next allocation.
    this.registry.reserve(code, machine.machine, now);
    return this.issue(code, machine.machine, machine.region, now);
  }

  /**
   * Reach an *existing* room: locate the Machine hosting `code` and sign a
   * ticket for it. Reserves nothing and provisions nothing — purely a lookup
   * plus a signature.
   *
   * @throws {AllocatorError} `not-found` when no live Machine hosts the code.
   */
  join(code: RoomCode, now: number): Allocation {
    const machine = this.registry.locate(code, now);
    if (machine === null) {
      throw new AllocatorError('not-found', `no live machine hosts room ${code}`);
    }
    // The Machine's region comes from its live view when it has one. A room
    // located only through a fresh reservation may not have a view yet; region
    // is a routing hint, not a correctness input, so an empty string is fine.
    const region = this.regionOf(machine, now);
    return this.issue(code, machine, region, now);
  }

  /**
   * The per-region capacity summary a client's region picker reads. Occupancy
   * counts both heartbeat rooms and outstanding reservations, so a region that
   * looks full to `allocate` looks full here too.
   */
  regions(now: number): RegionCapacity[] {
    const fleet = this.registry.machines(now);
    const leases = this.registry.reservations(now);
    const byRegion = new Map<string, RegionCapacity>();
    for (const view of fleet) {
      const prev = byRegion.get(view.region);
      const rooms = this.loadOf(view, leases);
      const merged: RegionCapacity = {
        region: view.region,
        machines: (prev?.machines ?? 0) + 1,
        capacity: (prev?.capacity ?? 0) + view.capacity,
        rooms: (prev?.rooms ?? 0) + rooms,
        free: 0, // filled below once capacity and rooms are known
      };
      byRegion.set(view.region, { ...merged, free: merged.capacity - merged.rooms });
    }
    return [...byRegion.values()];
  }

  /**
   * Choose the Machine a new room goes on: prefer the requested region, spread
   * onto the least-loaded candidate, fall back across regions when the preferred
   * one is full. Returns `null` when nothing in the whole fleet has a free slot.
   */
  private pickMachine(region: string | undefined, now: number): MachineView | null {
    const leases = this.registry.reservations(now);
    const withFree = this.registry
      .machines(now)
      // A draining (cordoned) Machine still heartbeats free slots, but must take
      // no *new* room — exclude it from placement so its matches can end.
      .filter((m) => !this.excludeMachine(m.machine) && this.loadOf(m, leases) < m.capacity);
    if (withFree.length === 0) return null;

    // Prefer the requested region, but only if it actually has a free slot —
    // otherwise fall back to the whole fleet so the room still places.
    const inRegion = region === undefined ? [] : withFree.filter((m) => m.region === region);
    const pool = inRegion.length > 0 ? inRegion : withFree;

    // Least-loaded wins (spreads matches); ties break on machine id so the
    // choice is deterministic for a seeded test.
    return pool.reduce((best, m) => {
      const dl = this.loadOf(m, leases) - this.loadOf(best, leases);
      if (dl < 0) return m;
      if (dl > 0) return best;
      return m.machine < best.machine ? m : best;
    });
  }

  /**
   * How many slots a Machine has taken: its heartbeat rooms plus any reservation
   * pointed at it whose room the heartbeat has not yet confirmed. Counting the
   * lease is what makes capacity honest in the gap before a placed room reports.
   */
  private loadOf(view: MachineView, leases: readonly Reservation[]): number {
    const hosted = new Set(view.rooms.map((r) => r.code));
    let pending = 0;
    for (const lease of leases) {
      if (lease.machine === view.machine && !hosted.has(lease.room)) pending += 1;
    }
    return hosted.size + pending;
  }

  /** Draw a code the whole fleet agrees is unused (no room, no live lease). */
  private mintCode(now: number): RoomCode {
    for (let attempt = 0; attempt < this.maxCodeAttempts; attempt++) {
      const code = makeRoomCode(this.rng);
      // locate covers both realities the registry knows: a Machine already
      // hosting the code, and an outstanding reservation holding it.
      if (this.registry.locate(code, now) === null) return code;
    }
    // ~1M codes over a classroom fleet makes this unreachable in practice; if it
    // ever fires the keyspace is genuinely exhausted and refusing is correct.
    throw new AllocatorError('no-capacity', 'could not mint a free room code');
  }

  /** The region a located Machine runs in, from its live view (or '' if none). */
  private regionOf(machine: MachineId, now: number): string {
    const view = this.registry.machines(now).find((m) => m.machine === machine);
    return view?.region ?? '';
  }

  /** Sign the routing decision into a ticket and package it as an {@link Allocation}. */
  private issue(room: RoomCode, machine: MachineId, region: string, now: number): Allocation {
    const expiresAt = now + this.ticketTtlMs;
    const ticket = signTicket({ room, machine, expiresAt }, this.secret);
    return { room, machine, region, ticket, expiresAt };
  }
}
