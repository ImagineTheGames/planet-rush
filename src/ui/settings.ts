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
import type { Rect, Viewport } from '@platform/layout-registry';
import { FONT_HEADING } from './typography';
import {
  MENU_COLUMN_MAX,
  MENU_ROW_GAP,
  centeredColumn,
  clamp,
  hitRect,
  menuContent,
} from './menu-geometry';
import type { Insets } from './menu-geometry';

// ---------------------------------------------------------------------------
// The value
// ---------------------------------------------------------------------------

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
  | { readonly kind: 'reduceVfx' }
  | { readonly kind: 'volume'; readonly channel: VolumeChannel };

/** The rows, top to bottom. Fire mode first — it is the one that changes how the
 *  game plays, not merely how it sounds. */
export const SETTINGS_ROWS: readonly SettingsRowSpec[] = [
  { kind: 'fireMode' },
  { kind: 'reduceVfx' },
  ...VOLUME_CHANNELS.map((channel) => ({ kind: 'volume', channel }) as const),
];

/** What a tap on the settings screen changed. */
export type SettingsTarget =
  | { readonly kind: 'fireMode' }
  | { readonly kind: 'reduceVfx' }
  | { readonly kind: 'volume'; readonly channel: VolumeChannel; readonly dir: 1 | -1 }
  | { readonly kind: 'back' };

// ---------------------------------------------------------------------------
// The per-frame model
// ---------------------------------------------------------------------------

/** One row, as the view draws it: a label on the left and, on the right, either
 *  a toggle pill (`value`) or a stepped volume bar (`level` / `max`). */
export interface SettingsRowView {
  readonly kind: SettingsRowSpec['kind'];
  readonly label: string;
  /** For a toggle: the current word (`MANUAL` / `ON`). Empty for a volume. */
  readonly value: string;
  /** For a toggle: whether it reads as "engaged" (plasma) or "off" (steel). */
  readonly on: boolean;
  /** For a volume: the filled step count and the total. */
  readonly channel?: VolumeChannel;
  readonly level?: number;
  readonly max?: number;
}

/** The settings screen for one frame. */
export interface SettingsModel {
  readonly title: string;
  readonly rows: readonly SettingsRowView[];
  /** The way out. `DONE` rather than `BACK`: the changes are already applied, so
   *  the button confirms rather than cancels — there is nothing to discard. */
  readonly backLabel: string;
}

/**
 * Build the frame model. Pure: the view draws exactly this and decides nothing.
 * Takes the fire mode by argument because the flow owns it (see
 * {@link SettingsState}), so the one screen that shows all four control values
 * still reads them from their single sources of truth.
 */
export function settingsModel(state: SettingsState, fireMode: FireMode): SettingsModel {
  const rows: SettingsRowView[] = SETTINGS_ROWS.map((spec) => {
    switch (spec.kind) {
      case 'fireMode':
        return {
          kind: 'fireMode',
          label: 'FIRE MODE',
          value: fireMode === FireMode.AutoAim ? 'AUTO-AIM' : 'MANUAL',
          on: fireMode === FireMode.AutoAim,
        };
      case 'reduceVfx':
        return {
          kind: 'reduceVfx',
          label: 'REDUCE VFX',
          value: state.reduceVfx ? 'ON' : 'OFF',
          on: state.reduceVfx,
        };
      case 'volume':
        return {
          kind: 'volume',
          label: VOLUME_LABELS[spec.channel],
          value: '',
          on: state.volumes[spec.channel] > 0,
          channel: spec.channel,
          level: volumeLevel(state, spec.channel),
          max: VOLUME_STEPS,
        };
    }
  });
  return { title: 'SETTINGS', rows, backLabel: 'DONE' };
}

const VOLUME_LABELS: Record<VolumeChannel, string> = {
  master: 'MASTER VOLUME',
  sfx: 'SFX VOLUME',
  music: 'MUSIC VOLUME',
};

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export const SETTINGS_TITLE_HEIGHT = 44;
export const SETTINGS_ROW_HEIGHT = 48;
export const SETTINGS_ROW_HEIGHT_TOUCH = 60;
export const SETTINGS_BACK_HEIGHT = 48;
export const SETTINGS_BACK_HEIGHT_TOUCH = 56;
/** The −/+ buttons on a volume row are squares hung off the row's right edge. */
export const VOLUME_BUTTON_GAP = 6;

export interface SettingsLayoutOptions {
  readonly isTouch?: boolean;
  readonly insets?: Insets;
}

/** The settings screen's rects: the title band, one rect per {@link SETTINGS_ROWS}
 *  in order, and the DONE button. */
export interface SettingsLayout {
  readonly content: Rect;
  readonly title: Rect;
  readonly rows: readonly Rect[];
  readonly back: Rect;
  readonly isTouch: boolean;
}

/**
 * Lay the screen out for a viewport. Title off the top, DONE off the bottom, the
 * rows centred in the band between — capped so a desktop gets a tidy 480px
 * column rather than one full-width row per setting.
 */
export function settingsLayout(viewport: Viewport, options: SettingsLayoutOptions = {}): SettingsLayout {
  const isTouch = options.isTouch ?? false;
  const content = menuContent(viewport, options.insets);

  const titleHeight = Math.min(SETTINGS_TITLE_HEIGHT, content.height);
  const title: Rect = { x: content.x, y: content.y, width: content.width, height: titleHeight };

  const backHeight = Math.min(
    isTouch ? SETTINGS_BACK_HEIGHT_TOUCH : SETTINGS_BACK_HEIGHT,
    Math.max(0, content.height - titleHeight),
  );
  const backWidth = Math.min(MENU_COLUMN_MAX, content.width);
  const back: Rect = {
    x: content.x + (content.width - backWidth) / 2,
    y: content.y + content.height - backHeight,
    width: backWidth,
    height: backHeight,
  };

  const band: Rect = {
    x: content.x,
    y: title.y + titleHeight + MENU_ROW_GAP,
    width: content.width,
    height: Math.max(0, back.y - MENU_ROW_GAP - (title.y + titleHeight + MENU_ROW_GAP)),
  };
  const rowHeight = isTouch ? SETTINGS_ROW_HEIGHT_TOUCH : SETTINGS_ROW_HEIGHT;
  const rows = centeredColumn(band, SETTINGS_ROWS.length, MENU_COLUMN_MAX, rowHeight);

  return { content, title, rows, back, isTouch };
}

/**
 * The −/+ button squares on a volume row, hung off its right edge. Shared by the
 * hit test and the view so the button a finger lands on is the button that was
 * drawn there. The bar fills the space to their left.
 */
export function volumeButtons(row: Rect): { minus: Rect; plus: Rect; bar: Rect } {
  const size = Math.max(0, Math.min(row.height, row.width / 6));
  const plus: Rect = { x: row.x + row.width - size, y: row.y, width: size, height: row.height };
  const minus: Rect = {
    x: plus.x - VOLUME_BUTTON_GAP - size,
    y: row.y,
    width: size,
    height: row.height,
  };
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
    if (spec.kind === 'reduceVfx') return { kind: 'reduceVfx' };
    const { minus, plus } = volumeButtons(rect);
    if (hitRect(plus, x, y)) return { kind: 'volume', channel: spec.channel, dir: 1 };
    if (hitRect(minus, x, y)) return { kind: 'volume', channel: spec.channel, dir: -1 };
    return null; // the bar itself is inert
  }
  return null;
}

/** The settings screen's layout-registry id and anchor: it owns the screen. */
export const SETTINGS_ID = 'settings';
export const SETTINGS_FONT = FONT_HEADING;
