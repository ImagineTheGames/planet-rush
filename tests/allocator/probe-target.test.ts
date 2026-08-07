/**
 * tests/allocator/probe-target.test.ts — where a client is told to time a region.
 * OWNER: Netcode Engineer (the region picker; `allocator/probe-target.ts`).
 *
 * This is the vendor seam beside {@link Router}, so the tests are the same shape:
 * the Fly implementation steers by header against one shared hostname, the direct
 * one hands out a Machine's own address, and neither can invent a target it does
 * not have.
 */

import { describe, expect, it } from 'vitest';
import {
  DirectProbeTargeter,
  FLY_PREFER_REGION_HEADER,
  FlyPreferRegionTargeter,
  healthUrlFrom,
} from '../../allocator/probe-target';

describe('FlyPreferRegionTargeter', () => {
  const targeter = new FlyPreferRegionTargeter('https://gameserver.fly.dev/health');

  it('sends every region to the one anycast hostname, steered by header', () => {
    expect(targeter.probeFor('gru', undefined)).toEqual({
      url: 'https://gameserver.fly.dev/health',
      headers: { [FLY_PREFER_REGION_HEADER]: 'gru' },
    });
    expect(targeter.probeFor('iad', undefined)?.headers).toEqual({
      [FLY_PREFER_REGION_HEADER]: 'iad',
    });
  });

  it('needs no Machine — behind the edge the client never learns a per-Machine address', () => {
    expect(targeter.probeFor('lhr', undefined)).not.toBeNull();
  });
});

describe('DirectProbeTargeter', () => {
  const targeter = new DirectProbeTargeter((m) => `ws://${m}.local:8080/`);

  it('hands out the Machine’s own /health, with no steer to send', () => {
    expect(targeter.probeFor('iad', 'm-1')).toEqual({ url: 'http://m-1.local:8080/health' });
  });

  it('has NO target for a region with no live Machine — and says null rather than guessing', () => {
    expect(targeter.probeFor('syd', undefined)).toBeNull();
  });

  it('has no target when the address function produces nonsense', () => {
    expect(new DirectProbeTargeter(() => 'not a url').probeFor('iad', 'm-1')).toBeNull();
  });
});

describe('healthUrlFrom — the health route beside the socket', () => {
  it('keeps the host and the port, swaps the scheme, and replaces the path', () => {
    expect(healthUrlFrom('ws://m-1:8080/')).toBe('http://m-1:8080/health');
    expect(healthUrlFrom('wss://gameserver.fly.dev/play')).toBe('https://gameserver.fly.dev/health');
    expect(healthUrlFrom('https://gameserver.fly.dev/')).toBe('https://gameserver.fly.dev/health');
  });

  it('drops a query and a fragment — a ticket must never ride a probe', () => {
    expect(healthUrlFrom('wss://host/play?ticket=abc#x')).toBe('https://host/health');
  });

  it('refuses a scheme it does not know, and anything unparseable', () => {
    expect(healthUrlFrom('ftp://host/')).toBeNull();
    expect(healthUrlFrom('m-1:8080')).toBeNull();
    expect(healthUrlFrom('')).toBeNull();
  });
});
