/**
 * src/ui/onboarding.ts — first-match onboarding prompts. OWNER: UI Engineer.
 *
 * The game's central mechanic — your gun is your mining tool — inverts player
 * expectations, so it is *taught, not assumed* (GDD §2.10). Onboarding is
 * contextual first-match prompts that fire on triggers, are input-agnostic for
 * free via the action mapping (GDD §2.4), and **never appear again after each is
 * completed once**. No separate tutorial mode: the first match is the tutorial.
 *
 * This module is deliberately **pure and DOM-free** — the trigger state machine
 * is the load-bearing, unit-tested part (each fires once; never re-fires). The
 * Pixi view in {@link ./hud} renders whatever prompt this returns; the text is
 * resolved to the active device's wording through {@link resolvePromptText},
 * which reads {@link describeBindings} — the *same* map that drives the sim — so
 * "Hold fire" becomes "Hold Left mouse" on desktop and "Hold the FIRE button"
 * on a touch phone without this module ever knowing which device is present.
 *
 * Day-1 scope (GDD §4.6 day 1): the first two prompts —
 *   1. "Hold {fire} on the asteroid — your beam mines it"  (teaches mining)
 *   2. "Hold full — fly home"                              (teaches the haul)
 * The later prompts (upgrade, under-attack) arrive with planets/build on day 2.
 */

import { describeBindings, FireMode } from '@platform/actions';
import type { DeviceKind } from '@platform/actions';

// ---------------------------------------------------------------------------
// Prompt identity and copy
// ---------------------------------------------------------------------------

/** The onboarding prompts. Day-1 ships the first two (GDD §2.10, §4.6). */
export enum PromptId {
  /** "Hold {fire} on the asteroid — your beam mines it." Teaches that the gun
   *  is the mining tool — the inversion the whole game turns on (GDD §2.10). */
  Mine = 'mine',
  /** "Hold full — fly home." Teaches that held ore is not safe ore (GDD §2.3). */
  HaulHome = 'haul-home',
}

/**
 * A prompt's copy as an action-tokened template. Tokens in `{braces}` name an
 * abstract action (GDD §2.4) and are resolved to the active device's phrasing by
 * {@link resolvePromptText}. A template with no token is device-agnostic as-is.
 */
interface PromptCopy {
  readonly id: PromptId;
  readonly template: string;
}

const PROMPT_COPY: Readonly<Record<PromptId, PromptCopy>> = {
  // `{fire}` resolves to the fire/mine binding — the wording is input-agnostic
  // via the action layer (GDD §2.10), so it reads correctly on key, pad, touch.
  [PromptId.Mine]: {
    id: PromptId.Mine,
    template: 'Hold {fire} on the asteroid — your beam mines it',
  },
  // No token: day-1 has no planet to "press E" at yet (that clause joins the
  // prompt on day 2 with the build wheel). "Held ore is not safe ore" (GDD §2.3).
  [PromptId.HaulHome]: {
    id: PromptId.HaulHome,
    template: 'Hold full — fly home',
  },
};

/** Iteration order for prompts (also the priority when two are eligible). */
const PROMPT_ORDER: readonly PromptId[] = [PromptId.Mine, PromptId.HaulHome];

// ---------------------------------------------------------------------------
// Input-agnostic text resolution (via the action layer)
// ---------------------------------------------------------------------------

/** The single-word phrase for an action's binding on a given device+mode, read
 *  from {@link describeBindings} so onboarding copy can never drift from the
 *  real controls strip (GDD §2.4, §2.10). */
function bindingPhrase(action: 'fire' | 'build', device: DeviceKind, mode: FireMode): string {
  const row = describeBindings(device, mode).find((r) => r.action === action);
  return row ? row.binding : action;
}

/**
 * Resolve a prompt's `{token}` copy into the active device's wording. `{fire}`
 * and `{build}` become that device's binding (e.g. "Left mouse", "Right
 * trigger", "FIRE button") — the input-agnostic wording GDD §2.10 mandates,
 * sourced from the same action map that drives the sim so it can never drift.
 */
export function resolvePromptText(id: PromptId, device: DeviceKind, mode: FireMode): string {
  const { template } = PROMPT_COPY[id];
  return template
    .replace('{fire}', () => bindingPhrase('fire', device, mode))
    .replace('{build}', () => bindingPhrase('build', device, mode));
}

// ---------------------------------------------------------------------------
// Trigger signals — abstract, device-free, sim-derived
// ---------------------------------------------------------------------------

/**
 * The per-frame facts the trigger machine reads. Deliberately abstract (no
 * device, no Pixi): the caller derives these from the local ship and the
 * asteroid field each tick, so this module tests headless.
 */
export interface OnboardingSignals {
  /** An asteroid is within beam range of the local ship — a mine is possible
   *  right now (GDD §2.3: "hold fire on an asteroid"). */
  readonly nearAsteroid: boolean;
  /** Ore currently held in the ship's hold. */
  readonly cargo: number;
  /** Hold capacity — cargo === cargoCap means "hold full" (GDD §2.3). */
  readonly cargoCap: number;
}

// ---------------------------------------------------------------------------
// The trigger state machine (each fires once)
// ---------------------------------------------------------------------------

/**
 * Drives the first-match prompts. Feed it {@link OnboardingSignals} every tick;
 * it returns the {@link PromptId} to show right now (or `null`). The contract is
 * GDD §2.10's "never appear again after each is completed once": a completed
 * prompt can never become active again, for the life of the match.
 *
 * Pure state — no timers, no DOM, no device. The Pixi HUD owns one of these.
 */
export class Onboarding {
  /** Prompts the player has already learned; a member here never re-fires. */
  private readonly completed = new Set<PromptId>();
  /** Sticky: the player has mined at least once (cargo was ever > 0). */
  private hasMined = false;
  /** Sticky within a haul: the hold has reached full since it was last emptied. */
  private wasFull = false;

  /**
   * Advance the machine one tick and return the prompt to show, or `null`.
   * Marks prompts completed as their lessons are learned — a completed prompt
   * is filtered out permanently (GDD §2.10 "each is completed once").
   */
  update(signals: OnboardingSignals): PromptId | null {
    const full = signals.cargoCap > 0 && signals.cargo >= signals.cargoCap;

    // --- Latch progress facts (sticky) --------------------------------------
    if (signals.cargo > 0) this.hasMined = true;
    if (full) this.wasFull = true;

    // --- Completion: a lesson learned is a prompt retired forever ------------
    // MINE is done the moment the player has any ore — they mined (GDD §2.3).
    if (this.hasMined) this.completed.add(PromptId.Mine);
    // HAUL-HOME is done once a full hold has been emptied (flew home / dropped
    // on death) — they experienced held-ore-is-not-safe (GDD §2.3, §2.7).
    if (this.wasFull && !full) this.completed.add(PromptId.HaulHome);

    // --- Active prompt: first eligible, uncompleted, in priority order -------
    for (const id of PROMPT_ORDER) {
      if (this.completed.has(id)) continue;
      if (this.isTriggered(id, signals, full)) return id;
    }
    return null;
  }

  /** True if this prompt's contextual trigger holds this frame (GDD §2.10). */
  private isTriggered(id: PromptId, signals: OnboardingSignals, full: boolean): boolean {
    switch (id) {
      // Show the mining lesson while a rock is in reach and they haven't mined.
      case PromptId.Mine:
        return signals.nearAsteroid && !this.hasMined;
      // Show the haul lesson the moment the hold fills (GDD §2.3).
      case PromptId.HaulHome:
        return full;
    }
  }

  /** Whether a given prompt has already fired-and-completed (test/inspection). */
  isCompleted(id: PromptId): boolean {
    return this.completed.has(id);
  }

  /** Whether every day-1 prompt has been completed (onboarding done). */
  allCompleted(): boolean {
    return PROMPT_ORDER.every((id) => this.completed.has(id));
  }
}
