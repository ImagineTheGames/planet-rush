/**
 * src/ui/build-wheel.ts — the Build & Upgrade wheel model. OWNER: UI Engineer.
 *
 * "Everything is bought from one place" (GDD §2.5). **Five segments**, each
 * labeled in words and each naming its target — TURRET, SHIELD, REPAIR CORE,
 * UPGRADE SHIP, BANK — with the player's live ore total in the hub. Four spend
 * on the **planet**, one on the **ship**; the economy is the choice between
 * those two, so every label names which.
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
 * **The wheel opens at your own planet, and only there** (GDD §2.5, §2.4 "E
 * (near own planet)") — {@link buildWheelModel} returns `open: false` anywhere
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
import { SHIELD, TURRET } from '../sim/constants';
import { affordable } from './affordability';

// ---------------------------------------------------------------------------
// Segment identity
// ---------------------------------------------------------------------------

/**
 * The five wheel segments (GDD §2.5). Four are {@link BuildItem}s the sim
 * spends on the spot; `upgrade` is the fifth and is deliberately *not* a
 * `BuildItem` — it opens the upgrade panel rather than placing an order, which
 * is exactly why the shared contract does not include it.
 */
export type WheelSegmentId = BuildItem | 'upgrade';

/** What a segment spends on: your planet, or your ship (GDD §2.5 — "every label
 *  names which", because the economy *is* the choice between the two). */
export type SegmentTarget = 'planet' | 'ship';

/**
 * Whether a segment can be pressed right now.
 *
 * - `ready`        — affordable, under cap, and it would do something.
 * - `unaffordable` — costs more ore than hold + bank hold (GDD §2.5).
 * - `capped`       — the per-planet cap is reached: 4 turrets, 2 shields
 *                    (GDD §2.5 — "design rules, not renderer limits"). Queued
 *                    construction counts, so a player cannot buy past the cap.
 * - `inactive`     — the press would be a no-op: BANK with an empty hold, or
 *                    REPAIR CORE on a core that is already full *or* after the
 *                    collapse phase has shut repair off for good (GDD §2.3).
 *                    The sim distinguishes those two (`core-full` vs
 *                    `collapsed`); the wheel does not, because the player-facing
 *                    answer is the same — this button does nothing now.
 */
export type SegmentState = 'ready' | 'unaffordable' | 'capped' | 'inactive';

// ---------------------------------------------------------------------------
// Costs — the only numbers on the wheel
// ---------------------------------------------------------------------------

/**
 * The ore printed under REPAIR CORE. GDD §2.5 spells this one out — "a bare
 * '1' under REPAIR CORE" — because repair is a *channel*, not a purchase: it
 * consumes ore as it ticks (1 ore per 5 HP, a tuning value **never printed on
 * the wheel**). One ore is the smallest whole unit the channel spends, so it is
 * the honest price of opening it, and the entry the sim's `placeOrder` checks
 * (`spendableOre > 0`).
 *
 * One ore buys `1 / REPAIR.orePerHp` = 5 HP — and that rate is the thing the
 * wheel must never say. It stays a comment here and a row nowhere.
 */
export const REPAIR_ENTRY_ORE = 1;

/** Cost printed under a segment, or `null` where a segment has no price:
 *  BANK is a deposit, UPGRADE SHIP prices its rows in the panel (GDD §2.5). */
export function segmentCost(id: WheelSegmentId): number | null {
  switch (id) {
    case 'turret':
      return TURRET.cost;
    case 'shield':
      return SHIELD.cost;
    case 'repair':
      return REPAIR_ENTRY_ORE;
    case 'bank':
    case 'upgrade':
      return null;
  }
}

// ---------------------------------------------------------------------------
// Layout — five segments, clockwise from twelve o'clock
// ---------------------------------------------------------------------------

/** Segment order around the wheel, clockwise from the top. Matches the order
 *  GDD §2.5 names them in, so the document and the screen read the same. */
export const WHEEL_ORDER: readonly WheelSegmentId[] = [
  'turret',
  'shield',
  'repair',
  'upgrade',
  'bank',
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
 * ship and its planet. Deliberately plain data — no sim types, no Pixi — so the
 * model tests headless and the netcode path can feed it from a snapshot just as
 * easily as the local sim can.
 */
export interface BuildWheelSignals {
  /** The player is asking for the wheel (the `build` action, held). */
  readonly requested: boolean;
  /** The ship is inside `PLANET.dockRange` of its **own** planet — the sim's
   *  `isDocked`. The wheel opens at your own planet and nowhere else. */
  readonly docked: boolean;
  /** The local ship is alive. */
  readonly shipAlive: boolean;
  /** The local player's planet still has a core (GDD §2.7: a wreck buys nothing). */
  readonly planetAlive: boolean;
  /** Ore in the hold — spent first (sim `spendOre`: hold before bank). */
  readonly cargo: number;
  /** Banked ore — safe, and the second half of what a purchase can draw on. */
  readonly banked: number;
  /** Turrets standing **or under construction** (the sim's `turretCount`). */
  readonly turrets: number;
  /** Shields standing **or under construction** (the sim's `shieldCount`). */
  readonly shields: number;
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
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/** One rendered segment. Words, a target, a cost, a state — and no other
 *  number (GDD §2.5, the rule this module enforces). */
export interface WheelSegment {
  readonly id: WheelSegmentId;
  /** The words on the segment. Named in full, never abbreviated. */
  readonly label: string;
  /** Planet or ship — every label names which (GDD §2.5). */
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
}

/** The wheel for one frame. */
export interface BuildWheelModel {
  /** Whether the wheel is on screen at all — false away from your own planet. */
  readonly open: boolean;
  /** Live ore total shown in the hub (GDD §2.5): everything a press can draw on,
   *  floored to whole ore because costs are whole ore. */
  readonly ore: number;
  /** The five segments, clockwise from twelve o'clock. Always all five, even
   *  when the wheel is closed, so the view can pool its children once. */
  readonly segments: readonly WheelSegment[];
}

/** Static per-segment copy. Words only — the numbers come from `segmentCost`. */
const SEGMENT_COPY: Readonly<Record<WheelSegmentId, { label: string; target: SegmentTarget }>> = {
  turret: { label: 'TURRET', target: 'planet' },
  shield: { label: 'SHIELD', target: 'planet' },
  // Named in full: "REPAIR CORE", never "REPAIR" — it repairs the planet's core
  // and never the ship, and the label is the only place that is ever said.
  repair: { label: 'REPAIR CORE', target: 'planet' },
  // The one segment that spends on the ship, and the one that opens a screen.
  upgrade: { label: 'UPGRADE SHIP', target: 'ship' },
  bank: { label: 'BANK', target: 'planet' },
};

/** Ore a press can actually draw on — hold plus bank, mirroring the sim's
 *  `spendableOre` so the wheel's affordability and the sim's agree exactly. */
export function spendableOre(signals: BuildWheelSignals): number {
  return Math.max(0, signals.cargo) + Math.max(0, signals.banked);
}

/**
 * Whether the wheel may be open this frame (GDD §2.5: "opened at your own
 * planet"; §2.4: "E (near own planet)"). Alive ship, live core, docked, asked
 * for — all four, or the wheel stays shut.
 */
export function canOpenWheel(signals: BuildWheelSignals): boolean {
  return signals.requested && signals.shipAlive && signals.planetAlive && signals.docked;
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
    };
  });
  return { open: canOpenWheel(signals), ore: Math.floor(ore), segments };
}

/**
 * Whether one segment can be pressed, and if not, why. The caps and the
 * cost are the sim's (`TURRET.capPerPlanet`, `SHIELD.capPerPlanet`,
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
      if (signals.turrets >= TURRET.capPerPlanet) return 'capped';
      return affordable(ore, TURRET.cost) ? 'ready' : 'unaffordable';
    case 'shield':
      if (signals.shields >= SHIELD.capPerPlanet) return 'capped';
      return affordable(ore, SHIELD.cost) ? 'ready' : 'unaffordable';
    case 'repair':
      // Collapse shuts repair off for the rest of the match (GDD §2.3) — the
      // sim answers `collapsed`, and the wheel must not keep offering it.
      if (signals.collapsed === true) return 'inactive';
      // A full core has nothing to repair — the press would be a no-op, and the
      // sim answers `core-full`. Ore only matters once there is damage to undo.
      if (signals.coreHp >= signals.maxCoreHp - 1e-9) return 'inactive';
      return affordable(ore, REPAIR_ENTRY_ORE) ? 'ready' : 'unaffordable';
    case 'bank':
      // BANK moves held ore to safety; with an empty hold there is nothing to
      // move (the sim answers `nothing-to-bank`). It never costs anything.
      return signals.cargo > 1e-9 ? 'ready' : 'inactive';
    case 'upgrade':
      // UPGRADE SHIP spends nothing on the wheel — it opens the panel, where
      // each row carries its own cost. It is therefore always pressable; a
      // broke player still deserves to *see* that upgrades exist (GDD §2.5).
      return 'ready';
  }
}
