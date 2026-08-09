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
 *
 * **The half it used to miss (a1-04).** Until now the walk covered `server/` and
 * `allocator/` only — the two directories that *are* the two services — and not
 * `src/`, which both images COPY and both images COMPILE (`include: ["../src", …]`
 * in each image's tsconfig). So the exact failure above happened a second time
 * from the other side: `src/**` tests grew `import … from '../../harness/hash'`,
 * `harness/` is COPYd by neither image, and every `Deploy server (Fly.io)` run
 * failed at `docker build` for two days while `npx tsc --noEmit` stayed green on
 * every lane and on main (LESSONS §12). a1-03 fixed that instance by excluding
 * tests from both image tsconfigs — which closes the class for *test* files by
 * construction, since neither image compiles one now — but a **non-test** `src/`
 * file growing the same import was still caught only by a deploy, and a failed
 * deploy is invisible from the client: the fleet keeps serving the last image that
 * built.
 *
 * The walk is therefore driven by each image's **tsconfig** rather than by a
 * hand-kept directory list: the program the image typechecks is exactly the set of
 * files whose imports must resolve inside the image, so that is the set to sweep.
 * Widen an image's `include` and this test widens with it; narrow it and the test
 * narrows, so it can never fail for a file the image does not compile. The
 * scoping is checked in both directions — `it('scopes the walk …')` below asserts
 * the set really reaches `src/` and really excludes the tests, because a
 * self-scoping test that quietly scopes itself to nothing is worse than no test.
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

/** A path as the rest of this file wants it: repo-relative, `/`-separated. */
function repoPath(absolute: string): string {
  return relative(ROOT, absolute).split(sep).join('/');
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

/**
 * The tsconfigs are JSONC — they carry the comments that explain why their
 * `include`/`exclude` are shaped the way they are, and those comments are the
 * most load-bearing prose in the build (a1-03). Strip them without touching
 * anything inside a string literal, so a `//` in a comment's URL never eats a
 * closing brace.
 */
function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    const next = text[i + 1];
    if (inLine) {
      if (char === '\n') {
        inLine = false;
        out += char;
      }
      continue;
    }
    if (inBlock) {
      if (char === '*' && next === '/') {
        inBlock = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        i += 1;
      } else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === '/' && next === '/') {
      inLine = true;
      i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      inBlock = true;
      i += 1;
      continue;
    }
    out += char;
  }
  return out;
}

/** The parts of a tsconfig this test reads. */
interface TsConfig {
  include?: string[];
  exclude?: string[];
  compilerOptions?: { paths?: Record<string, string[]> };
}

function readTsConfig(name: string): TsConfig {
  return JSON.parse(stripJsonComments(repoFile(name))) as TsConfig;
}

/**
 * A tsconfig glob (`../src/**\/*.test.ts`) as a regular expression over
 * `/`-separated absolute paths. `**` spans any number of directories including
 * none; `*` and `?` stop at a separator, as they do for tsc.
 */
function globToRegExp(glob: string): RegExp {
  // One pass, so no intermediate placeholder can be chewed up by a later pass.
  const body = glob.replace(/[.+^${}()|[\]\\]|\*\*\/|\*\*|\*|\?/g, (token) => {
    if (token === '**/') return '(?:[^/]*/)*';
    if (token === '**') return '.*';
    if (token === '*') return '[^/]*';
    if (token === '?') return '[^/]';
    return `\\${token}`;
  });
  return new RegExp(`^${body}$`);
}

/** The file extensions tsc puts in a program. */
const COMPILED_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];

/** Every compilable file under `dir`, recursively. */
function filesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      if (entry === 'dist' || entry === 'node_modules') continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (COMPILED_EXTENSIONS.some((extension) => entry.endsWith(extension))) found.push(full);
    }
  };
  walk(dir);
  return found;
}

/**
 * The files an image's typecheck actually compiles: its tsconfig's `include`
 * minus its `exclude`, resolved from the tsconfig's own directory.
 *
 * This is the whole point of reading the config instead of listing directories
 * here. `include` is what must resolve inside the image; `exclude` is what a1-03
 * deliberately kept out of it. Both belong to the build, not to this test.
 */
/** Both programs span the whole of `src/`; walking it once per assertion is the
 *  difference between a test that runs in a second and one that runs in ten. */
const compiledFileCache = new Map<string, string[]>();

function compiledFiles(tsconfigName: string): string[] {
  const cached = compiledFileCache.get(tsconfigName);
  if (cached !== undefined) return cached;
  const files = readCompiledFiles(tsconfigName);
  compiledFileCache.set(tsconfigName, files);
  return files;
}

function readCompiledFiles(tsconfigName: string): string[] {
  const config = readTsConfig(tsconfigName);
  const base = dirname(join(ROOT, tsconfigName));
  const excluded = (config.exclude ?? []).map((glob) =>
    globToRegExp(resolve(base, glob).split(sep).join('/')),
  );
  const found = new Set<string>();
  for (const entry of config.include ?? []) {
    const target = resolve(base, entry);
    // A bare directory in `include` means "everything compilable under it"; a
    // bare filename means itself; anything with a wildcard is matched as a glob.
    const literal = !/[*?]/.test(entry);
    const files = literal
      ? statSync(target).isDirectory()
        ? filesUnder(target)
        : [target]
      : matchGlob(entry, base);
    for (const file of files) found.add(file);
  }
  return [...found]
    .filter((file) => !excluded.some((pattern) => pattern.test(file.split(sep).join('/'))))
    .sort();
}

/** `include` entries that are globs rather than plain directories. */
function matchGlob(entry: string, base: string): string[] {
  const pattern = globToRegExp(resolve(base, entry).split(sep).join('/'));
  // Anchor the search at the deepest literal directory prefix so a glob never
  // walks the whole repository.
  const literal = resolve(base, entry).split(sep);
  const stop = literal.findIndex((part) => /[*?]/.test(part));
  const anchor = literal.slice(0, stop === -1 ? literal.length - 1 : stop).join(sep) || ROOT;
  return filesUnder(anchor).filter((file) => pattern.test(file.split(sep).join('/')));
}

/**
 * The tsconfig path aliases, as a map from alias prefix to the top-level repo
 * directory it lands in — `@shared/` → `src`, and so on. Read from the root
 * config rather than hard-coded, so a new alias pointing at a new top-level
 * directory is swept the day it is added.
 */
function aliasRoots(): Map<string, string> {
  const paths = readTsConfig('tsconfig.json').compilerOptions?.paths ?? {};
  const roots = new Map<string, string>();
  for (const [alias, targets] of Object.entries(paths)) {
    const target = targets[0];
    if (!alias.endsWith('/*') || target === undefined) continue;
    roots.set(alias.slice(0, -1), target.split('/')[0]!);
  }
  return roots;
}

const ALIAS_ROOTS = aliasRoots();

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
 * The top-level repository directory a specifier reaches into, or `null` for a
 * bare package name — those come from `npm ci`, and `node:` builtins from Node
 * itself.
 *
 * A tsconfig alias (`@shared/*` → `src/shared/*`) counts exactly like the
 * relative path it stands for: the image needs the directory on disk either way.
 */
function importedRoot(file: string, specifier: string): string | null {
  for (const [prefix, root] of ALIAS_ROOTS) if (specifier.startsWith(prefix)) return root;
  if (!specifier.startsWith('.')) return null; // a package, or `node:` — not our tree
  const target = normalize(resolve(dirname(file), specifier));
  return repoPath(target).split('/')[0]!;
}

/**
 * Every top-level repository directory the given files import from, each with the
 * imports that witness it. Same-directory imports are included and cost nothing:
 * a stage always COPYs the directories it compiles, so they resolve trivially —
 * and stating the rule as "everything imported is copied" rather than "everything
 * imported from *elsewhere* is copied" means there is no notion of "own
 * directory" left to get wrong when a program spans three of them.
 */
const importedRootCache = new Map<string, Map<string, string[]>>();

/** Every directory the program in `tsconfigName` imports from. */
function importedRootsOf(tsconfigName: string): Map<string, string[]> {
  const cached = importedRootCache.get(tsconfigName);
  if (cached !== undefined) return cached;
  const roots = importedRoots(compiledFiles(tsconfigName));
  importedRootCache.set(tsconfigName, roots);
  return roots;
}

function importedRoots(files: string[]): Map<string, string[]> {
  const roots = new Map<string, string[]>();
  for (const file of files) {
    for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
      const top = importedRoot(file, specifier);
      if (top === null) continue;
      const witnesses = roots.get(top) ?? [];
      witnesses.push(`${repoPath(file)} → ${specifier}`);
      roots.set(top, witnesses);
    }
  }
  return roots;
}

/** The two images the fleet deploys, each with the sources it is built from. */
const IMAGES = [
  {
    name: 'the gameserver',
    dockerfile: 'server/Dockerfile',
    dir: 'server',
    tsconfig: 'server/tsconfig.json',
  },
  {
    name: 'the allocator',
    dockerfile: 'allocator/Dockerfile',
    dir: 'allocator',
    tsconfig: 'allocator/tsconfig.json',
  },
] as const;

describe('the Docker build context contains everything the build imports', () => {
  for (const image of IMAGES) {
    it(`${image.name} (${image.dockerfile}) COPYs every directory its typecheck imports from`, () => {
      const dockerfile = repoFile(image.dockerfile);
      // The scope below is only honest if the image really runs THIS config; a
      // build that typechecks a different program is one this test does not
      // describe. (`server/Dockerfile` used to run a bare `npx tsc --noEmit` —
      // that is the shape this guards against coming back.)
      expect(
        dockerfile.includes(`-p ${image.tsconfig}`),
        `${image.dockerfile} must typecheck with ${image.tsconfig}, or this test is scoped to the wrong program`,
      ).toBe(true);

      const roots = contextRoots(dockerfile);
      const deps = importedRootsOf(image.tsconfig);
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

    it(`${image.name} scopes the walk to the files it compiles — src/ included, tests not`, () => {
      const compiled = compiledFiles(image.tsconfig).map(repoPath);

      // src/ is the directory the second outage came from, and the one this walk
      // did not cover until a1-04. If a refactor ever drops it, this test would
      // otherwise go green by covering nothing.
      expect(compiled.some((file) => file.startsWith('src/'))).toBe(true);
      expect(compiled.some((file) => file.startsWith(`${image.dir}/`))).toBe(true);

      // And a1-03's exclusions stay exactly as they are: neither image compiles a
      // test, which is what makes `harness/`-importing tests harmless in the image.
      expect(compiled.filter((file) => file.endsWith('.test.ts'))).toEqual([]);
    });
  }

  it('the gameserver image copies allocator/ — the pin import that broke the deploy (M10)', () => {
    // Named on its own rather than left implicit in the sweep above, because this
    // is the concrete regression: `server/upgrade-router.ts` reuses the allocator's
    // FlyReplayRouter, and without these sources the image does not build.
    expect(importedRootsOf('server/tsconfig.json').has('allocator')).toBe(true);
    expect(contextRoots(repoFile('server/Dockerfile')).has('allocator')).toBe(true);
  });

  it('both images copy content/ — the src/ import the walk would have missed', () => {
    // The live witness that the src/ half of the sweep is doing work: `src/main.ts`
    // and `src/ui/index.ts` import the codex JSON out of `content/`, a top-level
    // directory that is neither service's own. Both Dockerfiles COPY it, so this
    // passes — but it passes for a reason, and the reason is the rule under test.
    for (const image of IMAGES) {
      const witnesses = importedRootsOf(image.tsconfig).get('content') ?? [];
      expect(witnesses.some((witness) => witness.startsWith('src/'))).toBe(true);
      expect(contextRoots(repoFile(image.dockerfile)).has('content')).toBe(true);
    }
  });
});
