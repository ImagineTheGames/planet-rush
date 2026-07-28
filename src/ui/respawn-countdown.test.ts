/**
 * src/ui/respawn-countdown.test.ts — the "RESPAWNING 3…" overlay's decision.
 *
 * The two field-request rules, pinned: read the ceiling of the sim timer (never a
 * UI-side clock), and stand down entirely when the death is final so the DEFEATED
 * flow (p1-12) owns the screen alone.
 */
import { describe, it, expect } from 'vitest';
import { respawnCountdownModel } from './respawn-countdown';
import type { RespawnCountdownInput } from './respawn-countdown';
import { playerColor } from './station-hp';

/** A dead-with-respawn-pending frame; tweak per case. */
function dead(over: Partial<RespawnCountdownInput> = {}): RespawnCountdownInput {
  return { shipAlive: false, eliminated: false, respawnTimer: 5, owner: 0, ...over };
}

describe('respawn countdown — when it shows', () => {
  it('shows while the local ship is dead with a respawn pending', () => {
    const m = respawnCountdownModel(dead());
    expect(m.show).toBe(true);
    expect(m.text).toMatch(/RESPAWNING/);
  });

  it('is hidden while the ship is alive — nothing to count down', () => {
    expect(respawnCountdownModel(dead({ shipAlive: true, respawnTimer: 0 })).show).toBe(false);
  });

  it('is hidden the frame the timer reaches zero (the sim respawns that tick)', () => {
    expect(respawnCountdownModel(dead({ respawnTimer: 0 })).show).toBe(false);
    expect(respawnCountdownModel(dead({ respawnTimer: -0.1 })).show).toBe(false);
  });

  it('stands down when the death is final — DEFEATED owns the screen (GDD §2.7)', () => {
    // Even with a (stale) timer, an eliminated seat never gets a countdown.
    const m = respawnCountdownModel(dead({ eliminated: true, respawnTimer: 3 }));
    expect(m.show).toBe(false);
  });
});

describe('respawn countdown — what it reads', () => {
  it('renders the CEILING of the sim timer, never a rounded or floored value', () => {
    expect(respawnCountdownModel(dead({ respawnTimer: 5 })).seconds).toBe(5);
    expect(respawnCountdownModel(dead({ respawnTimer: 4.999 })).seconds).toBe(5);
    expect(respawnCountdownModel(dead({ respawnTimer: 4.001 })).seconds).toBe(5);
    expect(respawnCountdownModel(dead({ respawnTimer: 3.0 })).seconds).toBe(3);
    expect(respawnCountdownModel(dead({ respawnTimer: 0.2 })).seconds).toBe(1);
  });

  it('decrements as the timer falls, whole seconds at a time', () => {
    const seq = [5, 4.2, 3.8, 3, 2.5, 1.1, 0.4].map(
      (t) => respawnCountdownModel(dead({ respawnTimer: t })).seconds,
    );
    expect(seq).toEqual([5, 5, 4, 3, 3, 2, 1]);
  });

  it('spells the countdown into the text', () => {
    expect(respawnCountdownModel(dead({ respawnTimer: 3 })).text).toBe('RESPAWNING 3...');
    expect(respawnCountdownModel(dead({ respawnTimer: 2.4 })).text).toBe('RESPAWNING 3...');
  });

  it('paints the overlay in the local player colour (style-guide §5.2)', () => {
    expect(respawnCountdownModel(dead({ owner: 0 })).color).toBe(playerColor(0));
    expect(respawnCountdownModel(dead({ owner: 5 })).color).toBe(playerColor(5));
  });
});
