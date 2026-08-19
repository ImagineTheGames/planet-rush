/**
 * src/ui/pause-menu.test.ts — the pause menu's contract, pinned. OWNER: UI Engineer.
 *
 * Three things the developer ratification (p10) turns on, asserted headless:
 *
 *  1. **Pause semantics are the transport's.** The offline/online distinction is a
 *     single `pausable` flag routed through {@link shouldFreezeSim}. The
 *     networked-`false` path — overlay up, sim still running — is built and tested
 *     NOW, before the networked transport that supplies it exists (developer §2).
 *  2. **EXIT is never one tap.** The state machine puts a "Leave the match?"
 *     confirm between the menu and leaving, and STAY is the emphasised default, so
 *     one stray tap cannot kill a match (developer §1).
 *  3. **Back-one-level is one gesture.** ESC / the corner button `toggle` opens
 *     and then steps back a level at a time, never skipping straight out.
 *
 * …and, since u7-05, a fourth: **the overlay is Gantry/Bone, and the safe action
 * is its ONE bright plate.** Under Bone the emphasis IS the brightness, so
 * developer §1's "STAY is the emphasised default" is now a statement about plate
 * roles — which makes it something a test can hold rather than a look someone has
 * to notice slipping.
 */
import { describe, it, expect } from 'vitest';
import { resolveAnchor } from '@platform/layout-registry';
import type { Rect, Viewport } from '@platform/layout-registry';
import { BEAM, PLATE_SCALES, TOUCH_MIN } from '../art/materials';
import { countPrimaries, singlePrimary } from './gantry';
import {
  PAUSE_BUTTON_ANCHOR,
  PAUSE_BUTTON_ID,
  PAUSE_BUTTON_SIZE,
  PAUSE_ID,
  isLayeredOverPause,
  isPauseOpen,
  nextPauseScreen,
  pauseAllowsDownloadLog,
  pauseButtonRect,
  pauseButtonVisible,
  pauseButtons,
  pauseHitTest,
  pauseLayout,
  pauseMenuModel,
  shouldFreezeSim,
} from './pause-menu';
import type { PauseScreen } from './pause-menu';
import { settingsLayout } from './settings';
import { DownloadLogAffordance } from '../net/playtest-log-button';
import type { DownloadLogDom } from '../net/playtest-log-button';

const SCREENS: readonly PauseScreen[] = ['closed', 'menu', 'settings', 'confirm'];

describe('shouldFreezeSim — the transport owns pause (developer §2)', () => {
  it('OFFLINE (pausable): the sim freezes whenever an overlay is up', () => {
    expect(shouldFreezeSim('menu', true)).toBe(true);
    expect(shouldFreezeSim('settings', true)).toBe(true);
    expect(shouldFreezeSim('confirm', true)).toBe(true);
  });

  it('OFFLINE (pausable): a closed overlay never freezes the sim', () => {
    expect(shouldFreezeSim('closed', true)).toBe(false);
  });

  it('NETWORKED (not pausable): the overlay can be up over a RUNNING sim — the flag path built before the transport exists', () => {
    // The whole networked-false branch: an eight-way match cannot stop for one
    // player, so no pause screen ever freezes the sim.
    for (const screen of SCREENS) {
      expect(shouldFreezeSim(screen, false)).toBe(false);
    }
  });

  it('freeze is exactly (overlay up AND pausable) — nothing else', () => {
    for (const screen of SCREENS) {
      for (const pausable of [true, false]) {
        expect(shouldFreezeSim(screen, pausable)).toBe(isPauseOpen(screen) && pausable);
      }
    }
  });
});

/**
 * The rule again, but in the units the ratification states it in: **ticks**.
 *
 * `shouldFreezeSim` is a predicate; what the developer asked to be tested is what a
 * frame loop *does* with it over time — "online pause tick continuity, offline
 * pause tick freeze". So this walks the gate the loop actually writes
 * (`src/main.ts`: `if (shouldFreezeSim(pauseScreen, pausable)) return;` before
 * `match.tick(...)`, `simTicks++`) across a pause and out the other side, and counts.
 *
 * It cannot catch a mis-wiring in main.ts — only the live-stage pair can, and does
 * (`tests/live-stage/pause-tick-audit.spec.ts`,
 * `tests/live-stage-online/online-pause.spec.ts`). What it does is state the
 * contract in the ratification's own vocabulary, next to the predicate, so a future
 * change to the predicate is read against "how many ticks passed" rather than
 * against a truth table.
 */
describe('tick continuity across a pause (ratified M10 §2)', () => {
  /** One frame of the loop's sim gate, `frames` times: a tick, unless frozen. */
  function ticksOver(frames: number, screen: PauseScreen, pausable: boolean): number {
    let ticks = 0;
    for (let f = 0; f < frames; f++) if (!shouldFreezeSim(screen, pausable)) ticks++;
    return ticks;
  }

  it('OFFLINE: not one tick passes while any pause screen is up', () => {
    for (const screen of SCREENS.filter(isPauseOpen)) {
      expect(ticksOver(60, screen, true), `${screen} let the offline sim run`).toBe(0);
    }
  });

  it('ONLINE: every frame still ticks, on every pause screen — one player cannot stop eight', () => {
    for (const screen of SCREENS) {
      expect(ticksOver(60, screen, false), `${screen} froze a networked sim`).toBe(60);
    }
  });

  it('OFFLINE: RESUME picks up exactly where it left off — no tick is skipped, none is caught up', () => {
    // 30 frames running, 120 frames paused, 30 frames running. The paused frames
    // are *time that did not happen* to the sim: the count is 60, not 180, and not
    // 61 (a catch-up tick would be a jump the player did not fly).
    let ticks = 0;
    let screen: PauseScreen = 'closed';
    for (let f = 0; f < 180; f++) {
      if (f === 30) screen = 'menu';
      if (f === 150) screen = 'closed';
      if (!shouldFreezeSim(screen, true)) ticks++;
    }
    expect(ticks).toBe(60);
  });

  it('ONLINE: the same 180 frames are 180 ticks — the pause was a screen, not a stop', () => {
    let ticks = 0;
    let screen: PauseScreen = 'closed';
    for (let f = 0; f < 180; f++) {
      if (f === 30) screen = 'menu';
      if (f === 150) screen = 'closed';
      if (!shouldFreezeSim(screen, false)) ticks++;
    }
    expect(ticks).toBe(180);
  });
});

describe('nextPauseScreen — the state machine', () => {
  it('toggle opens from closed and steps back one level from each open screen', () => {
    expect(nextPauseScreen('closed', 'toggle')).toBe('menu');
    expect(nextPauseScreen('menu', 'toggle')).toBe('closed');
    expect(nextPauseScreen('settings', 'toggle')).toBe('menu');
    expect(nextPauseScreen('confirm', 'toggle')).toBe('menu');
  });

  it('resume closes from anywhere', () => {
    for (const screen of SCREENS) expect(nextPauseScreen(screen, 'resume')).toBe('closed');
  });

  it('SETTINGS round-trips: menu → settings → menu', () => {
    const toSettings = nextPauseScreen('menu', 'openSettings');
    expect(toSettings).toBe('settings');
    expect(nextPauseScreen(toSettings, 'closeSettings')).toBe('menu');
  });

  it('EXIT is two steps: menu → confirm → (leave handled by wiring); STAY backs out', () => {
    const toConfirm = nextPauseScreen('menu', 'requestExit');
    expect(toConfirm).toBe('confirm');
    expect(nextPauseScreen(toConfirm, 'cancelExit')).toBe('menu');
  });

  it('is total — an action that does not apply to a screen is a no-op', () => {
    // requestExit only from the menu; openSettings only from the menu; etc.
    expect(nextPauseScreen('closed', 'openSettings')).toBe('closed');
    expect(nextPauseScreen('settings', 'requestExit')).toBe('settings');
    expect(nextPauseScreen('confirm', 'openSettings')).toBe('confirm');
    expect(nextPauseScreen('closed', 'cancelExit')).toBe('closed');
    // Doubled presses never wedge it.
    expect(nextPauseScreen(nextPauseScreen('menu', 'requestExit'), 'requestExit')).toBe('confirm');
  });

  it('there is no direct menu → leave: you cannot exit without passing through confirm', () => {
    // The safety property, stated directly: no single action from `menu` yields a
    // "leaving" state; the only route to leaving runs through `confirm`.
    const from = nextPauseScreen('menu', 'requestExit');
    expect(from).toBe('confirm'); // the mandatory intermediate screen
  });
});

describe('pauseMenuModel + buttons', () => {
  it('the menu offers RESUME / SETTINGS / EXIT TO MENU, RESUME first and primary', () => {
    const model = pauseMenuModel('menu');
    expect(model.headline).toBe('PAUSED');
    expect(model.buttons.map((b) => b.id)).toEqual(['resume', 'settings', 'exit']);
    expect(model.buttons[0]!.primary).toBe(true); // RESUME is the safe default
    expect(model.buttons.find((b) => b.id === 'exit')!.primary).toBe(false);
  });

  it('the confirm asks the question and makes STAY the emphasised default (developer §1)', () => {
    const model = pauseMenuModel('confirm');
    expect(model.headline).toBe('LEAVE THE MATCH?');
    expect(model.buttons.map((b) => b.id)).toEqual(['leave', 'stay']);
    const stay = model.buttons.find((b) => b.id === 'stay')!;
    const leave = model.buttons.find((b) => b.id === 'leave')!;
    expect(stay.primary).toBe(true); // the eye lands on staying
    expect(leave.primary).toBe(false);
  });

  it('closed and settings draw no pause buttons of their own', () => {
    expect(pauseButtons('closed')).toEqual([]);
    expect(pauseButtons('settings')).toEqual([]);
    expect(pauseMenuModel('closed').buttons).toEqual([]);
    expect(pauseMenuModel('settings').buttons).toEqual([]);
  });
});

describe('pauseLayout + pauseHitTest', () => {
  const viewport: Viewport = { width: 1000, height: 600 };

  it('places one rect per button, in order, all inside the content box', () => {
    const ids = pauseButtons('menu');
    const layout = pauseLayout(viewport, ids);
    expect(layout.buttons).toHaveLength(3);
    for (const r of layout.buttons) {
      expect(r.x).toBeGreaterThanOrEqual(layout.content.x);
      expect(r.x + r.width).toBeLessThanOrEqual(layout.content.x + layout.content.width + 0.001);
    }
  });

  it('routes a tap on a button rect to that button, and misses to null', () => {
    const ids = pauseButtons('menu');
    const layout = pauseLayout(viewport, ids);
    const exitRect = layout.buttons[2]!;
    const cx = exitRect.x + exitRect.width / 2;
    const cy = exitRect.y + exitRect.height / 2;
    expect(pauseHitTest(layout, cx, cy, ids)).toEqual({ kind: 'exit' });
    // A tap up in the header beam hits nothing — the beam names the screen, it is
    // not a control.
    expect(pauseHitTest(layout, layout.content.x + 1, layout.content.y + 1, ids)).toBeNull();
  });

  it('the confirm layout maps its two rects to leave/stay in order', () => {
    const ids = pauseButtons('confirm');
    const layout = pauseLayout(viewport, ids);
    const leave = layout.buttons[0]!;
    const stay = layout.buttons[1]!;
    expect(pauseHitTest(layout, leave.x + 1, leave.y + 1, ids)).toEqual({ kind: 'leave' });
    expect(pauseHitTest(layout, stay.x + 1, stay.y + 1, ids)).toEqual({ kind: 'stay' });
  });

  it('keeps the plates clear of both beams', () => {
    const ids = pauseButtons('menu');
    const layout = pauseLayout(viewport, ids);
    const first = layout.buttons[0]!;
    const last = layout.buttons[layout.buttons.length - 1]!;
    expect(first.y).toBeGreaterThanOrEqual(layout.header.y + layout.header.height);
    expect(last.y + last.height).toBeLessThanOrEqual(layout.footer.y + 0.001);
  });
});

// ---------------------------------------------------------------------------
// GANTRY / BONE (u7-05) — the material, and what it may not do
// ---------------------------------------------------------------------------
//
// The re-skin's two hard rules, and the phone. Every number below is derived in
// `../art/materials`; what is asserted here is that this SCREEN consumes them —
// a screen can pick a legal plate role and still put two bright ones on itself.

describe('the Gantry/Bone pause overlay', () => {
  it('draws exactly ONE bright plate, on both of its screens', () => {
    for (const screen of ['menu', 'confirm'] as const) {
      const roles = pauseMenuModel(screen).buttons.map((b) => b.role);
      expect(singlePrimary(roles), `${screen} drew two bright plates`).toBe(true);
      expect(countPrimaries(roles), `${screen} drew no bright plate`).toBe(1);
    }
  });

  it('puts that one bright plate on the SAFE action — RESUME, and STAY', () => {
    // The safety property developer §1 asked for, restated in the material: under
    // Bone the emphasis IS the brightness, so "STAY is the emphasised default"
    // means "STAY is the screen's only primary plate" and nothing else.
    const menu = pauseMenuModel('menu').buttons;
    expect(menu.find((b) => b.role === 'primary')!.id).toBe('resume');
    const confirm = pauseMenuModel('confirm').buttons;
    expect(confirm.find((b) => b.role === 'primary')!.id).toBe('stay');
    expect(confirm.find((b) => b.id === 'leave')!.role).toBe('secondary');
  });

  it('marks the primary by SIZE as well — brightness is only half of it', () => {
    const menu = pauseMenuModel('menu').buttons;
    expect(menu.find((b) => b.id === 'resume')!.scale).toBe('hero');
    expect(menu.find((b) => b.id === 'exit')!.scale).toBe('standard');
    const layout = pauseLayout({ width: 1280, height: 720 }, pauseButtons('menu'));
    expect(layout.buttons[0]!.height).toBeGreaterThan(layout.buttons[1]!.height);
  });

  it('never draws a plate in the disabled costume — every button is actionable', () => {
    for (const screen of ['menu', 'confirm'] as const) {
      for (const b of pauseMenuModel(screen).buttons) expect(b.role).not.toBe('inert');
    }
  });

  it('carries the handoff\'s own numbers on the desktop it was drawn at', () => {
    const layout = pauseLayout({ width: 1280, height: 720 }, pauseButtons('menu'));
    expect(layout.metrics.margin).toBe(BEAM.margin); // 44
    expect(layout.header.height).toBe(BEAM.height); // 92
    expect(layout.buttons[0]!.height).toBe(PLATE_SCALES.hero.height); // 80
    expect(layout.buttons[1]!.height).toBe(PLATE_SCALES.standard.height); // 72
  });

  it('takes a press to rest → press, and a hover to rest → hover', () => {
    const pressed = pauseMenuModel('menu', { hover: 'exit', press: 'exit' });
    // A finger that is down is not hovering: press outranks hover on one plate.
    expect(pressed.buttons.find((b) => b.id === 'exit')!.state).toBe('press');
    expect(pressed.buttons.find((b) => b.id === 'resume')!.state).toBe('rest');
    const hovered = pauseMenuModel('menu', { hover: 'settings' });
    expect(hovered.buttons.find((b) => b.id === 'settings')!.state).toBe('hover');
  });

  describe('on a phone, reached mid-play', () => {
    // Planet Rush is landscape-locked, so a phone held either way hands the
    // overlay a WIDE, SHORT logical viewport. Both are checked: the overlay is
    // opened mid-match, and a match is played held whichever way the player holds it.
    for (const [name, vp] of [
      ['iPhone, 844×390 logical', { width: 844, height: 390 }],
      ['Pixel, 915×412 logical', { width: 915, height: 412 }],
    ] as const) {
      it(`${name}: every plate clears the 48px thumb floor`, () => {
        for (const screen of ['menu', 'confirm'] as const) {
          const layout = pauseLayout(vp, pauseButtons(screen), { isTouch: true });
          for (const r of layout.buttons) {
            expect(r.height, `${screen} on ${name}`).toBeGreaterThanOrEqual(TOUCH_MIN);
          }
        }
      });

      it(`${name}: the stack still fits between the beams`, () => {
        const layout = pauseLayout(vp, pauseButtons('menu'), { isTouch: true });
        const last = layout.buttons[2]!;
        expect(last.y + last.height).toBeLessThanOrEqual(layout.footer.y + 0.001);
        // …and the size hierarchy survives the squeeze, so the primary is still
        // the biggest plate rather than three equal bars.
        expect(layout.buttons[0]!.height).toBeGreaterThan(last.height);
      });
    }

    it('the corner affordance is a thumb target, not a 40px chip', () => {
      // The one control on this screen that was under the floor. It is the
      // touch-only way IN, so it is the one a phone player must be able to hit.
      expect(PAUSE_BUTTON_SIZE).toBe(TOUCH_MIN);
      const rect = pauseButtonRect({ width: 844, height: 390 });
      expect(Math.min(rect.width, rect.height)).toBeGreaterThanOrEqual(TOUCH_MIN);
    });
  });

  it('never lets a beam claim a screen it cannot frame', () => {
    // A comically small viewport yields zero-extent rects, never backwards ones —
    // and a zero-extent rect is untappable, which is the rule every layout here keeps.
    for (const vp of [{ width: 4, height: 4 }, { width: 0, height: 0 }]) {
      const layout = pauseLayout(vp, pauseButtons('menu'));
      for (const r of [layout.header, layout.footer, layout.content, layout.title, ...layout.buttons]) {
        expect(r.width).toBeGreaterThanOrEqual(0);
        expect(r.height).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// a0-97 — what may be on the glass over a pause screen
// ---------------------------------------------------------------------------
//
// The DOWNLOAD LOG affordance (`src/net/playtest-log-button`) is DOM pinned to the
// bottom-right corner at the largest z-index the platform has, and `src/main.ts`
// `syncDownloadLog` offered it for ANY open pause screen. On the pause menu that
// corner is free — the footer beam "carries no control" and the plates stack down
// the centre — so the rule read as harmless. It is not free on the settings screen,
// which puts DONE in exactly it, and the offer never withdrew when SETTINGS layered
// itself over pause.
//
// a0-96 measured what that costs, and this lane reproduced it on the built bundle
// before changing anything (`evidence/a0-97-nothing-covers-done`): at the point the
// client itself reports drawing DONE, `document.elementFromPoint` returned
// `BUTTON#playtest-download-log-button` — not the canvas — on BOTH viewports, one
// press downloaded a log, and the seam read `settings` before it and after it. A
// desktop still had Escape; a phone had nothing.

/**
 * The corner the DOM affordance claims, in the same logical space the layouts are
 * computed in. Its own CSS pins it `right:max(12px,…);bottom:max(12px,…)` with a
 * `min-width`/`min-height` of 44 (the mobile touch minimum), so this 44×44 square is
 * the SMALLEST box it can occupy — the real one is wider. Measured on the built
 * bundle at both profiles below it came back 189×44 at exactly this inset
 * (phone 597,328 of 798×384; desktop 1079,744 of 1280×800), so the square is a
 * conservative statement of where it lands, not a guess at it.
 */
function downloadLogCorner(viewport: Viewport): Rect {
  const inset = 12;
  const side = 44;
  return { x: viewport.width - inset - side, y: viewport.height - inset - side, width: side, height: side };
}

/** Do two rects share any area? */
function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** The two viewports a0-96's finding was taken on: the developer's own phone
 *  screenshot size, and the golden suite's control desktop width. */
const A097_VIEWPORTS = [
  ['phone 798×384 (touch)', { width: 798, height: 384 }, true],
  ['desktop 1280×800 (pointer)', { width: 1280, height: 800 }, false],
] as const;

/** A DOM the affordance can mount into with no browser: it only ever writes an id,
 *  `innerHTML` and `hidden`, and asks for one element back by id. */
function fakeLogDom(): { created: { hidden: boolean }[]; dom: DownloadLogDom } {
  const created: { id: string; innerHTML: string; hidden: boolean; addEventListener(): void; appendChild(): void; remove(): void }[] = [];
  const dom = {
    createElement() {
      const el = {
        id: '',
        innerHTML: '',
        hidden: false,
        addEventListener(): void {},
        appendChild(): void {},
        remove(): void {},
      };
      created.push(el);
      return el;
    },
    getElementById() {
      return null;
    },
    body: { appendChild(): void {} },
  };
  return { created, dom };
}

describe('the corner DOWNLOAD LOG offer, over the pause stack (a0-97)', () => {
  it('nothing is drawn over the settings screen DONE plate', () => {
    // 1. The collision is real, and it is geometric rather than incidental: DONE is
    //    right-aligned in the footer beam (`./settings` `settingsLayout` → `back`),
    //    which is the corner the affordance pins itself into — on every viewport,
    //    so there is no width at which "it happens to fit" is the answer.
    for (const [name, viewport, isTouch] of A097_VIEWPORTS) {
      const done = settingsLayout(viewport, { isTouch }).back;
      expect(overlaps(done, downloadLogCorner(viewport)), `DONE vs the log corner on ${name}`).toBe(true);
    }

    // 2. …so with the settings screen layered over pause, the offer is not showing.
    //    Driven through the REAL affordance, by the rule `src/main.ts`
    //    `syncDownloadLog` applies once per rendered frame — `visible` is the offer
    //    it is making, `hidden` is the element on the glass.
    const { created, dom } = fakeLogDom();
    const affordance = new DownloadLogAffordance({ dom, schedule: null });
    const frame = (screen: PauseScreen): void => {
      if (pauseAllowsDownloadLog(screen)) affordance.show({ reason: 'pause' });
      else affordance.hide();
    };

    frame('menu'); // the screen the rule was written for: the offer stands
    expect(affordance.visible).toBe(true);

    frame('settings');
    expect(affordance.visible, 'the offer withdraws while the settings screen is up').toBe(false);
    expect(
      created.every((el) => el.hidden),
      'and the element it mounted is off the glass, not merely inert',
    ).toBe(true);
  });

  it('withdraws for EVERY screen layered over pause — the sibling, not just the one that was photographed', () => {
    // The whole stack reachable from the pause menu is `settings` and `confirm`.
    // The confirm's own plates are in the band and its footer carries no control, so
    // it has no collision today — and it loses the offer anyway, because a rule that
    // only knows about the screen that was photographed is how this bug survives.
    expect(isLayeredOverPause('settings')).toBe(true);
    expect(isLayeredOverPause('confirm')).toBe(true);
    expect(pauseAllowsDownloadLog('settings')).toBe(false);
    expect(pauseAllowsDownloadLog('confirm')).toBe(false);
  });

  it('leaves the menu and the match exactly as they were', () => {
    // The pause menu keeps the log (brief §2), and a closed overlay is not the
    // gate's business — during play the error branch in `syncDownloadLog` is the
    // only thing that may offer it, and this predicate must not veto that.
    expect(isLayeredOverPause('menu')).toBe(false);
    expect(isLayeredOverPause('closed')).toBe(false);
    expect(pauseAllowsDownloadLog('menu')).toBe(true);
    expect(pauseAllowsDownloadLog('closed')).toBe(true);
  });

  it('changes nothing about which screens are OPEN — the freeze still sees all four', () => {
    // `isLayeredOverPause` is a second, narrower question, not a redefinition of the
    // first: settings and confirm are still open screens, so the sim still freezes
    // under them offline and a tap still lands on the overlay.
    for (const screen of ['menu', 'settings', 'confirm'] as const) {
      expect(isPauseOpen(screen)).toBe(true);
      expect(shouldFreezeSim(screen, true)).toBe(true);
    }
  });
});

describe('the touch pause affordance', () => {
  it('is shown on touch only while the match owns the screen', () => {
    expect(pauseButtonVisible({ isTouch: true, available: true })).toBe(true);
    expect(pauseButtonVisible({ isTouch: true, available: false })).toBe(false);
    expect(pauseButtonVisible({ isTouch: false, available: true })).toBe(false);
    expect(pauseButtonVisible({ isTouch: false, available: false })).toBe(false);
  });

  it('sits in the top band, clear of the top-left ore total', () => {
    const rect = pauseButtonRect({ width: 900, height: 420 });
    // Inset from the LEFT past the ore readout, hard against the top.
    expect(rect.x).toBeGreaterThan(16);
    expect(rect.y).toBe(16);
    expect(rect.width).toBe(PAUSE_BUTTON_SIZE);
    expect(rect.height).toBe(PAUSE_BUTTON_SIZE);
  });

  it('declares stable ids and registry-accepted anchors', () => {
    expect(PAUSE_ID).toBe('pause-menu');
    expect(PAUSE_BUTTON_ID).toBe('pause-button');
    const zone = resolveAnchor(PAUSE_BUTTON_ANCHOR, { width: 844, height: 390 });
    expect(zone).toEqual({ x: 0, y: 0, width: 844, height: 390 });
  });
});
