/**
 * src/platform/wheel-input.ts — pressing the Build & Upgrade wheel. OWNER:
 * Platform Engineer.
 *
 * `src/ui` owns what the wheel *says* (five segments, words plus a cost, and
 * cost is the only number — GDD §2.5) and what it looks like. This owns the
 * other half: **which segment a press landed on**, and the two bits of screen
 * state the pure UI models deliberately don't hold — is the wheel up, and is the
 * upgrade panel in front of it.
 *
 * It belongs here for the same reason the twin sticks do: it is input, and input
 * is device-agnostic before it crosses into anything else (GDD §2.4). A mouse
 * click on a wedge, a thumb tap on the same wedge, and a gamepad stick pushed at
 * it plus a confirm are three gestures that all arrive at {@link WheelInput} and
 * leave as the same segment index. The sim then learns about it through
 * `buildOrder` / `upgradeOrder` like any other action (`./actions`), so nothing
 * downstream — not the wheel model, not the sim — can tell which device bought
 * the turret.
 *
 * Pure geometry and state: no DOM, no PixiJS, no `src/ui` import (the UI already
 * depends on `@platform`, and a cycle would be the wrong way to share five
 * constants). The angle convention it implements is the wheel's own — segment 0
 * at twelve o'clock, the rest clockwise — and `wheel-input.test.ts` pins it
 * against `src/ui`'s `segmentAtDirection` across a full sweep, so the two cannot
 * drift apart without a red test.
 */

import type { BuildItem, UpgradeTrack } from '@shared/types';
import type { ControlState } from './actions';

// ---------------------------------------------------------------------------
// Geometry (mirrors src/ui/build-wheel-view.ts, which does not export it)
// ---------------------------------------------------------------------------

/** Hub radius as a fraction of the outer ring — the dead centre of the wheel,
 *  where the live ore total is printed. A press here selects nothing. */
export const HUB_FRACTION = 0.22;
/** Inner edge of the segment ring, as a fraction of the outer ring. Between the
 *  hub and here is the gap the hub's stroke lives in; a press there is a miss,
 *  not a purchase. */
export const INNER_FRACTION = 0.3;

/** Where the panel's first row starts, measured down from the panel's top edge —
 *  `PANEL_CHROME_HEIGHT`'s title + header block as `build-wheel-view` lays it
 *  out (`headerY + 18`, with `headerY` 46 px below the top). */
export const PANEL_ROWS_TOP = 64;

/** The wheel's drawn geometry for one frame, CSS px. The caller reads radius
 *  from `src/ui`'s `wheelRadius()` so the hit target is exactly what was drawn. */
export interface WheelLayout {
  /** Wheel centre — the viewport centre, where the follow camera holds the
   *  docked ship and so the station (GDD §2.2). */
  readonly centerX: number;
  readonly centerY: number;
  /** Outer ring radius. */
  readonly radius: number;
  /** How many segments the wheel has (five — GDD §2.5). */
  readonly segments: number;
}

/** The upgrade panel's drawn geometry for one frame, CSS px. */
export interface PanelLayout {
  readonly centerX: number;
  readonly centerY: number;
  readonly width: number;
  readonly height: number;
  readonly rowHeight: number;
  readonly rows: number;
}

/**
 * The segment a direction from the hub selects — segment 0 at twelve o'clock,
 * the rest clockwise, y-down screen space (GDD §2.5's layout, as `src/ui` draws
 * it). Returns `null` inside the hub, because releasing at dead centre must
 * cancel rather than buy whatever happened to be nearest.
 *
 * @param deadzone magnitude below which the direction reads as "no selection",
 *                 in the same units as `dx`/`dy`.
 */
export function segmentIndexAt(
  dx: number,
  dy: number,
  segments: number,
  deadzone = 0.25,
): number | null {
  if (segments <= 0) return null;
  if (dx * dx + dy * dy < deadzone * deadzone) return null;
  const arc = (2 * Math.PI) / segments;
  // Angle measured from twelve o'clock, clockwise, normalised to [0, 2π).
  const fromTop = Math.atan2(dx, -dy);
  const norm = (fromTop + 2 * Math.PI) % (2 * Math.PI);
  return Math.floor((norm + arc / 2) / arc) % segments;
}

/** What a press on the open wheel landed on. */
export type WheelHit =
  | { readonly kind: 'segment'; readonly index: number }
  /** The hub, or the gap between it and the segment ring: consumed, buys
   *  nothing. The player pressed the wheel and simply missed a wedge. */
  | { readonly kind: 'hub' }
  /** Outside the wheel entirely — the gesture that dismisses it. */
  | { readonly kind: 'outside' };

/** Hit-test a press (CSS px, canvas space) against the drawn wheel. */
export function hitWheel(x: number, y: number, layout: WheelLayout): WheelHit {
  const dx = x - layout.centerX;
  const dy = y - layout.centerY;
  const d2 = dx * dx + dy * dy;
  if (d2 > layout.radius * layout.radius) return { kind: 'outside' };
  const inner = layout.radius * INNER_FRACTION;
  if (d2 < inner * inner) return { kind: 'hub' };
  const index = segmentIndexAt(dx, dy, layout.segments, inner);
  return index === null ? { kind: 'hub' } : { kind: 'segment', index };
}

/** What a press on the open upgrade panel landed on. */
export type PanelHit =
  | { readonly kind: 'row'; readonly index: number }
  /** Panel chrome — the title, the headers, the ore hint. Consumed, buys
   *  nothing. */
  | { readonly kind: 'chrome' }
  /** Outside the panel — the gesture that goes back to the wheel. */
  | { readonly kind: 'outside' };

/** Hit-test a press (CSS px, canvas space) against the drawn upgrade panel. */
export function hitPanel(x: number, y: number, layout: PanelLayout): PanelHit {
  const left = layout.centerX - layout.width / 2;
  const top = layout.centerY - layout.height / 2;
  if (x < left || x > left + layout.width || y < top || y > top + layout.height) {
    return { kind: 'outside' };
  }
  const index = Math.floor((y - (top + PANEL_ROWS_TOP)) / layout.rowHeight);
  if (index < 0 || index >= layout.rows) return { kind: 'chrome' };
  return { kind: 'row', index };
}

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

/**
 * Is the wheel up, is the panel in front of it, and what did the player just
 * buy. One object per client; fed by whichever devices are present.
 *
 * The purchases drain one-shot ({@link takeSegment}, {@link takeRow}) so a press
 * reaches the sim on exactly the tick it happened and never again — the rule
 * `BuildOrderAction` states, enforced at the only place that can break it.
 */
export class WheelInput {
  private up = false;
  private panel = false;
  private segment: number | null = null;
  private row: number | null = null;
  /** Gamepad/stick selection, kept between a push and its confirm. */
  private selected: number | null = null;

  /** Whether the wheel is on screen. */
  get open(): boolean {
    return this.up;
  }

  /** Whether the upgrade panel is in front of the wheel (GDD §2.5). */
  get panelOpen(): boolean {
    return this.up && this.panel;
  }

  /** The segment the stick is currently pushed at, for a gamepad confirm. */
  get selection(): number | null {
    return this.selected;
  }

  /**
   * The wheel opens at your own station **and nowhere else** (GDD §2.5). The
   * caller passes the sim's own answer (alive, docked, live core); a wheel that
   * was open when the ship undocked closes itself, so flying away is a way out.
   */
  setAvailable(available: boolean): void {
    if (!available) this.close();
  }

  /** The `build` action's rising edge: E, Y/△, or the BUILD button (GDD §2.4).
   *  Opens the wheel, and closes it — including out of the panel, so one binding
   *  is always the way back to flying. */
  toggle(): void {
    if (this.up) this.close();
    else this.up = true;
  }

  /** Shut the wheel (and the panel behind it). */
  close(): void {
    this.up = false;
    this.panel = false;
    this.selected = null;
  }

  /** Put the upgrade panel in front of the wheel — what the UPGRADE SHIP arrow
   *  means (GDD §2.5). */
  openPanel(): void {
    if (this.up) this.panel = true;
  }

  /** Back out of the panel to the wheel. */
  closePanel(): void {
    this.panel = false;
  }

  /**
   * A press at (x, y) in canvas CSS pixels — a mouse click or a thumb tap, which
   * are the same gesture here. Returns true when the wheel consumed it, so the
   * caller can keep the press from also reaching the virtual sticks underneath.
   *
   * @param index the segment index that opens the panel (UPGRADE SHIP), so this
   *              module needs no opinion about which wedge is which.
   */
  press(x: number, y: number, wheel: WheelLayout, panel: PanelLayout, panelSegment: number): boolean {
    if (!this.up) return false;

    if (this.panel) {
      const hit = hitPanel(x, y, panel);
      if (hit.kind === 'outside') this.panel = false;
      else if (hit.kind === 'row') this.row = hit.index;
      return true;
    }

    const hit = hitWheel(x, y, wheel);
    if (hit.kind === 'outside') {
      this.close();
      return true;
    }
    if (hit.kind === 'segment') {
      if (hit.index === panelSegment) this.panel = true;
      else this.segment = hit.index;
    }
    return true;
  }

  /**
   * Point the wheel with a stick (gamepad, and the touch aim stick when it is
   * not busy firing). Selection alone buys nothing — {@link confirm} does — which
   * is what keeps a resting stick from spending a player's ore.
   */
  aim(dx: number, dy: number, segments: number, deadzone = 0.4): void {
    if (!this.up || this.panel) return;
    const index = segmentIndexAt(dx, dy, segments, deadzone);
    if (index !== null) this.selected = index;
  }

  /** Buy whatever the stick is pointed at (the gamepad confirm button). */
  confirm(panelSegment: number): void {
    if (!this.up || this.panel || this.selected === null) return;
    if (this.selected === panelSegment) this.panel = true;
    else this.segment = this.selected;
  }

  /** Drain the segment bought this frame, if any. */
  takeSegment(): number | null {
    const s = this.segment;
    this.segment = null;
    return s;
  }

  /** Drain the upgrade row bought this frame, if any. */
  takeRow(): number | null {
    const r = this.row;
    this.row = null;
    return r;
  }
}

// ---------------------------------------------------------------------------
// Into the action funnel
// ---------------------------------------------------------------------------

/**
 * Drain whatever the wheel bought this frame into the device-neutral
 * {@link ControlState}, where {@link ./actions.mapActions} turns it into the
 * `buildOrder` / `upgradeOrder` the sim consumes.
 *
 * `segments` and `tracks` are the *wheel's own* orders, passed in rather than
 * imported, so this module still needs nothing from `src/ui` and the caller
 * cannot get the mapping wrong by hand. `'upgrade'` is skipped here because it
 * opened a screen instead of spending — the purchase it leads to arrives as a
 * row (GDD §2.5).
 *
 * Returns true when something was actually bought — the caller's cue that the
 * SPEND onboarding prompt has been satisfied (GDD §2.10).
 */
export function writeWheelOrders(
  wheel: WheelInput,
  state: ControlState,
  segments: readonly (BuildItem | 'upgrade')[],
  tracks: readonly UpgradeTrack[],
): boolean {
  let bought = false;

  const segment = wheel.takeSegment();
  if (segment !== null) {
    const id = segments[segment];
    if (id !== undefined && id !== 'upgrade') {
      state.order = id;
      bought = true;
    }
  }

  const row = wheel.takeRow();
  if (row !== null) {
    const track = tracks[row];
    if (track !== undefined) {
      state.upgrade = track;
      bought = true;
    }
  }

  return bought;
}
