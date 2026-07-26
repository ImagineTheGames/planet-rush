/**
 * src/ui/press-feedback.ts — the ONE press/confirm feedback component. OWNER: UI.
 *
 * ── WHY THIS FILE EXISTS (field report v0.2.2) ──────────────────────────────
 * *"UI needs visual feedback when it's clicked; when going to repair core it's
 * tough to know it did anything because there's no visual feedback on the
 * button."*
 *
 * Two things were missing, and they are deliberately separate here because they
 * answer two different questions:
 *
 *  1. **The pressed tell** — *did my finger land?* Every tappable control gets an
 *     immediate scale-down + glow the instant it is pressed ({@link pressPulse}),
 *     and a disabled control gets a threat-red **shake/flash** instead
 *     ({@link rejectPulse}) — so "nothing happened" and "not allowed" are never
 *     the same silence. This fires on touch-DOWN, from the input, and covers the
 *     finger.
 *  2. **The action tell** — *did the thing actually happen?* When the SIM confirms
 *     a spend — a turret queued, a tier bought, ore banked, or the core ticking
 *     back up under a repair channel — the control pulses, the ore cost floats off
 *     toward the bank readout, and (for repair) the core shimmers
 *     ({@link confirmPulse}, {@link CostFloat}). This fires on the sim's real state
 *     change, never on the press, so a rejected or no-op press produces no false
 *     confirmation.
 *
 * The pressed tell covers the finger; the confirmation covers the ACTION. Both
 * are computed here, once, as pure functions of *elapsed time*, so every view —
 * the Build wheel, the Upgrade wheel, and any menu button that adopts it — draws
 * the identical motion by calling the same code. Nothing here imports PixiJS, so
 * it unit-tests headless (`press-feedback.test.ts`), which is what keeps the feel
 * a contract rather than a per-view re-implementation that drifts.
 *
 * ── THE CONFIRMATION IS DERIVED, NOT REPORTED (the load-bearing bit) ─────────
 * {@link detectConfirmations} reads a before/after snapshot of the same sim
 * numbers the HUD already receives every frame (core HP, bank, hold, turret and
 * shield counts, upgrade tiers) and returns what changed. No new sim plumbing and
 * no "I pressed the button" flag: the feedback fires because the core actually
 * healed, so a press that the sim quietly refuses can never fake a confirmation.
 *
 * Colours obey the frozen palette (style-guide §1–§2): the glow and confirm pulse
 * are **plasma** (energy), the reject flash is **threat red** (danger only), the
 * repair shimmer is **patina** (the repair tint), and a floating cost stays
 * **signal yellow** — it *is* ore, the one thing yellow is allowed to mean.
 */

import { REPAIR_ENTRY_ORE, WHEEL_ORDER } from './build-wheel';
import type { WheelSegmentId } from './build-wheel';
import { SHIELD, TURRET } from '../sim/constants';
import { UPGRADE_LADDER, UPGRADE_WHEEL_ORDER, UpgradeTrack } from './upgrade-wheel';
import type { UpgradeTiers } from './upgrade-wheel';

// ---------------------------------------------------------------------------
// Tunables — the Cold Vacuum press tokens (all seconds / 0..1 / CSS px)
// ---------------------------------------------------------------------------

/** How long the pressed scale-down + glow lasts before it self-releases. Short —
 *  a wheel tap is a quick down-and-up, so the tell is a flash that covers the
 *  finger, not a state that has to be un-set by a reliable pointer-up. */
export const PRESS_FLASH_SECONDS = 0.16;
/** How far a pressed control scales down at the instant of the press (1 = none).
 *  It eases back to 1 across {@link PRESS_FLASH_SECONDS}. */
export const PRESS_SCALE = 0.9;
/** Glow ring alpha at the instant of the press, fading to 0 across the flash. */
export const PRESS_GLOW = 0.6;

/** How long a rejected (disabled) control shakes and flashes. Long enough to read
 *  as a firm "no", short enough not to feel like a penalty. */
export const REJECT_SECONDS = 0.34;
/** Peak horizontal shake amplitude of a rejected control, CSS px. */
export const REJECT_SHAKE_PX = 6;
/** Number of shake oscillations across {@link REJECT_SECONDS}. */
export const REJECT_SHAKES = 3;
/** Threat-red flash alpha at the start of a rejection, fading to 0. */
export const REJECT_FLASH = 0.7;

/** How long a confirmed action pulses / shimmers, and how long its cost floats. */
export const CONFIRM_SECONDS = 0.55;
/** Peak extra scale at the confirm pulse's crest (0.22 ⇒ 1.22× at the peak). */
export const CONFIRM_PULSE = 0.22;
/** Peak shimmer alpha on a confirmed control (and on the core, for a repair). */
export const CONFIRM_SHIMMER = 0.85;
/** How far a floating cost travels toward the bank readout before it fades, CSS
 *  px. The direction is the view's (wedge → top-left bank); this is the length. */
export const COST_FLOAT_RISE = 60;
/** Shortest gap between two confirmations on the SAME control that each spawn
 *  their own float. Repair heals every frame, so without this it would spray a
 *  float per tick; with it the continuous channel reads as a steady tick. */
export const CONFIRM_REPEAT_GAP = 0.45;

/** Below this, an HP / ore delta is float noise, not a real change. */
const EPSILON = 1e-3;

// ---------------------------------------------------------------------------
// Which wheel a control lives on, and the fixed wedge indices we key off
// ---------------------------------------------------------------------------

/** The two wheels a press can land on (GDD §2.5). A menu button that adopts this
 *  component uses its own surface string — the driver keys presses by
 *  `surface:index`, so surfaces never collide. */
export type PressSurface = 'build' | 'upgrade';

/** Wedge index of a Build-wheel segment, from the wheel's own clockwise order. */
export function buildSegmentIndex(id: WheelSegmentId): number {
  return WHEEL_ORDER.indexOf(id);
}

const REPAIR_INDEX = buildSegmentIndex('repair');
const TURRET_INDEX = buildSegmentIndex('turret');
const SHIELD_INDEX = buildSegmentIndex('shield');
const BANK_INDEX = buildSegmentIndex('bank');

// ---------------------------------------------------------------------------
// Pure per-visual functions — one control's motion as a function of elapsed
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Ease-out: fast at the start, settling at the end — the natural shape for a
 *  press releasing and a pulse decaying. */
function easeOut(t: number): number {
  const c = clamp01(t);
  return 1 - (1 - c) * (1 - c);
}

/** The pressed tell: a scale-down + glow that springs back over the flash. At
 *  `elapsed = 0` it is fully pressed ({@link PRESS_SCALE}, {@link PRESS_GLOW});
 *  by {@link PRESS_FLASH_SECONDS} it is neutral (scale 1, glow 0). */
export interface PressPulse {
  /** Whether the flash is still visible this frame. */
  readonly active: boolean;
  /** Scale multiplier to apply to the control, ≤ 1. */
  readonly scale: number;
  /** Glow-ring alpha, 0..{@link PRESS_GLOW}. */
  readonly glow: number;
}

export function pressPulse(elapsed: number): PressPulse {
  if (!(elapsed >= 0) || elapsed >= PRESS_FLASH_SECONDS) {
    return { active: false, scale: 1, glow: 0 };
  }
  const t = easeOut(elapsed / PRESS_FLASH_SECONDS); // 0 → 1 as it releases
  return {
    active: true,
    scale: PRESS_SCALE + (1 - PRESS_SCALE) * t,
    glow: PRESS_GLOW * (1 - t),
  };
}

/** The rejected tell: a damped horizontal shake plus a threat-red flash, for a
 *  disabled control that was pressed. */
export interface RejectPulse {
  readonly active: boolean;
  /** Horizontal offset to add to the control this frame, CSS px (signed). */
  readonly offsetX: number;
  /** Threat-red flash alpha over the control, 0..{@link REJECT_FLASH}. */
  readonly flash: number;
}

export function rejectPulse(elapsed: number): RejectPulse {
  if (!(elapsed >= 0) || elapsed >= REJECT_SECONDS) {
    return { active: false, offsetX: 0, flash: 0 };
  }
  const t = elapsed / REJECT_SECONDS;
  const decay = 1 - t; // amplitude bleeds out across the shake
  const offsetX = Math.sin(t * REJECT_SHAKES * 2 * Math.PI) * REJECT_SHAKE_PX * decay;
  return { active: true, offsetX, flash: REJECT_FLASH * decay };
}

/** The action tell: a pulse that swells and settles, with a shimmer that fades. */
export interface ConfirmPulse {
  readonly active: boolean;
  /** Scale multiplier to apply to the control, ≥ 1 — swells then settles. */
  readonly scale: number;
  /** Shimmer alpha over the control (and the core, for a repair), 0..1. */
  readonly shimmer: number;
}

export function confirmPulse(elapsed: number): ConfirmPulse {
  if (!(elapsed >= 0) || elapsed >= CONFIRM_SECONDS) {
    return { active: false, scale: 1, shimmer: 0 };
  }
  const t = elapsed / CONFIRM_SECONDS;
  // A single hump: sin(πt) peaks at the midpoint and returns to 0 at both ends,
  // so the control swells and settles rather than snapping back.
  const hump = Math.sin(t * Math.PI);
  return {
    active: true,
    scale: 1 + CONFIRM_PULSE * hump,
    shimmer: CONFIRM_SHIMMER * (1 - t), // brightest at the moment of confirm
  };
}

/** A cost numeral floating off a confirmed control toward the bank readout. The
 *  view owns the geometry (start = the control, direction = the top-left bank);
 *  this owns the number, the travel fraction, and the fade. */
export interface CostFloat {
  /** Which wheel it launched from — the view maps this to a start position. */
  readonly surface: PressSurface;
  /** The wedge index it launched from. */
  readonly index: number;
  /** The ore amount to draw. */
  readonly amount: number;
  /** How far along its travel, 0 (just spawned) → 1 (arrived and gone). */
  readonly progress: number;
  /** Alpha, 1 → 0 across the travel. */
  readonly alpha: number;
  /** A BANK deposit: ore moving INTO the bank, drawn as `+n` rather than a spend.
   *  A spend (turret/shield/repair/upgrade) draws the bare cost. */
  readonly deposit: boolean;
}

// ---------------------------------------------------------------------------
// Confirmation detection — what the sim actually did, from a before/after snap
// ---------------------------------------------------------------------------

/** The slice of sim state a confirmation is derived from — every field is one the
 *  HUD already reads each frame ({@link ./hud} `HudFrame`), so detecting a
 *  confirmation needs no new plumbing. */
export interface WheelSnapshot {
  readonly coreHp: number;
  readonly banked: number;
  readonly cargo: number;
  readonly turrets: number;
  readonly shields: number;
  readonly tiers: UpgradeTiers;
}

/** One confirmed action the view should celebrate. */
export interface Confirmation {
  readonly surface: PressSurface;
  readonly index: number;
  /** Ore to float — a spend's cost, or a deposit's amount. */
  readonly amount: number;
  readonly deposit: boolean;
  /** A repair: also shimmer the core, not only the wedge (field report v0.2.2). */
  readonly core: boolean;
}

/**
 * What changed between two frames, as confirmations to celebrate. Pure and total:
 * the same snapshots always yield the same list, and equal snapshots yield none.
 *
 * The rules, each keyed to exactly one sim number moving the right way:
 *  - **core HP rose** ⇒ a repair channel is healing (only repair raises core HP;
 *    shield regen raises shield HP, a different number). Shimmer the core.
 *  - **turret / shield count rose** ⇒ one was queued (the count includes
 *    under-construction, so it ticks the instant the order lands).
 *  - **bank rose while the hold fell** ⇒ a deposit (nothing else raises the bank).
 *  - **an upgrade tier rose** ⇒ that track was bought; the float is its ladder cost.
 *
 * A spend lowers the bank (or hold) and so can never be mistaken for a deposit,
 * and a rejected press moves nothing — which is the whole point.
 */
export function detectConfirmations(prev: WheelSnapshot, next: WheelSnapshot): Confirmation[] {
  const out: Confirmation[] = [];

  // Repair: only the core-repair channel raises core HP.
  if (next.coreHp > prev.coreHp + EPSILON) {
    out.push({ surface: 'build', index: REPAIR_INDEX, amount: REPAIR_ENTRY_ORE, deposit: false, core: true });
  }

  // A turret / shield was queued (counts include under-construction).
  if (next.turrets > prev.turrets) {
    out.push({ surface: 'build', index: TURRET_INDEX, amount: TURRET.cost, deposit: false, core: false });
  }
  if (next.shields > prev.shields) {
    out.push({ surface: 'build', index: SHIELD_INDEX, amount: SHIELD.cost, deposit: false, core: false });
  }

  // A deposit: the only thing that RAISES the bank, paired with the hold falling.
  if (next.banked > prev.banked + EPSILON && next.cargo < prev.cargo - EPSILON) {
    const amount = Math.round(next.banked - prev.banked);
    if (amount > 0) out.push({ surface: 'build', index: BANK_INDEX, amount, deposit: true, core: false });
  }

  // An upgrade tier was bought — float that tier's ladder cost.
  for (let i = 0; i < UPGRADE_WHEEL_ORDER.length; i++) {
    const track = UPGRADE_WHEEL_ORDER[i] as UpgradeTrack;
    const before = prev.tiers[track] ?? 0;
    const after = next.tiers[track] ?? 0;
    if (after > before) {
      // The cost of the tier just crossed (buying tier `before+1` costs costs[before]).
      const cost = UPGRADE_LADDER[track].costs[before] ?? 0;
      out.push({ surface: 'upgrade', index: i, amount: cost, deposit: false, core: false });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// The driver — one per view, fed presses and confirmations, sampled per frame
// ---------------------------------------------------------------------------

/** The combined per-control motion the view applies to one wedge/button. */
export interface ControlFeedback {
  /** Scale multiplier (press-down and confirm-pulse combined). */
  readonly scale: number;
  /** Glow-ring alpha from a press (plasma). */
  readonly glow: number;
  /** Horizontal shake offset from a rejection, CSS px. */
  readonly shakeX: number;
  /** Threat-red reject-flash alpha. */
  readonly reject: number;
  /** Confirm/repair shimmer alpha (plasma on a wedge, patina on the core). */
  readonly shimmer: number;
}

/** The neutral feedback — nothing pressed, nothing confirming. Frozen and reused
 *  so a quiet control allocates nothing. */
export const NEUTRAL_FEEDBACK: ControlFeedback = Object.freeze({
  scale: 1,
  glow: 0,
  shakeX: 0,
  reject: 0,
  shimmer: 0,
});

interface PressRecord {
  readonly surface: PressSurface;
  readonly index: number;
  readonly start: number;
  readonly rejected: boolean;
}

interface ConfirmRecord {
  readonly surface: PressSurface;
  readonly index: number;
  readonly start: number;
  readonly amount: number;
  readonly deposit: boolean;
  readonly core: boolean;
}

/**
 * Holds the live presses and confirmations for one view and samples them per
 * frame. A human touches one control at a time, so there is at most one active
 * press; confirmations can overlap (a purchase mid-shimmer), so they are a small
 * pruned list. Everything is a pure function of the frame time it is sampled at,
 * so a frozen frame (`?freeze=1`) simply shows whatever the last-seen time held.
 */
export class PressFeedback {
  private lastPress: PressRecord | null = null;
  private confirms: ConfirmRecord[] = [];
  /** Cap so a pathological confirm storm can't grow the list without bound. */
  private static readonly MAX_CONFIRMS = 8;

  /** Record a press on a control. `allowed = false` makes it a rejection (shake
   *  + flash) instead of a press (scale + glow). Re-pressing the same control
   *  restarts its flash, which is the right feel for a repeated tap. */
  press(surface: PressSurface, index: number, allowed: boolean, time: number): void {
    this.lastPress = { surface, index, start: time, rejected: !allowed };
  }

  /** Record a confirmed action. Throttled per control by {@link CONFIRM_REPEAT_GAP}
   *  so the continuous repair channel ticks steadily instead of spraying a float
   *  every frame; discrete spends (they don't repeat) are never affected. */
  confirm(c: Confirmation, time: number): void {
    const recent = this.confirms.find(
      (r) => r.surface === c.surface && r.index === c.index && time - r.start < CONFIRM_REPEAT_GAP,
    );
    if (recent) return;
    this.confirms.push({ ...c, start: time });
    if (this.confirms.length > PressFeedback.MAX_CONFIRMS) this.confirms.shift();
  }

  /** Drop everything (undock, ship death, rematch) so the next context starts
   *  clean — the same hard-reset the wheel toggle does. */
  reset(): void {
    this.lastPress = null;
    this.confirms.length = 0;
  }

  /** Prune anything that has fully elapsed at `time`. Called once per sample. */
  private prune(time: number): void {
    if (this.lastPress) {
      const done = this.lastPress.rejected
        ? time - this.lastPress.start >= REJECT_SECONDS
        : time - this.lastPress.start >= PRESS_FLASH_SECONDS;
      if (done) this.lastPress = null;
    }
    if (this.confirms.length > 0) {
      this.confirms = this.confirms.filter((r) => time - r.start < CONFIRM_SECONDS);
    }
  }

  /** The combined motion for one control this frame. Returns the shared
   *  {@link NEUTRAL_FEEDBACK} when nothing is happening to it, so a quiet wheel
   *  allocates nothing. */
  feedback(surface: PressSurface, index: number, time: number): ControlFeedback {
    this.prune(time);

    let scale = 1;
    let glow = 0;
    let shakeX = 0;
    let reject = 0;
    let shimmer = 0;

    const p = this.lastPress;
    if (p && p.surface === surface && p.index === index) {
      if (p.rejected) {
        const r = rejectPulse(time - p.start);
        shakeX = r.offsetX;
        reject = r.flash;
      } else {
        const pp = pressPulse(time - p.start);
        scale *= pp.scale;
        glow = pp.glow;
      }
    }

    // Newest confirmation for this control wins the pulse/shimmer.
    let newest: ConfirmRecord | null = null;
    for (const r of this.confirms) {
      if (r.surface === surface && r.index === index && (!newest || r.start > newest.start)) newest = r;
    }
    if (newest) {
      const cp = confirmPulse(time - newest.start);
      scale *= cp.scale;
      shimmer = Math.max(shimmer, cp.shimmer);
    }

    if (scale === 1 && glow === 0 && shakeX === 0 && reject === 0 && shimmer === 0) {
      return NEUTRAL_FEEDBACK;
    }
    return { scale, glow, shakeX, reject, shimmer };
  }

  /** The cost numerals floating this frame, one per live confirmation that has an
   *  amount to show. The view maps `(surface, index)` to a start position. */
  floats(time: number): CostFloat[] {
    this.prune(time);
    const out: CostFloat[] = [];
    for (const r of this.confirms) {
      if (r.amount <= 0) continue;
      const t = clamp01((time - r.start) / CONFIRM_SECONDS);
      out.push({
        surface: r.surface,
        index: r.index,
        amount: r.amount,
        progress: t,
        alpha: 1 - t,
        deposit: r.deposit,
      });
    }
    return out;
  }

  /** The strongest core-shimmer alpha this frame (repair confirmations only), for
   *  the planet-HP bar / core tell. 0 when no repair is confirming. */
  coreShimmer(time: number): number {
    this.prune(time);
    let best = 0;
    for (const r of this.confirms) {
      if (!r.core) continue;
      const cp = confirmPulse(time - r.start);
      if (cp.shimmer > best) best = cp.shimmer;
    }
    return best;
  }

  /** Whether anything is animating this frame — lets a view skip its feedback
   *  pass entirely when the wheel is quiet. */
  active(time: number): boolean {
    this.prune(time);
    return this.lastPress !== null || this.confirms.length > 0;
  }
}
