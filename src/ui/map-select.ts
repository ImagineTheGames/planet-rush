/**
 * src/ui/map-select.ts — the MAP SELECT screen. OWNER: UI Engineer (brief u10-01;
 * the developer, 2026-08-07: *"in the lobby page select ship and select map need
 * to open different pages, we should only show 1 ship and 1 map in lobby because
 * it's too cluttered now"*).
 *
 * The six arenas of the ratified registry, each with the layout dots read off
 * `map.stations(...)` itself, its name, and the VETERAN tag where it applies.
 *
 * ---------------------------------------------------------------------------
 * THIS IS THE PICKER, GIVEN ITS SCREEN BACK
 * ---------------------------------------------------------------------------
 * The arena row has been squeezed for three briefs running. p2 moved it off the
 * PLAY flow into the lobby; u7-03 moved it out of the full band and into the
 * bottom of the ship-select column, halving its height; a0-12 took the registry
 * from four maps to six and had to compress the row's gutter to **two pixels** to
 * keep six cards over the thumb floor, with a note recording that a seventh map
 * could not join it. None of that was the row being wrong — it was the row being
 * on a screen that had run out.
 *
 * So the cards are laid out here by {@link ./map-picker} `mapPickerLayout` — the
 * layout written for exactly this job, before the row was ever a lobby column —
 * in a band the width of the whole screen. Six cards come out 190×190 on a
 * desktop and 240×114 in a 3×2 on a landscape phone: over the thumb floor in both
 * dimensions with room to spare, which is the first time that has been true since
 * a0-12 — and the three-column rung is itself a u10-01 change, answering the note
 * a0-12 left for this file's owner (`./map-picker`, `mapPickerLayout`).
 *
 * **The registry is untouched, and that is a hard boundary.** Four… six maps, The
 * Ring the default, and the resource-fairness invariant are `src/sim/maps`'s and
 * are not this brief's to alter (and `src/sim/` is not this agent's to edit at
 * all). This screen moves *where* an arena is chosen, not *what* the arenas are.
 *
 * ---------------------------------------------------------------------------
 * THE HOST RULE, AND WHY THE SCREEN STILL OPENS FOR A GUEST
 * ---------------------------------------------------------------------------
 * One arena per room, and it is the host's (`./lobby` `selectMap`) — a guest who
 * could re-pick it would be changing a world the host's own client is about to
 * build. What this screen refuses is therefore **authoring**, not **looking**: it
 * opens for a guest, states whose choice it is ({@link MapSelectModel.canPick}),
 * and draws its cards as surfaces rather than as pressable plates. A card that
 * looked live and then refused would break the rule the whole lobby keeps — *a
 * dead-looking button beats a lying one* — and a card that would not open at all
 * would read as broken while also withholding information the player is owed: the
 * board they are about to fly.
 *
 * Same three-piece discipline as the rest of the directory: a pure, DOM-free model
 * with its layout co-located, and a thin Pixi view ({@link ./map-select-view})
 * that draws exactly what this returns and decides nothing.
 */

import type { Rect, Viewport } from '@platform/layout-registry';
import type { FrameMetrics, PlateRole, PlateState } from '../art/materials';
import { beamActionPlate, beamContent, gantryFrame } from './gantry';
import { hitRect } from './menu-geometry';
import type { Insets } from './menu-geometry';
import { MAP_ORDER, mapIdAt, mapPickerLayout, mapPickerModel } from './map-picker';
import type { MapPickerLayout, MapPickerModel } from './map-picker';

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/** The heading in the header beam — **the developer's own words for the screen**
 *  (*"select map … open different pages"*). GDD §4.7 register 2's clarity rule
 *  keeps it plain: the voice may rename the world, not the verb, and this heading
 *  is what says which of the three lobby screens a player is standing on. */
export const MAP_SELECT_TITLE = 'MAP SELECT';

/** The eyebrow over it — the noun of work a board is, in the register's own
 *  vocabulary (a claim is worked in **sectors**). */
export const MAP_SELECT_EYEBROW = 'CLAIM SECTOR';

/** The way out (§4.7's fixed-string list: `BACK` is not the voice's to revisit). */
export const MAP_SELECT_BACK_LABEL = 'BACK';

/**
 * The line under the heading. Two of them, and which one is drawn is the whole of
 * the host rule stated in words:
 *
 *  - the host is told the pick is one-per-room, which is why there is one card lit;
 *  - **a guest is told whose it is, before they press anything.** That is the half
 *    that matters. `WAITING FOR THE CLAIM HOLDER` is already this screen family's
 *    word for the host (`./lobby-view`; "claim holder", not "host" — GDD §4.7
 *    worked examples), so the same noun is used here rather than a second one.
 */
export const MAP_SELECT_HINT = 'ONE ARENA PER CLAIM · LOCKED AT RUSH';
export const MAP_SELECT_GUEST_HINT = "THE CLAIM HOLDER'S PICK — READ ONLY";

// ---------------------------------------------------------------------------
// The per-frame model
// ---------------------------------------------------------------------------

/** What the wiring hands in. */
export interface MapSelectState {
  /** The arena currently selected (`../sim/maps` id). */
  readonly mapId: string;
  /** Whether THIS client may change it — the host, before RUSH!
   *  (`./lobby` `hostControls`). A guest gets `false` and reads the screen. */
  readonly canPick: boolean;
}

/** Which control the pointer is over / holding. */
export interface MapSelectPointer {
  readonly hover?: MapSelectTarget | null;
  readonly press?: MapSelectTarget | null;
}

/** The screen for one frame. */
export interface MapSelectModel {
  readonly title: string;
  readonly eyebrow: string;
  readonly hint: string;
  /**
   * The cards, exactly as {@link ./map-picker} builds them — names, blurbs, the
   * VETERAN tag and the registry previews. Not rebuilt here: the picture on this
   * screen and the picture on the lobby's summary card come out of the same
   * constructor, so they cannot drift.
   */
  readonly picker: MapPickerModel;
  readonly selectedId: string;
  /** Whether the cards are pressable. False draws them as surfaces (see header). */
  readonly canPick: boolean;
  readonly backLabel: string;
  readonly backState: PlateState;
  /** BACK is this screen's one bright plate — for a guest it is also the only
   *  control on it, which is precisely why it must not be ambiguous. */
  readonly backRole: PlateRole;
}

/** Build the frame model. Pure: the view draws exactly this and decides nothing. */
export function mapSelectModel(
  state: MapSelectState,
  pointer: MapSelectPointer = {},
): MapSelectModel {
  const picker = mapPickerModel(state.mapId);
  const backState: PlateState = sameMapTarget(pointer.press, { kind: 'back' })
    ? 'press'
    : sameMapTarget(pointer.hover, { kind: 'back' })
      ? 'hover'
      : 'rest';
  return {
    title: MAP_SELECT_TITLE,
    eyebrow: MAP_SELECT_EYEBROW,
    hint: state.canPick ? MAP_SELECT_HINT : MAP_SELECT_GUEST_HINT,
    picker,
    selectedId: picker.selectedId,
    canPick: state.canPick,
    backLabel: MAP_SELECT_BACK_LABEL,
    backState,
    backRole: 'primary',
  };
}

/** The plate roles this screen draws, for `./gantry` `singlePrimary`: BACK, and a
 *  card per arena — `secondary` where it is the pick, `inert` where it is not, and
 *  never `primary` (the same pair the picker has always drawn). */
export function mapSelectPlateRoles(model: MapSelectModel): PlateRole[] {
  return [
    model.backRole,
    ...model.picker.cards.map((card): PlateRole => (card.selected ? 'secondary' : 'inert')),
  ];
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

/** What a tap on MAP SELECT resolves to. */
export type MapSelectTarget =
  /** BACK — return to the roster with the pick exactly as it was. */
  | { readonly kind: 'back' }
  /** An arena card — pick it and return (`./lobby` `pickMap`). Still a target for
   *  a guest: the refusal is the model's, and a control that swallows a press
   *  silently is the one a player concludes is broken. */
  | { readonly kind: 'arena'; readonly index: number };

/** Whether two targets name the same control — structural, like every other
 *  screen's (`./hangar` `sameHangarTarget`). */
export function sameMapTarget(
  a: MapSelectTarget | null | undefined,
  b: MapSelectTarget | null | undefined,
): boolean {
  if (!a || !b) return !a && !b;
  if (a.kind !== b.kind) return false;
  return a.kind === 'arena' && b.kind === 'arena' ? a.index === b.index : true;
}

/** A stable string key for a target — the wiring's hover/press bookkeeping. */
export function mapSelectTargetKey(target: MapSelectTarget | null): string | null {
  if (!target) return null;
  return target.kind === 'back' ? 'back' : `arena:${target.index}`;
}

/** The arena a card index names, folded to a real id — straight through to
 *  {@link ./map-picker} `mapIdAt`, so a stray tap can never pick nothing. */
export function mapIdAtCard(index: number): string {
  return mapIdAt(index);
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface MapSelectLayoutOptions {
  readonly isTouch?: boolean;
  readonly insets?: Insets;
}

/** Every rect this screen draws in, for one viewport. */
export interface MapSelectLayout {
  readonly content: Rect;
  readonly header: Rect;
  readonly footer: Rect;
  /** The heading's strip inside the header beam. */
  readonly title: Rect;
  /** The band between the beams. */
  readonly band: Rect;
  /** The one-line hint strip off the top of the band. */
  readonly hint: Rect;
  /** The cards, and the band they were placed in — handed straight to the shared
   *  `MapPickerView`, so the previews and the VETERAN pill come for free. */
  readonly picker: MapPickerLayout;
  /** BACK, in the footer beam. */
  readonly back: Rect;
  readonly isTouch: boolean;
  readonly metrics: FrameMetrics;
}

/** BACK's width at the reference — the lobby's own, so the way out is the same
 *  plate on the screen you left and the screen you are on. */
const BACK_WIDTH = 120;
/** The hint strip's height at the reference — one line of eyebrow type with air. */
const HINT_HEIGHT = 22;

/**
 * Lay the screen out for a viewport: a hint line off the top of the band, then the
 * cards through the picker's own layout.
 *
 * The cards are {@link ./map-picker} `mapPickerLayout`'s and nothing here
 * second-guesses it — that function already caps rather than stretches, centres
 * the block, and folds to two columns rather than producing a card too narrow to
 * read a blurb on. Handing it the whole band is the entire fix this brief makes to
 * the arena row.
 */
export function mapSelectLayout(
  viewport: Viewport,
  options: MapSelectLayoutOptions = {},
): MapSelectLayout {
  const isTouch = options.isTouch ?? false;
  const frame = gantryFrame(viewport, options.insets);
  const { metrics } = frame;
  const title = beamContent(frame.header, metrics);

  const footerStrip = beamContent(frame.footer, metrics, 'footer');
  const backWidth = Math.max(
    0,
    Math.min(Math.round(BACK_WIDTH * metrics.plateScale), footerStrip.width),
  );
  // BACK takes the thumb floor even where the beam cannot hold one, and the band
  // gives up the overflow — the lobby's own RUSH! arithmetic, shared
  // (`./gantry` `beamActionPlate`). It is the only way off this screen for a guest,
  // so it is the last control here that may be allowed to shrink.
  const action = beamActionPlate(frame, metrics, backWidth);
  const back = action.rect;
  const band: Rect = { ...frame.band, height: Math.max(0, frame.band.height - action.overflow) };
  const hintHeight = Math.max(
    0,
    Math.min(Math.round(HINT_HEIGHT * metrics.plateScale), band.height / 4),
  );
  const hint: Rect = { x: band.x, y: band.y, width: band.width, height: hintHeight };
  const cardsY = band.y + hintHeight + (hintHeight > 0 ? metrics.rowGap : 0);
  const cardBand: Rect = {
    x: band.x,
    y: cardsY,
    width: band.width,
    height: Math.max(0, band.y + band.height - cardsY),
  };

  return {
    content: frame.content,
    header: frame.header,
    footer: frame.footer,
    title,
    band,
    hint,
    picker: mapPickerLayout(cardBand, MAP_ORDER.length, isTouch),
    back,
    isTouch,
    metrics,
  };
}

/**
 * The target a tap at `(x, y)` hits, or `null`. BACK first, for the reason every
 * screen in this directory puts it first: it sits in a corner clear of the cards,
 * and a mis-hit toward the edge should favour leaving over nothing.
 */
export function mapSelectHitTest(
  layout: MapSelectLayout,
  x: number,
  y: number,
): MapSelectTarget | null {
  if (hitRect(layout.back, x, y)) return { kind: 'back' };
  for (let i = 0; i < layout.picker.cards.length; i++) {
    const rect = layout.picker.cards[i];
    if (rect && hitRect(rect, x, y)) return { kind: 'arena', index: i };
  }
  return null;
}

/** The screen's layout-registry id: it owns the screen while it is up. */
export const MAP_SELECT_ID = 'map-select';
