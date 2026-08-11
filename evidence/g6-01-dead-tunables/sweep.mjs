/**
 * evidence/g6-01-dead-tunables/sweep.mjs — the constants-table sweep, brief g6-01.
 *
 * `a0-19` found two dead knobs by reading (`AUTO_AIM_ARC`, `SHIP_HULL`). Nobody
 * had swept the whole table, so this does it mechanically: join every
 * `export const` / `export function` in `src/sim/constants.ts` against
 * `tools/dark-matter-scan.mjs`'s reference counts, and rank by *who reads the
 * value* — production, the file itself, a spec, a tool.
 *
 * Why the join and not a grep: `a1-09` proved grep cannot answer this (19 of
 * `singlePrimary`'s hits were comments). The scan walks the TypeScript program
 * from the real entry points, so "production" means *reachable* production.
 *
 * Why "self-used" is not dead (the `g5-01` trap): a constant the same module
 * derives another live constant from IS running — only its `export` is wider
 * than its use. `MINING_RATE` reads `prod:0` for exactly that reason and is one
 * of the most load-bearing numbers in the game.
 *
 *   node tools/dark-matter-scan.mjs --json > /tmp/dm.json
 *   node evidence/g6-01-dead-tunables/sweep.mjs /tmp/dm.json
 */

import { readFileSync } from 'node:fs';

const scan = JSON.parse(readFileSync(process.argv[2] ?? '/tmp/dm.json', 'utf8'));
const src = readFileSync('src/sim/constants.ts', 'utf8').split('\n');

/** Every exported value in the table, with whether its doc block flags it TUNABLE. */
const decls = [];
for (let i = 0; i < src.length; i++) {
  const m = /^export (?:const|function) ([A-Za-z_][A-Za-z0-9_]*)/.exec(src[i]);
  if (!m) continue;
  let doc = '';
  for (let k = i - 1; k >= 0 && !/^export /.test(src[k]); k--) {
    doc = src[k] + '\n' + doc;
    if (/^\s*\/\*\*/.test(src[k])) break;
  }
  decls.push({ name: m[1], line: i + 1, tunable: /TUNABLE/.test(doc) || /Tunable</.test(src[i]) });
}

const uses = new Map(scan.exports.filter((e) => e.file === 'src/sim/constants.ts').map((e) => [e.name, e]));
const rows = decls.map((d) => ({ ...d, u: uses.get(d.name) })).filter((d) => d.u);
const dead = rows.filter((d) => d.u.dark);

console.log(
  `table exports: ${rows.length} · flagged TUNABLE: ${rows.filter((r) => r.tunable).length} · zero production references: ${dead.length}\n`,
);
for (const d of dead) {
  const u = d.u.uses;
  console.log(
    [
      d.name.padEnd(22),
      `L${d.line}`.padEnd(6),
      (d.tunable ? 'TUNABLE' : '-').padEnd(8),
      `prod:${u.prod}`,
      `self:${u.internal}`,
      `test:${u.test}`,
      `tool:${u.tool}`,
      d.u.verdictHint,
    ].join(' '),
  );
}
