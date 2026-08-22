/**
 * evidence/a0-130-bolt-inside-the-band/arms-run.ts — the arm reader's CLI.
 * OWNER: Bot Engineer (brief a0-130).
 *
 *   npx vite-node evidence/.../arms-run.ts <label>[=dir] …
 *
 * Its own file for the reason a0-126's `targets.ts` is a cautionary tale about:
 * a module that runs a CLI at import scope prints its report into the middle of
 * whatever imports it, and `./render.ts` imports this one.
 */

import { main } from './arms';

main(process.argv.slice(2));
