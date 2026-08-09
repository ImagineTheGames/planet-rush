/**
 * src/net/cors.test.ts — who may call the two server processes, and with what.
 * OWNER: Netcode Engineer.
 *
 * The rule shipped twice-over as a copy in the allocator; the region picker made
 * the match server need it too (its `/health` is what a probe times), so it became
 * `./cors.ts` and both processes import it. These are the properties that must not
 * drift between them.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALLOW_ORIGIN,
  allowOriginsFromEnv,
  corsHeaders,
  firstHeaderValue,
  originAllowed,
  preflightHeaders,
} from './cors';

describe('the grant', () => {
  it('echoes an allow-listed origin, and varies on Origin so a cache cannot cross-serve it', () => {
    expect(corsHeaders('https://imaginethegames.github.io', [DEFAULT_ALLOW_ORIGIN])).toEqual({
      'access-control-allow-origin': 'https://imaginethegames.github.io',
      vary: 'Origin',
    });
  });

  it('grants nothing to an origin nobody allowed — never a wildcard', () => {
    expect(corsHeaders('https://evil.example', [DEFAULT_ALLOW_ORIGIN])).toEqual({});
    expect(corsHeaders(undefined, [DEFAULT_ALLOW_ORIGIN])).toEqual({});
  });

  it('always allows a localhost dev origin, on any port, so a local build needs no redeploy', () => {
    expect(originAllowed('http://localhost:5173', [])).toBe(true);
    expect(originAllowed('http://127.0.0.1:4173', [])).toBe(true);
    // …but not a hostname that merely starts that way.
    expect(originAllowed('http://localhost.evil.example', [])).toBe(false);
    expect(originAllowed('https://localhost:5173', [])).toBe(false);
  });
});

describe('the preflight', () => {
  it('defaults to the allocator’s shape — the verbs and content-type', () => {
    expect(preflightHeaders()).toEqual({
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    });
  });

  it('carries a route’s extra request header — the probe’s region steer', () => {
    const headers = preflightHeaders({
      methods: 'GET, OPTIONS',
      headers: ['content-type', 'fly-prefer-region'],
    });
    expect(headers['access-control-allow-methods']).toBe('GET, OPTIONS');
    expect(headers['access-control-allow-headers']).toBe('content-type, fly-prefer-region');
  });

  it('keeps a long cache — a preflight paid per sample would be measured as the region’s latency', () => {
    expect(Number(preflightHeaders()['access-control-max-age'])).toBeGreaterThanOrEqual(600);
  });
});

describe('the allow-list from the environment', () => {
  it('falls back to the shipped client’s origin when nothing is configured', () => {
    expect(allowOriginsFromEnv(undefined)).toEqual([DEFAULT_ALLOW_ORIGIN]);
  });

  it('splits, trims, and drops blanks so a trailing comma cannot allow-list ""', () => {
    expect(allowOriginsFromEnv('https://a.test, https://b.test,')).toEqual([
      'https://a.test',
      'https://b.test',
    ]);
    expect(originAllowed('', allowOriginsFromEnv('https://a.test,'))).toBe(false);
  });
});

describe('firstHeaderValue', () => {
  it('takes the first of a repeated header, and passes a plain one through', () => {
    expect(firstHeaderValue(['a', 'b'])).toBe('a');
    expect(firstHeaderValue('a')).toBe('a');
    expect(firstHeaderValue(undefined)).toBeUndefined();
  });
});
