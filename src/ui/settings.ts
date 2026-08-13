/**
 * src/ui/settings.ts — the settings screen. OWNER: UI Engineer.
 *
 * The one place a player changes how the game plays and sounds before or between
 * matches (GDD §2.4 fire modes; §4.8 risk 5 "reduce VFX" as the perf escape
 * hatch). Three kinds of control, and no more:
 *
 *   FIRE MODE   Manual or Auto-aim — a real gameplay setting on every platform,
 *               not a touch concession (GDD §2.4). The *value* lives on the flow,
 *               because it rides the wire in every `lobbyChoice`; this screen only
 *               shows and toggles it, so its authority stays in one place.
 *   REDUCE VFX  The perf escape hatch (GDD §4.8 risk 5). A plain on/off the
 *               player can set, and the same flag the perf gate auto-engages when
 *               the frame rate sits below the floor — one boolean, two ways to
 *               flip it.
 *   VOLUMES     Master, SFX and music, each a level from silent to full in
 *               {@link VOLUME_STEPS} even steps, so a phone speaker and a
 *               classroom's shared laptop can each be tuned without a fiddly
 *               continuous slider on a canvas.
 *
 * Pure and DOM-free like every model here: it decides, {@link settingsLayout}
 * places, and `./settings-view` only draws what the two return. Everything the
 * game *does* with these — routing audio, dropping particle effects — is the
 * owner of the mixer and the renderer's job; this screen holds the numbers and
 * nothing else.
 */

import { FireMode } from '@platform/actions';
import type { ControlScheme, DeviceKind } from '@platform/actions';
import type { Rect, Viewport } from '@platform/layout-registry';
import { COLUMN, plateHeight, rowHeight, valueChipHeight } from '../art/materials';
import type { FrameMetrics, PlateRole } from '../art/materials';
import { beamContent, gantryFrame } from './gantry';
import { FONT_HEADING } from './typography';
import { centeredGrid, clamp, hitRect } from './menu-geometry';
import type { Insets } from './menu-geometry';

// ---------------------------------------------------------------------------
// The value
// ---------------------------------------------------------------------------

/**
 * How the player drives the ship (developer §3; GDD §2.4). `'sticks'` is the
 * default virtual-stick / keyboard / gamepad scheme; `'tap'` is Tap Commander,
 * where a tap places a move or a lock and the local pilot flies the ship.
 *
 * Like the fire mode, this is a real gameplay setting on every platform, not a
 * touch concession — and like the fire mode, its live value is owned by the
 * wiring layer (main.ts persists it to `planet-rush:controlScheme`, the same
 * storage family as the fire mode). The settings screen only shows and toggles
 * it, so the authority stays in one place; {@link settingsModel} reads it by
 * argument for exactly that reason.
 *
 * **The union itself now lives in the action layer** (`@platform/actions`) and
 * this is an alias of it — a0-37, when `describeBindings` began taking the scheme
 * and the binding map had to name the type it branches on. Nothing about the
 * value changed (the same two strings, the same name, the same import path for
 * everyone who reads it from here); what changed is that there is one definition
 * instead of three structurally-identical ones, so the strip, the prompts and
 * this screen cannot drift apart about what a scheme is. The *stored* strings
 * stay this module's ({@link CONTROL_SCHEME_STORAGE}): serialising a player's
 * preference is the settings screen's job, not the action map's.
 */
export type { ControlScheme };

/**
 * The exact string each scheme persists as, under `planet-rush:controlScheme`.
 *
 * Stated as data, and read by both halves of the round trip below, because the
 * player-facing wording moved away from the internal name in u8-01 and the
 * stored value did **not**: a save written by any earlier build still says
 * `sticks`, and it has to keep meaning the default scheme. A future rename of
 * the {@link ControlScheme} union must therefore leave these two strings alone
 * — `settings.test.ts` asserts them literally, so it cannot happen quietly.
 */
export const CONTROL_SCHEME_STORAGE: Record<ControlScheme, string> = {
  sticks: 'sticks',
  tap: 'tap',
};

/** The string to persist for a scheme. */
export function storedControlScheme(scheme: ControlScheme): string {
  return CONTROL_SCHEME_STORAGE[scheme];
}

/** The scheme a stored value seats. Anything unrecognised — a stale key, a
 *  hand-edited save, a value from a build that shipped a scheme we since cut —
 *  folds to the default, so nothing a player ever saved can seat an unknown
 *  scheme. */
export function parseControlScheme(stored: string | null | undefined): ControlScheme {
  return stored === CONTROL_SCHEME_STORAGE.tap ? 'tap' : 'sticks';
}

// ---------------------------------------------------------------------------
// What the CONTROLS row is allowed to say (u8-01)
// ---------------------------------------------------------------------------

/**
 * The word for the default scheme, per device — the fix for u8-01.
 *
 * `'sticks'` is the scheme's INTERNAL name, and the row used to print it
 * verbatim on every device: a PC with no sticks on screen and none in the
 * player's hands read `CONTROLS · STICKS`, which is simply false (developer
 * field report, 2026-08-06, with the screenshot). The internal name did not
 * move — see {@link CONTROL_SCHEME_STORAGE} — only the word the player reads:
 *
 *   `touch`     the virtual sticks are real and on the glass, so STICKS stands.
 *   `gamepad`   TWIN STICKS — the pad genuinely has two, and it is named only
 *               when one is actually detected (the report's condition).
 *   `keyboard`  KEYBOARD + MOUSE, not "MOUSE ONLY": the bindings settle it —
 *               thrust is `WASD`, aim is `Mouse`, fire is `Left mouse`
 *               (`describeBindings`), so a player cannot move without the
 *               keyboard and "mouse only" would swap one false label for
 *               another.
 */
export const STICKS_LABELS: Record<DeviceKind, string> = {
  touch: 'STICKS',
  gamepad: 'TWIN STICKS',
  keyboard: 'KEYBOARD + MOUSE',
};

/** Tap Commander reads the same on every device: it is a scheme, not a device,
 *  and a tap is a tap whether it lands from a finger or a mouse. */
export const TAP_COMMANDER_LABEL = 'TAP COMMANDER';

/** The word the CONTROLS row shows: the scheme decides first, and only the
 *  default scheme has anything device-dependent to say. */
export function controlsValue(scheme: ControlScheme, device: DeviceKind): string {
  return scheme === 'tap' ? TAP_COMMANDER_LABEL : STICKS_LABELS[device];
}

/** What the wiring layer knows about the hardware, and all this screen needs of
 *  it. Deliberately two booleans rather than a `navigator`: the model stays pure
 *  and headless-testable, and sniffing the browser stays the platform's job. */
export interface ControlsDeviceInputs {
  /** A touch device — the same test the rest of the wiring layer already makes. */
  readonly isTouch: boolean;
  /** A pad is connected RIGHT NOW (`gamepadconnected` / `gamepaddisconnected`),
   *  not "a pad was used at some point": a stale TWIN STICKS after the pad's
   *  battery dies is the same class of lie u8-01 exists to remove. */
  readonly gamepadConnected: boolean;
}

/**
 * Which device the CONTROLS row describes.
 *
 * Two precedence calls, both deliberate. **A pad beats the keyboard** when one
 * is connected, per the report ("unless someone is playing with gamepad… then we
 * can call it TWIN STICKS"), and it beats it on connection rather than on use,
 * because the row is a standing description of the hardware and not a readout of
 * whatever was touched last. **Touch beats everything**, because on a phone the
 * virtual sticks are drawn on the glass in front of the player — STICKS is
 * literally true there no matter what else is plugged in.
 */
export function controlsDevice({ isTouch, gamepadConnected }: ControlsDeviceInputs): DeviceKind {
  if (isTouch) return 'touch';
  return gamepadConnected ? 'gamepad' : 'keyboard';
}

/** The three mixer channels the player can set independently. */
export type VolumeChannel = 'master' | 'sfx' | 'music';

/** Volume order, top to bottom, as the screen lists them. */
export const VOLUME_CHANNELS: readonly VolumeChannel[] = ['master', 'sfx', 'music'];

/** Each channel's level, a fraction in `[0, 1]`. */
export interface Volumes {
  readonly master: number;
  readonly sfx: number;
  readonly music: number;
}

/**
 * The persisted settings, as one immutable value.
 *
 * Deliberately *not* holding the fire mode: that value is carried on the flow
 * ({@link ./lobby-flow} `FlowState.fireMode`) because every pre-match
 * `lobbyChoice` sends it, and a setting with two homes is a setting that drifts.
 * The settings screen reads the fire mode as an argument and toggles it through
 * the flow — see {@link settingsModel}.
 */
export interface SettingsState {
  /** The perf escape hatch (GDD §4.8 risk 5). */
  readonly reduceVfx: boolean;
  readonly volumes: Volumes;
}

/** How many discrete steps a volume slider has, silent (0) to full. Ten is
 *  enough to tune a room and coarse enough to hit reliably on a phone. */
export const VOLUME_STEPS = 10;

/** One step of a volume slider. */
export const VOLUME_STEP = 1 / VOLUME_STEPS;

/** The starting mix. Effects a touch under full, music quieter still — the game
 *  is loud with fire and rock, and the bed should sit under it (art & audio own
 *  the final mix; this is only the default the slider opens on). */
export const DEFAULT_VOLUMES: Volumes = { master: 0.8, sfx: 0.8, music: 0.6 };

/** A fresh settings value: VFX on, the default mix. */
export function createSettings(): SettingsState {
  return { reduceVfx: false, volumes: { ...DEFAULT_VOLUMES } };
}

// ---------------------------------------------------------------------------
// Changing it
// ---------------------------------------------------------------------------

/** Flip the reduce-VFX flag. */
export function toggleReduceVfx(state: SettingsState): SettingsState {
  return { ...state, reduceVfx: !state.reduceVfx };
}

/** Set the reduce-VFX flag outright — the seam the perf gate flips when the
 *  frame rate sits below the floor (GDD §4.8 risk 5). A no-op when unchanged, so
 *  the gate re-asserting it every frame never churns a new object. */
export function setReduceVfx(state: SettingsState, reduceVfx: boolean): SettingsState {
  return state.reduceVfx === reduceVfx ? state : { ...state, reduceVfx };
}

/** Set one channel to an exact level, clamped to `[0, 1]`. A no-op (identical
 *  object) when the clamped value already matches, so a slider dragged against
 *  its stop stops churning state. */
export function setVolume(state: SettingsState, channel: VolumeChannel, level: number): SettingsState {
  const next = clamp(level, 0, 1);
  if (state.volumes[channel] === next) return state;
  return { ...state, volumes: { ...state.volumes, [channel]: next } };
}

/**
 * Nudge a channel one step, up (`+1`) or down (`-1`). Snaps to the step grid
 * first, so a channel the perf gate or a save file left on an odd fraction still
 * lands on a clean step rather than drifting off-grid one press at a time.
 */
export function adjustVolume(state: SettingsState, channel: VolumeChannel, dir: 1 | -1): SettingsState {
  const step = Math.round(state.volumes[channel] / VOLUME_STEP);
  return setVolume(state, channel, (step + dir) * VOLUME_STEP);
}

/** A channel's level as a whole number of steps, `0..VOLUME_STEPS` — what the
 *  view fills as pips and what a test asserts against without float noise. */
export function volumeLevel(state: SettingsState, channel: VolumeChannel): number {
  return Math.round(state.volumes[channel] / VOLUME_STEP);
}

// ---------------------------------------------------------------------------
// The rows the screen is made of
// ---------------------------------------------------------------------------

/** One row's identity, in screen order. The layout, the view and the hit test
 *  all walk this same list, so a re-ordered screen can never mis-route a tap. */
export type SettingsRowSpec =
  | { readonly kind: 'fireMode' }
  | { readonly kind: 'controls' }
  | { readonly kind: 'reduceVfx' }
  | { readonly kind: 'volume'; readonly channel: VolumeChannel };

/** The rows, top to bottom. The two that change how the game *plays* — fire mode
 *  and the control scheme — lead, ahead of the perf hatch and the volumes that
 *  only change how it looks and sounds. */
export const SETTINGS_ROWS: readonly SettingsRowSpec[] = [
  { kind: 'fireMode' },
  { kind: 'controls' },
  { kind: 'reduceVfx' },
  ...VOLUME_CHANNELS.map((channel) => ({ kind: 'volume', channel }) as const),
];

/** What a tap on the settings screen changed. */
export type SettingsTarget =
  | { readonly kind: 'fireMode' }
  | { readonly kind: 'controls' }
  | { readonly kind: 'reduceVfx' }
  | { readonly kind: 'volume'; readonly channel: VolumeChannel; readonly dir: 1 | -1 }
  | { readonly kind: 'back' };

// ---------------------------------------------------------------------------
// The per-frame model
// ---------------------------------------------------------------------------

/** A control's interaction state, as the view draws it. Mirrors `materials.ts`
 *  `PlateState`; restated here so a consumer of the model need not import art. */
export type SettingsControlState = 'rest' | 'hover' | 'press';

/** What the pointer is doing on the screen. A volume row's −/+ are separate
 *  targets, so hover/press are addressed by the same {@link SettingsTarget} the
 *  hit test returns rather than by row index. */
export interface SettingsPointer {
  readonly hover?: SettingsTarget | null;
  readonly press?: SettingsTarget | null;
}

/** One row, as the view draws it: a label on the left and, on the right, either
 *  a toggle chip (`value`) or a stepped volume bar (`level` / `max`). */
export interface SettingsRowView {
  readonly kind: SettingsRowSpec['kind'];
  readonly label: string;
  /** For a toggle: the current word (`MANUAL` / `ON`). Empty for a volume. */
  readonly value: string;
  /** For a toggle: whether it reads as "engaged". Under Gantry/Bone this is no
   *  longer a hue — the settings screen spends none — so an engaged toggle is
   *  the brightest *hairline* on the chip, not a coloured one. */
  readonly on: boolean;
  /** The row plate's state. A row is an `inert` plate: a surface that holds the
   *  control, hovered and pressed but never bright. */
  readonly state: SettingsControlState;
  /** For a volume: the filled step count and the total. */
  readonly channel?: VolumeChannel;
  readonly level?: number;
  readonly max?: number;
  /** For a volume: the −/+ steppers' own states. */
  readonly minusState?: SettingsControlState;
  readonly plusState?: SettingsControlState;
}

/** The settings screen for one frame. */
export interface SettingsModel {
  readonly title: string;
  /** The header beam's right-hand eyebrow, verbatim from the handoff. It is the
   *  screen's one piece of instruction, and it is true: every row applies the
   *  instant it is tapped, which is also why the way out says DONE. */
  readonly eyebrow: string;
  readonly rows: readonly SettingsRowView[];
  /** The way out. `DONE` rather than `BACK`: the changes are already applied, so
   *  the button confirms rather than cancels — there is nothing to discard. */
  readonly backLabel: string;
  /** DONE's plate state. */
  readonly backState: SettingsControlState;
  /**
   * DONE is this screen's ONE bright plate; every row is `inert`. That is the
   * constraint the Bone accent carries with it (`./gantry` `singlePrimary`), and
   * `settings.test.ts` holds the screen to it.
   */
  readonly backRole: PlateRole;
}

/** The header beam's eyebrow, from the handoff's settings screen. */
export const SETTINGS_EYEBROW = 'CHANGES SAVE IMMEDIATELY';

/**
 * Build the frame model. Pure: the view draws exactly this and decides nothing.
 * Takes the fire mode, the control scheme AND the device by argument because the
 * wiring layer owns each (see {@link SettingsState}, {@link ControlScheme},
 * {@link controlsDevice}), so the one screen that shows every control value still
 * reads them from their single sources of truth rather than keeping a second,
 * driftable copy — and so this model never touches `navigator`.
 *
 * `device` is required rather than defaulted: a caller that forgets it would
 * print a confident sentence about hardware the player does not have, which is
 * the whole of u8-01.
 */
export function settingsModel(
  state: SettingsState,
  fireMode: FireMode,
  controlScheme: ControlScheme,
  device: DeviceKind,
  pointer: SettingsPointer = {},
): SettingsModel {
  /** The state of one target: pressed beats hovered, and neither is at rest. */
  const stateOf = (target: SettingsTarget): SettingsControlState =>
    sameTarget(pointer.press, target) ? 'press' : sameTarget(pointer.hover, target) ? 'hover' : 'rest';

  const rows: SettingsRowView[] = SETTINGS_ROWS.map((spec) => {
    switch (spec.kind) {
      case 'fireMode':
        return {
          kind: 'fireMode',
          label: 'FIRE MODE',
          value: fireMode === FireMode.AutoAim ? 'AUTO-AIM' : 'MANUAL',
          on: fireMode === FireMode.AutoAim,
          state: stateOf({ kind: 'fireMode' }),
        };
      case 'controls':
        // The ratified wording (u8-01, 2026-08-06, superseding p6-01's flat
        // "CONTROLS: STICKS / TAP COMMANDER"): the label still names the setting
        // and the pill still shows the seated scheme, but the default scheme's
        // word is now the one that is TRUE on the device in front of the player —
        // STICKS on touch, TWIN STICKS with a pad, KEYBOARD + MOUSE on a PC
        // ({@link STICKS_LABELS}). Tap Commander is unchanged on every device, and
        // is still the engaged (plasma) state — the opt-in layer over the default.
        return {
          kind: 'controls',
          label: 'CONTROLS',
          value: controlsValue(controlScheme, device),
          on: controlScheme === 'tap',
          state: stateOf({ kind: 'controls' }),
        };
      case 'reduceVfx':
        return {
          kind: 'reduceVfx',
          label: 'REDUCE VFX',
          value: state.reduceVfx ? 'ON' : 'OFF',
          on: state.reduceVfx,
          state: stateOf({ kind: 'reduceVfx' }),
        };
      case 'volume':
        return {
          kind: 'volume',
          label: VOLUME_LABELS[spec.channel],
          value: '',
          on: state.volumes[spec.channel] > 0,
          // The bar between the steppers is a readout, not a control, so the row
          // plate itself never lights up — only its two ends do.
          state: 'rest',
          channel: spec.channel,
          level: volumeLevel(state, spec.channel),
          max: VOLUME_STEPS,
          minusState: stateOf({ kind: 'volume', channel: spec.channel, dir: -1 }),
          plusState: stateOf({ kind: 'volume', channel: spec.channel, dir: 1 }),
        };
    }
  });
  return {
    title: 'SETTINGS',
    eyebrow: SETTINGS_EYEBROW,
    rows,
    backLabel: 'DONE',
    backState: stateOf({ kind: 'back' }),
    backRole: 'primary',
  };
}

/**
 * Whether two hit-test targets name the same control. Structural, because the
 * wiring layer hands back whatever {@link settingsHitTest} returned and those are
 * fresh objects every call — identity would never match. Two nulls (the pointer
 * is off every control) are the same target; one null is not.
 */
export function sameTarget(
  a: SettingsTarget | null | undefined,
  b: SettingsTarget | null | undefined,
): boolean {
  if (!a || !b) return !a && !b;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'volume' && b.kind === 'volume') return a.channel === b.channel && a.dir === b.dir;
  return true;
}

const VOLUME_LABELS: Record<VolumeChannel, string> = {
  master: 'MASTER VOLUME',
  sfx: 'SFX VOLUME',
  music: 'MUSIC VOLUME',
};

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** The −/+ buttons on a volume row are squares hung off the row's right edge. */
export const VOLUME_BUTTON_GAP = 6;
/**
 * The most columns the rows may wrap into. A phone under the landscape lock gives
 * the screen a wide-but-short logical viewport; a single stack of every row would
 * have to shrink each one to a sub-thumb sliver to fit that height (the field
 * report: the CONTROLS row "wasn't there" on the developer's phone — it was there,
 * just crushed). Two columns spend the width the phone has to keep every row —
 * CONTROLS included — at its full thumb height. Desktop, with height to spare,
 * never leaves one column. */
export const SETTINGS_MAX_COLUMNS = 2;

export interface SettingsLayoutOptions {
  readonly isTouch?: boolean;
  readonly insets?: Insets;
}

/**
 * The settings screen's rects.
 *
 * Under Gantry/Bone the heading and the way out live **in the beams**: SETTINGS
 * is drawn in the header, DONE is a plate in the footer, and the rows own the
 * whole band between. `title` therefore names the strip inside the header beam
 * rather than a slice of the content box, and `back` is the footer's plate.
 */
export interface SettingsLayout {
  readonly content: Rect;
  readonly header: Rect;
  readonly footer: Rect;
  /** The heading's strip inside the header beam. */
  readonly title: Rect;
  readonly rows: readonly Rect[];
  /** The DONE plate, right-aligned in the footer beam (handoff). */
  readonly back: Rect;
  /** A volume row's −/+ square size, so the hit test and the view agree. */
  readonly stepper: number;
  readonly isTouch: boolean;
  readonly metrics: FrameMetrics;
}

/** DONE's width at the reference — the handoff's 300px footer plate. */
const BACK_WIDTH = 300;

/**
 * Lay the screen out for a viewport. Heading in the header beam, DONE in the
 * footer beam, the rows centred in the band between.
 *
 * The two-column wrap is unchanged and still load-bearing: a phone under the
 * landscape lock gives the screen a wide-but-short logical viewport, and six
 * thumb-height rows do not stack into 260px of band. What changed is where the
 * numbers come from — {@link ../art/materials} `rowHeight` and `frameMetrics`
 * rather than a pair of hand-picked desktop/touch constants — so the row height
 * is the handoff's 64px on a desktop and the thumb floor on a phone, derived
 * once for every screen in the set.
 */
export function settingsLayout(viewport: Viewport, options: SettingsLayoutOptions = {}): SettingsLayout {
  const isTouch = options.isTouch ?? false;
  const frame = gantryFrame(viewport, options.insets);
  const { metrics } = frame;

  const title = beamContent(frame.header, metrics);

  const footerStrip = beamContent(frame.footer, metrics, 'footer');
  const backHeight = Math.min(plateHeight('compact', metrics), footerStrip.height);
  const backWidth = Math.min(Math.round(BACK_WIDTH * metrics.plateScale), footerStrip.width);
  const back: Rect = {
    x: footerStrip.x + footerStrip.width - backWidth,
    y: footerStrip.y + (footerStrip.height - backHeight) / 2,
    width: Math.max(0, backWidth),
    height: Math.max(0, backHeight),
  };

  const band = frame.band;
  const rowH = rowHeight(metrics);
  const gap = metrics.rowGap;
  const columnWidth = Math.min(COLUMN.settings, band.width);
  // How many rows fit in one column at the full (thumb) row height? If fewer than
  // all of them, wrap into as many columns as it takes — capped — so no row is
  // ever compressed below its target just to fit the height. On a tall desktop
  // every row fits in one column and this is a no-op.
  const perColumnFit = Math.floor((band.height + gap) / (rowH + gap));
  const columns = Math.min(
    SETTINGS_MAX_COLUMNS,
    Math.max(1, Math.ceil(SETTINGS_ROWS.length / Math.max(1, perColumnFit))),
  );
  const rows = centeredGrid(band, SETTINGS_ROWS.length, columnWidth, rowH, columns, gap, metrics.gap);
  const stepper = stepperSize(rows[0], metrics);

  return { content: frame.content, header: frame.header, footer: frame.footer, title, rows, back, stepper, isTouch, metrics };
}

/** The −/+ square's edge: the handoff's 40px, never under the thumb floor, and
 *  never taller than the row it hangs off or wider than a sixth of it. */
function stepperSize(row: Rect | undefined, m: FrameMetrics): number {
  if (!row) return 0;
  return Math.max(0, Math.min(valueChipHeight(m), row.height, row.width / 6));
}

/**
 * The −/+ button squares on a volume row, hung off its right edge. Shared by the
 * hit test and the view so the button a finger lands on is the button that was
 * drawn there. The bar fills the space to their left.
 *
 * `size` comes from {@link SettingsLayout.stepper}; the default keeps a caller
 * that has only a rect working, at the pre-Gantry sizing.
 */
export function volumeButtons(
  row: Rect,
  size = Math.max(0, Math.min(row.height, row.width / 6)),
): { minus: Rect; plus: Rect; bar: Rect } {
  const s = Math.max(0, Math.min(size, row.width / 2));
  // The squares are centred in the row's height — a 40px stepper on a 64px row
  // is the handoff's proportion, and it is what stops the control reading as a
  // full-height bar glued to the plate's edge.
  const y = row.y + (row.height - s) / 2;
  const plus: Rect = { x: row.x + row.width - s, y, width: s, height: s };
  const minus: Rect = { x: plus.x - VOLUME_BUTTON_GAP - s, y, width: s, height: s };
  const barRight = minus.x - VOLUME_BUTTON_GAP;
  const bar: Rect = { x: row.x, y: row.y, width: Math.max(0, barRight - row.x), height: row.height };
  return { minus, plus, bar };
}

/**
 * The target a tap at `(x, y)` hits, or `null`.
 *
 * A row's whole width is live for a toggle (tap anywhere on the fire-mode row to
 * flip it); a volume row only responds on its two end buttons, because the bar
 * between them is a readout, not a control — a stray tap on the bar must not jump
 * the level to wherever the finger landed.
 */
export function settingsHitTest(layout: SettingsLayout, x: number, y: number): SettingsTarget | null {
  if (hitRect(layout.back, x, y)) return { kind: 'back' };
  for (let i = 0; i < layout.rows.length; i++) {
    const rect = layout.rows[i];
    const spec = SETTINGS_ROWS[i];
    if (!rect || !spec || !hitRect(rect, x, y)) continue;
    if (spec.kind === 'fireMode') return { kind: 'fireMode' };
    if (spec.kind === 'controls') return { kind: 'controls' };
    if (spec.kind === 'reduceVfx') return { kind: 'reduceVfx' };
    const { minus, plus } = volumeButtons(rect, layout.stepper);
    if (hitRect(plus, x, y)) return { kind: 'volume', channel: spec.channel, dir: 1 };
    if (hitRect(minus, x, y)) return { kind: 'volume', channel: spec.channel, dir: -1 };
    return null; // the bar itself is inert
  }
  return null;
}

/** The settings screen's layout-registry id and anchor: it owns the screen. */
export const SETTINGS_ID = 'settings';
export const SETTINGS_FONT = FONT_HEADING;
