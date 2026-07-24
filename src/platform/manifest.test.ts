/**
 * PWA manifest contract tests (GDD §4.1 installability). These guard the fields
 * a browser reads to offer "Add to Home Screen" — a name, a start_url, a
 * display mode, and at least one icon — so a stray edit can't silently break
 * installability. The manifest + icon are checked as files on disk (the real
 * artifacts the service worker precaches), not a duplicated object.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const manifestPath = fileURLToPath(new URL('../../public/manifest.webmanifest', import.meta.url));
const iconPath = fileURLToPath(new URL('../../public/icon.svg', import.meta.url));

interface Manifest {
  id?: string;
  name?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  orientation?: string;
  icons?: { src: string; sizes: string; type: string; purpose?: string }[];
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;

describe('PWA manifest — installability contract (GDD §4.1)', () => {
  it('is valid JSON with the identifying fields', () => {
    expect(manifest.name).toBe('Planet Rush');
    expect(manifest.id).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.scope).toBeTruthy();
  });

  it('runs fullscreen and locks to landscape (a landscape game, GDD §2.2)', () => {
    expect(manifest.display).toBe('fullscreen');
    expect(manifest.orientation).toBe('landscape');
  });

  it('declares at least one icon so the browser can offer install', () => {
    expect(manifest.icons?.length ?? 0).toBeGreaterThan(0);
    const icon = manifest.icons![0]!;
    expect(icon.src).toBeTruthy();
    expect(icon.type).toBeTruthy();
    expect(icon.sizes).toBeTruthy();
  });

  it('ships a maskable icon (adaptive home-screen shapes)', () => {
    const maskable = manifest.icons?.some((i) => (i.purpose ?? '').includes('maskable'));
    expect(maskable).toBe(true);
  });

  it('the referenced icon file exists on disk', () => {
    expect(existsSync(iconPath)).toBe(true);
  });
});
