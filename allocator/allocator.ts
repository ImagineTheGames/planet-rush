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
import type { Room, RoomRegistry, MachineView, Reservation, ReserveConfig } from './registry';
import { nearestRegion } from './region-geo';
import { listingId, ownerTag, type RoomListing } from './listing';

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
export type AllocatorErrorReason = 'no-capacity' | 'not-found' | 'room-full';

/**
 * A refusal the HTTP layer turns into a status: `no-capacity` → 503 (the fleet
 * is full, try later / scale up), `not-found` → 404 (no live Machine hosts that
 * code), `room-full` → 409 (the room is there and has no seat for you). Carrying
 * the reason as a field keeps `allocator/index.ts` free of string-matching on
 * messages.
 *
 * `room-full` exists for the browse row and only the browse row (a0-26 §3): a
 * listing is a photograph up to ten seconds old, so the seat a row showed can be
 * taken by the time a thumb reaches it. "That claim filled up" and "that claim is
 * gone" are two different things to tell a player, and a list that collapsed them
 * into one 404 would be lying about one of them.
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
      // `create` — this ticket's whole purpose is to bring a room that does not
      // exist yet into existence on the Machine it names (src/net/ticket.ts).
      'create',
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
    // **Which intent this is depends on which of the two realities located the
    // room** (a0-26 Milestone A), and the registry already distinguishes them:
    //
    //  • a live Machine's heartbeat lists it → the room is *real*, so this is a
    //    `join`. If it has since ended inside the beat the allocator has not
    //    heard yet, the Machine refuses the ticket instead of opening an empty
    //    room in its place — which is the whole point of the claim.
    //  • only an unlapsed lease covers it → the **boot gap**. The room may not
    //    exist yet, and a join in the gap is *supposed* to create it: that is how
    //    HOST works, and it is how a friend who types the code a beat before the
    //    host's socket lands still gets in. Signing `join` here would refuse a
    //    room for not existing yet — a `room-gone` for a room that is arriving.
    //
    // So the claim means exactly what it says: `join` is issued only when the
    // allocator has heard a heartbeat saying the room is there.
    const confirmed = this.registry
      .machines(now)
      .some((view) => view.rooms.some((room) => room.code === code));
    return this.issue(code, machine, region, now, confirmed ? 'join' : 'create');
  }

  /**
   * **The lobby browser's list** (a0-26 §1): every room in the fleet a stranger
   * could walk into right now, each named by a derived handle instead of its code
   * (`./listing`).
   *
   * Built from the registry's heartbeat-confirmed rooms and nothing else, over
   * state the allocator already holds — no new service, no new store, no new
   * failure mode. Three exclusions, each with its own reason:
   *
   *   • **Lease-only rooms — the boot gap.** A room known only through its
   *     reservation advertises itself as joinable with *no occupancy at all* for
   *     up to 15 s, whether or not the Machine ever comes up (measured, plan
   *     §1(c)). It is the single largest generator of ghost rows. Nothing is lost:
   *     a creator reaches their own room by ticket, not by browsing.
   *     {@link Allocator.roomInfo} still answers for the gap, on purpose — "may I
   *     dial this code?" and "what is worth showing a stranger?" are two questions
   *     and this is the one that gets the cautious answer (Trap 1).
   *   • **Rooms with no free seat**, which is every full room and every room that
   *     has started (`joinableSeats` goes to 0 at RUSH!). A row that offers a seat
   *     that is not there is the failure the brief calls *worse than no list*.
   *     A room whose Machine does not advertise seats at all is excluded for the
   *     same reason: a row has nothing true to say about it, and `size − players`
   *     is not an answer (Trap 3 — bots and closed seats make it wrong).
   *   • **Rooms whose host said PRIVATE** (`listed === false`, a0-26 D1). Absent
   *     reads as listed.
   *
   * **A dying Machine cannot make this list wronger than the allocator itself**
   * (plan §1's named failure mode): the fleet is read through
   * `registry.machines(now)`, which prunes on read, so a Machine that stops
   * beating drops out of the list on exactly the clock that stops new rooms being
   * placed on it. Inside that window a row can still be tapped, and the refusal
   * that catches it is {@link Allocator.joinListing} plus the ticket's `join`
   * intent — the list is *allowed* to be up to a heartbeat stale, so long as
   * acting on a stale row fails honestly instead of quietly.
   *
   * Clockless like everything else here: `now` is injected, so the staleness
   * envelope is exact in a test and never `Date.now()` (Trap 12).
   */
  rooms(now: number): RoomListing[] {
    const listings: RoomListing[] = [];
    for (const view of this.registry.machines(now)) {
      for (const room of view.rooms) {
        if (!isListable(room)) continue;
        listings.push({
          id: listingId(room.code, this.secret),
          owner: ownerTag(room.code, this.secret),
          region: view.region,
          ...(room.size !== undefined ? { size: room.size } : {}),
          ...(room.mode !== undefined ? { mode: room.mode } : {}),
          players: room.players,
          joinableSeats: room.joinableSeats ?? 0,
        });
      }
    }
    return listings;
  }

  /**
   * Reach a room from a **browse row** rather than from a code (the developer:
   * *"there should be a join button to join it"*): resolve the handle back to the
   * room it names and sign a ticket for it, exactly as {@link Allocator.join}
   * would have for the code.
   *
   * The handle is resolved by rebuilding the tokens for the rooms the registry
   * currently holds, which is what keeps the registry a cache with nothing extra
   * in it (`./listing`). At 120 rooms that is 120 HMACs — microseconds, and only
   * on a tap, never on a poll.
   *
   * **The two honest refusals a stale row earns** (plan §3). A photograph up to
   * ten seconds old can be wrong in two different ways, and a player is owed the
   * difference:
   *
   *   • the room is not there any more, or its host has since flipped PRIVATE →
   *     `not-found` (404). The row is dead; the browser refreshes and says so.
   *   • the room is there and has no seat left → `room-full` (409). The row is
   *     alive and the player was simply beaten to it.
   *
   * Note what is *not* here: this signs a ticket, it does not admit anyone. The
   * Machine remains the only authority on a join (Trap 5), and the ticket it gets
   * carries `intent: 'join'` — so a room that died inside the heartbeat this
   * listing was built from is refused *there* rather than silently re-created
   * (Milestone A). The list is allowed to be stale; nothing downstream of it is
   * allowed to be dishonest about that.
   *
   * @throws {AllocatorError} `not-found` or `room-full`, per above.
   */
  joinListing(id: string, now: number): Allocation {
    for (const view of this.registry.machines(now)) {
      for (const room of view.rooms) {
        if (listingId(room.code, this.secret) !== id) continue;
        // Found the room the handle names. A handle is authority to join a room
        // *while it is publicly open*, so a room that has since gone private is
        // gone as far as this route is concerned — its code still works, and that
        // is the difference between a handle and a code (`./listing`).
        if (room.listed === false) {
          throw new AllocatorError('not-found', `listing ${id} is no longer published`);
        }
        if ((room.joinableSeats ?? 0) <= 0) {
          throw new AllocatorError('room-full', `room ${room.code} has no free seat`);
        }
        return this.issue(room.code, view.machine, view.region, now, 'join');
      }
    }
    throw new AllocatorError('not-found', `no live machine hosts listing ${id}`);
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
   * there, and when that region cannot take the room, move to the **nearest**
   * region that can. Returns `null` when nothing in the fleet has a free slot.
   *
   * The capacity semantics are the ones that shipped: the region is a preference,
   * a region that cannot take the room falls back rather than refuses, and the
   * {@link PlacementReason} distinguishes the two ways it can fail, because they
   * call for different actions — `region-full` means *scale that region*,
   * `region-absent` means *there is nothing there to scale*. (A region whose only
   * Machines are cordoned reads as `region-full`: it is live and has no slot to
   * offer, which is what the word has to mean here.)
   *
   * **What n9-01 changed is the shape of the fallback, not the reasons.** It used
   * to be the whole fleet as one flat pool, which made "the creator's region is
   * not one this fleet runs" indistinguishable from "the creator did not say" — so
   * a request arriving on the `dfw` POP, where we have never run a Machine,
   * competed for `gru` on load alone. Live on 2026-08-11, three consecutive
   * allocations from a `dfw` POP went `iad`, `iad`, **`gru`**, with twelve free
   * slots still sitting in `iad`. The fallback now walks regions by distance
   * (`./region-geo`) and reaches the far side of an ocean only when the near side
   * is genuinely out of slots: **crossing a continent is a capacity decision,
   * never a default.**
   *
   * The flat whole-fleet pool survives for exactly the two cases with no geography
   * to reason about: nobody stated a region at all, and a POP this deployment has
   * no coordinates for.
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

    // It does not — but the room still places, and the reason still says which of
    // the two failures this was.
    const reason: PlacementReason = fleet.some((m) => m.region === region)
      ? 'region-full'
      : 'region-absent';

    // The nearest region that can *actually take the room*. Only regions with a
    // free slot are candidates, so the ranking and the capacity check are one
    // step: this can never answer with a region that would then fall back again.
    const nearest = nearestRegion(region, [...new Set(withFree.map((m) => m.region))]);
    if (nearest !== undefined) {
      const pool = withFree.filter((m) => m.region === nearest);
      return { view: this.leastLoaded(pool, leases), reason };
    }

    // No coordinates for the stated region, or none for anything the fleet runs:
    // there is nothing to be *near*, so spread across the fleet exactly as this
    // did before `./region-geo` existed. A missing table row degrades to the old
    // behaviour, never to a guess.
    return { view: this.leastLoaded(withFree, leases), reason };
  }

  /**
   * The best home for the next room out of a non-empty pool. Least-loaded first —
   * that is the spread rule — and every tie-break under it is a *fact about the
   * host*, never its name.
   *
   * The name matters, because an id sort is how a Florida creator reached São
   * Paulo (n9-01): with the whole fleet in one pool and every host idle, `<` on a
   * machine id was the entire decision — a coin flip wearing determinism's
   * clothes. The ranking is now, in order:
   *
   *   1. **lower load** — the spread rule (full-room-equivalents, {@link loadOf});
   *   2. **more free capacity** — same load, bigger host: the one that still has
   *      the most headroom once this room lands, which is what spreading *means*
   *      on a mixed-size fleet;
   *   3. **fresher heartbeat** — among equals, the host most recently confirmed
   *      alive is the one least likely to be a view about to lapse;
   *   4. **incumbency** — still indistinguishable, so the host the fleet learned
   *      about first keeps it. Pool order is heartbeat-arrival order (the registry
   *      is insertion-ordered), which is deterministic for a seeded test without
   *      comparing one character of anybody's id.
   *
   * By rule 4 the candidates are in the same region and identical on every fact
   * the registry holds, so there is no decision left to make — only a
   * deterministic one to record.
   */
  private leastLoaded(pool: readonly MachineView[], leases: readonly Reservation[]): MachineView {
    const ranked = pool.map((view) => ({ view, load: this.loadOf(view, leases) }));
    return ranked.reduce((best, host) => (betterHost(host, best) ? host : best)).view;
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
   *  A `join` (existing room) passes no config, so the ticket carries only the
   *  routing claims and its intent; an `allocate` folds the room's size/mode in. */
  private issue(
    room: RoomCode,
    machine: MachineId,
    region: string,
    now: number,
    intent: 'create' | 'join',
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
        intent,
      },
      this.secret,
    );
    // Placement is deliberately NOT signed into the ticket: it explains a decision,
    // it does not authorise one. The Machine verifies room+machine and could not
    // act on a reason if it had it.
    return { room, machine, region, ticket, expiresAt, ...(placement ? { placement } : {}) };
  }
}

/**
 * Is this heartbeat room one a stranger may be *shown*? Deliberately stricter
 * than {@link RoomInfo.joinable}, which answers the different question "may I
 * dial this code?" and answers unknown occupancy with a hopeful yes because the
 * Machine backs it up.
 *
 * A **list** has no such backstop: an unmeasured room becomes a row that promises
 * seats nobody counted. So silence is an exclusion here and an admission there,
 * and the two paths are kept separate exactly as Trap 1 says to keep them.
 */
function isListable(room: Room): boolean {
  if (room.listed === false) return false;
  return room.joinableSeats !== undefined && room.joinableSeats > 0;
}

/** A chosen Machine and the rule that chose it — {@link Allocator.pickMachine}'s
 *  return, kept internal because callers want the {@link Placement} it becomes. */
interface PickedMachine {
  readonly view: MachineView;
  readonly reason: PlacementReason;
}

/** A Machine with its load already computed, so the ranking below reads once per
 *  host instead of recomputing the same sum inside every comparison. */
interface RankedHost {
  readonly view: MachineView;
  readonly load: number;
}

/**
 * Is `host` a better home for the next room than the incumbent `best`? The
 * ranking {@link Allocator.leastLoaded} documents, in code: load, then headroom,
 * then heartbeat freshness. There is deliberately no fourth clause — a `false`
 * here leaves the incumbent standing, which is rule 4 (the host the fleet learned
 * about first keeps it) and is the reason no machine id is ever compared.
 */
function betterHost(host: RankedHost, best: RankedHost): boolean {
  if (host.load !== best.load) return host.load < best.load;
  const headroom = host.view.capacity - host.load;
  const bestHeadroom = best.view.capacity - best.load;
  if (headroom !== bestHeadroom) return headroom > bestHeadroom;
  return host.view.lastSeen > best.view.lastSeen;
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
