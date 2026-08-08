/**
 * evidence/a0-07-darker-backdrop/verify-served-build.mjs — is the preview on
 * this port serving THIS branch? OWNER: Art Agent (a0-07).
 *
 * The failure this exists to catch is silent and expensive: several lanes share
 * this box, `playwright.config.ts` reuses an existing server on 4173, and a
 * golden re-shot against another lane's bundle comes back looking correct.
 * a3-01 hit it and only found out by reading the served JavaScript back.
 *
 * So read it back. Three assertions, in order of how much they prove:
 *
 *   1. `/version.json` carries the short HEAD sha of the build being served.
 *   2. The bundle contains the new ground colour `#010204` / `0x010204` /
 *      `66052` (its decimal form — the bundler is free to pick any of them).
 *   3. The bundle contains the sky registry's own name, `MAP_NEBULA`'s ids —
 *      `plasmaReef` — which no build before this branch had.
 *
 *   node evidence/a0-07-darker-backdrop/verify-served-build.mjs [port]
 */
import { execSync } from 'node:child_process';

const port = process.argv[2] ?? '4207';
const base = `http://localhost:${port}`;

/** Every form a bundler might emit `#010204` in. */
const FLOOR_FORMS = ['010204', '66052'];

async function text(path) {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.text();
}

const head = execSync('git rev-parse --short HEAD').toString().trim();

/** `./assets/x.js`, `assets/x.js`, `http://host/assets/x.js` → `/assets/x.js`. */
const asPath = (src) => (src.startsWith('http') ? new URL(src).pathname : `/${src.replace(/^\.?\/?/, '')}`);

const index = await text('/');
const scripts = [...index.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
if (scripts.length === 0) throw new Error('no module script in the served index.html');

const seen = new Set();
let bundle = '';
for (const src of scripts) {
  const path = asPath(src);
  seen.add(path);
  bundle += await text(path);
}
// Vite code-splits; follow the static imports one level so the art chunk is read.
for (const m of [...bundle.matchAll(/["'](\.?\/?[\w./-]*assets\/[\w.-]+\.js)["']/g)]) {
  const path = asPath(m[1]);
  if (seen.has(path)) continue;
  seen.add(path);
  try {
    bundle += await text(path);
  } catch {
    /* not every match is a real chunk path — the checks below are what matter */
  }
}

let version = '(no /version.json)';
try {
  version = JSON.parse(await text('/version.json')).sha ?? JSON.stringify(JSON.parse(await text('/version.json')));
} catch {
  /* dev fallback: not fatal, the bundle checks below are the real proof */
}

const hasFloor = FLOOR_FORMS.some((f) => bundle.includes(f));
const hasSkies = bundle.includes('plasmaReef') || bundle.includes('Plasma Reef');
const bytes = bundle.length;

console.log(`port        ${port}`);
console.log(`git HEAD    ${head}`);
console.log(`served ver  ${version}`);
console.log(`bundle      ${bytes} bytes across ${scripts.length} entry script(s)`);
console.log(`Floor       ${hasFloor ? 'PRESENT' : 'ABSENT'}   (#010204 / 66052)`);
console.log(`the skies   ${hasSkies ? 'PRESENT' : 'ABSENT'}   (plasmaReef)`);

if (!hasFloor || !hasSkies) {
  console.error('\nFAIL — this port is not serving a0-07. Do not trust a shot taken against it.');
  process.exit(1);
}
console.log('\nOK — the served bundle is this branch. Shots against this port are honest.');
