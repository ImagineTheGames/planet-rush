/**
 * src/progression/profile.ts — the local career profile. OWNER: Platform
 * Engineer + UI Engineer (brief `docs/briefs/pr-01-profile-store.md`; plan
 * `docs/progression-plan.md` §2.1; GDD §4.1 — the `platform.ts` seam).
 *
 * The **first structured, post-match-mutated thing the game persists**. Every
 * other persisted value today is a bare string under a flat `planet-rush:*` key
 * — fire mode, control scheme, hull, name, map, haptics — read defensively and
 * folded to a safe default when it is missing or corrupt (`readFireMode`,
 * `readControlScheme`, `readMapId`, `src/main.ts`). A career record is the first
 * payload that needs a **version**, and this module establishes that convention.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS LOAD-BEARING OUT OF PROPORTION TO ITS SIZE
 * ---------------------------------------------------------------------------
 * **Progression is never wiped** — the developer's own ruling, 2026-08-07,
 * verbatim: *"no."* There is no reset button and this module must not add one.
 * That single answer removes the escape hatch every other persisted value in
 * this game has (*if it breaks, clear it*), which means **migration is the only
 * repair tool this profile will ever have**. So:
 *
 *  - `v` is written on the FIRST save and validated on every read;
 *  - a blob this reader cannot use is **copied verbatim to
 *    {@link PROFILE_BACKUP_KEY} before** the fresh profile replaces it — the one
 *    clause that stands between a schema bug and a wiped career the player was
 *    promised would never be wiped;
 *  - a **newer** blob (`v: 2` from a future build) folds rather than throwing,
 *    and is preserved by the same backup rule;
 *  - the migration ladder moves a blob **one version per rung**, so the oldest
 *    profiles keep migrating after `v: 2` ships rather than quietly falling off
 *    the only repair path they have (see `MIGRATIONS`);
 *  - **nothing invalid is ever written**: {@link saveProfile} runs the reader
 *    over a profile before it stores it, because `JSON.stringify` writes `NaN`
 *    as `null` and a career lost that way is lost on a *later* boot, far from
 *    the bug that caused it.
 *
 * ---------------------------------------------------------------------------
 * WHAT MAY AND MAY NOT LIVE IN HERE
 * ---------------------------------------------------------------------------
 * **Nothing device-specific, ever.** No screen size, no input scheme, no install
 * id, no "last map" — those are *settings* and already have their own flat keys.
 * The test (plan §2.1): *would this number still be true if the player picked up
 * a different phone and signed in?* If not, it is not a profile field. A later
 * backend must be a **sync** problem, not a rewrite.
 *
 * The storage seam is **injected**, exactly like `createBrowserHaptics(
 * platform.storage)` (`src/main.ts`) — so this module tests headless and never
 * touches a browser global. It imports nothing from `src/sim/`: the simulation
 * must never read the profile (determinism, GDD §4.8).
 */

import { levelForXp } from './curve';

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

/**
 * The string key/value store this module persists through — structurally
 * `platform.storage` (`src/platform/platform.ts`), which is `get`/`set` and
 * **nothing else**: the seam has no `remove` and no `keys`, and this module does
 * not need them (plan §2.1 leaves `remove` to pr-06).
 *
 * Named `ProfileStorage` rather than `Storage` — the brief's spelling — for one
 * reason: `Storage` is a DOM lib global, and a local interface by that name
 * shadows it silently for every reader of this file. The shape is identical, so
 * `platform.storage` passes straight in.
 */
export interface ProfileStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

// ---------------------------------------------------------------------------
// The shape
// ---------------------------------------------------------------------------

/** The schema version this build reads and writes. */
export const PROFILE_VERSION = 1;

/**
 * The player's career, as one versioned blob (plan §2.1).
 *
 * `level` is **derived** from `xp` (`src/progression/curve.ts` `levelForXp`) and
 * cached here for the UI; the accrual write site (pr-04) is what keeps them in
 * step, and a reader that finds them disagreeing **trusts `xp` and rebuilds the
 * cache** — see {@link validateProfile}. This is the only field on the shape that
 * is not authoritative, and the only one a reader is allowed to overrule.
 */
export interface Profile {
  /** Schema version — the first versioned payload in the store. */
  readonly v: 1;
  /** Lifetime XP. */
  readonly xp: number;
  /** Derived from `xp`, cached for the UI. */
  readonly level: number;
  /** Lifetime matches played. */
  readonly matches: number;
  /**
   * Cosmetic ids the player has earned. **Phase 2**, and absent in phase 1 —
   * with cosmetics shipping as a level→unlock LIST rather than a tree (plan §4),
   * this array is a *cache* of something derivable from `level` alone, so a
   * corrupt profile cannot lose a player their unlocks.
   */
  readonly unlocked?: readonly string[];
  /**
   * The cosmetic the player has **equipped** in each slot, by slot id (a0-14).
   *
   * Unlocking and equipping are different verbs: a level *unlocks* a livery and
   * the player then *equips* it, so the choice is a stored fact and not a
   * derivation. Slot ids are the hangar's (`src/ui/hangar.ts` `COSMETIC_SLOTS`)
   * and every one of them is silhouette-safe by construction — see that file for
   * why the boundary lives in the contract rather than in the content.
   */
  readonly equipped?: Readonly<Record<string, string>>;
}

/** The flat key the profile lives under — the same `planet-rush:` prefix every
 *  other persisted value uses. ONE profile, ONE key, ONE reader. */
export const PROFILE_KEY = 'planet-rush:profile';

/**
 * Where a blob this reader could not use is preserved, verbatim, before it is
 * replaced. Not a second profile and never read back by this module: it is the
 * evidence a future migration works from, and it exists because no reset ships.
 */
export const PROFILE_BACKUP_KEY = 'planet-rush:profile.bak';

/** A brand-new career: level 1, nothing earned, nothing played. */
export function freshProfile(): Profile {
  return { v: PROFILE_VERSION, xp: 0, level: 1, matches: 0 };
}

// ---------------------------------------------------------------------------
// Defensive reading — the `readMapId` discipline, field by field
// ---------------------------------------------------------------------------

/** A finite, non-negative number, rounded down — or `null` if the value cannot
 *  be one. `NaN`, `Infinity`, `-1` and `"12"` all fail here rather than reaching
 *  a level curve or a progress bar. */
function asCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

/** A level: a count, but never below 1 — level 0 is not a thing a player can be.
 *  This decides whether the field is *well-formed*; the value that survives into
 *  the profile is rebuilt from `xp` (see {@link validateProfile}). */
function asLevel(value: unknown): number | null {
  const n = asCount(value);
  return n === null ? null : Math.max(1, n);
}

function asIdArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

function asEquipped(value: unknown): Readonly<Record<string, string>> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [slot, id] of Object.entries(value as Record<string, unknown>)) {
    if (typeof id === 'string' && id.length > 0) out[slot] = id;
  }
  return out;
}

/**
 * A parsed blob validated as a `v: 1` profile, or `null` if it is not one.
 *
 * Every field is checked; nothing is blanket-cast. A blob that is *shaped* like
 * a profile but carries `xp: "lots"` is not a profile, and folding it silently
 * would be the schema bug this module exists to survive.
 */
export function validateProfile(raw: unknown): Profile | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const blob = raw as Record<string, unknown>;
  if (blob['v'] !== PROFILE_VERSION) return null;
  const xp = asCount(blob['xp']);
  const level = asLevel(blob['level']);
  const matches = asCount(blob['matches']);
  if (xp === null || level === null || matches === null) return null;
  // `level` is a CACHE of `xp` (plan §2.1: "derived from xp, cached for the UI"),
  // so where the two disagree the source wins and the cache is rebuilt. Without
  // this the cache can drift permanently — no reset ships, so a level written
  // wrong once by an accrual bug, or left behind by a curve QA re-tuned, is a
  // wrong badge in the lobby for the life of the profile. Recomputing costs a
  // bounded walk (`levelForXp`) on one read at the front door.
  //
  // Only a *well-formed* level is repaired this way. A junk one (`null`, `"5"`,
  // `NaN`) still folds the whole blob above, because a payload that malformed is
  // not one this reader should be mining a career out of — the brief's corrupt
  // case says so, and a fold is preserved by the backup rule anyway.
  const derived = levelForXp(xp);
  const unlocked = blob['unlocked'] === undefined ? null : asIdArray(blob['unlocked']);
  const equipped = blob['equipped'] === undefined ? null : asEquipped(blob['equipped']);
  return {
    v: PROFILE_VERSION,
    xp,
    level: derived,
    matches,
    // `exactOptionalPropertyTypes` — an absent field is absent, not `undefined`.
    ...(unlocked ? { unlocked } : {}),
    ...(equipped ? { equipped } : {}),
  };
}

// ---------------------------------------------------------------------------
// Migration — the only repair tool this profile will ever have
// ---------------------------------------------------------------------------

/**
 * The migration **ladder**: one rung per version, each carrying a blob exactly
 * ONE version forward. Keyed by the `v` it consumes, so `MIGRATIONS[n]` returns
 * a `v: n + 1` blob.
 *
 * It ships with **one rung** — `v: 0`, a shape that never existed in a released
 * build — deliberately: the path is live, tested and exercised from day one
 * rather than written for the first time on the day a real migration is needed.
 *
 * **One rung per version, never a rung straight to current.** A rung that jumped
 * to {@link PROFILE_VERSION} would read correctly today and rot silently the day
 * `v: 2` ships: the `v: 0` rung would stamp `v: 2` onto a shape that never met
 * `v: 2`'s rules, and the oldest profiles in the world — the ones with the most
 * career in them — would fold to fresh while the newer ones migrated fine. That
 * is the failure this module exists to prevent, arriving through its own repair
 * tool. With single steps, adding `v: 2` means adding rung `1` and changing
 * nothing else, and {@link migrate} walks 0 → 1 → 2 on its own.
 *
 * `profile.test.ts` asserts the ladder has **no gaps** — a rung for every version
 * in `[0, PROFILE_VERSION)` — so bumping the version without adding one is a red
 * test, not a silently unreachable career.
 */
const MIGRATIONS: Readonly<Record<number, (raw: Record<string, unknown>) => Record<string, unknown>>> = {
  // v0 → v1: an identity for a shape that never existed. The version stamp is
  // the whole migration, and that is the point — the walk below is what is being
  // proven, not this rung's arithmetic.
  0: (raw) => ({ ...raw, v: 1 }),
};

/** Every version {@link MIGRATIONS} can carry forward, lowest first — the test's
 *  handle on the ladder's shape. */
export const MIGRATABLE_VERSIONS: readonly number[] = Object.keys(MIGRATIONS)
  .map(Number)
  .sort((a, b) => a - b);

/**
 * Migrate a parsed blob from a **known older** version to the current one, or
 * `null` when there is no route (an unknown version, a newer one, or a shape
 * that fails validation once it arrives).
 *
 * Walks the ladder one rung at a time and validates **once, at the top**: an
 * intermediate shape is not a `Profile` and must not be judged as one, or every
 * future rung would have to leave the blob valid under a schema it is only
 * passing through.
 *
 * Exported because it is a seam, not an implementation detail: a lane adding
 * `v: 2` extends {@link MIGRATIONS} and tests through this function.
 */
export function migrate(raw: unknown): Profile | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  let blob = raw as Record<string, unknown>;
  const version = blob['v'];
  if (typeof version !== 'number' || !Number.isFinite(version)) return null;
  if (version >= PROFILE_VERSION) return null; // current is not a migration; newer has no route back

  for (let v = version; v < PROFILE_VERSION; v++) {
    const rung = MIGRATIONS[v];
    if (!rung) return null; // a gap in the ladder — no route, and nothing is guessed
    blob = rung(blob);
  }
  return validateProfile(blob);
}

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------

/**
 * The stored profile, or a fresh one.
 *
 * Three paths, and all three are implemented here or the fourth happens by
 * accident (plan §2.1):
 *
 *  1. **Current version** → validate and read.
 *  2. **Older known version** → {@link migrate} forward, then read.
 *  3. **Absent** → a fresh profile, and nothing is written or backed up: an
 *     empty store is not a corrupt one.
 *  4. **Unparseable / invalid / newer** → the raw string is copied verbatim to
 *     {@link PROFILE_BACKUP_KEY} **first**, then a fresh profile is returned.
 *
 * Never throws. A profile is read on the front door of the game; a reader that
 * could throw would be a boot that a stray character in the store can stop.
 */
export function loadProfile(storage: ProfileStorage): Profile {
  const raw = storage.get(PROFILE_KEY);
  if (raw === null) return freshProfile();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return preserve(storage, raw);
  }

  const current = validateProfile(parsed);
  if (current) return current;

  const migrated = migrate(parsed);
  if (migrated) return migrated;

  // Unknown, newer, or invalid. Keep it — a future build may know what it is.
  return preserve(storage, raw);
}

/** Copy a blob this reader could not use out of harm's way, then fold. The
 *  backup is written before anything replaces the profile, which is the whole
 *  point of it. */
function preserve(storage: ProfileStorage, raw: string): Profile {
  storage.set(PROFILE_BACKUP_KEY, raw);
  return freshProfile();
}

/**
 * Persist a profile. `JSON.stringify` on write, because the seam holds strings
 * only; the version rides with it, on the first write and every one after.
 *
 * **The write is validated with the same reader that will read it back**, and a
 * profile that fails is NOT written — `false` comes back and the stored career
 * is left exactly as it was.
 *
 * That guard is not defensive decoration; it closes the one hole the read side
 * cannot. `JSON.stringify` turns `NaN` and `Infinity` into `null` without a
 * murmur, so an accrual bug at the single write site (pr-04 — `xp += gain` with
 * a `gain` that went non-finite) puts `{"xp":null}` on disk, and the *next* boot
 * reads a blob no version of this reader can accept. The backup key means that
 * career is recoverable rather than gone — but recoverable-by-hand is not the
 * promise the developer made, and the player still opens the game at level 1.
 * One `validateProfile` call before `set` turns a permanent career loss into a
 * write that did not happen.
 *
 * The invariant, asserted in the tests: **`saveProfile` never writes a blob
 * `loadProfile` would reject.** A caller that wants to know may check the return;
 * one that does not is still safe, which is why this is a guard and not a throw.
 * A profile is written on the front door's way out — a throw there loses the
 * match that was just played.
 *
 * There is deliberately no `clearProfile` here and there must never be one — see
 * the header, and plan §Q4.
 *
 * @returns `true` if the profile was persisted, `false` if it was refused.
 */
export function saveProfile(storage: ProfileStorage, profile: Profile): boolean {
  if (validateProfile(profile) === null) return false;
  storage.set(PROFILE_KEY, JSON.stringify(profile));
  return true;
}
