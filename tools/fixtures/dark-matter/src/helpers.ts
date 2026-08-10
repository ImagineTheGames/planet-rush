/**
 * The fixture's leaf module. Every export here is one of the traps the scan
 * has to get right — see tests/tools/dark-matter-scan.test.ts for the
 * assertions, and each export's own comment for what it is standing in for.
 */

/**
 * LIVE. Called by `main.ts`. The control: if this ever reports dark, the scan
 * is broken in the direction that matters least and is noticed soonest.
 */
export function calledByMain(n: number): number {
  return n + 1;
}

/**
 * DARK — the `matchAbundance` case, distilled. Referenced by name in prose from
 * a production file ({@link proseOnly} is mentioned in `main.ts`'s comments and
 * in this very JSDoc line) and called by nobody. A grep finds "callers"; the
 * scan must find none.
 */
export function proseOnly(n: number): number {
  return n * 2;
}

/** DARK. `main.ts` imports it and never calls it — half-finished wiring. */
export function importedNeverCalled(n: number): number {
  return n - 1;
}

/** DARK, hint `test-only`: only the fixture's spec calls it. */
export function testedNeverCalled(n: number): number {
  return n * 3;
}

/** DARK, hint `unreferenced`: nothing anywhere names it. */
export const NEVER_NAMED = 41;

/** LIVE by way of a shadowing trap: `main.ts` declares its own local named
 *  `shadowed`, and that local must not be mistaken for a use of this one.
 *  Nothing else calls it, so it is DARK — a text search would say otherwise. */
export function shadowed(): string {
  return 'the exported one';
}

/** Used by its own module (below), so the code runs and only the `export` is
 *  too wide: hint `self-used`, and out of the CI gate's scope. */
export function selfUsed(n: number): number {
  return n + 100;
}

/** LIVE. Calls `selfUsed`, which is what makes that one `self-used`. */
export function callsSelfUsed(n: number): number {
  return selfUsed(n);
}
