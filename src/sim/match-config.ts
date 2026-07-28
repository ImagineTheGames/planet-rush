/**
 * src/sim/match-config.ts — the one match-configuration model. OWNER: Gameplay Engineer.
 *
 * Variable match sizes (docs/variable-slots-plan.md, Task A1). One config object
 * is the source of truth: authored in the lobby, carried on the wire, and
 * consumed HERE to build the world. It is `mode ∈ {ffa, teams}` plus up to eight
 * `SlotConfig` records, each `open | bot | closed`, each carrying a `team`. FFA
 * is teams-of-one (`team === index`), so the simulation asks "same team?" through
 * exactly one predicate (`./allegiance`) and TEAMS changes a table, not a code
 * path.
 *
 * This module is plain data and imports only from `@shared` (+ the sim's own
 * `PlayerSpec` type). It stays the lowest layer on purpose, so the lobby
 * (`src/ui`), the wire (`src/net`), and the bots (`src/bots`) can all consume the
 * same model without an upward dependency. The bot personality / difficulty
 * fields are typed as bare unions here for that reason alone: the real
 * `PersonalityId` (`src/bots`) and `BotDifficulty` (`src/net`) live in higher
 * layers the sim must not import, and their values assign structurally to these.
 */

import type { ShipClass } from '@shared/types';
import type { Abundance } from './constants';
import { DEFAULT_ABUNDANCE } from './constants';
import type { PlayerSpec } from './state';

/** The two match modes (GDD §2.1). FFA is teams-of-one; TEAMS groups slots by
 *  a shared `team` — the only thing that differs between them is that table. */
export type MatchMode = 'ffa' | 'teams';

/**
 * A slot's occupancy.
 *  - `open`   — a human competitive seat (the lobby's `human` maps here: a filled
 *               human seat is still an open competitive slot in the sim's eyes).
 *  - `bot`    — filled by AI.
 *  - `closed` — holds no player and is excluded from the world ENTIRELY: no ship,
 *               no station, no colour, no wire seat. `N = count(state !== closed)`.
 *
 * Extends the lobby's `SeatOccupant = 'human' | 'bot' | 'open'` (`src/ui/lobby`)
 * with `closed`; reconciling the two names is Milestone E (UI).
 */
export type SlotState = 'open' | 'bot' | 'closed';

/** One physical lobby slot, 0..7 — the stable colour / decal key. */
export interface SlotConfig {
  /** Stable slot id, 0..7. The colour identity is per-SLOT, never per-person. */
  readonly index: number;
  state: SlotState;
  /** Human: the player's own pick; bot: derived from its personality. */
  shipClass: ShipClass;
  /** `PersonalityId` (`src/bots`) when `state === 'bot'` — a bare string here to
   *  keep this module below the bot layer; the bot layer narrows it. */
  botPersonality?: string;
  /** Structural `BotDifficulty` (`src/net`), same layering reason as above. */
  botDifficulty?: 'easy' | 'medium' | 'hard';
  /** Which side this slot fights for. FFA: `team === index` (teams-of-one).
   *  `areEnemies` only ever compares two teams for EQUALITY, so the absolute
   *  value is irrelevant — only which slots share it. */
  team: number;
}

/** The whole lobby's authored match configuration. */
export interface MatchConfig {
  mode: MatchMode;
  /** The physical slots — the lobby view is always length 8; `closed` slots are
   *  dropped at world-build. */
  slots: SlotConfig[];
  /**
   * Ore scarcity for this match (ratified developer, p11): `scarce | standard |
   * rich`, a named multiplier set over the economy (`./constants` `ABUNDANCE`).
   * The one pre-match economy control — authored in the lobby, carried in the room
   * ad (Milestone C's config rides whole), consumed at world-build via
   * {@link matchAbundance}. Optional so pre-p11 configs (and the lobby before the
   * n1-05 control lands) keep validating; an absent value reads as the ratified
   * SCARCE default ({@link matchAbundance}, `DEFAULT_ABUNDANCE`) — "by default
   * more scarce."
   */
  abundance?: Abundance;
}

/** The abundance a config runs at: its authored level, or the ratified SCARCE
 *  default when the lobby has not set one (`DEFAULT_ABUNDANCE`, "by default more
 *  scarce"). The world-build wiring passes this to `createWorld`. */
export function matchAbundance(cfg: MatchConfig): Abundance {
  return cfg.abundance ?? DEFAULT_ABUNDANCE;
}

/** A match needs at least two live players to be a match (GDD §1 win condition
 *  guards on `< 2`); the ceiling is the hard-8 wire caps (spike §2, Trap 8). */
export const MIN_MATCH_SIZE = 2;
export const MAX_MATCH_SIZE = 8;

/** The non-closed slots — the players who actually take the field, in slot order. */
export function activeSlots(cfg: MatchConfig): SlotConfig[] {
  return cfg.slots.filter((s) => s.state !== 'closed');
}

/** N — the world size, the count of non-closed slots (2..8 when valid). */
export function matchSize(cfg: MatchConfig): number {
  return activeSlots(cfg).length;
}

/** Whether a config has a legal player count (2..8). The lobby enforces this
 *  before RUSH; world-build assumes it (a map returns fewer than N placements
 *  above 8 and would throw — spike Trap 8). */
export function isValidSize(cfg: MatchConfig): boolean {
  const n = matchSize(cfg);
  return n >= MIN_MATCH_SIZE && n <= MAX_MATCH_SIZE;
}

/**
 * Compact a `MatchConfig` into a DENSE `PlayerSpec[]` for `createWorld`.
 *
 * Closed slots are dropped and the survivors are re-indexed to a contiguous
 * `0..N-1` roster (spike §S2, Trap 6): the sparse lobby ids {0,2,5} never enter
 * the sim, so `PLAYER_COLORS[id]`, station ids, and the wire all stay contiguous
 * and nothing that treats a `PlayerId` as an array index can trip.
 *
 * `team` is resolved per mode: FFA is teams-of-one, so each player's team is its
 * dense id (making `ship.team === ship.id`, so a compacted FFA world is
 * byte-identical to a plain `PlayerSpec[]` roster); TEAMS carries the slot's
 * authored team number through unchanged — `areEnemies` only compares teams for
 * equality, so the value need not be dense, only shared by allies.
 */
export function configToPlayers(cfg: MatchConfig): PlayerSpec[] {
  return activeSlots(cfg).map((slot, id) => ({
    id,
    shipClass: slot.shipClass,
    team: cfg.mode === 'ffa' ? id : slot.team,
  }));
}

/**
 * A canonical FFA `MatchConfig`: the first `size` slots open on one hull, the
 * rest closed, each its own team. A convenience for the sim's own default path,
 * the harness, and tests — the lobby authors real configs itself (Milestone E).
 */
export function ffaConfig(size: number, shipClass: ShipClass): MatchConfig {
  const slots: SlotConfig[] = [];
  for (let index = 0; index < MAX_MATCH_SIZE; index++) {
    slots.push({
      index,
      state: index < size ? 'open' : 'closed',
      shipClass,
      team: index,
    });
  }
  return { mode: 'ffa', slots };
}
