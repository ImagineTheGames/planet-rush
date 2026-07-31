/**
 * tests/allocator/edge-region.test.ts — inferring the creator's region from the
 * edge. OWNER: Netcode Engineer (the ratified region-placement ask, step 1).
 *
 * The header names here are not guesses. They were read off Fly's own header echo
 * from the developer's network on 2026-07-31:
 *
 *   $ curl -s https://debug.fly.dev/
 *   Fly-Request-Id: 01KYTQS8FBEA8JW7GYH7KQYPGE-gru
 *   Fly-Region: gru
 *   Fly-Client-Ip: 201.77.129.150
 *
 * — so `fly-region` is the header, and the request id's trailing `-gru` is the same
 * fact by a second route. Both are pinned below, including the one property the
 * whole feature rests on: **no header is not an error**. Off Fly there is no edge,
 * and a header-less request must still allocate.
 */

import { describe, it, expect } from 'vitest';
import {
  FLY_REGION_HEADER,
  FLY_REQUEST_ID_HEADER,
  edgeRegion,
  regionFromRequestId,
} from '../../allocator/edge-region';

describe('edgeRegion — the documented header', () => {
  it('reads the region Fly stamped on the request', () => {
    expect(edgeRegion({ [FLY_REGION_HEADER]: 'gru' })).toBe('gru');
    expect(edgeRegion({ [FLY_REGION_HEADER]: 'iad' })).toBe('iad');
  });

  it('normalises case and surrounding whitespace', () => {
    expect(edgeRegion({ [FLY_REGION_HEADER]: ' GRU ' })).toBe('gru');
  });

  it('takes the first value when Node hands the header back as an array', () => {
    expect(edgeRegion({ [FLY_REGION_HEADER]: ['gru', 'iad'] })).toBe('gru');
  });

  it('outranks the request-id suffix — the direct header is the direct answer', () => {
    expect(
      edgeRegion({
        [FLY_REGION_HEADER]: 'gru',
        [FLY_REQUEST_ID_HEADER]: '01KYTQS8FBEA8JW7GYH7KQYPGE-iad',
      }),
    ).toBe('gru');
  });
});

describe('edgeRegion — the request-id fallback', () => {
  it('takes the region off the end of a real Fly request id', () => {
    expect(edgeRegion({ [FLY_REQUEST_ID_HEADER]: '01KYTQS8FBEA8JW7GYH7KQYPGE-gru' })).toBe('gru');
  });

  it('is used when the direct header is present but unusable', () => {
    expect(
      edgeRegion({
        [FLY_REGION_HEADER]: '',
        [FLY_REQUEST_ID_HEADER]: '01KYTQS8FBEA8JW7GYH7KQYPGE-gru',
      }),
    ).toBe('gru');
  });

  it('splits on the LAST hyphen, so a hyphenated id still resolves', () => {
    expect(regionFromRequestId('abc-def-lhr')).toBe('lhr');
  });

  it('yields nothing for an id with no suffix, rather than guessing', () => {
    expect(regionFromRequestId('01KYTQS8FBEA8JW7GYH7KQYPGE')).toBeUndefined();
    expect(regionFromRequestId('01KYTQS8FBEA8JW7GYH7KQYPGE-')).toBeUndefined();
    expect(regionFromRequestId(undefined)).toBeUndefined();
  });
});

describe('edgeRegion — nothing to infer, and nothing that looks like a region', () => {
  it('returns undefined with no headers at all — off Fly, this is normal', () => {
    expect(edgeRegion({})).toBeUndefined();
  });

  it('rejects a value that is not shaped like a Fly region code', () => {
    // Three lowercase letters, exactly. Anything else is treated as no region at
    // all so it can never reach a placement log or a `/machines` reply.
    for (const junk of ['us-east-1', 'g', 'gruu', 'GR2', '<script>', 'gru;iad', '  ']) {
      expect(edgeRegion({ [FLY_REGION_HEADER]: junk })).toBeUndefined();
    }
  });
});
