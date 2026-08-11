/**
 * tests/allocator/region-geo.test.ts — the geography the allocator falls back on
 * (n9-01). The bug this module exists to kill: a request arriving on the `dfw`
 * POP, which the fleet has never run a Machine in, was treated as *no preference
 * at all* and could be placed in São Paulo. `dfw` is 1,900 km from Ashburn and
 * 7,500 km from São Paulo, so the only thing that was ever missing is the fact
 * that a POP has a location even when we run nothing there.
 *
 * These tests pin the three things the next person adding a region inherits: the
 * acceptance case by name, what the table covers, and — the part that matters
 * most — exactly what an *unknown* code does. OWNER: Netcode Engineer (GDD §4.2).
 */

import { describe, it, expect } from 'vitest';
import { nearestRegion, regionDistanceKm } from '../../allocator/region-geo';

/** The fleet as it has actually run since 2026-07-30 (docs/hosting-plan.md T11). */
const FLEET = ['iad', 'gru'];

describe('regionDistanceKm — the great circle, checkable against a map', () => {
  it('measures dfw→iad at ~1,880 km and dfw→gru at ~8,240 km', () => {
    // The whole brief in two numbers: Ashburn is four and a half times nearer to
    // Dallas than São Paulo is. Tolerances are wide on purpose — the claim is
    // "this is not a close call", not "this is accurate to the metre".
    expect(regionDistanceKm('dfw', 'iad')).toBeCloseTo(1880, -2);
    expect(regionDistanceKm('dfw', 'gru')).toBeCloseTo(8240, -2);
  });

  it('is symmetric, and zero from a region to itself', () => {
    expect(regionDistanceKm('gru', 'iad')).toBeCloseTo(regionDistanceKm('iad', 'gru')!, 6);
    expect(regionDistanceKm('iad', 'iad')).toBe(0);
  });

  it('crosses the antimeridian without going the long way round', () => {
    // Tokyo→San Jose is ~8,400 km eastward across the Pacific. A naive
    // difference-of-longitudes would take the 27,000 km route through Europe.
    expect(regionDistanceKm('nrt', 'sjc')).toBeLessThan(9000);
  });

  it('answers undefined for a code the table does not carry, on either side', () => {
    expect(regionDistanceKm('zzz', 'iad')).toBeUndefined();
    expect(regionDistanceKm('iad', 'zzz')).toBeUndefined();
  });
});

describe('nearestRegion — which of OUR regions an arbitrary POP means', () => {
  it('resolves the developer POP: dfw is iad, and it is not close', () => {
    expect(nearestRegion('dfw', FLEET)).toBe('iad');
  });

  it('does not resolve dfw to gru even when gru is listed first', () => {
    // Candidate order must not decide a continent — this is the failure mode the
    // old `leastLoaded` id tie-break had, expressed at the geography layer.
    expect(nearestRegion('dfw', ['gru', 'iad'])).toBe('iad');
    expect(nearestRegion('dfw', ['iad', 'gru'])).toBe('iad');
  });

  it('still sends the southern hemisphere to gru — the fix is nearest, not "always iad"', () => {
    // The Brazil complaint that started all of this (docs/hosting-plan.md T15)
    // must not be re-broken by the fix for the Florida one. Johannesburg and
    // Sydney come along with it, and that is not a rounding artefact: São Paulo
    // is 7,439 km from `jnb` against Ashburn's 13,094, and 13,368 km from `syd`
    // against Ashburn's 15,680. A POP→region table written by hand would very
    // likely have filed both under "not America → iad".
    for (const pop of ['gru', 'gig', 'eze', 'scl', 'jnb', 'syd']) {
      expect(nearestRegion(pop, FLEET)).toBe('gru');
    }
  });

  it('sends the northern hemisphere to iad on this two-region fleet', () => {
    // Everything north of the equator is nearer Ashburn than São Paulo — the
    // honest answer for a fleet running nothing in Europe or Asia. Bogotá is the
    // near-miss worth pinning: 3,822 km to Ashburn against 4,336 km to São Paulo,
    // so even a Colombian creator is (marginally) a Virginia one on this fleet.
    for (const pop of ['sea', 'lax', 'ord', 'yyz', 'lhr', 'fra', 'nrt', 'sin', 'bog']) {
      expect(nearestRegion(pop, FLEET)).toBe('iad');
    }
  });

  it('re-ranks itself when the fleet grows, with no table edit', () => {
    // The argument for coordinates over a static POP→region table: add lhr and
    // Frankfurt stops meaning Virginia, without anyone revisiting a row.
    expect(nearestRegion('fra', ['iad', 'gru'])).toBe('iad');
    expect(nearestRegion('fra', ['iad', 'gru', 'lhr'])).toBe('lhr');
  });

  it('ranks the SECOND-nearest region too, which is what a full region needs', () => {
    // `pickMachine` hands it only the regions that still have a slot. With iad
    // out of the pool, dfw must resolve to the nearest remaining one.
    expect(nearestRegion('dfw', ['gru', 'lhr'])).toBe('lhr');
    expect(nearestRegion('dfw', ['gru'])).toBe('gru');
  });

  it('covers all 35 regions Fly publishes — every one resolves', () => {
    // The audit. A code in this list with no row would answer undefined and get
    // whole-fleet spread; naming them here is how the next person adding a region
    // finds out the table is what they must extend.
    const flyRegions = [
      'ams', 'arn', 'atl', 'bog', 'bom', 'bos', 'cdg', 'den', 'dfw', 'ewr', 'eze', 'fra',
      'gdl', 'gig', 'gru', 'hkg', 'iad', 'jnb', 'lax', 'lhr', 'mad', 'mia', 'nrt', 'ord',
      'otp', 'phx', 'qro', 'scl', 'sea', 'sin', 'sjc', 'syd', 'waw', 'yul', 'yyz',
    ];
    expect(flyRegions).toHaveLength(35);
    const unmapped = flyRegions.filter((r) => nearestRegion(r, FLEET) === undefined);
    expect(unmapped).toEqual([]);
  });

  it('answers undefined for an unknown POP rather than guessing', () => {
    // The inherited behaviour, stated: an unmapped POP has no opinion, and the
    // allocator falls back to the whole-fleet spread that shipped before this
    // module. A wrong continent would be worse than no preference.
    expect(nearestRegion('zzz', FLEET)).toBeUndefined();
    expect(nearestRegion('', FLEET)).toBeUndefined();
  });

  it('answers undefined when no CANDIDATE is on the map', () => {
    expect(nearestRegion('dfw', ['zzz', 'qqq'])).toBeUndefined();
    expect(nearestRegion('dfw', [])).toBeUndefined();
  });

  it('skips an unmapped candidate rather than letting it lose the whole ranking', () => {
    // A fleet region with no row is not a nearest-candidate, but it must not stop
    // the mapped ones from being ranked.
    expect(nearestRegion('dfw', ['zzz', 'iad'])).toBe('iad');
  });
});
