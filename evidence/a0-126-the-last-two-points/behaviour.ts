/**
 * evidence/a0-126-the-last-two-points/behaviour.ts — what a Warden nerf would
 * have had to touch. OWNER: QA Agent (brief a0-126).
 *
 *   npx vite-node evidence/.../behaviour.ts --print
 *
 * The brief's second instruction: *"Do not tune Warden by making it worse at
 * what it is for."* Warden is the homebody — it retreats into its own turret
 * cover and fights there (GDD §2.6) — and a0-105/a0-107 reworked exactly that
 * path this month. So a report that declines to tune, or that tunes, owes the
 * same thing either way: **which behaviour the change touches, measured rather
 * than asserted.**
 *
 * The section artifacts already carry it. `leavesBy` is character → behaviour
 * leaf → ticks, pooled over every match, and a0-105's own reading of the
 * retreat path — `turnOfRetreat`, the share of the retreat family that became a
 * turn-and-fight — is a `harness/mirrors` export. This prints Warden's census
 * beside the rest of the Hard pool, and beside Foreman, which is the comparison
 * that matters: Foreman flies the same hull, so the difference between the two
 * censuses is behaviour and the similarity is the hull.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { leafShare, pct, turnOfRetreat } from '../../harness/mirrors';
import type { SectionRun } from '../../harness/mirrors';

const ROOT = resolve(import.meta.dirname, '../..');
const read = (p: string): SectionRun => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8')) as SectionRun;

/** The leaves that are the retreat path, in the order a0-105/a0-107 read them. */
const HOME_LEAVES = ['retreat', 'cornered-fight', 'turn-and-fight', 'last-stand', 'defend'] as const;
const CAST = ['warden', 'foreman', 'sable', 'vulture', 'patch', 'rusty', 'bolt'] as const;

function censusTable(run: SectionRun): string {
  const head = ['character', ...HOME_LEAVES.map((l) => `\`${l}\``), '**home family**', '`attack`', '`mine`', 'turn-of-retreat'];
  const rows = CAST.map((c) => {
    const by = run.leavesBy[c] ?? {};
    const home = HOME_LEAVES.reduce((a, l) => a + leafShare(by, l), 0);
    return [
      c === 'warden' ? '**Warden**' : c,
      ...HOME_LEAVES.map((l) => pct(leafShare(by, l))),
      `**${pct(home)}**`,
      pct(leafShare(by, 'attack')),
      pct(leafShare(by, 'mine')),
      pct(turnOfRetreat(by)),
    ];
  });
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

/** Warden's census on the shipped tree against the tree a0-121 was handed —
 *  did the hull retune already move the path the brief protects? */
function moveTable(before: SectionRun, after: SectionRun): string {
  const head = ['leaf', 'before a0-121', 'after a0-121 (shipped)', 'move'];
  const b = before.leavesBy['warden'] ?? {};
  const a = after.leavesBy['warden'] ?? {};
  const leaves = [...HOME_LEAVES, 'attack', 'mine', 'haul', 'dead'];
  const rows = leaves.map((l) => {
    const x = leafShare(b, l);
    const y = leafShare(a, l);
    return [`\`${l}\``, pct(x), pct(y), `${y - x >= 0 ? '+' : ''}${(100 * (y - x)).toFixed(2)} pts`];
  });
  const bh = HOME_LEAVES.reduce((s, l) => s + leafShare(b, l), 0);
  const ah = HOME_LEAVES.reduce((s, l) => s + leafShare(a, l), 0);
  rows.push(['**home family**', `**${pct(bh)}**`, `**${pct(ah)}**`, `**${ah - bh >= 0 ? '+' : ''}${(100 * (ah - bh)).toFixed(2)} pts**`]);
  rows.push(['turn-of-retreat (a0-105)', pct(turnOfRetreat(b)), pct(turnOfRetreat(a)), `${turnOfRetreat(a) - turnOfRetreat(b) >= 0 ? '+' : ''}${(100 * (turnOfRetreat(a) - turnOfRetreat(b))).toFixed(2)} pts`]);
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

export function behaviourTables(deepPath: string | null): { census: string; move: string; deepCensus: string } {
  const before = read('tests/reports/a0-121-data/before/roster.json');
  const after = read('tests/reports/a0-121-data/after/roster.json');
  return {
    census: censusTable(after),
    move: moveTable(before, after),
    deepCensus: deepPath ? censusTable(read(deepPath)) : '_(pending)_',
  };
}

if (process.argv.includes('--print')) {
  const t = behaviourTables(null);
  console.log('## Warden lives in the retreat path — the census\n');
  console.log(t.census);
  console.log('\n## Did a0-121 already move it?\n');
  console.log(t.move);
}
