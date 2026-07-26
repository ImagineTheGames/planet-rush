/**
 * tests/allocator/provider.test.ts — the machine-provider seam. Five methods
 * (list/create/start/stop/destroy) keep the cloud vendor out of every other
 * file; the in-memory fake makes the fleet controller testable with no cloud
 * account and no bill. Every method takes the clock as an argument, so these
 * tests never read a wall clock. OWNER: Netcode Engineer (docs/hosting-plan.md T4).
 */

import { describe, it, expect } from 'vitest';
import { InMemoryMachineProvider } from '../../allocator/provider';

describe('InMemoryMachineProvider — the fake fleet', () => {
  it('starts with an empty fleet', async () => {
    const p = new InMemoryMachineProvider();
    expect(await p.list(1000)).toEqual([]);
  });

  it('create provisions a machine stamped from the injected clock', async () => {
    const p = new InMemoryMachineProvider();
    const m = await p.create({ region: 'iad', image: 'planet-rush:1' }, 1000);

    expect(m.state).toBe('created');
    expect(m.region).toBe('iad');
    expect(m.createdAt).toBe(1000);
    expect(m.updatedAt).toBe(1000);
    expect(m.id).toBeTruthy();

    expect(await p.list(2000)).toHaveLength(1);
  });

  it('mints a distinct id per machine, deterministically', async () => {
    const p = new InMemoryMachineProvider();
    const a = await p.create({ region: 'iad', image: 'x' }, 1000);
    const b = await p.create({ region: 'iad', image: 'x' }, 1000);
    expect(a.id).not.toBe(b.id);
  });

  it('start / stop transition state and re-stamp updatedAt from the clock', async () => {
    const p = new InMemoryMachineProvider();
    const created = await p.create({ region: 'iad', image: 'x' }, 1000);

    const started = await p.start(created.id, 2000);
    expect(started.state).toBe('started');
    expect(started.createdAt).toBe(1000); // create time is immutable
    expect(started.updatedAt).toBe(2000);

    const stopped = await p.stop(created.id, 3000);
    expect(stopped.state).toBe('stopped');
    expect(stopped.updatedAt).toBe(3000);

    // The list reflects the latest state.
    const listed = await p.list(4000);
    expect(listed.find((x) => x.id === created.id)?.state).toBe('stopped');
  });

  it('destroy removes the machine from the fleet', async () => {
    const p = new InMemoryMachineProvider();
    const m = await p.create({ region: 'iad', image: 'x' }, 1000);
    const gone = await p.destroy(m.id, 2000);

    expect(gone.state).toBe('destroyed');
    expect(await p.list(3000)).toEqual([]);
  });

  it('walks the full lifecycle create → start → stop → destroy', async () => {
    const p = new InMemoryMachineProvider();
    const m = await p.create({ region: 'iad', image: 'x' }, 1000);
    await p.start(m.id, 2000);
    await p.stop(m.id, 3000);
    await p.destroy(m.id, 4000);
    expect(await p.list(5000)).toEqual([]);
  });

  it('start is idempotent on an already-started machine', async () => {
    const p = new InMemoryMachineProvider();
    const m = await p.create({ region: 'iad', image: 'x' }, 1000);
    await p.start(m.id, 2000);
    const again = await p.start(m.id, 3000);
    expect(again.state).toBe('started');
  });

  it('rejects operations on an unknown machine', async () => {
    const p = new InMemoryMachineProvider();
    await expect(p.start('nope', 1000)).rejects.toThrow(/unknown machine/i);
    await expect(p.stop('nope', 1000)).rejects.toThrow(/unknown machine/i);
    await expect(p.destroy('nope', 1000)).rejects.toThrow(/unknown machine/i);
  });

  it('rejects starting a destroyed machine', async () => {
    const p = new InMemoryMachineProvider();
    const m = await p.create({ region: 'iad', image: 'x' }, 1000);
    await p.destroy(m.id, 2000);
    await expect(p.start(m.id, 3000)).rejects.toThrow(/unknown machine/i);
  });

  it('list returns copies, so a caller cannot mutate fleet state through them', async () => {
    const p = new InMemoryMachineProvider();
    await p.create({ region: 'iad', image: 'x' }, 1000);
    const snap = await p.list(2000);
    // Attempt to corrupt the returned view.
    (snap[0] as { state: string }).state = 'destroyed';
    const fresh = await p.list(3000);
    expect(fresh[0]?.state).toBe('created'); // untouched
  });
});
