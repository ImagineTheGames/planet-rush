/**
 * src/ui/upgrade-wheel.ts — the ship upgrade WHEEL. OWNER: UI Engineer.
 *
 * The second screen behind the Build wheel's UPGRADE SHIP arrow (GDD §2.5), and
 * **the only place ship stats are ever shown**:
 *
 * > Ship stats — power, engine, cargo, hull tiers — are deliberately *not* on the
 * > HUD. They appear only in the upgrade screen, where they are a spending
 * > decision rather than clutter. (GDD §2.2, §2.5)
 *
 * ── WHY THIS IS A WHEEL AND NOT A PANEL (the field report) ──────────────────
 * A developer reported the upgrade screen *"is not immediately readable, and
 * it's very different from the planet's wheel menu — it should be a wheel menu as
 * well."* So it is one now: the same component family, gestures, and visual
 * language as the Build wheel ({@link ./build-wheel}). One **wedge per upgrade
 * track**, laid out clockwise from twelve o'clock exactly as the Build wheel's
 * segments are, each wedge carrying its **current tier value → next → ore cost**
 * (GDD §2.5) and dimmed *with a reason* when it cannot be bought — unaffordable,
 * or already maxed. Because upgrading is still an explicit trade against turrets,
 * shields and repair, every wedge names what the next tier costs, and cost is the
 * only place ore-yellow appears (style-guide §2), the same rule the Build wheel
 * obeys.
 *
 * Upgrades *multiply* the class base stats (GDD §2.5, §2.11), so a maxed
 * Interceptor is still the fastest thing on the map and a maxed Hauler still the
 * toughest — which is why the ladder below is expressed as multipliers over
 * `SHIP_STATS[class]` rather than as absolute numbers per class.
 *
 * Pure and DOM-free: it derives wedges from the class table (`../sim/constants`)
 * plus the ladder, so it unit-tests headless and the Pixi view only draws what
 * it returns.
 *
 * ── DATA-DRIVEN OFF THE LADDER (so new tracks appear for free) ──────────────
 * {@link upgradeWheelModel} builds one wedge per entry in the ladder's track
 * order and takes the ladder as a parameter. That is the load-bearing bit: the
 * day p2-03's projectile tracks (speed / damage) land as new rungs on the ladder,
 * they become wedges here with **no change to this file or the view** — the wheel
 * lays out however many wedges the ladder has and prints whatever numbers it
 * carries. The provisional numbers below match the sim's ratified `UPGRADES`
 * table (`../sim/constants`), so what a player is shown is what they are sold.
 */

import { ShipClass } from '@shared/types';
import { CARGO_CAP_MAX, CARGO_PER_TIER, SHIP_STATS } from '../sim/constants';
import { affordable } from './affordability';

// ---------------------------------------------------------------------------
// The four upgrade tracks (GDD §2.5)
// ---------------------------------------------------------------------------

/**
 * The track NAMES live in src/shared/types.ts — one enum for the whole repo.
 * This file used to declare its own identical copy; the copies diverged the
 * moment SPEED split off DAMAGE (p4-07) and typechecking caught it (#108).
 * Re-exported so existing `from './upgrade-wheel'` imports keep working.
 */
export { UpgradeTrack } from '@shared/types';
import { UpgradeTrack } from '@shared/types';

/** The four **flat** tracks the platform input funnel maps panel rows onto
 *  (`writeWheelOrders`, `match-boot.test.ts`). SPEED is deliberately absent here:
 *  it is a WEAPON-group track and reaches the sim through the weapon SUB-wheel
 *  (p4-10), not a flat row. This stays exactly these four — the funnel contract
 *  is pinned against it — while the two-level wheel walks {@link WHEEL_TRACK_ORDER}
 *  to lay out its wedges. */
export const TRACK_ORDER: readonly UpgradeTrack[] = [
  UpgradeTrack.Power,
  UpgradeTrack.Engine,
  UpgradeTrack.Cargo,
  UpgradeTrack.Hull,
];

/** The group tag the WEAPON sub-wheel collects (RATIFIED v0.2.2): every ladder
 *  track with `group: WEAPON_GROUP` renders inside the nested weapon wheel, and
 *  the rest stay on the main wheel. Data, not layout — a third weapon track would
 *  join the sub-wheel with no change here. Mirrors the sim's `group` metadata. */
export const WEAPON_GROUP = 'weapon';

/**
 * The full ladder-walk order the two-level wheel lays wedges out from — every
 * track, with the WEAPON group (DAMAGE, SPEED) contiguous and leading, exactly as
 * the sim's `TRACK_ORDER` keeps it. {@link upgradeWheelSlots} collapses the
 * contiguous weapon run into one WEAPON wedge on the main wheel and expands it
 * back to its member tracks in the sub-wheel, so both levels are derived from this
 * one order. A track added here appears on the right level for free.
 */
export const WHEEL_TRACK_ORDER: readonly UpgradeTrack[] = [
  UpgradeTrack.Power,
  UpgradeTrack.Speed,
  UpgradeTrack.Engine,
  UpgradeTrack.Cargo,
  UpgradeTrack.Hull,
];

/** The player's tier on each track, 0 = stock hull. Upgrades persist through
 *  respawn (GDD §2.5), so this is match-lifetime state, not ship-lifetime. */
export type UpgradeTiers = Readonly<Record<UpgradeTrack, number>>;

/** A fresh, un-upgraded ship. */
export const STOCK_TIERS: UpgradeTiers = {
  [UpgradeTrack.Power]: 0,
  [UpgradeTrack.Engine]: 0,
  [UpgradeTrack.Cargo]: 0,
  [UpgradeTrack.Hull]: 0,
  [UpgradeTrack.Speed]: 0,
};

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

/** How a tier changes the class base: scale it, or add a flat step to it. */
export type TrackMode = 'multiply' | 'add';

/** How a track's value is printed in the current/next columns. */
export type TrackFormat = 'integer' | 'percent';

/** One track's upgrade ladder. */
export interface UpgradeTrackSpec {
  readonly track: UpgradeTrack;
  /** The row's words. Named for the thing, not the stat name in code. */
  readonly label: string;
  /** `steps[tier]` applied to the class base — index 0 is the stock hull, so
   *  `steps.length - 1` is the max tier. */
  readonly steps: readonly number[];
  /** Ore cost to buy tier `i + 1`. Length is `steps.length - 1`. */
  readonly costs: readonly number[];
  readonly mode: TrackMode;
  readonly format: TrackFormat;
  /** Hard ceiling on the resulting value (GDD §2.8 cargo "cap 8"), or `null`. */
  readonly max: number | null;
  /** The sub-wheel this track is drawn inside, or `undefined` for a standalone
   *  wedge on the main wheel. `WEAPON_GROUP` collects DAMAGE and SPEED into the
   *  nested weapon wheel (RATIFIED v0.2.2). Mirrors the sim ladder's `group`. */
  readonly group?: string;
}

/** A full ladder: one spec per track. */
export type UpgradeLadder = Readonly<Record<UpgradeTrack, UpgradeTrackSpec>>;

/**
 * The provisional ladder (see the module header). Three buyable tiers per
 * track, costs escalating and the first tier cheap (GDD §2.5, §2.8).
 * Every number here is TUNABLE and hands over to QA with the constants table.
 */
export const UPGRADE_LADDER: UpgradeLadder = {
  // Power: mining speed *and* weapon damage — one stat (GDD §2.5). Multiplies
  // the class power, so the Excavator stays the mining engine at every tier.
  [UpgradeTrack.Power]: {
    track: UpgradeTrack.Power,
    // Reads DAMAGE, not POWER (v0.2.2 field report): the wedge means one thing to
    // a player — how hard each shot bites. Enum key stays `Power` for wire/replay
    // stability (see @shared/types). Lives in the WEAPON sub-wheel.
    label: 'DAMAGE',
    steps: [1, 1.25, 1.5, 1.8],
    costs: [4, 8, 14], // TUNABLE
    mode: 'multiply',
    format: 'integer',
    max: null,
    group: WEAPON_GROUP,
  },
  // Engine: top speed, printed as a percentage of the Vanguard baseline — the
  // same way GDD §2.11 states class speed, so the two read against each other.
  [UpgradeTrack.Engine]: {
    track: UpgradeTrack.Engine,
    label: 'ENGINE',
    steps: [1, 1.15, 1.3, 1.45],
    costs: [3, 7, 12], // TUNABLE
    mode: 'multiply',
    format: 'percent',
    max: null,
  },
  // Cargo: "+2 per tier" with a hard cap of 8 — both ratified numbers, read
  // from the constants table rather than typed twice (GDD §2.8).
  [UpgradeTrack.Cargo]: {
    track: UpgradeTrack.Cargo,
    label: 'CARGO',
    steps: [0, CARGO_PER_TIER, CARGO_PER_TIER * 2, CARGO_PER_TIER * 3],
    costs: [2, 6, 12], // TUNABLE — "first tier cheap, escalating" (GDD §2.8)
    mode: 'add',
    format: 'integer',
    max: CARGO_CAP_MAX,
  },
  // Hull: ships are cheap and respawn free, and hull is not repairable at all
  // (GDD §2.5) — buying hull buys time in a fight, never a heal.
  [UpgradeTrack.Hull]: {
    track: UpgradeTrack.Hull,
    label: 'HULL',
    steps: [1, 1.2, 1.4, 1.6],
    costs: [3, 7, 12], // TUNABLE
    mode: 'multiply',
    format: 'integer',
    max: null,
  },
  // Speed: projectile muzzle velocity (v0.2.2 split). Mirrors the sim's
  // SHOT_SPEED_STEPS/COSTS; renders in the WEAPON sub-wheel (p4-10), not this
  // flat panel — present here so the tier record and ladder types stay total.
  [UpgradeTrack.Speed]: {
    track: UpgradeTrack.Speed,
    label: 'SPEED',
    steps: [1, 1.15, 1.3],
    costs: [8, 14], // TUNABLE — a tier above DAMAGE at each rung (sim ratified)
    mode: 'multiply',
    format: 'percent',
    max: null,
    group: WEAPON_GROUP,
  },
};

// ---------------------------------------------------------------------------
// Class bases — what a tier multiplies
// ---------------------------------------------------------------------------

/** Player-facing class names (GDD §2.11 hull names). */
export const CLASS_NAMES: Readonly<Record<ShipClass, string>> = {
  [ShipClass.Interceptor]: 'INTERCEPTOR',
  [ShipClass.Vanguard]: 'VANGUARD',
  [ShipClass.Excavator]: 'EXCAVATOR',
  [ShipClass.Hauler]: 'HAULER',
};

/** The stock value a track's ladder is applied to, from the ratified class
 *  table (GDD §2.11). Engine is expressed as a percentage of the Vanguard, the
 *  same convention GDD §2.11 states class speed in. */
export function trackBase(shipClass: ShipClass, track: UpgradeTrack): number {
  const stats = SHIP_STATS[shipClass];
  switch (track) {
    case UpgradeTrack.Power:
      return stats.power;
    case UpgradeTrack.Engine:
      return stats.speedMul * 100;
    case UpgradeTrack.Cargo:
      return stats.cargo;
    case UpgradeTrack.Hull:
      return stats.hull;
    case UpgradeTrack.Speed:
      // Muzzle velocity, printed as a percentage of the base shot — the same
      // relative convention ENGINE uses (base = 100%).
      return 100;
  }
}

/** The value of a track at a given tier — the number the panel prints. Clamped
 *  to the spec's ceiling where it has one (cargo's cap of 8, GDD §2.8). */
export function trackValue(shipClass: ShipClass, spec: UpgradeTrackSpec, tier: number): number {
  const base = trackBase(shipClass, spec.track);
  const clamped = Math.max(0, Math.min(tier, spec.steps.length - 1));
  const step = spec.steps[clamped] ?? (spec.mode === 'multiply' ? 1 : 0);
  const raw = spec.mode === 'multiply' ? base * step : base + step;
  return spec.max === null ? raw : Math.min(raw, spec.max);
}

/** Print a track value for the panel's current/next columns. */
export function formatTrackValue(value: number, format: TrackFormat): string {
  return format === 'percent' ? `${Math.round(value)}%` : `${Math.round(value)}`;
}

// ---------------------------------------------------------------------------
// Wheel layout — one wedge per track, clockwise from twelve o'clock
// ---------------------------------------------------------------------------

/**
 * The order the wheel lays wedges out in, clockwise from the top — the full
 * ladder walk ({@link WHEEL_TRACK_ORDER}), weapon group first. {@link upgradeWheelSlots}
 * turns it into the two levels (main wheel / weapon sub-wheel), and
 * {@link upgradeWheelModel} takes it as a parameter, so a longer ladder lays out
 * its extra wedges for free.
 */
export const UPGRADE_WHEEL_ORDER: readonly UpgradeTrack[] = WHEEL_TRACK_ORDER;

/** Angular width of one wedge (radians) for a wheel of `count` wedges. Matches
 *  the Build wheel's construction, so the two wheels feel identical. */
export function upgradeWedgeArc(count: number): number {
  return count > 0 ? (2 * Math.PI) / count : 0;
}

/** Screen-space angle of a wedge's centre (radians, y-down: `-π/2` is up).
 *  Wedge 0 sits at twelve o'clock and the rest run clockwise — the same
 *  convention the Build wheel's {@link ./build-wheel.segmentAngle} uses, so a
 *  press maps to a wedge the same way on both wheels. */
export function upgradeWedgeAngle(index: number, count: number): number {
  return -Math.PI / 2 + index * upgradeWedgeArc(count);
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/** Whether a wedge can be bought right now, and if not, why — the "dimmed with a
 *  reason" the field report asked for. `maxed` is a finished ladder; the wedge
 *  still shows its current value, because this is where stats live. */
export type UpgradeWedgeState = 'ready' | 'unaffordable' | 'maxed';

/**
 * What a wedge *is* on the two-level wheel (RATIFIED v0.2.2):
 *  - `track`  — buys one tier on a ship-stat track (current → next → cost).
 *  - `weapon` — the main wheel's WEAPON wedge: opens the nested weapon sub-wheel
 *               instead of spending, and carries a {@link UpgradeWedge.summary}
 *               so the main wheel still says the weapon tiers at a glance.
 *  - `back`   — the sub-wheel's back-out wedge: returns to the main wheel.
 * The nav wedges buy nothing, so they carry no cost and no stat value.
 */
export type UpgradeWedgeKind = 'track' | 'weapon' | 'back';

/** A pip on the WEAPON wedge's summary: one weapon track's current tier out of
 *  its max, so the main wheel shows DAMAGE/SPEED as filled-vs-empty dots without
 *  opening the sub-wheel (RATIFIED v0.2.2, item 3). */
export interface UpgradeSummaryPip {
  readonly track: UpgradeTrack;
  readonly label: string;
  /** Current tier, 0 = stock. */
  readonly tier: number;
  /** Highest tier the ladder offers. */
  readonly maxTier: number;
}

/**
 * One wheel wedge. A `track` wedge gives **current value → next tier → ore cost**
 * (GDD §2.5); a `weapon`/`back` wedge navigates instead. Values are pre-formatted
 * strings so the view prints them and computes nothing — the numbers on this
 * screen are the whole point, and they are decided here.
 */
export interface UpgradeWedge {
  /** What pressing it does (buy a tier, open the weapon sub-wheel, or go back). */
  readonly kind: UpgradeWedgeKind;
  /** The track this wedge buys, or `null` for a navigation wedge (WEAPON, BACK). */
  readonly track: UpgradeTrack | null;
  readonly label: string;
  /** Current tier, 0 = stock. `0` on a navigation wedge. */
  readonly tier: number;
  /** Highest tier the ladder offers. `0` on a navigation wedge. */
  readonly maxTier: number;
  /** Current value, formatted (e.g. `"10"`, `"100%"`). Empty on a nav wedge. */
  readonly current: string;
  /** Next tier's value, formatted — `null` at max tier or on a nav wedge. */
  readonly next: string | null;
  /** Ore cost of the next tier — `null` at max tier and on a nav wedge, the one
   *  number on the wedge besides the tier values (style-guide §2: cost is the
   *  only yellow). */
  readonly cost: number | null;
  readonly state: UpgradeWedgeState;
  /** The WEAPON wedge's tier summary (one pip row per weapon track), or `null` on
   *  every other wedge. Drives the at-a-glance pips (RATIFIED v0.2.2, item 3). */
  readonly summary: readonly UpgradeSummaryPip[] | null;
  /** Centre angle on the wheel, radians, y-down (`-π/2` = twelve o'clock). */
  readonly angle: number;
}

/** The upgrade wheel for one frame. */
export interface UpgradeWheelModel {
  /** Open only when the player chose UPGRADE SHIP on an open Build wheel — this
   *  wheel lives behind that arrow and nowhere else (GDD §2.5). */
  readonly open: boolean;
  /** The weapon sub-wheel is drilled into (WEAPON pressed). The wedges then are
   *  the weapon-group tracks plus a BACK wedge, not the main-wheel set. */
  readonly weaponOpen: boolean;
  /** The hull being upgraded (GDD §2.11 — locked at the lobby for the match). */
  readonly shipClass: ShipClass;
  /** Player-facing hull name for the wheel's hub heading. */
  readonly className: string;
  /** Live ore total, the same number the Build wheel's hub shows. */
  readonly ore: number;
  /** One wedge per slot on the current level, clockwise from twelve o'clock. */
  readonly wedges: readonly UpgradeWedge[];
}

/** What the upgrade wheel needs for one frame. */
export interface UpgradeWheelSignals {
  /** The player pressed UPGRADE SHIP on an open Build wheel. */
  readonly open: boolean;
  /** The weapon sub-wheel is drilled into (the WEAPON wedge was pressed). */
  readonly weaponOpen: boolean;
  readonly shipClass: ShipClass;
  /** Tiers already bought, per track. */
  readonly tiers: UpgradeTiers;
  /** Ore a purchase can draw on — hold plus bank (the Build wheel's
   *  `spendableOre`), so the two wheels agree on what is affordable. */
  readonly ore: number;
}

// ---------------------------------------------------------------------------
// Two-level layout — main wheel + the nested WEAPON sub-wheel (RATIFIED v0.2.2)
// ---------------------------------------------------------------------------

/** One position on the current wheel level: a stat track, or a navigation wedge
 *  (WEAPON opens the sub-wheel, BACK returns). Exported so the input layer can
 *  map a pressed row to the same action the drawn wedge represents, without
 *  re-deriving the level's shape. */
export type UpgradeSlot =
  | { readonly kind: 'track'; readonly track: UpgradeTrack }
  | { readonly kind: 'weapon' }
  | { readonly kind: 'back' };

/**
 * The slots on the current wheel level, clockwise from twelve o'clock. The main
 * wheel (`weaponOpen === false`) shows the non-weapon tracks with the contiguous
 * weapon run collapsed into one WEAPON wedge at the run's position; the weapon
 * sub-wheel (`weaponOpen === true`) shows the weapon-group tracks followed by a
 * BACK wedge. Both are derived from `order`, so grouping is data, not layout.
 */
export function upgradeWheelSlots(
  weaponOpen: boolean,
  ladder: UpgradeLadder = UPGRADE_LADDER,
  order: readonly UpgradeTrack[] = UPGRADE_WHEEL_ORDER,
): readonly UpgradeSlot[] {
  const isWeapon = (track: UpgradeTrack): boolean => ladder[track].group === WEAPON_GROUP;

  if (weaponOpen) {
    const slots: UpgradeSlot[] = order
      .filter(isWeapon)
      .map((track) => ({ kind: 'track', track }) as const);
    slots.push({ kind: 'back' });
    return slots;
  }

  const slots: UpgradeSlot[] = [];
  let weaponPlaced = false;
  for (const track of order) {
    if (isWeapon(track)) {
      // Collapse the whole (contiguous) weapon run into one WEAPON wedge, drawn
      // at the position of the run's first member.
      if (!weaponPlaced) {
        slots.push({ kind: 'weapon' });
        weaponPlaced = true;
      }
      continue;
    }
    slots.push({ kind: 'track', track });
  }
  return slots;
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/**
 * Build the upgrade wheel. Every track wedge is present at every tier, including
 * maxed ones: this screen is where a player finds out ship stats exist at all, so
 * a finished track still shows what it finished at. The wedge count comes from the
 * current level's {@link upgradeWheelSlots}, so a ladder that grows grows the
 * wheel with no code change here.
 */
export function upgradeWheelModel(
  signals: UpgradeWheelSignals,
  ladder: UpgradeLadder = UPGRADE_LADDER,
  order: readonly UpgradeTrack[] = UPGRADE_WHEEL_ORDER,
): UpgradeWheelModel {
  const slots = upgradeWheelSlots(signals.weaponOpen, ladder, order);
  const count = slots.length;
  const wedges = slots.map((slot, index) =>
    slotWedge(signals, ladder, order, slot, upgradeWedgeAngle(index, count)),
  );
  return {
    open: signals.open,
    weaponOpen: signals.weaponOpen,
    shipClass: signals.shipClass,
    className: CLASS_NAMES[signals.shipClass],
    ore: Math.floor(Math.max(0, signals.ore)),
    wedges,
  };
}

/** One wedge for a slot: a stat track, the WEAPON navigation wedge, or BACK. */
function slotWedge(
  signals: UpgradeWheelSignals,
  ladder: UpgradeLadder,
  order: readonly UpgradeTrack[],
  slot: UpgradeSlot,
  angle: number,
): UpgradeWedge {
  if (slot.kind === 'weapon') return weaponWedge(signals, ladder, order, angle);
  if (slot.kind === 'back') return backWedge(angle);
  return upgradeWedge(signals, ladder[slot.track], angle);
}

/** The WEAPON navigation wedge — opens the sub-wheel and summarises its tracks as
 *  pips so the main wheel still communicates the weapon tiers at a glance. */
function weaponWedge(
  signals: UpgradeWheelSignals,
  ladder: UpgradeLadder,
  order: readonly UpgradeTrack[],
  angle: number,
): UpgradeWedge {
  return {
    kind: 'weapon',
    track: null,
    label: 'WEAPON',
    tier: 0,
    maxTier: 0,
    current: '',
    next: null,
    cost: null,
    // Opening a screen is always available — a broke player still deserves to see
    // the weapon tracks exist (same rule as the Build wheel's UPGRADE SHIP).
    state: 'ready',
    summary: weaponSummary(signals, ladder, order),
    angle,
  };
}

/** The sub-wheel's BACK wedge — returns to the main wheel, buys nothing. */
function backWedge(angle: number): UpgradeWedge {
  return {
    kind: 'back',
    track: null,
    label: 'BACK',
    tier: 0,
    maxTier: 0,
    current: '',
    next: null,
    cost: null,
    state: 'ready',
    summary: null,
    angle,
  };
}

/** Current tier / max per weapon-group track, in wheel order — the WEAPON wedge's
 *  at-a-glance pip rows (RATIFIED v0.2.2, item 3). */
export function weaponSummary(
  signals: UpgradeWheelSignals,
  ladder: UpgradeLadder = UPGRADE_LADDER,
  order: readonly UpgradeTrack[] = UPGRADE_WHEEL_ORDER,
): readonly UpgradeSummaryPip[] {
  return order
    .filter((track) => ladder[track].group === WEAPON_GROUP)
    .map((track) => {
      const spec = ladder[track];
      const maxTier = spec.steps.length - 1;
      const tier = Math.max(0, Math.min(Math.floor(signals.tiers[track] ?? 0), maxTier));
      return { track, label: spec.label, tier, maxTier };
    });
}

/** One stat-track wedge: current → next → cost, plus whether it can be bought and
 *  why (GDD §2.5). `angle` is where it sits on the wheel. */
export function upgradeWedge(
  signals: UpgradeWheelSignals,
  spec: UpgradeTrackSpec,
  angle: number,
): UpgradeWedge {
  const maxTier = spec.steps.length - 1;
  const tier = Math.max(0, Math.min(Math.floor(signals.tiers[spec.track] ?? 0), maxTier));
  const current = formatTrackValue(trackValue(signals.shipClass, spec, tier), spec.format);

  if (tier >= maxTier) {
    return {
      kind: 'track',
      track: spec.track,
      label: spec.label,
      tier,
      maxTier,
      current,
      next: null,
      cost: null,
      state: 'maxed',
      summary: null,
      angle,
    };
  }

  const cost = spec.costs[tier] ?? null;
  const next = formatTrackValue(trackValue(signals.shipClass, spec, tier + 1), spec.format);
  return {
    kind: 'track',
    track: spec.track,
    label: spec.label,
    tier,
    maxTier,
    current,
    next,
    cost,
    state: cost !== null && affordable(signals.ore, cost) ? 'ready' : 'unaffordable',
    summary: null,
    angle,
  };
}
