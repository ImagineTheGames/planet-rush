/**
 * The fixture's spec. It is never run by vitest — the repo's `include` globs
 * are `tests/**` and `src/**`, and this lives under `tools/`. It exists to be
 * READ by the scan, as the thing that makes `testedNeverCalled` test-only.
 */
import { testedNeverCalled, proseOnly } from './helpers';

export function fixtureSpec(): boolean {
  // A spec asserting a function production never calls: green forever, and
  // proving nothing about the shipped game. That is the whole bug.
  return testedNeverCalled(2) === 6 && proseOnly(2) === 4;
}
