/**
 * tests/server/docker-context.test.ts — every directory the server's build needs
 * must actually be in its Docker build context. OWNER: Netcode Engineer
 * (GDD §4.2, risk 1 — "the server ships as a plain Dockerized Node process").
 *
 * **The bug this exists for (M10 join-pin regression).** The socket-hop
 * machine-pin (`server/upgrade-router.ts`) builds its `fly-replay` directive with
 * the allocator's own `FlyReplayRouter` — `import { FlyReplayRouter } from
 * '../allocator/router'`. `server/Dockerfile` copied `src/`, `content/` and
 * `server/` and **not** `allocator/`, so from the commit that introduced the pin
 * onward the image failed at `npx tsc --noEmit` with
 *
 *     server/upgrade-router.ts: Cannot find module '../allocator/router'
 *
 * Every `flyctl deploy --config fly.gameserver.toml` failed from there. The
 * *allocator* app kept deploying fine (its Dockerfile does copy what it needs), so
 * the fleet ran a half-updated pair: a current allocator handing out the shared
 * `connectUrl`, and gameserver Machines still running a PRE-PIN image that had
 * never seen `MATCH_ROUTER = "fly"` (an env change only reaches a Machine through
 * a deploy). Result: the pin was correct in the repository, absent in production,
 * and the wrong-Machine coin flip kept answering `joinError: bad-ticket` — a stuck
 * "connecting" screen for a defect no unit test could see, because every unit test
 * ran against sources that were all present on disk.
 *
 * So this test reads the Dockerfiles and the sources together and asserts the one
 * thing neither can state alone: **every directory a build stage's own sources
 * import from is a directory that stage COPYs.** It is the same class of guard as
 * `./fleet-config.test.ts` — a config file and a code file that must agree, with
 * nothing but a live deploy to notice when they stop.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';

/** The repository root, resolved from this file so the cwd never matters. */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Read a repo-relative file. */
function repoFile(name: string): string {
  return readFileSync(join(ROOT, name), 'utf8');
}

/**
 * The top-level directories (and files) a Dockerfile's *build* stage copies in
 * from the repository. `COPY --from=…` lines are stage-to-stage plumbing, not
 * build context, and are skipped.
 */
function contextRoots(dockerfile: string): Set<string> {
  const roots = new Set<string>();
  for (const line of dockerfile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.toUpperCase().startsWith('COPY ')) continue;
    if (trimmed.includes('--from=')) continue;
    // `COPY <src…> <dest>` — every argument but the last is a source path.
    const args = trimmed.slice('COPY '.length).trim().split(/\s+/);
    for (const source of args.slice(0, -1)) roots.add(source.replace(/^\.\//, ''));
  }
  return roots;
}

/** Every `.ts` file under `dir`, excluding tests and build output. */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      if (entry === 'dist' || entry === 'node_modules') continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) found.push(full);
    }
  };
  walk(join(ROOT, dir));
  return found;
}

/** Every module specifier a file imports (static `import`/`export … from`, plus
 *  dynamic `import(…)`). A regex is enough here: these are our own files, written
 *  in one house style, and a specifier this misses can only ever *under*-report —
 *  it cannot invent a dependency that is not there. */
function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) specifiers.push(match[1]!);
  return specifiers;
}

/**
 * The repo-relative top-level path a specifier reaches into, or `null` when it
 * stays inside `dir` (or is a bare package name — those come from `npm ci`, and
 * `node:` builtins from Node itself).
 *
 * `@shared/*` is the tsconfig alias for `src/shared/*` (see `tsconfig.json`), so
 * it counts as a dependency on `src/` exactly like a relative path would.
 */
function externalRoot(dir: string, file: string, specifier: string): string | null {
  if (specifier.startsWith('@shared/')) return 'src';
  if (!specifier.startsWith('.')) return null; // a package, or `node:` — not our tree
  const target = normalize(resolve(dirname(file), specifier));
  const fromRoot = relative(ROOT, target);
  const top = fromRoot.split(sep)[0]!;
  return top === dir ? null : top;
}

/** Every repo directory the sources under `dir` import from, `dir` itself aside. */
function crossDirectoryDeps(dir: string): Map<string, string[]> {
  const deps = new Map<string, string[]>();
  for (const file of sourceFiles(dir)) {
    for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
      const top = externalRoot(dir, file, specifier);
      if (top === null) continue;
      const witnesses = deps.get(top) ?? [];
      witnesses.push(`${relative(ROOT, file)} → ${specifier}`);
      deps.set(top, witnesses);
    }
  }
  return deps;
}

/** The two images the fleet deploys, each with the sources it is built from. */
const IMAGES = [
  { name: 'the gameserver', dockerfile: 'server/Dockerfile', dir: 'server' },
  { name: 'the allocator', dockerfile: 'allocator/Dockerfile', dir: 'allocator' },
] as const;

describe('the Docker build context contains everything the build imports', () => {
  for (const image of IMAGES) {
    it(`${image.name} (${image.dockerfile}) COPYs every directory ${image.dir}/ imports from`, () => {
      const roots = contextRoots(repoFile(image.dockerfile));
      const deps = crossDirectoryDeps(image.dir);
      const missing = [...deps.entries()]
        .filter(([top]) => !roots.has(top))
        .map(([top, witnesses]) => `${top}/ (imported by ${witnesses[0]})`);
      // The message carries the witness, so a failure names the import to fix
      // rather than leaving the next person to find it the way this one was found:
      // a red deploy nobody was watching and a live join lottery.
      expect(missing, `${image.dockerfile} is missing COPY lines for: ${missing.join(', ')}`).toEqual(
        [],
      );
      // The stage must copy its own directory too, or there is nothing to build.
      expect(roots.has(image.dir)).toBe(true);
    });
  }

  it('the gameserver image copies allocator/ — the pin import that broke the deploy (M10)', () => {
    // Named on its own rather than left implicit in the sweep above, because this
    // is the concrete regression: `server/upgrade-router.ts` reuses the allocator's
    // FlyReplayRouter, and without these sources the image does not build.
    expect(crossDirectoryDeps('server').has('allocator')).toBe(true);
    expect(contextRoots(repoFile('server/Dockerfile')).has('allocator')).toBe(true);
  });
});
