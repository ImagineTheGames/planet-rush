/**
 * src/platform/build-stamp.ts — the BUILD-TIME half of build identity.
 * OWNER: Platform Engineer.
 *
 * **Node-side only.** This module runs inside `vite.config.ts` (build/dev server
 * boot), never in the browser bundle: it shells out to git and speaks Rollup's
 * plugin protocol. Its client-side counterpart is `build-info.ts`, which owns the
 * `BuildInfo` shape and every string a human reads.
 *
 * Two jobs:
 *
 *   - {@link readGitStamp} — probe git for the short HEAD sha and whether the
 *     working tree is dirty, producing the {@link BuildInfo} that
 *     {@link defineBuildInfo} injects as the `__BUILD_INFO__` define.
 *   - {@link versionJsonPlugin} — emit `version.json` (`{ sha, time }`) into the
 *     build output, which the studio dashboard polls for live-build freshness.
 *
 * Both are pure functions of injected dependencies (a git runner, a clock), so
 * the whole thing unit-tests without a repo, a build, or a filesystem.
 *
 * **Never fails a build.** A tarball checkout with no `.git`, a CI image without
 * the git binary, a shallow clone — every failure path degrades to the same
 * documented fallback (`sha: 'dev'`, dirty) rather than throwing. A missing
 * build stamp is an annoyance; a broken build is an outage.
 */
import { execFileSync } from 'node:child_process';
import { resolveBuildInfo, toVersionManifest, SHA_LENGTH } from './build-info';
import type { BuildInfo, VersionManifest } from './build-info';

/** Runs `git` with `args` and returns stdout; throws if git fails or is absent. */
export type GitRunner = (args: readonly string[]) => string;

/** The real runner: synchronous (config load is synchronous) and argv-based, so
 *  nothing is passed through a shell. */
export const execGit: GitRunner = (args) =>
  execFileSync('git', args as string[], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/** Environment names consulted when git itself is unavailable — CI (GitHub
 *  Actions sets `GITHUB_SHA`) still knows the commit it is building. */
export const SHA_ENV_KEYS = ['VITE_BUILD_SHA', 'GITHUB_SHA'] as const;

/** Injectable deps for {@link readGitStamp} (all defaulted in production use). */
export interface StampOptions {
  readonly git?: GitRunner;
  readonly env?: Record<string, string | undefined>;
  readonly now?: () => Date;
}

/**
 * Probe the build's identity: short HEAD sha, ISO build time, dirty flag.
 *
 * `git status --porcelain` is the dirty test — non-empty output means the tree
 * carries changes that are in the bundle but not in the sha, which is exactly
 * the case the badge's `*` warns about. When git can't answer, fall back to a CI
 * env sha (still clean-ish information: a CI build is a checkout, so it is
 * reported clean), and finally to the `'dev'` identity.
 */
export function readGitStamp(opts: StampOptions = {}): BuildInfo {
  const git = opts.git ?? execGit;
  const env = opts.env ?? process.env;
  const now = opts.now ?? ((): Date => new Date());
  const time = now().toISOString();

  try {
    const sha = git(['rev-parse', `--short=${SHA_LENGTH}`, 'HEAD']).trim();
    if (sha === '') throw new Error('empty sha');
    const dirty = git(['status', '--porcelain']).trim() !== '';
    return { sha, time, dirty };
  } catch {
    const envSha = firstEnvSha(env);
    if (envSha) return { sha: envSha, time, dirty: false };
    // No git, no CI sha: the documented dev fallback (build-info.ts).
    return resolveBuildInfo(undefined, () => new Date(time));
  }
}

/** The first non-empty {@link SHA_ENV_KEYS} value, truncated to a short sha. */
function firstEnvSha(env: Record<string, string | undefined>): string | null {
  for (const key of SHA_ENV_KEYS) {
    const raw = env[key]?.trim();
    if (raw) return raw.slice(0, SHA_LENGTH);
  }
  return null;
}

/**
 * The Vite `define` map that injects the stamp into the client bundle as the
 * `__BUILD_INFO__` global (declared in `build-info.ts`). Values must be strings
 * — Vite substitutes them as source text — hence the `JSON.stringify`.
 */
export function defineBuildInfo(info: BuildInfo): Record<string, string> {
  return { __BUILD_INFO__: JSON.stringify(info) };
}

// ---------------------------------------------------------------------------
// The version.json plugin
// ---------------------------------------------------------------------------

/** File name emitted at the root of the build output. Contract with the studio
 *  dashboard: it fetches `<base>version.json` to show live-build freshness. */
export const VERSION_FILE = 'version.json';

/** The slice of Rollup's `PluginContext` this plugin uses (structurally
 *  satisfied by the real one — typed locally so tests need no rollup import). */
export interface EmitFileContext {
  emitFile(file: { type: 'asset'; fileName: string; source: string }): unknown;
}

/** The plugin object handed to Vite's `plugins` array. Shape is asserted in
 *  `build-stamp.test.ts` — the dashboard depends on it. */
export interface VersionJsonPlugin {
  readonly name: 'planet-rush:version-json';
  /** Build-only: nothing to emit for a dev server (no output directory). */
  readonly apply: 'build';
  generateBundle(this: EmitFileContext): void;
}

/**
 * A small Vite/Rollup plugin that writes `version.json` (`{ sha, time }`) beside
 * the bundle. Emitted through `emitFile` rather than written directly so it
 * lands in whatever `outDir` the build is using and is cleaned with it.
 */
export function versionJsonPlugin(info: BuildInfo): VersionJsonPlugin {
  return {
    name: 'planet-rush:version-json',
    apply: 'build',
    generateBundle(this: EmitFileContext): void {
      this.emitFile({ type: 'asset', fileName: VERSION_FILE, source: versionJsonSource(info) });
    },
  };
}

/** The exact bytes written to `version.json` — newline-terminated so the file
 *  is well-formed for `curl`/`cat` and diffs cleanly. */
export function versionJsonSource(info: BuildInfo): string {
  const manifest: VersionManifest = toVersionManifest(info);
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
