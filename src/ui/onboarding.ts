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
 * resolved to the player's actual configuration through {@link resolvePromptText}
 * — the control scheme and the fire mode choose the *lesson*, and
 * {@link describeBindings} (the *same* map that drives the sim) fills in the
 * *key*, so "Hold fire" becomes "Hold Left mouse" on desktop and "Hold the FIRE
 * button" on a touch phone without this module ever knowing which device is
 * present.
 *
 * Prompts, in the order a first match teaches them (GDD §2.10, verbatim triggers):
 *   1. "Hold {fire} on the asteroid — your shots chip the rock" (teaches mining)
 *   2. "Hold full — fly into your collection field to bank, then press {build}
 *      to spend"                                               (teaches the haul)
 *   3. "Spend ore on defense — or UPGRADE SHIP to mine and hit harder"
 *   4. "Your station is under attack — follow the arrow"
 *   5. "Change CONTROLS or FIRE MODE any time — in SETTINGS, or the pause menu"
 *      (a0-33, NEW COPY awaiting the developer — see below)
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
 * THE LESSON, NOT JUST THE KEY (a0-33)
 * ---------------------------------------------------------------------------
 * §2.10 says the prompts are *"input-agnostic for free via the action mapping"*,
 * and until a0-33 this file read that as: resolve the BINDING per device and per
 * fire mode, keep one fixed sentence per prompt. That resolves the key name. It
 * does not resolve the lesson, and `ControlScheme` appeared nowhere here at all:
 *
 *  - with **Auto-aim**, *"press fire"* is not the lesson — the weapon picks the
 *    target across the full 360°, and what a player needs told is that they only
 *    decide *when* (GDD §2.4);
 *  - with **Tap Commander**, *"hold fire on the asteroid"* is not the gesture at
 *    all — the scheme is *"tap a spot to fly there, tap a target to attack it …
 *    (because a rock is just a target) an asteroid to mine it"* (GDD §2.4), and
 *    the local pilot writes the fire for you (`@platform/tap-pilot`). There is no
 *    button to hold.
 *
 * `a0-30` then made **Tap Commander and Auto-aim the first-run default on every
 * platform**, so the fixed sentence was wrong for the configuration MOST new
 * players are in. Copy now branches on `(scheme, mode)` — see {@link PromptCopy},
 * which requires all three wordings so a prompt that forgets Tap Commander cannot
 * compile — and the binding is still filled in by the action layer underneath.
 * The layer was extended, not replaced.
 *
 * The scheme is read from the LIVE setting (`HudFrame.controlScheme`, which
 * main.ts feeds from the same `controlScheme` the settings row toggles), never
 * guessed from the device: a desktop player on Tap Commander gets Tap Commander's
 * wording, a phone player who switched to Manual gets Manual's. Both are
 * changeable mid-match (§2.4), and the resolve is per-frame, so **a prompt on
 * screen when the setting changes re-words on the next frame** — deliberate: an
 * instruction has to describe what the player can do *now*, and a stale one is
 * the whole of this bug. Completion is untouched by a switch (it is about what
 * the player has learned, not how they drive), so a lesson already retired stays
 * retired and one not yet fired uses the wording in force when it fires.
 *
 * **New copy, flagged for the developer** (a0-33 — GDD §2.10 has words only for
 * Sticks+Manual, so the rest are written plainly and are not ratified yet): the
 * Auto-aim and Tap Commander wordings of MINE, the Tap Commander wording of
 * HAUL-HOME, and the whole of the fifth prompt below.
 *
 * ---------------------------------------------------------------------------
 * AND THE FIFTH PROMPT — THAT THE SETTINGS EXIST (a0-33)
 * ---------------------------------------------------------------------------
 * The developer's third ask: *"we need to teach people they can change settings
 * to their desired preference."* §2.10 forbids a separate tutorial mode, so it is
 * one more contextual prompt on the same terms as the other four — it fires after
 * the player has flown one full loop (MINE and HAUL-HOME both learned, so it
 * never competes with a lesson), it names the two rows in the settings screen's
 * own words, and it retires for good once it has been on screen long enough to
 * read ({@link CONTROLS_TIP_SECONDS}), through the same {@link OnboardingMemory}.
 *
 * It retires on a DWELL and not on "the player opened settings" because the HUD
 * does not know that the settings screen is up — it is a different screen, owned
 * by the wiring layer — and a tip that waits for a screen the player may never
 * open is a tip that nags every match forever, which is exactly what §2.10's
 * "never appear again" forbids. The dwell counts only frames where this prompt is
 * the one actually SHOWN (see {@link Onboarding.update}), so a siege that outranks
 * it mid-read cannot retire it unread.
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
// Type-only, deliberately: `ControlScheme` is the UI's own ratified union
// ({@link ./settings}), and importing the TYPE keeps this module's runtime graph
// exactly as empty as it was — no screen model, no art, nothing DOM-adjacent —
// so the trigger contract still tests headless.
import type { ControlScheme } from './settings';

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
  /** "Change CONTROLS or FIRE MODE any time — in SETTINGS, or the pause menu."
   *  The developer's third a0-33 ask, as a fifth contextual prompt: a player who
   *  does not like the scheme they were seated in has to learn that the choice
   *  exists (GDD §2.4 — both are changeable at any time). NEW COPY. */
  Controls = 'controls',
}

/**
 * A prompt's copy, as one action-tokened template **per configuration the player
 * can actually be in** (a0-33). Tokens in `{braces}` name an abstract action (GDD
 * §2.4) and are resolved to the active device's phrasing by
 * {@link resolvePromptText}; a template with no token is device-agnostic as-is.
 *
 * All three fields are REQUIRED even where the lesson does not change, and that
 * is the point: an optional `tap` that fell back to the stick wording is how a
 * prompt silently teaches the wrong scheme, which is the bug a0-33 exists to fix.
 * Writing the same sentence three times is cheap; discovering that a prompt
 * forgot Tap Commander in a playtest is not.
 */
interface PromptCopy {
  readonly id: PromptId;
  /** **Sticks + Manual** — the player aims and holds fire. GDD §2.10's own
   *  wording lives here, because this is the configuration it was written for. */
  readonly manual: string;
  /** **Sticks + Auto-aim** — same scheme, but the weapon picks the target across
   *  the full 360°; the player only decides *when* to fire (GDD §2.4). */
  readonly autoAim: string;
  /** **Tap Commander** — a different gesture entirely: tap a spot to fly there,
   *  tap a target to attack it, and the local pilot aims and fires (GDD §2.4).
   *  One string for both fire modes: the player taps either way, so the fire mode
   *  has nothing left to say about how a rock gets mined. */
  readonly tap: string;
}

const PROMPT_COPY: Readonly<Record<PromptId, PromptCopy>> = {
  // `{fire}` resolves to the fire/mine binding — the wording is input-agnostic
  // via the action layer (GDD §2.10), so it reads correctly on key, pad, touch.
  [PromptId.Mine]: {
    id: PromptId.Mine,
    // GDD §2.10, verbatim: the ratified sentence, for the configuration it was
    // ratified for.
    manual: 'Hold {fire} on the asteroid — your shots chip the rock',
    // NEW COPY (a0-33). Auto-aim does not fire itself — the player still decides
    // *when* (GDD §2.4) — so the press stays and the AIMING drops out. What
    // replaces it is the thing that actually decides what gets hit under
    // auto-aim: being near the rock. "positioning decides *what* gets hit."
    autoAim: 'Hold {fire} near the asteroid — auto-aim does the aiming, your shots chip the rock',
    // NEW COPY (a0-33). No `{fire}` token, because there is no press: the pilot
    // aims and fires at whatever the tap locked (GDD §2.4, `@platform/tap-pilot`
    // — "an asteroid is a mine: a rock is just a target"). The tail is §2.10's
    // own, so the lesson the game turns on — your gun is your mining tool — is
    // still the sentence's second half in every scheme.
    tap: 'Tap the asteroid to mine it — your shots chip the rock',
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
    // a0-25's amended sentence, untouched, in both stick modes: flying home is
    // flying home whether the weapon aims itself or not.
    manual: 'Hold full — fly into your collection field to bank, then press {build} to spend',
    autoAim: 'Hold full — fly into your collection field to bank, then press {build} to spend',
    // NEW COPY (a0-33). "Fly into" is not the gesture in this scheme — you *tap*
    // your own station and the pilot flies to its collection field and holds
    // there (GDD §2.4; `@platform/tap-pilot` `standoff`). The mechanic the
    // 2026-07-27 amendment ratified is unchanged and still named in so many
    // words: the hold drains inside the collection field, no docking, no
    // parking. `{build}` survives the scheme intact — Tap Commander leaves the
    // build binding as the devices wrote it (`src/main.ts` `sampleInput`), so E
    // / Y / △ / BUILD really does still open the wheel here.
    tap: 'Hold full — tap your own station to bank in its collection field, then press {build} to spend',
  },
  // No token: this one fires *while the wheel is open*, so the bindings are on
  // screen already. It names UPGRADE SHIP in the wheel's own words, because the
  // whole point is that the player finds the segment they'd otherwise miss. The
  // wheel is one screen with one set of words in every scheme — a tap-commander
  // player opens it by tapping their station instead of pressing a key, and then
  // reads the same five segments — so all three wordings are the same sentence.
  [PromptId.Spend]: {
    id: PromptId.Spend,
    manual: 'Spend ore on defense — or UPGRADE SHIP to mine and hit harder',
    autoAim: 'Spend ore on defense — or UPGRADE SHIP to mine and hit harder',
    tap: 'Spend ore on defense — or UPGRADE SHIP to mine and hit harder',
  },
  // No token: the arrow is the instruction, and it is device-agnostic already —
  // and scheme-agnostic too. Following it is flying, which every scheme does.
  [PromptId.UnderAttack]: {
    id: PromptId.UnderAttack,
    manual: 'Your station is under attack — follow the arrow',
    autoAim: 'Your station is under attack — follow the arrow',
    tap: 'Your station is under attack — follow the arrow',
  },
  // NEW COPY (a0-33) — the developer's third ask, and the same in every
  // configuration on purpose: it is about the setting, not about the seat, and
  // the player it most needs to reach is the one who does not like the scheme
  // they are in. It names the two rows in the settings screen's own words
  // (`./settings` — `CONTROLS`, `FIRE MODE`), the same discipline that makes the
  // SPEND prompt say UPGRADE SHIP; and it names both doors to them, because
  // §2.4 makes both changeable "at any time from settings or the pause menu".
  // No token: reaching a menu is a plain tap/click on every device (GDD §2.4).
  [PromptId.Controls]: {
    id: PromptId.Controls,
    manual: 'Change CONTROLS or FIRE MODE any time — in SETTINGS, or the pause menu',
    autoAim: 'Change CONTROLS or FIRE MODE any time — in SETTINGS, or the pause menu',
    tap: 'Change CONTROLS or FIRE MODE any time — in SETTINGS, or the pause menu',
  },
};

/**
 * Iteration order for prompts, and the priority when two are eligible at once.
 * UNDER-ATTACK leads: it is the only prompt about something happening *to* the
 * player rather than something they could do next, and a siege outranks a
 * shopping tip (GDD §2.2 — "the triangle decision, made audible").
 *
 * CONTROLS comes last, and last by a mile: every other prompt teaches the game,
 * and this one teaches the settings screen. It may never take the screen from a
 * lesson (a0-33).
 */
const PROMPT_ORDER: readonly PromptId[] = [
  PromptId.UnderAttack,
  PromptId.Mine,
  PromptId.HaulHome,
  PromptId.Spend,
  PromptId.Controls,
];

// ---------------------------------------------------------------------------
// Input-agnostic text resolution (via the action layer)
// ---------------------------------------------------------------------------

/**
 * The single-word phrase for an action's binding in this player's configuration,
 * read from {@link describeBindings} so onboarding copy can never drift from the
 * real controls strip (GDD §2.4, §2.10).
 *
 * The **seated scheme** is part of that configuration as of a0-37 — the same
 * extension that taught the strip Tap Commander, made once, in the one map both
 * surfaces read. It matters here for exactly one token: `{build}` resolves in
 * either scheme (Tap Commander leaves the build binding as the devices wrote it),
 * while `{fire}` names a press only the sticks scheme has. That is why
 * {@link PromptCopy} requires a separate `tap` wording — the tap sentences carry
 * no `{fire}`, which `onboarding.test.ts` pins, so this cannot be asked for a
 * binding the scheme does not have.
 */
function bindingPhrase(
  action: 'fire' | 'build',
  device: DeviceKind,
  mode: FireMode,
  scheme: ControlScheme,
): string {
  const row = describeBindings(device, mode, scheme).find((r) => r.action === action);
  return row ? row.binding : action;
}

/**
 * The lesson this prompt teaches a player in THIS configuration (a0-33).
 *
 * The scheme decides first and the fire mode second, because that is the order
 * the two settings matter in: Tap Commander replaces the sticks outright (the
 * pilot writes thrust, aim AND fire), so once you are in it the fire mode has
 * nothing left to say about how a rock is mined.
 */
function lessonFor(copy: PromptCopy, mode: FireMode, scheme: ControlScheme): string {
  if (scheme === 'tap') return copy.tap;
  return mode === FireMode.AutoAim ? copy.autoAim : copy.manual;
}

/**
 * Resolve a prompt to the sentence this player should read — the lesson for
 * their control scheme and fire mode, with `{token}`s filled in from their
 * device's real bindings.
 *
 * Two layers, and both are load-bearing (a0-33):
 *
 *  1. **the lesson**, chosen by `(scheme, mode)` — what the player actually does
 *     (tap the rock / hold fire near it / hold fire on it);
 *  2. **the binding**, chosen by `(device, mode)` — `{fire}` and `{build}` become
 *     "Left mouse", "Right trigger", "FIRE button", "E", "BUILD", read from the
 *     same action map that drives the sim so the copy can never drift from the
 *     real controls (GDD §2.10's input-agnostic rule, §2.4's action layer).
 *
 * `scheme` is a required argument rather than an optional one that defaults: the
 * default scheme moved under this module's feet once already (a0-30 made it Tap
 * Commander on every platform), and a caller that forgets it would go on quietly
 * teaching whichever scheme this file guessed — which is the bug, not the fix.
 */
export function resolvePromptText(
  id: PromptId,
  device: DeviceKind,
  mode: FireMode,
  scheme: ControlScheme,
): string {
  return lessonFor(PROMPT_COPY[id], mode, scheme)
    .replace('{fire}', () => bindingPhrase('fire', device, mode, scheme))
    .replace('{build}', () => bindingPhrase('build', device, mode, scheme));
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
   * Match time in seconds (`world.time`, already on `HudFrame`) — the clock the
   * CONTROLS tip's dwell is measured on (a0-33).
   *
   * Passed in rather than read: no timers, no `Date.now()`, nothing this module
   * cannot be handed by a test. Optional, and absent means the dwell never
   * advances — a caller that does not feed the clock gets a tip that stays up
   * rather than one that retires unread, which is the safe direction to fail.
   */
  readonly time?: number;
}

/** How long the CONTROLS tip stays on screen before it is considered read and
 *  retires for good (a0-33). Seconds of match time, counted only while the tip
 *  is the prompt actually shown. Long enough to read a one-line sentence twice
 *  on a phone; short enough that it is gone before the player wants the space. */
const CONTROLS_TIP_SECONDS = 8;

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
   *  actually reading, which is what the CONTROLS dwell counts (a0-33). */
  private lastActive: PromptId | null = null;
  /** Seconds the CONTROLS tip has been on screen, summed over the frames it was
   *  the shown prompt. At {@link CONTROLS_TIP_SECONDS} it is read, and retired. */
  private controlsSeconds = 0;
  /** Last tick's `signals.time`, for the delta. `null` until the first tick that
   *  carries a clock. */
  private lastTime: number | null = null;

  /**
   * Advance the machine one tick and return the prompt to show, or `null`.
   * Marks prompts completed as their lessons are learned — a completed prompt
   * is filtered out permanently (GDD §2.10 "each is completed once").
   */
  update(signals: OnboardingSignals): PromptId | null {
    const full = signals.cargoCap > 0 && signals.cargo >= signals.cargoCap;
    const underAttack = signals.underAttack === true;

    // --- The CONTROLS tip's dwell (a0-33) -----------------------------------
    // Counted on the prompt that was SHOWN last tick, not on the one eligible
    // now: a siege takes the band away mid-sentence (UNDER-ATTACK outranks
    // everything), and a tip that expires while it is off screen is a tip the
    // player never read. A backwards or absent clock contributes nothing, so a
    // rematch resetting `world.time` to 0 cannot retire it either.
    if (signals.time !== undefined) {
      if (this.lastTime !== null && this.lastActive === PromptId.Controls) {
        this.controlsSeconds += Math.max(0, signals.time - this.lastTime);
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
    // CONTROLS is done once it has been on screen long enough to READ (a0-33).
    // The other four retire on the player doing the thing; this one has nothing
    // to watch for — the settings screen is a different screen, and the HUD does
    // not see it — so being read is the whole lesson.
    if (this.controlsSeconds >= CONTROLS_TIP_SECONDS) this.completed.add(PromptId.Controls);

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
    // Remembered for the dwell above — what the player is reading right now.
    this.lastActive = active;
    return active;
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
      // The settings tip (a0-33). Its trigger is the player having flown one
      // whole loop — mined, and hauled a full hold home — because by then they
      // have felt the scheme they were seated in and know whether they like it,
      // and because until then there is always a real lesson that should have
      // the band instead. It has no world condition of its own: once the loop is
      // learned it is eligible until the dwell retires it.
      case PromptId.Controls:
        return this.completed.has(PromptId.Mine) && this.completed.has(PromptId.HaulHome);
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
