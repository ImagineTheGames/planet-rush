/**
 * src/ui/station-hp.ts — your own station's HP. OWNER: UI Engineer.
 *
 * Top-right of the HUD (GDD §2.2): "**your own station's HP** (top right, in your
 * player color, mirrored as a bar over the station itself)". It is one of the
 * five things the HUD shows at all times, because it is the loss condition
 * (GDD §1) and therefore something the player acts on.
 *
 * **Your own station only.** Enemy station health is scouted, never broadcast
 * (GDD §2.2, style-guide §5): a rival's HP appears as a damage ring on that
 * station within sensor range, and never as a HUD bar. This module models one
 * bar, for one station — the local player's — and there is deliberately no code
 * path here that takes another player's station.
 *
 * Colour: **the player's identity colour** (style-guide §3 rule 2 — HP bars are
 * one of the six places identity colour is allowed). The roster is read from the
 * ratified `PLAYER_COLORS` so this bar and the ship trim beside it can never
 * disagree. The critical-state flash is threat red, which style-guide §2 reserves
 * for exactly this kind of danger tell.
 *
 * Pure and DOM-free; the Pixi view in {@link ./hud} draws what this returns.
 */

import type { PlayerId } from '@shared/types';
import { PALETTE, PLAYER_COLORS } from '@render/index';
import { livingWhole } from './healthbar';

/** Core fraction at or below which the bar reads as critical and flashes. The
 *  fraction, not an HP number: a damage ring is a shape, not a readout. TUNABLE */
export const STATION_CRITICAL_FRACTION = 0.25;

/** The own-station HP element for one frame. */
export interface StationHpModel {
  /** Core HP as a fraction 0..1 — the bar's fill. */
  readonly coreFraction: number;
  /** Pooled shield HP as a fraction of full shields, 0..1. Shields stand in
   *  front of the core (GDD §2.5), so the view draws them as a thin overbar. */
  readonly shieldFraction: number;
  /** Whether any shield generator is standing at all. */
  readonly hasShield: boolean;
  /** The bar's colour: the owner's identity colour (style-guide §3). */
  readonly color: number;
  /** Colour of the critical tell — threat red (style-guide §2). */
  readonly criticalColor: number;
  /** True at or below {@link STATION_CRITICAL_FRACTION}: the bar flashes. */
  readonly critical: boolean;
  /** True once the core is gone — the station is a wreck (GDD §2.7). */
  readonly destroyed: boolean;
}

/** The identity colour for a player slot (style-guide §3.1, 8-slot roster).
 *  Wraps the roster so an out-of-range slot degrades to steel instead of
 *  `undefined` — identity is also carried by the hull decal, never colour alone. */
export function playerColor(id: PlayerId): number {
  if (!Number.isFinite(id) || id < 0) return PALETTE.hullSteel;
  return PLAYER_COLORS[Math.floor(id) % PLAYER_COLORS.length] ?? PALETTE.hullSteel;
}

/**
 * Build the own-station HP model.
 *
 * @param owner       The local player's slot — selects the identity colour.
 * @param coreHp      Current core HP.
 * @param maxCoreHp   Full core HP (`CORE_HP` at match start).
 * @param shieldHp    Pooled shield HP standing over the core, 0 when none.
 * @param maxShieldHp Pooled shield HP at full, 0 when no generator is built.
 */
export function stationHpModel(
  owner: PlayerId,
  coreHp: number,
  maxCoreHp: number,
  shieldHp = 0,
  maxShieldHp = 0,
): StationHpModel {
  const coreFraction = maxCoreHp > 0 ? clamp01(coreHp / maxCoreHp) : 0;
  const shieldFraction = maxShieldHp > 0 ? clamp01(shieldHp / maxShieldHp) : 0;
  return {
    coreFraction,
    shieldFraction,
    hasShield: maxShieldHp > 0,
    color: playerColor(owner),
    criticalColor: PALETTE.threatRed,
    // A core standing behind a shield is not yet in danger — the shield is what
    // is being shot (GDD §2.5), so the critical tell waits until it is the core.
    critical: coreFraction > 0 && coreFraction <= STATION_CRITICAL_FRACTION,
    destroyed: coreFraction <= 0,
  };
}

/**
 * The numeric core-HP readout beside the bar (developer request, p5-08): a
 * `"75/100"`-style current/max, so a player who wants the exact number has it and
 * doesn't have to eyeball the bar. Current HP **ceils** for a living core (field
 * report — a living thing never displays 0: a core at 0.4 hp reads `"1/100"`, not
 * `"0/100"`, so the readout never lies that a standing core is dead). Core HP is
 * whole at match start and only a live siege makes it fractional; max is already
 * whole. `coreHp <= 0` (the core is gone) is the only thing that reads `0`, and a
 * wrecked or unwired core reads `"0/N"`, never a negative or a NaN — the same
 * "living things never display 0" rule the ship/turret readout applies
 * ([[healthbar]] `livingWhole`), shared so the grammar can never diverge.
 *
 * This is a *readout*, not a rate — the "no numbers but cost on the wheel" rule
 * (build-wheel.ts) is about the Build wheel; the HP bar has always been allowed to
 * state your own station's health (GDD §2.2, the loss condition).
 */
export function coreHpReadout(coreHp: number, maxCoreHp: number): string {
  const max = Math.max(0, Number.isFinite(maxCoreHp) ? Math.round(maxCoreHp) : 0);
  return `${livingWhole(coreHp, max)}/${max}`;
}

/**
 * Whether the critical flash is "on" this frame. Driven by match time, not a
 * wall clock, so it is deterministic and needs no timer — the same discipline
 * as the ore HUD's full-hold blink. ~3 Hz: faster than the ore flash, because
 * this one means something worse.
 */
export function stationHpFlashOn(model: StationHpModel, timeSeconds: number): boolean {
  if (!model.critical) return false;
  return Math.floor(timeSeconds * 6) % 2 === 0;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
