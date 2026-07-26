/**
 * src/art/audio/alarm.ts — the under-attack alarm. OWNER: Art & Audio Agent.
 *
 * GDD §2.2 lifts this out of the HUD and calls it what it is:
 *
 * > *Two elements of this HUD are **mechanics, not polish**… **The under-attack
 * > alarm.** When your core, shield, or turrets take sustained damage (not a
 * > single stray shot — a taunt-tap must not trigger it), you get an unmistakable
 * > alarm plus a screen-edge arrow pointing home. The whole design turns on the
 * > moment you're deep in the asteroid field and this alarm fires: the triangle
 * > decision, made audible.*
 *
 * It is also on the not-cuttable list (§4.9). So it is not a sound effect that
 * happens to repeat — it is a state machine, with a name, a test, and one
 * sentence of design it has to satisfy exactly:
 *
 * ## Sustained, not stray
 *
 * The hard part of the spec is the parenthesis. An alarm that fires on any hit
 * is worse than no alarm, because a rival who taps your shield once from across
 * the map can pull you off a full asteroid — the alarm becomes the weapon. So
 * damage feeds a **pressure** accumulator that leaks:
 *
 * ```
 *   pressure += weight(tell)          on every damage tell against your home
 *   pressure -= LEAK · dt             always
 *   fires    when pressure ≥ ENGAGE
 *   holds    for at least MIN_HOLD_S, however the fight goes
 *   releases when pressure ≤ RELEASE and the hold has expired
 * ```
 *
 * A stray shot is a single small deposit against a constant leak: it never
 * reaches {@link ENGAGE}. Sustained fire on your core deposits every tick it
 * damages, outruns the leak in well under a second, and fires. That is the
 * design sentence, as arithmetic.
 *
 * The minimum hold and the separate, lower release threshold are hysteresis: an
 * attacker pausing to dodge a turret must not make the alarm stutter on and off,
 * because a flickering alarm is one a player learns to ignore — which would cost
 * the mechanic the only thing it has.
 */

import { TELL, type TellKind } from '../tells';

/** Pressure at which the alarm fires. Deposits are scaled against this. */
export const ENGAGE = 1;

/** Pressure it must fall back below before releasing. Hysteresis, not a bug. */
export const RELEASE = 0.35;

/** Pressure lost per second. The leak a stray shot cannot outrun. */
export const LEAK = 1.2;

/** Ceiling, so a long siege cannot bank minutes of alarm. */
export const PRESSURE_CAP = 2.5;

/** Once fired, it holds this long however the fight goes. No stutter. */
export const MIN_HOLD_S = 2.5;

/**
 * What one damage tell deposits.
 *
 * A turret or a shield dying is worth far more than a tick of damage: those are
 * the events that mean the siege is *winning*, and the design's whole point is
 * that the owner hears about it while they are elsewhere (GDD §2.6).
 */
export const WEIGHTS: Readonly<Partial<Record<TellKind, number>>> = {
  [TELL.coreHit]: 0.06,
  [TELL.shieldHit]: 0.05,
  [TELL.shieldDown]: 0.8,
  [TELL.turretDown]: 0.8,
};

/** Options for {@link UnderAttackAlarm}. */
export interface AlarmOptions {
  /** Seconds it holds after firing, whatever happens. */
  readonly minHold?: number;
  /** Pressure lost per second. */
  readonly leak?: number;
}

/**
 * The alarm's state, driven by damage against the local player's own home.
 *
 * Pure and headless: it advances only by the `dt` it is handed and knows nothing
 * about audio, so it tests deterministically — and so the UI Engineer's
 * screen-edge arrow could read the same object rather than inventing a second,
 * subtly different notion of "under attack" (GDD §2.2 pairs them in one
 * sentence, and one sentence should not become two state machines).
 */
export class UnderAttackAlarm {
  private pressureValue = 0;
  private held = 0;
  private firing = false;
  private fires = 0;

  private readonly minHold: number;
  private readonly leak: number;

  constructor(options: AlarmOptions = {}) {
    this.minHold = Math.max(0, options.minHold ?? MIN_HOLD_S);
    this.leak = Math.max(0, options.leak ?? LEAK);
  }

  /** True while the alarm is sounding. */
  get active(): boolean {
    return this.firing;
  }

  /** Accumulated pressure, 0..{@link PRESSURE_CAP}. Debug, and the test's eye. */
  get pressure(): number {
    return this.pressureValue;
  }

  /** How many times it has fired this match. */
  get count(): number {
    return this.fires;
  }

  /**
   * Deposit one damage tell against the player's own home.
   *
   * The caller filters for ownership — this class is told about *your* home and
   * nothing else, so a siege three planets away can never ring your alarm.
   *
   * @returns the weight deposited (0 for a kind that is not damage).
   */
  damage(kind: TellKind): number {
    const weight = WEIGHTS[kind] ?? 0;
    if (weight <= 0) return 0;
    this.pressureValue = Math.min(PRESSURE_CAP, this.pressureValue + weight);
    return weight;
  }

  /** Advance the leak and the hold. */
  update(dt: number): void {
    const step = dt > 0 ? dt : 0;
    this.pressureValue = Math.max(0, this.pressureValue - this.leak * step);

    if (this.firing) {
      this.held += step;
      if (this.held >= this.minHold && this.pressureValue <= RELEASE) this.firing = false;
      return;
    }
    if (this.pressureValue >= ENGAGE) {
      this.firing = true;
      this.held = 0;
      this.fires++;
    }
  }

  /**
   * Stop now, whatever the pressure — the home is gone.
   *
   * An alarm still ringing over a dead planet would be the game telling a player
   * to defend something that no longer exists, and it would ring straight
   * through the three seconds the tone contract reserves for that death
   * (GDD §4.7). It stops.
   */
  silence(): void {
    this.firing = false;
    this.held = 0;
    this.pressureValue = 0;
  }

  /** Back to nothing — a new match, or a rejoin. */
  reset(): void {
    this.silence();
    this.fires = 0;
  }
}
