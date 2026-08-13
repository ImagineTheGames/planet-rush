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
import { Onboarding, PromptId, oreWasSpent, resolvePromptText } from './onboarding';
import { FireMode } from '@platform/actions';
import type { DeviceKind } from '@platform/actions';
import type { OnboardingMemory, OnboardingSignals, SpendFacts } from './onboarding';

/** A neutral signal frame (nothing happening) with per-test overrides. */
function sig(over: Partial<OnboardingSignals> = {}): OnboardingSignals {
  return { nearAsteroid: false, cargo: 0, cargoCap: 2, ...over };
}

/** An in-memory {@link OnboardingMemory} that records every write — the test's
 *  stand-in for the profile store, and the shape the real port must satisfy. */
function fakeMemory(seed: readonly string[] = []): OnboardingMemory & {
  readonly writes: string[][];
  stored: readonly string[];
} {
  const m = {
    stored: seed as readonly string[],
    writes: [] as string[][],
    load(): readonly string[] {
      return m.stored;
    },
    save(completed: readonly PromptId[]): void {
      m.stored = [...completed];
      m.writes.push([...completed]);
    },
  };
  return m;
}

/** A neutral purchase-observable snapshot (nothing built, nothing repaired). */
function facts(over: Partial<SpendFacts> = {}): SpendFacts {
  return { coreHp: 100, turrets: 0, shields: 0, satellites: 0, upgradeTiers: 0, ...over };
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
    expect(ob.update(sig({ wheelOpen: true, hasSpent: true }))).toBeNull();
    expect(ob.isCompleted(PromptId.Spend)).toBe(true);
    // Opening the wheel again must not bring the lesson back.
    expect(ob.update(sig({ wheelOpen: true, hasSpent: true }))).toBeNull();
  });

  it('stays up across an open wheel until something is bought', () => {
    const ob = new Onboarding();
    for (let i = 0; i < 5; i++) {
      expect(ob.update(sig({ wheelOpen: true }))).toBe(PromptId.Spend);
    }
  });

  // ── u15-01 half B ─────────────────────────────────────────────────────────
  // §2.10: the prompt exists "because upgrades are the half of the economy a
  // player can most easily miss". The lesson is SPENDING, so only a spend may
  // retire it — and now that completion PERSISTS, a wrong retirement is not one
  // match of missing tuition, it is every match this player will ever play.
  it('is not retired by a press the sim refused — the wheel is not the lesson', () => {
    const ob = new Onboarding();
    expect(ob.update(sig({ wheelOpen: true }))).toBe(PromptId.Spend);
    // The player points at TURRET and confirms with 2 ore. The order is written
    // and the sim refuses it on cost: nothing was bought, nothing was learned.
    expect(ob.update(sig({ wheelOpen: true, hasSpent: false }))).toBe(PromptId.Spend);
    expect(ob.isCompleted(PromptId.Spend)).toBe(false);
    // …and it is still there on the next wheel-open, which is the point.
    expect(ob.update(sig({ wheelOpen: true }))).toBe(PromptId.Spend);
  });

  it('is not retired by banking — a player can bank all match and never spend', () => {
    const ob = new Onboarding();
    // A full hold drains in the collection field: `banked` climbs, the hold
    // empties, and the wheel opens on the way past. None of that is a purchase.
    ob.update(sig({ cargo: 2, cargoCap: 2 }));
    ob.update(sig({ cargo: 0, cargoCap: 2 }));
    expect(ob.update(sig({ wheelOpen: true }))).toBe(PromptId.Spend);
    expect(ob.isCompleted(PromptId.Spend)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// u15-01 half B — what counts as "ore actually spent"
// ---------------------------------------------------------------------------

describe('oreWasSpent — a purchase the SIM landed, not a press (GDD §2.5, §2.10)', () => {
  it('is false when nothing moved', () => {
    expect(oreWasSpent(facts(), facts())).toBe(false);
  });

  it('is true when a turret, a shield or a satellite appears', () => {
    expect(oreWasSpent(facts(), facts({ turrets: 1 }))).toBe(true);
    expect(oreWasSpent(facts(), facts({ shields: 1 }))).toBe(true);
    expect(oreWasSpent(facts(), facts({ satellites: 1 }))).toBe(true);
  });

  it('is true when an upgrade tier is bought', () => {
    expect(oreWasSpent(facts(), facts({ upgradeTiers: 1 }))).toBe(true);
  });

  it('is true when the core heals — only a bought repair raises core HP', () => {
    expect(oreWasSpent(facts({ coreHp: 40 }), facts({ coreHp: 55 }))).toBe(true);
  });

  it('is false for the losses a siege causes — damage is not a purchase', () => {
    expect(oreWasSpent(facts({ coreHp: 100 }), facts({ coreHp: 60 }))).toBe(false);
    expect(oreWasSpent(facts({ turrets: 2 }), facts({ turrets: 1 }))).toBe(false);
    expect(oreWasSpent(facts({ shields: 1 }), facts({ shields: 0 }))).toBe(false);
  });

  it('ignores float noise on the core, the way every other HP compare does', () => {
    expect(oreWasSpent(facts({ coreHp: 50 }), facts({ coreHp: 50 + 1e-9 }))).toBe(false);
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

// ---------------------------------------------------------------------------
// a0-34 — the prompt that names the objective
// ---------------------------------------------------------------------------
//
// The four prompts above teach verbs — mining, banking, spending, defending —
// and not one of them says what the player is trying to ACHIEVE. The codex's
// strategy entries all presume the reader already knows. So the first thing a
// first match says is now the win condition itself (GDD §1), and it says it
// BEFORE the mining lesson, because the goal is what frames every verb after it.

describe('Onboarding — OBJECTIVE prompt (GDD §1 win condition, §2.10)', () => {
  it('names the objective — the win condition, in the prompt copy itself', () => {
    // GDD §1: "Own the last surviving station reactor — in Teams, be the last
    // side with a reactor standing", enforced by `resolveWinner` in
    // src/sim/match.ts (the last team holding a core wins; FFA is teams-of-one).
    // The prompt has to SAY that, not gesture at it.
    const text = resolvePromptText(PromptId.Objective, 'keyboard', FireMode.Manual);
    expect(text).toMatch(/last station standing/i);
    // …and the developer's other three beats, so the one line is the whole loop:
    // mine ore, spend it on defenses / your ship, and attack when you judge it.
    expect(text).toMatch(/mine ore/i);
    expect(text).toMatch(/defen[cs]e/i);
    expect(text).toMatch(/upgrade your ship/i);
    expect(text).toMatch(/attack/i);
  });

  it('fires FIRST — before the mining prompt, with a rock already in reach', () => {
    // The failure this pins: a player who is taught "hold fire on the asteroid"
    // before anyone has told them what winning is.
    const ob = new Onboarding();
    expect(ob.update(sig({ nearAsteroid: true, time: 0 }))).toBe(PromptId.Objective);
    expect(ob.isCompleted(PromptId.Mine)).toBe(false);
  });

  it('hands the band to MINE once it has been on screen long enough to read', () => {
    const ob = new Onboarding();
    expect(ob.update(sig({ nearAsteroid: true, time: 0 }))).toBe(PromptId.Objective);
    expect(ob.update(sig({ nearAsteroid: true, time: 4 }))).toBe(PromptId.Objective);
    // Read — and now the verb lessons follow, in their own order.
    expect(ob.update(sig({ nearAsteroid: true, time: 20 }))).toBe(PromptId.Mine);
    expect(ob.isCompleted(PromptId.Objective)).toBe(true);
  });

  it('yields to a siege, and is not retired by the seconds it spent off screen', () => {
    // UNDER-ATTACK outranks everything (GDD §2.2). A tip that expires while it is
    // not on screen is a tip nobody read.
    const ob = new Onboarding();
    expect(ob.update(sig({ time: 0 }))).toBe(PromptId.Objective);
    expect(ob.update(sig({ time: 1, underAttack: true }))).toBe(PromptId.UnderAttack);
    expect(ob.update(sig({ time: 60, underAttack: true }))).toBe(PromptId.UnderAttack);
    expect(ob.update(sig({ time: 61 }))).toBe(PromptId.Objective);
    expect(ob.isCompleted(PromptId.Objective)).toBe(false);
  });

  it('is shown once and never again — across matches, through the memory', () => {
    // §2.10's "never appear again after each is completed once", made durable by
    // u15-01: the objective is a thing you are told, not a thing you re-learn.
    const memory = fakeMemory();
    const first = new Onboarding(memory);
    first.update(sig({ time: 0 }));
    first.update(sig({ time: 30 }));
    expect(first.isCompleted(PromptId.Objective)).toBe(true);
    expect(memory.stored).toContain(PromptId.Objective);

    const second = new Onboarding(memory); // next match, fresh machine
    expect(second.update(sig({ nearAsteroid: true, time: 0 }))).toBe(PromptId.Mine);
  });

  it('stays off the screen entirely when the caller feeds no clock', () => {
    // The dwell is measured on match time the caller hands in. A feed without one
    // cannot know when the sentence has been read, so it must not take the band
    // from the mining lesson forever — the safe direction to fail.
    const ob = new Onboarding();
    expect(ob.update(sig({ nearAsteroid: true }))).toBe(PromptId.Mine);
  });

  it('reads the same on every device and in every fire mode — no binding in it', () => {
    // It teaches the goal, not a gesture, so there is no key to name: the copy is
    // input-agnostic by having nothing device-shaped in it at all (GDD §2.10).
    const desktop = resolvePromptText(PromptId.Objective, 'keyboard', FireMode.Manual);
    const touch = resolvePromptText(PromptId.Objective, 'touch', FireMode.AutoAim);
    const pad = resolvePromptText(PromptId.Objective, 'gamepad', FireMode.Manual);
    expect(touch).toBe(desktop);
    expect(pad).toBe(desktop);
    expect(desktop).not.toMatch(/[{}]/);
  });
});

describe('Onboarding — once-only across the whole session (GDD §2.10)', () => {
  it('retires every prompt after each has fired once', () => {
    const ob = new Onboarding();
    expect(ob.allCompleted()).toBe(false);
    ob.update(sig({ time: 0 })); // OBJECTIVE shows — the goal, first (a0-34)
    ob.update(sig({ time: 30 })); // …read, and retired
    ob.update(sig({ nearAsteroid: true })); // MINE shows
    ob.update(sig({ nearAsteroid: true, cargo: 1 })); // MINE done
    ob.update(sig({ cargo: 2, cargoCap: 2 })); // HAUL shows
    ob.update(sig({ cargo: 0, cargoCap: 2 })); // HAUL done
    ob.update(sig({ wheelOpen: true })); // SPEND shows
    ob.update(sig({ wheelOpen: true, hasSpent: true })); // SPEND done
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

// ---------------------------------------------------------------------------
// u15-01 half A — the memory that outlives the match
// ---------------------------------------------------------------------------

describe('Onboarding — remembers across matches and page loads (GDD §2.10)', () => {
  it('never fires a prompt an earlier match already completed', () => {
    // The second match: a machine built from a memory that already holds MINE.
    const ob = new Onboarding(fakeMemory([PromptId.Mine]));
    expect(ob.isCompleted(PromptId.Mine)).toBe(true);
    expect(ob.update(sig({ nearAsteroid: true }))).toBeNull();
  });

  it('carries every completed prompt, and only the completed ones', () => {
    const ob = new Onboarding(fakeMemory([PromptId.Mine, PromptId.Spend]));
    expect(ob.update(sig({ nearAsteroid: true, wheelOpen: true }))).toBeNull();
    // …while an untaught lesson is still taught.
    expect(ob.update(sig({ cargo: 2, cargoCap: 2 }))).toBe(PromptId.HaulHome);
  });

  it('ignores a stored id this build does not know', () => {
    // A profile written by a future build (a fifth prompt) must not throw, and
    // must not silently retire something else.
    const ob = new Onboarding(fakeMemory(['mine', 'teleport']));
    expect(ob.isCompleted(PromptId.Mine)).toBe(true);
    expect(ob.allCompleted()).toBe(false);
    expect(ob.update(sig({ underAttack: true }))).toBe(PromptId.UnderAttack);
  });

  it('writes each lesson through the port as it lands', () => {
    const memory = fakeMemory();
    const ob = new Onboarding(memory);
    ob.update(sig({ nearAsteroid: true })); // MINE shows — nothing learned yet
    expect(memory.writes).toHaveLength(0);
    ob.update(sig({ nearAsteroid: true, cargo: 1 })); // mined — MINE completes
    expect(memory.writes).toHaveLength(1);
    expect(memory.writes[0]).toEqual([PromptId.Mine]);
    ob.update(sig({ cargo: 2, cargoCap: 2 }));
    ob.update(sig({ cargo: 0, cargoCap: 2 })); // hauled — HAUL-HOME completes
    expect(memory.writes).toHaveLength(2);
    expect(memory.writes[1]).toEqual(expect.arrayContaining([PromptId.Mine, PromptId.HaulHome]));
  });

  it('writes only when the set GROWS — never once per frame', () => {
    // `update` runs every frame of every match. A write per frame would put a
    // JSON round-trip through `localStorage` at 60 Hz.
    const memory = fakeMemory();
    const ob = new Onboarding(memory);
    for (let i = 0; i < 30; i++) ob.update(sig({ nearAsteroid: true, cargo: 1 }));
    expect(memory.writes).toHaveLength(1);
  });

  it('works with no memory at all — the port is optional', () => {
    const ob = new Onboarding();
    expect(ob.update(sig({ nearAsteroid: true }))).toBe(PromptId.Mine);
    expect(ob.update(sig({ nearAsteroid: true, cargo: 1 }))).toBeNull();
  });

  it('survives EXIT TO MENU and a reload: one memory, two machines', () => {
    // EXIT TO MENU navigates and a reload re-boots the page: either way the HUD,
    // and the `Onboarding` inside it, is built from scratch. The memory is the
    // only thing that crosses, so this is exactly what a returning player gets.
    const memory = fakeMemory();
    const first = new Onboarding(memory);
    first.update(sig({ nearAsteroid: true }));
    first.update(sig({ nearAsteroid: true, cargo: 1 }));
    expect(first.isCompleted(PromptId.Mine)).toBe(true);

    const second = new Onboarding(memory); // second match, fresh machine
    expect(second.update(sig({ nearAsteroid: true }))).toBeNull();
    expect(second.isCompleted(PromptId.Mine)).toBe(true);
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
    // GDD §2.10 quotes this as "Hold full — fly into your collection field to
    // bank, then press E to spend"; the {build} token is how the same sentence
    // reads on a pad and on a phone.
    const keyboard = resolvePromptText(PromptId.HaulHome, 'keyboard', FireMode.Manual);
    expect(keyboard).toBe(
      'Hold full — fly into your collection field to bank, then press E to spend',
    );
    const touch = resolvePromptText(PromptId.HaulHome, 'touch', FireMode.AutoAim);
    expect(touch).toBe(
      'Hold full — fly into your collection field to bank, then press BUILD to spend',
    );
    const pad = resolvePromptText(PromptId.HaulHome, 'gamepad', FireMode.Manual);
    expect(pad).toContain('Y / △');
    expect(pad).not.toContain('{build}');
  });

  it('teaches the shipped mechanic — collection-field banking, not fly-home-and-dock', () => {
    // The 2026-07-27 amendment retired dock-and-park banking: the hold drains
    // inside your own station's collection field (GDD §2.3, §2.10 "amended
    // 2026-07-27 — projectile mining, collection-field banking"). The prompt
    // that told the player to "fly home" taught the mechanic the game no longer
    // has. Asserted on EVERY device, because the failure this guards is a phone
    // that says "press E" as much as it is a keyboard that says "fly home".
    const devices: Array<[DeviceKind, FireMode]> = [
      ['keyboard', FireMode.Manual],
      ['touch', FireMode.AutoAim],
      ['touch', FireMode.Manual],
      ['gamepad', FireMode.Manual],
    ];
    for (const [device, mode] of devices) {
      const text = resolvePromptText(PromptId.HaulHome, device, mode);
      expect(text).not.toMatch(/fly home/i);
      expect(text).toContain('collection field');
      expect(text).not.toContain('{build}');
    }
    // The keyboard key is a *binding*, never a literal in the copy: a phone must
    // never be told to press E (GDD §2.4, §2.10 input-agnostic wording).
    expect(resolvePromptText(PromptId.HaulHome, 'touch', FireMode.AutoAim)).not.toMatch(
      /press E\b/,
    );
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
