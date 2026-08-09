/**
 * evidence/p1-01-profile-store/readback.ts — the profile store's four load paths,
 * read back off a real storage seam.
 *
 *   npx vite-node evidence/p1-01-profile-store/readback.ts > evidence/p1-01-profile-store/readback.json
 *
 * The brief (`docs/briefs/pr-01-profile-store.md`, §Evidence line) asks for the
 * **backup** case shown as a before/after of the two storage keys, "because that
 * is the one a reviewer cannot take on trust". So this prints both keys before
 * and after every path — including the ones where the backup is deliberately NOT
 * written, since "empty is not corrupt" is the same promise seen from the other
 * side.
 *
 * It imports the shipped module (`src/progression/profile.ts`) rather than
 * restating it, and drives it through the same two-method seam the game does. No
 * `localStorage`, no `window` — this runs in node.
 */

import {
  PROFILE_BACKUP_KEY,
  PROFILE_KEY,
  PROFILE_VERSION,
  loadProfile,
  saveProfile,
  type Profile,
  type ProfileStorage,
} from '../../src/progression/profile';
import { xpToReach } from '../../src/progression/curve';

/** The seam, in memory — structurally `platform.storage` and nothing more. */
function memoryStorage(seed: Record<string, string> = {}): ProfileStorage & { snapshot(): Record<string, string | null> } {
  const map = new Map(Object.entries(seed));
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => void map.set(key, value),
    snapshot: () => ({
      [PROFILE_KEY]: map.get(PROFILE_KEY) ?? null,
      [PROFILE_BACKUP_KEY]: map.get(PROFILE_BACKUP_KEY) ?? null,
    }),
  };
}

interface Case {
  readonly path: string;
  readonly note: string;
  readonly seed: Record<string, string>;
}

/** A career worth losing: level 6, twenty matches deep. */
const CAREER: Profile = { v: 1, xp: xpToReach(6), level: 6, matches: 20 };

const CASES: readonly Case[] = [
  {
    path: '1. current version',
    note: 'reads straight back; nothing is written and nothing is backed up',
    seed: { [PROFILE_KEY]: JSON.stringify(CAREER) },
  },
  {
    path: '2. older known version (migrate)',
    note: 'v:0 walks the ladder to v:1 — the numbers survive, so nothing is backed up',
    seed: { [PROFILE_KEY]: JSON.stringify({ ...CAREER, v: 0 }) },
  },
  {
    path: '3. absent',
    note: 'a fresh profile; the reader writes NOTHING — an empty store is not a corrupt one',
    seed: {},
  },
  {
    path: '4a. unparseable (truncated write)',
    note: 'THE BACKUP CASE — the raw blob is copied verbatim BEFORE the fold',
    seed: { [PROFILE_KEY]: JSON.stringify(CAREER).slice(0, 28) },
  },
  {
    path: '4b. parseable but invalid',
    note: 'same rule: a career this reader cannot use is preserved, not dropped',
    seed: { [PROFILE_KEY]: JSON.stringify({ ...CAREER, xp: 'lots' }) },
  },
  {
    path: '4c. newer version (v:2 from a future build)',
    note: 'folds without throwing, and is KEPT — a future build may know what it is',
    seed: { [PROFILE_KEY]: JSON.stringify({ ...CAREER, v: 2, prestige: 3 }) },
  },
];

const loads = CASES.map((c) => {
  const store = memoryStorage(c.seed);
  const before = store.snapshot();
  const profile = loadProfile(store);
  const after = store.snapshot();
  return {
    path: c.path,
    note: c.note,
    before,
    read: profile,
    after,
    backedUp: after[PROFILE_BACKUP_KEY] !== null,
    /** The clause the brief singles out: the backup is the ORIGINAL, byte for
     *  byte. `null` where no backup was written — there is nothing to compare,
     *  and a bare `false` there would read as a failure rather than an absence. */
    backupIsVerbatim:
      after[PROFILE_BACKUP_KEY] === null ? null : after[PROFILE_BACKUP_KEY] === before[PROFILE_KEY],
  };
});

// The write guard, shown the same way: a non-finite xp `JSON.stringify`s to
// `null`, so an unguarded write would put a blob on disk that the next boot
// cannot read. Here the write is refused and the stored career is untouched.
const guardStore = memoryStorage();
saveProfile(guardStore, CAREER);
const guardBefore = guardStore.snapshot();
const accepted = saveProfile(guardStore, { ...CAREER, xp: Number.NaN });
const guardAfter = guardStore.snapshot();

console.log(
  JSON.stringify(
    {
      what: 'src/progression/profile.ts — the four load paths and the write guard, off a real seam',
      brief: 'docs/briefs/pr-01-profile-store.md',
      profileVersion: PROFILE_VERSION,
      keys: { profile: PROFILE_KEY, backup: PROFILE_BACKUP_KEY },
      loads,
      writeGuard: {
        note: 'saveProfile never writes a blob loadProfile would reject',
        wouldHaveWritten: JSON.stringify({ ...CAREER, xp: Number.NaN }),
        accepted,
        before: guardBefore,
        after: guardAfter,
        careerSurvived: JSON.stringify(loadProfile(guardStore)) === JSON.stringify(CAREER),
      },
    },
    null,
    2,
  ),
);
