/**
 * src/ui/alarm.ts — the under-attack alarm. OWNER: UI Engineer.
 *
 * One of the two HUD elements GDD §2.2 flags as **mechanics, not polish**, "so
 * they cannot be cut as decoration":
 *
 * > When your core, shield, or turrets take **sustained damage** (not a single
 * > stray shot — a taunt-tap must not trigger it), you get an unmistakable alarm
 * > plus a screen-edge arrow pointing home. The whole design turns on the moment
 * > you're deep in the asteroid field and this alarm fires: the triangle
 * > decision, made audible. (GDD §2.2)
 *
 * Two pure pieces, both unit-tested:
 *
 *  1. {@link UnderAttackAlarm} — the **sustained-damage trigger**. A leaky
 *     bucket, not a hit counter: incoming damage fills it and it drains
 *     continuously, so a taunt-tap decays to nothing and only *pressure* — the
 *     thing GDD §2.6 says beats regeneration — ever reaches the threshold. It
 *     then *latches* for a few seconds so the alarm doesn't stutter between
 *     weapon ticks.
 *  2. {@link homeArrow} — the **screen-edge arrow pointing home**. Pure
 *     geometry against the follow camera (the local ship is at the visible
 *     viewport centre — `@platform/camera`), clamped to a safe-area inset so it
 *     never lands under a notch or behind a thumb stick.
 *
 * Threat red `#B23A3A` is the alarm colour — style-guide §2 names "alarms" and
 * "the under-attack tell" as exactly what that colour is for, and forbids it as
 * a friendly accent, which is why nothing else on the HUD is red.
 *
 * ## One predicate, and it says why it fired
 *
 * This trigger is the *single* authoritative "am I under attack" verdict: the
 * screen-edge arrow, the haptic `alarm` pattern, and the audio alarm all key off
 * it, so they can never disagree (GDD §2.2 pairs the alarm and the arrow in one
 * sentence — one sentence, one state machine). It is fed **only** damage to the
 * local player's own station; a bot war three stations away is none of its
 * business, and the endgame's collapse decay is entropy, not an attacker, so the
 * caller filters both out before feeding it (see `hud.updateAlarm`).
 *
 * A field report ("the alarm fired out of nowhere") is why the trigger now
 * carries its own {@link AlarmCause}: every tick it records *why* it is in the
 * state it is — which of core/shield/turret took the damage, how much, and the
 * predicate's verdict — and an optional {@link AlarmCauseLogger} prints that on
 * the rising and falling edges. The next phantom is read off a screenshot, not
 * hunted.
 */

// ---------------------------------------------------------------------------
// The sustained-damage trigger
// ---------------------------------------------------------------------------

/**
 * Damage (HP) that must be standing in the bucket for the alarm to fire.
 * Sized against the weapon that would be doing it: GDD §2.8's baseline weapon-vs-
 * core DPS is 5, so a real attacker crosses this in under two seconds, while a
 * single 2 HP turret-grade tap never can. TUNABLE.
 */
export const ALARM_THRESHOLD_HP = 5;

/**
 * How fast the bucket drains (HP per second). This is the whole "not a single
 * stray shot" rule: anything landing slower than this is noise and the alarm
 * never hears it. At 2 HP/s a 5 DPS weapon nets +3 HP/s and trips the alarm in
 * ~1.7 s; a taunt-tap of a couple of HP is gone in a second. TUNABLE.
 */
export const ALARM_DRAIN_HP_PER_S = 2;

/**
 * Seconds the alarm stays up after the pressure falls away. Weapon damage arrives
 * one tick at a time and an attacker circling a station has gaps; without a hold
 * the alarm would flicker, and a flickering alarm is one a player learns to
 * ignore. TUNABLE.
 */
export const ALARM_HOLD_S = 5;

/** Which part of your station drove the alarm this tick — the three the GDD names
 *  ("your core, your shields, your turrets"), or nothing on a quiet tick. */
export type AlarmSource = 'core' | 'shield' | 'turret' | 'none';

/**
 * Per-tick damage to your **own** station, split by where it landed so the alarm
 * can name its cause. A plain `number` is still accepted by
 * {@link UnderAttackAlarm.update} and is treated as core-equivalent damage.
 *
 * All fields are HP lost this tick; a caller passes the *fall* in each pool, so
 * negatives (repair, shield regen) never appear — only being hurt is an attack.
 * The caller is also responsible for feeding only the local player's station and
 * for subtracting collapse decay (entropy is not an attacker — GDD §2.3 vs §2.2).
 */
export interface AlarmDamage {
  readonly core?: number;
  readonly shield?: number;
  readonly turret?: number;
}

/** The predicate's one-word verdict for this tick — the *reason* the alarm is in
 *  the state it is, logged so a phantom is diagnosed from a screenshot. */
export type AlarmReason =
  /** No pressure, nothing landing: silent. */
  | 'quiet'
  /** Taking damage but still under the threshold — a tap, or a siege warming up. */
  | 'building'
  /** Threshold reached this tick: the sustained-damage siege the alarm exists for. */
  | 'sustained'
  /** Latched after the last hit so the tell does not flicker between weapon ticks. */
  | 'holding'
  /** The hold expired with no fresh pressure: back to silence. */
  | 'released';

/**
 * Why the alarm is sounding (or not). The field report ("fired out of nowhere")
 * turns on this: the trigger records its cause every tick so the answer to "what
 * rang it?" is a value, not a hunt. Read it back through the HUD's `?debug=1`
 * seam, or wire an {@link AlarmCauseLogger} to print it.
 */
export interface AlarmCause {
  /** Whether the alarm is sounding after this tick. */
  readonly firing: boolean;
  /** The predicate's verdict for this tick. */
  readonly reason: AlarmReason;
  /** Which pool took the most damage this tick (the alarm's prime suspect). */
  readonly source: AlarmSource;
  /** Attack HP counted against your station this tick — after the caller's
   *  ownership and collapse filtering, so a phantom shows up as `0` here. */
  readonly damage: number;
  /** Bucket fill toward the threshold, 0..1. */
  readonly pressure: number;
}

/** A sink for {@link AlarmCause} on state changes — the debug hook the field
 *  report asks to keep, so the next phantom prints its cause instead of hiding. */
export type AlarmCauseLogger = (cause: AlarmCause) => void;

const QUIET_CAUSE: AlarmCause = {
  firing: false,
  reason: 'quiet',
  source: 'none',
  damage: 0,
  pressure: 0,
};

/** Split whatever `update` was handed into the three pools plus the dominant
 *  source, ignoring anything non-positive (repair/regen is not an attack). */
function splitDamage(damage: number | AlarmDamage): {
  total: number;
  source: AlarmSource;
} {
  const core = Math.max(0, typeof damage === 'number' ? damage : damage.core ?? 0);
  const shield = Math.max(0, typeof damage === 'number' ? 0 : damage.shield ?? 0);
  const turret = Math.max(0, typeof damage === 'number' ? 0 : damage.turret ?? 0);
  const total = core + shield + turret;
  if (total <= 0) return { total: 0, source: 'none' };
  // The prime suspect is simply the pool that lost the most this tick.
  let source: AlarmSource = 'core';
  if (shield > core && shield >= turret) source = 'shield';
  else if (turret > core && turret > shield) source = 'turret';
  return { total, source };
}

/**
 * The under-attack alarm's trigger state (GDD §2.2). Feed it every frame with
 * the damage your **station** took this tick — core, shields, and turrets all
 * count, because all three are "your station is being attacked."
 *
 * Deliberately a small mutable object rather than a pure function: "sustained"
 * is a statement about history, and history has to live somewhere. Everything
 * else about it is pure — no timers, no wall clock, no DOM; it advances only by
 * the `dt` it is handed, so it tests headless and replays deterministically.
 */
export class UnderAttackAlarm {
  /** Damage standing in the bucket right now. */
  private bucket = 0;
  /** Seconds of latch left once pressure has fallen away. */
  private hold = 0;
  /** Whether the alarm is sounding. */
  private firing = false;
  /** Why the alarm is in its current state — the diagnostic the field report
   *  asked to be recorded so a phantom is read, not hunted. */
  private lastCause: AlarmCause = QUIET_CAUSE;
  /** Optional edge-triggered sink for {@link lastCause}; off by default. */
  private logger: AlarmCauseLogger | null = null;

  /**
   * Advance one tick and return whether the alarm is sounding.
   *
   * @param dt     Seconds elapsed (the sim's fixed timestep).
   * @param damage HP of damage your station took this tick. Either the total (a
   *               `number`), or an {@link AlarmDamage} split by core/shield/turret
   *               so the recorded {@link cause} can name what rang the alarm.
   *               Zero / omitted on a quiet tick.
   */
  update(dt: number, damage: number | AlarmDamage = 0): boolean {
    const { total, source } = splitDamage(damage);
    const wasFiring = this.firing;

    // Drain first, then fill: a tick's own damage is never eaten by that same
    // tick's drain, so the threshold means what it says regardless of `dt`.
    this.bucket = Math.max(0, this.bucket - ALARM_DRAIN_HP_PER_S * Math.max(0, dt));
    this.bucket += total;
    // Cap at the threshold. Without this the bucket keeps filling for as long
    // as a siege lasts, and a long siege would leave a long tail of alarm after
    // the attacker had already gone — the alarm would stop meaning "right now."
    // Capped, it clears exactly `ALARM_HOLD_S` after the last hit, every time.
    if (this.bucket > ALARM_THRESHOLD_HP) this.bucket = ALARM_THRESHOLD_HP;

    let reason: AlarmReason;
    if (this.bucket >= ALARM_THRESHOLD_HP) {
      // Sustained pressure: sound, and refresh the latch for as long as it lasts.
      this.firing = true;
      this.hold = ALARM_HOLD_S;
      reason = 'sustained';
    } else if (this.firing) {
      this.hold -= Math.max(0, dt);
      if (this.hold <= 0) {
        this.firing = false;
        this.hold = 0;
        // Start the next siege from silence, not from leftover pressure.
        this.bucket = 0;
        reason = 'released';
      } else {
        reason = 'holding';
      }
    } else if (total > 0 || this.bucket > 0) {
      // Damage is landing (or draining off) but has not crossed the threshold —
      // a stray tap, or a siege still warming up. Not yet the alarm.
      reason = 'building';
    } else {
      reason = 'quiet';
    }

    this.recordCause({ firing: this.firing, reason, source, damage: total, pressure: this.pressure }, wasFiring);
    return this.firing;
  }

  /** Store this tick's cause and, on a rising/falling edge, hand it to the
   *  logger — the ignition and the all-clear are the two moments worth printing. */
  private recordCause(cause: AlarmCause, wasFiring: boolean): void {
    this.lastCause = cause;
    if (this.logger && cause.firing !== wasFiring) this.logger(cause);
  }

  /** Why the alarm is in its current state (GDD §2.2 field report). Read back by
   *  the HUD `?debug=1` seam so a phantom's cause is on screen, not in a hunt. */
  get cause(): AlarmCause {
    return this.lastCause;
  }

  /** Attach (or clear with `null`) the edge-triggered cause logger. */
  onCause(logger: AlarmCauseLogger | null): void {
    this.logger = logger;
  }

  /** Whether the alarm is sounding right now. */
  get active(): boolean {
    return this.firing;
  }

  /** How close the bucket is to the threshold, 0..1. The view ramps the tell
   *  with this so a siege *builds* rather than snapping on at full volume. */
  get pressure(): number {
    return Math.min(1, this.bucket / ALARM_THRESHOLD_HP);
  }

  /** Clear everything — a fresh match, or a station that just died. */
  reset(): void {
    this.bucket = 0;
    this.hold = 0;
    this.firing = false;
    this.lastCause = QUIET_CAUSE;
  }
}

// ---------------------------------------------------------------------------
// The screen-edge arrow home
// ---------------------------------------------------------------------------

/** A 2D point in either world or screen space. Structural, so a sim `Vec2` and
 *  a plain literal both satisfy it without this module importing either. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** The visible drawing area the arrow is clamped inside, CSS px. */
export interface ArrowViewport {
  readonly width: number;
  readonly height: number;
}

/** Where to draw the arrow, and which way it points. */
export interface HomeArrow {
  /** Position on the inset screen edge, CSS px, origin top-left, y-down. */
  readonly x: number;
  readonly y: number;
  /** Direction to home, radians, y-down — feed straight to a sprite rotation. */
  readonly angle: number;
  /**
   * True when home is already visible inside the inset rect. The arrow is a
   * *pointer to somewhere you can't see*; once you can see the station, the
   * station is the tell and the arrow is clutter — the view hides it.
   */
  readonly onScreen: boolean;
  /** World distance from the ship to home. The view fades/scales with this, and
   *  it is the "how far you've drifted" half of the triangle decision. */
  readonly distance: number;
}

/**
 * Default inset from the screen edges (CSS px). Big enough to clear a phone's
 * safe-area insets and the thumb-scale controls, so the arrow is never drawn
 * under a notch, a home indicator, or a virtual stick.
 */
export const ARROW_EDGE_INSET = 28;

/**
 * The screen-edge arrow pointing home (GDD §2.2). The follow camera keeps the
 * local ship at the visible viewport centre (`@platform/camera`), so home's
 * screen position is just the centre plus the world offset — no camera matrix
 * needed, and the arrow can be computed from sim positions alone.
 *
 * @param ship   The local ship's world position (the camera target).
 * @param home   The player's own station's world position.
 * @param vp     The visible viewport size, CSS px.
 * @param inset  Safe-area inset from each edge; defaults to {@link ARROW_EDGE_INSET}.
 */
export function homeArrow(
  ship: Point,
  home: Point,
  vp: ArrowViewport,
  inset: number = ARROW_EDGE_INSET,
): HomeArrow {
  const cx = vp.width / 2;
  const cy = vp.height / 2;
  const dx = home.x - ship.x;
  const dy = home.y - ship.y;
  const distance = Math.hypot(dx, dy);

  // Standing on your own station: no direction to point in, nothing to point at.
  if (distance < 1e-6) {
    return { x: cx, y: cy, angle: 0, onScreen: true, distance: 0 };
  }

  const angle = Math.atan2(dy, dx);

  // The rect the arrow is allowed to live in: the viewport, inset on all four
  // edges. A viewport smaller than twice the inset degenerates to its centre
  // rather than inverting, so a tiny window still draws something sane.
  const halfW = Math.max(0, cx - inset);
  const halfH = Math.max(0, cy - inset);

  // Home already on screen (inside the inset rect) → point at it in place.
  if (Math.abs(dx) <= halfW && Math.abs(dy) <= halfH) {
    return { x: cx + dx, y: cy + dy, angle, onScreen: true, distance };
  }

  // Otherwise clamp along the ray from centre to home: the nearer of the two
  // edge crossings is where the ray actually leaves the rect.
  const tx = Math.abs(dx) > 1e-9 ? halfW / Math.abs(dx) : Infinity;
  const ty = Math.abs(dy) > 1e-9 ? halfH / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);

  return { x: cx + dx * t, y: cy + dy * t, angle, onScreen: false, distance };
}
