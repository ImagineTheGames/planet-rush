/**
 * src/net/server-url.test.ts — the direct-connect URL resolver's precedence and
 * normalisation (`./server-url`). OWNER: Netcode Engineer.
 */

import { describe, it, expect } from 'vitest';
import { MATCH_SERVER_PATH, resolveServerUrl } from './server-url';

describe('resolveServerUrl — precedence', () => {
  it('takes the ?server= override above everything', () => {
    // A baked default AND a page origin are present; the query still wins, because
    // its whole reason to exist is repointing a build without rebuilding it.
    const url = resolveServerUrl(
      '?server=wss://staging.example.com',
      { VITE_SERVER_URL: 'wss://prod.example.com' },
      'https://app.example.com',
    );
    expect(url).toBe(`wss://staging.example.com${MATCH_SERVER_PATH}`);
  });

  it('falls to the VITE_SERVER_URL build-time default when there is no override', () => {
    const url = resolveServerUrl('', { VITE_SERVER_URL: 'wss://prod.example.com' }, 'https://app.example.com');
    expect(url).toBe(`wss://prod.example.com${MATCH_SERVER_PATH}`);
  });

  it('falls to the same page origin when neither is set (dev / simplest self-host)', () => {
    expect(resolveServerUrl('', {}, 'http://localhost:5173')).toBe(`ws://localhost:5173${MATCH_SERVER_PATH}`);
    // TLS is preserved: an https page dials wss.
    expect(resolveServerUrl('', {}, 'https://play.example.com')).toBe(
      `wss://play.example.com${MATCH_SERVER_PATH}`,
    );
  });

  it('treats a present-but-blank override or default as unset', () => {
    expect(resolveServerUrl('?server=', { VITE_SERVER_URL: 'wss://prod.example.com' }, 'https://x')).toBe(
      `wss://prod.example.com${MATCH_SERVER_PATH}`,
    );
    expect(resolveServerUrl('?server=   ', {}, 'http://localhost')).toBe(`ws://localhost${MATCH_SERVER_PATH}`);
    expect(resolveServerUrl('', { VITE_SERVER_URL: '  ' }, 'http://localhost')).toBe(
      `ws://localhost${MATCH_SERVER_PATH}`,
    );
  });

  it('yields empty string when there is nothing to resolve from (no page, e.g. Node)', () => {
    expect(resolveServerUrl('', {}, undefined)).toBe('');
  });
});

describe('resolveServerUrl — normalisation', () => {
  it('upgrades http(s):// to ws(s)://, keeping TLS', () => {
    expect(resolveServerUrl('?server=https://h.example.com', {})).toBe(`wss://h.example.com${MATCH_SERVER_PATH}`);
    expect(resolveServerUrl('?server=http://h.example.com', {})).toBe(`ws://h.example.com${MATCH_SERVER_PATH}`);
  });

  it('accepts a bare host[:port] as a ws:// dev shorthand', () => {
    expect(resolveServerUrl('?server=127.0.0.1:8080', {})).toBe(`ws://127.0.0.1:8080${MATCH_SERVER_PATH}`);
  });

  it('leaves ws(s):// as-is and appends the default path only when none is given', () => {
    expect(resolveServerUrl('?server=ws://h:8080', {})).toBe(`ws://h:8080${MATCH_SERVER_PATH}`);
    // A trailing-slash-only "path" is treated as no path.
    expect(resolveServerUrl('?server=wss://h/', {})).toBe(`wss://h${MATCH_SERVER_PATH}`);
    // An explicit path is respected, not clobbered.
    expect(resolveServerUrl('?server=wss://h/custom', {})).toBe('wss://h/custom');
  });

  it('tolerates a query string with or without the leading ?', () => {
    expect(resolveServerUrl('server=wss://h', {})).toBe(`wss://h${MATCH_SERVER_PATH}`);
    expect(resolveServerUrl('?server=wss://h', {})).toBe(`wss://h${MATCH_SERVER_PATH}`);
  });
});
