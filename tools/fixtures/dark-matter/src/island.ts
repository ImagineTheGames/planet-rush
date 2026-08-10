/**
 * An orphan module: no entry point can reach this file, so nothing it exports
 * can run. `islandHelper` IS called — from `island-user.ts`, which is just as
 * unreachable. A scan without reachability counts that as a production call and
 * marks a dead cluster live, every member kept alive by a sibling nobody loads.
 */
export function islandHelper(n: number): number {
  return n * 5;
}
