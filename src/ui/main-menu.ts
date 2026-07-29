/**
 * src/ui/main-menu.ts — the main menu. OWNER: UI Engineer (GDD §3.7, §4.6 M7).
 *
 * The screen a clean boot opens on: the wordmark, PLAY, and SETTINGS. It is the
 * front door the field report found missing — the Day-7 menus merged, but boot
 * dropped the player "right in the match", so the menu was never reached. PLAY is
 * the *only* thing that builds a match world; SETTINGS opens the Day-7 settings
 * screen ({@link ./settings}). The wiring that gates the world on PLAY lives in
 * `src/main.ts`; this module only decides what the screen says and where a tap
 * lands.
 *
 * Same three-piece discipline as the rest of the directory: a pure, DOM-free
 * model with its layout co-located — a short stack of centred buttons needs no
 * responsive geometry of its own, so it borrows {@link ./menu-geometry} exactly
 * as the settings screen does — plus a thin Pixi view ({@link ./main-menu-view})
 * that draws it. Nothing here imports PixiJS, so the whole screen unit-tests
 * headless.
 */

import type { Rect, Viewport } from '@platform/layout-registry';
import {
  MENU_COLUMN_MAX,
  MENU_ROW_GAP,
  centeredColumn,
  hitRect,
  menuContent,
} from './menu-geometry';
import type { Insets } from './menu-geometry';

// ---------------------------------------------------------------------------
// The buttons
// ---------------------------------------------------------------------------

/** What a tap on the main menu resolves to. `play` builds an offline match (bots
 *  fill every other seat); `online` opens the room-code front door — CREATE a room
 *  and read the code out, or JOIN one somebody is holding up (M3/online); `codex`
 *  opens the optional reference (GDD §2.10) and comes back; `settings` opens the
 *  fire-mode / VFX / volume screen and comes back. */
export type MainMenuOption = 'play' | 'online' | 'codex' | 'settings';

/** One button's identity, in screen order. The layout, the view and the hit test
 *  all walk this same list, so a re-ordered screen can never mis-route a tap —
 *  the rule every screen in this directory keeps. */
export interface MainMenuItem {
  readonly kind: MainMenuOption;
  readonly label: string;
  /** PLAY is the primary action (plasma); SETTINGS is secondary (steel) — the
   *  same weighting the settings screen gives DONE against its rows. */
  readonly primary: boolean;
}

/** The buttons, top to bottom. PLAY is the one primary door (plasma) — the
 *  offline game is a complete product on its own and always works (GDD §4.8 risk
 *  6), so it stays the single emphasised action. ONLINE sits right under it: the
 *  room-code front door (CREATE / JOIN), fully active steel — a peer of PLAY, not
 *  a louder one. CODEX and SETTINGS are the two secondary screens that open and
 *  come back; like ONLINE they are active steel, never gray. */
export const MAIN_MENU_ITEMS: readonly MainMenuItem[] = [
  { kind: 'play', label: 'PLAY', primary: true },
  { kind: 'online', label: 'ONLINE', primary: false },
  { kind: 'codex', label: 'CODEX', primary: false },
  { kind: 'settings', label: 'SETTINGS', primary: false },
];

/** The wordmark, in Audiowide (style-guide §5.6) — the one place the game names
 *  itself before a match. */
export const MAIN_MENU_TITLE = 'PLANET RUSH';

// ---------------------------------------------------------------------------
// The per-frame model
// ---------------------------------------------------------------------------

/** One button as the view draws it. */
export interface MainMenuButtonView {
  readonly label: string;
  readonly primary: boolean;
}

/** The main menu for one frame. Static — it has no live values — but modelled the
 *  same way as its siblings so the view stays a pure function of it. */
export interface MainMenuModel {
  readonly title: string;
  readonly buttons: readonly MainMenuButtonView[];
}

/** Build the frame model. Pure: the view draws exactly this and decides nothing. */
export function mainMenuModel(): MainMenuModel {
  return {
    title: MAIN_MENU_TITLE,
    buttons: MAIN_MENU_ITEMS.map((item) => ({ label: item.label, primary: item.primary })),
  };
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** The wordmark band off the top of the content box. */
export const MAIN_MENU_TITLE_HEIGHT = 72;
/** A comfortable button on a desktop pointer… */
export const MAIN_MENU_BUTTON_HEIGHT = 56;
/** …and a fatter one under a thumb (matches the settings screen's touch rows). */
export const MAIN_MENU_BUTTON_HEIGHT_TOUCH = 64;

export interface MainMenuLayoutOptions {
  readonly isTouch?: boolean;
  readonly insets?: Insets;
}

/** The main menu's rects: the title band and one rect per {@link MAIN_MENU_ITEMS}
 *  in order. The arena picker used to reserve a band here; it now lives in the
 *  lobby (p2 field rule), so the menu is just the wordmark and its button stack. */
export interface MainMenuLayout {
  readonly content: Rect;
  readonly title: Rect;
  readonly buttons: readonly Rect[];
  readonly isTouch: boolean;
}

/**
 * Lay the screen out for a viewport. The wordmark sits off the top of the safe
 * content box; the buttons are centred in the band below it — capped so a desktop
 * gets a tidy 480px column rather than one full-width bar per option, and
 * compressed rather than overflowed on a short landscape phone (the same rule
 * {@link ./menu-geometry} `centeredColumn` keeps for the settings rows).
 */
export function mainMenuLayout(viewport: Viewport, options: MainMenuLayoutOptions = {}): MainMenuLayout {
  const isTouch = options.isTouch ?? false;
  const content = menuContent(viewport, options.insets);

  const titleHeight = Math.min(MAIN_MENU_TITLE_HEIGHT, content.height);
  const title: Rect = { x: content.x, y: content.y, width: content.width, height: titleHeight };

  const buttonBand: Rect = {
    x: content.x,
    y: title.y + titleHeight + MENU_ROW_GAP,
    width: content.width,
    height: Math.max(0, content.height - titleHeight - MENU_ROW_GAP),
  };
  const buttonHeight = isTouch ? MAIN_MENU_BUTTON_HEIGHT_TOUCH : MAIN_MENU_BUTTON_HEIGHT;
  const buttons = centeredColumn(buttonBand, MAIN_MENU_ITEMS.length, MENU_COLUMN_MAX, buttonHeight);

  return { content, title, buttons, isTouch };
}

/**
 * The option a tap at `(x, y)` hits, or `null`. A button's whole rect is live;
 * a zero-extent rect (a button squeezed to nothing on a tiny viewport) is never
 * hit, so an invisible control is an untappable one — the rule
 * {@link ./menu-geometry} `hitRect` keeps.
 */
export function mainMenuHitTest(layout: MainMenuLayout, x: number, y: number): MainMenuOption | null {
  for (let i = 0; i < layout.buttons.length; i++) {
    const rect = layout.buttons[i];
    const item = MAIN_MENU_ITEMS[i];
    if (rect && item && hitRect(rect, x, y)) return item.kind;
  }
  return null;
}

/** The main menu's layout-registry id and anchor: it owns the screen. */
export const MAIN_MENU_ID = 'main-menu';
