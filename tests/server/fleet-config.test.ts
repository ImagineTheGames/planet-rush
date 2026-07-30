/**
 * tests/server/fleet-config.test.ts — the fleet's two router flags must BOTH be
 * armed, or the machine-pin ships dead. OWNER: Netcode Engineer (GDD §4.2; M10).
 *
 * The socket-hop machine-pin has two halves, one per app, and they are useless
 * apart:
 *   • the allocator must emit the shared connectUrl (ALLOCATOR_ROUTER = "fly"), and
 *   • the gameserver must arm the upgrade guard (MATCH_ROUTER = "fly").
 *
 * The live 50/50 lottery was exactly this asymmetry: the allocator side was armed,
 * the gameserver side was not, so the pin code shipped but never fired and every
 * wrong-machine upgrade fell through to `bad-ticket`. No unit test catches a missing
 * env var in a TOML — so this one reads the deploy files and asserts both flags are
 * present. A code test cannot prove the *deployed* Machine's env, but it holds the
 * checked-in intent honest, which is what silently drifted.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Read a repo-root file relative to this test, whatever the cwd. */
function repoFile(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${name}`, import.meta.url)), 'utf8');
}

/** True if a TOML assigns `key = "value"` (tolerating spacing and comments after). */
function assigns(toml: string, key: string, value: string): boolean {
  return new RegExp(`^\\s*${key}\\s*=\\s*"${value}"`, 'm').test(toml);
}

describe('the machine-pin is armed on BOTH sides of the fleet', () => {
  it('the gameserver sets MATCH_ROUTER = "fly" (the half that was missing)', () => {
    expect(assigns(repoFile('fly.gameserver.toml'), 'MATCH_ROUTER', 'fly')).toBe(true);
  });

  it('the allocator sets ALLOCATOR_ROUTER = "fly"', () => {
    expect(assigns(repoFile('fly.allocator.toml'), 'ALLOCATOR_ROUTER', 'fly')).toBe(true);
  });
});
