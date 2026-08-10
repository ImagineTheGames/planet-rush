/** The other half of the orphan cluster — see `./island`. */
import { islandHelper } from './island';

export function islandCaller(n: number): number {
  return islandHelper(n) + 1;
}
