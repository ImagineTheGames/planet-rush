/**
 * src/ui/onboarding-memory.ts — where onboarding remembers you. OWNER: UI.
 *
 * GDD §2.10: the prompts *"never appear again after each is completed once."*
 * Until u15-01 that lasted one page load — `Onboarding` lives inside the `Hud`,
 * EXIT TO MENU is a full navigation, and the second match taught the game from
 * scratch (a0-19 gap G-3, half A).
 *
 * This is the whole of the fix's storage half: the {@link OnboardingMemory} port
 * that {@link ./onboarding} declares, implemented over the ONE career profile
 * `p1-01` shipped (`src/progression/profile.ts`). It is one file and not a line
 * inside the state machine on purpose — that module is pure and DOM-free, which
 * is what lets the trigger contract test headless.
 *
 * **No second storage scheme.** The lesson goes in the profile beside XP and
 * level rather than under a twelfth flat `planet-rush:*` key, because it passes
 * the profile's own admission test (progression plan §2.1): *would this still be
 * true if the player picked up a different phone and signed in?* Yes — a player
 * who has learned that their gun is their mining tool has learned it. Fire mode
 * and control scheme are settings and stay flat keys; this is career.
 *
 * **Read-modify-write, every time.** `save` re-reads the profile immediately
 * before it writes, and never holds a copy from boot. There are two writers now
 * — `bankMatch` (XP, at the end of a match) and this one (a lesson, mid-match) —
 * and a held copy is exactly how a tutorial prompt rolls back a career the
 * developer promised is never wiped. One extra `localStorage` read, at most four
 * times in a player's life.
 *
 * A profile this build cannot read is folded by `loadProfile` (and preserved
 * under the backup key) before it gets here, so the worst a corrupt store can do
 * to onboarding is teach the game once more. That is the right failure: the
 * player sees four prompts, not a boot that throws on the front door.
 */

import { loadProfile, saveProfile } from '../progression/profile';
import type { ProfileStorage } from '../progression/profile';
import type { OnboardingMemory, PromptId } from './onboarding';

/**
 * The onboarding memory backed by the career profile.
 *
 * @param storage The same `platform.storage` seam everything else persists
 *   through (`src/platform/platform.ts`) — injected, so this tests headless and
 *   never touches a browser global.
 */
export function createProfileOnboardingMemory(storage: ProfileStorage): OnboardingMemory {
  return {
    load(): readonly string[] {
      return loadProfile(storage).onboarded ?? [];
    },
    save(completed: readonly PromptId[]): void {
      const current = loadProfile(storage);
      // `saveProfile` validates with the reader before it writes and refuses a
      // blob that would not read back (p1-01), so a bad set cannot cost a career.
      saveProfile(storage, { ...current, onboarded: [...completed] });
    },
  };
}
