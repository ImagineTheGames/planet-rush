/**
 * evidence/a1-17-defaults-and-browser/verify-served-source.mjs — THE GATE.
 * OWNER: QA Manager.
 *
 * "Merged is not shipped" (LESSONS §11). Five PRs landed — #399 a0-30 defaults,
 * #400 n10-01 the lobby-list route, #401 u17-01 the browse screen, #402 a0-31
 * solo seats, #403 a0-32 label overflow, #404 a0-33 scheme-aware onboarding —
 * and this round attests them on a SERVED build. Before one frame means
 * anything, the artifact on the wire has to carry all of them.
 *
 *   node evidence/a1-17-defaults-and-browser/verify-served-source.mjs [sha]
 *
 * Method is a1-06's / a1-13's, unchanged, because it is right:
 *
 * NOT THE BUNDLE FILENAME — `vite.config.ts` injects a build TIME, so the
 * content hash moves at byte-identical source.
 * NOT version.json OR THE BADGE ALONE — both are strings the build writes about
 * itself; a fresh version.json beside a cached bundle says the same thing.
 * THE SOURCEMAP — `build.sourcemap: true`, so the served bundle ships
 * `sourcesContent`: the ORIGINAL SOURCE of the code on the page. Pull it and
 * byte-compare against `git show <sha>:<path>`.
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.A1_17_BASE_URL ?? 'https://imaginethegames.github.io/planet-rush/';
const SHA = process.argv[2] ?? execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();

/** Every non-test `src/` file the five merges touched, grouped by claim. */
const FILES = [
  // --- #399 / a0-30: Tap Commander + Auto-aim are the default everywhere ---
  'src/main.ts', // the boot-path storage read: where a default can eat a saved choice
  'src/platform/actions.ts',
  'src/ui/lobby-flow.ts',
  // --- #400 / n10-01: the lobby-list route -------------------------------
  'src/net/allocator-client.ts',
  'src/net/lobby-list.ts', // did not exist before #400
  'src/net/session.ts',
  'src/net/transport.ts',
  'src/net/wire.ts',
  'src/net/ticket.ts',
  // --- #401 / u17-01: the browse screen ----------------------------------
  'src/ui/lobby-browser.ts', // new
  'src/ui/lobby-browser-view.ts', // new
  'src/ui/lobby-entry.ts',
  'src/ui/lobby-entry-view.ts',
  'src/ui/lobby-geometry.ts',
  'src/ui/online-copy.ts',
  // --- #402 / a0-31: a solo lobby offers no OPEN seat --------------------
  'src/ui/lobby.ts',
  'src/ui/lobby-view.ts',
  // --- #403 / a0-32: the labels fit --------------------------------------
  'src/ui/build-button.ts',
  'src/ui/build-wheel-view.ts',
  'src/ui/font-metrics.ts',
  'src/ui/font-metrics.data.ts',
  'src/ui/hud-geometry.ts',
  'src/ui/wheel-stack.ts',
  'src/platform/touch-visuals.ts',
  // --- #404 / a0-33: the tutorial matches the controls -------------------
  'src/ui/onboarding.ts',
  'src/ui/hud.ts',
];

/**
 * Files in the diffs that CANNOT appear in a sourcemap, and whose absence is
 * therefore not a finding: a pure re-export barrel has zero runtime
 * declarations, so rollup flattens it away and it never gets a `sources` entry.
 * a1-06 filed two such as failures before checking why.
 */
const BARRELS = ['src/net/index.ts', 'src/ui/index.ts'];

/**
 * A file with no runtime declarations at all is erased by `tsc`/rollup and can
 * never reach a sourcemap either — same reason as a barrel, different shape.
 * Computed, not asserted: this greps the file AT THE SHA for any export that
 * survives type erasure. If there are none, "absent" is arithmetic, not a gap.
 */
function runtimeExports(sha, path) {
  let src;
  try {
    src = execSync(`git show ${sha}:${path}`, { encoding: 'utf8', maxBuffer: 64e6 });
  } catch {
    return null;
  }
  const names = [];
  for (const m of src.matchAll(/^export\s+(?:default\s+)?(?:async\s+)?(const|let|var|function|class|enum)\s+([A-Za-z0-9_$]+)/gm)) {
    names.push(`${m[1]} ${m[2]}`);
  }
  return names;
}

/** How the CLIENT imports a file — a value import puts it in the bundle, a
 *  `import type` never does. Grepped across src/ at the sha. */
function valueImportersInClient(sha, path) {
  const mod = path.replace(/^src\//, '').replace(/\.ts$/, '');
  const bare = mod.split('/').pop();
  let out = '';
  try {
    out = execSync(
      `git grep -n -E "from '(\\\\./|\\\\.\\\\./)*(${mod}|${bare})'" ${sha} -- 'src/*.ts' | grep -v '\\.test\\.' || true`,
      { encoding: 'utf8', maxBuffer: 64e6, shell: '/bin/bash' },
    );
  } catch {
    return [];
  }
  return out
    .split('\n')
    .filter(Boolean)
    .filter((l) => !/import\s+type\s/.test(l) && !/^\S+:\d+:export /.test(l))
    .map((l) => l.replace(`${sha}:`, '').trim());
}

const text = async (url) => {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return r.text();
};

const version = JSON.parse(await text(new URL('version.json', BASE)));
const html = await text(BASE);

// Every module script the page loads, then every map beside it.
const entries = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
if (entries.length === 0) throw new Error('no module script found in the served index.html');

/** path -> sourcesContent, merged across every chunk's map. */
const served = new Map();
const maps = [];
const seen = new Set();
const queue = [...entries];
while (queue.length) {
  const rel = queue.shift();
  const abs = new URL(rel.replace(/^\//, '').replace(/^planet-rush\//, ''), BASE).href;
  if (seen.has(abs)) continue;
  seen.add(abs);
  const js = await text(abs);
  // Follow the chunk graph: a chunk this one imports carries its own map.
  for (const m of js.matchAll(/from"(\.\/[^"]+\.js)"/g)) queue.push(new URL(m[1], abs).href);
  for (const m of js.matchAll(/import\("(\.\/[^"]+\.js)"\)/g)) queue.push(new URL(m[1], abs).href);
  const mm = js.match(/\/\/# sourceMappingURL=(\S+)/);
  if (!mm) continue;
  const mapUrl = new URL(mm[1], abs).href;
  const map = JSON.parse(await text(mapUrl));
  maps.push({ chunk: abs, map: mapUrl, sources: map.sources.length });
  map.sources.forEach((s, i) => {
    const norm = s.replace(/^(\.\.\/)+/, '').replace(/^\.\//, '');
    const key = norm.startsWith('src/') ? norm : norm.includes('/src/') ? norm.slice(norm.indexOf('src/')) : norm;
    const content = map.sourcesContent?.[i];
    if (content != null && !served.has(key)) served.set(key, content);
  });
}

const results = FILES.map((path) => {
  const onWire = served.get(path);
  if (onWire === undefined) {
    if (BARRELS.includes(path)) {
      return {
        path,
        status: 'absent-barrel',
        note: 'pure re-export barrel: flattened by rollup, never gets a sources entry',
      };
    }
    const exports = runtimeExports(SHA, path);
    const importers = valueImportersInClient(SHA, path);
    if (exports !== null && exports.length === 0) {
      return {
        path,
        status: 'absent-type-only',
        runtimeExports: exports,
        note: 'no export survives type erasure — the file cannot reach the bundle or its map',
      };
    }
    if (exports !== null && importers.length === 0) {
      return {
        path,
        status: 'absent-type-only-in-client',
        runtimeExports: exports,
        clientValueImporters: importers,
        note: 'has runtime exports, but no src/ file value-imports it (type-only on the client); its runtime lives server-side',
      };
    }
    return { path, status: 'ABSENT', runtimeExports: exports, clientValueImporters: importers, note: 'not present in any served sourcemap' };
  }
  let inGit;
  try {
    inGit = execSync(`git show ${SHA}:${path}`, { encoding: 'utf8', maxBuffer: 64e6 });
  } catch {
    return { path, status: 'NOT-IN-GIT', note: `git show ${SHA}:${path} failed` };
  }
  const identical = onWire === inGit;
  return {
    path,
    status: identical ? 'identical' : 'DIFFERS',
    servedBytes: Buffer.byteLength(onWire),
    gitBytes: Buffer.byteLength(inGit),
  };
});

const OK = ['identical', 'absent-barrel', 'absent-type-only', 'absent-type-only-in-client'];
const bad = results.filter((r) => !OK.includes(r.status));
const out = {
  gateRunAt: new Date().toISOString(),
  baseURL: BASE,
  versionJson: version,
  comparedAgainstSha: SHA,
  chunks: maps,
  filesChecked: results.length,
  identical: results.filter((r) => r.status === 'identical').length,
  failures: bad.length,
  results,
};
writeFileSync(join(HERE, 'served-source-check.json'), JSON.stringify(out, null, 2));
console.log(`version.json sha = ${version.sha}, compared against ${SHA}`);
console.log(`${out.identical}/${out.filesChecked} files byte-identical; ${bad.length} failure(s)`);
for (const r of bad) console.log(`  ${r.status}  ${r.path}  ${r.note ?? ''}`);
if (bad.length) process.exitCode = 1;
