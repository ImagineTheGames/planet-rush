/**
 * allocator/provider.ts — the machine-provider seam. OWNER: Netcode Engineer
 * (GDD §4.2; docs/hosting-plan.md, Task 4).
 *
 * The fleet controller needs to *create*, *start*, *stop* and *destroy* hosts,
 * and *list* the ones it has. Exactly one file in the tree should know that
 * those verbs are Fly.io API calls; every other file talks to this five-method
 * seam and stays vendor-blind. That is the whole point of {@link MachineProvider}:
 * swap the Fly implementation for GCE, for bare metal, for a test double, and
 * nothing above the seam changes. The real Fly adapter lives behind this
 * interface in its own file (it is the only place a vendor SDK or REST endpoint
 * appears); this file ships the interface and the in-memory fake that lets the
 * fleet controller be tested with no cloud account and no bill.
 *
 * **Clockless, like the rest of the allocator.** No method reads `Date.now()`.
 * The caller supplies `now` (epoch-ms) to every method, so `createdAt` and
 * `updatedAt` are stamped from an injected clock and a seeded test gets exact,
 * repeatable timestamps. A `Machine` here is the *infrastructure* view — a host
 * and its lifecycle state — distinct from the room-level view the registry
 * keeps (allocator/registry.ts); the two meet only at a `MachineId`.
 *
 * **Zero new dependencies.** The fake is a `Map` and a counter.
 */

import type { MachineId } from '../src/net/ticket';

/**
 * A host's lifecycle as the provider reports it. The path is
 * `created → started → stopped → destroyed`; `start`/`stop` move between the
 * two running states and `destroy` is terminal (the host leaves the fleet).
 */
export type MachineState = 'created' | 'started' | 'stopped' | 'destroyed';

/**
 * The provider has no room to place a new host *right now* — a region is out of
 * capacity. This is a **fact to record, not a crash**: the fleet controller
 * catches it, notes the region is full this pass, and tries again next tick or
 * in another region. It is deliberately vendor-neutral (it lives on the seam,
 * not in the Fly adapter) so every caller handles "no capacity" the same way
 * regardless of which cloud is behind {@link MachineProvider}. The real Fly
 * adapter maps an HTTP 422 onto this; the in-memory fake never runs out and so
 * never raises it.
 */
export class CapacityError extends Error {
  constructor(
    /** The region that had no room — recorded so an operator sees *where* it filled. */
    readonly region: string,
    message: string,
  ) {
    super(message);
    this.name = 'CapacityError';
  }
}

/** The infrastructure view of one host: an id and where it is in its lifecycle. */
export interface Machine {
  /** Provider-assigned id; the same id a ticket routes a room to (src/net/ticket.ts). */
  readonly id: MachineId;
  /** Where this host is in its lifecycle right now. */
  readonly state: MachineState;
  /** The region it was provisioned in — a datacentre code the provider owns. */
  readonly region: string;
  /** Epoch-ms the host was created, from the caller's clock. Immutable after create. */
  readonly createdAt: number;
  /** Epoch-ms of the most recent state transition, from the caller's clock. */
  readonly updatedAt: number;
}

/** What {@link MachineProvider.create} needs: where to run and what image to boot. */
export interface CreateOptions {
  /** Datacentre/region to provision in. */
  readonly region: string;
  /** Container image the host boots — the Dockerized match server (server/Dockerfile). */
  readonly image: string;
}

/**
 * The vendor seam. Five methods, each taking the clock last so the whole
 * interface stays clockless and the fake stays deterministic. All are async:
 * the real Fly adapter makes network calls, and the fleet controller awaits
 * them regardless of which implementation is behind the seam.
 */
export interface MachineProvider {
  /** Every host the provider currently knows (destroyed hosts have left the fleet). */
  list(now: number): Promise<readonly Machine[]>;
  /** Provision a new host in the `created` state. */
  create(opts: CreateOptions, now: number): Promise<Machine>;
  /** Boot a `created` or `stopped` host into `started`. Idempotent if already started. */
  start(id: MachineId, now: number): Promise<Machine>;
  /** Halt a `started` host into `stopped`. Idempotent if already stopped. */
  stop(id: MachineId, now: number): Promise<Machine>;
  /** Terminate a host. It leaves the fleet and no longer appears in {@link list}. */
  destroy(id: MachineId, now: number): Promise<Machine>;
}

/**
 * An in-memory {@link MachineProvider} for tests and offline development. It
 * models the same lifecycle the real provider does — creates, transitions and
 * removes hosts — without touching a network or a billing account.
 *
 * Determinism is deliberate: ids come from a monotonic counter (`m-1`, `m-2`, …)
 * rather than a random token, and all timestamps come from the `now` the caller
 * passes, so a seeded fleet-controller test produces the same fleet every run.
 */
export class InMemoryMachineProvider implements MachineProvider {
  private readonly hosts = new Map<MachineId, Machine>();
  private seq = 0;

  async list(_now: number): Promise<readonly Machine[]> {
    // Copy each host so a caller mutating the returned array cannot corrupt
    // the fleet's authoritative state.
    return [...this.hosts.values()].map((m) => ({ ...m }));
  }

  async create(opts: CreateOptions, now: number): Promise<Machine> {
    this.seq += 1;
    const machine: Machine = {
      id: `m-${this.seq}`,
      state: 'created',
      region: opts.region,
      createdAt: now,
      updatedAt: now,
    };
    this.hosts.set(machine.id, machine);
    return { ...machine };
  }

  async start(id: MachineId, now: number): Promise<Machine> {
    return this.transition(id, 'started', now);
  }

  async stop(id: MachineId, now: number): Promise<Machine> {
    return this.transition(id, 'stopped', now);
  }

  async destroy(id: MachineId, now: number): Promise<Machine> {
    const host = this.require(id);
    const destroyed: Machine = { ...host, state: 'destroyed', updatedAt: now };
    // A destroyed host leaves the fleet: it must not reappear in list().
    this.hosts.delete(id);
    return destroyed;
  }

  /** Move a host to a running state, re-stamping `updatedAt` from the clock. */
  private transition(id: MachineId, state: MachineState, now: number): Machine {
    const host = this.require(id);
    if (host.state === state) return { ...host }; // idempotent
    const next: Machine = { ...host, state, updatedAt: now };
    this.hosts.set(id, next);
    return { ...next };
  }

  /** Look a host up, or throw — a destroyed/never-created id is a caller error. */
  private require(id: MachineId): Machine {
    const host = this.hosts.get(id);
    if (host === undefined) throw new Error(`unknown machine: ${id}`);
    return host;
  }
}
