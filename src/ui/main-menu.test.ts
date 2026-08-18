/**
 * src/ui/main-menu.test.ts — the main-menu model, headless.
 *
 * The screen decides two things: what its buttons say, and where a tap lands.
 * Both are pure functions of a viewport, so all but the last block below is
 * asserted with no Pixi and no canvas — the same discipline as the rest of
 * `src/ui/`. The *wiring* (a clean boot opens this, PLAY builds the world) is the
 * live-stage suite's job (`tests/live-stage/main-menu.spec.ts`), because the M2
 * lesson is that a menu can be model-green and still never reached.
 *
 * The exception is `the entrance` (a0-70), which drives a REAL `MainMenuView`
 * headless: its claim is about what the view puts on the screen on its first
 * frame, and a pure layout function cannot be asked that question. The Pixi
 * scene graph is headless right up to measuring a `Text`, so the file carries the
 * same 2D-canvas stub `build-wheel-view.test.ts` does.
 */

import { describe, it, expect } from 'vitest';
import { DOMAdapter, Text } from 'pixi.js';
import { computeRootTransform } from '@platform/orientation';
import { MainMenuView } from './main-menu-view';
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
import { TitleGate, browserGateDom, gateCovers } from './title-gate';
import type { GatePhase } from './title-gate';
import { NAV_EDGES, NAV_SCREENS, reachesMainMenuWithoutMatch } from './menu-nav';
import type { NavScreen } from './menu-nav';
import * as flow from './lobby-flow';
import { FLOW_SCREENS, createFlow, flowKey, flowOpenHangar, flowScreenHandler, flowTapHangar } from './lobby-flow';
import { singlePrimary } from './gantry';
import { BEAM, COLUMN, PLATE_SCALES, TOUCH_MIN, frameMetrics } from '../art/materials';

// A `Text` measures itself against a 2D canvas, which a node test does not have.
// The stub is the whole of the workaround — the same one `build-wheel-view.test.ts`
// uses for the same reason — and it is not a mock of anything under test: nothing
// below reads a text *size*, only the positions the view wrote.
const stubTextContext = {
  font: '',
  measureText(text: string) {
    return {
      width: text.length * 7,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: text.length * 7,
    };
  },
};
const stubCanvas = { width: 1, height: 1, getContext: () => stubTextContext };
DOMAdapter.set({
  ...DOMAdapter.get(),
  createCanvas: () => stubCanvas as unknown as HTMLCanvasElement,
} as never);

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

// ---------------------------------------------------------------------------
// The entrance (a0-70)
// ---------------------------------------------------------------------------
//
// Reported: *"the title menu flies in from the bottom right instead of starting
// off centered"*. It was filmed before anything was changed — the real
// production bundle, the developer's own 1707×898 desktop session, at 1× and at
// the 1.5× ratio that viewport implies, gated and `?gate=0`, on the preview
// server and on the dev server, plus the door's whole opening sequence and a
// boot across a mid-flight viewport change. The menu is centred and
// byte-identical on every frame of all of them, the door's centre never leaves
// the viewport's, and the page runs no `transform` transition at all. The
// capture, the numbers and the frames are in
// `evidence/a0-70-title-entrance/audit.txt`.
//
// **So this test passes on today's code, and it is a regression guard rather
// than a reproduction.** It is written down anyway because the property it pins
// is the one the report is about and nothing held it before: the menu is where
// it belongs on the FIRST frame it draws, not on the second. It is deliberately
// built so the three mechanisms that could have produced the report each fail
// it — see the three assertions below.
describe('the entrance', () => {
  it('the first frame is already centred', () => {
    // The developer's own session, so the numbers here are the numbers filmed.
    const view = { width: 1707, height: 898 };

    // 1. THE ROOT TRANSFORM. A desktop must take the identity branch. The rotated
    //    branch answers `x: physW`, which puts every child one whole screen width
    //    to the right — a bottom-right offset is that bug's exact fingerprint, and
    //    it is a bug on its own if a desktop ever reaches it (`isMobile` is a
    //    touch-capability probe, and a touchscreen laptop sets it).
    const root = computeRootTransform(view.width, view.height, false);
    expect(root).toEqual({
      rotated: false,
      logicalWidth: view.width,
      logicalHeight: view.height,
      rotation: 0,
      x: 0,
      y: 0,
    });

    // 2. THE LAYOUT. Everything the screen draws is centred on the viewport the
    //    root transform just reported — the wordmark's strip and every plate.
    const layout = mainMenuLayout({ width: root.logicalWidth, height: root.logicalHeight });
    const midX = root.logicalWidth / 2;
    expect(layout.title.x + layout.title.width / 2).toBeCloseTo(midX, 6);
    for (const rect of layout.buttons) {
      expect(rect.x + rect.width / 2).toBeCloseTo(midX, 6);
    }

    // 3. THE FIRST FRAME ITSELF. A real `MainMenuView`, updated exactly ONCE and
    //    never resized — which is frame 1 of the boot, since `openMainMenu`
    //    constructs the view from the live logical size and renders straight
    //    away. Read back what the view actually wrote to its nodes.
    const first = new MainMenuView(view.width, view.height);
    first.update(mainMenuModel());
    const firstNodes = nodePositions(first);

    // The wordmark, at the centre of the strip the layout gave it — an absolute
    // claim about a drawn node, not about the layout function agreeing with
    // itself. Anchored 0.5/0.5, so its `x` IS its centre.
    expect(firstNodes.wordmark.text).toBe(MAIN_MENU_TITLE);
    expect(firstNodes.wordmark.x).toBeCloseTo(midX, 6);

    // Every plate's label starts inside the plate the layout put there. A screen
    // that had drifted toward a corner would have its text outside its own rect.
    expect(firstNodes.plateLabels).toHaveLength(MAIN_MENU_ITEMS.length);
    firstNodes.plateLabels.forEach((label, i) => {
      const rect = layout.buttons[i]!;
      expect(label.x).toBeGreaterThan(rect.x);
      expect(label.x).toBeLessThan(rect.x + rect.width);
      expect(label.y).toBeGreaterThanOrEqual(rect.y);
      expect(label.y).toBeLessThanOrEqual(rect.y + rect.height);
    });

    // 4. AND IT IS NOT MERELY A LATER FRAME THAT SETTLES. The same view driven
    //    through a resize and several more updates — every chance the shipped code
    //    has to correct itself — must land on the positions frame 1 already had.
    //    A menu that started off-centre and snapped into place would pass
    //    everything above only if the snap happened before the first `update`;
    //    this is what closes that door.
    const settled = new MainMenuView(view.width, view.height);
    settled.update(mainMenuModel());
    settled.update(mainMenuModel({ hover: 'play' }));
    settled.resize(view.width, view.height);
    settled.update(mainMenuModel());
    expect(nodePositions(settled)).toEqual(firstNodes);
  });
});

/** What a `MainMenuView` actually put on the screen, read off its own nodes.
 *  The view adds `backdrop, beams, heading, eyebrow, status` and then a
 *  `body, label, sub` triple per plate, so the `Text` children arrive in a known
 *  order — the same order `MAIN_MENU_ITEMS` is walked in. */
function nodePositions(view: MainMenuView): {
  wordmark: { text: string; x: number; y: number };
  plateLabels: { text: string; x: number; y: number }[];
} {
  const texts = view.children.filter((c): c is Text => c instanceof Text);
  const [wordmark, , , ...rest] = texts;
  const plateLabels: { text: string; x: number; y: number }[] = [];
  // label, sub, label, sub … — the labels are the even ones.
  for (let i = 0; i < rest.length; i += 2) {
    const label = rest[i]!;
    plateLabels.push({ text: label.text, x: label.x, y: label.y });
  }
  return {
    wordmark: { text: wordmark!.text, x: wordmark!.x, y: wordmark!.y },
    plateLabels,
  };
}

// ---------------------------------------------------------------------------
// THE FLOOR — a0-78
// ---------------------------------------------------------------------------

/**
 * A CSS declaration block with the one behaviour this whole bug turns on:
 * assigning `cssText` **replaces the entire block**, so any property written
 * before it and not replayed after it is gone (CSSOM: `cssText` re-parses into a
 * fresh declaration list). Everything else here is the minimum a
 * {@link browserGateDom} needs to run.
 */
class FakeStyle {
  private props = new Map<string, string>();
  get cssText(): string {
    return [...this.props].map(([k, v]) => `${k}:${v}`).join(';');
  }
  set cssText(text: string) {
    this.props = new Map();
    for (const decl of text.split(';')) {
      const i = decl.indexOf(':');
      if (i > 0) this.props.set(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
    }
  }
  setProperty(name: string, value: string): void {
    this.props.set(name, value);
  }
  getPropertyValue(name: string): string {
    return this.props.get(name) ?? '';
  }
  get opacity(): string { return this.props.get('opacity') ?? ''; }
  set opacity(v: string) { this.props.set('opacity', v); }
  get visibility(): string { return this.props.get('visibility') ?? ''; }
  set visibility(v: string) { this.props.set('visibility', v); }
  get pointerEvents(): string { return this.props.get('pointer-events') ?? ''; }
  set pointerEvents(v: string) { this.props.set('pointer-events', v); }
}

/** A recording 2D context — the sky canvas, so the test can ask what was
 *  painted rather than look at it. */
class RecordingContext {
  fillStyle: unknown = '';
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  fills = 0;
  setTransform(): void {}
  fillRect(): void { this.fills++; }
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  arc(): void {}
  fill(): void { this.fills++; }
  save(): void {}
  restore(): void {}
  createRadialGradient() { return { addColorStop(): void {} }; }
}

/** One element, with just enough of an `Element` for the gate's DOM edge. */
class FakeElement {
  id = '';
  innerHTML = '';
  width = 0;
  height = 0;
  readonly style = new FakeStyle();
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, ((e: unknown) => void)[]>();
  removed = false;
  private readonly ctx = new RecordingContext();
  appendChild(child: FakeElement): void { this.children.push(child); }
  remove(): void { this.removed = true; }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
  }
  dispatch(type: string, e: unknown = {}): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(e);
  }
  getContext(): RecordingContext { return this.ctx; }
  recorder(): RecordingContext { return this.ctx; }
  querySelector(selector: string): FakeElement | null {
    const id = selector.replace('#', '');
    const found = this.parts.get(id);
    return found ?? null;
  }
  /** The three ids `browserGateDom` looks up inside the overlay's markup. The
   *  gate writes real HTML into `innerHTML`, which this stub does not parse, so
   *  the pieces are stood up here instead. */
  readonly parts = new Map<string, FakeElement>();
}

/** The whole browser, as much of it as the gate touches. */
function fakeBrowser(width: number, height: number) {
  const host = new FakeElement();
  const win = new FakeElement();
  const timers: { handle: number; cb: () => void }[] = [];
  let frameCb: ((ms: number) => void) | null = null;
  let next = 1;
  const created: FakeElement[] = [];
  const browser = {
    document: {
      createElement(): FakeElement {
        const el = new FakeElement();
        for (const id of ['pr-title-gate-sky', 'pr-title-gate-door', 'pr-title-gate-leaf']) {
          el.parts.set(id, new FakeElement());
        }
        created.push(el);
        return el;
      },
    },
    window: {
      innerWidth: width,
      innerHeight: height,
      devicePixelRatio: 1,
      addEventListener: (t: string, fn: (e: unknown) => void) => win.addEventListener(t, fn),
      removeEventListener: (t: string, fn: (e: unknown) => void) => win.removeEventListener(t, fn),
      // `transform:none` everywhere: the gate then falls back to the phase's own
      // target scale, and a leaf that reports nothing counts as home.
      getComputedStyle: () => ({ transform: 'none' }),
      requestAnimationFrame: (cb: (ms: number) => void) => { frameCb = cb; return next++; },
      cancelAnimationFrame: () => { frameCb = null; },
      setTimeout: (cb: () => void) => { const h = next++; timers.push({ handle: h, cb }); return h; },
      clearTimeout: (h: number) => {
        const i = timers.findIndex((t) => t.handle === h);
        if (i >= 0) timers.splice(i, 1);
      },
    },
    mount: host,
    isTouch: true,
  };
  return {
    browser,
    win,
    host,
    root: () => created[0]!,
    sky: () => created[0]!.parts.get('pr-title-gate-sky')!,
    /** Fire every scheduled step, the way a clock that is not being watched does. */
    runTimers(): void {
      for (let i = 0; i < 20 && timers.length > 0; i++) {
        const due = timers.splice(0, timers.length);
        for (const t of due) t.cb();
      }
    },
    /** Drive one animation frame. */
    frame(ms: number): void {
      const cb = frameCb;
      frameCb = null;
      cb?.(ms);
    },
  };
}

/** Are the three properties that take the door out of the way all saying so?
 *  All three, because the overlay is a full-screen fixed element on top of the
 *  Pixi canvas: two out of three still eats every tap the menu is waiting for. */
function menuIsReachable(root: FakeElement): boolean {
  return (
    root.style.opacity === '0' &&
    root.style.visibility === 'hidden' &&
    root.style.pointerEvents === 'none'
  );
}

describe('the front screen', () => {
  /**
   * **a0-78 — a swipe on the main menu removed it permanently.**
   *
   * Reported from a phone: *"I also managed to swipe on main menu and made it
   * disappear and never reappear"*. Filmed in
   * `evidence/a0-78-menu-swipe/audit.txt` at 390×844 and 844×390: after a window
   * resize — which is what a swipe does to a phone browser, whose URL bar
   * collapses under it — the title gate's overlay came back over the menu,
   * opaque and taking every tap, with no phase left that would ever remove it.
   *
   * The invariant, and it is deliberately about the MENU rather than about any
   * particular way of stranding the door: **there is no sequence of gestures
   * after which the front screen has no menu and no way back.** So this drives
   * the real gate over the real DOM edge, throws the whole gesture matrix at it
   * — including a `pointerdown` the browser steals with `pointercancel` and
   * never completes with a `pointerup` — and asks, after each one, whether a
   * finger could still reach the screen underneath.
   *
   * It fails three ways on the code before the fix: `applyLayout`'s `cssText`
   * write drops the hidden state, `resize` repaints the starfield with no
   * doorway punched out of it, and nothing re-asserts either.
   */
  it('no gesture can leave the front screen without a menu', () => {
    const W = 844;
    const H = 390;
    const env = fakeBrowser(W, H);
    const gate = new TitleGate({ dom: browserGateDom(env.browser as never) });
    gate.mount();
    const root = env.root();

    // Sealed: the door IS the front screen, and it is supposed to be in the way.
    expect(gate.current).toBe('locked');
    expect(menuIsReachable(root)).toBe(false);

    // Open it with a real press on the overlay, and run the four beats out.
    root.dispatch('pointerdown');
    env.runTimers();
    expect(gate.current).toBe('open');
    expect(menuIsReachable(root)).toBe(true);

    // Nothing may paint from here: the punch is what makes the doorway a hole,
    // and a field painted once we are through has no doorway in it at all.
    const paintsWhenThrough = env.sky().recorder().fills;

    // --- The gesture matrix ------------------------------------------------
    // Each entry is a whole gesture, in the events a browser actually delivers.
    // The third is the one the brief names: a press the browser claims for
    // itself part-way through, which delivers a `pointercancel` and NO
    // `pointerup`, so anything that only finishes on one never finishes.
    const gestures: { name: string; run: () => void }[] = [
      {
        name: 'a tap that completes',
        run: () => {
          root.dispatch('pointerdown');
          root.dispatch('pointerup');
        },
      },
      {
        name: 'a swipe across the screen',
        run: () => {
          root.dispatch('pointerdown');
          for (let i = 0; i < 8; i++) root.dispatch('pointermove');
          root.dispatch('pointerup');
        },
      },
      {
        name: 'a press the browser steals — pointercancel, no pointerup',
        run: () => {
          root.dispatch('pointerdown');
          for (let i = 0; i < 8; i++) root.dispatch('pointermove');
          root.dispatch('pointercancel');
        },
      },
      {
        name: 'an edge swipe the browser steals before it even moves',
        run: () => {
          root.dispatch('pointerdown');
          root.dispatch('pointercancel');
        },
      },
      {
        name: 'a swipe that collapses the URL bar (window resize)',
        run: () => {
          env.browser.window.innerHeight = H - 60;
          env.win.dispatch('resize');
        },
      },
      {
        name: 'and one that brings it back',
        run: () => {
          env.browser.window.innerHeight = H;
          env.win.dispatch('resize');
        },
      },
      {
        name: 'the handset turned while the menu is up',
        run: () => {
          env.browser.window.innerWidth = H;
          env.browser.window.innerHeight = W;
          env.win.dispatch('resize');
        },
      },
    ];

    for (const gesture of gestures) {
      gesture.run();
      env.runTimers();
      env.frame(16);
      // 1. The door has not come back over the menu.
      expect(menuIsReachable(root), `after ${gesture.name}: the menu is reachable`).toBe(true);
      // 2. Nor has the starfield been repainted over it. A paint here can only
      //    be an unpunched one — see `TitleGate.paint`.
      expect(env.sky().recorder().fills, `after ${gesture.name}: nothing painted over the menu`)
        .toBe(paintsWhenThrough);
      // 3. And the machine is where it should be, not stranded mid-transition.
      expect(gate.current, `after ${gesture.name}: still through the door`).toBe('open');
    }

    // --- The menu is INTERACTIVE, not merely uncovered ----------------------
    // With the overlay taking no pointers, a tap at a plate's own centre lands
    // on that plate — the whole of what "the menu is still there" means to a
    // player who has just swiped.
    const layout = mainMenuLayout({ width: H, height: W }, { isTouch: true });
    for (let i = 0; i < MAIN_MENU_ITEMS.length; i++) {
      const rect = layout.buttons[i]!;
      const hit = mainMenuHitTest(layout, rect.x + rect.width / 2, rect.y + rect.height / 2);
      expect(hit).toBe(MAIN_MENU_ITEMS[i]!.kind);
    }

    // --- …and there is still a way back -------------------------------------
    // The door can be resealed and re-opened after everything above, so the
    // gestures cost the screen nothing at all.
    gate.reseal();
    env.runTimers();
    for (let i = 0; i < 400 && gate.current !== 'locked'; i++) env.frame(16 * i);
    expect(gate.current).toBe('locked');
    expect(menuIsReachable(root)).toBe(false);
    root.dispatch('pointerdown');
    env.runTimers();
    expect(gate.current).toBe('open');
    expect(menuIsReachable(root)).toBe(true);
  });

  /**
   * The same invariant stated as a property of the machine rather than of one
   * run: the overlay is in front of the menu in every phase but `open`, and out
   * of the way in that one. It is what `TitleGate.apply` re-asserts on every
   * phase change AND every resize, which is what makes a stranded phase
   * self-heal instead of needing each way of stranding it to be enumerated.
   */
  it('the door is only ever out of the way in exactly one phase', () => {
    const phases: GatePhase[] = [
      'locked', 'turning', 'parting', 'entering', 'open', 'returning', 'closing',
    ];
    expect(phases.filter((p) => !gateCovers(p))).toEqual(['open']);
  });
});
