/**
 * src/ui/build-button.test.ts — the persistence rule, pinned. OWNER: UI Engineer.
 *
 * The field bug was "the build menu button disappeared after building." These
 * tests make the fix a contract: the button's visibility is a pure function of
 * *docked* (on touch), and depends on **nothing else** — not the wheel, not a
 * one-shot onboarding flag. That property is what makes building unable to take
 * the button away, so it is asserted directly.
 *
 * A second field report (2026-08-05) asked the button to *stand out* the moment
 * building becomes possible. That state is asserted here too, and asserted
 * against the sim rather than against itself: a real ship walked across
 * `STATION.dockRange` with the real wheel beside it, so the promise the highlight
 * makes and the wheel's willingness to open cannot come apart.
 */
import { describe, it, expect } from 'vitest';
import { resolveAnchor } from '@platform/layout-registry';
import { ShipClass } from '@shared/types';
import { WheelInput } from '@platform/wheel-input';
import { STATION, createWorld, isDocked, stationOf } from '../sim';
import { BUILD_RING_RADIUS } from '../art/stations';
import {
  BUILD_BUTTON_ID,
  BUILD_BUTTON_ANCHOR,
  buildButtonVisible,
  buildButtonHighlighted,
} from './build-button';

describe('buildButtonVisible — the persistence rule', () => {
  it('is shown when docked on a touch device', () => {
    expect(buildButtonVisible({ docked: true, isTouch: true })).toBe(true);
  });

  it('is hidden away from the station (undocked) — the one thing that hides it', () => {
    expect(buildButtonVisible({ docked: false, isTouch: true })).toBe(false);
  });

  it('is never shown on a non-touch build (desktop presses the named key)', () => {
    expect(buildButtonVisible({ docked: true, isTouch: false })).toBe(false);
    expect(buildButtonVisible({ docked: false, isTouch: false })).toBe(false);
  });

  it('depends on docked ALONE — the signal shape cannot express wheel/onboarding state', () => {
    // The regression guard: BuildButtonSignals has exactly two fields, so there
    // is no `wheelOpen` or `hasOrdered` to accidentally gate on. Visibility is a
    // total function of (isTouch, docked); enumerate it and it is constant in
    // everything else because nothing else exists to vary.
    const truth: Array<[boolean, boolean, boolean]> = [
      [true, true, true],
      [true, false, false],
      [false, true, false],
      [false, false, false],
    ];
    for (const [isTouch, docked, expected] of truth) {
      expect(buildButtonVisible({ isTouch, docked })).toBe(expected);
    }
  });

  it('stays visible across a full build cycle while docked (open → build → close)', () => {
    // Docking does not change when a structure is bought (building never undocks
    // you), so every step of the cycle reads the same `docked: true` and the
    // button is present at each — the exact sequence the field report broke.
    const docked = { docked: true, isTouch: true };
    const beforeOpen = buildButtonVisible(docked);
    const wheelOpen = buildButtonVisible(docked); // opening the wheel is not an input
    const duringBuild = buildButtonVisible(docked);
    const afterBuild = buildButtonVisible(docked);
    const reopened = buildButtonVisible(docked);
    expect([beforeOpen, wheelOpen, duringBuild, afterBuild, reopened]).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
  });
});

describe('buildButtonHighlighted — the lit state (field report 2026-08-05)', () => {
  /**
   * The developer's ask was "once you are in build distance it should highlight
   * the build button". So the test is written in build distance, not in booleans:
   * a real world, a real ship, walked across `STATION.dockRange`, with the sim's
   * own `isDocked` deciding — and the wheel that the highlight is a promise about
   * standing right next to it, fed the same answer the game feeds it.
   *
   * @param at Distance from the ship's own station centre, in world units.
   */
  function atDistance(at: number): { docked: boolean; wheelOpens: boolean } {
    const world = createWorld({
      seed: 4,
      players: [{ id: 0, shipClass: ShipClass.Vanguard }],
      asteroidCount: 0,
    });
    const ship = world.ships.find((s) => s.id === 0)!;
    const station = stationOf(world, 0)!;
    ship.pos = { x: station.pos.x + at, y: station.pos.y };
    const docked = isDocked(ship, station);

    // Exactly what `updateBuildWheel` (src/main.ts) does with that answer.
    const wheel = new WheelInput();
    wheel.setAvailable(docked && station.alive && ship.alive);
    wheel.toggle();
    const wheelOpens = wheel.open;
    // `setAvailable` is what closes a wheel you flew away from, so run it after
    // the open too — an unavailable wheel must not stay up.
    wheel.setAvailable(docked && station.alive && ship.alive);
    return { docked, wheelOpens: wheelOpens && wheel.open };
  }

  it('lights exactly where the wheel becomes available — inside dockRange', () => {
    const inside = atDistance(STATION.dockRange * 0.9);
    expect(inside.docked).toBe(true);
    expect(inside.wheelOpens).toBe(true);
    expect(buildButtonHighlighted({ docked: inside.docked, isTouch: true })).toBe(true);
  });

  it('is dark exactly where the wheel refuses — outside dockRange', () => {
    const outside = atDistance(STATION.dockRange * 1.1);
    expect(outside.docked).toBe(false);
    expect(outside.wheelOpens).toBe(false);
    expect(buildButtonHighlighted({ docked: outside.docked, isTouch: true })).toBe(false);
  });

  it('never disagrees with the wheel, anywhere across the boundary', () => {
    // The failure this rules out: a highlight computed from a distance of its
    // own, which says "you can build" a few units before or after the wheel
    // agrees. Sweep the crossing and assert they are the same bit every time.
    for (let k = 0.5; k <= 1.5; k += 0.02) {
      const { docked, wheelOpens } = atDistance(STATION.dockRange * k);
      const lit = buildButtonHighlighted({ docked, isTouch: true });
      expect(lit, `at ${k.toFixed(2)}× dockRange`).toBe(wheelOpens);
    }
  });

  it('lights on the radius the world draws — the button and the build ring are one rule', () => {
    // The dashed plasma ring the player flies across (@art/stations) is the same
    // number, so "I crossed the ring" and "the button lit" cannot come apart.
    expect(BUILD_RING_RADIUS * STATION.radius).toBe(STATION.dockRange);
  });

  it('is the same predicate as visibility, not a second copy of it', () => {
    // Asserted together, over the whole signal space: a lit button is always a
    // present button, and a present button is always lit. Two states, one answer.
    for (const isTouch of [true, false]) {
      for (const docked of [true, false]) {
        expect(buildButtonHighlighted({ isTouch, docked })).toBe(buildButtonVisible({ isTouch, docked }));
      }
    }
  });

  it('stays dark on a non-touch build, where there is no button to light', () => {
    expect(buildButtonHighlighted({ docked: true, isTouch: false })).toBe(false);
  });
});

describe('build button layout contract', () => {
  it('declares a stable id and a region the resolver accepts on any viewport', () => {
    expect(BUILD_BUTTON_ID).toBe('build-button');
    // `full` resolves to the whole viewport — the honest checkable promise on a
    // short landscape phone where no lower-band region contains the button.
    const zone = resolveAnchor(BUILD_BUTTON_ANCHOR, { width: 844, height: 390 });
    expect(zone).toEqual({ x: 0, y: 0, width: 844, height: 390 });
  });
});
