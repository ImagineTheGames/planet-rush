#!/usr/bin/env node
/**
 * evidence/a0-14-hangar/run.mjs — take the a0-14 captures.
 *
 *   node evidence/a0-14-hangar/run.mjs
 *
 * Builds the shipped bundle, serves it on a PRIVATE port (4188 — never the
 * shared 4173, which another lane's stale preview may already be holding), walks
 * the front door to the hangar with a real press on both form factors, and
 * writes the three PNGs and `readback.json` beside this file.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const config = resolve(import.meta.dirname, 'playwright.config.ts');

const run = spawnSync('npx', ['playwright', 'test', '--config', config], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(run.status ?? 1);
