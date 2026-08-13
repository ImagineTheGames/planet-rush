/**
 * src/ui/main-menu.test.ts — the main-menu model, headless.
 *
 * The screen decides two things: what its buttons say, and where a tap lands.
 * Both are pure functions of a viewport, so the whole of the front door is
 * asserted here with no Pixi and no canvas — the same discipline as the rest of
 * `src/ui/`. The *wiring* (a clean boot opens this, PLAY builds the world) is the
 * live-stage suite's job (`tests/live-stage/main-menu.spec.ts`), because the M2
 * lesson is that a menu can be model-green and still never reached.
 */

import { describe, it, expect } from 'vitest';
import {
  MAIN_MENU_EYEBROW,
  MAIN_MENU_ITEMS,
  MAIN_MENU_STATUS,
  MAIN_MENU_TITLE,
  codexSubLine,
  mainMenuHitTest,
  mainMenuLayout,
  mainMenuModel,
  mainMenuRoute,
  mainMenuStep,
  mainMenuIndexOf,
} from './main-menu';
import type { Rect } from '@platform/layout-registry';
import type { MainMenuOption } from './main-menu';
import { CODEX_TABS } from './codex';
import { NAV_EDGES, NAV_SCREENS, reachesMainMenuWithoutMatch } from './menu-nav';
import type { NavScreen } from './menu-nav';
import * as flow from './lobby-flow';
import { FLOW_SCREENS, createFlow, flowKey, flowOpenHangar, flowScreenHandler, flowTapHangar } from './lobby-flow';
import { singlePrimary } from './gantry';
import { BEAM, COLUMN, PLATE_SCALES, TOUCH_MIN, frameMetrics } from '../art/materials';

const VIEWPORT = { width: 1280, height: 720 };
/** The phone the field report was on: 390×844 held portrait → the landscape lock
 *  rotates the root, so every menu lays out in an 844×390 LOGICAL viewport. */
const PHONE = { width: 844, height: 390 };
const center = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

describe('the model', () => {
  it('shows the wordmark and exactly PLAY, CODEX, SETTINGS then HANGAR', () => {
    const model = mainMenuModel();
    expect(model.title).toBe(MAIN_MENU_TITLE);
    expect(model.buttons.map((b) => b.label)).toEqual(['PLAY', 'CODEX', 'SETTINGS', 'HANGAR']);
  });

  it('leaves the first three items and their ORDER untouched by the fourth door', () => {
    // a0-14, in as many words: "The main menu's existing three items, their
    // order, and the codex sub-line" must not change. HANGAR is appended, so the
    // three plates a player already knows are in the places they were.
    const first = MAIN_MENU_ITEMS.slice(0, 3);
    expect(first.map((i) => i.kind)).toEqual(['play', 'codex', 'settings']);
    expect(first.map((i) => i.label)).toEqual(['PLAY', 'CODEX', 'SETTINGS']);
    expect(first[0]?.sub).toBe('Open a rig and take the field');
    expect(first[1]?.sub).toBe(codexSubLine());
    expect(first[2]?.sub).toBe('Controls, audio, visual effects');
  });

  it('carries the header beam\'s eyebrow cluster, verbatim from the handoff', () => {
    const model = mainMenuModel();
    expect(model.eyebrow).toBe(MAIN_MENU_EYEBROW);
    expect(model.status).toBe(MAIN_MENU_STATUS);
  });

  it('gives every plate a sub-line, and derives CODEX\'s from the codex\'s own tabs', () => {
    // The handoff has no CODEX plate, so rather than invent a line of voice the
    // sub-line names the screen's tabs. Pinned to CODEX_TABS so a new section
    // (a0-34's OBJECTIVE was the fifth) cannot leave the menu describing four.
    for (const button of mainMenuModel().buttons) expect(button.sub.length).toBeGreaterThan(0);
    const codex = mainMenuModel().buttons.find((b) => b.label === 'CODEX');
    expect(codex?.sub).toBe(codexSubLine());
    for (const tab of CODEX_TABS) {
      expect(codexSubLine().toUpperCase()).toContain(tab.label);
    }
  });

  it('offers ONE way into a match — no second front door beside PLAY', () => {
    // The ratified single play flow: PLAY opens the doors screen (SOLO /
    // HOST / JOIN), which already carries offline play, so the separate
    // ONLINE button — and the offline-lobby shortcut PLAY used to be — are gone.
    // Asserted as an absence, because a redundant door is exactly the kind of thing
    // that gets quietly re-added.
    const kinds = MAIN_MENU_ITEMS.map((i) => i.kind);
    expect(kinds.filter((k) => k === 'play')).toHaveLength(1);
    expect(kinds).not.toContain('online');
  });

  it('marks PLAY as the primary action and CODEX/SETTINGS/HANGAR as secondary', () => {
    const [play, codex, settings, hangar] = mainMenuModel().buttons;
    expect(hangar?.primary).toBe(false);
    expect(play?.primary).toBe(true);
    // CODEX and SETTINGS are doors that come back — secondary, but fully active
    // (never gray): the gray-means-disabled theme rule (GDD §2.10 point 4). PLAY is
    // the single primary because it is the only way into a match.
    expect(codex?.primary).toBe(false);
    expect(settings?.primary).toBe(false);
  });

  it('draws EXACTLY ONE bright plate — the constraint Bone carries with it', () => {
    // "The primary relies on brightness and size rather than hue, so it must never
    // share a screen with a second bright plate" (handoff). This is not a taste
    // call: brightness is the only mechanism the direction has for saying "this is
    // the action", and a second primary destroys it outright.
    const roles = mainMenuModel().buttons.map((b) => b.role);
    expect(roles.filter((r) => r === 'primary')).toHaveLength(1);
    expect(singlePrimary(roles)).toBe(true);
  });

  it('marks the primary by SIZE as well as brightness', () => {
    // The other half of the same sentence. PLAY is a `hero` plate and the rest are
    // `standard`, so the screen still reads correctly with the material stripped.
    const [play, codex, settings] = mainMenuModel().buttons;
    expect(play?.scale).toBe('hero');
    expect(codex?.scale).toBe('standard');
    expect(settings?.scale).toBe('standard');
    expect(PLATE_SCALES.hero.height).toBeGreaterThan(PLATE_SCALES.standard.height);
  });

  it('resolves rest / hover / press, with a press outranking a hover', () => {
    const rest = mainMenuModel();
    expect(rest.buttons.every((b) => b.state === 'rest')).toBe(true);

    const hovered = mainMenuModel({ hover: 'codex' });
    expect(hovered.buttons.map((b) => b.state)).toEqual(['rest', 'hover', 'rest', 'rest']);

    // A finger that is down is not hovering — the same plate cannot be both.
    const pressed = mainMenuModel({ hover: 'play', press: 'play' });
    expect(pressed.buttons[0]?.state).toBe('press');
  });

  it('keeps the item list, the model and the hit test in the same order', () => {
    // The four walk one list — a re-order can never mis-route a tap.
    expect(MAIN_MENU_ITEMS.map((i) => i.kind)).toEqual(['play', 'codex', 'settings', 'hangar']);
  });
});

// ---------------------------------------------------------------------------
// THE WIRING CONTRACT (a0-14)
// ---------------------------------------------------------------------------
//
// Two lists must now agree — the menu's items and the flow's screens — and
// LESSONS §20 is exactly the shape of what happens when they quietly do not: a
// `FlowScreen` case with no handler, or a menu item with no route, fails
// silently and renders an empty room that looks like a working room reporting
// bad news.
//
// So the agreement is asserted rather than reviewed. Both `mainMenuRoute` and
// `flowScreenHandler` are exhaustive switches with a `default` that returns
// null: the compiler catches a case deleted *from the union*, and these tests
// catch a case deleted *from the switch* — which is the failure the compiler
// cannot see. Delete `case 'hangar'` from either one and this block goes red.
describe('the wiring contract: every screen handled, every item routed', () => {
  it('routes EVERY main-menu item to a screen the navigation graph declares', () => {
    for (const item of MAIN_MENU_ITEMS) {
      const route = mainMenuRoute(item.kind);
      expect(route, `${item.label} routes nowhere`).not.toBeNull();
      expect(NAV_SCREENS, `${item.label} routes to an undeclared screen`).toContain(route);
    }
  });

  it('gives every routed screen an edge FROM the main menu — the door is real', () => {
    // A route is a claim about the wiring; the graph is where that claim is
    // checked. An item that routed to a screen with no edge from `main-menu`
    // would be a button that opens a room nobody can prove is connected.
    for (const item of MAIN_MENU_ITEMS) {
      const route = mainMenuRoute(item.kind);
      const edge = NAV_EDGES.find((e) => e.from === 'main-menu' && e.to === route);
      expect(edge, `no main-menu → ${String(route)} edge for ${item.label}`).toBeTruthy();
    }
  });

  it('gives every routed screen a way BACK to the menu without starting a match', () => {
    // The other half of the same bug: a door that opens onto a room with no
    // exit. HANGAR included, which is why it is asserted here and not only in
    // `menu-nav.test.ts` — this is the test that walks the MENU's own list.
    for (const item of MAIN_MENU_ITEMS) {
      const route = mainMenuRoute(item.kind) as NavScreen;
      expect(reachesMainMenuWithoutMatch(route), `${item.label} → ${route} is a trap`).toBe(true);
    }
  });

  it('names HANGAR explicitly — the fourth door is routed, not merely present', () => {
    // The regression this whole block exists for. `MAIN_MENU_ITEMS` gaining an
    // entry is easy; the entry going somewhere is the part that gets forgotten.
    expect(MAIN_MENU_ITEMS.map((i) => i.kind)).toContain('hangar');
    expect(mainMenuRoute('hangar')).toBe('hangar');
    expect(NAV_SCREENS).toContain('hangar');
  });

  it('resolves EVERY FlowScreen to a handler this module actually exports', () => {
    // The string could be a lie, so it is resolved against the module's real
    // exports rather than eyeballed.
    for (const screen of FLOW_SCREENS) {
      const handler = flowScreenHandler(screen);
      expect(handler, `the ${screen} screen has no handler`).not.toBeNull();
      expect(typeof (flow as Record<string, unknown>)[handler as string], `${handler} is not exported`).toBe(
        'function',
      );
    }
  });

  it('lists every FlowScreen exactly once, and routes the hangar among them', () => {
    expect(new Set(FLOW_SCREENS).size).toBe(FLOW_SCREENS.length);
    expect(FLOW_SCREENS).toContain('hangar');
    expect(flowScreenHandler('hangar')).toBe('flowTapHangar');
  });

  it('reaches HANGAR by KEYBOARD — every door is on the focus ring', () => {
    // The menu used to answer exactly one key (Enter, which was PLAY), so a
    // keyboard player could reach the first plate and nothing else. a0-14 asks
    // for the fourth door to be reachable by keyboard as well as by tap, so the
    // focus ring is the menu's own list and this proves it lands on all four.
    const walk: MainMenuOption[] = [];
    let at: MainMenuOption = 'play';
    for (let i = 0; i < MAIN_MENU_ITEMS.length; i++) {
      at = mainMenuStep(mainMenuIndexOf(at), 1);
      walk.push(at);
    }
    expect(walk).toEqual(['codex', 'settings', 'hangar', 'play']); // and it wraps
    expect(walk).toContain('hangar');

    // Backwards too — HANGAR is one step UP from PLAY, which is the fastest way
    // to the newest door and the reason the ring wraps at all.
    expect(mainMenuStep(mainMenuIndexOf('play'), -1)).toBe('hangar');
  });

  it('starts the focus ring on PLAY, so Enter alone still means PLAY', () => {
    // The compatibility clause: every keyboard path that existed before a0-14
    // behaves identically. Index 0 is PLAY and a zero step never moves.
    expect(MAIN_MENU_ITEMS[0]?.kind).toBe('play');
    expect(mainMenuIndexOf('play')).toBe(0);
    expect(mainMenuStep(0, 0)).toBe('play');
  });

  it('folds a junk focus index rather than stepping off the list', () => {
    for (const index of [Number.NaN, -99, 999, 2.5]) {
      expect(MAIN_MENU_ITEMS.map((i) => i.kind)).toContain(mainMenuStep(index, 1));
    }
    expect(mainMenuIndexOf('hangar')).toBe(MAIN_MENU_ITEMS.length - 1);
  });

  it('opens and leaves the hangar through the flow, by tap and by key', () => {
    // The contract end to end: the menu's fourth item routes to `hangar`, the
    // flow can *be* on that screen, and BACK / Escape both come home. A screen
    // you can enter and not leave is the trap `menu-nav` forbids.
    const open = flowOpenHangar(createFlow()).state;
    expect(open.screen).toBe('hangar');

    expect(flowTapHangar(open, { kind: 'back' }).state.screen).toBe('entry');
    expect(flowKey(open, 'Escape').state.screen).toBe('entry');
    expect(flowKey(open, 'Backspace').state.screen).toBe('entry');
  });

  it('refuses to open the hangar from anywhere but the front door', () => {
    const inMatch = { ...createFlow(), screen: 'match' as const };
    expect(flowOpenHangar(inMatch).state).toBe(inMatch);
  });
});

describe('layout', () => {
  it('places the beams and one rect per button, inside the viewport', () => {
    const layout = mainMenuLayout(VIEWPORT);
    expect(layout.buttons).toHaveLength(MAIN_MENU_ITEMS.length);
    for (const rect of [layout.title, layout.header, layout.footer, ...layout.buttons]) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(VIEWPORT.width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(VIEWPORT.height);
    }
  });

  it('draws the RATIFIED desktop numbers at the handoff\'s own reference', () => {
    // The derivation must reproduce its own sample, or it is a redesign rather
    // than a derivation: 44px margins, 92px beams, an 800px column, and the
    // handoff's 80 / 72 plate heights.
    const layout = mainMenuLayout(VIEWPORT);
    expect(layout.metrics.margin).toBe(BEAM.margin);
    expect(layout.metrics.beam).toBe(BEAM.height);
    expect(layout.header.height).toBe(BEAM.height);
    expect(layout.footer.height).toBe(BEAM.height);
    expect(layout.buttons[0]?.width).toBe(COLUMN.title);
    expect(layout.buttons[0]?.height).toBe(PLATE_SCALES.hero.height);
    expect(layout.buttons[1]?.height).toBe(PLATE_SCALES.standard.height);
  });

  it('caps the plate column instead of stretching it across a wide desktop', () => {
    const layout = mainMenuLayout({ width: 1920, height: 1080 });
    for (const rect of layout.buttons) {
      expect(rect.width).toBeLessThanOrEqual(COLUMN.title);
    }
  });

  it('puts the wordmark in the header beam and the plates in the band below it', () => {
    const layout = mainMenuLayout(VIEWPORT);
    expect(layout.title.y).toBe(layout.header.y);
    expect(layout.title.height).toBe(layout.header.height);
    // The eyebrow cluster shares the beam, hard left of the wordmark's centre.
    expect(layout.eyebrow.x).toBeLessThan(layout.title.x + layout.title.width / 2);
    // Every plate clears both beams.
    for (const rect of layout.buttons) {
      expect(rect.y).toBeGreaterThanOrEqual(layout.header.y + layout.header.height);
      expect(rect.y + rect.height).toBeLessThanOrEqual(layout.footer.y);
    }
    expect(layout.buttons[1]!.y).toBeGreaterThan(layout.buttons[0]!.y);
  });

  it('insets the content by the safe area — beams included', () => {
    const insets = { top: 40, bottom: 20, left: 30, right: 30 };
    const layout = mainMenuLayout(VIEWPORT, { insets });
    // The content box starts past the inset + the page margin, never at 0.
    expect(layout.content.x).toBeGreaterThanOrEqual(insets.left);
    expect(layout.content.y).toBeGreaterThanOrEqual(insets.top);
    // A beam is structure and runs to the screen's edge — but never under a notch.
    expect(layout.header.x).toBe(insets.left);
    expect(layout.header.y).toBe(insets.top);
    expect(layout.header.x + layout.header.width).toBe(VIEWPORT.width - insets.right);
    expect(layout.footer.y + layout.footer.height).toBe(VIEWPORT.height - insets.bottom);
  });

  it('yields zero-extent buttons on a comically small viewport rather than a backwards rect', () => {
    const layout = mainMenuLayout({ width: 4, height: 4 });
    for (const rect of layout.buttons) {
      expect(rect.width).toBeGreaterThanOrEqual(0);
      expect(rect.height).toBeGreaterThanOrEqual(0);
    }
  });
});

// The handoff is desktop-authored — no `@media`, no viewport meta, and the words
// mobile / touch / phone / portrait appear nowhere in it. Its 44px margins and
// 92px beams are ONE sample of the look. These are the derived counterparts, and
// what they have to keep is: every plate stays thumb-sized, the size hierarchy
// that marks PLAY survives, and nothing runs off an edge.
describe('the same screen on a portrait-held phone (844×390 logical)', () => {
  it('keeps every plate at or above the thumb floor', () => {
    const layout = mainMenuLayout(PHONE, { isTouch: true });
    for (const rect of layout.buttons) {
      expect(rect.height).toBeGreaterThanOrEqual(TOUCH_MIN);
      expect(rect.width).toBeGreaterThanOrEqual(TOUCH_MIN);
    }
  });

  it('keeps PLAY the tallest plate — the size half of the primary\'s read', () => {
    const [play, codex, settings] = mainMenuLayout(PHONE, { isTouch: true }).buttons;
    expect(play!.height).toBeGreaterThan(codex!.height);
    expect(codex!.height).toBe(settings!.height);
  });

  it('shrinks the frame proportionally rather than keeping the desktop numbers', () => {
    const m = frameMetrics(PHONE.width, PHONE.height);
    expect(m.margin).toBeLessThan(BEAM.margin);
    expect(m.beam).toBeLessThan(BEAM.height);
    // Two beams may never claim more than 40% of a short viewport before a single
    // plate is drawn — at the literal 92px they would take 47% of 390.
    expect(m.beam * 2).toBeLessThanOrEqual(PHONE.height * 0.4);
  });

  it('fits the whole stack between the beams, inside the safe area', () => {
    const insets = { top: 0, bottom: 0, left: 44, right: 44 }; // a notch, held sideways
    const layout = mainMenuLayout(PHONE, { isTouch: true, insets });
    for (const rect of layout.buttons) {
      expect(rect.y).toBeGreaterThanOrEqual(layout.header.y + layout.header.height - 0.5);
      expect(rect.y + rect.height).toBeLessThanOrEqual(layout.footer.y + 0.5);
      expect(rect.x).toBeGreaterThanOrEqual(insets.left);
      expect(rect.x + rect.width).toBeLessThanOrEqual(PHONE.width - insets.right + 0.5);
    }
  });
});

describe('hit test', () => {
  it('lands a tap on the button under it', () => {
    const layout = mainMenuLayout(VIEWPORT);
    expect(mainMenuHitTest(layout, center(layout.buttons[0]!).x, center(layout.buttons[0]!).y)).toBe('play');
    expect(mainMenuHitTest(layout, center(layout.buttons[1]!).x, center(layout.buttons[1]!).y)).toBe(
      'codex',
    );
    expect(mainMenuHitTest(layout, center(layout.buttons[2]!).x, center(layout.buttons[2]!).y)).toBe(
      'settings',
    );
  });

  it('lands a tap on the button under it, on a phone too', () => {
    const layout = mainMenuLayout(PHONE, { isTouch: true });
    expect(mainMenuHitTest(layout, center(layout.buttons[0]!).x, center(layout.buttons[0]!).y)).toBe('play');
    expect(mainMenuHitTest(layout, center(layout.buttons[2]!).x, center(layout.buttons[2]!).y)).toBe(
      'settings',
    );
  });

  it('is null off every button', () => {
    const layout = mainMenuLayout(VIEWPORT);
    // The header beam is chrome, not a control — the wordmark is not a button.
    expect(mainMenuHitTest(layout, center(layout.title).x, center(layout.title).y)).toBeNull();
    // Nor is the footer beam, which only carries the build stamp.
    expect(mainMenuHitTest(layout, center(layout.footer).x, center(layout.footer).y)).toBeNull();
    // Off-screen entirely.
    expect(mainMenuHitTest(layout, -5, -5)).toBeNull();
  });

  it('never hits a button squeezed to nothing (invisible ⇒ untappable)', () => {
    const layout = mainMenuLayout({ width: 4, height: 4 });
    for (const rect of layout.buttons) {
      expect(mainMenuHitTest(layout, center(rect).x, center(rect).y)).toBeNull();
    }
  });
});
