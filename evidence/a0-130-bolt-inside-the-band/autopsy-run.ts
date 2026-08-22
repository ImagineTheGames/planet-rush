/**
 * evidence/a0-130-bolt-inside-the-band/autopsy-run.ts — the autopsy's CLI.
 * OWNER: Bot Engineer (brief a0-130).
 *
 *   npx vite-node evidence/.../autopsy-run.ts [seeds] > autopsy.txt
 *
 * Two lines, and they are their own file for one reason: `./autopsy.ts` is
 * imported by `tests/harness/a0-130-easy-pool.test.ts`, and a module that runs
 * a hundred and twenty-eight full matches at import time turns a four-match
 * test into a seven-minute one.
 */

import { report } from './autopsy';

report(Number(process.argv[2] ?? 64));
