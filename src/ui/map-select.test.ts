/**
 * src/ui/map-select.test.ts — the MAP SELECT screen, headless (u10-01).
 *
 * The brief's test list, for the arena half — and one item on it is the one this
 * file exists for:
 *
 *  - pressing the lobby's one arena card opens this screen;
 *  - picking returns to the lobby with the choice on the single card;
 *  - BACK returns without changing the pick;
 *  - **a guest cannot change the arena**, and the screen says so *before* they
 *    press anything rather than swallowing the press;
 *  - and the map registry's guarantees are exactly where they were: six maps, The
 *    Ring the default, the resource fairness `src/sim/maps` owns. This brief moves
 *    where a map is chosen, not what the maps are — so the registry assertions are
 *    written as "this screen shows the registry", never as a second copy of it.
 */

import { describe, it, expect } from 'vitest';
import type { Rect, Viewport } from '@platform/layout-registry';
import { rectContains } from '@platform/layout-registry';
import { TOUCH_MIN } from '../art/materials';
import { countPrimaries, singlePrimary } from './gantry';
import { ShipClass } from '@shared/types';
import { DEFAULT_ABUNDANCE } from '../sim/constants';
import { DEFAULT_MAP_ID, MAPS } from '../sim/maps';
import { createWorld } from '../sim/state';
import type { PlayerSpec } from '../sim/state';
import {
  MAP_ORDER,
  MAP_PREVIEW_SEED,
  MAP_PREVIEW_SLOTS,
  VETERAN_MAP_ID,
  mapPreview,
  registryStations,
} from './map-picker';
import {
  MAP_SELECT_GUEST_HINT,
  MAP_SELECT_HINT,
  MAP_SELECT_TITLE,
  mapIdAtCard,
  mapSelectHitTest,
  mapSelectLayout,
  mapSelectModel,
  mapSelectPlateRoles,
  mapSelectTargetKey,
  sameMapTarget,
} from './map-select';
import {
  closeLobbyScreen,
  createLobby,
  lobbyModel,
  openMapSelect,
  pickMap,
  pressRush,
  selectMap,
} from './lobby';

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

/** A host's room (offline: you are the host), and a guest's (seat 3 of somebody
 *  else's room). The two clients this screen behaves differently for. */
const host = () => createLobby({ room: 'ABCD', online: false });
const guest = () => createLobby({ room: 'ABCD', you: 3, host: 0 });

// ---------------------------------------------------------------------------
// Getting there, and getting back
// ---------------------------------------------------------------------------

describe('opening and leaving MAP SELECT (u10-01)', () => {
  it('opens from the lobby’s one arena card', () => {
    expect(host().screen).toBe('roster');
    expect(openMapSelect(host()).screen).toBe('map-select');
    expect(lobbyModel(openMapSelect(host())).screen).toBe('map-select');
  });

  it('BACK returns to the roster and changes NOTHING about the pick', () => {
    const picked = pickMap(host(), 'diamond');
    const reopened = openMapSelect(picked);
    const back = closeLobbyScreen(reopened);
    expect(back.screen).toBe('roster');
    expect(back.mapId).toBe('diamond');
    expect({ ...back, screen: 'x' }).toEqual({ ...reopened, screen: 'x' });
  });

  it('picking RETURNS to the lobby with the arena on the single card', () => {
    for (const map of MAPS) {
      const picked = pickMap(openMapSelect(host()), map.id);
      expect(picked.screen).toBe('roster');
      const card = lobbyModel(picked).mapCard;
      expect(card.id).toBe(map.id);
      expect(card.name).toBe(map.name);
      expect(card.selected).toBe(true);
    }
  });

  it('folds a nonsense id to the default rather than leaving the card blank', () => {
    const picked = pickMap(openMapSelect(host()), 'atlantis');
    expect(picked.mapId).toBe(DEFAULT_MAP_ID);
    expect(lobbyModel(picked).mapCard.id).toBe(DEFAULT_MAP_ID);
  });

  it('locks with the hull at RUSH! — the arena the world was built from cannot move', () => {
    const counting = pressRush(host());
    expect(counting.phase).toBe('counting');
    const late = pickMap(openMapSelect(counting), 'diamond');
    expect(late.mapId).toBe(DEFAULT_MAP_ID);
    expect(lobbyModel(counting).canPickMap).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The host rule — the brief names this one explicitly
// ---------------------------------------------------------------------------

describe('a guest reads the arena and cannot change it', () => {
  it('OPENS the screen for a guest — the refusal is on the pick, not on the look', () => {
    // The brief asked which was chosen and why. This is it, and the reason is the
    // lobby's own standing rule: a control must LOOK unavailable rather than look
    // live and then refuse — and a card that would not open at all is neither. It
    // would also withhold the board they are about to fly, which is the very thing
    // p2 put the map in front of the match for.
    const g = guest();
    expect(openMapSelect(g).screen).toBe('map-select');
  });

  it('refuses the PICK, and hands them back rather than stranding them', () => {
    const g = openMapSelect(guest());
    const tried = pickMap(g, 'diamond');
    expect(tried.mapId, 'a guest cannot change the arena').toBe(DEFAULT_MAP_ID);
    expect(tried.screen, 'and is handed back to the roster').toBe('roster');
    // The refusal is `selectMap`'s and returns the IDENTICAL lobby, which is what
    // lets the wiring tell a refusal from a change by identity and send nothing.
    expect(selectMap(g, 'diamond')).toBe(g);
  });

  it('SAYS whose pick it is, before anything is pressed', () => {
    expect(mapSelectModel({ mapId: DEFAULT_MAP_ID, canPick: false }).hint).toBe(MAP_SELECT_GUEST_HINT);
    expect(mapSelectModel({ mapId: DEFAULT_MAP_ID, canPick: true }).hint).toBe(MAP_SELECT_HINT);
    // …in the same noun the footer already uses for the person who started the
    // game ("host", a0-108 — overturning the §4.7 worked example that read the
    // other way), so the roster and this screen teach one word.
    expect(MAP_SELECT_GUEST_HINT).toContain('HOST');
  });

  it('reports the host rule on the LOBBY’s card too, so the tell is on both screens', () => {
    expect(lobbyModel(guest()).canPickMap).toBe(false);
    expect(lobbyModel(host()).canPickMap).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The registry, unchanged — the brief's "what must not change"
// ---------------------------------------------------------------------------

describe('the map registry and its guarantees are untouched', () => {
  it('shows exactly the registry, in registry order, with The Ring the default', () => {
    const model = mapSelectModel({ mapId: DEFAULT_MAP_ID, canPick: true });
    expect(model.title).toBe(MAP_SELECT_TITLE);
    expect(model.picker.cards.map((c) => c.id)).toEqual(MAPS.map((m) => m.id));
    expect(model.picker.cards.map((c) => c.id)).toEqual([...MAP_ORDER]);
    expect(DEFAULT_MAP_ID).toBe('octagon');
    expect(model.selectedId).toBe(DEFAULT_MAP_ID);
    // …and a fresh lobby is on it, which is the onboarding default p2 set.
    expect(createLobby({ room: 'ABCD' }).mapId).toBe(DEFAULT_MAP_ID);
  });

  it('tags VETERAN where the registry says, and nowhere else', () => {
    const model = mapSelectModel({ mapId: DEFAULT_MAP_ID, canPick: true });
    expect(model.picker.cards.filter((c) => c.veteran).map((c) => c.id)).toEqual([VETERAN_MAP_ID]);
  });

  it('draws each card’s dots from the registry’s own stations — the preview cannot lie', () => {
    const model = mapSelectModel({ mapId: DEFAULT_MAP_ID, canPick: true });
    for (const card of model.picker.cards) {
      const map = MAPS.find((m) => m.id === card.id)!;
      expect(card.preview).toEqual(mapPreview(map));
      // …and re-scaling those normalised dots lands on the board a match builds.
      const raw = registryStations(card.id);
      for (let i = 0; i < raw.length; i++) {
        expect(card.preview.stations[i]!.x * map.bounds.width).toBeCloseTo(raw[i]!.x, 3);
      }
    }
  });

  /**
   * ---------------------------------------------------------------------------
   * a0-124 — THE PREVIEW IS A RENDERING, NOT A PICTURE OF ONE
   * ---------------------------------------------------------------------------
   * The developer, on the picker: *"for the previews of the maps i'd like to see a
   * more accurate image of them when choosing the map showing the ores, empty
   * stations locations, the nebulas and stars in the back… just more accurate
   * overall."* The card showed berths and nothing else, and the header said why —
   * the dots were read off the registry, and **the registry does not know where the
   * ore is**. A `MapDef` owns the arena bounds and the `StationPlacement` list;
   * the field is stamped at world build by `../sim/waves` `spawnHomeFields` and the
   * opening `spawnWave`, out of the seeded RNG.
   *
   * So there are exactly two ways a card can show ore: run the generator, or write
   * a second one. This test is the one that says which happened. It builds the
   * world **the way the match builds it** and holds every berth and every rock on
   * the card against it — so a preview that drifted, sampled, decorated or
   * hand-listed any part of the board fails here, and so does today's code, which
   * has no ore on the card at all.
   */
  describe('the board on the card is the board the match builds (a0-124)', () => {
    /** The roster a preview's world is built with — `./map-picker` `PREVIEW_ROSTER`,
     *  restated rather than exported, so this spec is an independent witness to the
     *  world rather than a call into the code it is checking. */
    const roster: PlayerSpec[] = Array.from({ length: MAP_PREVIEW_SLOTS }, (_, id) => ({
      id,
      shipClass: ShipClass.Vanguard,
    }));

    it('a preview is generated from the map the match will build', () => {
      const model = mapSelectModel({ mapId: DEFAULT_MAP_ID, canPick: true });
      expect(model.picker.cards).toHaveLength(MAPS.length);

      for (const card of model.picker.cards) {
        const map = MAPS.find((m) => m.id === card.id)!;
        // The match's own constructor, on the map's own bounds. Not `map.stations`
        // and not a re-derivation of the field: the thing `bootOfflineMatch` calls.
        const world = createWorld({
          seed: MAP_PREVIEW_SEED,
          players: roster,
          mapId: map.id,
          abundance: DEFAULT_ABUNDANCE,
        });
        const { width, height } = world.bounds;
        expect(width).toBeGreaterThan(0);
        expect(height).toBeGreaterThan(0);
        expect(card.preview.aspect).toBeCloseTo(width / height, 6);

        // --- The berths ---------------------------------------------------------
        // Every board position, at its own place and its own size. `MapDef` does
        // declare these, so this half could have been faked off the registry — it is
        // held against the world anyway, because the card must not be half a
        // rendering.
        expect(card.preview.stations).toHaveLength(world.stations.length);
        world.stations.forEach((station, i) => {
          const berth = card.preview.stations[i]!;
          expect(berth.x * width).toBeCloseTo(station.pos.x, 3);
          expect(berth.y * height).toBeCloseTo(station.pos.y, 3);
          expect(berth.r * width).toBeCloseTo(station.radius, 3);
        });

        // --- The ore ------------------------------------------------------------
        // The half no `MapDef` declares, and the half this brief is about. A
        // generated field is not a short list: every rock the world opens with is on
        // the card, at its own place and its own size, in the order the generator
        // stamped them.
        expect(world.asteroids.length).toBeGreaterThan(MAP_PREVIEW_SLOTS);
        expect(card.preview.ore).toHaveLength(world.asteroids.length);
        world.asteroids.forEach((rock, i) => {
          const drawn = card.preview.ore[i]!;
          expect(drawn.x * width).toBeCloseTo(rock.pos.x, 3);
          expect(drawn.y * height).toBeCloseTo(rock.pos.y, 3);
          expect(drawn.r * width).toBeCloseTo(rock.radius, 3);
        });
      }
    });

    it('shows the ore that tells one board from another — not one field six times', () => {
      // The point of showing the field at all: `spawnHomeFields` gives every player
      // an identical neighbourhood BY CONSTRUCTION and the commons is `N`-fold
      // symmetric, so what differs between The Line and The Ring is where all of
      // that sits. If six cards drew the same scatter, the picture would be
      // decoration.
      const fingerprints = MAPS.map((map) =>
        mapPreview(map)
          .ore.map((r) => `${r.x.toFixed(4)},${r.y.toFixed(4)}`)
          .join('|'),
      );
      expect(new Set(fingerprints).size).toBe(MAPS.length);
    });

    it('builds each board ONCE — the per-frame model may not build six worlds', () => {
      // `mapSelectModel` runs every frame (`./map-select`), and `createWorld` is not
      // free. The memo is load-bearing, not an optimisation: identity across frames
      // is the only cheap proof that no second world was built.
      const first = mapSelectModel({ mapId: DEFAULT_MAP_ID, canPick: true });
      const second = mapSelectModel({ mapId: 'line', canPick: false });
      for (const card of first.picker.cards) {
        const twin = second.picker.cards.find((c) => c.id === card.id)!;
        expect(twin.preview).toBe(card.preview);
        expect(mapPreview(MAPS.find((m) => m.id === card.id)!)).toBe(card.preview);
      }
    });
  });

  it('lights exactly one card, and it is the selection', () => {
    for (const map of MAPS) {
      const model = mapSelectModel({ mapId: map.id, canPick: true });
      expect(model.picker.cards.filter((c) => c.selected).map((c) => c.id)).toEqual([map.id]);
    }
  });

  it('keeps BACK as the screen’s ONE bright plate', () => {
    for (const canPick of [true, false]) {
      const roles = mapSelectPlateRoles(mapSelectModel({ mapId: 'oval', canPick }));
      expect(countPrimaries(roles)).toBe(1);
      expect(singlePrimary(roles)).toBe(true);
      expect(roles.filter((r) => r === 'secondary')).toHaveLength(1);
      expect(roles.filter((r) => r === 'inert')).toHaveLength(MAPS.length - 1);
    }
  });
});

describe('targets', () => {
  it('maps a card index to the arena the card drew', () => {
    for (let i = 0; i < MAP_ORDER.length; i++) expect(mapIdAtCard(i)).toBe(MAP_ORDER[i]);
    // A stray index picks the default rather than nothing.
    expect(mapIdAtCard(99)).toBe(DEFAULT_MAP_ID);
  });

  it('compares targets structurally, and keys them stably', () => {
    expect(sameMapTarget({ kind: 'arena', index: 2 }, { kind: 'arena', index: 2 })).toBe(true);
    expect(sameMapTarget({ kind: 'arena', index: 2 }, { kind: 'arena', index: 3 })).toBe(false);
    expect(sameMapTarget({ kind: 'back' }, { kind: 'back' })).toBe(true);
    expect(sameMapTarget(undefined, undefined)).toBe(true);
    expect(mapSelectTargetKey({ kind: 'arena', index: 1 })).toBe('arena:1');
    expect(mapSelectTargetKey({ kind: 'back' })).toBe('back');
    expect(mapSelectTargetKey(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

describe('layout', () => {
  for (const { name, vp, touch } of PROFILES) {
    it(`lays one card per map inside the content box, never overlapping — ${name}`, () => {
      const layout = mapSelectLayout(vp, { isTouch: touch });
      expect(layout.picker.cards).toHaveLength(MAPS.length);
      for (let i = 0; i < layout.picker.cards.length; i++) {
        const card = layout.picker.cards[i]!;
        expect(rectContains(layout.content, card), `card ${i} escapes content on ${name}`).toBe(true);
        for (let j = 0; j < i; j++) {
          expect(overlaps(layout.picker.cards[j]!, card), `cards ${j}/${i} overlap on ${name}`).toBe(false);
        }
        expect(overlaps(layout.back, card), `BACK hits card ${i} on ${name}`).toBe(false);
      }
    });

    it(`keeps every card and BACK thumb-sized — ${name}`, () => {
      // The floor a0-12 could only just hold in the lobby's 64px column, met with
      // room to spare now that the cards have the band (`./map-picker.test.ts`
      // carries the measurement that closed a0-12's note to the UI owner).
      const layout = mapSelectLayout(vp, { isTouch: touch });
      for (let i = 0; i < layout.picker.cards.length; i++) {
        const card = layout.picker.cards[i]!;
        expect(card.width, `card ${i} untappable wide on ${name}`).toBeGreaterThanOrEqual(44);
        expect(card.height, `card ${i} untappable tall on ${name}`).toBeGreaterThanOrEqual(44);
      }
      // BACK is the only way off this screen — for a guest it is the only control
      // on it at all — so it takes the thumb floor on every viewport.
      expect(layout.back.height, `BACK untappable on ${name}`).toBeGreaterThanOrEqual(TOUCH_MIN);
      expect(layout.back.width, `BACK untappable on ${name}`).toBeGreaterThanOrEqual(TOUCH_MIN);
    });
  }

  it('hit-tests what it drew: BACK, then each card', () => {
    for (const { name, vp, touch } of PROFILES) {
      const layout = mapSelectLayout(vp, { isTouch: touch });
      const back = center(layout.back);
      expect(mapSelectHitTest(layout, back.x, back.y), `BACK on ${name}`).toEqual({ kind: 'back' });
      for (let i = 0; i < layout.picker.cards.length; i++) {
        const p = center(layout.picker.cards[i]!);
        expect(mapSelectHitTest(layout, p.x, p.y), `card ${i} on ${name}`).toEqual({
          kind: 'arena',
          index: i,
        });
      }
      expect(mapSelectHitTest(layout, -50, -50)).toBeNull();
    }
  });

  it('yields untappable rects rather than a backwards layout on a zero viewport', () => {
    const layout = mapSelectLayout({ width: 0, height: 0 });
    for (const rect of [...layout.picker.cards, layout.back, layout.hint]) {
      expect(rect.width).toBeGreaterThanOrEqual(0);
      expect(rect.height).toBeGreaterThanOrEqual(0);
    }
    expect(mapSelectHitTest(layout, 0, 0)).toBeNull();
  });
});
