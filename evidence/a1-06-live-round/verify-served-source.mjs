/**
 * evidence/a1-06-live-round/verify-served-source.mjs — THE GATE. OWNER: QA Manager.
 *
 * "Merged is not shipped." Before a single frame of this round means anything,
 * the build being served has to actually carry the two fixes. This answers that
 * question about the ARTIFACT ON THE WIRE, not about main.
 *
 *   node evidence/a1-06-live-round/verify-served-source.mjs [sha]   (default: HEAD)
 *
 * WHY NOT THE BUNDLE FILENAME. `vite.config.ts` injects `__BUILD_INFO__` with an
 * ISO build TIME, so Vite's content hash moves on every build even when the
 * source is byte-identical. A local build of `e567af0` emitted
 * `index-Fw38SFaJ.js` while the site served `index-C-UgMqNF.js`; that mismatch
 * is the timestamp, not a stale deploy. Filing it as one would have been a
 * fabricated finding.
 *
 * WHY NOT THE BADGE OR version.json ALONE. Both are strings the build writes
 * about itself. They are necessary and they are not sufficient: a deploy that
 * shipped a fresh `version.json` beside a cached bundle would say exactly the
 * same thing.
 *
 * WHAT THIS DOES INSTEAD. The client ships sourcemaps (`build.sourcemap: true`),
 * and a sourcemap carries `sourcesContent` — the ORIGINAL SOURCE of the code on
 * the page. Pull it and compare, byte for byte, against `git show <sha>:<path>`
 * for every file the two fixes touched. If those agree, the page is running that
 * tree; no self-report is being taken on trust.
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.A1_06_BASE_URL ?? 'https://imaginethegames.github.io/planet-rush/';

/** Every file the two merged fixes touched, plus the sim the claim is about. */
const FILES = [
  'src/ui/shell-lifetime.ts', // #363 — did not exist before the fix
  'src/platform/match-boot.ts', // #362
  'src/net/session.ts',
  'src/net/wire.ts',
  'src/net/loopback.ts',
  'src/main.ts',
  'src/sim/match.ts', // collapseDeadline — the match-length rail
  'src/sim/constants.ts', // the ratified abundance table
];

/**
 * Two files in the two fixes' diffs CANNOT appear in a sourcemap, and their
 * absence is not a finding. Listed rather than silently dropped, so the next
 * reader does not re-discover the same false alarm — I filed both as failures
 * on the first run before checking why.
 *
 *   src/net/transport.ts  declares only `type`/`interface` — zero runtime
 *                         exports, so TypeScript erases it and no bytes of it
 *                         reach the bundle to be mapped.
 *   src/ui/index.ts       a pure re-export barrel — zero runtime declarations,
 *                         so rollup flattens it into its consumers.
 *
 * Both are proven THROUGH the files that carry their content: the wire type by
 * `session.ts`/`wire.ts`, and the barrel's new `createShellLifetime` export by
 * `shell-lifetime.ts` itself, all of which are byte-compared above.
 */
const ERASED = [
  { file: 'src/net/transport.ts', why: 'types only — erased at compile time' },
  { file: 'src/ui/index.ts', why: 're-export barrel — flattened by rollup' },
];

const sha = process.argv[2] ?? execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();

const version = await (await fetch(new URL('version.json', BASE), { cache: 'no-store' })).json();
const html = await (await fetch(BASE, { cache: 'no-store' })).text();
const bundle = (html.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/) ?? [])[1];
if (!bundle) throw new Error('no index bundle referenced by the served index.html');

const map = await (await fetch(new URL(`assets/${bundle}.map`, BASE))).json();

const results = FILES.map((f) => {
  const i = map.sources.findIndex((s) => s.replace(/^(\.\.\/)+/, '') === f);
  if (i < 0) return { file: f, inMap: false, identical: false };
  const served = map.sourcesContent[i];
  let local = null;
  try {
    local = execSync(`git show ${sha}:${f}`, { encoding: 'utf8', maxBuffer: 64e6 });
  } catch {
    return { file: f, inMap: true, identical: false, note: `not in ${sha}` };
  }
  return { file: f, inMap: true, identical: served === local, servedChars: served.length, localChars: local.length };
});

const erased = ERASED.map((e) => ({
  ...e,
  inMap: map.sources.some((s) => s.replace(/^(\.\.\/)+/, '') === e.file),
  expected: 'absent',
}));

const out = {
  base: BASE,
  checkedAt: new Date().toISOString(),
  comparedAgainstSha: sha,
  versionJson: version,
  servedBundle: bundle,
  sourcesInMap: map.sources.length,
  results,
  erased,
  allIdentical: results.every((r) => r.identical),
  note:
    'Bundle FILENAME is not a gate: vite injects an ISO build time into __BUILD_INFO__, ' +
    'so the content hash moves on every build. The sourcemap sourcesContent is the gate.',
};

writeFileSync(join(HERE, 'served-source-check.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
if (!out.allIdentical) process.exitCode = 1;
