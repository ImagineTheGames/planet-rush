/**
 * Onboarding prompt-trigger tests (GDD §2.10). The load-bearing contract:
 *  - the right prompt fires on the right contextual trigger;
 *  - each prompt fires **once** and never re-appears after completion;
 *  - the wording is input-agnostic *via the action layer* (touch ≠ keyboard).
 * These are the day-1 DoD tests: prompt-trigger logic + once-only behavior.
 */
import { describe, it, expect } from 'vitest';
import { Onboarding, PromptId, resolvePromptText } from './onboarding';
import { FireMode } from '@platform/actions';
import type { OnboardingSignals } from './onboarding';

/** A neutral signal frame (nothing happening) with per-test overrides. */
function sig(over: Partial<OnboardingSignals> = {}): OnboardingSignals {
  return { nearAsteroid: false, cargo: 0, cargoCap: 2, ...over };
}

describe('Onboarding — MINE prompt (GDD §2.10 "hold fire on the asteroid")', () => {
  it('does not fire before the player is near an asteroid', () => {
    const ob = new Onboarding();
    expect(ob.update(sig({ nearAsteroid: false }))).toBeNull();
  });

  it('fires the moment an asteroid is in reach and nothing has been mined', () => {
    const ob = new Onboarding();
    expect(ob.update(sig({ nearAsteroid: true }))).toBe(PromptId.Mine);
  });

  it('completes once the player has mined (cargo > 0) and never re-fires', () => {
    const ob = new Onboarding();
    expect(ob.update(sig({ nearAsteroid: true }))).toBe(PromptId.Mine);
    // The player mines a chunk — lesson learned.
    expect(ob.update(sig({ nearAsteroid: true, cargo: 1 }))).toBeNull();
    expect(ob.isCompleted(PromptId.Mine)).toBe(true);
    // Even back near a rock with an empty hold, it must not come back.
    expect(ob.update(sig({ nearAsteroid: true, cargo: 0 }))).toBeNull();
  });
});

describe('Onboarding — HAUL-HOME prompt (GDD §2.3 "hold full — fly home")', () => {
  it('fires when the hold is full', () => {
    const ob = new Onboarding();
    // Mine first so the MINE prompt completes and doesn't shadow this one.
    ob.update(sig({ nearAsteroid: true, cargo: 1 }));
    expect(ob.update(sig({ cargo: 2, cargoCap: 2 }))).toBe(PromptId.HaulHome);
  });

  it('completes once a full hold is emptied and never re-fires', () => {
    const ob = new Onboarding();
    ob.update(sig({ cargo: 2, cargoCap: 2 })); // full → HaulHome shows
    expect(ob.update(sig({ cargo: 2, cargoCap: 2 }))).toBe(PromptId.HaulHome);
    // Hold emptied (flew home / dropped on death) — lesson learned.
    expect(ob.update(sig({ cargo: 0, cargoCap: 2 }))).toBeNull();
    expect(ob.isCompleted(PromptId.HaulHome)).toBe(true);
    // Fill the hold again — the prompt must stay retired.
    expect(ob.update(sig({ cargo: 2, cargoCap: 2 }))).toBeNull();
  });

  it('does not fire on a full hold that was full from the very first frame, once emptied', () => {
    const ob = new Onboarding();
    expect(ob.update(sig({ cargo: 2, cargoCap: 2 }))).toBe(PromptId.HaulHome);
    expect(ob.update(sig({ cargo: 1, cargoCap: 2 }))).toBeNull(); // dropped below full
    expect(ob.isCompleted(PromptId.HaulHome)).toBe(true);
  });
});

describe('Onboarding — once-only across the whole session (GDD §2.10)', () => {
  it('retires both day-1 prompts after each has fired once', () => {
    const ob = new Onboarding();
    expect(ob.allCompleted()).toBe(false);
    ob.update(sig({ nearAsteroid: true })); // MINE shows
    ob.update(sig({ nearAsteroid: true, cargo: 1 })); // MINE done
    ob.update(sig({ cargo: 2, cargoCap: 2 })); // HAUL shows
    ob.update(sig({ cargo: 0, cargoCap: 2 })); // HAUL done
    expect(ob.allCompleted()).toBe(true);
    // Nothing ever fires again.
    expect(ob.update(sig({ nearAsteroid: true, cargo: 2, cargoCap: 2 }))).toBeNull();
  });

  it('never shows two prompts at once — mine requires empty, haul requires full', () => {
    const ob = new Onboarding();
    // Cannot be both near-with-empty-hold AND full simultaneously (cap ≥ 1).
    const shown = ob.update(sig({ nearAsteroid: true, cargo: 2, cargoCap: 2 }));
    // Full hold means the player has mined → MINE is completed; HAUL shows.
    expect(shown).toBe(PromptId.HaulHome);
    expect(ob.isCompleted(PromptId.Mine)).toBe(true);
  });
});

describe('resolvePromptText — input-agnostic via the action layer (GDD §2.10)', () => {
  it('renders the mine prompt with the keyboard fire binding on desktop', () => {
    const text = resolvePromptText(PromptId.Mine, 'keyboard', FireMode.Manual);
    expect(text).toContain('on the asteroid — your beam mines it');
    // {fire} resolved to the keyboard binding, not left as a literal token.
    expect(text).not.toContain('{fire}');
    expect(text).toContain('Left mouse');
  });

  it('renders the mine prompt with touch wording — same map, different device', () => {
    const desktop = resolvePromptText(PromptId.Mine, 'keyboard', FireMode.Manual);
    const touch = resolvePromptText(PromptId.Mine, 'touch', FireMode.AutoAim);
    expect(touch).not.toContain('{fire}');
    // Auto-aim touch fire is the FIRE button — proves the wording tracks the
    // action layer, not a hard-coded key.
    expect(touch).toContain('FIRE button');
    expect(touch).not.toBe(desktop);
  });

  it('leaves a token-free prompt (haul-home) identical across devices', () => {
    const a = resolvePromptText(PromptId.HaulHome, 'keyboard', FireMode.Manual);
    const b = resolvePromptText(PromptId.HaulHome, 'touch', FireMode.AutoAim);
    expect(a).toBe('Hold full — fly home');
    expect(b).toBe(a);
  });
});
