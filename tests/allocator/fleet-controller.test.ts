/**
 * tests/allocator/fleet-controller.test.ts — the fleet controller, tested with
 * the in-memory provider fake and a real room registry, so no cloud account and
 * no bill (allocator/provider.ts). The controller ships DISABLED
 * (`FLEET_AUTOSCALE=on` flips it); these tests prove that turning it on behaves,
 * because the honest reason to ship it off is that it has been tested, not that
 * it is unfinished. OWNER: Netcode Engineer (docs/hosting-plan.md, Task 10).
 *
 * Two rules under test, from the brief:
 *   • Scale UP on event-loop lag (primary), with free slots as a floor beneath it.
 *     Start a stopped spare (fast), then replenish the pool.
 *   • Scale DOWN by DRAINING, never by killing: cordon, let live matches end, stop.
 *
 * Everything is clockless — every method takes `now`, so a seeded test is exact.
 */

import { describe, it, expect } from 'vitest';
import { FleetController, type FleetControllerConfig } from '../../allocator/fleet-controller';
import { InMemoryMachineProvider, CapacityError, type MachineProvider } from '../../allocator/provider';
import { InMemoryRoomRegistry, type Room } from '../../allocator/registry';

/** Provision a machine in the provider and walk it to the requested state. */
async function spawn(
  provider: InMemoryMachineProvider,
  state: 'created' | 'started' | 'stopped',
  now: number,
): Promise<string> {
  const m = await provider.create({ region: 'iad', image: 'planet-rush:test' }, now);
  if (state === 'started') await provider.start(m.id, now);
  if (state === 'stopped') {
    await provider.start(m.id, now);
    await provider.stop(m.id, now);
  }
  return m.id;
}

/** Heartbeat a machine into the registry with a given occupancy. */
function beat(
  registry: InMemoryRoomRegistry,
  machine: string,
  capacity: number,
  rooms: number,
  now: number,
): void {
  const list: Room[] = Array.from({ length: rooms }, (_, i) => ({
    code: `${machine}-r${i}`,
    players: 8,
  }));
  registry.observe({ machine, region: 'iad', capacity, rooms: list }, now);
}

/** A small config with tiny thresholds so the arithmetic is obvious in a test. */
function config(
  provider: MachineProvider,
  registry: InMemoryRoomRegistry,
  overrides: Partial<FleetControllerConfig> = {},
): FleetControllerConfig {
  return {
    provider,
    registry,
    enabled: true,
    region: 'iad',
    image: 'planet-rush:test',
    lagThresholdMs: 100,
    minFreeSlots: 2,
    poolSize: 1,
    scaleDownFreeSlots: 4,
    minRunning: 1,
    ...overrides,
  };
}

describe('FleetController — shipped switched off', () => {
  it('does nothing at all when disabled, however loud the signal', async () => {
    const provider = new InMemoryMachineProvider();
    const registry = new InMemoryRoomRegistry();
    const m1 = await spawn(provider, 'started', 0);
    beat(registry, m1, 4, 4, 1000); // full — free slots 0

    const fc = new FleetController(config(provider, registry, { enabled: false }));
    const report = await fc.reconcile({ loopLagMs: 9999 }, 1000);

    expect(report.enabled).toBe(false);
    expect(report.started).toEqual([]);
    expect(report.created).toBe(0);
    expect(report.cordoned).toEqual([]);
    expect(report.stopped).toEqual([]);

    // The fleet is untouched: still exactly the one started machine.
    const list = await provider.list(2000);
    expect(list).toHaveLength(1);
    expect(list[0]?.state).toBe('started');
  });
});

describe('FleetController — scale up', () => {
  it('on lag, starts a stopped spare (fast) and replenishes the pool', async () => {
    const provider = new InMemoryMachineProvider();
    const registry = new InMemoryRoomRegistry();
    const m1 = await spawn(provider, 'started', 0); // serving
    const spare = await spawn(provider, 'stopped', 0); // ready to start fast
    beat(registry, m1, 4, 4, 1000);

    const fc = new FleetController(config(provider, registry));
    const report = await fc.reconcile({ loopLagMs: 250 }, 1000);

    // The spare was started — the fast path, no create on the player's critical path.
    expect(report.started).toEqual([spare]);
    // The pool it drained from is replenished (one fresh spare created).
    expect(report.created).toBe(1);

    const list = await provider.list(2000);
    expect(list.find((m) => m.id === spare)?.state).toBe('started');
    // Exactly one new machine exists beyond the two we started with.
    expect(list).toHaveLength(3);
  });

  it('scales up on the free-slot floor even when lag is quiet', async () => {
    const provider = new InMemoryMachineProvider();
    const registry = new InMemoryRoomRegistry();
    const m1 = await spawn(provider, 'started', 0);
    const spare = await spawn(provider, 'stopped', 0);
    beat(registry, m1, 4, 3, 1000); // free 1 < minFreeSlots 2

    const fc = new FleetController(config(provider, registry));
    const report = await fc.reconcile({ loopLagMs: 0 }, 1000);

    expect(report.started).toEqual([spare]);
  });

  it('with no spare, creates and starts one, then still tops the pool up', async () => {
    const provider = new InMemoryMachineProvider();
    const registry = new InMemoryRoomRegistry();
    const m1 = await spawn(provider, 'started', 0);
    beat(registry, m1, 4, 4, 1000);

    const fc = new FleetController(config(provider, registry));
    const report = await fc.reconcile({ loopLagMs: 250 }, 1000);

    // One machine was created-and-started (degraded path), and one more created
    // as the replenished spare → two creates total, one start.
    expect(report.started).toHaveLength(1);
    expect(report.created).toBe(2);

    const list = await provider.list(2000);
    expect(list.filter((m) => m.state === 'started')).toHaveLength(2);
    expect(list.filter((m) => m.state === 'created' || m.state === 'stopped')).toHaveLength(1);
  });

  it('is quiet in steady state — capacity healthy, pool full, no lag', async () => {
    const provider = new InMemoryMachineProvider();
    const registry = new InMemoryRoomRegistry();
    const m1 = await spawn(provider, 'started', 0);
    await spawn(provider, 'stopped', 0); // the pool's one spare
    beat(registry, m1, 4, 2, 1000); // free 2 — not below floor, not above drain line

    const fc = new FleetController(config(provider, registry));
    const report = await fc.reconcile({ loopLagMs: 0 }, 1000);

    expect(report.started).toEqual([]);
    expect(report.created).toBe(0);
    expect(report.cordoned).toEqual([]);
    expect(report.stopped).toEqual([]);
  });
});

describe('FleetController — scale down by draining', () => {
  it('cordons the least-loaded machine and stops it once it is already empty', async () => {
    const provider = new InMemoryMachineProvider();
    const registry = new InMemoryRoomRegistry();
    const idle = await spawn(provider, 'started', 0); // 0 rooms → drains instantly
    const busy = await spawn(provider, 'started', 0);
    beat(registry, idle, 4, 0, 1000);
    beat(registry, busy, 4, 1, 1000); // total free 7 ≥ drain line 4, running 2 > 1

    const fc = new FleetController(config(provider, registry, { poolSize: 0 }));
    const report = await fc.reconcile({ loopLagMs: 0 }, 1000);

    expect(report.cordoned).toEqual([idle]);
    expect(report.stopped).toEqual([idle]); // empty → drained → stopped this pass
    const list = await provider.list(2000);
    expect(list.find((m) => m.id === idle)?.state).toBe('stopped'); // stopped, NOT destroyed
    expect(list.find((m) => m.id === busy)?.state).toBe('started');
  });

  it('never stops a machine with a live match — it waits, then stops when drained', async () => {
    const provider = new InMemoryMachineProvider();
    const registry = new InMemoryRoomRegistry();
    const a = await spawn(provider, 'started', 0);
    const b = await spawn(provider, 'started', 0);
    beat(registry, a, 4, 2, 1000);
    beat(registry, b, 4, 1, 1000); // b least-loaded but still hosting a match

    const fc = new FleetController(config(provider, registry, { poolSize: 0 }));

    // Pass 1: cordon b, but it has a live match → do NOT stop it.
    const p1 = await fc.reconcile({ loopLagMs: 0 }, 1000);
    expect(p1.cordoned).toEqual([b]);
    expect(p1.stopped).toEqual([]);
    expect(fc.isCordoned(b)).toBe(true);
    expect((await provider.list(1000)).find((m) => m.id === b)?.state).toBe('started');

    // The match on b ends; its next heartbeat reports zero rooms.
    beat(registry, a, 4, 2, 2000);
    beat(registry, b, 4, 0, 2000);

    // Pass 2: b has drained → it is stopped. No second machine is cordoned while
    // one is still draining (drain one at a time).
    const p2 = await fc.reconcile({ loopLagMs: 0 }, 2000);
    expect(p2.cordoned).toEqual([]);
    expect(p2.stopped).toEqual([b]);
    expect(fc.isCordoned(b)).toBe(false);
    expect((await provider.list(2000)).find((m) => m.id === b)?.state).toBe('stopped');
  });

  it('never drains below the minimum running floor', async () => {
    const provider = new InMemoryMachineProvider();
    const registry = new InMemoryRoomRegistry();
    const only = await spawn(provider, 'started', 0);
    beat(registry, only, 4, 0, 1000); // fully idle, free 4 ≥ drain line

    const fc = new FleetController(config(provider, registry, { poolSize: 0, minRunning: 1 }));
    const report = await fc.reconcile({ loopLagMs: 0 }, 1000);

    // Idle, but it is the last one running — keep it warm rather than cold-start later.
    expect(report.cordoned).toEqual([]);
    expect(report.stopped).toEqual([]);
  });

  it('breaks a load tie deterministically by machine id', async () => {
    const provider = new InMemoryMachineProvider();
    const registry = new InMemoryRoomRegistry();
    const first = await spawn(provider, 'started', 0); // m-1
    const second = await spawn(provider, 'started', 0); // m-2
    beat(registry, first, 4, 0, 1000);
    beat(registry, second, 4, 0, 1000); // both idle — a tie

    const fc = new FleetController(config(provider, registry, { poolSize: 0 }));
    const report = await fc.reconcile({ loopLagMs: 0 }, 1000);

    // Lowest id wins the tie, every run.
    expect(report.cordoned).toEqual([first]);
    expect(report.stopped).toEqual([first]);
  });
});

describe('FleetController — capacity is a fact, not a crash', () => {
  it('records a region-out-of-capacity refusal instead of throwing', async () => {
    // A provider whose region is full: create always 422s → CapacityError.
    const provider: MachineProvider = {
      list: async () => [],
      create: async () => {
        throw new CapacityError('iad', 'no capacity in region iad');
      },
      start: async () => {
        throw new Error('should not start when nothing was created');
      },
      stop: async () => {
        throw new Error('unused');
      },
      destroy: async () => {
        throw new Error('unused');
      },
    };
    const registry = new InMemoryRoomRegistry();

    const fc = new FleetController(config(provider, registry));
    // Empty fleet, zero free slots → wants to scale up, but the region is full.
    const report = await fc.reconcile({ loopLagMs: 250 }, 1000);

    expect(report.capacityUnavailable).toBe(true);
    expect(report.started).toEqual([]);
    expect(report.created).toBe(0);
  });
});
