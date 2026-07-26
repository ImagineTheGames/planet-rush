/**
 * tests/sim/match-config.test.ts — the one match-config model and its dense
 * compaction (docs/variable-slots-plan.md, Milestone A / Tasks A1 + A2).
 * OWNER: Gameplay Engineer.
 *
 * The config is the source of truth: `mode` + up to eight slots, each
 * `open | bot | closed`, each with a `team`. Two properties are load-bearing and
 * pinned here:
 *
 *   A1 — `configToPlayers` DROPS closed slots and re-indexes the survivors to a
 *        contiguous `0..N-1` roster, so the sparse lobby ids {0,2,5} never enter
 *        the sim (spike Trap 6). FFA sets each team to the dense id (teams-of-one);
 *        TEAMS carries the authored team through unchanged.
 *   A2 — a default `createWorld` (no explicit teams) gives every ship
 *        `team === id` and every planet `team === owner` — FFA is byte-identical
 *        to the pre-team world.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import {
  createWorld,
  configToPlayers,
  activeSlots,
  matchSize,
  isValidSize,
  ffaConfig,
  MAX_MATCH_SIZE,
  type MatchConfig,
  type SlotConfig,
} from '../../src/sim';

/** Build a length-8 lobby view: `states[i]` occupies slot `i`, hulls cycled. */
function lobby(mode: 'ffa' | 'teams', states: SlotConfig['state'][], teams?: number[]): MatchConfig {
  const HULLS = [ShipClass.Interceptor, ShipClass.Vanguard, ShipClass.Excavator, ShipClass.Hauler];
  return {
    mode,
    slots: states.map((state, index) => ({
      index,
      state,
      shipClass: HULLS[index % HULLS.length]!,
      team: teams ? teams[index]! : index,
    })),
  };
}

describe('A1 — configToPlayers: dense compaction over closed slots', () => {
  it('two closed slots in an 8-slot FFA config yield a length-6 dense roster, ids 0..5', () => {
    // Close slots 2 and 5; the other six are open.
    const cfg = lobby('ffa', ['open', 'open', 'closed', 'open', 'open', 'closed', 'open', 'open']);
    const specs = configToPlayers(cfg);

    expect(specs).toHaveLength(6);
    expect(specs.map((s) => s.id)).toEqual([0, 1, 2, 3, 4, 5]);
    // FFA is teams-of-one: each survivor's team is its DENSE id, never the
    // original sparse slot index {0,1,3,4,6,7}.
    expect(specs.map((s) => s.team)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('bot slots count as players; only closed slots are dropped', () => {
    const cfg = lobby('ffa', ['open', 'bot', 'closed', 'bot', 'open']);
    const specs = configToPlayers(cfg);
    expect(specs).toHaveLength(4);
    expect(specs.map((s) => s.id)).toEqual([0, 1, 2, 3]);
  });

  it('TEAMS carries the authored team through the compaction, not the slot index', () => {
    // 2v2: slots 0,1 on team 0; slots 3,4 on team 1; slot 2 closed between them.
    const cfg = lobby('teams', ['open', 'open', 'closed', 'open', 'open'], [0, 0, 0, 1, 1]);
    const specs = configToPlayers(cfg);
    expect(specs.map((s) => s.id)).toEqual([0, 1, 2, 3]);
    // The closed slot 2 is gone; the two team-1 slots keep team 1, compacted to
    // dense ids 2 and 3 — allies still share a team after re-indexing.
    expect(specs.map((s) => s.team)).toEqual([0, 0, 1, 1]);
  });

  it('preserves per-slot hull choices in order', () => {
    const cfg = lobby('ffa', ['closed', 'open', 'open']);
    const specs = configToPlayers(cfg);
    // Slot 0 (Interceptor) is closed; survivors are slots 1 (Vanguard), 2 (Excavator).
    expect(specs.map((s) => s.shipClass)).toEqual([ShipClass.Vanguard, ShipClass.Excavator]);
  });

  it('matchSize / activeSlots / isValidSize agree on N', () => {
    const cfg = lobby('ffa', ['open', 'open', 'closed', 'bot']);
    expect(matchSize(cfg)).toBe(3);
    expect(activeSlots(cfg)).toHaveLength(3);
    expect(isValidSize(cfg)).toBe(true);

    // A single live player is not a match (win guard is `< 2`).
    const solo = lobby('ffa', ['open', 'closed', 'closed', 'closed']);
    expect(matchSize(solo)).toBe(1);
    expect(isValidSize(solo)).toBe(false);
  });

  it('ffaConfig builds a canonical N-open / rest-closed FFA config', () => {
    const cfg = ffaConfig(3, ShipClass.Vanguard);
    expect(cfg.mode).toBe('ffa');
    expect(cfg.slots).toHaveLength(MAX_MATCH_SIZE);
    expect(matchSize(cfg)).toBe(3);
    const specs = configToPlayers(cfg);
    expect(specs.map((s) => s.id)).toEqual([0, 1, 2]);
    expect(specs.map((s) => s.team)).toEqual([0, 1, 2]);
  });
});

describe('A2 — team threads through world build, FFA default', () => {
  it('createWorld with no explicit teams gives ship.team === ship.id', () => {
    const specs = [0, 1, 2, 3].map((id) => ({ id, shipClass: ShipClass.Vanguard }));
    const w = createWorld({ seed: 1, players: specs });
    for (const ship of w.ships) expect(ship.team).toBe(ship.id);
  });

  it('createWorld with no explicit teams gives planet.team === planet.owner', () => {
    const specs = [0, 1, 2, 3].map((id) => ({ id, shipClass: ShipClass.Vanguard }));
    const w = createWorld({ seed: 7, players: specs });
    for (const planet of w.planets) expect(planet.team).toBe(planet.owner);
  });

  it('a TEAMS roster from configToPlayers stamps allies with a shared team', () => {
    // 2v2 → dense teams [0,0,1,1].
    const cfg = lobby('teams', ['open', 'open', 'open', 'open'], [0, 0, 1, 1]);
    const w = createWorld({ seed: 3, players: configToPlayers(cfg) });
    expect(w.ships.map((s) => s.team)).toEqual([0, 0, 1, 1]);
    expect(w.planets.map((p) => p.team)).toEqual([0, 0, 1, 1]);
  });
});
