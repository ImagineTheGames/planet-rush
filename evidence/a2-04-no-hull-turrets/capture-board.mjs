/**
 * evidence/a2-04-no-hull-turrets/capture-board.mjs — the board, before and after.
 * OWNER: Art Agent (brief a2-04).
 *
 * Shoots the same DOM sections out of `facility-concepts-r2.html` at
 * `origin/main` and at HEAD, so the turret removal is a comparison rather than a
 * claim. Sections are addressed by selector, so a section that moved shows as a
 * moved crop rather than silently shifting what the pair claims to show.
 *
 * Usage:  node evidence/a2-04-no-hull-turrets/capture-board.mjs
 * (No server: the board is one self-contained file, shot from file://.)
 */
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const BOARD = 'docs/art-direction/facility-concepts-r2.html';
const DSF = 2;

const SECTIONS = [
  { key: 'd-live', sel: '#dir-d .card.wide', note: 'D · the live callout figure — where ANCHOR LUG + TURRET was' },
  { key: 'd-states', sel: '#dir-d .grid3', note: 'D · under siege / derelict / ownership' },
  { key: 'd-keeps', sel: '#dir-d .keeps', note: 'D · the five "keeps" chips' },
  { key: 'e-live', sel: '#dir-e .card.wide', note: 'E · where TURRET on the corner cut was' },
  { key: 'f-live', sel: '#dir-f .card.wide', note: 'F · where TURRET on the rim was' },
  { key: 'defend-card', sel: '.grid6 .card:nth-child(5)', note: 'the DEFEND vocabulary card' },
];

async function shoot(page, url, out) {
  mkdirSync(out, { recursive: true });
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  for (const s of SECTIONS) {
    const el = await page.$(s.sel);
    if (!el) { console.warn(`  MISSING ${s.key} (${s.sel})`); continue; }
    await el.screenshot({ path: join(out, `${s.key}.png`) });
    console.log(`  ${s.key}`);
  }
}

const beforePath = '/tmp/a2-04-board-before.html';
writeFileSync(beforePath, execFileSync('git', ['show', `origin/main:${BOARD}`], { cwd: REPO, maxBuffer: 1 << 28 }));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1240, height: 1000 }, deviceScaleFactor: DSF });
const page = await ctx.newPage();

console.log('BEFORE (origin/main):');
await shoot(page, 'file://' + beforePath, join(HERE, 'board-before'));
console.log('AFTER (HEAD):');
await shoot(page, 'file://' + join(REPO, BOARD), join(HERE, 'board-after'));

// The amendment note is new, so it has no "before" — shot on its own.
await page.goto('file://' + join(REPO, BOARD), { waitUntil: 'load' });
const note = await page.$('#amendment-2026-08-07');
if (note) await note.screenshot({ path: join(HERE, 'board-after', 'amendment-note.png') });

await browser.close();
console.log('\ndone');
