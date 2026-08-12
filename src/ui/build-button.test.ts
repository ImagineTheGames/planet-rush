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
  BUILD_BUTTON_LABEL,
  BUILD_BUTTON_RADIUS,
  BUILD_BUTTON_RIM,
  ROUND_LABEL_PAD,
  buildButtonVisible,
  buildButtonHighlighted,
  fitRoundLabelSize,
  roundLabelHalfWidth,
} from './build-button';
import { textHeight, textWidth } from './font-metrics';
import { DISPLAY_TRACKING, TRACKING } from '../art/materials';

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

// ---------------------------------------------------------------------------
// The words on the circle (a0-32)
// ---------------------------------------------------------------------------

describe('the button\'s label is fitted to the circle, not guessed at', () => {
  it('both lines are inside the ring, measured as boxes rather than baselines', () => {
    for (const line of BUILD_BUTTON_LABEL) {
      const spec = { face: line.face, size: line.size, tracking: line.tracking };
      const yExtent = Math.abs(line.centreY) + textHeight(line.text, spec) / 2;
      const room = 2 * roundLabelHalfWidth(BUILD_BUTTON_RADIUS, BUILD_BUTTON_RIM, yExtent) - 2 * ROUND_LABEL_PAD;
      expect(textWidth(line.text, spec), `"${line.text}" does not fit the button`).toBeLessThanOrEqual(room);
    }
  });

  it('the interior stops at the RIM, not at the radius — that is the silhouette', () => {
    // Half the report: the ring is stroked centred on the radius, so a word drawn
    // out to the radius sits under it. Measured on the widest line of the circle,
    // where the difference is exactly half a rim on each side.
    const atRim = roundLabelHalfWidth(BUILD_BUTTON_RADIUS, BUILD_BUTTON_RIM, 0);
    expect(atRim).toBeCloseTo(BUILD_BUTTON_RADIUS - BUILD_BUTTON_RIM / 2, 10);
    expect(atRim).toBeLessThan(BUILD_BUTTON_RADIUS);
  });

  it('a circle is narrowest where the type is furthest from its middle', () => {
    // The other half: a chord at the label's own baseline is not the room the
    // label has, because a line of type has height. `& UPGRADE`'s box reaches
    // ~5px past its centre, and the circle has closed in by then.
    const wide = roundLabelHalfWidth(BUILD_BUTTON_RADIUS, BUILD_BUTTON_RIM, 10);
    const narrow = roundLabelHalfWidth(BUILD_BUTTON_RADIUS, BUILD_BUTTON_RIM, 15.2);
    expect(narrow).toBeLessThan(wide);
    // …and past the interior there is no room at all, rather than a negative one.
    expect(roundLabelHalfWidth(BUILD_BUTTON_RADIUS, BUILD_BUTTON_RIM, 999)).toBe(0);
  });

  it('takes the biggest size that fits, and refuses rather than shrink past a floor', () => {
    // The fitter is a fit, not a clamp: a word with room keeps its design size,
    // and a word with none comes back `null` so the caller can throw. A silent
    // clamp to something unreadable is the failure mode this brief is about.
    const roomy = fitRoundLabelSize('& UPGRADE', 'bodyBold', TRACKING.label, 10, 10, 200, 5, 6);
    expect(roomy, 'a big enough circle keeps the design size').toBe(10);

    const hopeless = fitRoundLabelSize('& UPGRADE', 'bodyBold', TRACKING.label, 10, 10, 12, 5, 6);
    expect(hopeless, 'a circle this small cannot hold nine glyphs at any size').toBeNull();
  });

  it('spends exactly one pixel of type, on the line that needed it', () => {
    // Stated as an assertion because the brief asks for it to be stated at all:
    // `& UPGRADE` came down from a0-23's 10px to 9px, and `BUILD` did not move.
    // If a future change makes either of these false it should be a decision
    // somebody makes, not a number that drifted.
    const byText = new Map(BUILD_BUTTON_LABEL.map((l) => [l.text, l]));
    expect(byText.get('BUILD')!.size).toBe(15);
    expect(byText.get('& UPGRADE')!.size).toBe(9);
    // …and the copy did not change, which was the point of spending the pixel.
    expect([...byText.keys()]).toEqual(['BUILD', '& UPGRADE']);
  });

  it('draws each word in its ratified face and tracking tier', () => {
    const byText = new Map(BUILD_BUTTON_LABEL.map((l) => [l.text, l]));
    // The pressed word takes the display face and its own tracking axis; the
    // sub-line is body copy at the label tier (style-guide §7, materials.ts).
    expect(byText.get('BUILD')!.face).toBe('headingBold');
    expect(byText.get('BUILD')!.tracking).toBe(DISPLAY_TRACKING.heading);
    expect(byText.get('& UPGRADE')!.face).toBe('bodyBold');
    expect(byText.get('& UPGRADE')!.tracking).toBe(TRACKING.label);
  });
});
