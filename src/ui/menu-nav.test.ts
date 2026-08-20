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
import { DOOR_OPTIONS } from './lobby-entry';

/** A door's label, read from the one file that authors it. */
const doorLabel = (door: 'solo' | 'create' | 'join'): string =>
  DOOR_OPTIONS.find((d) => d.door === door)!.label;

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
  const escapable: readonly NavScreen[] = [
    'online',
    'online-keypad',
    'settings',
    'codex',
    'lobby',
    'lobby-online',
  ];
  for (const screen of escapable) {
    it(`${screen} has an Escape-answerable exit`, () => {
      const hasEscapeExit = NAV_EDGES.some((e) => e.from === screen && e.escape && !e.startsMatch);
      expect(hasEscapeExit, `${screen} needs an Escape exit`).toBe(true);
    });
  }
});

describe('ONE play flow: PLAY opens the doors, and every door lands in the lobby', () => {
  // The ratified shape (developer): "PLAY → goes to the same online menu (which
  // already has offline play)… right now PLAY going to a separate offline lobby is
  // just redundant." So the graph must have exactly one edge off the main menu that
  // leads toward a match, it must land on the doors, and there must be no second
  // front door beside it.
  it('gives the main menu exactly one match-ward door, and it is PLAY → the doors', () => {
    const fromMenu = NAV_EDGES.filter((e) => e.from === 'main-menu');
    const matchward = fromMenu.filter((e) => e.to === 'online' || e.to === 'lobby' || e.to === 'lobby-online');
    expect(matchward.map((e) => e.via)).toEqual(['PLAY']);
    expect(matchward[0]?.to).toBe('online');
  });

  it('no longer routes PLAY straight into a lobby, skipping the doors', () => {
    // The removed redundancy, asserted as an absence: nothing on the main menu may
    // reach a lobby without passing through the one screen that offers all three
    // ways in.
    expect(NAV_EDGES.some((e) => e.from === 'main-menu' && e.to === 'lobby')).toBe(false);
    expect(NAV_EDGES.some((e) => e.from === 'main-menu' && e.to === 'lobby-online')).toBe(false);
  });

  it('adds no edge for the CAMPAIGN teaser — it answers in place (u9-01)', () => {
    // The doors screen grew a fourth button that navigates NOWHERE. That has to be
    // an asserted absence rather than an oversight: an edge here would claim a
    // screen exists, and the reachability proof would then demand an exit from a
    // screen nobody can be on.
    expect(NAV_EDGES.some((e) => /CAMPAIGN/i.test(e.via))).toBe(false);
    expect(NAV_SCREENS.some((s) => /campaign/i.test(s))).toBe(false);
    // …and the doors screen still leaves for the menu without starting a match.
    expect(screenExits('online').some((e) => e.to === 'main-menu')).toBe(true);
    expect(reachesMainMenuWithoutMatch('online')).toBe(true);
  });

  it('reaches the offline lobby from the solo door and the online one from open / join', () => {
    // Asserted against DOOR_OPTIONS, not against the words: this graph is
    // hand-authored and its `via` labels are a second, untested copy of the door
    // names (copy-sweep trap 3). Reading the constant means a door rename either
    // updates both or fails here — it can no longer half-land and leave the map
    // describing buttons that do not exist.
    const doors = NAV_EDGES.filter((e) => e.from === 'online' || e.from === 'online-keypad');
    expect(doors.some((e) => e.via === doorLabel('solo') && e.to === 'lobby')).toBe(true);
    expect(doors.some((e) => e.via === doorLabel('create') && e.to === 'lobby-online')).toBe(true);
    expect(doors.some((e) => e.via === doorLabel('join') && e.to === 'online-keypad')).toBe(true);
    expect(doors.some((e) => e.from === 'online-keypad' && e.to === 'lobby-online')).toBe(true);
  });

  it('gives the ONLINE lobby a BACK that leaves without starting a match (no ghost rooms)', () => {
    // u2 item 4: BACK out of a room must free it. The graph's half of that promise
    // is that the exit exists, is not a match-start, and lands on the menu; the
    // socket close itself is asserted in `lobby-flow.test.ts` (the `close-transport`
    // effect) and in the live-stage run.
    const exits = screenExits('lobby-online');
    expect(exits.some((e) => e.via === 'BACK' && e.to === 'main-menu')).toBe(true);
    expect(exits.every((e) => e.to !== 'match')).toBe(true);
    expect(reachesMainMenuWithoutMatch('lobby-online')).toBe(true);
  });
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

// ---------------------------------------------------------------------------
// a0-100c — the one screen with a ruling attached to how many ways in it has
// ---------------------------------------------------------------------------

describe('SETTINGS has exactly two ways in (a0-100c)', () => {
  /** Every node that IS a settings screen. There are two, because settings is
   *  reached in two contexts — before a match and inside one — and the pause
   *  flavour is a distinct node only because it must not leave the match. */
  const SETTINGS_SCREENS: readonly NavScreen[] = ['settings', 'pause-settings'];

  it('settings opens from the main menu and the pause menu, and nowhere else', () => {
    // The developer's ruling, 2026-08-19, from the doors screen:
    //
    //   "there should not be a settings button on this page, the settings page
    //    was literally in the main menu one page up... it should be there and
    //    pause menu only..."
    //
    // Driven from the GRAPH, so it is the map that is on trial and not a screen
    // this file happens to remember. It fails the moment a third route is
    // recorded — and the route it was written against was real: until a0-100c
    // the doors screen carried a SETTINGS plate that reached `openSettings()`
    // through `main.ts` `applyEntryTarget`, which is what this suite could not
    // see, because NAV_EDGES had never been told about it.
    const openedFrom = NAV_EDGES.filter((e) => SETTINGS_SCREENS.includes(e.to)).map((e) => e.from);

    expect([...new Set(openedFrom)].sort()).toEqual(['main-menu', 'pause']);
    // …and each of the two is exactly ONE edge, so "two ways in" cannot be met
    // by two different controls on the same screen both opening it.
    expect(openedFrom.length).toBe(2);
  });

  it('names the control on each of those two edges SETTINGS', () => {
    // The ruling is about a button with a word on it, so the graph has to carry
    // the word — a route recorded under some other affordance would satisfy the
    // count above while describing a different screen.
    for (const edge of NAV_EDGES.filter((e) => SETTINGS_SCREENS.includes(e.to))) {
      expect(edge.via, `${edge.from} -> ${edge.to}`).toBe('SETTINGS');
    }
  });

  it('gives the doors screen no settings route at all — BACK is its footer', () => {
    // The specific deletion. The doors keep their way out, and it reaches the
    // main menu where settings lives one press away: the developer's own
    // argument for why the button was redundant.
    const fromDoors = NAV_EDGES.filter((e) => e.from === 'online');
    expect(fromDoors.every((e) => !SETTINGS_SCREENS.includes(e.to))).toBe(true);
    expect(fromDoors.some((e) => e.via === 'BACK' && e.to === 'main-menu')).toBe(true);
  });

  it('lets both settings screens back out without starting a match', () => {
    // The other half of the rule, for the two screens this block is about: a
    // ruling that cut a way IN must not have left either of them a trap.
    for (const screen of SETTINGS_SCREENS) {
      expect(screenExits(screen).length, `${screen} has an exit`).toBeGreaterThan(0);
      expect(reachesMainMenuWithoutMatch(screen), `${screen} reaches the menu`).toBe(true);
    }
  });
});
