/**
 * src/ui/build-button.test.ts — the persistence rule, pinned. OWNER: UI Engineer.
 *
 * The field bug was "the build menu button disappeared after building." These
 * tests make the fix a contract: the button's visibility is a pure function of
 * *docked* (on touch), and depends on **nothing else** — not the wheel, not a
 * one-shot onboarding flag. That property is what makes building unable to take
 * the button away, so it is asserted directly.
 */
import { describe, it, expect } from 'vitest';
import { resolveAnchor } from '@platform/layout-registry';
import {
  BUILD_BUTTON_ID,
  BUILD_BUTTON_ANCHOR,
  buildButtonVisible,
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

describe('build button layout contract', () => {
  it('declares a stable id and a region the resolver accepts on any viewport', () => {
    expect(BUILD_BUTTON_ID).toBe('build-button');
    // `full` resolves to the whole viewport — the honest checkable promise on a
    // short landscape phone where no lower-band region contains the button.
    const zone = resolveAnchor(BUILD_BUTTON_ANCHOR, { width: 844, height: 390 });
    expect(zone).toEqual({ x: 0, y: 0, width: 844, height: 390 });
  });
});
