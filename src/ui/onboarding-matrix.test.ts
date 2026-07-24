/**
 * Onboarding **prompt trigger matrix** (GDD §2.10 — day-6 tuning pass).
 *
 * The day-2 suite ({@link ./onboarding.test.ts}) proves each prompt one at a
 * time. This file is the *matrix*: it drives every prompt against every trigger
 * and every device/fire-mode in a table, so the whole set is pinned as one grid
 * rather than a handful of chosen cases. Two grids:
 *
 *  1. **Wording** — PromptId × DeviceKind × FireMode: every prompt resolves with
 *     no leftover `{token}`, and its `{fire}` / `{build}` land on *exactly* the
 *     binding the action layer reports for that device+mode (so touch ≠ desktop
 *     for free, and can never drift from the controls strip).
 *  2. **Triggers** — a scenario table mapping a signal frame to the one prompt it
 *     must produce, plus priority when several are eligible, plus the once-only
 *     guarantee across a full first-match playthrough.
 */
import { describe, it, expect } from 'vitest';
import { Onboarding, PromptId, resolvePromptText } from './onboarding';
import { describeBindings, FireMode } from './../platform/actions';
import type { DeviceKind } from './../platform/actions';
import type { OnboardingSignals } from './onboarding';

const DEVICES: readonly DeviceKind[] = ['keyboard', 'gamepad', 'touch'];
const MODES: readonly FireMode[] = [FireMode.Manual, FireMode.AutoAim];
const PROMPTS: readonly PromptId[] = [
  PromptId.Mine,
  PromptId.HaulHome,
  PromptId.Spend,
  PromptId.UnderAttack,
];

/** The binding the action layer reports for an action on a device+mode — the
 *  single source the prompt copy must agree with. */
function binding(action: 'fire' | 'build', device: DeviceKind, mode: FireMode): string {
  return describeBindings(device, mode).find((r) => r.action === action)!.binding;
}

function sig(over: Partial<OnboardingSignals> = {}): OnboardingSignals {
  return { nearAsteroid: false, cargo: 0, cargoCap: 2, ...over };
}

// ---------------------------------------------------------------------------
// Grid 1 — input-agnostic wording across the whole device/mode matrix
// ---------------------------------------------------------------------------

describe('onboarding matrix — wording is input-agnostic via the action layer', () => {
  for (const id of PROMPTS) {
    for (const device of DEVICES) {
      for (const mode of MODES) {
        it(`${id} on ${device}/${FireMode[mode]} leaves no unresolved token`, () => {
          const text = resolvePromptText(id, device, mode);
          expect(text).not.toMatch(/\{[a-z]+\}/); // no `{fire}`/`{build}` left behind
          expect(text.length).toBeGreaterThan(0);
        });
      }
    }
  }

  it('resolves {fire} to each device+mode fire binding, verbatim', () => {
    for (const device of DEVICES) {
      for (const mode of MODES) {
        const text = resolvePromptText(PromptId.Mine, device, mode);
        expect(text).toContain(binding('fire', device, mode));
      }
    }
    // The cell that matters most: auto-aim touch fire is the FIRE button, and the
    // prompt says so — proof the wording tracks the map, not a hard-coded key.
    expect(resolvePromptText(PromptId.Mine, 'touch', FireMode.AutoAim)).toContain('FIRE button');
    expect(resolvePromptText(PromptId.Mine, 'keyboard', FireMode.Manual)).toContain('Left mouse');
  });

  it('resolves {build} to each device build binding, verbatim', () => {
    for (const device of DEVICES) {
      for (const mode of MODES) {
        const text = resolvePromptText(PromptId.HaulHome, device, mode);
        expect(text).toContain(binding('build', device, mode));
      }
    }
    expect(resolvePromptText(PromptId.HaulHome, 'keyboard', FireMode.Manual)).toBe(
      'Hold full — fly home and press E',
    );
    expect(resolvePromptText(PromptId.HaulHome, 'touch', FireMode.AutoAim)).toBe(
      'Hold full — fly home and press BUILD',
    );
  });

  it('leaves the token-free prompts identical across every device+mode', () => {
    // SPEND and UNDER-ATTACK carry no binding token, so they must read the same
    // everywhere — the wheel names its own segment, the arrow is device-agnostic.
    for (const id of [PromptId.Spend, PromptId.UnderAttack]) {
      const texts = new Set<string>();
      for (const device of DEVICES) {
        for (const mode of MODES) texts.add(resolvePromptText(id, device, mode));
      }
      expect(texts.size).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Grid 2 — the trigger table
// ---------------------------------------------------------------------------

/** Each row: a fresh machine fed one frame, and the prompt it must return. */
const TRIGGER_TABLE: ReadonlyArray<{
  name: string;
  frame: Partial<OnboardingSignals>;
  expect: PromptId | null;
}> = [
  { name: 'quiet frame shows nothing', frame: {}, expect: null },
  { name: 'asteroid in reach → MINE', frame: { nearAsteroid: true }, expect: PromptId.Mine },
  { name: 'hold full → HAUL-HOME', frame: { cargo: 2, cargoCap: 2 }, expect: PromptId.HaulHome },
  { name: 'wheel open → SPEND', frame: { wheelOpen: true }, expect: PromptId.Spend },
  { name: 'alarm sounding → UNDER-ATTACK', frame: { underAttack: true }, expect: PromptId.UnderAttack },
  {
    name: 'siege outranks a shopping tip',
    frame: { underAttack: true, wheelOpen: true, nearAsteroid: true },
    expect: PromptId.UnderAttack,
  },
  {
    name: 'wheel open near a rock, empty hold → MINE leads SPEND',
    frame: { wheelOpen: true, nearAsteroid: true },
    expect: PromptId.Mine,
  },
];

describe('onboarding matrix — trigger table (each prompt on its own trigger)', () => {
  for (const row of TRIGGER_TABLE) {
    it(row.name, () => {
      const ob = new Onboarding();
      expect(ob.update(sig(row.frame))).toBe(row.expect);
    });
  }
});

describe('onboarding matrix — every prompt fires exactly once across a match', () => {
  it('walks the whole first match and retires each prompt, then never re-fires', () => {
    const ob = new Onboarding();
    const fired: PromptId[] = [];
    const feed = (over: Partial<OnboardingSignals>) => {
      const id = ob.update(sig(over));
      if (id !== null && !fired.includes(id)) fired.push(id);
    };

    // A plausible first match, in order: mine, haul, spend, survive a siege.
    feed({ nearAsteroid: true }); // MINE
    feed({ nearAsteroid: true, cargo: 1 }); // mined → MINE retired
    feed({ cargo: 2, cargoCap: 2 }); // HAUL-HOME
    feed({ cargo: 0, cargoCap: 2 }); // emptied → HAUL retired
    feed({ wheelOpen: true }); // SPEND
    feed({ wheelOpen: true, hasOrdered: true }); // bought → SPEND retired
    feed({ underAttack: true }); // UNDER-ATTACK
    feed({ underAttack: false }); // survived → UNDER-ATTACK retired

    expect(new Set(fired)).toEqual(new Set(PROMPTS));
    expect(ob.allCompleted()).toBe(true);
    for (const id of PROMPTS) expect(ob.isCompleted(id)).toBe(true);

    // A frame that would trigger *all four* on a fresh machine now shows nothing.
    expect(
      ob.update(
        sig({ nearAsteroid: true, cargo: 2, cargoCap: 2, wheelOpen: true, underAttack: true }),
      ),
    ).toBeNull();
  });

  it('never shows a prompt whose lesson is already learned, even out of order', () => {
    const ob = new Onboarding();
    // Straight into a full hold near a rock: the player has clearly mined, so
    // MINE is retired without ever being shown, and HAUL leads.
    expect(ob.update(sig({ nearAsteroid: true, cargo: 2, cargoCap: 2 }))).toBe(PromptId.HaulHome);
    expect(ob.isCompleted(PromptId.Mine)).toBe(true);
  });
});
