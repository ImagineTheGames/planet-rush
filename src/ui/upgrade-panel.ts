/**
 * src/ui/upgrade-panel.ts — the ship upgrade panel. OWNER: UI Engineer.
 *
 * The second screen behind the wheel's UPGRADE SHIP arrow (GDD §2.5), and **the
 * only place ship stats are ever shown**:
 *
 * > Ship stats — beam, engine, cargo, hull tiers — are deliberately *not* on the
 * > HUD. They appear only in the upgrade panel, where they are a spending
 * > decision rather than clutter. (GDD §2.2, §2.5)
 *
 * Each row gives **current value → next tier → ore cost** (GDD §2.5), so
 * upgrading is an explicit trade against turrets, shields and repair. Upgrades
 * *multiply* the class base stats (GDD §2.5, §2.11), so a maxed Interceptor is
 * still the fastest thing on the map and a maxed Hauler still the toughest —
 * which is why the ladder below is expressed as multipliers over
 * `SHIP_STATS[class]` rather than as absolute numbers per class.
 *
 * Pure and DOM-free: it derives rows from the class table (`../sim/constants`)
 * plus the ladder, so it unit-tests headless and the Pixi view only draws what
 * it returns.
 *
 * ---------------------------------------------------------------------------
 * PROVISIONAL LADDER — read this before tuning
 * ---------------------------------------------------------------------------
 * Ship upgrades are not yet simulated: `Ship` carries no per-track tier, and
 * `placeOrder` has no `upgrade` item (see `@shared/types` — UPGRADE SHIP is
 * deliberately not a `BuildItem`, because it opens a screen instead of
 * spending). So the tier ladder below is the **UI's own opening hypothesis**,
 * written in the shape of GDD §2.5's rules — cargo "+2 per tier, cap 8",
 * "escalating cost", "first tier cheap" (§2.8) — and flagged the same way the
 * sim's constants table is: a hypothesis for QA to falsify, not a fact.
 *
 * {@link upgradePanelModel} takes the ladder as a parameter for exactly this
 * reason: the day the Gameplay Engineer lands real upgrade tiers, the wiring
 * passes theirs and **no UI code changes**.
 */

import { ShipClass } from '@shared/types';
import { CARGO_CAP_MAX, CARGO_PER_TIER, SHIP_STATS } from '../sim/constants';

// ---------------------------------------------------------------------------
// The four upgrade tracks (GDD §2.5)
// ---------------------------------------------------------------------------

/**
 * The four things ore can buy on a ship (GDD §2.5). `beam` is deliberately one
 * track and not two: mining speed and weapon damage are **one beam, one stat**,
 * which is the inversion the whole game turns on.
 */
export enum UpgradeTrack {
  Beam = 'beam',
  Engine = 'engine',
  Cargo = 'cargo',
  Hull = 'hull',
}

/** Iteration order of the panel's rows, top to bottom. Beam leads because it is
 *  the stat that pays for itself twice (mine faster *and* hit harder). */
export const TRACK_ORDER: readonly UpgradeTrack[] = [
  UpgradeTrack.Beam,
  UpgradeTrack.Engine,
  UpgradeTrack.Cargo,
  UpgradeTrack.Hull,
];

/** The player's tier on each track, 0 = stock hull. Upgrades persist through
 *  respawn (GDD §2.5), so this is match-lifetime state, not ship-lifetime. */
export type UpgradeTiers = Readonly<Record<UpgradeTrack, number>>;

/** A fresh, un-upgraded ship. */
export const STOCK_TIERS: UpgradeTiers = {
  [UpgradeTrack.Beam]: 0,
  [UpgradeTrack.Engine]: 0,
  [UpgradeTrack.Cargo]: 0,
  [UpgradeTrack.Hull]: 0,
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
}

/** A full ladder: one spec per track. */
export type UpgradeLadder = Readonly<Record<UpgradeTrack, UpgradeTrackSpec>>;

/**
 * The provisional ladder (see the module header). Three buyable tiers per
 * track, costs escalating and the first tier cheap (GDD §2.5, §2.8).
 * Every number here is TUNABLE and hands over to QA with the constants table.
 */
export const UPGRADE_LADDER: UpgradeLadder = {
  // Beam: mining speed *and* weapon damage — one stat (GDD §2.5). Multiplies
  // the class beam, so the Excavator stays the mining engine at every tier.
  [UpgradeTrack.Beam]: {
    track: UpgradeTrack.Beam,
    label: 'BEAM',
    steps: [1, 1.25, 1.5, 1.8],
    costs: [4, 8, 14], // TUNABLE
    mode: 'multiply',
    format: 'integer',
    max: null,
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
    case UpgradeTrack.Beam:
      return stats.beam;
    case UpgradeTrack.Engine:
      return stats.speedMul * 100;
    case UpgradeTrack.Cargo:
      return stats.cargo;
    case UpgradeTrack.Hull:
      return stats.hull;
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
// The model
// ---------------------------------------------------------------------------

/** Whether a row can be bought right now. `maxed` is a finished ladder — the
 *  row still shows its current value, because this is where stats live. */
export type UpgradeRowState = 'ready' | 'unaffordable' | 'maxed';

/**
 * One panel row: **current value → next tier → ore cost** (GDD §2.5). Values
 * are pre-formatted strings so the view prints them and computes nothing —
 * the numbers on this screen are the whole point, and they are decided here.
 */
export interface UpgradeRow {
  readonly track: UpgradeTrack;
  readonly label: string;
  /** Current tier, 0 = stock. */
  readonly tier: number;
  /** Highest tier the ladder offers. */
  readonly maxTier: number;
  /** Current value, formatted (e.g. `"10"`, `"100%"`). */
  readonly current: string;
  /** Next tier's value, formatted — `null` at max tier. */
  readonly next: string | null;
  /** Ore cost of the next tier — `null` at max tier. */
  readonly cost: number | null;
  readonly state: UpgradeRowState;
}

/** The panel for one frame. */
export interface UpgradePanelModel {
  /** Open only when the player chose UPGRADE SHIP on an open wheel — the panel
   *  lives behind the wheel's arrow and nowhere else (GDD §2.5). */
  readonly open: boolean;
  /** The hull being upgraded (GDD §2.11 — locked at the lobby for the match). */
  readonly shipClass: ShipClass;
  /** Player-facing hull name for the panel heading. */
  readonly className: string;
  /** Live ore total, the same number the wheel's hub shows. */
  readonly ore: number;
  readonly rows: readonly UpgradeRow[];
}

/** What the panel needs for one frame. */
export interface UpgradePanelSignals {
  /** The player pressed UPGRADE SHIP on an open wheel. */
  readonly open: boolean;
  readonly shipClass: ShipClass;
  /** Tiers already bought, per track. */
  readonly tiers: UpgradeTiers;
  /** Ore a purchase can draw on — hold plus bank (the wheel's `spendableOre`). */
  readonly ore: number;
}

/**
 * Build the panel. Every row is present at every tier, including maxed ones:
 * this screen is where a player finds out ship stats exist at all, so a
 * finished track still shows what it finished at.
 */
export function upgradePanelModel(
  signals: UpgradePanelSignals,
  ladder: UpgradeLadder = UPGRADE_LADDER,
): UpgradePanelModel {
  const rows = TRACK_ORDER.map((track) => upgradeRow(signals, ladder[track]));
  return {
    open: signals.open,
    shipClass: signals.shipClass,
    className: CLASS_NAMES[signals.shipClass],
    ore: Math.floor(Math.max(0, signals.ore)),
    rows,
  };
}

/** One row: current → next → cost, plus whether it can be bought (GDD §2.5). */
export function upgradeRow(signals: UpgradePanelSignals, spec: UpgradeTrackSpec): UpgradeRow {
  const maxTier = spec.steps.length - 1;
  const tier = Math.max(0, Math.min(Math.floor(signals.tiers[spec.track] ?? 0), maxTier));
  const current = formatTrackValue(trackValue(signals.shipClass, spec, tier), spec.format);

  if (tier >= maxTier) {
    return {
      track: spec.track,
      label: spec.label,
      tier,
      maxTier,
      current,
      next: null,
      cost: null,
      state: 'maxed',
    };
  }

  const cost = spec.costs[tier] ?? null;
  const next = formatTrackValue(trackValue(signals.shipClass, spec, tier + 1), spec.format);
  return {
    track: spec.track,
    label: spec.label,
    tier,
    maxTier,
    current,
    next,
    cost,
    state: cost !== null && signals.ore + 1e-9 >= cost ? 'ready' : 'unaffordable',
  };
}
