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
 * one tick at a time and an attacker circling a planet has gaps; without a hold
 * the alarm would flicker, and a flickering alarm is one a player learns to
 * ignore. TUNABLE.
 */
export const ALARM_HOLD_S = 5;

/**
 * The under-attack alarm's trigger state (GDD §2.2). Feed it every frame with
 * the damage your **planet** took this tick — core, shields, and turrets all
 * count, because all three are "your planet is being attacked."
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

  /**
   * Advance one tick and return whether the alarm is sounding.
   *
   * @param dt     Seconds elapsed (the sim's fixed timestep).
   * @param damage HP of damage your planet took this tick — core, shield, and
   *               turret damage summed. Zero on a quiet tick.
   */
  update(dt: number, damage: number): boolean {
    // Drain first, then fill: a tick's own damage is never eaten by that same
    // tick's drain, so the threshold means what it says regardless of `dt`.
    this.bucket = Math.max(0, this.bucket - ALARM_DRAIN_HP_PER_S * Math.max(0, dt));
    this.bucket += Math.max(0, damage);
    // Cap at the threshold. Without this the bucket keeps filling for as long
    // as a siege lasts, and a long siege would leave a long tail of alarm after
    // the attacker had already gone — the alarm would stop meaning "right now."
    // Capped, it clears exactly `ALARM_HOLD_S` after the last hit, every time.
    if (this.bucket > ALARM_THRESHOLD_HP) this.bucket = ALARM_THRESHOLD_HP;

    if (this.bucket >= ALARM_THRESHOLD_HP) {
      // Sustained pressure: sound, and refresh the latch for as long as it lasts.
      this.firing = true;
      this.hold = ALARM_HOLD_S;
    } else if (this.firing) {
      this.hold -= Math.max(0, dt);
      if (this.hold <= 0) {
        this.firing = false;
        this.hold = 0;
        // Start the next siege from silence, not from leftover pressure.
        this.bucket = 0;
      }
    }
    return this.firing;
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

  /** Clear everything — a fresh match, or a planet that just died. */
  reset(): void {
    this.bucket = 0;
    this.hold = 0;
    this.firing = false;
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
   * *pointer to somewhere you can't see*; once you can see the planet, the
   * planet is the tell and the arrow is clutter — the view hides it.
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
 * @param home   The player's own planet's world position.
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

  // Standing on your own planet: no direction to point in, nothing to point at.
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
