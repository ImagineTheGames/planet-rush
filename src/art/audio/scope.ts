/**
 * src/art/audio/scope.ts — whose home rings YOUR klaxon. OWNER: Sound Agent.
 *
 * One rule, and it belongs to exactly one function so two callers cannot hold two
 * versions of it: the under-attack alarm rings for damage against **your side's**
 * home — your own, and in TEAMS an ally's — and never for an enemy's or a
 * neutral's (GDD §2.2; developer report s5, "the alarm fires for ENEMY bases").
 *
 * It lived as a private function inside `../presenter.ts`, which was fine while
 * the presenter was the only thing wiring the engine. It is not: the shipped
 * client (`src/main.ts`) builds its own observer and its own {@link
 * AudioEngine} and never constructs a presenter at all — the boot path the s9-01
 * report came off. A rule that only one of two wirings knows is a rule the other
 * one is quietly missing, so it moved here, where both read the same copy.
 *
 * Deliberately a **leaf**: it reads the plain `WorldView` the observer already
 * takes, so `src/art/` still imports nothing from `src/sim/`.
 */

import type { PlayerId } from '@shared/types';
import type { WorldView } from '../vfx/observer';

/**
 * The owner slots on the local player's SIDE — the under-attack alarm's roster.
 *
 * A structural mirror of the sim's `teamOf` / `sameSide`: art is a leaf and
 * cannot import `src/sim`, but the rule is the same plain-int `team` table
 * (`ship.team ?? id`, `station.team ?? owner`). In FFA every player is a team of
 * one, so this is just `{local}` — your home and no other rings. In TEAMS it also
 * holds each ally's owning slot, so a teammate's siege rings your klaxon while
 * both enemies' sieges stay silent. A spectator (`local < 0`) has no side, so the
 * set is empty and nothing rings.
 *
 * Teams are static for a match (§4.2 — allegiance is match config, not per-tick
 * state), so a caller may derive this once and reuse it; it must be re-derived on
 * a new match, a rematch, or a change of local slot.
 */
export function deriveAlarmAllies(world: WorldView, local: PlayerId): Set<PlayerId> {
  const allies = new Set<PlayerId>();
  if (local < 0) return allies;
  allies.add(local); // a player is always on their own side, even with no station left

  const teamOf = (id: number): number => {
    for (const s of world.ships) if (s.id === id) return s.team ?? s.id;
    for (const st of world.stations) if (st.owner === id) return st.team ?? st.owner;
    return id;
  };
  const localTeam = teamOf(local);
  for (const st of world.stations) {
    if ((st.team ?? st.owner) === localTeam) allies.add(st.owner);
  }
  return allies;
}
