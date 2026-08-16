/**
 * src/platform/asset-url.test.ts — the base cases the live deploy actually hits.
 *
 * The point of the module is the `/planet-rush/` case, so it is asserted with the
 * real path and the real font file rather than a placeholder: a reader comparing
 * this file against the a0-66 failure log should see the same two URLs.
 */
import { describe, expect, it } from 'vitest';
import { assetUrl } from './asset-url';

describe('assetUrl', () => {
  it('is document-relative under this project’s relative base', () => {
    // vite.config.ts `base: './'` — the shipped configuration.
    expect(assetUrl('/fonts/Oxanium-Variable-latin.woff2', './')).toBe(
      './fonts/Oxanium-Variable-latin.woff2',
    );
  });

  it('is root-absolute under a root base (vite dev, vite preview, vitest)', () => {
    expect(assetUrl('/fonts/Oxanium-Variable-latin.woff2', '/')).toBe(
      '/fonts/Oxanium-Variable-latin.woff2',
    );
  });

  it('carries the subpath when VITE_BASE forces an absolute one', () => {
    // The a0-66 failure, inverted: this is the URL that 404'd on the live deploy.
    expect(assetUrl('/fonts/Oxanium-Variable-latin.woff2', '/planet-rush/')).toBe(
      '/planet-rush/fonts/Oxanium-Variable-latin.woff2',
    );
    expect(assetUrl('/fonts/Audiowide-Regular-latin.woff2', '/planet-rush/')).toBe(
      '/planet-rush/fonts/Audiowide-Regular-latin.woff2',
    );
  });

  it('takes the path with or without its leading slash', () => {
    expect(assetUrl('fonts/x.woff2', '/planet-rush/')).toBe('/planet-rush/fonts/x.woff2');
    expect(assetUrl('/fonts/x.woff2', '/planet-rush/')).toBe('/planet-rush/fonts/x.woff2');
  });

  it('never emits a protocol-relative URL from a doubled slash', () => {
    // '//fonts/x' would resolve to the host `fonts` — off-origin, and on a strict
    // artifact host a blocked request rather than a 404.
    expect(assetUrl('//fonts/x.woff2', '/')).toBe('/fonts/x.woff2');
    expect(assetUrl('//fonts/x.woff2', './')).toBe('./fonts/x.woff2');
  });

  it('normalises the empty and bare-dot spellings of a relative base', () => {
    expect(assetUrl('/fonts/x.woff2', '')).toBe('./fonts/x.woff2');
    expect(assetUrl('/fonts/x.woff2', '.')).toBe('./fonts/x.woff2');
  });

  it('adds the separator a base without a trailing slash is missing', () => {
    expect(assetUrl('/fonts/x.woff2', '/planet-rush')).toBe('/planet-rush/fonts/x.woff2');
  });

  it('works from an absolute base URL (custom domain / CDN)', () => {
    expect(assetUrl('/fonts/x.woff2', 'https://cdn.example.com/pr/')).toBe(
      'https://cdn.example.com/pr/fonts/x.woff2',
    );
  });

  it('defaults to the bundle’s own base when none is passed', () => {
    // Under vitest that is '/', the same as `vite dev` — asserted so the default
    // parameter is exercised rather than assumed.
    expect(assetUrl('/fonts/x.woff2')).toBe(`${import.meta.env.BASE_URL}fonts/x.woff2`);
  });
});
