/**
 * src/ui/respawn-countdown.ts — the "RESPAWNING 3…" overlay's decision, headless.
 * OWNER: UI Engineer (field request v0.2.2; GDD §2.7).
 *
 * While the local ship is dead and a respawn is coming, the player would
 * otherwise stare at an empty death scene. This module answers, from the sim's
 * own numbers, whether to show a centered countdown and what it reads — the pure
 * half of the overlay `Hud` draws.
 *
 * Two rules carry the whole thing (field request):
 *
 *  1. **Read the ticks, render the CEILING — never a UI-side timer.** The count
 *     is `Math.ceil` of the sim's respawn timer, so the number on screen is the
 *     one the sim is actually counting down; a UI clock could drift from it.
 *  2. **DEFEATED owns the screen when this death is final.** If the core is gone
 *     and the seat is eliminated (GDD §2.7, the p1-12 DEFEATED flow), the respawn
 *     countdown never shows — the sim answers which death this is via
 *     `eliminated`, and this asks rather than guesses.
 *
 * The colour is the player's own (style-guide §5.2) — the same identity colour
 * the HP bar and beacon ring carry, so a glance reads "*my* ship is coming back."
 */

import type { PlayerId } from '@shared/types';
import { playerColor } from './planet-hp';

/** What the countdown overlay should draw this frame (or that it is hidden). */
export interface RespawnCountdownModel {
  /** Draw the overlay this frame. When false every other field is inert. */
  readonly show: boolean;
  /** Whole seconds remaining, the CEILING of the sim's respawn timer. */
  readonly seconds: number;
  /** The line to draw, e.g. `RESPAWNING 3...`. */
  readonly text: string;
  /** The local player's own colour (style-guide §5.2). */
  readonly color: number;
}

/** The live sim facts the overlay decides from — all read, never mutated. */
export interface RespawnCountdownInput {
  /** The local ship is alive. When true there is nothing to count down. */
  readonly shipAlive: boolean;
  /** The local seat is eliminated — a *final* death. DEFEATED owns the screen,
   *  so the countdown must stay hidden (GDD §2.7). */
  readonly eliminated: boolean;
  /** Seconds until respawn, straight off the sim's `Ship.respawnTimer`
   *  (0 when alive or eliminated). */
  readonly respawnTimer: number;
  /** The local player's slot — selects the identity colour. */
  readonly owner: PlayerId;
}

const HIDDEN: RespawnCountdownModel = { show: false, seconds: 0, text: '', color: 0 };

/**
 * Decide the respawn countdown overlay for one frame.
 *
 * Shows only while the local ship is dead with a respawn genuinely pending and
 * the death is not final. The seconds are the ceiling of the sim timer, so the
 * overlay never runs its own clock.
 */
export function respawnCountdownModel(input: RespawnCountdownInput): RespawnCountdownModel {
  // Final death → the DEFEATED flow (p1-12) owns the screen; never both.
  if (input.eliminated) return HIDDEN;
  // Alive, or no respawn actually pending → nothing to show. (`> 0` also guards
  // the frame the timer hits zero, where the sim respawns on the same tick.)
  if (input.shipAlive || !(input.respawnTimer > 0)) return HIDDEN;

  const seconds = Math.ceil(input.respawnTimer);
  return {
    show: true,
    seconds,
    text: `RESPAWNING ${seconds}...`,
    color: playerColor(input.owner),
  };
}
