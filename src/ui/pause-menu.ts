/**
 * src/ui/pause-menu.ts — the mid-match pause menu. OWNER: UI Engineer.
 *
 * A way out of a match in progress (developer ratification, p10): RESUME, open
 * SETTINGS without leaving, or EXIT TO MENU — the last behind a "Leave the
 * match?" confirm so one stray tap can never kill a match. Reached with ESC on a
 * keyboard and a small corner affordance on touch.
 *
 * ── PAUSE SEMANTICS ARE THE TRANSPORT'S ─────────────────────────────────────
 * The overlay is deliberately ignorant of *how* a match pauses. Offline (the
 * `LocalLoopback`, a match that lives entirely in this tab) the sim FREEZES while
 * the overlay is up — the loop stops stepping and resumes exactly where it left
 * off. Online (any networked transport, m9) the eight-way match cannot stop for
 * one player, so the overlay shows but the sim keeps running. That single
 * distinction is a `pausable` flag the match-boot hands in — offline `true`,
 * networked `false` — and the whole of it lives in {@link shouldFreezeSim}, so
 * the overlay itself never learns which world it is in. Building the flag path
 * now (developer §2) means the networked-`false` branch is testable before the
 * networked transport exists.
 *
 * ── THE STATE MACHINE ───────────────────────────────────────────────────────
 * Four screens and a pure reducer ({@link nextPauseScreen}). ESC / the corner
 * button `toggle` open and back out one level at a time (the same "one press,
 * one level" gesture the Build wheel's ESC keeps), and the buttons drive the
 * explicit transitions. SETTINGS is a screen the pause menu owns the *state* of;
 * the drawing reuses the real settings screen ({@link ./settings-view}) so there
 * is one settings UI, not two.
 *
 * Pure and PixiJS-free, like the rest of the HUD's decision layer — it decides
 * what the screen says, where a tap lands, and whether the sim freezes;
 * {@link ./pause-menu-view} only colours it. Unit-tests headless.
 */

import type { AnchorSpec, Rect, Viewport } from '@platform/layout-registry';
import { centeredColumn, hitRect, menuContent } from './menu-geometry';
import type { Insets } from './menu-geometry';

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

/**
 * Which pause screen is up.
 *
 *  - `closed`  — no overlay; the match owns the screen.
 *  - `menu`    — RESUME / SETTINGS / EXIT TO MENU.
 *  - `settings`— the real settings screen, opened from the pause menu and
 *                returning to it on DONE. The pause menu owns only the *state*;
 *                {@link ./settings-view} draws it.
 *  - `confirm` — "Leave the match?" — LEAVE / STAY, so EXIT is never one tap.
 */
export type PauseScreen = 'closed' | 'menu' | 'settings' | 'confirm';

/** Whether any pause screen is up — the overlay is drawn and, offline, the sim
 *  is frozen (see {@link shouldFreezeSim}). */
export function isPauseOpen(screen: PauseScreen): boolean {
  return screen !== 'closed';
}

/**
 * Whether the sim should FREEZE this frame — the one place the offline/online
 * distinction lives (developer §2). Frozen only when an overlay is up **and** the
 * match is `pausable` (offline). A networked match is never pausable, so the
 * overlay can be up over a running sim and this stays `false` — the overlay never
 * learns which world it is in. Built and tested now, before the networked
 * transport that supplies `pausable: false` exists.
 */
export function shouldFreezeSim(screen: PauseScreen, pausable: boolean): boolean {
  return isPauseOpen(screen) && pausable;
}

/** The transitions the wiring drives the pause state through. `toggle` is the ESC
 *  / corner-button "open, or back out one level" gesture; the rest are button
 *  presses. */
export type PauseAction =
  | 'toggle'
  | 'resume'
  | 'openSettings'
  | 'closeSettings'
  | 'requestExit'
  | 'cancelExit';

/**
 * The pure reducer: next screen from the current one and an action. Total and
 * deterministic — every (screen, action) pair has a defined result, and an action
 * that doesn't apply to the current screen is a no-op (returns it unchanged), so
 * a doubled key press or a stale tap can never wedge the machine.
 *
 * `toggle` is the back-one-level gesture ESC and the corner button share: it OPENS
 * from `closed`, and from any open screen it steps one level back toward the match
 * (settings → menu, confirm → menu, menu → closed) — the same shape the Build
 * wheel's ESC keeps, so "go back" is one gesture across the whole HUD.
 */
export function nextPauseScreen(screen: PauseScreen, action: PauseAction): PauseScreen {
  switch (action) {
    case 'toggle':
      switch (screen) {
        case 'closed':
          return 'menu';
        case 'settings':
          return 'menu';
        case 'confirm':
          return 'menu';
        case 'menu':
          return 'closed';
      }
      break;
    case 'resume':
      return 'closed';
    case 'openSettings':
      return screen === 'menu' ? 'settings' : screen;
    case 'closeSettings':
      return screen === 'settings' ? 'menu' : screen;
    case 'requestExit':
      return screen === 'menu' ? 'confirm' : screen;
    case 'cancelExit':
      return screen === 'confirm' ? 'menu' : screen;
  }
  return screen;
}

// ---------------------------------------------------------------------------
// The buttons
// ---------------------------------------------------------------------------

/** A button on one of the pause screens. `resume`/`settings`/`exit` live on the
 *  main pause menu; `leave`/`stay` on the confirm dialog. The settings screen has
 *  none of its own here — {@link ./settings-view} owns those. */
export type PauseButton = 'resume' | 'settings' | 'exit' | 'leave' | 'stay';

/** A tap on the overlay. */
export type PauseTarget = { readonly kind: PauseButton };

const BUTTON_LABELS: Record<PauseButton, string> = {
  resume: 'RESUME',
  settings: 'SETTINGS',
  exit: 'EXIT TO MENU',
  leave: 'LEAVE',
  stay: 'STAY',
};

/**
 * The buttons a screen offers, in draw order. `menu` leads with RESUME (the one a
 * player reaches for, and the safe default). `confirm` puts the destructive LEAVE
 * first and the safe STAY second — but STAY is the emphasised primary button
 * (see {@link PauseButtonView}), so the eye and any errant default land on
 * staying, never on leaving (developer §1: one accidental tap must not kill a
 * match). `closed` and `settings` draw no pause buttons of their own.
 */
export function pauseButtons(screen: PauseScreen): readonly PauseButton[] {
  switch (screen) {
    case 'menu':
      return ['resume', 'settings', 'exit'];
    case 'confirm':
      return ['leave', 'stay'];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// The per-frame model
// ---------------------------------------------------------------------------

export interface PauseButtonView {
  readonly id: PauseButton;
  readonly label: string;
  /** Drawn as the affirmative/emphasised action (plasma): RESUME on the menu, and
   *  STAY on the confirm — the safe default in both cases. */
  readonly primary: boolean;
}

export interface PauseMenuModel {
  readonly screen: PauseScreen;
  /** PAUSED, or the confirm's question. Empty when no buttons are drawn. */
  readonly headline: string;
  /** One quiet line under the headline, or empty. */
  readonly subhead: string;
  readonly buttons: readonly PauseButtonView[];
}

/**
 * Build the frame model for a screen. Pure: the view draws exactly this and
 * decides nothing. `settings` and `closed` return an empty, headline-less model —
 * the pause view hides itself and the settings screen (or the match) owns the
 * frame.
 */
export function pauseMenuModel(screen: PauseScreen): PauseMenuModel {
  const buttons: PauseButtonView[] = pauseButtons(screen).map((id) => ({
    id,
    label: BUTTON_LABELS[id],
    primary: id === 'resume' || id === 'stay',
  }));
  return {
    screen,
    headline: headlineFor(screen),
    subhead: subheadFor(screen),
    buttons,
  };
}

function headlineFor(screen: PauseScreen): string {
  if (screen === 'menu') return 'PAUSED';
  if (screen === 'confirm') return 'LEAVE THE MATCH?';
  return '';
}

function subheadFor(screen: PauseScreen): string {
  if (screen === 'confirm') return 'Your planet falls the moment you go.';
  return '';
}

// ---------------------------------------------------------------------------
// Layout — a centred headline over a stack of buttons (the ./menu-geometry ruler)
// ---------------------------------------------------------------------------

export const PAUSE_HEADLINE_HEIGHT = 64;
export const PAUSE_SUBHEAD_HEIGHT = 26;
export const PAUSE_BUTTON_HEIGHT = 52;
export const PAUSE_BUTTON_HEIGHT_TOUCH = 60;
export const PAUSE_BUTTON_WIDTH_MAX = 320;

export interface PauseLayoutOptions {
  readonly isTouch?: boolean;
  readonly insets?: Insets;
}

export interface PauseLayout {
  readonly content: Rect;
  readonly headline: Rect;
  readonly subhead: Rect;
  /** One rect per button, in the model's button order. */
  readonly buttons: readonly Rect[];
  readonly isTouch: boolean;
}

/**
 * Lay the overlay out: the headline block a little above centre, the buttons
 * stacked below it — the same placement the end-of-match summary uses, so the two
 * full-screen overlays read as one family. `buttonCount` is passed rather than a
 * model so the geometry stays pure (two buttons on confirm, three on the menu,
 * placed the same way).
 */
export function pauseLayout(
  viewport: Viewport,
  buttonCount: number,
  options: PauseLayoutOptions = {},
): PauseLayout {
  const isTouch = options.isTouch ?? false;
  const content = menuContent(viewport, options.insets);

  const headlineHeight = Math.min(PAUSE_HEADLINE_HEIGHT, content.height);
  const subheadHeight = Math.min(PAUSE_SUBHEAD_HEIGHT, Math.max(0, content.height - headlineHeight));
  const blockTop = content.y + Math.max(0, content.height * 0.26 - headlineHeight / 2);
  const headline: Rect = { x: content.x, y: blockTop, width: content.width, height: headlineHeight };
  const subhead: Rect = {
    x: content.x,
    y: headline.y + headlineHeight,
    width: content.width,
    height: subheadHeight,
  };

  const rowHeight = isTouch ? PAUSE_BUTTON_HEIGHT_TOUCH : PAUSE_BUTTON_HEIGHT;
  const stackTop = Math.max(subhead.y + subheadHeight, content.y + content.height * 0.5);
  const band: Rect = {
    x: content.x,
    y: stackTop,
    width: content.width,
    height: Math.max(0, content.y + content.height - stackTop),
  };
  const buttons = centeredColumn(band, Math.max(0, buttonCount), PAUSE_BUTTON_WIDTH_MAX, rowHeight);

  return { content, headline, subhead, buttons, isTouch };
}

/**
 * The button a tap hit, or `null`. `buttonIds` is the model's button order, so
 * rect `i` is button `buttonIds[i]` — the index-mapping every screen in this
 * directory keeps, which keeps the drawn button and the routed button the same.
 */
export function pauseHitTest(
  layout: PauseLayout,
  x: number,
  y: number,
  buttonIds: readonly PauseButton[],
): PauseTarget | null {
  for (let i = 0; i < layout.buttons.length; i++) {
    const rect = layout.buttons[i];
    const id = buttonIds[i];
    if (rect && id && hitRect(rect, x, y)) return { kind: id };
  }
  return null;
}

/** The overlay's layout-registry id and anchor: it owns the whole screen, exactly
 *  like the end-of-match summary. */
export const PAUSE_ID = 'pause-menu';
export const PAUSE_ANCHOR: AnchorSpec = { region: 'full' };

// ---------------------------------------------------------------------------
// The touch pause affordance — the corner button that opens the overlay
// ---------------------------------------------------------------------------

/**
 * The mobile pause button (developer §1: "a small layout-registered pause
 * affordance on mobile, corner, clear of everything"). On desktop ESC opens the
 * overlay and this is never drawn; on touch there is no keyboard, so a fixed
 * affordance is the way in.
 *
 * Placement is the top band, hard against the top edge but inset from the left by
 * enough to clear the top-left ore TOTAL — the corner itself is spoken for, and
 * the empty stretch of the top band between the ore total and the centred wave
 * clock is the "clear of everything" the developer asked for. Its exact bounds
 * are published to the registry so QA's placement suite arbitrates the clearance
 * mechanically, not by eye; the anchor is the honest, checkable `full` (the same
 * call {@link ./build-button}, the alarm arrow and onboarding make, for the same
 * reason — the ratified region vocabulary has no dedicated zone for a small top-
 * band affordance, and inventing one is the Director's call).
 */
export const PAUSE_BUTTON_ID = 'pause-button';
export const PAUSE_BUTTON_ANCHOR: AnchorSpec = { region: 'full', margin: 0 };

/** Side of the square pause button, CSS px — a comfortable thumb target. */
export const PAUSE_BUTTON_SIZE = 40;
/** Inset from the top edge, matching the HUD's own `HUD_PAD`. */
export const PAUSE_BUTTON_MARGIN = 16;
/** Inset from the left edge — past the top-left ore TOTAL block (its label + a
 *  two-to-three digit banked number), so the button sits in the clear top band
 *  rather than over the one readout that shares this corner. */
export const PAUSE_BUTTON_LEFT = 72;

/** The inputs that decide whether the corner pause button is on screen. */
export interface PauseButtonSignals {
  /** This is a touch build — the button is the touch-only ESC-equivalent; on
   *  desktop the overlay is opened with the Escape key instead. */
  readonly isTouch: boolean;
  /** The match owns the screen right now — no overlay, wheel or end screen up. The
   *  button hides while any of those is present so it stays "clear of everything"
   *  (developer §1). */
  readonly available: boolean;
}

/** Whether the corner pause button is drawn this frame: on touch, while the match
 *  owns the screen — and nothing else. */
export function pauseButtonVisible(signals: PauseButtonSignals): boolean {
  return signals.isTouch && signals.available;
}

/** The pause button's rect: a {@link PAUSE_BUTTON_SIZE} square in the top band,
 *  inset {@link PAUSE_BUTTON_LEFT} from the left (clear of the ore total) and
 *  {@link PAUSE_BUTTON_MARGIN} from the top. Shared by the drawing (view), the hit
 *  target, and the layout registration, so the button a finger lands on is the
 *  button that was drawn. */
export function pauseButtonRect(_viewport: Viewport): Rect {
  return {
    x: PAUSE_BUTTON_LEFT,
    y: PAUSE_BUTTON_MARGIN,
    width: PAUSE_BUTTON_SIZE,
    height: PAUSE_BUTTON_SIZE,
  };
}
