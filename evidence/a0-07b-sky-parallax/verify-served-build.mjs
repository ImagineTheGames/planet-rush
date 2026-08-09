/**
 * evidence/a0-07b-sky-parallax/verify-served-build.mjs — is the preview on this
 * port serving THIS branch? OWNER: Art Agent (a0-07b).
 *
 * The failure this exists to catch is silent and expensive: several lanes share
 * this box, `playwright.config.ts` reuses an existing server on 4173, and a
 * golden or an evidence frame re-shot against another lane's bundle comes back
 * looking correct. a3-01 hit it and only found out by reading the served
 * JavaScript back. a0-07 wrote the first of these; this is its a0-07b sibling,
 * asserting the one number this brief changes.
 *
 * Three assertions, in order of how much they prove:
 *
 *   1. `/version.json` carries a build sha (reported, not asserted — the preview
 *      may be a worktree of `origin/main`, which is the point of `--before`).
 *   2. The bundle carries the sky ids (`plasmaReef`), so it is a build that has
 *      the a0-07 backdrop in it at all.
 *   3. The bundle carries the parallax this branch ships and NOT the one it
 *      replaces — or exactly the other way round under `--before`, which is how
 *      the side-by-side proves the two ports really are two builds.
 *
 * How (3) is read off a minified bundle, since it is not obvious: esbuild keeps
 * object-literal KEYS, so the five `NebulaSpec`s emit `parallax:<something>`.
 * The old build inlined the literal five times — `parallax:.05`. This build
 * hoists {@link SKY_PARALLAX} to a const and emits `parallax:<ident>` five times
 * over, with the value defined once, immediately after the `STAR_LAYERS` array
 * that ends `glint:.22}]`. So the AFTER fingerprint is that definition and the
 * BEFORE fingerprint is the five inlined `.05`s, and each build must carry
 * exactly one of the two.
 *
 *   node evidence/a0-07b-sky-parallax/verify-served-build.mjs [port] [--before]
 */
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const before = args.includes('--before');
const port = args.find((a) => /^\d+$/.test(a)) ?? '4271';
/**
 * `vite preview` binds the loopback interface, and which loopback it answers on
 * is not something to guess at: on this box it listens on IPv6 `::1` while
 * Node's fetch resolves `localhost` to `127.0.0.1` first and gets ECONNREFUSED —
 * a "the server is down" error from a server that is up. Try each spelling and
 * keep the one that answers.
 */
async function resolveBase() {
  for (const host of ['localhost', '[::1]', '127.0.0.1']) {
    const candidate = `http://${host}:${port}`;
    try {
      const res = await fetch(`${candidate}/`);
      if (res.ok) return candidate;
    } catch {
      /* try the next spelling */
    }
  }
  throw new Error(`nothing is serving on port ${port} (tried localhost, [::1], 127.0.0.1)`);
}

const base = await resolveBase();

/** `const SKY_PARALLAX = 0.085`, hoisted right after the STAR_LAYERS table. */
const AFTER_RE = /glint:\.?22\}\],\s*[\w$]+\s*=\s*0?\.085/;
/** The old build's five inlined literals, one per distant NebulaSpec. */
const BEFORE_RE = /parallax:0?\.05\b/g;

async function text(path) {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.text();
}

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
  const raw = await text('/version.json');
  version = JSON.parse(raw).sha ?? raw.trim();
} catch {
  /* dev fallback: not fatal, the bundle checks below are the real proof */
}

const hasSkies = bundle.includes('plasmaReef') || bundle.includes('Plasma Reef');
const hasAfter = AFTER_RE.test(bundle);
const oldLiterals = (bundle.match(BEFORE_RE) ?? []).length;
const hasBefore = oldLiterals > 0;
const head = execSync('git rev-parse --short HEAD').toString().trim();

console.log(`served      ${base}`);
console.log(`version     ${version}   (this worktree's HEAD: ${head})`);
console.log(`bundle      ${[...seen].join(' ')}`);
console.log(`skies       ${hasSkies ? 'yes' : 'NO'}`);
console.log(`parallax    SKY_PARALLAX=.085 ${hasAfter ? 'present' : 'absent'} · inlined .05 ×${oldLiterals}`);
console.log(`expecting   ${before ? 'the BEFORE build (.05)' : 'the AFTER build (.085)'}`);

const problems = [];
if (!hasSkies) problems.push('the served bundle has no sky registry in it at all');
if (before && !hasBefore) problems.push('--before, but the served bundle does not carry parallax .05');
if (before && hasAfter) problems.push('--before, but the served bundle carries the NEW parallax .085');
if (!before && !hasAfter) problems.push('the served bundle does not carry the new parallax .085');
if (!before && hasBefore) problems.push('the served bundle still carries the old parallax .05');

if (problems.length > 0) {
  console.error(`\nFAIL\n  - ${problems.join('\n  - ')}\n`);
  process.exit(1);
}
console.log('\nOK — this port is serving the build it is supposed to be serving.\n');
