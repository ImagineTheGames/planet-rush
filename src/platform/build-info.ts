/**
 * src/platform/build-info.ts — WHICH BUILD AM I PLAYING? OWNER: Platform Engineer.
 *
 * The developer's report: with a dev server, a Pages deploy, a preview build and
 * a phone all showing the same screen, there was no way to tell *which* build was
 * in front of you — a fixed bug looked unfixed because the phone was still on a
 * stale service-worker cache. This module is the fix: one build identity, stamped
 * at build time, surfaced everywhere a human or a tool might look.
 *
 * Four surfaces, one source of truth ({@link BUILD_INFO}):
 *
 *   1. **Build-time stamp** — `vite.config.ts` `define`s the `__BUILD_INFO__`
 *      global from git (see `build-stamp.ts`, the node-side half).
 *   2. **In-game badge** — the muted corner tag (`@render/build-badge`).
 *   3. **Boot console line** — `main.ts` logs {@link formatBootLine} once.
 *   4. **`version.json`** — emitted into the build output for the studio
 *      dashboard (the `version-json` vite plugin in `build-stamp.ts`).
 *   5. **`?debug=1`** — exposed on the read-only instrument (`debug-hook.ts`).
 *
 * This file is the **client-side** half: the typed declaration of the injected
 * global plus a safe fallback, so the module is import-safe anywhere — a `vite
 * dev` page with no define, a vitest run, a node import — and never throws a
 * ReferenceError on a missing global.
 */

/** The stamped identity of a build. Emitted verbatim into `version.json`
 *  (minus `dirty`) and injected as the `__BUILD_INFO__` define. */
export interface BuildInfo {
  /** Short git HEAD sha (7 chars), or `'dev'` when unknown/unstamped. */
  readonly sha: string;
  /** Build timestamp, ISO-8601 UTC (`new Date().toISOString()`). */
  readonly time: string;
  /** True when the working tree had uncommitted changes at build time. */
  readonly dirty: boolean;
}

/**
 * The build-time define, injected by `vite.config.ts`. Declared — never
 * imported — because Vite replaces the identifier textually at transform time.
 * Guarded with `typeof` at the single read below so an un-defined build (plain
 * `tsc`, a bare vitest run, a `<script type=module>` in a test page) falls back
 * instead of throwing.
 */
declare const __BUILD_INFO__: BuildInfo | undefined;

/** The dev/unknown sha — what a build with no git identity reports. */
export const DEV_SHA = 'dev';

/** Short-sha length used everywhere (git's own `--short` default width). */
export const SHA_LENGTH = 7;

/**
 * Coerce an unknown injected value into a {@link BuildInfo}, field by field, so
 * a partially-formed or absent define still yields a usable identity: an unknown
 * sha reads `'dev'`, an unknown time reads "now", and an unknown tree state is
 * assumed **dirty** (an unstamped build is, by definition, not a known commit —
 * better to over-report dirt than to let a working-tree build masquerade as a
 * clean one).
 *
 * Pure and injectable (`now`), so the fallback path is unit-testable without
 * touching the clock.
 */
export function resolveBuildInfo(raw: unknown, now: () => Date = () => new Date()): BuildInfo {
  const rec = typeof raw === 'object' && raw !== null ? (raw as Partial<Record<keyof BuildInfo, unknown>>) : undefined;
  const sha = typeof rec?.sha === 'string' && rec.sha.trim() !== '' ? rec.sha.trim() : DEV_SHA;
  const rawTime = rec?.time;
  const time = typeof rawTime === 'string' && isIsoTime(rawTime) ? rawTime : now().toISOString();
  // Only an explicit `false` clears the dirty flag; anything unknown stays dirty.
  const dirty = rec?.dirty !== false;
  return { sha, time, dirty };
}

/** True if `s` parses as a real instant (guards `"not a date"`, `""`, `"NaN"`). */
export function isIsoTime(s: string): boolean {
  return Number.isFinite(Date.parse(s));
}

/**
 * The live build identity. Read once at module load: the injected define when
 * present, the dev fallback otherwise (`{ sha: 'dev', time: now, dirty: true }`).
 */
export const BUILD_INFO: BuildInfo = resolveBuildInfo(
  typeof __BUILD_INFO__ === 'undefined' ? undefined : __BUILD_INFO__,
);

/**
 * The sha as humans should see it: a trailing `*` marks a build made from a
 * dirty working tree, so "my fix isn't in the build" and "my fix isn't saved"
 * are distinguishable at a glance. Used by both the badge and the boot line so
 * the two never disagree.
 */
export function displaySha(info: BuildInfo): string {
  return info.dirty ? `${info.sha}*` : info.sha;
}

/** `HH:MM` of an ISO instant, in **UTC** (the badge appends the `Z`). Returns
 *  `--:--` for an unparseable time rather than rendering `NaN:NaN`. */
export function formatUtcHhMm(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '--:--';
  const d = new Date(t);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/**
 * The in-game badge string: `"<sha> · <HH:MM>Z"` (dirty builds show `<sha>*`).
 * Deliberately tiny — the time is the disambiguator between two builds of the
 * same commit, and UTC so a phone and a laptop in different zones agree.
 */
export function formatBuildBadge(info: BuildInfo = BUILD_INFO): string {
  return `${displaySha(info)} · ${formatUtcHhMm(info.time)}Z`;
}

/** The one-line boot banner: `"Planet Rush build <sha> built <time>"`. */
export function formatBootLine(info: BuildInfo = BUILD_INFO): string {
  return `Planet Rush build ${displaySha(info)} built ${info.time}`;
}

/** The public `version.json` payload — exactly `{ sha, time }` (the studio
 *  dashboard's contract; `dirty` is a local-build detail and stays out). */
export interface VersionManifest {
  readonly sha: string;
  readonly time: string;
}

/** Project a {@link BuildInfo} onto the `version.json` manifest shape. */
export function toVersionManifest(info: BuildInfo): VersionManifest {
  return { sha: info.sha, time: info.time };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
