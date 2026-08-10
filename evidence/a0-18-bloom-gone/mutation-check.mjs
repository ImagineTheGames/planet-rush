/**
 * evidence/a0-18-bloom-gone/mutation-check.mjs — a0-18, does the guard bite? OWNER: Art Agent.
 *
 * a0-18 asks for "a test that fails without the fix". There is no fix — the bloom
 * was never gone (see ../a0-18-bloom-gone/README.md) — so the guard in
 * `src/art/backdrop-bloom.test.ts` cannot be demonstrated by removing a patch.
 * A test that has never been seen to fail is not evidence of anything, so it is
 * demonstrated the other way instead: **inject each defect the brief suspected,
 * one at a time, and show the guard fails on it.** If a suspect had been real,
 * this is the output the suite would have produced on the night.
 *
 * Each mutation is applied to a COPY-BACKED file, the suite is run, and the file
 * is restored from the copy before the next one — the tree is left exactly as it
 * was found, and the script restores on the way out of a crash too.
 *
 *   node evidence/a0-18-bloom-gone/mutation-check.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const BACKDROP = join(ROOT, 'src/art/backdrop.ts');
const GUARD = 'src/art/backdrop-bloom.test.ts';

/**
 * The three suspects from the brief, plus the one failure mode that is nobody's
 * suspect and would be the easiest to introduce by accident.
 */
const MUTATIONS = [
  {
    id: 'suspect-1-alpha-quantised',
    why:
      'Suspect 1: "if pooled textures bake at a different scale, or QUANTISE ALPHA, a 6% wash is ' +
      'exactly what disappears first while the 1px star core survives." Modelled at the source: ' +
      'round each halo alpha to one decimal, which floors every deep-layer halo (0.0169) to zero ' +
      'and trips the existing `if (a <= 0) continue`.',
    from: '      const a = round(ink.alpha * BLOOM.intensity[b]!);',
    to: '      const a = Math.round(ink.alpha * BLOOM.intensity[b]! * 10) / 10;',
  },
  {
    id: 'suspect-1b-bloom-dropped-entirely',
    why: 'The developer\'s report taken at its word: the halos are not submitted at all.',
    from: '    if (rng.next() < BLOOM.scatter) {',
    to: '    if (false && rng.next() < BLOOM.scatter) {',
  },
  {
    id: 'suspect-2-cull-reaches-the-backdrop',
    why:
      'Suspect 2: "the cull reaching a backdrop layer it should never touch." Modelled as the ' +
      'cheapest way that would ever be written — the star layer built, then left not visible.',
    from: '      this.view.addChild(g);\n      this.layers.push({ gfx: g, parallax: spec.parallax });',
    to: '      g.visible = false;\n      this.view.addChild(g);\n      this.layers.push({ gfx: g, parallax: spec.parallax });',
  },
  {
    id: 'suspect-3-reducer-sheds-the-stars',
    why:
      'Suspect 3: reduced-VFX shedding more than it claims. `setReduceVfx` promises the stars ' +
      '"near-free once baked, stay"; this is the one-line edit that would make that comment a lie.',
    from: '    for (const spec of STAR_LAYERS) {',
    to: '    for (const spec of STAR_LAYERS) {\n      if (this.reduced && spec.key !== \'deep\') continue;',
  },
  {
    id: 'bonus-halo-painted-over-the-star',
    why:
      'Not a suspect, and the easiest of the lot to do by accident: draw the halo AFTER the star ' +
      'instead of before. The bloom is still submitted, still at the ratified alpha, and the field ' +
      'looks wrong because a 16% disc now washes over every star it belongs to.',
    from: '    shapes.push(circle(x, y, r, fill(ink.color, \'material\', ink.alpha)));',
    to: '    shapes.unshift(circle(x, y, r, fill(ink.color, \'material\', ink.alpha)));',
  },
];

const original = readFileSync(BACKDROP, 'utf8');
const restore = () => writeFileSync(BACKDROP, original);
process.on('exit', restore);
process.on('SIGINT', () => {
  restore();
  process.exit(130);
});

const results = [];
for (const m of MUTATIONS) {
  if (!original.includes(m.from)) {
    console.log(`\n### ${m.id}\n    *** ANCHOR NOT FOUND — the source moved; this mutation was NOT applied ***`);
    results.push({ ...m, applied: false, failed: null });
    continue;
  }
  writeFileSync(BACKDROP, original.replace(m.from, m.to));
  let output = '';
  let failed = false;
  try {
    output = execFileSync('npx', ['vitest', 'run', GUARD], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    failed = true;
    output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  restore();

  const failingTests = [...output.matchAll(/^\s+[x×✗]\s+(.*)$/gm)].map((x) => x[1].trim());
  const summary = (output.match(/Tests\s+.*$/m) ?? [''])[0].trim();
  console.log(`\n### ${m.id}`);
  console.log(`    ${m.why}`);
  console.log(`    guard: ${failed ? 'FAILED (good — it bites)' : '*** PASSED — THE GUARD IS BLIND TO THIS ***'}`);
  console.log(`    ${summary}`);
  for (const t of failingTests.slice(0, 8)) console.log(`      × ${t}`);
  results.push({ ...m, applied: true, failed, summary, failingTests });
}

// And the unmutated tree, last, so the run ends by proving it is clean again.
let cleanOk = true;
try {
  const out = execFileSync('npx', ['vitest', 'run', GUARD], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
  console.log(`\n### restored tree\n    ${(out.match(/Tests\s+.*$/m) ?? [''])[0].trim()}`);
} catch (e) {
  cleanOk = false;
  console.log(`\n### restored tree\n    *** THE GUARD DOES NOT PASS ON THE CLEAN TREE ***\n${e.stdout ?? ''}`);
}

writeFileSync(
  join(HERE, 'mutation-check.json'),
  `${JSON.stringify({ guard: GUARD, cleanTreePasses: cleanOk, mutations: results }, null, 2)}\n`,
);

const blind = results.filter((r) => r.applied && !r.failed);
console.log(
  `\n${results.filter((r) => r.failed).length} of ${results.length} mutations caught` +
    (blind.length ? `; BLIND TO: ${blind.map((b) => b.id).join(', ')}` : '; none slipped through'),
);
console.log(`wrote ${join(HERE, 'mutation-check.json')}`);
