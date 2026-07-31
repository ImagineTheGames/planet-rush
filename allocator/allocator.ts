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
import type { RoomRegistry, MachineView, Reservation, ReserveConfig } from './registry';

/**
 * The legal match-size range (variable-slots plan, `MatchConfig`). Restated here
 * as bare constants rather than imported from `src/sim/match-config.ts`, because
 * the allocator is pure control plane and imports no sim (see the file header):
 * a room's size is a routing datum to it, not a simulation. The sim is the source
 * of truth; these mirror `MIN_MATCH_SIZE` / `MAX_MATCH_SIZE` and are asserted to
 * agree in the tests that touch both layers.
 */
export const MIN_ROOM_SIZE = 2;
export const MAX_ROOM_SIZE = 8;

/**
 * A room's load weight, in **full-room-equivalents** (variable-slots Task F1). A
 * room is not one flat unit of load: an 8-seat room is a whole room's worth of
 * players (and bandwidth); a 2-seat room a quarter of one. Weighting placement by
 * this — the room's seat count over the max — is what lets the allocator pack four
 * small matches where it would pack one big one, and spread by *players* rather
 * than by *room count* (the trap this milestone closes: a host of 64 two-player
 * rooms once looked identical to a host of 64 eight-player rooms).
 *
 * A room whose size is unknown — an older Machine that does not advertise it, or a
 * reservation placed without one — weighs a **full** room. That is the
 * conservative default: an un-advertised room is never *under*-counted into
 * over-packing, and a fleet of all-unknown sizes weighs exactly as it did before
 * F1 (one unit per room), so this change is byte-identical until real sizes flow.
 */
export function roomSeatWeight(size: number | undefined): number {
  if (size === undefined) return 1;
  const clamped = Math.max(MIN_ROOM_SIZE, Math.min(MAX_ROOM_SIZE, size));
  return clamped / MAX_ROOM_SIZE;
}

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

/**
 * Why a new room landed on the Machine it landed on. Placement is **policy, not
 * luck** (the developer's ratified ask), and a policy nobody can read is
 * indistinguishable from a coin flip — so every allocate carries its own reason.
 *
 *   • `preferred`     — the creator's region had a free slot and got the room.
 *   • `region-full`   — the creator's region is live but has no free slot, so the
 *                       fleet took it instead. A placed match beats a refused one.
 *   • `region-absent` — nothing runs in the creator's region at all. Reads
 *                       differently from `region-full` on purpose: one says *scale
 *                       that region*, the other says *create it*.
 *   • `no-preference` — nobody asked for a region and the edge did not say (off
 *                       Fly, or a header-less caller). Whole-fleet spread, as before.
 */
export type PlacementReason = 'preferred' | 'region-full' | 'region-absent' | 'no-preference';

/** The placement decision, in both the machine's words and a human's. */
export interface Placement {
  /** The region asked for — body-supplied or inferred from the edge — when known. */
  readonly requested?: string;
  /** The region the room actually landed in. */
  readonly region: string;
  /** The rule that decided it (see {@link PlacementReason}). */
  readonly reason: PlacementReason;
  /**
   * One line an operator or a pasted session log can read without a lookup table:
   * `gru — your region`, `iad — gru full`. This is the string the ratified ask
   * names, and it is built here rather than in the HTTP layer so the response and
   * the log cannot drift into two different explanations of one decision.
   */
  readonly detail: string;
}

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
  /**
   * Why *this* Machine — present on an {@link Allocator.allocate}, which makes a
   * placement decision, and absent on an {@link Allocator.join}, which makes none:
   * a join goes where the room already is, and there is nothing to explain. Keeping
   * it off the join keeps that response byte-identical to the shape that shipped.
   */
  readonly placement?: Placement;
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

/**
 * The advertised shape of one room, read *before* a client dials it (variable-slots
 * Task C3). This is what lets a lobby show "4-player FFA, 1 seat left" — or refuse
 * a room it cannot join — instead of routing a player to a Machine only to be
 * turned away with `room-full` after the socket is already open.
 */
export interface RoomInfo {
  readonly code: RoomCode;
  /** The Machine hosting (or booting) the room. */
  readonly machine: MachineId;
  /** That Machine's region, or '' when it is known only through a reservation. */
  readonly region: string;
  /** Match size (N), when the heartbeat or reservation carries it. */
  readonly size?: number;
  /** Match mode (`'ffa' | 'teams'`), when advertised. */
  readonly mode?: string;
  /** Seats a new human can still take, when the heartbeat carries it. */
  readonly joinableSeats?: number;
  /**
   * Whether a fresh join would be accepted right now. A room still booting (known
   * only through its reservation) is joinable — nobody is in it yet; a live room
   * is joinable iff it advertises a free seat. A lobby refuses the join when this
   * is false, WITH the reason the shape makes plain (full, or already live).
   */
  readonly joinable: boolean;
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

/** What a room needs to be placed: an optional preferred region and the room's
 *  requested shape (variable-slots Task C1). */
export interface AllocateOptions {
  /**
   * The creator's datacentre — what they asked for, or where they *are*. The HTTP
   * layer fills this from the request body when the client named one (a region
   * picker), and otherwise from Fly's edge header (`./edge-region`), so a creator
   * who never chose a region is still placed near themselves instead of wherever
   * the tie-break lands. `undefined` only when neither says.
   *
   * A *preference*, not a demand: the region wins whenever it has a free slot, and
   * a full one falls back to the least-loaded Machine anywhere rather than
   * failing — a placed match beats a refused one. Which of those happened comes
   * back on {@link Allocation.placement}.
   */
  readonly region?: string;
  /**
   * Requested match size (N). Signed into the ticket so the Machine opens the
   * room at this size, and recorded on the reservation so the room is
   * advertisable during its boot gap. Out-of-range or non-integer values are
   * dropped (the Machine then falls back to its default), so a garbage size can
   * never mint an unbuildable room — the lobby is where 2..8 is truly enforced
   * (`isValidSize`), this is the belt to that suspenders.
   */
  readonly size?: number;
  /** Requested match mode (`'ffa' | 'teams'`), carried on the same terms as size. */
  readonly mode?: string;
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
    const picked = this.pickMachine(opts.region, now);
    if (picked === null) {
      throw new AllocatorError('no-capacity', 'no live machine has a free room slot');
    }
    const config = normalizeRoomConfig(opts);
    const code = this.mintCode(now);
    // Reserve *before* anyone else can allocate: the lease both covers the
    // boot gap (join can locate the room before its first heartbeat) and counts
    // against this Machine's capacity for the next allocation. The size/mode ride
    // along so the room's shape is advertisable before its first heartbeat.
    this.registry.reserve(code, picked.view.machine, now, config);
    return this.issue(
      code,
      picked.view.machine,
      picked.view.region,
      now,
      config,
      placementOf(opts.region, picked),
    );
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
   * The advertised config of a room, or `null` when no live Machine hosts or has
   * reserved it (variable-slots Task C3). Reality first: a live Machine whose
   * heartbeat lists the room carries its current occupancy, so `joinableSeats`
   * and `joinable` are live. In the boot gap — reserved but not yet
   * heartbeat-confirmed — only the reservation's size/mode are known, and the
   * room is treated as fully joinable because nobody has reached it yet.
   */
  roomInfo(code: RoomCode, now: number): RoomInfo | null {
    const machine = this.registry.locate(code, now);
    if (machine === null) return null;

    const view = this.registry.machines(now).find((m) => m.machine === machine);
    const room = view?.rooms.find((r) => r.code === code);
    const region = view?.region ?? '';
    if (room) {
      return {
        code,
        machine,
        region,
        ...(room.size !== undefined ? { size: room.size } : {}),
        ...(room.mode !== undefined ? { mode: room.mode } : {}),
        ...(room.joinableSeats !== undefined ? { joinableSeats: room.joinableSeats } : {}),
        // Unknown occupancy (an old Machine that does not report seats) reads as
        // joinable — the room-full check at the Machine remains the backstop.
        joinable: room.joinableSeats === undefined ? true : room.joinableSeats > 0,
      };
    }

    // Boot gap: the room exists only as intent. The reservation knows its shape
    // but not its occupancy; nobody is in it yet, so it is joinable.
    const lease = this.registry.reservations(now).find((r) => r.room === code);
    return {
      code,
      machine,
      region,
      ...(lease?.size !== undefined ? { size: lease.size } : {}),
      ...(lease?.mode !== undefined ? { mode: lease.mode } : {}),
      joinable: true,
    };
  }

  /**
   * Choose the Machine a new room goes on, **and say why**: prefer the creator's
   * region whenever it has a free slot, spread onto the least-loaded candidate
   * there, and fall back across the whole fleet only when it does not. Returns
   * `null` when nothing in the whole fleet has a free slot.
   *
   * The semantics are exactly the ones that shipped — the region has always been a
   * preference and a full region has always fallen back rather than refused. What
   * is new is the second half of the return value: the *reason*, so the decision
   * survives into the response and the log instead of being re-derived (or
   * guessed at) by whoever reads it later.
   */
  private pickMachine(region: string | undefined, now: number): PickedMachine | null {
    const leases = this.registry.reservations(now);
    const fleet = this.registry.machines(now);
    const withFree = fleet
      // A draining (cordoned) Machine still heartbeats free slots, but must take
      // no *new* room — exclude it from placement so its matches can end.
      .filter((m) => !this.excludeMachine(m.machine) && this.loadOf(m, leases) < m.capacity);
    if (withFree.length === 0) return null;

    // Nobody said where they are (off Fly, or a header-less caller): whole-fleet
    // spread, and the reason says so rather than implying a region was honoured.
    if (region === undefined) {
      return { view: this.leastLoaded(withFree, leases), reason: 'no-preference' };
    }

    // The guarantee: the creator's region wins WHENEVER it has capacity.
    const inRegion = withFree.filter((m) => m.region === region);
    if (inRegion.length > 0) {
      return { view: this.leastLoaded(inRegion, leases), reason: 'preferred' };
    }

    // It does not. Fall back to the whole fleet — never refuse capacity the fleet
    // has — and distinguish the two ways a region can fail to take a room, because
    // they call for different actions: `region-full` means scale that region,
    // `region-absent` means there is nothing there to scale. (A region whose only
    // Machines are cordoned reads as `region-full`: it is live and has no slot to
    // offer, which is what the word has to mean here.)
    const liveThere = fleet.some((m) => m.region === region);
    return {
      view: this.leastLoaded(withFree, leases),
      reason: liveThere ? 'region-full' : 'region-absent',
    };
  }

  /** The least-loaded Machine of a non-empty pool (spreads matches); ties break on
   *  machine id so the choice is deterministic for a seeded test. */
  private leastLoaded(pool: readonly MachineView[], leases: readonly Reservation[]): MachineView {
    return pool.reduce((best, m) => {
      const dl = this.loadOf(m, leases) - this.loadOf(best, leases);
      if (dl < 0) return m;
      if (dl > 0) return best;
      return m.machine < best.machine ? m : best;
    });
  }

  /**
   * How much load a Machine has taken, in full-room-equivalents: its heartbeat
   * rooms plus any reservation pointed at it whose room the heartbeat has not yet
   * confirmed, each **weighted by its seats** ({@link roomSeatWeight}, Task F1)
   * rather than counted as one flat unit. Counting the lease is what makes
   * capacity honest in the gap before a placed room reports; weighting by seats is
   * what makes a host of small rooms read as the light load it actually is, so
   * {@link pickMachine} spreads by players and the fullness gate (`load < capacity`)
   * lets small matches pack tighter than big ones onto the same host.
   */
  private loadOf(view: MachineView, leases: readonly Reservation[]): number {
    const hosted = new Set(view.rooms.map((r) => r.code));
    let load = 0;
    for (const room of view.rooms) load += roomSeatWeight(room.size);
    for (const lease of leases) {
      if (lease.machine === view.machine && !hosted.has(lease.room)) {
        load += roomSeatWeight(lease.size);
      }
    }
    return load;
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

  /** Sign the routing decision into a ticket and package it as an {@link Allocation}.
   *  A `join` (existing room) passes no config, so the ticket is byte-identical to
   *  the pre-variable-size shape; an `allocate` folds the room's size/mode in. */
  private issue(
    room: RoomCode,
    machine: MachineId,
    region: string,
    now: number,
    config: ReserveConfig = {},
    placement?: Placement,
  ): Allocation {
    const expiresAt = now + this.ticketTtlMs;
    const ticket = signTicket(
      {
        room,
        machine,
        expiresAt,
        ...(config.size !== undefined ? { size: config.size } : {}),
        ...(config.mode !== undefined ? { mode: config.mode } : {}),
      },
      this.secret,
    );
    // Placement is deliberately NOT signed into the ticket: it explains a decision,
    // it does not authorise one. The Machine verifies room+machine and could not
    // act on a reason if it had it.
    return { room, machine, region, ticket, expiresAt, ...(placement ? { placement } : {}) };
  }
}

/** A chosen Machine and the rule that chose it — {@link Allocator.pickMachine}'s
 *  return, kept internal because callers want the {@link Placement} it becomes. */
interface PickedMachine {
  readonly view: MachineView;
  readonly reason: PlacementReason;
}

/**
 * Turn a pick into the {@link Placement} that rides out on the response and into
 * the session log. The `detail` wording is the ratified one — `gru — your region`,
 * `iad — gru full` — and lives here, next to the rule that produced it, so the two
 * can never disagree.
 */
function placementOf(requested: string | undefined, picked: PickedMachine): Placement {
  const region = picked.view.region;
  return {
    ...(requested !== undefined ? { requested } : {}),
    region,
    reason: picked.reason,
    detail: placementDetail(requested, region, picked.reason),
  };
}

/** The human half of a {@link Placement}: `<chosen region> — <why>`. */
function placementDetail(
  requested: string | undefined,
  region: string,
  reason: PlacementReason,
): string {
  switch (reason) {
    case 'preferred':
      return `${region} — your region`;
    case 'region-full':
      return `${region} — ${requested ?? '?'} full`;
    case 'region-absent':
      return `${region} — no ${requested ?? '?'} machines`;
    case 'no-preference':
      return `${region} — no region preference`;
  }
}

/**
 * Distil an {@link AllocateOptions} down to the room config that survives onto
 * the ticket and the reservation. A size is kept only when it is an integer in
 * the legal 2..8 range; a mode only when it is one of the two known values.
 * Anything else is dropped to `undefined`, so a malformed request degrades to a
 * default-shaped room rather than minting one the sim cannot build.
 */
function normalizeRoomConfig(opts: AllocateOptions): ReserveConfig {
  const config: { size?: number; mode?: string } = {};
  if (
    typeof opts.size === 'number' &&
    Number.isInteger(opts.size) &&
    opts.size >= MIN_ROOM_SIZE &&
    opts.size <= MAX_ROOM_SIZE
  ) {
    config.size = opts.size;
  }
  if (opts.mode === 'ffa' || opts.mode === 'teams') config.mode = opts.mode;
  return config;
}
