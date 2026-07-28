/**
 * Onboarding prompt-trigger tests (GDD §2.10). The load-bearing contract:
 *  - the right prompt fires on the right contextual trigger;
 *  - each prompt fires **once** and never re-appears after completion;
 *  - the wording is input-agnostic *via the action layer* (touch ≠ keyboard).
 * Day-1 covered the first two prompts; day 2 adds SPEND (fires the first time
 * the wheel opens) and UNDER-ATTACK (rides the alarm), and completes the
 * haul-home copy now that there is a station to fly home to.
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

describe('Onboarding — SPEND prompt (GDD §2.10 "the first time the wheel opens")', () => {
  it('fires the first time the Build & Upgrade wheel opens', () => {
    const ob = new Onboarding();
    expect(ob.update(sig({ wheelOpen: true }))).toBe(PromptId.Spend);
  });

  it('does not fire while the wheel is shut, however much ore is held', () => {
    const ob = new Onboarding();
    ob.update(sig({ nearAsteroid: true, cargo: 1 })); // retire MINE
    expect(ob.update(sig({ wheelOpen: false, cargo: 1, cargoCap: 4 }))).toBeNull();
  });

  it('completes once ore has actually been spent, and never re-fires', () => {
    const ob = new Onboarding();
    expect(ob.update(sig({ wheelOpen: true }))).toBe(PromptId.Spend);
    // The player buys something — they have found the economy (GDD §2.5).
    expect(ob.update(sig({ wheelOpen: true, hasOrdered: true }))).toBeNull();
    expect(ob.isCompleted(PromptId.Spend)).toBe(true);
    // Opening the wheel again must not bring the lesson back.
    expect(ob.update(sig({ wheelOpen: true, hasOrdered: true }))).toBeNull();
  });

  it('stays up across an open wheel until something is bought', () => {
    const ob = new Onboarding();
    for (let i = 0; i < 5; i++) {
      expect(ob.update(sig({ wheelOpen: true }))).toBe(PromptId.Spend);
    }
  });
});

describe('Onboarding — UNDER-ATTACK prompt (GDD §2.2, §2.10)', () => {
  it('fires while the alarm is sounding', () => {
    const ob = new Onboarding();
    expect(ob.update(sig({ underAttack: true }))).toBe(PromptId.UnderAttack);
  });

  it('outranks every other prompt — a siege beats a shopping tip', () => {
    const ob = new Onboarding();
    const shown = ob.update(
      sig({ underAttack: true, wheelOpen: true, nearAsteroid: true, cargo: 2, cargoCap: 2 }),
    );
    expect(shown).toBe(PromptId.UnderAttack);
  });

  it('stays up for the whole siege, then completes once it is survived', () => {
    const ob = new Onboarding();
    expect(ob.update(sig({ underAttack: true }))).toBe(PromptId.UnderAttack);
    expect(ob.update(sig({ underAttack: true }))).toBe(PromptId.UnderAttack);
    // Alarm falls silent — the lesson has been lived.
    expect(ob.update(sig({ underAttack: false }))).toBeNull();
    expect(ob.isCompleted(PromptId.UnderAttack)).toBe(true);
    // A second siege gets the alarm and the arrow, but not the tutorial text.
    expect(ob.update(sig({ underAttack: true }))).toBeNull();
  });

  it('does not fire on a quiet station', () => {
    const ob = new Onboarding();
    expect(ob.update(sig({ underAttack: false }))).toBeNull();
    expect(ob.isCompleted(PromptId.UnderAttack)).toBe(false);
  });
});

describe('Onboarding — once-only across the whole session (GDD §2.10)', () => {
  it('retires every prompt after each has fired once', () => {
    const ob = new Onboarding();
    expect(ob.allCompleted()).toBe(false);
    ob.update(sig({ nearAsteroid: true })); // MINE shows
    ob.update(sig({ nearAsteroid: true, cargo: 1 })); // MINE done
    ob.update(sig({ cargo: 2, cargoCap: 2 })); // HAUL shows
    ob.update(sig({ cargo: 0, cargoCap: 2 })); // HAUL done
    ob.update(sig({ wheelOpen: true })); // SPEND shows
    ob.update(sig({ wheelOpen: true, hasOrdered: true })); // SPEND done
    ob.update(sig({ underAttack: true })); // UNDER-ATTACK shows
    ob.update(sig({ underAttack: false })); // survived — done
    expect(ob.allCompleted()).toBe(true);
    // Nothing ever fires again.
    expect(
      ob.update(
        sig({ nearAsteroid: true, cargo: 2, cargoCap: 2, wheelOpen: true, underAttack: true }),
      ),
    ).toBeNull();
  });

  it('treats the day-2 signals as absent-means-quiet, so an M1 feed still works', () => {
    // `main.ts`'s M1 HudFrame carries none of the day-2 fields; the machine must
    // behave exactly as it did on day 1 rather than firing on `undefined`.
    const ob = new Onboarding();
    expect(ob.update({ nearAsteroid: false, cargo: 0, cargoCap: 2 })).toBeNull();
    expect(ob.isCompleted(PromptId.UnderAttack)).toBe(false);
    expect(ob.isCompleted(PromptId.Spend)).toBe(false);
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
    expect(text).toContain('on the asteroid — your shots chip the rock');
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

  it('renders the haul-home prompt with each device\'s BUILD binding', () => {
    // GDD §2.10 quotes this as "Hold full — fly home and press E"; the {build}
    // token is how the same sentence reads on a pad and on a phone.
    const keyboard = resolvePromptText(PromptId.HaulHome, 'keyboard', FireMode.Manual);
    expect(keyboard).toBe('Hold full — fly home and press E');
    const touch = resolvePromptText(PromptId.HaulHome, 'touch', FireMode.AutoAim);
    expect(touch).toBe('Hold full — fly home and press BUILD');
    const pad = resolvePromptText(PromptId.HaulHome, 'gamepad', FireMode.Manual);
    expect(pad).toContain('Y / △');
    expect(pad).not.toContain('{build}');
  });

  it('leaves a token-free prompt identical across devices', () => {
    // The under-attack prompt points at the arrow, which is device-agnostic.
    const a = resolvePromptText(PromptId.UnderAttack, 'keyboard', FireMode.Manual);
    const b = resolvePromptText(PromptId.UnderAttack, 'touch', FireMode.AutoAim);
    expect(a).toBe('Your station is under attack — follow the arrow');
    expect(b).toBe(a);
  });

  it('names UPGRADE SHIP in the wheel\'s own words, so the segment is findable', () => {
    // "The upgrade prompt fires the first time the wheel opens, because upgrades
    // are the half of the economy a player can most easily miss" (GDD §2.10).
    const text = resolvePromptText(PromptId.Spend, 'keyboard', FireMode.Manual);
    expect(text).toContain('UPGRADE SHIP');
    expect(text).toBe('Spend ore on defense — or UPGRADE SHIP to mine and hit harder');
  });
});
