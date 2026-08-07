/**
 * evidence/a2-03-cutterhead/verify-served-build.mjs — is the thing on this port
 * actually THIS branch? OWNER: Art Agent (brief a2-03).
 *
 * The shared-port trap, inherited from a3-01's working notes: `vite preview` is
 * pinned to one port and `reuseExistingServer` is on, so in a multi-lane container
 * a screenshot can be taken against a sibling lane's bundle and pass. The failure
 * is silent — you get a real frame of a real build, just not yours.
 *
 * So before trusting any shot: fetch the served page, walk its module graph, and
 * assert the Cutterhead is in there and the planetoid is not. Two markers, one
 * each way, because "the new code is present" and "the old code is gone" are
 * different claims and only both together mean the bundle is this branch.
 *
 *   node evidence/a2-03-cutterhead/verify-served-build.mjs [port]
 */
const port = Number(process.argv[2] ?? process.env.A2_03_PREVIEW_PORT ?? 4291);
const base = `http://localhost:${port}`;

/** The planetoid renderer's ocean hex — hand-drawn, off-palette, now deleted. */
const PLANETOID = '3099235'; // 0x2f4a63, as the minifier writes it
const PLANETOID_HEX = '0x2f4a63';
/** The Cutterhead's own marks: the recess shade and a variant note string. */
const HULL_WELL = '2961977'; // 0x2d3239 = shade(hullSteel, .72), new in a2-03
const NOTE = 'Circuit east';

const text = async (u) => {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${u} → ${r.status}`);
  return r.text();
};

const index = await text(base + '/');
const srcs = [...index.matchAll(/src="([^"]+\.js)"/g)].map((m) => new URL(m[1], base).href);
if (srcs.length === 0) throw new Error('no module script found in the served index.html');

let bundle = '';
const seen = new Set();
const walk = async (url) => {
  if (seen.has(url)) return;
  seen.add(url);
  const body = await text(url);
  bundle += body;
  for (const m of body.matchAll(/from\s*"([^"]+\.js)"/g)) await walk(new URL(m[1], url).href);
  for (const m of body.matchAll(/import\s*\(\s*"([^"]+\.js)"\s*\)/g)) await walk(new URL(m[1], url).href);
};
for (const s of srcs) await walk(s);

const has = (needle) => bundle.includes(needle);
const checks = [
  ['Cutterhead recess shade present', has(HULL_WELL) || has('0x2d3239')],
  ['Cutterhead variant note present', has(NOTE)],
  ['planetoid ocean hex GONE', !has(PLANETOID) && !has(PLANETOID_HEX)],
];

let bad = 0;
for (const [what, ok] of checks) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!ok) bad++;
}
console.log(`served ${seen.size} module(s), ${bundle.length} bytes, from ${base}`);
if (bad > 0) {
  console.error(`\n${bad} check(s) failed — the bundle on :${port} is NOT this branch. Do not trust a shot taken against it.`);
  process.exit(1);
}
