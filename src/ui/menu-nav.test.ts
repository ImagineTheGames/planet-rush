/**
 * The navigation graph test (u2 menu-back, brief item 4): from every screen, some
 * input path leads back to the main menu without starting a match — and no screen
 * is a dead end. This is the executable form of the audit: "every screen you can
 * enter, you can leave."
 */

import { describe, expect, it } from 'vitest';
import {
  NAV_EDGES,
  NAV_ROOT,
  NAV_SCREENS,
  reachesMainMenuWithoutMatch,
  screenExits,
  type NavScreen,
} from './menu-nav';

describe('the navigation graph is well-formed', () => {
  it('lists each screen exactly once', () => {
    expect(new Set(NAV_SCREENS).size).toBe(NAV_SCREENS.length);
  });

  it('only ever points at screens it declares', () => {
    const known = new Set<NavScreen>(NAV_SCREENS);
    for (const edge of NAV_EDGES) {
      expect(known.has(edge.from), `edge.from ${edge.from} (${edge.via})`).toBe(true);
      expect(known.has(edge.to), `edge.to ${edge.to} (${edge.via})`).toBe(true);
    }
  });
});

describe('every screen you can enter, you can leave', () => {
  // The core of the brief: no matter where the player is, a path home exists that
  // never has to launch a match to escape.
  for (const screen of NAV_SCREENS) {
    it(`reaches the main menu from ${screen} without starting a match`, () => {
      expect(reachesMainMenuWithoutMatch(screen)).toBe(true);
    });
  }

  // A stronger, local statement of the same rule: every non-root screen offers at
  // least one exit that is not "start a match" — so no screen is a trap whose only
  // way out is RUSH / REMATCH.
  for (const screen of NAV_SCREENS.filter((s) => s !== NAV_ROOT)) {
    it(`offers a non-match exit from ${screen}`, () => {
      expect(screenExits(screen).length).toBeGreaterThan(0);
    });
  }

  it('gives the root itself no non-match exit to chase — it IS the destination', () => {
    // main-menu forward edges all *start* something (open a screen / a match); it
    // never needs to "leave" to reach itself.
    expect(reachesMainMenuWithoutMatch(NAV_ROOT)).toBe(true);
  });
});

describe('Escape works on pointer for the menu screens (u2 item 2)', () => {
  // The pre-match menu screens each answer Escape with the same exit their BACK /
  // DONE button takes — the desktop twin of the tap affordance.
  const escapable: readonly NavScreen[] = ['online', 'online-keypad', 'settings', 'codex', 'lobby'];
  for (const screen of escapable) {
    it(`${screen} has an Escape-answerable exit`, () => {
      const hasEscapeExit = NAV_EDGES.some((e) => e.from === screen && e.escape && !e.startsMatch);
      expect(hasEscapeExit, `${screen} needs an Escape exit`).toBe(true);
    });
  }
});

describe('a match is never the only way out', () => {
  it('forbids counting a RUSH / REMATCH edge as an exit', () => {
    // The lobby's only forward-into-play edge is RUSH (a match start); its exit is
    // BACK. Prove the proof actually refuses the match-start edge by checking the
    // lobby still reaches the menu with RUSH present, and that RUSH is flagged.
    const rush = NAV_EDGES.find((e) => e.from === 'lobby' && e.to === 'match');
    expect(rush?.startsMatch).toBe(true);
    expect(screenExits('lobby').some((e) => e.to === 'match')).toBe(false);
    expect(reachesMainMenuWithoutMatch('lobby')).toBe(true);
  });

  it('lets an eliminated player reach the menu only via SPECTATE → pause, not REMATCH', () => {
    // end-eliminated has no direct menu edge; its non-match exit is SPECTATE back
    // to the live match, whose pause overlay carries EXIT TO MENU.
    const exits = screenExits('end-eliminated');
    expect(exits.every((e) => e.to !== 'main-menu')).toBe(true);
    expect(exits.some((e) => e.via === 'SPECTATE')).toBe(true);
    expect(reachesMainMenuWithoutMatch('end-eliminated')).toBe(true);
  });
});
