/**
 * src/ui/map-picker.ts — the PLAY-screen map picker. OWNER: UI Engineer
 * (GDD §2.1 match setup; §5 the picker labels the maps; map registry m8-01).
 *
 * The player picks the arena before a match: four cards, each a **mini layout
 * preview drawn from the registry's own station positions** — never a hand-drawn
 * thumbnail, which could drift from the real board (m8-02 brief). `octagon`
 * ("The Ring") is preselected as the fair default; `diamond` ("Double Diamond")
 * carries a small VETERAN tag.
 *
 * Same three-piece discipline as the rest of the directory: this file is a pure,
 * DOM-free **model with its geometry co-located** — the cards, the selection and
 * the rects a band is divided into are all pure functions, unit-tested headless
 * (`./map-picker.test.ts`) — and {@link ./map-picker-view} is the thin PixiJS
 * view that draws exactly what this returns. Nothing here imports PixiJS.
 *
 * The one rule this file keeps: **the preview cannot lie.**
 *
 * ---------------------------------------------------------------------------
 * a0-124 — WHAT "CANNOT LIE" HAD TO MEAN
 * ---------------------------------------------------------------------------
 * It meant the *stations*, and only the stations, until a0-124: the card drew
 * `map.stations(...)` normalised into the box and nothing else, and the developer
 * looked at the picker and said the previews should show *"the ores, empty
 * stations locations, the nebulas and stars in the back… just more accurate
 * overall"*. A player choosing a board could not see the board — and the missing
 * half is the half that decides how a map plays. The Line and The Ring differ in
 * where the ore lies far more than in where eight berths sit.
 *
 * So {@link mapPreview} **builds the world**. `createWorld`, on the map's own
 * bounds, at the full ring, and then it reads the stations and the asteroids off
 * the result — because a `MapDef` declares the arena and the berths and says
 * nothing at all about ore: the field is stamped at world build by
 * `../sim/waves` `spawnHomeFields` and the opening `spawnWave`. Re-deriving that
 * here would be a second implementation of the field, which is the same defect as
 * a hand-kept dot list one level down. The sky is the same discipline in the view:
 * the map's own `MAP_NEBULA` entry through the backdrop's own generators, never a
 * second starfield (`./map-picker-view`).
 *
 * A new map is still a registry entry and its preview still follows for free. The
 * chosen id is fed to `bootOfflineMatch(seed, mapId)` and persisted like the
 * fire-mode key, so a returning player finds their last arena preselected.
 */

import { ShipClass } from '@shared/types';
import type { Vec2 } from '@shared/types';
import type { Rect } from '@platform/layout-registry';
import { DEFAULT_ABUNDANCE } from '../sim/constants';
import { DEFAULT_MAP_ID, MAPS, getMap } from '../sim/maps';
import type { MapDef } from '../sim/maps';
import { createWorld } from '../sim/state';
import type { PlayerSpec } from '../sim/state';
import { clamp, hitRect } from './menu-geometry';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Where the last arena picked is remembered — same `planet-rush:` storage seam
 * the fire-mode and ship-class keys use (`src/main.ts`), so all three survive a
 * reload identically (m8-02 brief: "persists, same pattern as the fire-mode key").
 */
export const MAP_STORAGE_KEY = 'planet-rush:mapId';

/** The picker's layout-registry id — it registers the reserved menu band it draws
 *  in, so the same registry loop that measures the HUD can measure it (m8-02:
 *  "everything registered in the layout registry"). */
export const MAP_PICKER_ID = 'map-picker';

/** The arena that carries the VETERAN tag: deliberately asymmetric ground, fair
 *  only in ore (`../sim/maps` diamond "Double Diamond"). */
export const VETERAN_MAP_ID = 'diamond';

/**
 * Home slots a preview is drawn with — the design's eight (GDD §2.1), so the
 * card shows the same full ring the offline match builds (`MATCH_SLOTS`). Mirrored
 * rather than imported so the model stays free of the bots package. Asserted equal
 * to the match slot count in the tests.
 */
export const MAP_PREVIEW_SLOTS = 8;

/**
 * The seed a preview (and the registry-position readout) is computed with. The
 * four shipped maps place their stations by pure geometry and ignore the seed
 * (`../sim/maps`), so any fixed value draws the same board the seeded match does —
 * which is what lets a test compare a booted world's stations to this readout.
 */
export const MAP_PREVIEW_SEED = 0;

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/**
 * A round body on the board, normalised into the arena box: centre in
 * `[0,1]×[0,1]`, radius as a fraction of the arena's WIDTH — one axis, so a body
 * stays a circle when the view letterboxes a non-square arena.
 *
 * Both a berth and a rock are this, and both carry their **real** radius off the
 * world, so the view never has to invent how big a station is next to an asteroid
 * (it is a little over 2×, and that is the sim's number, not a drawing decision).
 */
export interface MapPreviewBody {
  readonly x: number;
  readonly y: number;
  /** Body radius ÷ arena width. */
  readonly r: number;
}

/**
 * A map's board, reduced to what a preview needs: the arena's aspect ratio, every
 * berth's centre and every opening rock, all **normalised into `[0,1]×[0,1]`**
 * within the arena box. The view letterboxes this into a card so a wide arena
 * (oval/diamond) reads as wide and a square one (octagon/compass) reads as square.
 *
 * All of it comes off a world {@link mapPreview} actually builds — see there.
 */
export interface MapPreview {
  /** Arena width ÷ height — the box the dots are placed in. */
  readonly aspect: number;
  /** Home station berths, normalised to the arena box. In slot order. Nobody owns
   *  one at pick time, which is why the view draws them unclaimed. */
  readonly stations: readonly MapPreviewBody[];
  /**
   * The **ore field the match opens on** — every asteroid `createWorld` places,
   * which is each station's home neighbourhood plus wave 1 of the commons. This is
   * the half of a map that decides how it plays (p1-09: the home fields are
   * congruent by construction, the commons is `N`-fold symmetric), and it is the
   * half the picker showed nothing of until a0-124.
   */
  readonly ore: readonly MapPreviewBody[];
}

/** One card, as the view draws it: words and a preview, and whether it is chosen.
 *  No ship stats and no map numbers — a name, a one-line blurb, a picture. */
export interface MapCardModel {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  /** Carries the small VETERAN tag (only `diamond` today). */
  readonly veteran: boolean;
  /** Drawn as the selected card (plasma border). Exactly one is true. */
  readonly selected: boolean;
  /** The board, off a world the match's own constructor built ({@link mapPreview}). */
  readonly preview: MapPreview;
}

/** The picker for one frame: the four cards in registry order, `octagon` first. */
export interface MapPickerModel {
  readonly cards: readonly MapCardModel[];
  readonly selectedId: string;
}

/** The registry order the cards, the layout and the hit test all walk — so a tap
 *  index maps back to the same map the card drew (the rule every screen here keeps). */
export const MAP_ORDER: readonly string[] = MAPS.map((m) => m.id);

/**
 * Fold a stored / hand-edited map id down to a real one, falling back to the
 * default — the same contract `getMap` keeps, surfaced here so `main.ts` can
 * normalise a `localStorage` value before it ever reaches the sim. A stale key
 * can never select a card that does not exist.
 */
export function normalizeMapId(raw: string | null | undefined): string {
  return raw != null && MAPS.some((m) => m.id === raw) ? raw : DEFAULT_MAP_ID;
}

/** The card index a map id sits at, or -1 — the inverse of {@link MAP_ORDER}. */
export function mapIndexOf(id: string): number {
  return MAP_ORDER.indexOf(id);
}

/** The map id at a card index, folded to a real id (an out-of-range index gives
 *  the default rather than `undefined`), so a stray tap can never pick nothing. */
export function mapIdAt(index: number): string {
  return normalizeMapId(MAP_ORDER[index]);
}

/**
 * The registry's home station centres for a map, in **world units**, slot order.
 * Drawn from `map.stations(seed, count, bounds)` on the map's own bounds — the
 * exact call `createWorld` makes offline — so this is the board a booted match
 * builds, readable without a sim. The live-stage spec compares a real world's
 * stations to this (m8-02 brief: "station positions match that registry entry
 * exactly").
 */
export function registryStations(id: string, count = MAP_PREVIEW_SLOTS): Vec2[] {
  const map = getMap(id);
  return map.stations(MAP_PREVIEW_SEED, count, map.bounds).map((p) => ({ x: p.station.x, y: p.station.y }));
}

/**
 * The roster a preview's world is built with: {@link MAP_PREVIEW_SLOTS} seats, no
 * sides (FFA teams-of-one, so `teamHomeSlots` is the identity and station `i` sits
 * on placement `i`). The hull is the onboarding default and is **irrelevant to the
 * board** — a ship class sets speed and hull, never where a rock lands — but a
 * `PlayerSpec` needs one, so the choice is stated rather than arbitrary.
 */
const PREVIEW_ROSTER: readonly PlayerSpec[] = Array.from(
  { length: MAP_PREVIEW_SLOTS },
  (_, id): PlayerSpec => ({ id, shipClass: ShipClass.Vanguard }),
);

/** Memo for {@link mapPreview}, keyed by map id — see there for why it must exist. */
const PREVIEW_CACHE = new Map<string, MapPreview>();

/**
 * The board for a card: arena aspect, berth centres and the opening ore field,
 * normalised into the arena box.
 *
 * ---------------------------------------------------------------------------
 * IT IS BUILT BY THE THING THAT BUILDS THE MATCH
 * ---------------------------------------------------------------------------
 * **This calls `createWorld`.** Not `map.stations(...)` and a hand-rolled field —
 * the actual world constructor, on the map's own bounds, and then it reads the
 * stations and asteroids off the result.
 *
 * That is not thoroughness for its own sake; it is the only way the picture can be
 * the board. A `MapDef` declares the arena and where the berths go and *nothing
 * about the ore*: the field is stamped at world build (`../sim/state` `createWorld`
 * → `../sim/waves` `spawnHomeFields`, then the opening `spawnWave`), out of the
 * seeded RNG, against the abundance-resolved economy. A preview that re-derived
 * that here from `RESOURCE_FIELD` would be a second implementation of the field —
 * which is the same defect as a hand-kept dot list, one level down, and it would
 * drift the first time the generator was retuned.
 *
 * Three things are fixed here because the picker cannot know them yet, and each is
 * chosen to be the one the player is about to get:
 *
 *  - **Seat count** — {@link MAP_PREVIEW_SLOTS}, the full ring (GDD §2.1). At eight
 *    every board is all-live, so every berth on the card is a berth, and none of
 *    the derelict-fill maps shows a wreck it would not have at a full table.
 *  - **Seed** — {@link MAP_PREVIEW_SEED}. Station geometry ignores the seed
 *    entirely (`../sim/maps`), so the berths are exact. The field does not: a real
 *    match rolls its own scatter. What is *invariant* under the seed is the
 *    structure — every home neighbourhood congruent, the commons `N`-fold symmetric
 *    about the centre — and the structure is what tells The Line from The Ring.
 *  - **Abundance** — {@link DEFAULT_ABUNDANCE}, the level the lobby opens on
 *    (`../sim/match-config` `matchAbundance`). It scales rock count and size
 *    uniformly for every map, so it moves the texture of all six cards together and
 *    never their relative read.
 *
 * The board is the one at **t = 0**: the home fields plus wave 1 of the commons,
 * which is exactly what `createWorld` places. Waves 2..5 arrive on the metronome
 * and are not part of the world a match is handed.
 *
 * **Memoised, and it has to be.** `mapPickerModel` is a per-frame constructor
 * ({@link ./map-select} `mapSelectModel` calls it every frame), and six world
 * builds a frame on a screen a player is waiting on is exactly the shape of
 * regression this codebase has paid for three times this month. The result is a
 * pure function of the map id — fixed seats, fixed seed, fixed abundance — so the
 * cache can never go stale.
 */
export function mapPreview(map: MapDef): MapPreview {
  const cached = PREVIEW_CACHE.get(map.id);
  if (cached) return cached;

  const world = createWorld({
    seed: MAP_PREVIEW_SEED,
    players: PREVIEW_ROSTER,
    mapId: map.id,
    abundance: DEFAULT_ABUNDANCE,
  });
  const { width, height } = world.bounds;
  const nx = (x: number): number => (width > 0 ? x / width : 0.5);
  const ny = (y: number): number => (height > 0 ? y / height : 0.5);
  const nr = (r: number): number => (width > 0 ? r / width : 0);

  const preview: MapPreview = {
    aspect: height > 0 ? width / height : 1,
    stations: world.stations.map((s) => ({ x: nx(s.pos.x), y: ny(s.pos.y), r: nr(s.radius) })),
    ore: world.asteroids.map((a) => ({ x: nx(a.pos.x), y: ny(a.pos.y), r: nr(a.radius) })),
  };
  PREVIEW_CACHE.set(map.id, preview);
  return preview;
}

/** Build the frame model for a given selection. Pure: the view draws exactly this
 *  and decides nothing. The selection is normalised, so an unknown id still lights
 *  the default card rather than none. */
export function mapPickerModel(selectedId: string): MapPickerModel {
  const selected = normalizeMapId(selectedId);
  return {
    selectedId: selected,
    cards: MAPS.map((map) => cardFor(map, selected)),
  };
}

/**
 * **One card, for one map** — the lobby's single arena card since u10-01, where
 * the four-card row moved to its own screen and the lobby kept only the pick.
 *
 * It is the same {@link MapCardModel} {@link mapPickerModel} builds, from the same
 * registry entry, through the same {@link mapPreview}: the lobby's summary card and
 * the MAP SELECT card the player pressed to choose it are the *same picture*, which
 * is the whole reason this is a shared constructor rather than a second one written
 * for the lobby. An unknown id folds to the default ({@link normalizeMapId}), so a
 * stale stored key can never leave the card blank.
 *
 * `selected` is always true here: a card built for the current pick is the current
 * pick. The lobby draws it raised for that reason and the view needs no second flag.
 */
export function mapCardModel(id: string): MapCardModel {
  const selected = normalizeMapId(id);
  return cardFor(getMap(selected), selected);
}

/** One registry entry as a card, lit when it is the selection. The single place a
 *  `MapCardModel` is authored, so the row and the lone card cannot drift. */
function cardFor(map: MapDef, selectedId: string): MapCardModel {
  return {
    id: map.id,
    name: map.name,
    blurb: map.blurb,
    veteran: map.id === VETERAN_MAP_ID,
    selected: map.id === selectedId,
    preview: mapPreview(map),
  };
}

// ---------------------------------------------------------------------------
// Geometry — the cards laid out inside a band
// ---------------------------------------------------------------------------

/** Gap between two cards. */
export const MAP_CARD_GAP = 10;
/** A card narrower than this cannot carry its name over a wrapped blurb, so a row
 *  of four that would produce one drops to a 2×2 instead (see {@link mapPickerLayout}). */
export const MAP_CARD_MIN_WIDTH = 132;
/** Cards don't sprawl on a wide desktop — past this they read as banners, not a
 *  choosable set. */
export const MAP_CARD_MAX_WIDTH = 240;
/** A card shorter than this cannot fit a preview over a name over a blurb; the
 *  view drops the blurb below it rather than clipping (m8-02 thumb rule). */
export const MAP_CARD_MIN_HEIGHT = 84;
/**
 * …and the ceiling.
 *
 * **190 since u10-01, up from 150.** The 150 was chosen while this row lived in a
 * reserved strip on the PLAY flow, where a taller card would have eaten the menu.
 * The row has a screen of its own now ({@link ./map-select}), and at 150 a desktop
 * card was 190 wide — narrow enough that the longest registry blurb ("The
 * Crescents", four wrapped lines) ran out of the bottom of its own card while its
 * five neighbours fitted in three. A square-ish card holds every blurb the registry
 * has and reads as a board rather than as a banner; the view still drops an
 * overrunning blurb whole rather than clipping it, which is the guard that found
 * this.
 *
 * **240 since a0-124, up from 190 — and the number is now about the picture.** The
 * card carries a rendering of the board rather than eight dots, and on the desktop
 * baseline the six 190-tall cards sat in a 451-tall band with ~130px of empty
 * screen above and below them: the ceiling, not the band, was what held the arena
 * to an 86px square on the largest screen the game runs on. 240 spends that empty
 * band on the thing the screen is for.
 *
 * It changes **nothing on the constraint that decides this screen**. A landscape
 * phone's cards are band-limited at 240×114 and come out byte-identical at either
 * ceiling; every viewport that moves does so because it had spare band height and
 * was being capped out of using it (portrait 190→238, iPad 190→240).
 */
export const MAP_CARD_MAX_HEIGHT = 240;

/** How the four cards are arranged in the band. */
export type MapCardShape = 'row' | 'grid';

/** Every rect the picker draws in, for one band. */
export interface MapPickerLayout {
  /** The band the cards were placed inside (the reserved menu strip). */
  readonly band: Rect;
  /** One rect per card, in {@link MAP_ORDER}. */
  readonly cards: readonly Rect[];
  /** Columns the cards fell into — 4 (a row) or 2 (a grid). */
  readonly columns: number;
  readonly shape: MapCardShape;
}

/**
 * Lay `count` cards out inside `band`, choosing the arrangement that keeps each
 * card wide enough to read its blurb (m8-02): the whole registry in one row where
 * the band is wide enough (desktop), then **three columns** (a landscape phone),
 * then two (a narrow portrait window). Cards are **capped**, never stretched, and
 * the block is centred — so nothing escapes the band by construction, the same
 * discipline every geometry file here keeps.
 *
 * `isTouch` is a *scale* input, not a layout one: the cards are already large
 * enough to be thumb targets on every device (a card is ≥ {@link MAP_CARD_MIN_HEIGHT}
 * tall), so touch grows nothing here — it is accepted for symmetry with the other
 * screens and to keep the call sites uniform.
 */
export function mapPickerLayout(band: Rect, count = MAPS.length, _isTouch = false): MapPickerLayout {
  const n = Math.max(0, Math.floor(count));
  if (n === 0 || band.width <= 0 || band.height <= 0) {
    return { band, cards: [], columns: 0, shape: 'row' };
  }

  // The widest arrangement whose cards still read: the whole registry across, then
  // three columns, then two.
  //
  // **Three is new (u10-01), and it closes a note this file left for its own
  // owner.** a0-12 took the registry to six maps, found that a 780×150
  // phone-landscape strip folded straight from a row to 2×3 with 43px cards, and
  // wrote down the three ways out — *"drop MAP_CARD_MIN_WIDTH to ~122, give the
  // band more height, or let the grid run 3 columns instead of 2"* — while noting
  // that nothing a player saw was broken, because the shipped lobby row had its own
  // looser geometry. u10-01 deleted that row: this function is the shipped path now,
  // so the note had to be answered rather than carried. Three columns is the answer
  // that costs nothing — the same 780px band gives 253px cards, 70px tall, over
  // both floors, where the fold to two gave 43.
  const columns = [n, 3, 2].find(
    (c) => c <= n && (band.width - (c - 1) * MAP_CARD_GAP) / c >= MAP_CARD_MIN_WIDTH,
  ) ?? Math.min(2, n);
  const shape: MapCardShape = columns === n ? 'row' : 'grid';
  const rows = Math.ceil(n / columns);

  const cardWidth = clamp((band.width - (columns - 1) * MAP_CARD_GAP) / columns, 0, MAP_CARD_MAX_WIDTH);
  const cardHeight = clamp(
    (band.height - (rows - 1) * MAP_CARD_GAP) / rows,
    0,
    MAP_CARD_MAX_HEIGHT,
  );

  // Centre the whole block in the band, both ways, so a capped set of cards sits
  // in the middle of a wide desktop rather than hugging the left edge.
  const blockWidth = columns * cardWidth + (columns - 1) * MAP_CARD_GAP;
  const blockHeight = rows * cardHeight + (rows - 1) * MAP_CARD_GAP;
  const originX = band.x + Math.max(0, (band.width - blockWidth) / 2);
  const originY = band.y + Math.max(0, (band.height - blockHeight) / 2);

  const cards: Rect[] = [];
  for (let i = 0; i < n; i++) {
    const column = i % columns;
    const row = Math.floor(i / columns);
    cards.push({
      x: originX + column * (cardWidth + MAP_CARD_GAP),
      y: originY + row * (cardHeight + MAP_CARD_GAP),
      width: cardWidth,
      height: cardHeight,
    });
  }
  return { band, cards, columns, shape };
}

/** The card index a tap at `(x, y)` hits, or `null` for a tap on nothing. Tested
 *  against the rects the frame was drawn at (the view passes the same layout here),
 *  so a tap and a pixel can never disagree (GDD §2.4 — plain taps). */
export function mapPickerHitTest(layout: MapPickerLayout, x: number, y: number): number | null {
  for (let i = 0; i < layout.cards.length; i++) {
    const rect = layout.cards[i];
    if (rect && hitRect(rect, x, y)) return i;
  }
  return null;
}
