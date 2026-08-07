/**
 * tests/net/capacity/guest-model.ts — from measured CPU-per-room to rooms per
 * guest, and dollars per room. OWNER: Netcode Engineer (m11 server stress;
 * GDD §4.2, risk 1).
 *
 * The ramp measures one thing honestly: **how much CPU a room costs, per second
 * of wall clock, on the core it ran on** (`./capacity-ramp.ts`). Everything an
 * operator actually wants to know is arithmetic on top of that number, and this
 * file is that arithmetic, written down so the developer can re-run it against a
 * different price or a different quota without re-running the twenty-minute ramp.
 *
 * **The quota is the whole story on a shared guest.** A `shared-cpu-1x` is
 * metered at a **baseline of 1/16th of a CPU — 6.25%** — with bursting above it
 * on credit. Burst is not capacity: a match is a twelve-minute sustained load, so
 * a room count that only works while credit lasts is a room count that fails in
 * the second half of every match, all rooms on the Machine together. So the model
 * plans against the *baseline*, and treats burst as the margin that absorbs a
 * wave spawn rather than as headroom to fill.
 *
 * **Percent of a core ↔ ms of CPU per second.** One percent of one core is 10 ms
 * of CPU per second of wall clock. Every conversion here is that one line.
 *
 * Prices are Fly's published `iad` figures (the fleet's `primary_region`,
 * `fly.gameserver.toml`), read from https://fly.io/docs/about/pricing on
 * **2026-08-07**. They are *inputs*, not results: Fly re-prices, and a table
 * baked into a document is a table that goes quietly wrong (GDD §4.3b risk 1 —
 * the host is replaceable and the spec treats it that way). Re-read the page,
 * edit {@link FLY_IAD_GUESTS}, re-render.
 */

/** One Fly Machine size, as the fleet could deploy it. */
export interface Guest {
  readonly name: string;
  /** Sustained CPU this guest is metered at, as a percentage of ONE core.
   *  Shared sizes are `n × 6.25%`; a performance CPU is a whole dedicated core. */
  readonly quotaPercentOfCore: number;
  readonly memoryMb: number;
  /** USD per 30 days, `iad`, at that memory. */
  readonly usdPerMonth: number;
}

/**
 * The candidates worth putting in front of the developer. `shared-cpu-1x` at
 * 512 MB is what the fleet deploys today (`fly.gameserver.toml [[vm]]`); the
 * brief asks for "the same run against one size up", which is the next two rows;
 * `performance-1x` is included because it is the first row where the quota stops
 * being the binding constraint and the answer changes shape rather than degree.
 */
export const FLY_IAD_GUESTS: readonly Guest[] = [
  { name: 'shared-cpu-1x', quotaPercentOfCore: 6.25, memoryMb: 256, usdPerMonth: 1.94 },
  { name: 'shared-cpu-1x', quotaPercentOfCore: 6.25, memoryMb: 512, usdPerMonth: 3.19 },
  { name: 'shared-cpu-1x', quotaPercentOfCore: 6.25, memoryMb: 1024, usdPerMonth: 5.7 },
  { name: 'shared-cpu-2x', quotaPercentOfCore: 12.5, memoryMb: 512, usdPerMonth: 3.89 },
  { name: 'shared-cpu-2x', quotaPercentOfCore: 12.5, memoryMb: 1024, usdPerMonth: 6.39 },
  { name: 'shared-cpu-4x', quotaPercentOfCore: 25, memoryMb: 1024, usdPerMonth: 7.78 },
  { name: 'shared-cpu-8x', quotaPercentOfCore: 50, memoryMb: 2048, usdPerMonth: 15.55 },
  { name: 'performance-1x', quotaPercentOfCore: 100, memoryMb: 2048, usdPerMonth: 31.0 },
];

/** The empirical inputs a projection needs, all of them measured. */
export interface RoomCost {
  /** Marginal CPU per room, ms per second of wall clock, on the measured core. */
  readonly cpuMsPerRoomPerSec: number;
  /** The empty process's own draw, ms of CPU per second. Not billed to rooms. */
  readonly floorMsPerSec: number;
  /** Steady-state RSS of the empty process, MB. */
  readonly floorRssMb: number;
  /** Marginal memory per room, MB. */
  readonly rssMbPerRoom: number;
  /**
   * How much slower the target core is than the measured one, as a multiplier
   * (`measuredMsPerStep / targetMsPerStep` inverted — see `./core-speed.ts`).
   * 1 means "the same core", which is the honest value when the ramp ran ON the
   * guest being modelled, and is what a hosted run should use.
   */
  readonly coreSlowdown: number;
}

/** What one guest could hold, and what that costs. */
export interface GuestProjection {
  readonly guest: Guest;
  /** Rooms the CPU quota allows at the given headroom. */
  readonly roomsByCpu: number;
  /** Rooms the memory allows. */
  readonly roomsByMemory: number;
  /** The binding one — `min` of the two. */
  readonly rooms: number;
  /** Which constraint bound it. */
  readonly boundBy: 'cpu' | 'memory';
  /** USD per 30 days per room at that count. Infinity when nothing fits. */
  readonly usdPerRoomPerMonth: number;
}

/**
 * Headroom kept back from the quota. A Machine planned to 100% of its baseline
 * has nothing left for an asteroid wave, a join burst, a garbage collection, or
 * the noisy neighbour a *shared* core is definitionally sharing with. 70% is the
 * default and is a judgement, not a measurement — it is stated in the report so
 * the developer can move it.
 */
export const DEFAULT_HEADROOM = 0.7;

/** Memory kept back for the same reasons. */
export const DEFAULT_MEMORY_HEADROOM = 0.8;

/** Project one guest. */
export function projectGuest(
  guest: Guest,
  cost: RoomCost,
  headroom = DEFAULT_HEADROOM,
  memoryHeadroom = DEFAULT_MEMORY_HEADROOM,
): GuestProjection {
  // Percent of a core → ms of CPU per second, then take the headroom off.
  const budgetMsPerSec = guest.quotaPercentOfCore * 10 * headroom;
  const perRoom = cost.cpuMsPerRoomPerSec * cost.coreSlowdown;
  const floor = cost.floorMsPerSec * cost.coreSlowdown;
  const roomsByCpu = perRoom > 0 ? Math.max(0, Math.floor((budgetMsPerSec - floor) / perRoom)) : 0;

  const memoryBudget = guest.memoryMb * memoryHeadroom - cost.floorRssMb;
  const roomsByMemory =
    cost.rssMbPerRoom > 0 ? Math.max(0, Math.floor(memoryBudget / cost.rssMbPerRoom)) : roomsByCpu;

  const rooms = Math.min(roomsByCpu, roomsByMemory);
  return {
    guest,
    roomsByCpu,
    roomsByMemory,
    rooms,
    boundBy: roomsByCpu <= roomsByMemory ? 'cpu' : 'memory',
    usdPerRoomPerMonth: rooms > 0 ? guest.usdPerMonth / rooms : Number.POSITIVE_INFINITY,
  };
}

/** Project every candidate guest. */
export function projectFleet(
  cost: RoomCost,
  guests: readonly Guest[] = FLY_IAD_GUESTS,
  headroom = DEFAULT_HEADROOM,
): readonly GuestProjection[] {
  return guests.map((guest) => projectGuest(guest, cost, headroom));
}

/**
 * The decision table the brief asks for: **the developer decides machine size
 * with a table, not a guess.** Rooms per Machine, dollars per room, and which
 * constraint binds — so "one size up" is a comparison rather than a hunch.
 */
export function renderGuestTable(
  projections: readonly GuestProjection[],
  cost: RoomCost,
  headroom = DEFAULT_HEADROOM,
): string {
  const lines: string[] = [];
  lines.push(
    `**Inputs:** ${cost.cpuMsPerRoomPerSec.toFixed(2)} ms CPU/s per room · process floor ` +
      `${cost.floorMsPerSec.toFixed(2)} ms CPU/s · ${cost.rssMbPerRoom.toFixed(1)} MB per room ` +
      `over a ${cost.floorRssMb.toFixed(0)} MB floor · core slowdown ×${cost.coreSlowdown} · ` +
      `headroom ${Math.round(headroom * 100)}% of the sustained quota`,
  );
  lines.push('');
  lines.push('| guest (iad) | sustained quota | RAM | $/mo | rooms (CPU) | rooms (RAM) | **rooms** | bound by | $/room/mo |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---|---:|');
  for (const p of projections) {
    lines.push(
      `| ${p.guest.name} | ${p.guest.quotaPercentOfCore}% of a core | ${p.guest.memoryMb} MB | ` +
        `$${p.guest.usdPerMonth.toFixed(2)} | ${p.roomsByCpu} | ${p.roomsByMemory} | **${p.rooms}** | ` +
        `${p.boundBy} | ${p.usdPerRoomPerMonth === Number.POSITIVE_INFINITY ? '—' : `$${p.usdPerRoomPerMonth.toFixed(2)}`} |`,
    );
  }
  lines.push('');
  lines.push(
    '_Prices: Fly.io published `iad` rates, read 2026-08-07. Quotas: shared sizes are ' +
      'n × 6.25% of a core sustained (burst above that is credit, not capacity); a ' +
      'performance CPU is a dedicated core._',
  );
  return lines.join('\n');
}

/**
 * The capacity a Machine should **advertise**, from a measured honest N. The
 * allocator packs seat-weighted against this number (`allocator/allocator.ts`),
 * so it is a promise, not an ambition: margin comes off before it is published.
 *
 * A quarter off, floored. Not a round number chosen for looking tidy — the
 * measured N is where the loop *starts* to lose, one machine, one afternoon,
 * with a synthetic pilot who never opens a build wheel; a fleet meets worse.
 */
export function advertisedCapacity(honestN: number, margin = 0.25): number {
  return Math.max(1, Math.floor(honestN * (1 - margin)));
}
