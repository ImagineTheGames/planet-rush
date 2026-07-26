/**
 * allocator/provider-fly.ts — the Fly.io machine provider. OWNER: Netcode
 * Engineer (GDD §4.2; docs/hosting-plan.md, Task 10).
 *
 * **This is the only file in the tree permitted to mention Fly.io.** Every other
 * file talks to the five-method {@link MachineProvider} seam (allocator/provider.ts)
 * and stays vendor-blind; here, and here alone, those verbs become Fly Machines
 * REST calls. Swap this file for a GCE or bare-metal adapter and nothing above
 * the seam changes — which is the whole reason the seam exists (docs/netcode-spike.md
 * rejected Cloudflare precisely because its APIs could not be quarantined this way).
 *
 * **It has no unit test, by design.** The in-memory fake
 * ({@link InMemoryMachineProvider}) covers every *caller* — the fleet controller
 * is tested exhaustively against it with no cloud account and no bill — so there
 * is nothing left for a unit test here to prove that would not just be a
 * restatement of the mock. The real Fly API is verified against a live deployment
 * in `m9-02`, not in CI, because only the live API can tell us the mapping is
 * right. Mocking `fetch` to assert we call the URL we already wrote down is
 * theatre; the deployment check is the real gate.
 *
 * **HTTP 422 → {@link CapacityError}.** Fly answers a create in a region with no
 * room with a 422. That is *a fact to record, not a crash*: the fleet controller
 * catches {@link CapacityError}, notes the region is full this pass, and tries
 * again — a busy region is an expected operating condition on a free/low-cost
 * tier (docs/netcode-spike.md: ARM "out of host capacity" is a named risk), not
 * a bug. Every other non-2xx is a genuine fault and thrown as a plain `Error`.
 *
 * **Dependency-free.** Node's global `fetch` (v18+; the spike runs v22) makes the
 * calls — no Fly SDK, no HTTP client. The runtime image stays `node` plus the
 * bundled allocator, nothing vendor-specific to rebuild for the ARM core.
 *
 * **Clockless like the seam.** Every method takes `now` (epoch-ms); Fly's own
 * RFC3339 timestamps are parsed when present, and `now` is the fallback so a
 * response that omits them still yields a stamped {@link Machine}.
 */

import {
  CapacityError,
  type CreateOptions,
  type Machine,
  type MachineProvider,
  type MachineState,
} from './provider';
import type { MachineId } from '../src/net/ticket';

/** The Fly Machines API base — the public `api.machines.dev` v1 surface. */
export const DEFAULT_FLY_API = 'https://api.machines.dev/v1';

/** The guest a match Machine boots on when the caller does not specify one. A
 *  shared-CPU ARM host with 512 MB is ample for one process holding ≤64 rooms
 *  (docs/netcode-spike.md: ~2.6 ms CPU/s per client, 510 B snapshots). */
export interface FlyGuest {
  readonly cpu_kind: string;
  readonly cpus: number;
  readonly memory_mb: number;
}

const DEFAULT_GUEST: FlyGuest = { cpu_kind: 'shared', cpus: 1, memory_mb: 512 };

/** What the adapter needs to reach one Fly app's Machines API. */
export interface FlyProviderConfig {
  /** The Fly app the match Machines run as (`fly apps` name). */
  readonly appName: string;
  /** A Fly API token with deploy rights on that app. Never logged. */
  readonly token: string;
  /** API base; defaults to {@link DEFAULT_FLY_API}. Overridable for a proxy/test. */
  readonly apiBase?: string;
  /** Guest size for created Machines; defaults to {@link DEFAULT_GUEST}. */
  readonly guest?: FlyGuest;
}

/** The shape of a Fly Machine as the API returns it — only the fields we read. */
interface FlyMachine {
  readonly id?: unknown;
  readonly state?: unknown;
  readonly region?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
}

/**
 * A {@link MachineProvider} backed by the Fly Machines API. Each method is one
 * REST call, mapping Fly's Machine object onto our vendor-neutral {@link Machine}
 * and Fly's state names onto our four-state lifecycle.
 */
export class FlyMachineProvider implements MachineProvider {
  private readonly appName: string;
  private readonly token: string;
  private readonly apiBase: string;
  private readonly guest: FlyGuest;

  constructor(config: FlyProviderConfig) {
    this.appName = config.appName;
    this.token = config.token;
    this.apiBase = config.apiBase ?? DEFAULT_FLY_API;
    this.guest = config.guest ?? DEFAULT_GUEST;
  }

  async list(now: number): Promise<readonly Machine[]> {
    const raw = await this.call('GET', `/apps/${this.appName}/machines`, undefined, '');
    if (!Array.isArray(raw)) return [];
    return raw.map((m) => this.toMachine(m as FlyMachine, '', now));
  }

  async create(opts: CreateOptions, now: number): Promise<Machine> {
    // A create in a region with no room comes back 422 → CapacityError, carrying
    // the region so an operator sees *where* the fleet could not grow.
    const body = {
      region: opts.region,
      config: { image: opts.image, guest: this.guest, auto_destroy: false },
    };
    const raw = await this.call('POST', `/apps/${this.appName}/machines`, body, opts.region);
    return this.toMachine(raw as FlyMachine, opts.region, now);
  }

  async start(id: MachineId, now: number): Promise<Machine> {
    await this.call('POST', `/apps/${this.appName}/machines/${id}/start`, undefined, '');
    return this.get(id, now);
  }

  async stop(id: MachineId, now: number): Promise<Machine> {
    await this.call('POST', `/apps/${this.appName}/machines/${id}/stop`, undefined, '');
    return this.get(id, now);
  }

  async destroy(id: MachineId, now: number): Promise<Machine> {
    // force=true so a still-running Machine is torn down in one call; the fleet
    // controller only ever destroys drained hosts, but the flag keeps `destroy`
    // total regardless of the caller.
    await this.call('DELETE', `/apps/${this.appName}/machines/${id}?force=true`, undefined, '');
    return { id, state: 'destroyed', region: '', createdAt: now, updatedAt: now };
  }

  /** Read one Machine's current state back after a lifecycle call. */
  private async get(id: MachineId, now: number): Promise<Machine> {
    const raw = await this.call('GET', `/apps/${this.appName}/machines/${id}`, undefined, '');
    return this.toMachine(raw as FlyMachine, '', now);
  }

  /**
   * One authenticated REST call. Returns the parsed JSON body (or `undefined`
   * for an empty one). Maps 422 onto {@link CapacityError} — a full region — and
   * every other non-2xx onto a thrown `Error` carrying the status.
   */
  private async call(
    method: string,
    path: string,
    body: unknown,
    region: string,
  ): Promise<unknown> {
    const init: RequestInit = {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);

    const response = await fetch(`${this.apiBase}${path}`, init);
    if (response.status === 422) {
      // A region out of capacity — a fact the fleet controller records, not a crash.
      const detail = await response.text().catch(() => '');
      throw new CapacityError(region, `fly: no capacity for ${path} (422) ${detail}`.trim());
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`fly: ${method} ${path} failed ${response.status} ${detail}`.trim());
    }
    if (response.status === 204) return undefined;
    return response.json().catch(() => undefined);
  }

  /** Map a Fly Machine object onto our vendor-neutral {@link Machine}. */
  private toMachine(raw: FlyMachine, fallbackRegion: string, now: number): Machine {
    const id = typeof raw.id === 'string' ? raw.id : '';
    const region = typeof raw.region === 'string' ? raw.region : fallbackRegion;
    return {
      id,
      state: toState(raw.state),
      region,
      createdAt: parseTime(raw.created_at, now),
      updatedAt: parseTime(raw.updated_at, now),
    };
  }
}

/**
 * Collapse Fly's richer state vocabulary onto our four-state lifecycle. Fly's
 * transitional states resolve to the state they are heading for, so a caller
 * polling never sees a limbo value the seam does not define: `starting`→`started`,
 * `stopping`/`suspended`→`stopped`, `destroying`→`destroyed`. Anything unknown is
 * treated as `stopped` — the safe default, since a host we cannot classify is one
 * the controller will not route new rooms to.
 */
function toState(raw: unknown): MachineState {
  switch (raw) {
    case 'started':
    case 'starting':
    case 'replacing':
      return 'started';
    case 'created':
      return 'created';
    case 'destroyed':
    case 'destroying':
      return 'destroyed';
    case 'stopped':
    case 'stopping':
    case 'suspended':
    case 'suspending':
      return 'stopped';
    default:
      return 'stopped';
  }
}

/** Parse an RFC3339 timestamp to epoch-ms, falling back to `now` when absent or
 *  unparseable. `Date.parse` is pure (it reads no clock), so this stays clockless. */
function parseTime(raw: unknown, now: number): number {
  if (typeof raw !== 'string') return now;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? now : ms;
}
