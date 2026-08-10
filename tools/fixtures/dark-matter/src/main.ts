/**
 * The fixture's entry point — the only door the scan is told to walk in
 * through, so reachability is decided from here.
 *
 * Note what this file says about `proseOnly`: it is named in this comment, and
 * that is the whole point. `proseOnly` is never called from anywhere. A text
 * search for it lands here and in its own JSDoc and reads as two callers.
 */

// Through the barrel, so `./barrel` and everything it forwards IS reachable —
// which is what makes `forwardedNeverUsed` a re-export finding rather than an
// orphan one. Reachability is decided before use-counting, and it outranks it.
import { calledByMain } from './barrel';
import { importedNeverCalled, shadowed } from './helpers';
import { defineThing } from './config-shape';

// `importedNeverCalled` is imported directly above and deliberately not called.
// `shadowed` likewise — the local below takes the name.

export function boot(): number {
  // A local binding with the same name as an export of `./helpers`. Resolving
  // by identifier text would count this as a use of the exported `shadowed`.
  const shadowed = () => 'the local one';
  return calledByMain(1) + shadowed().length;
}

/**
 * A call inside `export default …`. The whole expression sits under an
 * ExportAssignment, and treating that as re-export plumbing was a real bug in
 * this scan: `vite.config.ts` calls `defineBuildInfo` exactly this way on every
 * build, and it was reported dark. This is the regression guard.
 */
export default defineThing({ value: boot() });
