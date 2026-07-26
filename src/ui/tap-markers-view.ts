/**
 * src/ui/tap-markers-view.ts — the Pixi layer that draws the Tap Commander order
 * markers. OWNER: UI Engineer (developer §4).
 *
 * The drawing half of {@link ./tap-markers}. It takes the markers the pure model
 * decided and animates them in **screen space** (the model already projected world
 * → screen), so they are a fixed size regardless of camera zoom — the same
 * discipline as the over-ship health bars ({@link ./healthbar-view}) and the
 * nameplates ({@link ./nameplates-view}).
 *
 * **What draws (developer §4):**
 *
 *  - **Lock reticle** — a four-corner bracket that rides the locked target,
 *    slowly rotating and softly pulsing in the player's identity colour, so a lock
 *    reads as a live "targeting" mark, not a static box. Floated just outside the
 *    target's screen radius so it frames the entity without covering it.
 *  - **Line of intent** — a thin, low-alpha line from the ship to the target,
 *    drawn only while the pilot is firing (the model gates this), so a held
 *    engagement is legible at a glance.
 *  - **Waypoint pulse** — an expanding pulse-ring at the tapped point with a small
 *    centre dot; on arrival (the pilot clears the order, so the model stops feeding
 *    it) the ring fades out over {@link WAYPOINT_FADE_SEC} rather than vanishing.
 *
 * **Stack order (p6-01 §3 — never occludes nameplates or health bars).** The HUD
 * adds this layer FIRST, so it sits over the world render but UNDER every piece of
 * HUD chrome, including the health bars and nameplates. A reticle rides a target's
 * rim while its bar and name float ABOVE the target, so they rarely overlap — but
 * where they would, the bar/name win because they draw on top. Documented in
 * {@link ./hud} at the `addChild` order.
 *
 * **No layout registration here.** These markers track WORLD positions (the
 * waypoint, the locked entity), so the Platform lane owns their layout contract —
 * it registers `tap-waypoint-marker` / `tap-lock-reticle` in `main.ts` from the
 * same projected positions this draws with (see the constants below, matched to
 * `TAP_MARKER_SIZE` / `TAP_RETICLE_PAD` there). This layer only draws.
 *
 * **Pooling (GDD §4.3).** Three reused {@link Graphics} (reticle, intent, ring),
 * allocated once; each frame clears and redraws only the markers present, hiding
 * the rest. Colour comes as an owner tint the model resolved, so nothing here
 * reaches for a palette entry.
 */

import { Container, Graphics } from 'pixi.js';
import type { TapMarkers } from './tap-markers';

/** Gap in screen px between the target's radius and the reticle bracket — half of
 *  the Platform lane's `TAP_RETICLE_PAD` (the extra diameter it registers), so the
 *  drawn bracket sits on the registered box's edge and the two agree. */
export const RETICLE_GAP = 10;
/** Reticle rotation, radians/second — a slow, unmistakably "active" turn. */
const RETICLE_SPIN = 0.7;
/** Corner-bracket arm length, screen px. */
const RETICLE_ARM = 7;
const RETICLE_STROKE = 2;

/** Waypoint pulse-ring radius at its smallest / largest, screen px. The max sits
 *  inside the Platform lane's `TAP_MARKER_SIZE` (28px box → 14px half-extent), so
 *  the drawn pulse stays within the registered marker rect. */
const WAYPOINT_MIN_R = 5;
const WAYPOINT_MAX_R = 13;
/** Pulses per second while a waypoint stands — the "tap landed here" heartbeat. */
const WAYPOINT_PULSE_HZ = 1.4;
/** Centre-dot radius, screen px — a fixed pip marking the exact tapped point. */
const WAYPOINT_DOT_R = 2.5;
/** Seconds the ring takes to fade out once the ship arrives (the order clears). */
export const WAYPOINT_FADE_SEC = 0.4;

/**
 * One frame of drawn markers, captured only when {@link TapMarkerView
 * .enableDebugCapture} has been called — the ?debug=1 live-stage seam behind
 * {@link TapMarkerView.debugMarkers}. It lets a Playwright test read back that a
 * reticle appears on the right target on lock and clears on release, and that a
 * waypoint pulse appears and then fades — the wiring a unit test can't reach (the
 * same discipline the bars and labels needed). Never written in a normal build.
 */
export interface DrawnTapMarkers {
  /** The reticle drawn this frame (target centre, radius, tint), or null. */
  reticle: { x: number; y: number; radius: number; color: number } | null;
  /** The waypoint pulse drawn this frame (screen point), or null — present both
   *  while the order stands and during the arrival fade-out. */
  waypoint: { x: number; y: number } | null;
  /** True only during the arrival fade — the order has cleared but the ring is
   *  still fading, so a test can assert the marker fades rather than blinking off. */
  waypointFading: boolean;
  /** Whether the line of intent drew this frame (the ship is firing on its lock). */
  intent: boolean;
}

export class TapMarkerView extends Container {
  /** The rotating reticle, positioned at the target and drawn about its own
   *  origin so `rotation` spins it in place. */
  private readonly reticleG = new Graphics();
  /** The line of intent, drawn in absolute screen coords (no transform). */
  private readonly intentG = new Graphics();
  /** The waypoint pulse-ring, positioned at the tapped point, drawn about origin. */
  private readonly waypointG = new Graphics();

  // --- Waypoint arrival fade state ----------------------------------------
  /** 1 while a waypoint stands; decays to 0 across {@link WAYPOINT_FADE_SEC} once
   *  the order clears (the ship arrived), so the ring fades instead of blinking. */
  private waypointFade = 0;
  /** True while an order stands (fade held at 1); false through the fade-out. */
  private waypointActive = false;
  /** The last waypoint's screen position + colour, held so the fade-out can keep
   *  drawing the ring where the tap landed after the model stops feeding it. */
  private lastWaypointX = 0;
  private lastWaypointY = 0;
  private lastWaypointColor = 0;
  /** Previous frame's time (seconds), for the fade dt. -1 until the first frame. */
  private lastTime = -1;

  // --- ?debug=1 live-stage capture (off in every normal build) -------------
  private debugCapture = false;
  private readonly debugDrawn: DrawnTapMarkers = {
    reticle: null,
    waypoint: null,
    waypointFading: false,
    intent: false,
  };

  constructor() {
    super();
    // Intent under the reticle (the line runs to the target the bracket frames);
    // the waypoint is independent. All three under the HUD chrome (see class doc).
    this.addChild(this.intentG, this.reticleG, this.waypointG);
  }

  /**
   * Draw one frame of markers. `markers` come from {@link tapMarkersModel}; `time`
   * is the match clock (seconds) driving the spin, pulse and arrival fade.
   */
  update(markers: TapMarkers, time: number): void {
    const dt = this.lastTime < 0 ? 0 : Math.max(0, Math.min(0.1, time - this.lastTime));
    this.lastTime = time;

    this.drawReticle(markers, time);
    this.drawIntent(markers, time);
    this.drawWaypoint(markers, time, dt);

    if (this.debugCapture) this.recordDebug(markers);
  }

  /** The rotating corner-bracket reticle riding the locked target. */
  private drawReticle(markers: TapMarkers, time: number): void {
    const r = markers.reticle;
    if (!r) {
      this.reticleG.visible = false;
      return;
    }
    this.reticleG.visible = true;
    this.reticleG.position.set(r.x, r.y);
    this.reticleG.rotation = time * RETICLE_SPIN;

    // A soft brightness pulse so the lock reads as live, not a static outline.
    const alpha = 0.6 + 0.3 * (0.5 + 0.5 * Math.sin(time * 4));
    const d = r.radius + RETICLE_GAP; // half-extent: sits just outside the target
    const g = this.reticleG;
    g.clear();
    // Four L-shaped corner brackets of a square framing the target — the classic
    // "acquiring" reticle, drawn about the origin so `rotation` turns it in place.
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const cx = sx * d;
        const cy = sy * d;
        g.moveTo(cx - sx * RETICLE_ARM, cy).lineTo(cx, cy).lineTo(cx, cy - sy * RETICLE_ARM);
      }
    }
    g.stroke({ width: RETICLE_STROKE, color: r.color, alpha });
  }

  /** The thin line of intent from ship to target, only while firing. */
  private drawIntent(markers: TapMarkers, time: number): void {
    const i = markers.intent;
    if (!i) {
      this.intentG.visible = false;
      return;
    }
    this.intentG.visible = true;
    // Low, gently breathing alpha — present enough to read the engagement, never
    // loud enough to fight the reticle or the world for the eye.
    const alpha = 0.22 + 0.14 * (0.5 + 0.5 * Math.sin(time * 6));
    this.intentG.clear();
    this.intentG
      .moveTo(i.fromX, i.fromY)
      .lineTo(i.toX, i.toY)
      .stroke({ width: 1, color: i.color, alpha });
  }

  /** The expanding waypoint pulse-ring, with a fade-out once the ship arrives. */
  private drawWaypoint(markers: TapMarkers, time: number, dt: number): void {
    const w = markers.waypoint;
    if (w) {
      // Order stands: full strength, and remember where for the eventual fade-out.
      this.waypointActive = true;
      this.waypointFade = 1;
      this.lastWaypointX = w.x;
      this.lastWaypointY = w.y;
      this.lastWaypointColor = w.color;
    } else {
      // Order cleared (arrival, or scheme/lock change): fade the last ring out.
      this.waypointActive = false;
      if (this.waypointFade > 0) {
        this.waypointFade = Math.max(0, this.waypointFade - dt / WAYPOINT_FADE_SEC);
      }
    }

    if (this.waypointFade <= 0) {
      this.waypointG.visible = false;
      return;
    }
    this.waypointG.visible = true;
    this.waypointG.position.set(this.lastWaypointX, this.lastWaypointY);

    // A ring that expands from min → max on a repeating phase and dims as it grows,
    // reading as a soft outward pulse from the tapped point. The whole thing scales
    // by the arrival-fade multiplier so it eases away on arrival.
    const phase = ((time * WAYPOINT_PULSE_HZ) % 1 + 1) % 1; // 0..1, robust to negatives
    const ringR = WAYPOINT_MIN_R + phase * (WAYPOINT_MAX_R - WAYPOINT_MIN_R);
    const ringAlpha = (1 - phase) * 0.85 * this.waypointFade;

    const g = this.waypointG;
    g.clear();
    g.circle(0, 0, ringR).stroke({ width: 2, color: this.lastWaypointColor, alpha: ringAlpha });
    // A fixed centre dot marks the exact point, so the target reads even between
    // ring pulses; it too eases out on arrival.
    g.circle(0, 0, WAYPOINT_DOT_R).fill({ color: this.lastWaypointColor, alpha: 0.8 * this.waypointFade });
  }

  // --- ?debug=1 live-stage seam --------------------------------------------

  /** Turn on capture of the drawn markers so {@link debugMarkers} reports them.
   *  Called once from `main.ts` under ?debug=1; a normal build never does, so the
   *  record path stays cold. Idempotent. */
  enableDebugCapture(): void {
    this.debugCapture = true;
  }

  /** The markers the layer actually drew last frame — for a live-stage test to
   *  assert a reticle tracks the locked target and clears on release, and a
   *  waypoint pulse appears then fades. A fresh copy; empty unless
   *  {@link enableDebugCapture} was called. */
  debugMarkers(): DrawnTapMarkers {
    const d = this.debugDrawn;
    return {
      reticle: d.reticle ? { ...d.reticle } : null,
      waypoint: d.waypoint ? { ...d.waypoint } : null,
      waypointFading: d.waypointFading,
      intent: d.intent,
    };
  }

  private recordDebug(markers: TapMarkers): void {
    const d = this.debugDrawn;
    if (markers.reticle) {
      d.reticle ??= { x: 0, y: 0, radius: 0, color: 0 };
      d.reticle.x = markers.reticle.x;
      d.reticle.y = markers.reticle.y;
      d.reticle.radius = markers.reticle.radius;
      d.reticle.color = markers.reticle.color;
    } else {
      d.reticle = null;
    }
    if (this.waypointFade > 0) {
      d.waypoint ??= { x: 0, y: 0 };
      d.waypoint.x = this.lastWaypointX;
      d.waypoint.y = this.lastWaypointY;
    } else {
      d.waypoint = null;
    }
    d.waypointFading = !this.waypointActive && this.waypointFade > 0;
    d.intent = markers.intent != null;
  }
}
