/**
 * src/ui/hangar.test.ts — the hangar, headless.
 *
 * Four things this file is here to stop shipping:
 *
 *  1. A cosmetic that changes a **silhouette** — the ratified information rule
 *     (style-guide §4, GDD §2.11). Asserted against the contract, before there
 *     is any content to assert it against.
 *  2. An **empty grid that looks broken**. With zero cosmetics defined the
 *     screen still has to be worth opening, and it has to *say* there is nothing
 *     yet. This is the test that stops the hangar shipping as a blank panel.
 *  3. A level readout that **recomputes** rather than reads — two screens
 *     disagreeing about what level a player is.
 *  4. An equip that does not survive a restart, or one that writes a level the
 *     player has not reached into the one file the game never wipes.
 */

import { describe, it, expect } from 'vitest';
import {
  COSMETICS,
  COSMETIC_INVARIANT,
  COSMETIC_SLOTS,
  COSMETIC_SLOT_SURFACE,
  COSMETIC_VARIABLE,
  HANGAR_EMPTY_LINE,
  cosmeticStatus,
  equipCosmetic,
  equippedId,
  hangarHitTest,
  hangarLayout,
  hangarModel,
  hangarTargetKey,
  isUnlocked,
  sameHangarTarget,
  type Cosmetic,
} from './hangar';
import { ShipClass } from '@shared/types';
import type { Rect } from '@platform/layout-registry';
import { TOUCH_MIN } from '../art/materials';
import { CLASS_OPTIONS } from './lobby';
import { levelProgress, xpToReach } from '../progression/curve';
import { freshProfile, loadProfile, saveProfile, type Profile, type ProfileStorage } from '../progression/profile';

const VIEWPORT = { width: 1280, height: 720 };
/** The phone the field report was on: 390×844 held portrait → the landscape lock
 *  rotates the root, so every menu lays out in an 844×390 LOGICAL viewport. */
const PHONE = { width: 844, height: 390 };
const center = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/** A profile at a given level, built the honest way: through the curve. */
function profileAtLevel(level: number, extra: Partial<Profile> = {}): Profile {
  return { ...freshProfile(), xp: xpToReach(level), level, matches: 3, ...extra };
}

/** Content for the populated cases. Deliberately NOT shipped — the hangar takes
 *  its list by argument, exactly as the codex takes its content, so a test can
 *  draw a full screen without inventing a cosmetic the game claims to have. */
const SAMPLE: readonly Cosmetic[] = [
  { id: 'livery.ashfield', name: 'ASHFIELD', slot: 'livery', level: 2 },
  { id: 'decal.tally', name: 'TALLY MARKS', slot: 'decal', level: 5 },
  { id: 'glow.cold', name: 'COLD BURN', slot: 'glow', level: 12 },
];

function memoryStorage(): ProfileStorage & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, get: (k) => map.get(k) ?? null, set: (k, v) => void map.set(k, v) };
}

// ---------------------------------------------------------------------------

describe('the cosmetic contract: silhouettes are information', () => {
  it('lets a cosmetic vary only surfaces, never shape', () => {
    // The two lists are the boundary, written down before any content exists so
    // the first person adding some MEETS the rule rather than discovers it.
    expect(COSMETIC_VARIABLE).toEqual(['colour', 'livery', 'decals', 'trim', 'engine glow']);
    expect(COSMETIC_INVARIANT).toEqual(['outline', 'proportions', 'class-identifying geometry']);
  });

  it('gives every slot a surface from the VARIABLE list, and none from the INVARIANT one', () => {
    for (const slot of COSMETIC_SLOTS) {
      const surface = COSMETIC_SLOT_SURFACE[slot];
      expect(COSMETIC_VARIABLE, `${slot} dresses something it may not`).toContain(surface);
      expect(COSMETIC_INVARIANT as readonly string[]).not.toContain(surface);
    }
  });

  it('has no slot that could name a hull, a shape or a silhouette', () => {
    // A `hull` slot is how this rule dies: not by someone arguing against it,
    // but by an innocuous-looking fifth entry in a list.
    for (const slot of COSMETIC_SLOTS) {
      expect(slot).not.toMatch(/hull|shape|silhouette|outline|geometry|size|scale/);
    }
  });

  it('gives a Cosmetic no field a hull could hide in — and no price', () => {
    // Structural: the shipped shape is id / name / slot / level and nothing
    // else. Anything geometric would have to be smuggled through one of these
    // four, and a store would need a fifth.
    const keys = Object.keys(SAMPLE[0] as object).sort();
    expect(keys).toEqual(['id', 'level', 'name', 'slot']);
    for (const key of keys) expect(key).not.toMatch(/price|cost|currency|coin|gem|buy/);
  });
});

describe('it is not a store', () => {
  it('ships no cosmetics at all — the room, not the furniture', () => {
    // a0-13 ratified the direction and designed no content: "the list is empty
    // until the developer fills it" (plan §4). Pinned, so content cannot arrive
    // without someone reading the contract above.
    expect(COSMETICS).toEqual([]);
  });

  it('says nothing about money anywhere a player can read', () => {
    const model = hangarModel({ profile: profileAtLevel(6), shipClass: ShipClass.Vanguard, cosmetics: SAMPLE });
    const words = [
      model.title,
      model.eyebrow,
      model.level.levelLabel,
      model.level.xpLabel,
      model.level.nextLabel,
      model.level.matchesLabel,
      model.backLabel,
      ...model.rows.flatMap((r) => [r.name, r.slotLabel, r.action]),
    ].join(' ');
    expect(words.toLowerCase()).not.toMatch(/buy|price|cost|credit|coin|purchase|shop|store|\$/);
  });
});

describe('the empty state — what actually ships first', () => {
  const empty = hangarModel({ profile: profileAtLevel(4), shipClass: ShipClass.Hauler });

  it('renders an honest line instead of an empty grid', () => {
    // The one that stops it shipping as a blank panel: with zero cosmetics
    // defined, the screen SAYS there are none. An empty grid and a broken grid
    // look identical (LESSONS §20), and the first thing the developer will do
    // is open this screen.
    expect(empty.rows).toEqual([]);
    expect(empty.empty).toBe(HANGAR_EMPTY_LINE);
    expect(empty.empty).toMatch(/no cosmetics yet/i);
  });

  it('is still a real screen with nothing to unlock — a ship and a level on it', () => {
    // "A hangar that renders your ship and your level is a real screen even with
    // nothing to unlock. A hangar that renders an empty grid is a bug report."
    expect(empty.ship.shipClass).toBe(ShipClass.Hauler);
    expect(empty.ship.name.length).toBeGreaterThan(0);
    expect(empty.ship.hull.length).toBeGreaterThan(0);
    expect(empty.level.levelLabel).toBe('LEVEL 4');
    expect(empty.level.xpLabel).toMatch(/XP$/);
    expect(empty.level.nextLabel).toMatch(/TO LEVEL 5$/);
  });

  it('drops the line the moment there is something to list', () => {
    const full = hangarModel({ profile: profileAtLevel(4), shipClass: ShipClass.Hauler, cosmetics: SAMPLE });
    expect(full.empty).toBeNull();
    expect(full.rows).toHaveLength(SAMPLE.length);
  });

  it('still lays out a list viewport with room for the line', () => {
    // The rect has to exist even with no rows in it, or there is nowhere to draw
    // the sentence and the "empty state" is silence after all.
    for (const viewport of [VIEWPORT, PHONE]) {
      const layout = hangarLayout(viewport, { isTouch: viewport === PHONE });
      expect(layout.list.width).toBeGreaterThan(0);
      expect(layout.list.height).toBeGreaterThan(0);
      expect(layout.rows).toEqual([]);
    }
  });
});

describe('the ship in the bay', () => {
  it('names the hull with the LOBBY\'s own words, never a second set', () => {
    for (const option of CLASS_OPTIONS) {
      const model = hangarModel({ profile: freshProfile(), shipClass: option.shipClass });
      expect(model.ship.name).toBe(option.name);
      expect(model.ship.hull).toBe(option.hull);
      expect(model.ship.blurb).toBe(option.blurb);
    }
  });

  it('gives the bay a square worth looking at on both form factors', () => {
    for (const viewport of [VIEWPORT, PHONE]) {
      const { bay } = hangarLayout(viewport, { isTouch: viewport === PHONE });
      expect(bay.width).toBeGreaterThan(TOUCH_MIN);
      expect(bay.height).toBeGreaterThan(TOUCH_MIN);
    }
  });
});

describe('the level block reads, and never recomputes', () => {
  it('shows exactly what the curve says for that lifetime XP', () => {
    for (const level of [1, 2, 7, 20]) {
      const xp = xpToReach(level) + 17;
      const model = hangarModel({ profile: { ...freshProfile(), xp, level }, shipClass: ShipClass.Vanguard });
      const p = levelProgress(xp);
      expect(model.level.level).toBe(p.level);
      expect(model.level.frac).toBe(p.frac);
      expect(model.level.nextLabel).toContain(`TO LEVEL ${p.level + 1}`);
    }
  });

  it('trusts the XP over a stale cached level — the cache is not the source', () => {
    // `profile.level` is a cache of `levelForXp(profile.xp)`. A profile written
    // by a build with a different curve, or by a write that updated one and not
    // the other, must not put a level on screen the XP does not support.
    const lying: Profile = { ...freshProfile(), xp: xpToReach(3), level: 99 };
    expect(hangarModel({ profile: lying, shipClass: ShipClass.Vanguard }).level.level).toBe(3);
  });

  it('survives a corrupt-but-parseable total without a broken bar', () => {
    const junk: Profile = { ...freshProfile(), xp: Number.NaN, level: 1 };
    const model = hangarModel({ profile: junk, shipClass: ShipClass.Vanguard });
    expect(model.level.frac).toBeGreaterThanOrEqual(0);
    expect(model.level.frac).toBeLessThan(1);
    expect(model.level.level).toBeGreaterThanOrEqual(1);
  });

  it('counts one match as a MATCH and none as MATCHES', () => {
    const one = hangarModel({ profile: { ...freshProfile(), matches: 1 }, shipClass: ShipClass.Vanguard });
    const none = hangarModel({ profile: freshProfile(), shipClass: ShipClass.Vanguard });
    expect(one.level.matchesLabel).toBe('1 MATCH');
    expect(none.level.matchesLabel).toBe('0 MATCHES');
  });
});

describe('unlocking and equipping are different verbs', () => {
  it('unlocks on level alone — nothing else gates a row', () => {
    const c = SAMPLE[1]!; // level 5
    expect(isUnlocked(c, 4)).toBe(false);
    expect(isUnlocked(c, 5)).toBe(true);
    expect(isUnlocked(c, 40)).toBe(true);
  });

  it('reports locked / unlocked / equipped, and labels each one', () => {
    const at5 = profileAtLevel(5);
    const model = hangarModel({ profile: at5, shipClass: ShipClass.Vanguard, cosmetics: SAMPLE });
    expect(model.rows.map((r) => r.status)).toEqual(['unlocked', 'unlocked', 'locked']);
    expect(model.rows.map((r) => r.action)).toEqual(['EQUIP', 'EQUIP', 'LEVEL 12']);
    // A locked row is `inert`, not gray-as-disabled: this screen spends no hue
    // on state at all.
    expect(model.rows[2]?.role).toBe('inert');
  });

  it('equips an unlocked cosmetic, and refuses a locked one by staying IDENTICAL', () => {
    const at5 = profileAtLevel(5);
    const equipped = equipCosmetic(at5, SAMPLE[0]!);
    expect(equippedId(equipped, 'livery')).toBe('livery.ashfield');
    expect(cosmeticStatus(SAMPLE[0]!, equipped)).toBe('equipped');

    // Refused — and refused by identity, so the caller writes nothing to disk.
    expect(equipCosmetic(at5, SAMPLE[2]!)).toBe(at5);
  });

  it('un-equips on a second press — a slot you can fill is one you can empty', () => {
    const at5 = profileAtLevel(5);
    const on = equipCosmetic(at5, SAMPLE[0]!);
    const off = equipCosmetic(on, SAMPLE[0]!);
    expect(equippedId(off, 'livery')).toBeNull();
    // …and the key is GONE, not left as an empty object a JSON round trip would
    // have to carry forever.
    expect('equipped' in off).toBe(false);
  });

  it('keeps one cosmetic per slot, and leaves other slots alone', () => {
    const at12 = profileAtLevel(12);
    const withLivery = equipCosmetic(at12, SAMPLE[0]!);
    const withBoth = equipCosmetic(withLivery, SAMPLE[2]!);
    expect(equippedId(withBoth, 'livery')).toBe('livery.ashfield');
    expect(equippedId(withBoth, 'glow')).toBe('glow.cold');

    const swapped = equipCosmetic(withBoth, { id: 'livery.other', name: 'OTHER', slot: 'livery', level: 1 });
    expect(equippedId(swapped, 'livery')).toBe('livery.other');
    expect(equippedId(swapped, 'glow')).toBe('glow.cold');
  });

  it('ROUND-TRIPS the equipped choice through the profile — it survives a reload', () => {
    // The brief's third test, end to end and through the real reader: equip,
    // persist, throw the object away, read it back off the same key.
    const store = memoryStorage();
    saveProfile(store, equipCosmetic(profileAtLevel(5), SAMPLE[0]!));

    const reloaded = loadProfile(store);
    expect(equippedId(reloaded, 'livery')).toBe('livery.ashfield');
    expect(cosmeticStatus(SAMPLE[0]!, reloaded)).toBe('equipped');
    // And it is the ONE profile key — not a second store of the hangar's own.
    expect([...store.map.keys()]).toEqual(['planet-rush:profile']);
  });
});

describe('layout and hit test', () => {
  it('places every rect inside the viewport, on desktop and on a landscape phone', () => {
    for (const viewport of [VIEWPORT, PHONE]) {
      const layout = hangarLayout(viewport, { isTouch: viewport === PHONE, rowCount: SAMPLE.length });
      const rects = [layout.header, layout.footer, layout.bay, layout.levelPanel, layout.xpBar, layout.list, layout.back, ...layout.rows];
      for (const r of rects) {
        expect(r.x).toBeGreaterThanOrEqual(-0.5);
        expect(r.y).toBeGreaterThanOrEqual(-0.5);
        expect(r.x + r.width).toBeLessThanOrEqual(viewport.width + 0.5);
        expect(r.y + r.height).toBeLessThanOrEqual(viewport.height + 0.5);
        expect(r.width).toBeGreaterThanOrEqual(0);
        expect(r.height).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('keeps the bay and the panel side by side, never overlapping', () => {
    for (const viewport of [VIEWPORT, PHONE]) {
      const l = hangarLayout(viewport, { isTouch: viewport === PHONE, rowCount: SAMPLE.length });
      expect(l.levelPanel.x).toBeGreaterThanOrEqual(l.bay.x + l.bay.width);
      expect(l.list.x).toBe(l.levelPanel.x);
      expect(l.list.y).toBeGreaterThanOrEqual(l.levelPanel.y + l.levelPanel.height);
      expect(l.xpBar.y).toBeGreaterThanOrEqual(l.levelPanel.y);
      expect(l.xpBar.y + l.xpBar.height).toBeLessThanOrEqual(l.levelPanel.y + l.levelPanel.height + 0.5);
    }
  });

  it('clears both beams with the whole band', () => {
    const l = hangarLayout(VIEWPORT, { rowCount: SAMPLE.length });
    expect(l.bay.y).toBeGreaterThanOrEqual(l.header.y + l.header.height);
    expect(l.list.y + l.list.height).toBeLessThanOrEqual(l.footer.y + 0.5);
    for (const row of l.rows) expect(row.y + row.height).toBeLessThanOrEqual(l.footer.y + 0.5);
  });

  it('keeps BACK at the thumb floor on a phone — the way out is always tappable', () => {
    const l = hangarLayout(PHONE, { isTouch: true });
    expect(l.back.height).toBeGreaterThanOrEqual(Math.min(TOUCH_MIN, l.footer.height));
    expect(l.back.width).toBeGreaterThan(TOUCH_MIN);
  });

  it('insets by the safe area — a notch is not somewhere the hangar draws', () => {
    const insets = { top: 0, bottom: 0, left: 44, right: 44 };
    const l = hangarLayout(PHONE, { isTouch: true, insets, rowCount: SAMPLE.length });
    expect(l.bay.x).toBeGreaterThanOrEqual(insets.left);
    expect(l.list.x + l.list.width).toBeLessThanOrEqual(PHONE.width - insets.right + 0.5);
    expect(l.back.x + l.back.width).toBeLessThanOrEqual(PHONE.width - insets.right + 0.5);
  });

  it('lands a tap on BACK and on the row under it', () => {
    const l = hangarLayout(VIEWPORT, { rowCount: SAMPLE.length });
    expect(hangarHitTest(l, center(l.back).x, center(l.back).y)).toEqual({ kind: 'back' });
    l.rows.forEach((row, i) => {
      expect(hangarHitTest(l, center(row).x, center(row).y)).toEqual({ kind: 'cosmetic', index: i });
    });
  });

  it('is null off every control — the bay and the bar are readouts', () => {
    const l = hangarLayout(VIEWPORT, { rowCount: SAMPLE.length });
    expect(hangarHitTest(l, center(l.bay).x, center(l.bay).y)).toBeNull();
    expect(hangarHitTest(l, center(l.xpBar).x, center(l.xpBar).y)).toBeNull();
    expect(hangarHitTest(l, center(l.title).x, center(l.title).y)).toBeNull();
    expect(hangarHitTest(l, -5, -5)).toBeNull();
  });

  it('never hits a control squeezed to nothing (invisible ⇒ untappable)', () => {
    const l = hangarLayout({ width: 4, height: 4 }, { rowCount: SAMPLE.length });
    expect(hangarHitTest(l, center(l.back).x, center(l.back).y)).toBeNull();
    for (const row of l.rows) expect(hangarHitTest(l, center(row).x, center(row).y)).toBeNull();
  });

  it('drops rows that do not fit rather than drawing them over the footer', () => {
    const l = hangarLayout(PHONE, { isTouch: true, rowCount: 40 });
    expect(l.rows.length).toBeLessThan(40);
    for (const row of l.rows) expect(row.y + row.height).toBeLessThanOrEqual(l.list.y + l.list.height + 0.5);
  });
});

describe('pointer bookkeeping', () => {
  it('resolves rest / hover / press, with a press outranking a hover', () => {
    const state = { profile: profileAtLevel(5), shipClass: ShipClass.Vanguard, cosmetics: SAMPLE };
    expect(hangarModel(state).rows.every((r) => r.state === 'rest')).toBe(true);
    expect(hangarModel(state).backState).toBe('rest');

    const hovered = hangarModel(state, { hover: { kind: 'cosmetic', index: 1 } });
    expect(hovered.rows.map((r) => r.state)).toEqual(['rest', 'hover', 'rest']);

    const pressed = hangarModel(state, {
      hover: { kind: 'cosmetic', index: 1 },
      press: { kind: 'cosmetic', index: 1 },
    });
    expect(pressed.rows[1]?.state).toBe('press');
    expect(hangarModel(state, { hover: { kind: 'back' } }).backState).toBe('hover');
  });

  it('compares targets structurally and keys them stably', () => {
    expect(sameHangarTarget({ kind: 'back' }, { kind: 'back' })).toBe(true);
    expect(sameHangarTarget({ kind: 'cosmetic', index: 2 }, { kind: 'cosmetic', index: 2 })).toBe(true);
    expect(sameHangarTarget({ kind: 'cosmetic', index: 2 }, { kind: 'cosmetic', index: 3 })).toBe(false);
    expect(sameHangarTarget(null, null)).toBe(true);
    expect(sameHangarTarget(null, { kind: 'back' })).toBe(false);

    expect(hangarTargetKey({ kind: 'back' })).toBe('back');
    expect(hangarTargetKey({ kind: 'cosmetic', index: 3 })).toBe('cosmetic:3');
    expect(hangarTargetKey(null)).toBeNull();
  });
});
