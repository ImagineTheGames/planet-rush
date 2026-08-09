/**
 * src/ui/ship-select.test.ts — the SHIP SELECT screen, headless (u10-01).
 *
 * The brief's own test list, for the hull half:
 *
 *  - pressing the lobby's one ship card opens this screen;
 *  - picking returns to the lobby with the choice reflected in the single card;
 *  - BACK returns **without changing the pick**;
 *  - and the thing that makes the whole split worth doing — the four hulls get
 *    their full stats, pips AND numbers, at a size a comparison can be made at,
 *    on every device profile in QA's matrix rather than on a desktop only.
 *
 * The last one is asserted per profile rather than sampled, because the reason
 * this screen exists is that four tiles in a lobby column were 172×66 on a phone
 * and dropped GDD §2.11's role blurb on every handset. A screen that took the
 * tiles away from the roster and left them just as cramped would have moved the
 * clutter without fixing anything.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import type { Rect, Viewport } from '@platform/layout-registry';
import { rectContains } from '@platform/layout-registry';
import { TOUCH_MIN } from '../art/materials';
import { countPrimaries, singlePrimary } from './gantry';
import {
  CLASS_ORDER,
  CLASS_OPTIONS,
  DEFAULT_SHIP_CLASS,
  closeLobbyScreen,
  createLobby,
  lobbyModel,
  openShipSelect,
  pickShipClass,
  pressRush,
  shipCardFor,
} from './lobby';
import {
  SHIP_SELECT_HINT,
  SHIP_SELECT_LOCKED_HINT,
  SHIP_SELECT_TITLE,
  SHIP_TILE_MAX,
  sameShipTarget,
  shipClassAt,
  shipSelectHitTest,
  shipSelectLayout,
  shipSelectModel,
  shipSelectPlateRoles,
  shipSelectTargetKey,
} from './ship-select';
import { STAT_COUNT, classStatCell, classTileContent } from './lobby-geometry';

/** QA's device matrix, the same list `./lobby-geometry.test.ts` walks. Planet Rush
 *  is landscape-locked, so a handset on its side is the case that matters — the
 *  portraits are here because a window can be any shape and this screen must not
 *  break on one. */
const PROFILES: readonly { name: string; vp: Viewport; touch: boolean }[] = [
  { name: 'desktop', vp: { width: 1280, height: 720 }, touch: false },
  { name: 'iphone/landscape', vp: { width: 844, height: 390 }, touch: true },
  { name: 'iphoneSE/landscape', vp: { width: 667, height: 375 }, touch: true },
  { name: 'iphone/portrait', vp: { width: 390, height: 844 }, touch: true },
  { name: 'ipad/portrait', vp: { width: 820, height: 1180 }, touch: true },
  { name: 'small/portrait', vp: { width: 320, height: 568 }, touch: true },
];

const center = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width - 0.5 &&
  b.x < a.x + a.width - 0.5 &&
  a.y < b.y + b.height - 0.5 &&
  b.y < a.y + a.height - 0.5;

const lobby = () => createLobby({ room: 'ABCD' });

// ---------------------------------------------------------------------------
// Getting there, and getting back — the brief's navigation list
// ---------------------------------------------------------------------------

describe('opening and leaving SHIP SELECT (u10-01)', () => {
  it('opens from the lobby, and a lobby opens on its roster', () => {
    const room = lobby();
    expect(room.screen, 'a room opens on the roster').toBe('roster');
    expect(openShipSelect(room).screen).toBe('ship-select');
    // …and the roster hides itself while it is up: `LobbyModel.screen` is what the
    // view reads, so exactly one of the three screens is drawn per frame.
    expect(lobbyModel(openShipSelect(room)).screen).toBe('ship-select');
  });

  it('is still and identical when it is already open (the stillness rule)', () => {
    const open = openShipSelect(lobby());
    expect(openShipSelect(open)).toBe(open);
    const closed = closeLobbyScreen(lobby());
    expect(closed).toBe(closed);
  });

  it('BACK returns to the roster and changes NOTHING about the pick', () => {
    // The whole contract of `closeLobbyScreen`, and it is kept by the function
    // having nothing else in it: a "cancel" that restored a remembered value would
    // need a second copy of the pick to restore from, and that copy is exactly what
    // could disagree with the first.
    const picked = pickShipClass(lobby(), ShipClass.Hauler);
    const reopened = openShipSelect(picked);
    const back = closeLobbyScreen(reopened);
    expect(back.screen).toBe('roster');
    expect(back.shipClass).toBe(ShipClass.Hauler);
    expect(back.seats[back.you]?.shipClass).toBe(ShipClass.Hauler);
    // …and the lobby it hands back is otherwise the identical value.
    expect({ ...back, screen: 'x' }).toEqual({ ...reopened, screen: 'x' });
  });

  it('picking RETURNS to the lobby with the choice on the single card', () => {
    const picked = pickShipClass(openShipSelect(lobby()), ShipClass.Interceptor);
    expect(picked.screen).toBe('roster');
    const model = lobbyModel(picked);
    expect(model.shipCard.shipClass).toBe(ShipClass.Interceptor);
    expect(model.shipCard.name).toBe(shipCardFor(ShipClass.Interceptor).name);
    // The card carries the WHOLE option — the stats came with it (u4 is unchanged).
    expect(model.shipCard.stats).toHaveLength(STAT_COUNT);
  });

  it('returns even when the pick did not move — agreeing with yourself is not a trap', () => {
    const open = openShipSelect(lobby());
    const same = pickShipClass(open, DEFAULT_SHIP_CLASS);
    expect(same.screen).toBe('roster');
    expect(same.shipClass).toBe(DEFAULT_SHIP_CLASS);
  });

  it('OPENS while the hull is locked, and refuses the pick there (GDD §2.11)', () => {
    // A player who cannot change their hull may still want to see what the four
    // are, so the screen opens; `selectShipClass` is what refuses.
    // An OFFLINE room, because RUSH! is refused below two participants (a0-11) and
    // an online room opens on one human in seven empty chairs. Offline seeds the
    // bot cast, so the countdown really starts and the hull really locks.
    const counting = pressRush(createLobby({ room: 'ABCD', online: false }));
    expect(counting.phase).toBe('counting');
    const open = openShipSelect(counting);
    expect(open.screen).toBe('ship-select');
    const late = pickShipClass(open, ShipClass.Interceptor);
    expect(late.shipClass).toBe(DEFAULT_SHIP_CLASS);
    expect(late.screen).toBe('roster');
    // …and the screen SAYS why, rather than going quietly dead.
    expect(shipSelectModel({ shipClass: DEFAULT_SHIP_CLASS, locked: true }).hint).toBe(
      SHIP_SELECT_LOCKED_HINT,
    );
    expect(shipSelectModel({ shipClass: DEFAULT_SHIP_CLASS, locked: false }).hint).toBe(SHIP_SELECT_HINT);
  });
});

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

describe('the model', () => {
  it('shows the four hulls in GDD §2.11’s order, with their stats', () => {
    const model = shipSelectModel({ shipClass: DEFAULT_SHIP_CLASS, locked: false });
    expect(model.title).toBe(SHIP_SELECT_TITLE);
    expect(model.tiles.map((t) => t.option.shipClass)).toEqual([...CLASS_ORDER]);
    // Read out of the ONE ratified table, never rebuilt: the tile on this screen
    // and the card on the roster are the same object (u4's "the figure and the pips
    // are two renderings of one value" has one home).
    for (const tile of model.tiles) {
      expect(CLASS_OPTIONS).toContain(tile.option);
      expect(tile.option.stats).toHaveLength(STAT_COUNT);
      for (const line of tile.option.stats) {
        expect(line.text.length).toBeGreaterThan(0);
        expect(line.pips).toBeGreaterThanOrEqual(1);
        expect(line.pips).toBeLessThanOrEqual(line.pipMax);
      }
    }
  });

  it('lights exactly one tile — the pick', () => {
    for (const cls of CLASS_ORDER) {
      const model = shipSelectModel({ shipClass: cls, locked: false });
      expect(model.tiles.filter((t) => t.selected).map((t) => t.option.shipClass)).toEqual([cls]);
    }
  });

  it('dims the OTHER hulls once the choice is locked, never the one you fly', () => {
    const model = shipSelectModel({ shipClass: ShipClass.Hauler, locked: true });
    for (const tile of model.tiles) {
      expect(tile.dim, `${tile.option.name} dim`).toBe(!tile.selected);
    }
  });

  it('keeps BACK as the screen’s ONE bright plate (`./gantry` singlePrimary)', () => {
    for (const cls of CLASS_ORDER) {
      for (const locked of [false, true]) {
        const roles = shipSelectPlateRoles(shipSelectModel({ shipClass: cls, locked }));
        expect(countPrimaries(roles), 'more than one bright plate on SHIP SELECT').toBe(1);
        expect(singlePrimary(roles)).toBe(true);
        // …and the picked hull is RAISED, not a second primary — the same pair the
        // lobby's tiles wore before they moved here.
        expect(roles.filter((r) => r === 'secondary')).toHaveLength(1);
        expect(roles.filter((r) => r === 'inert')).toHaveLength(CLASS_ORDER.length - 1);
      }
    }
  });

  it('reports hover and press per tile, so a pointer lights the one it is over', () => {
    const model = shipSelectModel(
      { shipClass: DEFAULT_SHIP_CLASS, locked: false },
      { hover: { kind: 'hull', index: 2 }, press: { kind: 'hull', index: 3 } },
    );
    expect(model.tiles.map((t) => t.state)).toEqual(['rest', 'rest', 'hover', 'press']);
    expect(model.backState).toBe('rest');
  });
});

describe('targets', () => {
  it('maps a tile index to the hull the card drew, through CLASS_ORDER', () => {
    for (let i = 0; i < CLASS_ORDER.length; i++) expect(shipClassAt(i)).toBe(CLASS_ORDER[i]);
    // Out of range is `undefined` rather than a wrong hull — the caller refuses.
    expect(shipClassAt(99)).toBeUndefined();
    expect(shipClassAt(-1)).toBeUndefined();
  });

  it('compares targets structurally, and keys them stably', () => {
    expect(sameShipTarget({ kind: 'hull', index: 1 }, { kind: 'hull', index: 1 })).toBe(true);
    expect(sameShipTarget({ kind: 'hull', index: 1 }, { kind: 'hull', index: 2 })).toBe(false);
    expect(sameShipTarget({ kind: 'back' }, { kind: 'hull', index: 0 })).toBe(false);
    expect(sameShipTarget(null, null)).toBe(true);
    expect(sameShipTarget(null, { kind: 'back' })).toBe(false);
    expect(shipSelectTargetKey({ kind: 'back' })).toBe('back');
    expect(shipSelectTargetKey({ kind: 'hull', index: 3 })).toBe('hull:3');
    expect(shipSelectTargetKey(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Layout — the reason the screen exists
// ---------------------------------------------------------------------------

describe('layout', () => {
  for (const { name, vp, touch } of PROFILES) {
    it(`lays four tiles inside the content box, never overlapping — ${name}`, () => {
      const layout = shipSelectLayout(vp, { isTouch: touch });
      expect(layout.tiles).toHaveLength(CLASS_ORDER.length);
      for (let i = 0; i < layout.tiles.length; i++) {
        const tile = layout.tiles[i]!;
        expect(rectContains(layout.content, tile), `tile ${i} escapes content on ${name}`).toBe(true);
        for (let j = 0; j < i; j++) {
          expect(overlaps(layout.tiles[j]!, tile), `tiles ${j}/${i} overlap on ${name}`).toBe(false);
        }
        expect(overlaps(layout.back, tile), `BACK hits tile ${i} on ${name}`).toBe(false);
      }
      expect(rectContains(layout.content, layout.back), `BACK escapes content on ${name}`).toBe(true);
    });

    it(`keeps every tile and BACK thumb-sized — ${name}`, () => {
      const layout = shipSelectLayout(vp, { isTouch: touch });
      for (let i = 0; i < layout.tiles.length; i++) {
        expect(layout.tiles[i]!.height, `tile ${i} untappable on ${name}`).toBeGreaterThanOrEqual(TOUCH_MIN);
        expect(layout.tiles[i]!.width, `tile ${i} untappable on ${name}`).toBeGreaterThanOrEqual(TOUCH_MIN);
      }
      // BACK is the ONLY way off this screen, so it takes the thumb floor even on
      // the viewports whose footer beam is itself under it — the lobby's own RUSH!
      // arithmetic, shared (`./gantry` `beamActionPlate`).
      expect(layout.back.height, `BACK untappable on ${name}`).toBeGreaterThanOrEqual(TOUCH_MIN);
      expect(layout.back.width, `BACK untappable on ${name}`).toBeGreaterThanOrEqual(TOUCH_MIN);
    });

    it(`draws all six stats on every hull — ${name}`, () => {
      // The point of the split, measured. In the lobby column the tiles dropped
      // GDD §2.11's role blurb on every phone in this matrix; here they keep the
      // grid on all of them, and the cells stay inside their own tile.
      const layout = shipSelectLayout(vp, { isTouch: touch });
      for (let t = 0; t < layout.tiles.length; t++) {
        const tile = layout.tiles[t]!;
        const content = classTileContent(tile);
        expect(content.showStats, `stats dropped on ${name} tile ${t}`).toBe(true);
        expect(content.statColumns * content.statRows).toBeGreaterThanOrEqual(STAT_COUNT);
        const cells: Rect[] = [];
        for (let i = 0; i < STAT_COUNT; i++) {
          const cell = classStatCell(content, i);
          expect(rectContains(tile, cell), `stat ${i} escapes ${name} tile ${t}`).toBe(true);
          for (const other of cells) {
            expect(overlaps(other, cell), `stat cells overlap on ${name}`).toBe(false);
          }
          cells.push(cell);
        }
      }
    });
  }

  it('gives the ROLE BLURB back on both form factors — the block the lobby dropped', () => {
    // GDD §2.11 gives each hull a sentence, and `classTileContent`'s ladder drops it
    // first. In the lobby's column it was dropped on every phone in QA's matrix.
    // Given the screen, a desktop AND a landscape phone both draw it — which is the
    // clearest single measure of what the developer's report bought.
    for (const vp of [
      { width: 1280, height: 720 },
      { width: 844, height: 390 },
    ] as const) {
      const layout = shipSelectLayout(vp, { isTouch: vp.width < 900 });
      for (let t = 0; t < layout.tiles.length; t++) {
        const content = classTileContent(layout.tiles[t]!);
        expect(content.showBlurb, `blurb dropped on ${vp.width}×${vp.height} tile ${t}`).toBe(true);
        expect(content.showHull, `hull nickname dropped on ${vp.width}×${vp.height}`).toBe(true);
      }
    }
  });

  it('lays the six stats across in ONE table-like row on desktop and landscape phone', () => {
    // The comparison the pips exist for. In the lobby column a phone tile folded to
    // 3×2; here both form factors get GDD §2.11's own table row.
    for (const vp of [
      { width: 1280, height: 720 },
      { width: 844, height: 390 },
    ] as const) {
      const content = classTileContent(shipSelectLayout(vp, { isTouch: vp.width < 900 }).tiles[0]!);
      expect(content.statColumns, `stat columns on ${vp.width}×${vp.height}`).toBe(STAT_COUNT);
      expect(content.statRows).toBe(1);
    }
  });

  it('prefers a 2×2, and caps the tiles so a 4K desktop gets no banners', () => {
    const desktop = shipSelectLayout({ width: 1280, height: 720 });
    expect(desktop.tileShape).toBe('grid');
    expect(desktop.tiles[0]!.height).toBeLessThanOrEqual(SHIP_TILE_MAX + 1e-9);
    // The cap binds on a tall window rather than the window binding on the tiles.
    const tall = shipSelectLayout({ width: 1600, height: 2000 });
    expect(tall.tiles[0]!.height).toBeCloseTo(SHIP_TILE_MAX, 6);
  });

  it('hit-tests what it drew: BACK, then each tile', () => {
    for (const { name, vp, touch } of PROFILES) {
      const layout = shipSelectLayout(vp, { isTouch: touch });
      const back = center(layout.back);
      expect(shipSelectHitTest(layout, back.x, back.y), `BACK on ${name}`).toEqual({ kind: 'back' });
      for (let i = 0; i < layout.tiles.length; i++) {
        const p = center(layout.tiles[i]!);
        expect(shipSelectHitTest(layout, p.x, p.y), `tile ${i} on ${name}`).toEqual({
          kind: 'hull',
          index: i,
        });
      }
      // A tap on nothing is nothing — never the nearest control.
      expect(shipSelectHitTest(layout, -50, -50)).toBeNull();
    }
  });

  it('yields untappable rects rather than a backwards layout on a zero viewport', () => {
    const layout = shipSelectLayout({ width: 0, height: 0 });
    for (const rect of [...layout.tiles, layout.back, layout.hint]) {
      expect(rect.width).toBeGreaterThanOrEqual(0);
      expect(rect.height).toBeGreaterThanOrEqual(0);
    }
    expect(shipSelectHitTest(layout, 0, 0)).toBeNull();
  });
});
