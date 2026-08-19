/**
 * evidence/a0-98-corner-collisions-everywhere-else/table.mjs — OWNER: UI Engineer (a0-98).
 *
 * Turn the capture's JSON into the PR's cross-product table: **state × viewport ×
 * topmost element at each control's reported point**. Written rather than
 * hand-typed so the table in the PR body and the numbers under `shots/` cannot
 * drift, and so a reviewer can regenerate either stage:
 *
 *   node evidence/a0-98-corner-collisions-everywhere-else/table.mjs broken
 *   node evidence/a0-98-corner-collisions-everywhere-else/table.mjs fixed --full
 *
 * ── HOW IT IS SCOPED, AND WHY ───────────────────────────────────────────────
 * The brief asks for *"every state in which the offer is SHOWN, crossed with what
 * the client draws in the bottom-right corner of that screen"*. So:
 *
 *  - A state where the offer stands gets **one row per control** the client
 *    reported drawing — the whole cross-product, nothing summarised.
 *  - A state where the offer was never mounted collapses to **one row**. There is
 *    no cross-product to take against a button that is not on the screen, and
 *    1,135 rows of `CANVAS#app` would bury the eleven that matter.
 *
 * `--full` prints every control of every state anyway, for the record.
 *
 * Controls that were DRAWN but not pressable are marked rather than counted. While
 * the pause overlay is up, `main.ts` pointerdown consumes every press before the
 * match sees it, so the minimap under it is paint, not a control — and "nothing was
 * covered" and "nothing LIVE was covered" are different findings. Blurring them
 * would be the same mistake a0-97 was cleaning up.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const stage = process.argv[2] ?? 'broken';
const full = process.argv.includes('--full');
const dir = join(HERE, 'shots', stage);

const box = (r) =>
  r ? `x${Math.round(r.x)}–${Math.round(r.x + r.width)} y${Math.round(r.y)}–${Math.round(r.y + r.height)}` : '';

const offerOf = (log) =>
  !log?.mounted ? 'never mounted' : log.hidden ? 'mounted, **withdrawn**' : `**SHOWN** ${box(log.rect)}`;

const verdictOf = (c) => {
  if (c.collides) return '**COLLISION**';
  if (!c.onScreen) return 'not probed — off-viewport';
  if (!c.live) return 'covered, but nothing routes a press here';
  return 'clear';
};

const rows = [];
for (const f of readdirSync(dir).filter((n) => n.endsWith('-report.json')).sort()) {
  for (const r of JSON.parse(readFileSync(join(dir, f), 'utf8')).reports ?? []) {
    const shown = r.log?.mounted && r.log.hidden === false;
    const offer = offerOf(r.log);
    const controls = r.controls ?? [];
    if (!shown && !full) {
      const note = r.context?.unreached
        ? `not reached — ${String(r.context.unreached).split('\n')[0]}`
        : `${controls.length} controls drawn; the offer is not on this screen`;
      rows.push([r.state, r.profile, offer, '—', '—', note]);
      continue;
    }
    if (controls.length === 0) {
      rows.push([r.state, r.profile, offer, '—', '—', 'no control reported on screen']);
      continue;
    }
    for (const c of controls) {
      rows.push([
        r.state,
        r.profile,
        offer,
        `\`${c.control}\`${c.live ? '' : ' *(drawn, not live)*'} @ ${c.page.x},${c.page.y}`,
        `\`${c.topmost}\`${c.coveredFraction ? ` · ${Math.round(c.coveredFraction * 100)}% under the offer` : ''}`,
        verdictOf(c),
      ]);
    }
  }
}

const head = ['state', 'viewport', 'the offer', 'control, at the point the client reports', 'topmost there', 'verdict'];
console.log(`| ${head.join(' | ')} |`);
console.log(`| ${head.map(() => '---').join(' | ')} |`);
for (const r of rows) console.log(`| ${r.join(' | ')} |`);
console.error(`\n${rows.length} rows, ${rows.filter((r) => r[5].includes('COLLISION')).length} collisions (${stage}${full ? ', full' : ''})`);
