/**
 * src/ui/build-wheel.ts — the Build & Upgrade wheel model. OWNER: UI Engineer.
 *
 * "Everything is bought from one place" (GDD §2.5). **Five segments**, each
 * labeled in words and each naming its target — TURRET, SHIELD, RADAR, REPAIR
 * REACTOR, UPGRADE SHIP — with the player's live ore total in the hub. Four spend
 * on the **station**, one on the **ship**; the economy is the choice between
 * those two, so every label names which.
 *
 * There is no manual "bank" segment: ore auto-deposits the instant a ship enters
 * its own station's atmosphere (p4-11), so a deposit verb on the wheel would name
 * an action the player never has to take. The atmosphere does the banking; the
 * wheel is purely for *spending* the safe total.
 *
 * The rule this file exists to enforce:
 *
 * > **The only number on a segment is its cost.** No rates, no HP-per-ore, no
 * > effect text — a bare "3" under TURRET, a bare "1" under REPAIR CORE.
 *
 * So a {@link WheelSegment} carries a `label`, a `target`, a `cost`, and a
 * *state* — and no other number. The wheel says what a thing costs and what it
 * acts on; the game teaches what it's worth. **UPGRADE SHIP** carries an arrow
 * instead of a number ({@link WheelSegment.opensPanel}): it is the one segment
 * that opens a second screen, the upgrade wheel ({@link ./upgrade-wheel}), which
 * is the only place ship stats are ever shown.
 *
 * **The wheel opens at your own station, and only there** (GDD §2.5, §2.4 "E
 * (near own station)") — {@link buildWheelModel} returns `open: false` anywhere
 * else, so the view has one boolean to obey and the rule is unit-tested rather
 * than eyeballed.
 *
 * Pure and DOM-free so it unit-tests headless. Costs are read from the sim's
 * ratified constants table (`../sim/constants`) — the same numbers `placeOrder`
 * charges — so the wheel can never print a price the sim does not honour. The
 * *affordability* rule mirrors the sim's `spendableOre` (hold + bank), because a
 * segment that looks affordable and then refuses is worse than one that is
 * honestly dark.
 *
 * Style: cost numerals are signal yellow — "cost numerals on the build wheel"
 * are an explicitly allowed use of the RESERVED colour (style-guide §2).
 */

import type { BuildItem } from '@shared/types';
import { REPAIR_HP_PER_ORE, REPAIR_ORE_COST, SATELLITE, SHIELD, TURRET } from '../sim/constants';
import { affordable } from './affordability';
import { hubBack } from './wheel-nav';
import type { HubBack } from './wheel-nav';

// ---------------------------------------------------------------------------
// Segment identity
// ---------------------------------------------------------------------------

/**
 * The {@link BuildItem}s the wheel deliberately does **not** show — the ONE
 * sanctioned reason a player-buildable sim item has no wedge, each entry named
 * against the authority that ratified the cut. Every other `BuildItem` gets a
 * segment ({@link buildWheelModel}), and the guard test (build-wheel.test.ts)
 * fails the build if a `BuildItem` is neither shown nor listed here.
 *
 * This list exists because a bare `Exclude<>` is exactly how the RADAR wedge
 * vanished (p13 regression): `satellite` was swept out alongside `bank` when the
 * manual BANK segment was cut, and nothing noticed for four versions. A named
 * list with a guard means the next cut has to be added here, in the open, with a
 * name against it — it has to look the regression risk in the eye.
 *
 *  - `bank`  — ore auto-deposits the instant a ship enters its own station's
 *              atmosphere (p4-11), so a manual BANK verb names an action the
 *              player never has to take. Ratified: GDD §2.5 (the atmosphere does
 *              the banking; the wheel is purely for spending the safe total).
 */
export const WHEEL_EXCLUDED_ITEMS = ['bank'] as const;

/**
 * The wheel segments. Every {@link BuildItem} the sim spends on the spot EXCEPT
 * the ratified {@link WHEEL_EXCLUDED_ITEMS} (derived, so the type and the guard
 * share one source of truth and the two can never drift). `upgrade` is added on
 * top and is deliberately *not* a `BuildItem` — it opens the upgrade panel
 * rather than placing an order, which is exactly why the shared contract does
 * not include it.
 *
 * `satellite` is the ratified radar-satellite build order (feature f1): a
 * buildable body that orbits the station and lifts the minimap fog. It IS shown
 * — a fifth wedge — because the sim builds it and bots build it, so the player
 * must be able to as well (restoring the p13 regression).
 */
export type WheelSegmentId =
  | Exclude<BuildItem, (typeof WHEEL_EXCLUDED_ITEMS)[number]>
  | 'upgrade';

/** What a segment spends on: your station, or your ship (GDD §2.5 — "every label
 *  names which", because the economy *is* the choice between the two). */
export type SegmentTarget = 'station' | 'ship';

/**
 * Whether a segment can be pressed right now.
 *
 * - `ready`        — affordable, under cap, and it would do something.
 * - `unaffordable` — costs more ore than hold + bank hold (GDD §2.5).
 * - `capped`       — the per-station cap is reached: 4 turrets, 2 shields, 1
 *                    radar satellite (GDD §2.5 — "design rules, not renderer
 *                    limits"). Queued construction counts, so a player cannot buy
 *                    past the cap; the RADAR wedge also shows its "1/1" count.
 * - `inactive`     — the press would be a no-op: REPAIR CORE on a core that is
 *                    already full, after the collapse phase has shut repair off
 *                    for good (GDD §2.3), *or* while the station is still cooling
 *                    down from its last repair (the sim's `repairGate`, refused
 *                    `'cooling-down'`).
 *                    The sim distinguishes the three (`core-full`, `collapsed`,
 *                    `cooling-down`); the wheel does not at the *state* level,
 *                    because the player-facing answer is the same — this button
 *                    does nothing now — and the reason is carried by the wedge's
 *                    second line ({@link repairWedgeInfo}), which for a cooling
 *                    core is the live "REPAIR in Ns" countdown.
 */
export type SegmentState = 'ready' | 'unaffordable' | 'capped' | 'inactive';

// ---------------------------------------------------------------------------
// Costs — the only numbers on the wheel
// ---------------------------------------------------------------------------

/**
 * The ore printed under REPAIR CORE — bound to the sim's `REPAIR_ORE_COST` so the
 * wheel can never quote a price `placeOrder` won't honour. GDD §2.5 named "a bare
 * '1' under REPAIR CORE" when repair was a channel; the developer amendment
 * (2026-07-26) made it a **discrete purchase** — one tap spends this much ore and
 * restores {@link REPAIR_HP_PER_ORE} core HP, clamped at the max (see
 * `../sim/constants` and {@link repairWedgeInfo}).
 *
 * The old "the rate is the thing the wheel must never say" rule is superseded for
 * this one wedge (p5-08): a discrete purchase shows the HP it buys, so the
 * near-full tap is an informed choice. That number is copy on the wedge's second
 * line ({@link repairWedgeInfo}), never a numeric field on {@link WheelSegment} —
 * the "the only numeric field is `cost`" guarantee (build-wheel.test.ts) still
 * holds, so no rate can leak onto turret, shield or the upgrade arrow.
 */
export const REPAIR_ENTRY_ORE = REPAIR_ORE_COST;

/** Cost printed under a segment, or `null` where a segment has no price:
 *  UPGRADE SHIP prices its rows in the panel (GDD §2.5). */
export function segmentCost(id: WheelSegmentId): number | null {
  switch (id) {
    case 'turret':
      return TURRET.cost;
    case 'shield':
      return SHIELD.cost;
    case 'satellite':
      return SATELLITE.cost;
    case 'repair':
      return REPAIR_ENTRY_ORE;
    case 'upgrade':
      return null;
  }
}

// ---------------------------------------------------------------------------
// Layout — five segments, clockwise from twelve o'clock
// ---------------------------------------------------------------------------

/** Segment order around the wheel, clockwise from the top. The four
 *  build-at-the-station segments come first — TURRET, SHIELD, RADAR, REPAIR
 *  REACTOR — then UPGRADE SHIP, the one that spends on the ship and opens a
 *  screen. RADAR sits with its sibling station builds (feature f1 / p13). */
export const WHEEL_ORDER: readonly WheelSegmentId[] = [
  'turret',
  'shield',
  'satellite',
  'repair',
  'upgrade',
];

/** Angular width of one segment (radians). Five segments fill the circle. */
export const SEGMENT_ARC = (2 * Math.PI) / WHEEL_ORDER.length;

/** Screen-space angle of a segment's centre (radians, y-down: `-π/2` is up).
 *  Segment 0 sits at twelve o'clock and the rest run clockwise. */
export function segmentAngle(index: number): number {
  return -Math.PI / 2 + index * SEGMENT_ARC;
}

/**
 * The segment a stick/pointer direction selects. Device-agnostic on purpose:
 * a gamepad stick, a mouse vector from the hub, and a touch drag all hand this
 * the same `(dx, dy)` and get the same answer (GDD §2.4). A dead-centre
 * direction selects nothing — `null` — so releasing at the hub cancels rather
 * than buying whatever happened to be nearest.
 */
export function segmentAtDirection(dx: number, dy: number, deadzone = 0.25): WheelSegmentId | null {
  if (dx * dx + dy * dy < deadzone * deadzone) return null;
  // Angle measured from twelve o'clock, clockwise, normalised to [0, 2π).
  const fromTop = Math.atan2(dx, -dy);
  const norm = (fromTop + 2 * Math.PI) % (2 * Math.PI);
  const index = Math.floor((norm + SEGMENT_ARC / 2) / SEGMENT_ARC) % WHEEL_ORDER.length;
  return WHEEL_ORDER[index] ?? null;
}

// ---------------------------------------------------------------------------
// Per-frame inputs
// ---------------------------------------------------------------------------

/**
 * Everything the wheel needs for one frame, derived by the caller from the local
 * ship and its station. Deliberately plain data — no sim types, no Pixi — so the
 * model tests headless and the netcode path can feed it from a snapshot just as
 * easily as the local sim can.
 */
export interface BuildWheelSignals {
  /** The player is asking for the wheel (the `build` action, held). */
  readonly requested: boolean;
  /** The ship is inside `STATION.dockRange` of its **own** station — the sim's
   *  `isDocked`. The wheel opens at your own station and nowhere else. */
  readonly docked: boolean;
  /** The local ship is alive. */
  readonly shipAlive: boolean;
  /** The local player's station still has a core (GDD §2.7: a wreck buys nothing). */
  readonly stationAlive: boolean;
  /** Ore in the hold — spent first (sim `spendOre`: hold before bank). */
  readonly cargo: number;
  /** Banked ore — safe, and the second half of what a purchase can draw on. */
  readonly banked: number;
  /** Turrets standing **or under construction** (the sim's `turretCount`). */
  readonly turrets: number;
  /** Shields standing **or under construction** (the sim's `shieldCount`). */
  readonly shields: number;
  /**
   * Radar satellites standing **or under construction** (the sim's
   * `satelliteCount`). One per station (`SATELLITE.capPerStation`), so this is 0
   * or 1 in practice — the RADAR wedge shows it as "0/1" / "1/1" and disables at
   * the cap, re-arming when the satellite is shot down and the count drops.
   *
   * Optional and treated as `0` when absent, so a caller/fixture that predates the
   * radar wedge reads as "none built", the pre-f1 behaviour it had.
   */
  readonly satellites?: number;
  /** Current core HP — REPAIR CORE is inactive on a full core. */
  readonly coreHp: number;
  /** Max core HP. */
  readonly maxCoreHp: number;
  /**
   * The collapse phase has begun (the sim's `isCollapsed`). From here on "no
   * shield regeneration, no repair, no new ore" (GDD §2.3) — so REPAIR CORE is
   * dead for the rest of the match and the wheel must say so rather than
   * offering a channel `placeOrder` now answers `collapsed` to.
   *
   * Optional: a caller that predates the endgame reads as "not collapsed",
   * which is the pre-collapse behaviour it had.
   */
  readonly collapsed?: boolean;
  /**
   * Seconds left on the local station's repair COOLDOWN — the sim's
   * `station.repairGate`, read from SIM STATE each frame (no UI timer, the p4-17
   * rule). After a repair purchase the sim arms this to `REPAIR_COOLDOWN_SECONDS`
   * and refuses every further repair order `'cooling-down'` — spending nothing —
   * until it ticks to zero (`placeOrder` / `updateStations`). While it is `> 0`
   * the wedge must be disabled with a live "REPAIR in Ns" countdown, not a
   * pressable deal that silently does nothing (the field bug this signal fixes).
   *
   * Optional and treated as `0` when absent, so a caller that predates the
   * cooldown — or a hand-built fixture that never armed it — reads as "not
   * cooling", the pre-cooldown behaviour it had.
   */
  readonly repairGate?: number;
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/**
 * The REPAIR CORE wedge's second line, the one wedge allowed to name its effect
 * (p5-08 — repair is a discrete purchase now, so the deal must be legible before
 * the tap). `null` on every other segment, so no rate can leak elsewhere.
 *
 *  - **ready** — `"+15 HP"`, or the REAL partial (`"+7 HP"`) when the core is
 *    missing less than a full tap's worth, so the near-full tap is informed.
 *  - **disabled-with-reason** — `"CORE FULL"` (nothing to heal), `"NO REPAIR"`
 *    (collapse has shut repair off, GDD §2.3), the live `"REPAIR in Ns"` countdown
 *    (still cooling down from the last repair, the sim's `repairGate`), or
 *    `"NEED 1 ORE"` (empty bank).
 */
export interface RepairWedgeInfo {
  /** HP a single tap would restore right now — `min(perOre, missing)`, rounded
   *  for display. 0 when the core is full or repair is off. */
  readonly restoreHp: number;
  /** The second-line copy the wedge shows (see the states above). */
  readonly line: string;
}

/** One rendered segment. Words, a target, a cost, a state — and no other
 *  number (GDD §2.5, the rule this module enforces). */
export interface WheelSegment {
  readonly id: WheelSegmentId;
  /** The words on the segment. Named in full, never abbreviated. */
  readonly label: string;
  /** Station or ship — every label names which (GDD §2.5). */
  readonly target: SegmentTarget;
  /** The **only** number on the segment, or `null` where there is no price. */
  readonly cost: number | null;
  /** Whether it can be pressed, and if not, why (drives the dimmed state). */
  readonly state: SegmentState;
  /** True for UPGRADE SHIP: draw the arrow that marks "this opens a screen"
   *  (GDD §2.5). A player who doesn't know upgrades exist never looks for them. */
  readonly opensPanel: boolean;
  /** Centre angle on the wheel, radians, y-down (`-π/2` = twelve o'clock). */
  readonly angle: number;
  /** Repair-only effect/reason copy (p5-08), or `null` on every other segment.
   *  Not a numeric field — the "only `cost` is a number" guarantee is kept. */
  readonly repair: RepairWedgeInfo | null;
  /**
   * The u2-02 count/cap grammar — a string like `"0/1"` — for a single-build,
   * capped segment whose count the player must be able to *see* (the RADAR
   * satellite: one per station, and it re-arms after it is shot down, so hiding
   * the count would hide the rebuild). `null` on every other segment — turret and
   * shield cap silently, and their wedges name their target instead.
   *
   * A string, never a number, so the "the only numeric field is `cost`" guarantee
   * ({@link WheelSegment}, build-wheel.test.ts) still holds — no rate or count can
   * leak into a numeric field.
   */
  readonly capLabel: string | null;
}

/** The wheel for one frame. */
export interface BuildWheelModel {
  /** Whether the wheel is on screen at all — false away from your own station. */
  readonly open: boolean;
  /** Live ore total shown in the hub (GDD §2.5): everything a press can draw on,
   *  floored to whole ore because costs are whole ore. */
  readonly ore: number;
  /** The five segments, clockwise from twelve o'clock. Always all five, even
   *  when the wheel is closed, so the view can pool its children once. */
  readonly segments: readonly WheelSegment[];
  /**
   * The hub's BACK affordance (field report v0.2.4). The Build wheel is the top
   * level, so its hub says `CLOSE` and a hub tap / ESC shuts the wheel — the
   * single, consistent "go up a level" spot every wheel now shares
   * ({@link ./wheel-nav}). `null` only when the wheel is closed (no hub to press).
   */
  readonly hubBack: HubBack | null;
}

/** Static per-segment copy. Words only — the numbers come from `segmentCost`. */
const SEGMENT_COPY: Readonly<Record<WheelSegmentId, { label: string; target: SegmentTarget }>> = {
  turret: { label: 'TURRET', target: 'station' },
  shield: { label: 'SHIELD', target: 'station' },
  // The radar satellite (feature f1): a station-built body that orbits and lifts
  // the minimap fog. One word, its own thing — the wedge's second line carries the
  // "0/1" count so the one-per-station cap and its re-arm are legible.
  satellite: { label: 'RADAR', target: 'station' },
  // Named in full: "REPAIR REACTOR", never "REPAIR" — it repairs the station's
  // reactor and never the ship, and the label is the only place that is ever said.
  repair: { label: 'REPAIR REACTOR', target: 'station' },
  // The one segment that spends on the ship, and the one that opens a screen.
  upgrade: { label: 'UPGRADE SHIP', target: 'ship' },
};

/**
 * The RADAR wedge's "0/1" count/cap line (u2-02 grammar): satellites built (or
 * building) over the per-station cap. Reads `"0/1"` before the first is built,
 * `"1/1"` at the cap (paired with the `capped` state that greys the wedge), and
 * back to `"0/1"` the frame the sim's `satelliteCount` drops after the satellite
 * is shot down — so the wedge's count *is* the "it will re-arm" tell.
 */
export function radarCapLabel(signals: BuildWheelSignals): string {
  return `${Math.max(0, signals.satellites ?? 0)}/${SATELLITE.capPerStation}`;
}

/** Ore a press can actually draw on — hold plus bank, mirroring the sim's
 *  `spendableOre` so the wheel's affordability and the sim's agree exactly. */
export function spendableOre(signals: BuildWheelSignals): number {
  return Math.max(0, signals.cargo) + Math.max(0, signals.banked);
}

/**
 * Whether the wheel may be open this frame (GDD §2.5: "opened at your own
 * station"; §2.4: "E (near own station)"). Alive ship, live core, docked, asked
 * for — all four, or the wheel stays shut.
 */
export function canOpenWheel(signals: BuildWheelSignals): boolean {
  return signals.requested && signals.shipAlive && signals.stationAlive && signals.docked;
}

/** Build the wheel model for one frame. */
export function buildWheelModel(signals: BuildWheelSignals): BuildWheelModel {
  const ore = spendableOre(signals);
  const segments = WHEEL_ORDER.map((id, index) => {
    const copy = SEGMENT_COPY[id];
    return {
      id,
      label: copy.label,
      target: copy.target,
      cost: segmentCost(id),
      state: segmentState(id, signals, ore),
      opensPanel: id === 'upgrade',
      angle: segmentAngle(index),
      repair: id === 'repair' ? repairWedgeInfo(signals, ore) : null,
      capLabel: id === 'satellite' ? radarCapLabel(signals) : null,
    };
  });
  const open = canOpenWheel(signals);
  // The hub is the BACK affordance (field report v0.2.4); the Build wheel is the
  // top level, so its back CLOSES the wheel. `null` while shut — no hub is drawn.
  return { open, ore: Math.floor(ore), segments, hubBack: open ? hubBack('build') : null };
}

/**
 * Whether the station is still cooling down from its last repair — the sim's
 * `repairGate` has time left on it, so `placeOrder` refuses the next repair order
 * `'cooling-down'`, spending nothing. Mirrors that gate's `(station.repairGate ??
 * 0) > 1e-9` test EXACTLY (`buildings.ts`), so the wedge disables on precisely the
 * frames the sim refuses — never a frame early or late. Read from sim state; the
 * wheel keeps no clock of its own (the p4-17 rule).
 */
export function repairCoolingDown(signals: BuildWheelSignals): boolean {
  return (signals.repairGate ?? 0) > 1e-9;
}

/**
 * Whole seconds shown on the "REPAIR in Ns" countdown — the CEILING of the sim's
 * remaining `repairGate` (the respawn-countdown convention, {@link
 * ./respawn-countdown}), so the number never reads `0` while the press is still
 * locked and drops to re-arm exactly as `repairGate` reaches zero. Floored to `1`
 * so a sub-second remainder still shows "REPAIR in 1s" rather than a bare "0s"
 * that would read as ready. Only meaningful while {@link repairCoolingDown}.
 */
export function repairCooldownSeconds(signals: BuildWheelSignals): number {
  return Math.max(1, Math.ceil(signals.repairGate ?? 0));
}

/**
 * The REPAIR CORE wedge's effect/reason line (p5-08). Repair is a discrete
 * purchase, so the wheel is now allowed — required — to show the deal before the
 * tap: `"+15 HP"`, the real partial (`"+7 HP"`) when the core is missing less
 * than a full tap, or a reason when the press would be refused. The precedence
 * mirrors {@link segmentState} exactly, so the line and the dimmed state can
 * never disagree (collapse before full before affordability, then cooling-down).
 */
export function repairWedgeInfo(signals: BuildWheelSignals, ore = spendableOre(signals)): RepairWedgeInfo {
  const missing = Math.max(0, signals.maxCoreHp - signals.coreHp);
  const restoreHp = Math.min(REPAIR_HP_PER_ORE, missing);
  // Collapse shuts repair off for the rest of the match (GDD §2.3).
  if (signals.collapsed === true) return { restoreHp: 0, line: 'NO REPAIR' };
  // A full core has nothing to heal — the tap would be a no-op (sim `core-full`).
  if (signals.coreHp >= signals.maxCoreHp - 1e-9) return { restoreHp: 0, line: 'REACTOR FULL' };
  // Cooling down (RATIFIED developer, 2026-07-28): the sim refuses the next repair
  // `'cooling-down'` until `repairGate` reaches zero, so the wedge counts it down
  // live — "REPAIR in Ns" read from sim state each frame (no UI timer), ticking to
  // re-arm at exactly the sim's expiry tick. Checked BEFORE affordability, the same
  // order `placeOrder` uses, so a funded, damaged core still reads the countdown —
  // never a "+15 HP" deal that the sim would silently refuse. Heals nothing while
  // locked, so `restoreHp` is 0 like every other disabled state.
  if (repairCoolingDown(signals)) {
    return { restoreHp: 0, line: `REPAIR in ${repairCooldownSeconds(signals)}s` };
  }
  // Damaged but broke: name the price the tap needs (the empty-bank reason).
  if (!affordable(ore, REPAIR_ENTRY_ORE)) return { restoreHp, line: `NEED ${REPAIR_ENTRY_ORE} ORE` };
  // Ready: the REAL HP a tap buys right now — a full tap, or the partial that
  // heals a near-full core to the top for the same ore (the informed choice).
  return { restoreHp, line: `+${Math.max(1, Math.round(restoreHp))} HP` };
}

/**
 * Whether one segment can be pressed, and if not, why. The caps and the
 * cost are the sim's (`TURRET.capPerStation`, `SHIELD.capPerStation`,
 * `placeOrder`); this only *shows* the same answer a press would get, so the
 * wheel never dangles a segment the sim will refuse.
 *
 * Cap is checked **before** cost: a fourth turret is refused because the ring is
 * full, not because the player is poor, and saying "capped" is the useful thing.
 */
export function segmentState(
  id: WheelSegmentId,
  signals: BuildWheelSignals,
  ore = spendableOre(signals),
): SegmentState {
  switch (id) {
    case 'turret':
      if (signals.turrets >= TURRET.capPerStation) return 'capped';
      return affordable(ore, TURRET.cost) ? 'ready' : 'unaffordable';
    case 'shield':
      if (signals.shields >= SHIELD.capPerStation) return 'capped';
      return affordable(ore, SHIELD.cost) ? 'ready' : 'unaffordable';
    case 'satellite':
      // One radar per station (`SATELLITE.capPerStation`). At the cap the wedge is
      // disabled-gray with its "1/1" count; when the satellite is shot down the
      // sim's `satelliteCount` drops and the wedge re-arms — so the wheel never
      // dangles a second build `placeOrder` would refuse `cap-reached`, and never
      // hides the rebuild it would allow. Cap before cost, like turret/shield: a
      // second radar is refused because coverage already exists, not because the
      // player is poor.
      if ((signals.satellites ?? 0) >= SATELLITE.capPerStation) return 'capped';
      return affordable(ore, SATELLITE.cost) ? 'ready' : 'unaffordable';
    case 'repair':
      // Collapse shuts repair off for the rest of the match (GDD §2.3) — the
      // sim answers `collapsed`, and the wheel must not keep offering it.
      if (signals.collapsed === true) return 'inactive';
      // A full core has nothing to repair — the press would be a no-op, and the
      // sim answers `core-full`. Ore only matters once there is damage to undo.
      if (signals.coreHp >= signals.maxCoreHp - 1e-9) return 'inactive';
      // Still cooling down from the last repair (the sim's `repairGate`): the next
      // order is refused `'cooling-down'`, spending nothing. Checked BEFORE
      // affordability, exactly as `placeOrder` does — a funded, damaged core is
      // still refused while cooling, so the wedge is disabled-gray (a no-op press)
      // with the live "REPAIR in Ns" countdown ({@link repairWedgeInfo}), never a
      // ready-looking deal that does nothing.
      if (repairCoolingDown(signals)) return 'inactive';
      return affordable(ore, REPAIR_ENTRY_ORE) ? 'ready' : 'unaffordable';
    case 'upgrade':
      // UPGRADE SHIP spends nothing on the wheel — it opens the panel, where
      // each row carries its own cost. It is therefore always pressable; a
      // broke player still deserves to *see* that upgrades exist (GDD §2.5).
      return 'ready';
  }
}
