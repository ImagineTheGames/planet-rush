/**
 * evidence/u15-01-onboarding-persistence/readback.ts — what a returning player
 * is taught, read off the shipped modules and a real storage seam.
 *
 *   npx vite-node evidence/u15-01-onboarding-persistence/readback.ts \
 *     > evidence/u15-01-onboarding-persistence/readback.json
 *
 * The brief asks for two things it will not take on trust:
 *
 *  1. **"Say what a returning player now sees on their second match."** So this
 *     plays three matches over ONE storage — the second and third separated by
 *     the EXIT TO MENU navigation and by a reload — and prints every prompt the
 *     machine returns in each. Match 1 teaches; matches 2 and 3 must be silent.
 *  2. **The SPEND prompt retires on spending.** So match 1 also confirms a wedge
 *     the sim refuses (a press, no purchase) and then buys a turret, and the
 *     prompt's state is printed either side of both.
 *
 * It imports `src/ui/onboarding.ts` and `src/ui/onboarding-memory.ts` and drives
 * them exactly as `src/ui/hud.ts` does — the same port, the same profile store,
 * the same signal shape. No Pixi, no `localStorage`, no `window`: this runs in
 * node, which is the whole reason the trigger machine is pure.
 */

import { Onboarding, PromptId, oreWasSpent } from '../../src/ui/onboarding';
import type { OnboardingSignals, SpendFacts } from '../../src/ui/onboarding';
import { createProfileOnboardingMemory } from '../../src/ui/onboarding-memory';
import { PROFILE_KEY, loadProfile, type ProfileStorage } from '../../src/progression/profile';

/** The seam, in memory — structurally `platform.storage` and nothing more. */
function createStore(seed: Record<string, string> = {}): ProfileStorage & {
  snapshot(): Record<string, string>;
} {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    get: (k) => map.get(k) ?? null,
    set: (k, v) => void map.set(k, v),
    snapshot: () => Object.fromEntries(map),
  };
}

/** A quiet frame, with only what the moment being played needs. */
function sig(over: Partial<OnboardingSignals> = {}): OnboardingSignals {
  return { nearAsteroid: false, cargo: 0, cargoCap: 2, ...over };
}

/** The station/ship numbers a purchase moves, as the HUD reads them. */
function facts(over: Partial<SpendFacts> = {}): SpendFacts {
  return { coreHp: 100, turrets: 0, shields: 0, satellites: 0, upgradeTiers: 0, ...over };
}

/** One match, as a list of `(what happened, which prompt was on screen)`. */
function playMatch(
  ob: Onboarding,
  beats: ReadonlyArray<readonly [string, OnboardingSignals]>,
): Array<{ beat: string; prompt: PromptId | null }> {
  return beats.map(([beat, signals]) => ({ beat, prompt: ob.update(signals) }));
}

const storage = createStore();

// --- Match 1: the first match IS the tutorial (GDD §2.10). -------------------
const first = new Onboarding(createProfileOnboardingMemory(storage));

// The SPEND half, played out on its own so the two presses are legible: the
// refused one must leave the prompt up, the landed one must retire it.
const beforeRefused = facts({ coreHp: 60 });
const afterRefused = facts({ coreHp: 60 }); // the sim moved nothing: 2 ore, no turret
const afterBought = facts({ coreHp: 60, turrets: 1 }); // the turret is queued

const matchOne = playMatch(first, [
  ['near a rock, nothing mined', sig({ nearAsteroid: true })],
  ['mined a chunk', sig({ nearAsteroid: true, cargo: 1 })],
  ['hold full', sig({ cargo: 2, cargoCap: 2 })],
  ['drained in the collection field', sig({ cargo: 0, cargoCap: 2 })],
  ['wheel opened for the first time', sig({ wheelOpen: true })],
  [
    'confirmed TURRET with 2 ore — the sim refused it',
    sig({ wheelOpen: true, hasSpent: oreWasSpent(beforeRefused, afterRefused) }),
  ],
  [
    'bought a turret — the sim took the ore',
    sig({ wheelOpen: true, hasSpent: oreWasSpent(beforeRefused, afterBought) }),
  ],
  ['the alarm sounds', sig({ underAttack: true })],
  ['the siege is survived', sig({ underAttack: false })],
]);

const afterMatchOne = {
  storage: storage.snapshot(),
  onboarded: loadProfile(storage).onboarded ?? [],
  allCompleted: first.allCompleted(),
};

// --- EXIT TO MENU → match 2. `window.location.assign` navigates, so the Hud and
//     the Onboarding inside it are built from scratch off the same storage. ----
const second = new Onboarding(createProfileOnboardingMemory(storage));
const matchTwo = playMatch(second, [
  ['near a rock, empty hold', sig({ nearAsteroid: true })],
  ['hold full', sig({ cargo: 2, cargoCap: 2 })],
  ['wheel opened', sig({ wheelOpen: true })],
  ['under attack', sig({ underAttack: true })],
  ['every trigger at once', sig({ nearAsteroid: true, cargo: 2, cargoCap: 2, wheelOpen: true, underAttack: true })],
]);

// --- A reload: a new page, a new store object, the same bytes on disk. --------
const reloadedStore = createStore(storage.snapshot());
const third = new Onboarding(createProfileOnboardingMemory(reloadedStore));
const matchThree = playMatch(third, [
  ['near a rock, empty hold', sig({ nearAsteroid: true })],
  ['wheel opened', sig({ wheelOpen: true })],
  ['under attack', sig({ underAttack: true })],
]);

// --- And the career it is stored beside is untouched. ------------------------
const careerStore = createStore({
  [PROFILE_KEY]: JSON.stringify({ v: 1, xp: 4211, level: 4, matches: 7 }),
});
const careerBefore = loadProfile(careerStore);
const careerOnboarding = new Onboarding(createProfileOnboardingMemory(careerStore));
careerOnboarding.update(sig({ nearAsteroid: true, cargo: 1 })); // learns to mine
const careerAfter = loadProfile(careerStore);

console.log(
  JSON.stringify(
    {
      what: 'onboarding completion persists through the ONE career profile (u15-01, a0-19 G-3)',
      matchOne,
      afterMatchOne,
      matchTwo: { beats: matchTwo, everyPromptNull: matchTwo.every((b) => b.prompt === null) },
      matchThreeAfterReload: {
        beats: matchThree,
        everyPromptNull: matchThree.every((b) => b.prompt === null),
      },
      careerIsUntouched: { before: careerBefore, after: careerAfter },
    },
    null,
    2,
  ),
);
