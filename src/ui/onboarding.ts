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
 * Prompts, in the order a first match teaches them (GDD §2.10, verbatim triggers):
 *   1. "Hold {fire} on the asteroid — your shots chip the rock" (teaches mining)
 *   2. "Hold full — fly into your collection field to bank, then press {build}
 *      to spend"                                               (teaches the haul)
 *   3. "Spend ore on defense — or UPGRADE SHIP to mine and hit harder"
 *   4. "Your station is under attack — follow the arrow"
 *
 * Day 1 shipped (1) and (2); day 2 lands (3) and (4) alongside stations, the
 * build wheel and the under-attack alarm, and completes (2)'s copy — there is a
 * station to bank at now, so the clause GDD §2.10 quotes ("and press E") joins
 * it, resolved through the action layer like every other binding.
 *
 * (2) was corrected on 2026-08-11 (a0-25). It had told the player to dock and
 * park — the way of banking the 2026-07-27 amendment RETIRED (§2.3: the hold
 * drains inside your own collection field, no docking, no parking), and the
 * clause that amendment ADDED was the one the prompt was missing. §2.10's
 * amended sentence is now carried verbatim, with `{build}` standing in for its
 * "press E" so the phone never says E (GDD §2.4). The retired wording appears
 * nowhere in this file, deliberately: it is what the brief's check greps for.
 *
 * (3) is the one GDD §2.10 singles out: it "fires the first time the wheel
 * opens, because upgrades are the half of the economy a player can most easily
 * miss." (4) rides the alarm's sustained-damage trigger ({@link ../ui/alarm}),
 * so it fires on a siege and never on a taunt-tap.
 *
 * ---------------------------------------------------------------------------
 * THE MEMORY (u15-01, a0-19 gap G-3 half A)
 * ---------------------------------------------------------------------------
 * §2.10's "never appear again after each is completed once" used to last exactly
 * one page load: `Onboarding` is a field of the `Hud`, EXIT TO MENU is a full
 * navigation, and the second match taught the game again. Completion now crosses
 * that boundary through an injected {@link OnboardingMemory} port — `load()` at
 * construction, `save()` when (and only when) the completed set grows.
 *
 * The port is why this file is still pure: the module that knows about
 * `localStorage` is {@link ./onboarding-memory}, which reads and writes the ONE
 * career profile `p1-01` established (`src/progression/profile.ts`). No second
 * storage scheme, and nothing here imports a browser global.
 *
 * ---------------------------------------------------------------------------
 * AND WHAT RETIRES THE SPEND PROMPT (u15-01, half B)
 * ---------------------------------------------------------------------------
 * The SPEND prompt's lesson is *spending*, so only a spend may retire it. It used
 * to retire on `hasOrdered` — an order **submitted** from the wheel — and an
 * order submitted is not an order the sim accepted: confirm TURRET with 2 ore,
 * be refused on cost, and the prompt that exists to stop you missing UPGRADE
 * SHIP has dismissed itself having taught nothing. It now retires on
 * {@link OnboardingSignals.hasSpent}, derived from the sim's own numbers by
 * {@link oreWasSpent} — the same discipline {@link ./press-feedback} uses for the
 * confirm chime, and for the same reason. With the memory above, a wrong
 * retirement is no longer one match of missing tuition; it is permanent.
 */

import { describeBindings, FireMode } from '@platform/actions';
import type { DeviceKind } from '@platform/actions';

// ---------------------------------------------------------------------------
// Prompt identity and copy
// ---------------------------------------------------------------------------

/** The onboarding prompts (GDD §2.10, §4.6 — M1 ships the first two, M2 all four). */
export enum PromptId {
  /** "Hold {fire} on the asteroid — your shots chip the rock." Teaches that the gun
   *  is the mining tool — the inversion the whole game turns on (GDD §2.10). */
  Mine = 'mine',
  /** "Hold full — fly into your collection field to bank, then press {build} to
   *  spend." Teaches that held ore is not safe ore, and that the hold banks
   *  itself inside your own collection field (GDD §2.3, §2.5, §2.10). */
  HaulHome = 'haul-home',
  /** "Spend ore on defense — or UPGRADE SHIP to mine and hit harder." Fires the
   *  first time the wheel opens: upgrades are the half of the economy a player
   *  can most easily miss (GDD §2.10, §2.5). */
  Spend = 'spend',
  /** "Your station is under attack — follow the arrow." The alarm's lesson: the
   *  triangle decision, made audible (GDD §2.2, §2.10). */
  UnderAttack = 'under-attack',
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
    template: 'Hold {fire} on the asteroid — your shots chip the rock',
  },
  // GDD §2.10's copy, verbatim post-amendment: "Hold full — fly into your
  // collection field to bank, then press E to spend" (amended 2026-07-27 —
  // projectile mining, collection-field banking). Banking is by atmosphere:
  // the hold drains inside your own station's collection field, no docking and
  // no parking (GDD §2.3) — and pressing build is the *second* half, the wheel
  // you spend from. `{build}` carries the "press E" clause across devices, so a
  // phone reads "press BUILD" and a pad "press Y / △" (GDD §2.4).
  // "Held ore is not safe ore" (GDD §2.3).
  [PromptId.HaulHome]: {
    id: PromptId.HaulHome,
    template: 'Hold full — fly into your collection field to bank, then press {build} to spend',
  },
  // No token: this one fires *while the wheel is open*, so the bindings are on
  // screen already. It names UPGRADE SHIP in the wheel's own words, because the
  // whole point is that the player finds the segment they'd otherwise miss.
  [PromptId.Spend]: {
    id: PromptId.Spend,
    template: 'Spend ore on defense — or UPGRADE SHIP to mine and hit harder',
  },
  // No token: the arrow is the instruction, and it is device-agnostic already.
  [PromptId.UnderAttack]: {
    id: PromptId.UnderAttack,
    template: 'Your station is under attack — follow the arrow',
  },
};

/**
 * Iteration order for prompts, and the priority when two are eligible at once.
 * UNDER-ATTACK leads: it is the only prompt about something happening *to* the
 * player rather than something they could do next, and a siege outranks a
 * shopping tip (GDD §2.2 — "the triangle decision, made audible").
 */
const PROMPT_ORDER: readonly PromptId[] = [
  PromptId.UnderAttack,
  PromptId.Mine,
  PromptId.HaulHome,
  PromptId.Spend,
];

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
  /** An asteroid is within weapon range of the local ship — a mine is possible
   *  right now (GDD §2.3: "hold fire on an asteroid"). */
  readonly nearAsteroid: boolean;
  /** Ore currently held in the ship's hold. */
  readonly cargo: number;
  /** Hold capacity — cargo === cargoCap means "hold full" (GDD §2.3). */
  readonly cargoCap: number;
  /** The Build & Upgrade wheel is open this frame — the SPEND prompt's trigger
   *  ("fires the first time the wheel opens", GDD §2.10). Optional so day-1
   *  callers that predate the wheel keep compiling; absent reads as closed. */
  readonly wheelOpen?: boolean;
  /**
   * Ore has actually been **spent** — a purchase the sim landed, not a wedge the
   * player pressed. The SPEND lesson, learned (GDD §2.5, §2.10). Optional for the
   * same reason; absent reads as "nothing bought yet".
   *
   * The caller derives it with {@link oreWasSpent} from the numbers the HUD
   * already receives, so a refused order — too little ore, a maxed tier, a
   * collapsed field — cannot retire the prompt, and neither can banking, which
   * is not a purchase and is not the lesson (u15-01, a0-19 G-3 half B).
   */
  readonly hasSpent?: boolean;
  /** The under-attack alarm is sounding ({@link ../ui/alarm}) — the UNDER-ATTACK
   *  prompt's trigger (GDD §2.2, §2.10). Optional; absent reads as quiet. */
  readonly underAttack?: boolean;
}

// ---------------------------------------------------------------------------
// What "ore was spent" means (u15-01 half B)
// ---------------------------------------------------------------------------

/**
 * The purchase-observable slice of the local player's own station and ship —
 * every field one the HUD already reads each frame ({@link ./hud} `HudFrame`),
 * so deciding that a purchase landed needs no new sim plumbing.
 *
 * Each of these numbers moves UP for exactly one reason, and that reason is ore
 * leaving the player's total (GDD §2.5):
 *  - **core HP** rises only under a bought repair (shield regen is a different
 *    number; the same rule {@link ./press-feedback} `detectConfirmations` runs on);
 *  - **turret / shield / satellite** counts include what is under construction,
 *    so they tick the instant the order is *accepted*;
 *  - **upgrade tiers** rise only when a tier is bought.
 */
export interface SpendFacts {
  readonly coreHp: number;
  readonly turrets: number;
  readonly shields: number;
  readonly satellites: number;
  /** Tiers bought across every upgrade track, summed — one number, because the
   *  question here is "did any of them go up", never which. */
  readonly upgradeTiers: number;
}

/** Below this, an HP delta is float noise rather than a repair. Matches
 *  {@link ./press-feedback}'s `EPSILON`, because it is the same comparison. */
const SPEND_EPSILON = 1e-3;

/**
 * Did the player actually buy something between these two frames?
 *
 * Pure and one-directional: only a RISE counts. A siege that takes a turret off
 * the roof, a core losing HP, a shield collapsing — those move the same numbers
 * the other way and are not purchases, which is what keeps this from mistaking
 * losing the game for learning the economy.
 *
 * The caller compares two frames where the wheel was open on both, so a
 * match-boot jump (a new station's full core after the last one's damaged one)
 * can never read as a repair. See {@link ./hud} `updateWheel`.
 */
export function oreWasSpent(prev: SpendFacts, next: SpendFacts): boolean {
  return (
    next.coreHp > prev.coreHp + SPEND_EPSILON ||
    next.turrets > prev.turrets ||
    next.shields > prev.shields ||
    next.satellites > prev.satellites ||
    next.upgradeTiers > prev.upgradeTiers
  );
}

// ---------------------------------------------------------------------------
// The memory port (u15-01 half A)
// ---------------------------------------------------------------------------

/**
 * Where completed prompts are remembered between matches. Deliberately a port
 * and not an import: this module stays pure and DOM-free, and the game's own
 * implementation ({@link ./onboarding-memory}) is the ONE career profile — no
 * second storage scheme (u15-01).
 *
 * `load()` returns plain strings rather than {@link PromptId}s because that is
 * what comes off a store: an id this build does not know (a fifth prompt, from a
 * profile a later build wrote) is dropped rather than trusted.
 */
export interface OnboardingMemory {
  /** Prompt ids completed in an earlier match, session or page load. */
  load(): readonly string[];
  /** Persist the completed set. Called only when it GROWS — `update` runs every
   *  frame, and a store write per frame is a store write per frame. */
  save(completed: readonly PromptId[]): void;
}

/** The known ids, for filtering whatever a store hands back. */
const KNOWN_PROMPTS: ReadonlySet<string> = new Set<string>(PROMPT_ORDER);

// ---------------------------------------------------------------------------
// The trigger state machine (each fires once)
// ---------------------------------------------------------------------------

/**
 * Drives the first-match prompts. Feed it {@link OnboardingSignals} every tick;
 * it returns the {@link PromptId} to show right now (or `null`). The contract is
 * GDD §2.10's "never appear again after each is completed once": a completed
 * prompt can never become active again — and since u15-01 that is *once*, not
 * once per page load. Pass an {@link OnboardingMemory} and the set is seeded
 * from it here and written back as it grows.
 *
 * Pure state — no timers, no DOM, no device. The Pixi HUD owns one of these.
 */
export class Onboarding {
  /** Prompts the player has already learned; a member here never re-fires. */
  private readonly completed = new Set<PromptId>();
  /** How many were completed at the end of the last {@link update} — the change
   *  detector that keeps the store write to one per lesson, not one per frame. */
  private savedCount = 0;

  /**
   * @param memory Where completion is remembered between matches (u15-01).
   *   Optional: a machine with no memory behaves exactly as it did before, which
   *   is what every unit test that does not care about persistence relies on.
   */
  constructor(private readonly memory: OnboardingMemory | null = null) {
    if (!memory) return;
    // Seeded, never trusted: a store can hand back anything, including an id
    // from a build that shipped a fifth prompt.
    for (const id of memory.load()) {
      if (KNOWN_PROMPTS.has(id)) this.completed.add(id as PromptId);
    }
    this.savedCount = this.completed.size;
  }
  /** Sticky: the player has mined at least once (cargo was ever > 0). */
  private hasMined = false;
  /** Sticky within a haul: the hold has reached full since it was last emptied. */
  private wasFull = false;
  /** Sticky: the alarm has sounded at least once since it last fell silent. */
  private wasUnderAttack = false;

  /**
   * Advance the machine one tick and return the prompt to show, or `null`.
   * Marks prompts completed as their lessons are learned — a completed prompt
   * is filtered out permanently (GDD §2.10 "each is completed once").
   */
  update(signals: OnboardingSignals): PromptId | null {
    const full = signals.cargoCap > 0 && signals.cargo >= signals.cargoCap;
    const underAttack = signals.underAttack === true;

    // --- Latch progress facts (sticky) --------------------------------------
    if (signals.cargo > 0) this.hasMined = true;
    if (full) this.wasFull = true;
    if (underAttack) this.wasUnderAttack = true;

    // --- Completion: a lesson learned is a prompt retired forever ------------
    // MINE is done the moment the player has any ore — they mined (GDD §2.3).
    if (this.hasMined) this.completed.add(PromptId.Mine);
    // HAUL-HOME is done once a full hold has been emptied (flew home / dropped
    // on death) — they experienced held-ore-is-not-safe (GDD §2.3, §2.7).
    if (this.wasFull && !full) this.completed.add(PromptId.HaulHome);
    // SPEND is done the moment ore is actually spent — the player has found the
    // economy, including the segment behind the arrow. A press the sim refused
    // is not a spend, and banking is not a spend either (u15-01 half B).
    if (signals.hasSpent === true) this.completed.add(PromptId.Spend);
    // UNDER-ATTACK is done once a siege has been *survived* — the alarm sounded
    // and then fell silent. Retiring it while it is still sounding would pull
    // the instruction off screen mid-lesson.
    if (this.wasUnderAttack && !underAttack) this.completed.add(PromptId.UnderAttack);

    // --- Remember it, once per lesson ---------------------------------------
    // Completion only ever grows, so a size change IS a new lesson. Writing on
    // the change rather than at the end of the match is deliberate: a player who
    // learns to mine and then closes the tab has still learned to mine.
    if (this.memory && this.completed.size !== this.savedCount) {
      this.savedCount = this.completed.size;
      this.memory.save([...this.completed]);
    }

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
      // "Fires the first time the wheel opens" (GDD §2.10) — and stays up for
      // as long as it is open and nothing has been bought yet.
      case PromptId.Spend:
        return signals.wheelOpen === true;
      // Rides the alarm's sustained-damage trigger, so it never fires on a
      // taunt-tap (GDD §2.2) — see {@link ../ui/alarm}.
      case PromptId.UnderAttack:
        return signals.underAttack === true;
    }
  }

  /** Whether a given prompt has already fired-and-completed (test/inspection). */
  isCompleted(id: PromptId): boolean {
    return this.completed.has(id);
  }

  /** Whether every prompt has been completed — the first match has finished
   *  being the tutorial (GDD §2.10: "no separate tutorial mode"). */
  allCompleted(): boolean {
    return PROMPT_ORDER.every((id) => this.completed.has(id));
  }
}
