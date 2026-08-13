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
 * Prompts, in the order a first match teaches them (GDD §2.10, verbatim triggers;
 * (0) is a0-34's, NEW COPY awaiting the developer — see below):
 *   0. "Be the last station standing — mine ore, build defenses, upgrade your
 *      ship, attack when you judge it right"              (names the OBJECTIVE)
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
 * THE PROMPT THAT NAMES THE OBJECTIVE (a0-34)
 * ---------------------------------------------------------------------------
 * The four prompts above teach VERBS — mine, bank, spend, defend — and not one of
 * them says what the player is trying to ACHIEVE; the codex's six strategy
 * entries are all tactics that presume the reader already knows how a match is
 * won; and no player-facing string anywhere states the win condition. So a first
 * match taught every verb for a goal nobody named, and left the objective to be
 * inferred from the result screen.
 *
 * The fix is one more contextual prompt on exactly the same terms as the other
 * four — §2.10 forbids a separate tutorial mode ("the first match is the
 * tutorial") and that is ratified, so this is not a screen, not a gate, and not a
 * new system. What is new is only its PLACE: it fires **first**, before the
 * mining lesson, because a goal is what makes a verb worth learning.
 *
 * **The words are the sim's rule, checked against the code that enforces it.**
 * GDD §1: *"Own the last surviving station reactor — in Teams, be the last side
 * with a reactor standing."* `src/sim/match.ts` `resolveWinner` counts distinct
 * surviving TEAMS and crowns the last one holding a core, with FFA as teams-of-one
 * (`team ?? owner`) — so "the last station standing" and "the last side standing"
 * are one rule, and the tie goes to whoever reached zero last. The two agree, so
 * the prompt says the FFA reading in the fewest words (a first match is against
 * bots in a Free-for-All), and the codex entry behind it carries the Teams clause
 * and the tiebreak, which is the headline/paragraph split this pair is for.
 *
 * **It is scheme-agnostic on purpose.** a0-33 (in flight) branches copy by control
 * scheme where the LESSON differs — "hold fire on the rock" is not the gesture a
 * Tap Commander player has. This prompt names no gesture and no binding: it is a
 * statement of the goal, identical in every scheme, on every device, in either
 * fire mode. When the two land together it needs no `(scheme, mode)` branch — the
 * same sentence in all three slots — and it takes the last of a0-33's dwell
 * machinery it can share (see {@link DWELL_SECONDS}).
 *
 * **It retires on a dwell, not on an action**, because unlike the other four
 * there is nothing for the player to *do* with it: it is a thing you are told.
 * The dwell counts only frames where it is the prompt actually SHOWN, so a siege
 * (which outranks everything, GDD §2.2) cannot retire it unread — and it is
 * measured on match time handed in by the caller, so this module still owns no
 * timer and no clock. A caller that feeds no clock does not get the prompt at all
 * rather than getting one that never retires: an un-retiring prompt at the TOP of
 * the order would sit on the mining lesson forever, which is a worse bug than the
 * one this fixes. Completion crosses matches through the same
 * {@link OnboardingMemory} as the rest (u15-01), so the objective is stated once
 * in a career, not once a match.
 *
 * **NEW COPY, flagged for the developer.** GDD §2.10 quotes four prompts and this
 * is a fifth, so its sentence is not ratified text. Its substance is (LESSONS
 * §17): the developer's own four beats — last station alive, mine ore, spend on
 * defenses / upgrade your ship, attack when you see fit — all four kept, polished
 * to one line in register 2 (§4.7: procedural, terse, present-tense imperative,
 * no praise).
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
  /** "Be the last station standing — mine ore, build defenses, upgrade your ship,
   *  attack when you judge it right." The win condition, in one line, before any
   *  verb is taught (GDD §1, enforced by `src/sim/match.ts` `resolveWinner`).
   *  NEW COPY (a0-34) — the substance is the developer's, the wording is polish. */
  Objective = 'objective',
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
  // NEW COPY (a0-34). No token, and none possible: the objective is not a
  // gesture, so there is no binding to name and nothing that changes with the
  // device, the fire mode or the control scheme.
  //
  // GDD §1's win condition in the first three words — "the last surviving station
  // reactor", which `resolveWinner` (src/sim/match.ts) enforces as "the last team
  // still holding a core", FFA being teams-of-one. Then the developer's other
  // three beats in the order the loop runs them (GDD §2.3's triangle): mine, spend
  // — on the station or on the ship, the choice the whole economy is — and attack,
  // with the judgement left where the design puts it ("attacking an occupied
  // station is a mistake", §2.6), which is why the clause is "when you judge it
  // right" rather than an instruction to go and do it.
  //
  // Register 2 (§4.7): imperative, present tense, no adjective that praises, no
  // exclamation. It states the contract's terms and does not wish anybody luck.
  [PromptId.Objective]: {
    id: PromptId.Objective,
    // On one line on purpose: the brief's gate counts the templates in this file
    // by looking for an opening quote right after the key, and a wrapped
    // assignment reads to it as a prompt that does not exist.
    template: 'Be the last station standing — mine ore, build defenses, upgrade your ship, attack when you judge it right',
  },
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
 *
 * OBJECTIVE comes next, which means first in every match that is not already on
 * fire (a0-34). It outranks the verb lessons because it is what makes them worth
 * learning — a player told to hold fire on a rock before anyone has said what
 * winning is has been handed a chore. It does not outrank the siege: a station
 * burning right now is not the moment for a mission statement.
 */
const PROMPT_ORDER: readonly PromptId[] = [
  PromptId.UnderAttack,
  PromptId.Objective,
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
  /**
   * Elapsed match time in seconds (`world.time`, already on `HudFrame`) — the
   * clock the OBJECTIVE prompt's dwell is measured on (a0-34).
   *
   * Handed in rather than read: no timers, no `Date.now()`, nothing this module
   * cannot be given by a test. Optional, and **absent means a prompt that retires
   * on a dwell never becomes eligible at all** — see {@link DWELL_SECONDS} for
   * why that is the safe direction rather than the obvious one.
   */
  readonly time?: number;
}

// ---------------------------------------------------------------------------
// Prompts that retire on being READ (a0-34)
// ---------------------------------------------------------------------------

/**
 * How long a prompt must have been **on screen** before it counts as read and
 * retires for good, in seconds of match time. A prompt absent from this table
 * retires on the player doing the thing it teaches, which is the better rule
 * wherever there is a thing to do.
 *
 * OBJECTIVE has no such thing: it states the win condition, and "the player has
 * understood the win condition" is not a fact the HUD can observe. Ten seconds of
 * spawn protection open every match (GDD §2.1) precisely so nothing has happened
 * yet; eight of them is a long time to read one line and still leaves the band
 * clear before the protection lapses.
 *
 * The dwell counts only frames where the prompt is the one actually SHOWN (see
 * {@link Onboarding.update}), so a siege taking the band mid-sentence cannot
 * retire it unread.
 *
 * **Why no clock means no prompt.** A dwell-retired prompt with no clock would
 * never retire, and OBJECTIVE sits near the top of {@link PROMPT_ORDER} — it would
 * sit on the mining lesson for the rest of the match. Withholding it instead
 * leaves such a caller exactly where it is today, which is the failure worth
 * having. Every real feed carries `time`: it is what the wave clock is drawn from.
 *
 * (a0-33's CONTROLS tip retires on a dwell for the same shape of reason — nothing
 * to observe, because the settings screen is a different screen. When the two
 * branches meet, that prompt is one more row in this table.)
 */
const DWELL_SECONDS: Partial<Readonly<Record<PromptId, number>>> = {
  [PromptId.Objective]: 8,
};

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
  /** The prompt {@link update} returned last tick — the one the player was
   *  actually reading, which is what a dwell counts (a0-34). */
  private lastActive: PromptId | null = null;
  /** Seconds each dwell-retired prompt has been on screen, summed over the frames
   *  it was the shown prompt. At its {@link DWELL_SECONDS} it is read, and done. */
  private readonly dwelled = new Map<PromptId, number>();
  /** Last tick's `signals.time`, for the delta. `null` until a tick carries a
   *  clock, so the first clocked frame contributes nothing rather than `time`. */
  private lastTime: number | null = null;

  /**
   * Advance the machine one tick and return the prompt to show, or `null`.
   * Marks prompts completed as their lessons are learned — a completed prompt
   * is filtered out permanently (GDD §2.10 "each is completed once").
   */
  update(signals: OnboardingSignals): PromptId | null {
    const full = signals.cargoCap > 0 && signals.cargo >= signals.cargoCap;
    const underAttack = signals.underAttack === true;

    // --- The dwell of whatever was on screen last tick (a0-34) ---------------
    // Counted on the prompt that was SHOWN, not on the one eligible now: a siege
    // takes the band away mid-sentence (UNDER-ATTACK outranks everything), and a
    // prompt that expires while it is off screen is a prompt nobody read. A
    // backwards clock contributes nothing, so a rematch resetting `world.time` to
    // zero cannot retire one either.
    if (signals.time !== undefined) {
      const shown = this.lastActive;
      if (this.lastTime !== null && shown !== null && DWELL_SECONDS[shown] !== undefined) {
        this.dwelled.set(shown, (this.dwelled.get(shown) ?? 0) + Math.max(0, signals.time - this.lastTime));
      }
      this.lastTime = signals.time;
    }

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
    // OBJECTIVE (and any other dwell-retired prompt) is done once it has been on
    // screen long enough to READ (a0-34). There is no player action to watch for:
    // it names the goal, and being read is the whole of the lesson.
    for (const [id, seconds] of this.dwelled) {
      const needed = DWELL_SECONDS[id];
      if (needed !== undefined && seconds >= needed) this.completed.add(id);
    }

    // --- Remember it, once per lesson ---------------------------------------
    // Completion only ever grows, so a size change IS a new lesson. Writing on
    // the change rather than at the end of the match is deliberate: a player who
    // learns to mine and then closes the tab has still learned to mine.
    if (this.memory && this.completed.size !== this.savedCount) {
      this.savedCount = this.completed.size;
      this.memory.save([...this.completed]);
    }

    // --- Active prompt: first eligible, uncompleted, in priority order -------
    let active: PromptId | null = null;
    for (const id of PROMPT_ORDER) {
      if (this.completed.has(id)) continue;
      if (this.isTriggered(id, signals, full)) {
        active = id;
        break;
      }
    }
    // Remembered for the dwell above — this is what the player is reading now.
    this.lastActive = active;
    return active;
  }

  /** True if this prompt's contextual trigger holds this frame (GDD §2.10). */
  private isTriggered(id: PromptId, signals: OnboardingSignals, full: boolean): boolean {
    switch (id) {
      // The objective has no contextual trigger, and that is the point (a0-34):
      // it is true from the first frame of the first match, so it is eligible
      // from the first frame and the goal is the first thing the game says. Its
      // one condition is a clock to measure the dwell on — see DWELL_SECONDS.
      case PromptId.Objective:
        return signals.time !== undefined;
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
