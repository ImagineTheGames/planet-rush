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
 * ── GANTRY / BONE (u7-05) ───────────────────────────────────────────────────
 * The overlay is made of the same material as the title and settings screens:
 * a header beam carrying the screen's own name, a footer beam, and the actions
 * as PLATES in the band between (`src/art/materials.ts`, the a5-01 vocabulary).
 * Nothing about *what the screen says* moved — the words, the buttons, the state
 * machine and the freeze rule are character for character what they were.
 *
 * **RESUME is the one bright plate**, and on the confirm screen **STAY is**. Bone
 * spends no hue, so the primary action is simply the brightest and largest plate
 * on screen, and it only works while there is exactly one ({@link ./gantry}
 * `singlePrimary`, held by `pause-menu.test.ts`). That is the same safety
 * property the old plasma fill carried — the eye, and any errant default, land on
 * the safe action — restated in the material the rest of the menus are made of.
 *
 * Pure and PixiJS-free, like the rest of the HUD's decision layer — it decides
 * what the screen says, where a tap lands, and whether the sim freezes;
 * {@link ./pause-menu-view} only colours it. Unit-tests headless.
 */

import type { AnchorSpec, Rect, Viewport } from '@platform/layout-registry';
import { COLUMN, TOUCH_MIN, plateHeight } from '../art/materials';
import type { FrameMetrics, PlateRole, PlateScale, PlateState } from '../art/materials';
import { beamContent, gantryFrame, stackPlates } from './gantry';
import { hitRect } from './menu-geometry';
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

/**
 * The plate a button is drawn as. The emphasised action is a `primary` `hero`
 * plate — the brightest AND the largest, which is the whole of what Bone has to
 * mark an action with — and everything else is a `secondary` `standard` plate,
 * fully active steel and never the disabled costume.
 *
 * RESUME on the menu and STAY on the confirm are the emphasised ones, so the safe
 * action is the bright one on both screens (developer §1: one accidental tap must
 * not kill a match).
 */
export function pauseButtonPlate(id: PauseButton): { role: PlateRole; scale: PlateScale } {
  return isPrimaryButton(id)
    ? { role: 'primary', scale: 'hero' }
    : { role: 'secondary', scale: 'standard' };
}

/** Whether a button is its screen's emphasised action. */
function isPrimaryButton(id: PauseButton): boolean {
  return id === 'resume' || id === 'stay';
}

export interface PauseButtonView {
  readonly id: PauseButton;
  readonly label: string;
  /** The emphasised action: RESUME on the menu, STAY on the confirm — the safe
   *  default in both cases. Under Gantry/Bone this is no longer a *colour*
   *  difference (see {@link pauseButtonPlate}). */
  readonly primary: boolean;
  readonly role: PlateRole;
  readonly scale: PlateScale;
  /** Rest / hover / press — the handoff's three plate states, driven by the
   *  wiring layer's pointer routing (`src/main.ts`). Touch never hovers. */
  readonly state: PlateState;
}

/** What the pointer is doing on the overlay: which button it is over, and which
 *  (if any) it is holding down. */
export interface PausePointer {
  readonly hover?: PauseButton | null;
  readonly press?: PauseButton | null;
}

export interface PauseMenuModel {
  readonly screen: PauseScreen;
  /** PAUSED, or the confirm's question. Empty when no buttons are drawn. Drawn in
   *  the header beam, where every screen in the set puts its own name. */
  readonly headline: string;
  /** One quiet line beside the headline, or empty. */
  readonly subhead: string;
  readonly buttons: readonly PauseButtonView[];
}

/**
 * Build the frame model for a screen. Pure: the view draws exactly this and
 * decides nothing. `settings` and `closed` return an empty, headline-less model —
 * the pause view hides itself and the settings screen (or the match) owns the
 * frame.
 *
 * A press outranks a hover on the same plate (a finger that is down is not
 * hovering), and a plate that is neither is at rest — the same rule the title
 * screen keeps.
 */
export function pauseMenuModel(screen: PauseScreen, pointer: PausePointer = {}): PauseMenuModel {
  const buttons: PauseButtonView[] = pauseButtons(screen).map((id) => {
    const { role, scale } = pauseButtonPlate(id);
    return {
      id,
      label: BUTTON_LABELS[id],
      primary: isPrimaryButton(id),
      role,
      scale,
      state: (pointer.press === id ? 'press' : pointer.hover === id ? 'hover' : 'rest') as PlateState,
    };
  });
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
  if (screen === 'confirm') return 'Your station falls the moment you go.';
  return '';
}

// ---------------------------------------------------------------------------
// Layout — the Gantry frame: a named beam, a plate stack, a footer beam
// ---------------------------------------------------------------------------
//
// The old geometry placed a 44px headline at 26% of the content box over a
// `centeredColumn` of 52/60px rows — the pre-Gantry ruler, with its own
// desktop/touch pair of button heights. All of that is replaced by the frame the
// rest of the menus share ({@link ./gantry} `gantryFrame`): the screen names
// itself in the header beam, its actions are plates in the band, and every metric
// — margin, beam, gutter, plate height, thumb floor — is derived once in
// {@link ../art/materials} `frameMetrics` rather than picked here.
//
// Which numbers that changes on a phone, and why, is the whole of §3b of that
// file: the LOOK is ratified, the METRICS adapt, and the 48px thumb floor
// outranks any scaled-down metric. `isTouch` no longer picks a taller button —
// the floor is a property of the viewport, not of the input device, and it is
// applied on every platform.

export interface PauseLayoutOptions {
  readonly isTouch?: boolean;
  readonly insets?: Insets;
}

export interface PauseLayout {
  readonly content: Rect;
  /** The header beam, full width inside the safe area. */
  readonly header: Rect;
  /** The footer beam. Carries no control — the overlay's actions are all in the
   *  band — so it is structure, and the frame the DOWNLOAD LOG affordance
   *  (`src/net/playtest-log-button`) sits over in the bottom-right corner. */
  readonly footer: Rect;
  /** The strip inside the header beam the screen's name and its line sit in. */
  readonly title: Rect;
  /** One rect per button, in the model's button order. */
  readonly buttons: readonly Rect[];
  readonly isTouch: boolean;
  readonly metrics: FrameMetrics;
}

/**
 * Lay the overlay out for a viewport.
 *
 * `buttonIds` rather than a count, because the plates are no longer all one
 * height: the emphasised action is a `hero` plate and the rest are `standard`
 * ({@link pauseButtonPlate}), and size is half of what marks it as the primary.
 * They are centred in the band and **compress proportionally** rather than
 * overflowing, so that size difference survives a viewport too short to hold the
 * stack at full height.
 */
export function pauseLayout(
  viewport: Viewport,
  buttonIds: readonly PauseButton[],
  options: PauseLayoutOptions = {},
): PauseLayout {
  const isTouch = options.isTouch ?? false;
  const frame = gantryFrame(viewport, options.insets);
  const { metrics } = frame;

  const title = beamContent(frame.header, metrics);
  const columnWidth = Math.min(COLUMN.title, frame.band.width);
  const heights = buttonIds.map((id) => plateHeight(pauseButtonPlate(id).scale, metrics));
  const buttons = stackPlates(frame.band, columnWidth, heights, metrics.gap);

  return {
    content: frame.content,
    header: frame.header,
    footer: frame.footer,
    title,
    buttons,
    isTouch,
    metrics,
  };
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
 * enough to clear the top-left ORE readout — the corner itself is spoken for, and
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

/**
 * Side of the square pause button, CSS px.
 *
 * **48, not the 40 it shipped at (u7-05).** This is the one control on either of
 * these two screens that was under the thumb floor, and it is the one a player
 * reaches for mid-play on a phone — the touch-only way into the overlay. 40px is
 * `VALUE_CHIP`'s number, and {@link ../art/materials} `valueChipHeight` already
 * floors *that* at {@link TOUCH_MIN} everywhere for the same reason; this is the
 * same trade in the same direction ("where a literal metric cannot survive, the
 * look wins and the number adapts"). It stays clear of the ore total either way —
 * see {@link PAUSE_BUTTON_LEFT}.
 */
export const PAUSE_BUTTON_SIZE = TOUCH_MIN;
/** Inset from the top edge, matching the HUD's own `HUD_PAD`. */
export const PAUSE_BUTTON_MARGIN = 16;
/** Inset from the left edge — past the top-left ORE block (its label + a
 *  two-to-three digit banked number), so the button sits in the clear top band
 *  rather than over the one readout that shares this corner. This inset is sized
 *  by the NUMBER, not by the caption, which is why the caption's history —
 *  `TOTAL` → `BANKED` (l2-02) → `ORE` (a0-03) — has never moved it. `BANKED` was
 *  the widest of the three and still cleared; `ORE` is the narrowest. */
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
