/**
 * src/ui/wheel-nav.ts — the Build & Upgrade wheel's LEVEL stack and its BACK
 * affordance. OWNER: UI.
 *
 * ── WHY THIS FILE EXISTS (the field report v0.2.4) ──────────────────────────
 * A developer reported: *"No back button from build wheels — if you go into one,
 * no way to go back up a level."* Drilling BUILD → UPGRADE SHIP → WEAPON took you
 * three screens deep with the only way out being the same BUILD toggle that shut
 * everything at once — there was no *one-level-up*.
 *
 * The fix is a single, consistent BACK affordance in one place on every level —
 * **the wheel's centre (the hub)**. A tap on the hub (or ESC on PC) pops exactly
 * one level up the stack; the deepest sub-wheel walks all the way out to closed
 * one hub-tap at a time. One spot, one gesture, every level:
 *
 * > closed ← build ← upgrade ← weapon
 * >          (CLOSE)  (BACK)    (BACK)
 *
 * This module is the pure, DOM-free, PixiJS-free half: the ordered level stack,
 * the one-step-up transition, and the {@link HubBack} descriptor the hub renders
 * (a label — CLOSE at the top level, BACK below it — plus where a press lands).
 * The build/upgrade wheel models attach a {@link HubBack} so the view draws the
 * affordance from data, the platform input funnel pops the level a hub/ESC press
 * lands on, and `wheel-nav.test.ts` walks the full drill-and-back cycle headless.
 *
 * The level names mirror the two bits of wheel screen state the platform holds
 * (`WheelInput.open` / `.panelOpen`) plus the UI's nested-weapon flag, so this is
 * a *view* of that state, never a second copy of it — {@link wheelLevel} derives
 * the level from those same three booleans.
 */

/**
 * A level of the wheel, deepest last. `closed` is the wheel not being on screen;
 * `build` is the four-segment Build wheel; `upgrade` is the ship-upgrade wheel
 * behind its arrow; `weapon` is the WEAPON sub-wheel drilled into that.
 */
export type WheelLevel = 'closed' | 'build' | 'upgrade' | 'weapon';

/** The level stack, ordered from shut to deepest. A BACK steps one index down
 *  it; opening a screen steps one up. The single source of the ordering, so the
 *  drill order and the back order can never disagree. */
export const WHEEL_LEVELS: readonly WheelLevel[] = ['closed', 'build', 'upgrade', 'weapon'];

/** How deep a level sits on the stack — 0 for `closed`, 3 for `weapon`. */
export function wheelDepth(level: WheelLevel): number {
  return WHEEL_LEVELS.indexOf(level);
}

/**
 * The level a BACK (a hub tap, or ESC on PC) drops to from `level`: one step
 * toward `closed`, bottoming out there. From `build` that is `closed` (the wheel
 * shuts); from `weapon` it is `upgrade`, and so on — so three BACKs from the
 * deepest level land shut, which is exactly the cycle the field report asks for.
 */
export function wheelBack(level: WheelLevel): WheelLevel {
  const i = wheelDepth(level);
  return i <= 0 ? 'closed' : (WHEEL_LEVELS[i - 1] ?? 'closed');
}

/**
 * The hub's BACK affordance for a level (field report v0.2.4). Pure data — a
 * label and the level a press lands on — so the view draws it and the input
 * funnel acts on it without either re-deriving the stack.
 */
export interface HubBack {
  /** The word on the hub. `CLOSE` at the top level (there is no wheel above the
   *  Build wheel, so its BACK simply shuts it) and `BACK` at every deeper level,
   *  where a wheel *is* above it. */
  readonly label: string;
  /** The level a hub tap / ESC lands on — one step up the stack. */
  readonly to: WheelLevel;
  /** True when back closes the wheel outright (the `build` level), false when it
   *  merely pops to a parent wheel. Lets the view/word read `CLOSE` vs `BACK`
   *  from one flag rather than string-matching the label. */
  readonly closes: boolean;
}

/** The label a top-level back wears — it shuts the wheel rather than popping to a
 *  parent, so it says so. */
export const HUB_CLOSE_LABEL = 'CLOSE';
/** The label every deeper level's back wears — a wheel sits above it. */
export const HUB_BACK_LABEL = 'BACK';

/**
 * The hub's BACK affordance for `level`, or `null` when the wheel is closed (a
 * shut wheel has no hub to press). The one place the CLOSE-vs-BACK wording is
 * decided, so the Build wheel and the Upgrade wheel word their hubs identically.
 */
export function hubBack(level: WheelLevel): HubBack | null {
  if (level === 'closed') return null;
  const to = wheelBack(level);
  const closes = to === 'closed';
  return { label: closes ? HUB_CLOSE_LABEL : HUB_BACK_LABEL, to, closes };
}

/**
 * The active {@link WheelLevel} from the three booleans the client already holds —
 * the platform's `WheelInput.open` and `.panelOpen`, plus the UI's nested-weapon
 * flag. A derivation, not a store: there is no fourth piece of state to fall out
 * of sync, so the level the hub backs out of is always the level being drawn.
 */
export function wheelLevel(open: boolean, panelOpen: boolean, weaponOpen: boolean): WheelLevel {
  if (!open) return 'closed';
  if (!panelOpen) return 'build';
  return weaponOpen ? 'weapon' : 'upgrade';
}
