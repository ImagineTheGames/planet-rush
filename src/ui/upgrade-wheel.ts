/**
 * src/ui/upgrade-wheel.ts — the ship upgrade WHEEL. OWNER: UI Engineer.
 *
 * The second screen behind the Build wheel's UPGRADE SHIP arrow (GDD §2.5), and
 * **the place ship stats are shown during a match**:
 *
 * > Ship stats — power, engine, cargo, hull tiers — are deliberately *not* on the
 * > HUD. They appear only in the upgrade screen, where they are a spending
 * > decision rather than clutter. (GDD §2.2, §2.5)
 *
 * This header used to say "the ONLY place ship stats are ever shown", quoting a
 * sentence GDD §2.5 no longer contains. It was amended 2026-08-05: asked whether
 * ship stats could appear on the lobby's ship-select screen, the developer
 * answered ***"both pips and numbers"***, so there are **two** screens now, and
 * they answer different questions — ship-select is a *comparison* made once,
 * before the match; this wheel is a *spending decision* made repeatedly during
 * it, against turrets and repair. Stats on ship-select (u4-01) are ratified and
 * are not a violation of anything. What is unchanged is that stats are not on
 * the **HUD**, and that this screen is the detailed one.
 *
 * ── WHY THIS IS A WHEEL AND NOT A PANEL (the field report) ──────────────────
 * A developer reported the upgrade screen *"is not immediately readable, and
 * it's very different from the station's wheel menu — it should be a wheel menu as
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
 * ── WHAT A WEDGE SAYS, SINCE THE GANTRY/BONE PASS (u7-06) ───────────────────
 * The upgrade wheel is the same radial control as the Build wheel, so it takes
 * the Build wheel's own four-slot stack (u7-02, `./wheel-stack`) rather than a
 * parallel one, and this module produces three of the four lines:
 *
 *   ENGINE            ← the words                  (label)
 *   111% → 123%       ← the stat this tier moves    ({@link UpgradeWedge.statLabel})
 *   12/8              ← cost over spendable ore     ({@link UpgradeWedge.costLabel})
 *   ●●○               ← where the track sits on its ladder ({@link UpgradeWedge.tierLabel})
 *
 * All three are **strings**, never numbers, and that is deliberate rather than
 * incidental: the wedge's only *numeric* fields stay `cost`, `tier`, `maxTier`
 * and `angle`, so nothing merely printed here can be mistaken for something
 * spendable. It is the same door the Build wheel's `cost/held` and `2 / 4 BUILT`
 * lines ship through.
 *
 * Two of them are new, and both are the Build wheel's answer rather than a new
 * one. `cost/held` is that wheel's grammar for "what it costs, over what you
 * hold" — the wedge that dims stops being a mystery, because the numbers already
 * say why. The pips are the summary this wheel already drew on its WEAPON wedge,
 * extended to every track: "how many rungs are left" is half of a comparison
 * between two upgrades, and this screen is where that comparison is made.
 *
 * ── DATA-DRIVEN OFF THE LADDER (so new tracks appear for free) ──────────────
 * {@link upgradeWheelModel} builds one wedge per entry in the ladder's track
 * order and takes the ladder as a parameter. That is the load-bearing bit: the
 * day p2-03's projectile tracks (speed / damage) land as new rungs on the ladder,
 * they become wedges here with **no change to this file or the view** — the wheel
 * lays out however many wedges the ladder has and prints whatever numbers it
 * carries. Those numbers are not copied out of the sim's ratified `UPGRADES`
 * table any more; they *are* it ({@link UPGRADE_LADDER}), so what a player is
 * shown cannot drift from what they are sold.
 */

import { ShipClass } from '@shared/types';
import { CARGO_CAP_MAX, SHIP_STATS, UPGRADES } from '../sim/constants';
import { affordable } from './affordability';
import { hubBack } from './wheel-nav';
import type { HubBack } from './wheel-nav';

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

/** The sim's `unit` string that means "print this as a percentage of the base".
 *  Named rather than inlined so the mapping from a sim unit to a UI format is a
 *  thing a reader can find, not a bare `'%'` in a ternary. */
const PERCENT_UNIT = '%';

/**
 * The ladder, **derived from the sim** (u7-06).
 *
 * Every number a player is *sold* on — the step a tier moves the stat by, what
 * it costs, the ceiling it clamps to — and the words on the wedge come straight
 * out of the sim's ratified `UPGRADES` table (`../sim/constants`). There is
 * exactly one copy of them in the repo, and it is the one `buyUpgrade` charges
 * against.
 *
 * This file used to re-type all of it and assert in a comment that the numbers
 * "match the sim's ratified UPGRADES table". They did — and nothing checked it.
 * Two hand-kept copies of one table is exactly how the `UpgradeTrack` enum
 * copies drifted until typechecking caught them (#108), and the brief for this
 * screen is blunt about the stakes: **the wheel can never print a price the sim
 * does not honour.** So it no longer holds a price of its own to drift from.
 *
 * The sim already owns `label` for this reason too ("the UI's upgrade wheel
 * prints this, so a rename is a data edit here, never UI code" — `constants.ts`)
 * and `group`, which decides whether a track is drawn on the main wheel or
 * inside the WEAPON sub-wheel. The one thing left for this file to decide is
 * {@link TrackFormat}: how a value is *printed*, which is typography rather than
 * balance — and even that is read off the sim's `unit`, so a track that starts
 * reporting a percentage starts printing one.
 */
export const UPGRADE_LADDER: UpgradeLadder = Object.fromEntries(
  (Object.values(UpgradeTrack) as UpgradeTrack[]).map((track) => [track, ladderSpec(track)]),
) as UpgradeLadder;

/**
 * One track's ladder, from the sim's own spec.
 *
 * `mode`, `steps`, `costs` and `max` are passed through untouched — the wheel
 * prints the sim's arithmetic or it prints a lie. `format` is the only thing
 * decided here, and it is decided from the sim's `unit`: a track measured in
 * `'%'` (ENGINE's top speed, SPEED's muzzle velocity) prints as a percentage of
 * its base, and everything else — DAMAGE's `/hit`, CARGO's slots, HULL's
 * absolute HP — prints as a bare integer.
 */
function ladderSpec(track: UpgradeTrack): UpgradeTrackSpec {
  const sim = UPGRADES[track];
  return {
    track,
    // DAMAGE, not POWER (v0.2.2 field report): the wedge means one thing to a
    // player — how hard each shot bites. The enum key stays `Power` for wire and
    // replay stability (see @shared/types); the words come from the sim's label.
    label: sim.label,
    steps: sim.steps,
    costs: sim.costs,
    mode: sim.mode,
    format: sim.unit === PERCENT_UNIT ? 'percent' : 'integer',
    // CARGO's hard ceiling of 8 (GDD §2.8) rides here, on the sim's table, so the
    // wheel clamps to the same number `buyUpgrade` refuses past.
    max: sim.max ?? (track === UpgradeTrack.Cargo ? CARGO_CAP_MAX : null),
    ...(sim.group === undefined ? {} : { group: sim.group }),
  };
}

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
// The wedge's own lines — strings, so `cost` stays the only number (u7-06)
// ---------------------------------------------------------------------------
//
// Everything below composes a line a wedge draws. All of it returns strings, and
// that is the same discipline the Build wheel's `cost/held` and `2 / 4 BUILT`
// lines were built with (u7-02, `./build-wheel`): a wedge shows several numbers
// and carries exactly one *numeric field*, so nothing that is merely printed can
// be mistaken by a caller for something spendable.

/** The arrow between a track's current value and what the next tier buys. One
 *  glyph, stated once, so the full and compact forms cannot drift apart. */
export const STAT_ARROW = '→';

/** The word a finished ladder's cost slot carries instead of a price — the
 *  upgrade wheel's `FULL`. There is nothing left to buy, so there is no price to
 *  quote (the Build wheel's answer for a capped wedge, in this wheel's noun). */
export const MAXED_COST = 'MAX';

/**
 * The stat line: `"111% → 123%"`, or the bare current value once the ladder is
 * finished (the `MAX` is said in the cost slot, where the Build wheel says
 * `FULL`, rather than twice).
 *
 * `compact` drops the padding around the arrow and nothing else — `"111%→123%"`
 * — for the phone profile, the same move `capBuiltLabelCompact` makes on the
 * Build wheel. Both values survive it; only the spaces go.
 */
export function statLabelOf(current: string, next: string | null, compact = false): string {
  if (next === null) return current;
  return compact ? `${current}${STAT_ARROW}${next}` : `${current} ${STAT_ARROW} ${next}`;
}

/**
 * The cost line: `cost/held` — what the next tier costs over the ore the player
 * can actually spend. A finished ladder has no price to quote and takes
 * {@link MAXED_COST} instead.
 *
 * `held` is floored, because it is the same number the hub prints and the hub
 * floors it (`upgradeWheelModel`): a wheel that quoted `12/7.6` in one place and
 * `7` in the other would be disagreeing with itself about the player's wallet.
 */
export function costLabelOf(cost: number, ore: number): string {
  return `${cost}/${Math.floor(Math.max(0, ore))}`;
}

/** Filled-vs-empty pips for a position on a ladder: `"●●○"` at tier 2 of 3.
 *  Glyphs rather than a count, so the row spends no colour and adds no numeral —
 *  the language the WEAPON wedge's summary has spoken since v0.2.2, now on every
 *  track wedge. */
export function tierPips(tier: number, maxTier: number): string {
  const filled = Math.max(0, Math.min(tier, maxTier));
  return '●'.repeat(filled) + '○'.repeat(Math.max(0, maxTier - filled));
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
 * The nav wedge buys nothing, so it carries no cost and no stat value.
 *
 * There is no longer a `back` wedge: BACK moved to the hub, the single consistent
 * spot every wheel level shares (field report v0.2.4 — {@link ./wheel-nav}). The
 * sub-wheel's home is a hub tap now, not a wedge, so the weapon sub-wheel is just
 * its two weapon tracks.
 */
export type UpgradeWedgeKind = 'track' | 'weapon';

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
  /**
   * The **stat line** as the wedge draws it: `"111% → 123%"`, or just the current
   * value on a finished ladder. This is the densest text on any wheel in the game
   * and the reason this screen exists (GDD §2.5 — the one place ship stats
   * appear), so it is decided here rather than assembled in the view.
   *
   * A **string**, and that is load-bearing rather than incidental: {@link current}
   * and {@link next} stay exactly what they were, and the composed line ships
   * through the same door the Build wheel's `cost/held` and `2 / 4 BUILT` lines
   * use (`./build-wheel`, u7-02). No second numeric field is added to a wedge, so
   * no rate or stat can leak into one. `''` on the WEAPON wedge, whose stat line
   * is its pip rows.
   */
  readonly statLabel: string;
  /**
   * {@link statLabel} with the padding around the arrow gone — `"111%→123%"` —
   * for the phone profile's narrower arc, exactly the move the Build wheel makes
   * from `"2 / 4 BUILT"` to `"2/4 BUILT"`. Nothing is dropped: both values are
   * still there, said in fewer characters.
   */
  readonly statLabelCompact: string;
  /**
   * The cost line, in the Build wheel's own grammar (u7-02): **`cost/held`** —
   * what the next tier costs over what the player can actually spend (`"12/8"`),
   * or `"MAX"` on a finished ladder, where there is no price to quote because
   * there is nothing left to buy. `null` on the WEAPON wedge, which opens a
   * screen rather than spending.
   *
   * A string, for the same reason the Build wheel's is; {@link cost} stays the
   * single numeric truth underneath it. The second half is not new information —
   * it is the same spendable total the hub already prints, restated at the point
   * of decision, so a player looking at a red `12/8` knows they are four ore
   * short without the wheel having to say so in words.
   */
  readonly costLabel: string | null;
  /**
   * Where this track sits on its ladder, as filled-vs-empty pips: `"●●○"` at
   * tier 2 of 3. `''` on the WEAPON wedge, which carries a pip row per weapon
   * track instead ({@link summary}).
   *
   * The wheel already spoke this language — it is exactly the summary the WEAPON
   * wedge has shown since v0.2.2 — but only behind that one wedge, so a player
   * could see how many DAMAGE rungs were left and not how many ENGINE ones were.
   * "How much of this ladder is left" is half of a comparison between two
   * upgrades, and this screen is where that comparison is made. Glyphs, not
   * numerals: no colour is spent and no numeric field is added.
   */
  readonly tierLabel: string;
  /** Centre angle on the wheel, radians, y-down (`-π/2` = twelve o'clock). */
  readonly angle: number;
}

/** The upgrade wheel for one frame. */
export interface UpgradeWheelModel {
  /** Open only when the player chose UPGRADE SHIP on an open Build wheel — this
   *  wheel lives behind that arrow and nowhere else (GDD §2.5). */
  readonly open: boolean;
  /** The weapon sub-wheel is drilled into (WEAPON pressed). The wedges then are
   *  the weapon-group tracks, not the main-wheel set; its way back is the hub
   *  (field report v0.2.4), not a wedge. */
  readonly weaponOpen: boolean;
  /** The hull being upgraded (GDD §2.11 — locked at the lobby for the match). */
  readonly shipClass: ShipClass;
  /** Player-facing hull name for the wheel's hub heading. */
  readonly className: string;
  /** Live ore total, the same number the Build wheel's hub shows. */
  readonly ore: number;
  /** One wedge per slot on the current level, clockwise from twelve o'clock. */
  readonly wedges: readonly UpgradeWedge[];
  /**
   * The hub's BACK affordance (field report v0.2.4). This wheel sits *behind* the
   * Build wheel, so its hub says `BACK` and a hub tap / ESC pops one level — the
   * WEAPON sub-wheel back to the main upgrade wheel, and the main upgrade wheel
   * back to the Build wheel ({@link ./wheel-nav}). `null` while this wheel is not
   * up (there is no hub to press).
   */
  readonly hubBack: HubBack | null;
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

/** One position on the current wheel level: a stat track, or the WEAPON wedge
 *  that opens the sub-wheel. Exported so the input layer can map a pressed row to
 *  the same action the drawn wedge represents, without re-deriving the level's
 *  shape. (BACK is not a slot any more — it lives on the hub, field report
 *  v0.2.4, {@link ./wheel-nav}.) */
export type UpgradeSlot =
  | { readonly kind: 'track'; readonly track: UpgradeTrack }
  | { readonly kind: 'weapon' };

/**
 * The slots on the current wheel level, clockwise from twelve o'clock. The main
 * wheel (`weaponOpen === false`) shows the non-weapon tracks with the contiguous
 * weapon run collapsed into one WEAPON wedge at the run's position; the weapon
 * sub-wheel (`weaponOpen === true`) shows just the weapon-group tracks — its way
 * back to the main wheel is the hub, not a wedge (field report v0.2.4). Both are
 * derived from `order`, so grouping is data, not layout.
 */
export function upgradeWheelSlots(
  weaponOpen: boolean,
  ladder: UpgradeLadder = UPGRADE_LADDER,
  order: readonly UpgradeTrack[] = UPGRADE_WHEEL_ORDER,
): readonly UpgradeSlot[] {
  const isWeapon = (track: UpgradeTrack): boolean => ladder[track].group === WEAPON_GROUP;

  if (weaponOpen) {
    return order.filter(isWeapon).map((track) => ({ kind: 'track', track }) as const);
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
    // The hub is the BACK affordance (field report v0.2.4). This wheel is never
    // the top level — it lives behind the Build wheel's arrow — so its back POPS
    // a level: WEAPON → upgrade, upgrade → Build. `null` while shut.
    hubBack: signals.open ? hubBack(signals.weaponOpen ? 'weapon' : 'upgrade') : null,
  };
}

/** One wedge for a slot: a stat track, or the WEAPON navigation wedge (BACK now
 *  lives on the hub, not a wedge — field report v0.2.4). */
function slotWedge(
  signals: UpgradeWheelSignals,
  ladder: UpgradeLadder,
  order: readonly UpgradeTrack[],
  slot: UpgradeSlot,
  angle: number,
): UpgradeWedge {
  if (slot.kind === 'weapon') return weaponWedge(signals, ladder, order, angle);
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
    // This wedge's stat line IS its pip rows, one per weapon track, so it has no
    // single current→next value of its own; and it opens a screen rather than
    // spending, so it quotes no price and has no ladder position to pip.
    statLabel: '',
    statLabelCompact: '',
    costLabel: null,
    tierLabel: '',
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
      // A finished ladder keeps showing what it finished AT — this is the screen
      // where a player finds out ship stats exist — and says MAX once, in the cost
      // slot, where a capped Build-wheel wedge says FULL.
      statLabel: statLabelOf(current, null),
      statLabelCompact: statLabelOf(current, null, true),
      costLabel: MAXED_COST,
      tierLabel: tierPips(tier, maxTier),
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
    statLabel: statLabelOf(current, next),
    statLabelCompact: statLabelOf(current, next, true),
    // A ladder rung with no price in its `costs` array is malformed rather than
    // finished, and it is already refused by the `unaffordable` state above — so
    // it quotes nothing rather than claiming to be MAX.
    costLabel: cost === null ? null : costLabelOf(cost, signals.ore),
    tierLabel: tierPips(tier, maxTier),
    angle,
  };
}
