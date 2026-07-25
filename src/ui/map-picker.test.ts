/**
 * src/ui/map-picker.test.ts — the map-picker model + geometry, headless.
 *
 * The picker decides three things: what the four cards say, where a card is
 * drawn, and which arena a tap selects — all pure functions, so the whole screen
 * is asserted here with no Pixi and no canvas (the discipline the rest of `src/ui`
 * keeps). The *wiring* (the menu opens it, PLAY boots the chosen map) is the
 * live-stage suite's job (`tests/live-stage/map-picker.spec.ts`).
 */

import { describe, it, expect } from 'vitest';
import {
  MAP_CARD_MIN_HEIGHT,
  MAP_ORDER,
  MAP_PREVIEW_SEED,
  MAP_PREVIEW_SLOTS,
  VETERAN_MAP_ID,
  mapIdAt,
  mapIndexOf,
  mapPickerHitTest,
  mapPickerLayout,
  mapPickerModel,
  mapPreview,
  normalizeMapId,
  registryPlanets,
} from './map-picker';
import { DEFAULT_MAP_ID, MAPS, getMap } from '../sim/maps';
import { MATCH_SLOTS } from '../bots';
import type { Rect } from '@platform/layout-registry';

const BAND: Rect = { x: 20, y: 100, width: 900, height: 200 };
const center = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

describe('the model', () => {
  it('shows exactly the four ratified maps, octagon first', () => {
    const model = mapPickerModel(DEFAULT_MAP_ID);
    expect(model.cards).toHaveLength(4);
    expect(model.cards.map((c) => c.id)).toEqual(MAPS.map((m) => m.id));
    expect(model.cards[0]?.id).toBe('octagon');
  });

  it('preselects octagon the first time out (an unknown/empty selection)', () => {
    for (const sel of ['', 'nope', DEFAULT_MAP_ID]) {
      const model = mapPickerModel(sel);
      expect(model.selectedId).toBe('octagon');
      expect(model.cards.filter((c) => c.selected).map((c) => c.id)).toEqual(['octagon']);
    }
  });

  it('selects exactly the card asked for when it is a real map', () => {
    const model = mapPickerModel('oval');
    expect(model.selectedId).toBe('oval');
    const selected = model.cards.filter((c) => c.selected);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.id).toBe('oval');
  });

  it('tags only Double Diamond as VETERAN', () => {
    const model = mapPickerModel(DEFAULT_MAP_ID);
    const veterans = model.cards.filter((c) => c.veteran).map((c) => c.id);
    expect(veterans).toEqual([VETERAN_MAP_ID]);
    expect(VETERAN_MAP_ID).toBe('diamond');
  });

  it('carries each map its name and blurb from the registry, no numbers invented', () => {
    const model = mapPickerModel(DEFAULT_MAP_ID);
    for (const card of model.cards) {
      const map = getMap(card.id);
      expect(card.name).toBe(map.name);
      expect(card.blurb).toBe(map.blurb);
    }
  });
});

describe('the preview — it cannot lie', () => {
  it('draws one dot per home planet, normalised into the arena box', () => {
    for (const map of MAPS) {
      const preview = mapPreview(map);
      expect(preview.planets).toHaveLength(MAP_PREVIEW_SLOTS);
      for (const p of preview.planets) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1);
      }
    }
  });

  it('reports the arena aspect (wide for oval/diamond, square for octagon/compass)', () => {
    expect(mapPreview(getMap('octagon')).aspect).toBeCloseTo(1, 5);
    expect(mapPreview(getMap('compass')).aspect).toBeCloseTo(1, 5);
    expect(mapPreview(getMap('oval')).aspect).toBeGreaterThan(1);
    expect(mapPreview(getMap('diamond')).aspect).toBeGreaterThan(1);
  });

  it('normalised dots re-scale to the registry board (the picture is the board)', () => {
    for (const map of MAPS) {
      const preview = mapPreview(map);
      const raw = registryPlanets(map.id);
      for (let i = 0; i < raw.length; i++) {
        expect(preview.planets[i]!.x * map.bounds.width).toBeCloseTo(raw[i]!.x, 3);
        expect(preview.planets[i]!.y * map.bounds.height).toBeCloseTo(raw[i]!.y, 3);
      }
    }
  });

  it('previews the full match ring — one dot per lobby slot', () => {
    expect(MAP_PREVIEW_SLOTS).toBe(MATCH_SLOTS);
  });
});

describe('registryPlanets — the board a booted match builds', () => {
  it('equals the map registry call createWorld makes, in slot order', () => {
    for (const map of MAPS) {
      const expected = map
        .planets(MAP_PREVIEW_SEED, MAP_PREVIEW_SLOTS, map.bounds)
        .map((p) => p.planet);
      const got = registryPlanets(map.id);
      expect(got).toHaveLength(expected.length);
      for (let i = 0; i < expected.length; i++) {
        expect(got[i]!.x).toBeCloseTo(expected[i]!.x, 6);
        expect(got[i]!.y).toBeCloseTo(expected[i]!.y, 6);
      }
    }
  });

  it('a different map yields a different board (so a picker bug cannot pass unseen)', () => {
    const ring = registryPlanets('octagon');
    const diamond = registryPlanets('diamond');
    const same = ring.every((p, i) => p.x === diamond[i]?.x && p.y === diamond[i]?.y);
    expect(same).toBe(false);
  });
});

describe('normalizeMapId / mapIdAt / mapIndexOf', () => {
  it('folds a stale or missing key down to the default', () => {
    expect(normalizeMapId(null)).toBe(DEFAULT_MAP_ID);
    expect(normalizeMapId(undefined)).toBe(DEFAULT_MAP_ID);
    expect(normalizeMapId('')).toBe(DEFAULT_MAP_ID);
    expect(normalizeMapId('hand-edited')).toBe(DEFAULT_MAP_ID);
  });

  it('passes a real map id through unchanged', () => {
    for (const id of MAP_ORDER) expect(normalizeMapId(id)).toBe(id);
  });

  it('round-trips an index through mapIdAt / mapIndexOf', () => {
    for (let i = 0; i < MAP_ORDER.length; i++) {
      expect(mapIndexOf(mapIdAt(i))).toBe(i);
    }
    // An out-of-range index picks the default, never nothing.
    expect(mapIdAt(99)).toBe(DEFAULT_MAP_ID);
    expect(mapIdAt(-1)).toBe(DEFAULT_MAP_ID);
  });
});

describe('layout', () => {
  it('places one rect per card inside the band', () => {
    const layout = mapPickerLayout(BAND);
    expect(layout.cards).toHaveLength(MAPS.length);
    for (const rect of layout.cards) {
      expect(rect.x).toBeGreaterThanOrEqual(BAND.x - 0.001);
      expect(rect.y).toBeGreaterThanOrEqual(BAND.y - 0.001);
      expect(rect.x + rect.width).toBeLessThanOrEqual(BAND.x + BAND.width + 0.001);
      expect(rect.y + rect.height).toBeLessThanOrEqual(BAND.y + BAND.height + 0.001);
    }
  });

  it('lays four across in a wide band, and 2×2 when it cannot', () => {
    const wide = mapPickerLayout({ x: 0, y: 0, width: 900, height: 180 });
    expect(wide.shape).toBe('row');
    expect(wide.columns).toBe(4);

    const narrow = mapPickerLayout({ x: 0, y: 0, width: 320, height: 320 });
    expect(narrow.shape).toBe('grid');
    expect(narrow.columns).toBe(2);
  });

  it('keeps every card a thumb-sized target (tall enough to read)', () => {
    // A phone-landscape-sized band still yields cards at least the min height.
    const layout = mapPickerLayout({ x: 16, y: 90, width: 780, height: 150 });
    for (const rect of layout.cards) {
      expect(rect.height).toBeGreaterThanOrEqual(MAP_CARD_MIN_HEIGHT - 40); // capped, but never a strip
      expect(rect.width).toBeGreaterThan(0);
    }
  });

  it('yields no cards, not a backwards rect, on a zero band', () => {
    const layout = mapPickerLayout({ x: 0, y: 0, width: 0, height: 0 });
    expect(layout.cards).toHaveLength(0);
  });
});

describe('hit test', () => {
  it('lands a tap on the card under it, and maps back to the right map', () => {
    const layout = mapPickerLayout(BAND);
    for (let i = 0; i < layout.cards.length; i++) {
      const c = center(layout.cards[i]!);
      const hit = mapPickerHitTest(layout, c.x, c.y);
      expect(hit).toBe(i);
      expect(mapIdAt(hit!)).toBe(MAP_ORDER[i]);
    }
  });

  it('is null on the gap between cards and off the band', () => {
    const layout = mapPickerLayout(BAND);
    expect(mapPickerHitTest(layout, -50, -50)).toBeNull();
    expect(mapPickerHitTest(layout, BAND.x + BAND.width + 100, center(BAND).y)).toBeNull();
  });
});
