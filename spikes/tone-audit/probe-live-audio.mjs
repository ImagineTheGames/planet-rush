/*
 * spikes/tone-audit/probe-live-audio.mjs — is the audio the player hears the
 * audio in this repo? OWNER: Sound Agent. Written for the QA Manager.
 *
 *   node spikes/tone-audit/probe-live-audio.mjs [url] [--dist path/to/index-*.js]
 *
 * Default url: https://imaginethegames.github.io/planet-rush/
 *
 * ## Why this exists
 *
 * The audio bank has now been re-voiced twice against the same complaint, and
 * both times the first question was the same and nobody could answer it in one
 * command: *is the developer hearing this build?* s7-02 merged green and the
 * report came back unchanged, so the whole of s8-01 opened by ruling out a stale
 * service worker by hand — fetching version.json, checking commit ancestry,
 * diffing a minified bundle against a local `dist`. That is the check this
 * script is, run in about two seconds instead.
 *
 * It is also the closer LESSONS §2 and §11 ask for. **Merged is not shipped and
 * shipped is not heard.** A green CI run proves the bank in `main` is correct; it
 * proves nothing about the bytes being served, and the bytes being served are the
 * only thing the developer can hear.
 *
 * ## What it proves, and what it does not
 *
 * PROVES: the served bundle contains the round-2 synthesis model, and — when a
 * local build is given with `--dist` — that the served `rockChip` spec is
 * byte-identical to the one this working tree renders.
 *
 * DOES NOT PROVE: that anyone listened. That is still a human attestation, and
 * this script exists to give it a sha to name.
 *
 * A throwaway measurement program like everything else in this directory: not in
 * the bundle, not in the tsconfig `include`, imported by nothing in `src/`.
 */

const DEFAULT_URL = 'https://imaginethegames.github.io/planet-rush/';

/**
 * Markers that cannot appear in any pre-s8 bundle.
 *
 * Each is a synthesis capability `../../src/art/audio/synth.ts` did not have
 * before this brief, so finding one in a minified bundle is proof the round-2
 * model is in it — regardless of how the bundler mangled everything around it.
 * Property names survive minification because they are object keys.
 */
const ROUND_2_MARKERS = [
  ['decayCurve', 'exponential decay tails — the linear ramp is gone'],
  ['resonance', 'the resonant filter — material rather than a duller hiss'],
  ['lowPassEnd', 'swept cutoffs — the resonant sweep'],
  ['bandPass', 'metallic band-pass transients'],
];

/** Markers that mean the bundle is the RE-VOICE-ROUND-1 bank (s7-02, PR #290). */
const ROUND_1_ONLY = [
  ['freq:92,freqEnd:82,lowPass:820,highPass:130', "round-1 rockChip: no resonance, no sweep, no tail"],
];

const args = process.argv.slice(2);
const distFlag = args.indexOf('--dist');
const distPath = distFlag >= 0 ? args[distFlag + 1] : undefined;
const base = args.find((a) => a.startsWith('http')) ?? DEFAULT_URL;
const root = base.endsWith('/') ? base : `${base}/`;

const ok = (s) => `\x1b[32m${s}\x1b[0m`;
const bad = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

async function get(url, what) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${what}: ${res.status} ${res.statusText} — ${url}`);
  return res.text();
}

/** Pull one bank spec object out of a minified bundle, by its `name:"..."` key. */
function specOf(source, name) {
  const m = source.match(new RegExp(`name:"${name}"[^}]*\\}`));
  return m ? m[0] : null;
}

const failures = [];
const check = (pass, label, detail) => {
  console.log(`  ${pass ? ok('PASS') : bad('FAIL')}  ${label}${detail ? dim(`  ${detail}`) : ''}`);
  if (!pass) failures.push(label);
};

console.log(`\n=== LIVE AUDIO PROBE — ${root} ===\n`);

// --- 1. What build is deployed? ---------------------------------------------
// version.json is the freshness signal and `public/sw.js` is explicitly forbidden
// from caching it, so this is the honest answer even through a service worker.
let stamp = {};
try {
  stamp = JSON.parse(await get(new URL('version.json', root).href, 'version.json'));
  console.log(`  served sha   ${ok(stamp.sha ?? '?')}   built ${stamp.time ?? '?'}`);
} catch (err) {
  console.log(`  ${bad('no version.json')} — ${err.message}`);
}

// --- 2. Which bundle does the shell point at? -------------------------------
const html = await get(root, 'index.html');
const asset = html.match(/assets\/index-[A-Za-z0-9._-]+\.js/)?.[0];
if (!asset) {
  console.log(bad('\n  could not find the entry bundle in index.html\n'));
  process.exit(1);
}
const bundleUrl = new URL(asset, root).href;
const bundle = await get(bundleUrl, 'bundle');
console.log(`  bundle       ${asset}  ${dim(`${(bundle.length / 1024).toFixed(0)} kB`)}\n`);

// --- 3. Is the round-2 synthesis model in it? -------------------------------
console.log('  --- the round-2 model ---');
for (const [marker, why] of ROUND_2_MARKERS) {
  check(bundle.includes(marker), marker.padEnd(12), why);
}

// --- 4. Is a known-old bank in it? ------------------------------------------
console.log('\n  --- markers of a bank that was already rejected ---');
for (const [marker, why] of ROUND_1_ONLY) {
  const present = bundle.includes(marker);
  check(!present, present ? `STALE: ${why}` : `not the round-1 bank`, present ? marker : '');
}

// --- 5. The mining voice, verbatim ------------------------------------------
// `rockChip` is TELL.mineHit, it fires all match, and it is the sound the
// developer has now judged three times. If any one voice is worth quoting in an
// attestation it is this one.
console.log('\n  --- the shipped mining voice ---');
const servedChip = specOf(bundle, 'rockChip');
console.log(`  served   ${servedChip ?? bad('NOT FOUND')}`);
check(servedChip !== null && servedChip.includes('resonance'), 'rockChip carries the round-2 spec');

if (distPath) {
  const { readFileSync } = await import('node:fs');
  const local = readFileSync(distPath, 'utf8');
  const localChip = specOf(local, 'rockChip');
  console.log(`  local    ${localChip ?? bad('NOT FOUND')}`);
  check(localChip !== null && servedChip === localChip, 'served rockChip is byte-identical to this build');
}

// --- 6. The waveform census, as the bundle carries it -----------------------
// Not a bank census — these counts include the synth's own `case` labels and
// `ui-cues`. They are here as a fingerprint to diff against a local build, not
// as a tone measurement. Run `measure-bank-tone.ts` for the real one.
console.log('\n  --- wave literals in the bundle (fingerprint, not a census) ---');
const counts = ['square', 'saw', 'triangle', 'sine', 'noise'].map((w) => {
  const n = bundle.match(new RegExp(`["']${w}["']`, 'g'))?.length ?? 0;
  return `${w} ${n}`;
});
console.log(`  ${dim(counts.join('  ·  '))}`);

// --- Verdict ----------------------------------------------------------------
console.log('');
if (failures.length === 0) {
  console.log(ok(`  VERDICT: the deployment at ${stamp.sha ?? 'this url'} is serving the round-2 bank.`));
  console.log(dim('  This proves the bytes. It does not prove anyone listened — that is still yours.\n'));
} else {
  console.log(bad(`  VERDICT: ${failures.length} check(s) failed. The bytes being served are NOT the round-2 bank.`));
  console.log(dim('  Do not attest against this build. Re-voicing anything would fix nothing.\n'));
}
process.exit(failures.length === 0 ? 0 : 1);
