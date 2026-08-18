/**
 * src/ui/main-menu.ts — the main menu. OWNER: UI Engineer (GDD §3.7, §4.6 M7).
 *
 * The screen a clean boot opens on: the wordmark, PLAY, CODEX and SETTINGS. It is
 * the front door the field report found missing — the Day-7 menus merged, but boot
 * dropped the player "right in the match", so the menu was never reached.
 *
 * **PLAY opens the doors, and it is the only way in** (ratified: one play flow).
 * PLAY leads to {@link ./lobby-entry} — SOLO / HOST / JOIN — and
 * all three of those lead to the *same* lobby ({@link ./lobby}), offline or
 * online. Nothing on this screen builds a match world; SETTINGS opens the Day-7
 * settings screen ({@link ./settings}). The wiring lives in `src/main.ts`; this
 * module only decides what the screen says and where a tap lands.
 *
 * Same three-piece discipline as the rest of the directory: a pure, DOM-free
 * model with its layout co-located — a short stack of centred buttons needs no
 * responsive geometry of its own, so it borrows {@link ./menu-geometry} exactly
 * as the settings screen does — plus a thin Pixi view ({@link ./main-menu-view})
 * that draws it. Nothing here imports PixiJS, so the whole screen unit-tests
 * headless.
 */

import type { Rect, Viewport } from '@platform/layout-registry';
import { COLUMN, plateHeight } from '../art/materials';
import type { FrameMetrics, PlateRole, PlateScale } from '../art/materials';
import { beamContent, gantryFrame, menuColumnWidth, stackPlates } from './gantry';
import { hitRect } from './menu-geometry';
import type { Insets } from './menu-geometry';
import { CODEX_TABS } from './codex';
import type { NavScreen } from './menu-nav';

// ---------------------------------------------------------------------------
// The buttons
// ---------------------------------------------------------------------------

/**
 * What a tap on the main menu resolves to.
 *
 * `play` opens **the doors** — SOLO / HOST / JOIN
 * ({@link ./lobby-entry}) — and nothing else. It does not build a match and it no
 * longer has an offline lobby of its own: the developer ratified ONE way in
 * ("PLAY → goes to the same online menu, which already has offline play … right
 * now PLAY going to a separate offline lobby is just redundant"), so the second
 * front door that used to sit under it (ONLINE) is gone and this one option leads
 * to all three ways a match starts.
 *
 * `codex` opens the optional reference (GDD §2.10) and comes back; `settings`
 * opens the fire-mode / VFX / volume screen and comes back; `hangar` opens the
 * fourth door (a0-14) — your ship, your level, and what a level has unlocked —
 * and comes back too.
 */
export type MainMenuOption = 'play' | 'codex' | 'settings' | 'hangar';

/** One button's identity, in screen order. The layout, the view and the hit test
 *  all walk this same list, so a re-ordered screen can never mis-route a tap —
 *  the rule every screen in this directory keeps. */
export interface MainMenuItem {
  readonly kind: MainMenuOption;
  readonly label: string;
  /**
   * PLAY is the primary action; CODEX and SETTINGS are secondary. Under
   * Gantry/Bone that is no longer a *colour* difference — Bone spends no hue on
   * the menu, so the primary is simply the brightest and largest plate on the
   * screen, and there is exactly one ({@link ./gantry} `singlePrimary`).
   */
  readonly primary: boolean;
  /**
   * The line under the label. Sentence case, one clause, naming what is behind
   * the door — the handoff's own construction for the two plates it draws
   * (`Open a rig and take the field`, `Controls, audio, visual effects`).
   */
  readonly sub: string;
}

/**
 * CODEX's sub-line. The handoff has no CODEX plate, so rather than invent a line
 * of voice this names the screen's own tabs — the same construction the
 * handoff uses for SETTINGS, which names that screen's own rows.
 * {@link ./main-menu.test} pins it to {@link CODEX_TABS}, so a fifth tab cannot
 * leave the menu describing four.
 */
export function codexSubLine(): string {
  return CODEX_TABS.map((t) => t.label.charAt(0) + t.label.slice(1).toLowerCase()).join(', ');
}

/** The plate role and size each item is drawn at (`src/art/materials.ts`). The
 *  primary is a `hero` plate and the rest are `standard` — brightness AND size,
 *  which is the whole of what Bone has to mark an action with. */
export function itemPlate(item: MainMenuItem): { role: PlateRole; scale: PlateScale } {
  return item.primary ? { role: 'primary', scale: 'hero' } : { role: 'secondary', scale: 'standard' };
}

/**
 * The buttons, top to bottom. **PLAY is the only door into a match** (plasma, the
 * one primary action) and it opens the three ways in rather than one of them: the
 * ratified single play flow. There used to be a second button here — ONLINE —
 * whose screen already carried the solo door, which made PLAY a redundant shortcut to
 * an offline lobby the doors screen could reach anyway; two front doors is one
 * more than a player can be told about, so the redundant one was removed rather
 * than relabelled.
 *
 * CODEX, SETTINGS and HANGAR are the three secondary screens that open and come
 * back — active steel, never gray (the gray-means-disabled theme rule).
 *
 * **HANGAR is appended, and the first three do not move** (a0-14: the existing
 * items, their order and the codex sub-line are all things that must not
 * change). It is a door that comes back, like the two above it, so it is
 * secondary: PLAY is still the screen's one bright plate.
 */
export const MAIN_MENU_ITEMS: readonly MainMenuItem[] = [
  // The two sub-lines the handoff draws are taken verbatim; CODEX's is derived
  // from its own tabs (see `codexSubLine`). No new voice is invented here — the
  // industrial-voice sweep (docs/copy-sweep-industrial-voice.md §3.1) holds
  // PLAY / CODEX / SETTINGS as they are pending the developer's answer to its Q1.
  { kind: 'play', label: 'PLAY', primary: true, sub: 'Open a rig and take the field' },
  { kind: 'codex', label: 'CODEX', primary: false, sub: codexSubLine() },
  { kind: 'settings', label: 'SETTINGS', primary: false, sub: 'Controls, audio, visual effects' },
  // The hangar's own line, in the same construction as SETTINGS': it names what
  // is behind the door rather than promising content. It is honest on the day it
  // ships, when there is nothing to unlock yet — see `./hangar`.
  { kind: 'hangar', label: 'HANGAR', primary: false, sub: 'Your ship, your level, what you have unlocked' },
];

/**
 * The screen each button opens — the menu's half of the wiring contract.
 *
 * A `MAIN_MENU_ITEMS` entry with no route is LESSONS §20 exactly: a button that
 * renders, presses, sounds, and goes nowhere. So the route is a **total function
 * of the option**, checked two ways: the compiler rejects a missing case (the
 * switch is exhaustive over {@link MainMenuOption}), and `default` returns
 * `null` so a case deleted at runtime is a red test rather than a dead button
 * ({@link ./main-menu.test}).
 *
 * The vocabulary is {@link ./menu-nav}'s, deliberately: routing to a `NavScreen`
 * means the same test can then ask the navigation graph whether that screen has
 * a way back — a door that opens onto a room with no exit is the other half of
 * the same bug.
 */
export function mainMenuRoute(option: MainMenuOption): NavScreen | null {
  switch (option) {
    // PLAY opens THE DOORS (`online` is that screen's id — see `./menu-nav`).
    case 'play':
      return 'online';
    case 'codex':
      return 'codex';
    case 'settings':
      return 'settings';
    case 'hangar':
      return 'hangar';
    default:
      return null;
  }
}

/**
 * Move the keyboard focus `delta` places through the stack, wrapping at both
 * ends, and answer the option it lands on.
 *
 * The menu used to answer exactly one key — Enter/Space, which was PLAY — so a
 * keyboard player could reach the first plate and nothing else. That was
 * survivable while the other two doors were also reachable by mouse on the same
 * screen; it stops being survivable the moment a screen has to be *demonstrably*
 * reachable without a pointer (a0-14). Focus starts at PLAY, so Enter with
 * nothing moved is still PLAY and every existing keyboard path is unchanged.
 *
 * Pure and index-based, so "three steps down reaches HANGAR" is a unit test
 * rather than a click-through.
 */
export function mainMenuStep(index: number, delta: number): MainMenuOption {
  const count = MAIN_MENU_ITEMS.length;
  const safe = Number.isFinite(index) ? Math.trunc(index) : 0;
  const next = (((safe + delta) % count) + count) % count;
  return MAIN_MENU_ITEMS[next]!.kind;
}

/** The index of an option in the stack — the inverse of {@link mainMenuStep},
 *  for a wiring layer that holds the focus as a `MainMenuOption`. */
export function mainMenuIndexOf(option: MainMenuOption): number {
  const index = MAIN_MENU_ITEMS.findIndex((item) => item.kind === option);
  return index < 0 ? 0 : index;
}

/** The wordmark, in Audiowide (style-guide §5.6) — the one place the game names
 *  itself before a match. */
export const MAIN_MENU_TITLE = 'PLANET RUSH';

/**
 * The header beam's eyebrow cluster, taken verbatim from the handoff's title
 * screen: the authority above, the standing status below. Two lines, both
 * Oxanium, both on the `eyebrow` / `label` tracking tiers — the eyebrow is the
 * tag above a thing and the second line is the thing's own state.
 */
export const MAIN_MENU_EYEBROW = 'DEEP FIELD MINING AUTHORITY';
export const MAIN_MENU_STATUS = 'CONTRACT OPEN · SECTOR 04';

// ---------------------------------------------------------------------------
// The per-frame model
// ---------------------------------------------------------------------------

/** One button as the view draws it. */
export interface MainMenuButtonView {
  readonly label: string;
  readonly sub: string;
  readonly primary: boolean;
  readonly role: PlateRole;
  readonly scale: PlateScale;
  /** Rest / hover / press — the handoff's three plate states, driven by the
   *  wiring layer's pointer routing (`src/main.ts`). Touch never hovers, so on a
   *  phone this is only ever `rest` or `press`. */
  readonly state: MainMenuButtonState;
}

/** A plate's interaction state. Mirrors `materials.ts` `PlateState`, restated
 *  here so the model does not make its consumers import the art module. */
export type MainMenuButtonState = 'rest' | 'hover' | 'press';

/** What the pointer is doing on the screen: which option it is over, and which
 *  (if any) it is currently holding down. */
export interface MainMenuPointer {
  readonly hover?: MainMenuOption | null;
  readonly press?: MainMenuOption | null;
}

/** The main menu for one frame. */
export interface MainMenuModel {
  readonly title: string;
  readonly eyebrow: string;
  readonly status: string;
  readonly buttons: readonly MainMenuButtonView[];
}

/**
 * Build the frame model. Pure: the view draws exactly this and decides nothing.
 * A press outranks a hover on the same plate (a finger that is down is not
 * hovering), and a plate that is neither is at rest.
 */
export function mainMenuModel(pointer: MainMenuPointer = {}): MainMenuModel {
  return {
    title: MAIN_MENU_TITLE,
    eyebrow: MAIN_MENU_EYEBROW,
    status: MAIN_MENU_STATUS,
    buttons: MAIN_MENU_ITEMS.map((item) => {
      const { role, scale } = itemPlate(item);
      return {
        label: item.label,
        sub: item.sub,
        primary: item.primary,
        role,
        scale,
        state:
          pointer.press === item.kind ? 'press' : pointer.hover === item.kind ? 'hover' : 'rest',
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface MainMenuLayoutOptions {
  readonly isTouch?: boolean;
  readonly insets?: Insets;
}

/**
 * The main menu's rects.
 *
 * The wordmark no longer sits in a band above the buttons: under Gantry/Bone it
 * lives **in the header beam**, centred across it, which is where the ratified
 * screen puts it. `title` therefore names the strip inside that beam rather than
 * a slice of the content box — it is still the rect a test asserts the wordmark's
 * position against, and it is still not a control.
 */
export interface MainMenuLayout {
  readonly content: Rect;
  /** The header beam, full width inside the safe area. */
  readonly header: Rect;
  /** The footer beam. Carries the build-identity stamp, which is drawn by the
   *  boot path's own badge layer (`src/render/build-badge.ts`) — the beam is the
   *  plate it sits on, and the menu deliberately does not draw a second copy. */
  readonly footer: Rect;
  /** The wordmark's strip inside the header beam. */
  readonly title: Rect;
  /** The eyebrow cluster's strip inside the header beam, left of the wordmark. */
  readonly eyebrow: Rect;
  readonly buttons: readonly Rect[];
  readonly isTouch: boolean;
  readonly metrics: FrameMetrics;
}

/**
 * Lay the screen out for a viewport.
 *
 * The frame — margins, beams, gutters, plate heights — comes from
 * {@link ../art/materials} `frameMetrics`, so the desktop draws the handoff's own
 * numbers (44 / 92 / 80 / 72) and a phone draws their derived counterparts rather
 * than a second hand-picked set. The plates are centred in the band between the
 * beams and **compress proportionally** rather than overflowing, so the size
 * difference that marks PLAY as the primary survives a viewport that cannot hold
 * the stack at full height.
 *
 * `isTouch` no longer picks a taller button: the thumb floor is a property of the
 * *viewport*, not of the input device, and it is applied to every plate on every
 * platform by `frameMetrics`. The flag is kept because the caller and the seam
 * both still carry it, and because a screen may yet want it.
 */
export function mainMenuLayout(viewport: Viewport, options: MainMenuLayoutOptions = {}): MainMenuLayout {
  const isTouch = options.isTouch ?? false;
  const frame = gantryFrame(viewport, options.insets);
  const { metrics } = frame;

  const beamStrip = beamContent(frame.header, metrics);
  // The eyebrow cluster takes the left third of the beam; the wordmark is centred
  // across the whole beam and the view shrinks it if the two would collide.
  const eyebrow: Rect = {
    x: beamStrip.x,
    y: beamStrip.y,
    width: Math.max(0, beamStrip.width * EYEBROW_SHARE),
    height: beamStrip.height,
  };
  const title: Rect = { ...beamStrip };

  // The column, capped absolutely AND proportionally ({@link ./gantry}
  // `menuColumnWidth`). The absolute cap alone never bit on a phone — the band is
  // narrower than it there — so the plates took the screen edge to edge and the
  // field went to 2.9% a side (a0-79, the developer's 798x384 screenshot).
  const columnWidth = menuColumnWidth(frame.band.width, COLUMN.title, metrics);
  const heights = MAIN_MENU_ITEMS.map((item) => plateHeight(itemPlate(item).scale, metrics));
  const buttons = stackPlates(frame.band, columnWidth, heights, metrics.gap);

  return {
    content: frame.content,
    header: frame.header,
    footer: frame.footer,
    title,
    eyebrow,
    buttons,
    isTouch,
    metrics,
  };
}

/** How much of the header beam the eyebrow cluster may claim before the view
 *  starts shrinking the wordmark to clear it. */
const EYEBROW_SHARE = 0.34;

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
