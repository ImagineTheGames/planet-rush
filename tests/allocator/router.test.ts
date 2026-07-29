/**
 * tests/allocator/router.test.ts — the Router seam (Task 8). The allocator
 * answers *which Machine*; the Router expresses that answer as the one
 * vendor-specific thing in the HTTP layer: *how a client is sent there*. On Fly
 * that is a `fly-replay` header the edge acts on; off Fly it is a direct connect
 * URL the client dials itself. Both satisfy the same seam, so the allocator
 * process is written once and deployed either way. OWNER: Netcode Engineer
 * (docs/hosting-plan.md T8).
 */

import { describe, it, expect } from 'vitest';
import { DirectRouter, FlyReplayRouter } from '../../allocator/router';

describe('DirectRouter — the client dials the Machine itself', () => {
  it('resolves the Machine to a direct connect URL and sets no replay header', () => {
    const router = new DirectRouter((machine) => `wss://${machine}.example.test/`);
    const instr = router.routeTo({ machine: 'm-1', region: 'iad' });
    expect(instr.connectUrl).toBe('wss://m-1.example.test/');
    expect(instr.headers).toEqual({});
  });

  it('routes each Machine to its own address', () => {
    const addresses: Record<string, string> = {
      'm-1': 'wss://a.test/',
      'm-2': 'wss://b.test/',
    };
    const router = new DirectRouter((m) => addresses[m] ?? '');
    expect(router.routeTo({ machine: 'm-2', region: 'lhr' }).connectUrl).toBe('wss://b.test/');
  });
});

describe('FlyReplayRouter — the edge routes to the Machine', () => {
  it('names the target instance for the socket hop to pin', () => {
    // Same region as the allocator: instance is enough for the edge to pin it.
    // This directive is what the SOCKET hop emits; the allocate/join JSON response
    // never carries it (that would replay the POST at the gameserver).
    const router = new FlyReplayRouter({ selfRegion: 'iad' });
    const instr = router.routeTo({ machine: 'm-1', region: 'iad' });
    expect(instr.headers['fly-replay']).toBe('instance=m-1');
    // No connectUrl configured → null. The allocate response supplies its own.
    expect(instr.connectUrl).toBeNull();
  });

  it('hands back the configured shared gameserver connectUrl for the JSON response', () => {
    // The client dials this one shared hostname; the socket hop replays a
    // wrong-machine upgrade to the room's host. The instance pin still rides
    // `headers`, but the allocate/join response takes only the connectUrl.
    const router = new FlyReplayRouter({
      selfRegion: 'iad',
      connectUrl: 'wss://planet-rush-gameserver.fly.dev/play',
    });
    const instr = router.routeTo({ machine: 'm-1', region: 'iad' });
    expect(instr.connectUrl).toBe('wss://planet-rush-gameserver.fly.dev/play');
    expect(instr.headers['fly-replay']).toBe('instance=m-1');
  });

  it('adds the region when the target is in another datacentre', () => {
    // Cross-region replay: Fly needs the region hint to reach the instance.
    const router = new FlyReplayRouter({ selfRegion: 'iad' });
    const instr = router.routeTo({ machine: 'm-9', region: 'lhr' });
    expect(instr.headers['fly-replay']).toBe('region=lhr;instance=m-9');
  });

  it('targets another app when the match servers are a separate Fly app', () => {
    const router = new FlyReplayRouter({ selfRegion: 'iad', appName: 'planet-rush-match' });
    const instr = router.routeTo({ machine: 'm-1', region: 'iad' });
    expect(instr.headers['fly-replay']).toBe('app=planet-rush-match;instance=m-1');
  });

  it('composes app and region together for a cross-region, cross-app target', () => {
    const router = new FlyReplayRouter({ selfRegion: 'iad', appName: 'planet-rush-match' });
    const instr = router.routeTo({ machine: 'm-9', region: 'lhr' });
    expect(instr.headers['fly-replay']).toBe('app=planet-rush-match;region=lhr;instance=m-9');
  });

  it('omits the region when the allocator does not know its own', () => {
    // No selfRegion configured: cannot tell same- from cross-region, so it only
    // ever pins the instance (still correct — instance alone routes on Fly).
    const router = new FlyReplayRouter({});
    expect(router.routeTo({ machine: 'm-1', region: 'lhr' }).headers['fly-replay']).toBe(
      'instance=m-1',
    );
  });
});
