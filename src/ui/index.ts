/**
 * src/ui/ — HUD and menus. OWNER: UI Engineer (GDD §3.7).
 *
 * Ore squares + banked total, the asteroid-wave clock, the under-attack alarm
 * and screen-edge arrow, over-ship hull bars, the device-aware controls strip,
 * the radial build menu, upgrade panel, minimap, lobby, settings (incl. the
 * fire-mode toggle), end-of-match/rematch, and the onboarding prompts (§2.10).
 * Thumb-scale layout and safe-area anchoring for touch.
 *
 * The shape of every module here is the same: a **pure, DOM-free model** that
 * holds all the decisions and unit-tests headless, plus a thin PixiJS *view*
 * that draws it. The Platform Engineer constructs {@link Hud} on the Pixi stage
 * and calls {@link Hud.update} each frame with a {@link HudFrame}.
 *
 * M1 surface (GDD §4.6): ore-at-a-glance + banked total, the asteroid-wave
 * clock, the desktop controls strip, and the first two onboarding prompts.
 *
 * M2 surface: the **Build & Upgrade wheel** (§2.5 — words plus cost, and cost is
 * the only number), the **upgrade panel** behind its arrow (the only place ship
 * stats appear), **your own planet's HP** in your player colour (§2.2), the
 * **under-attack alarm** with its sustained-damage trigger and screen-edge arrow
 * home (§2.2, a mechanic and not polish), and the remaining two onboarding
 * prompts (§2.10).
 */

export { Hud } from './hud';
export type { HudFrame } from './hud';

export { Onboarding, PromptId, resolvePromptText } from './onboarding';
export type { OnboardingSignals } from './onboarding';

export { computeWaveClock, formatClock, WAVE_NAMES } from './wave-clock';
export type { WaveClock } from './wave-clock';

export { oreHudModel, oreFlashOn } from './ore-hud';
export type { OreHudModel } from './ore-hud';

export { controlsStripRows, showControlsStrip } from './controls-strip';

// --- Build & Upgrade wheel (GDD §2.5) --------------------------------------

export {
  buildWheelModel,
  canOpenWheel,
  segmentState,
  segmentCost,
  segmentAngle,
  segmentAtDirection,
  spendableOre,
  WHEEL_ORDER,
  SEGMENT_ARC,
  REPAIR_ENTRY_ORE,
} from './build-wheel';
export type {
  BuildWheelModel,
  BuildWheelSignals,
  WheelSegment,
  WheelSegmentId,
  SegmentState,
  SegmentTarget,
} from './build-wheel';

export { BuildWheelView } from './build-wheel-view';

// --- Upgrade panel — the only place ship stats appear (GDD §2.2, §2.5) -----

export {
  upgradePanelModel,
  upgradeRow,
  trackBase,
  trackValue,
  formatTrackValue,
  UpgradeTrack,
  TRACK_ORDER,
  STOCK_TIERS,
  UPGRADE_LADDER,
  CLASS_NAMES,
} from './upgrade-panel';
export type {
  UpgradePanelModel,
  UpgradePanelSignals,
  UpgradeRow,
  UpgradeRowState,
  UpgradeTiers,
  UpgradeLadder,
  UpgradeTrackSpec,
} from './upgrade-panel';

// --- Under-attack alarm (GDD §2.2 — a mechanic, not polish) ----------------

export {
  UnderAttackAlarm,
  homeArrow,
  ALARM_THRESHOLD_HP,
  ALARM_DRAIN_HP_PER_S,
  ALARM_HOLD_S,
  ARROW_EDGE_INSET,
} from './alarm';
export type { HomeArrow, ArrowViewport, Point } from './alarm';

// --- Own-planet HP, in the player's colour (GDD §2.2) ----------------------

export { planetHpModel, planetHpFlashOn, playerColor, PLANET_CRITICAL_FRACTION } from './planet-hp';
export type { PlanetHpModel } from './planet-hp';
