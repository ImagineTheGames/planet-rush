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
  display_override?: string[];
  orientation?: string;
  icons?: { src: string; sizes: string; type: string; purpose?: string }[];
}

/** The install-route display modes that give a chrome-free window (no title bar,
 *  no URL bar) — the permanent answer to the v0.1.1 field request. */
const CHROME_FREE = ['fullscreen', 'standalone'];

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

  it('the installed app has a chrome-free window — the permanent title-bar answer (field request v0.1.1)', () => {
    // The primary display mode gives the installed app no browser chrome...
    expect(CHROME_FREE).toContain(manifest.display);
    // ...and every fallback in display_override does too, so an installer that
    // can't honour `fullscreen` still lands on `standalone`, never a tab.
    expect((manifest.display_override?.length ?? 0)).toBeGreaterThan(0);
    for (const mode of manifest.display_override ?? []) {
      expect(CHROME_FREE, `display_override "${mode}" must be chrome-free`).toContain(mode);
    }
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
