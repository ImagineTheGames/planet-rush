/**
 * evidence/a1-13-night-round/verify-served-source.mjs — THE GATE. OWNER: QA Manager.
 *
 * "Merged is not shipped." Three features landed tonight and this round attests
 * them on a SERVED build. Before one frame of it means anything, the artifact on
 * the wire has to actually carry all three; a round against a stale bundle
 * manufactures false confidence, which is worse than no round.
 *
 *   node evidence/a1-13-night-round/verify-served-source.mjs [sha]   (default: HEAD)
 *
 * The method is a1-06's, unchanged, because it was right:
 *
 * NOT THE BUNDLE FILENAME. `vite.config.ts` injects `__BUILD_INFO__` with an ISO
 * build TIME, so Vite's content hash moves on every build even at byte-identical
 * source. a1-06 nearly filed that as a stale deploy.
 *
 * NOT version.json OR THE BADGE ALONE. Both are strings the build writes about
 * itself. Necessary, not sufficient: a deploy that shipped a fresh version.json
 * beside a cached bundle would say exactly the same thing.
 *
 * THE SOURCEMAP. `build.sourcemap: true`, so the served bundle ships
 * `sourcesContent` — the ORIGINAL SOURCE of the code on the page. Pull it and
 * byte-compare against `git show <sha>:<path>` for every src file tonight's four
 * merges touched. If those agree, the page is running that tree, and nothing is
 * being taken on trust.
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.A1_13_BASE_URL ?? 'https://imaginethegames.github.io/planet-rush/';

/**
 * Every non-test `src/` file tonight's merges touched, grouped by the claim it
 * belongs to. Test files are not in the bundle and are not listed.
 */
const FILES = [
  // --- #371 / a2-07: the effects are DRAWN --------------------------------
  'src/main.ts', // the wire itself: constructs VfxLayer, adds it to gameRoot
  'src/art/vfx/layer.ts', // the draw layer that never existed on the stage
  'src/art/vfx/field.ts',
  'src/art/vfx/emitters.ts', // the GDD §3.6 set
  'src/art/vfx/observer.ts',
  'src/art/vfx/showcase.ts',
  // --- #370 / n6-01: CONNECTION LOST is installed -------------------------
  'src/net/link-loss.ts',
  'src/net/link-loss-view.ts', // had zero callers until tonight
  'src/net/link-loss-attach.ts', // the missing wire
  'src/platform/wheel-input.ts',
  // --- #373 + #374 / a1-11 + a1-12: the renderer is lighter ---------------
  'src/render/index.ts', // atlas pooling + the viewport cull, both
  'src/render/cull.ts', // did not exist before #374
];

/**
 * Files in the diffs that CANNOT appear in a sourcemap. Their absence is not a
 * finding — a1-06 filed two such as failures before checking why. A pure
 * re-export barrel has zero runtime declarations, so rollup flattens it into its
 * consumers and no bytes of it survive to be mapped. Both barrels below are
 * proven THROUGH the files whose content they re-export, all byte-compared above.
 */
const ERASED = [
  { file: 'src/art/vfx/index.ts', why: 're-export barrel — flattened by rollup' },
  { file: 'src/net/index.ts', why: 're-export barrel — flattened by rollup' },
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
  const served = map.sourcesContent?.[i] ?? '';
  let repo;
  try {
    repo = execSync(`git show ${sha}:${f}`, { encoding: 'utf8', maxBuffer: 64e6 });
  } catch {
    return { file: f, inMap: true, identical: false, note: `not present at ${sha}` };
  }
  return {
    file: f,
    inMap: true,
    identical: served === repo,
    servedBytes: Buffer.byteLength(served),
    repoBytes: Buffer.byteLength(repo),
  };
});

const out = {
  base: BASE,
  checkedAt: new Date().toISOString(),
  claimedSha: sha,
  versionJson: version,
  bundle,
  sourcesInMap: map.sources.length,
  results,
  erased: ERASED,
  verdict:
    version.sha === sha && results.every((r) => r.inMap && r.identical)
      ? 'SERVED BUILD IS THE CLAIMED TREE'
      : 'MISMATCH — do not attest against this bundle',
};

writeFileSync(join(HERE, 'served-source-check.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out, null, 2));
if (out.verdict !== 'SERVED BUILD IS THE CLAIMED TREE') process.exitCode = 1;
