#!/usr/bin/env bash
# a0-121 — does src/bots/ffa-parity.test.ts still bite after the re-baseline?
#
# The brief's rule: "a golden you re-baked without proving it still bites is a
# deleted test." So each block applies ONE perturbation to the branch tree, runs
# the file, and restores. Block 0 is the control; the last block proves the
# restore. The perturbations are chosen to be the classes of change these three
# hashes exist to catch: an arena change, a class-table change, and a bot
# personality weight — one from each lane that can move a shipped match.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
C=src/sim/constants.ts
P=src/bots/personalities.ts
restore() { git checkout -- "$C" "$P" 2>/dev/null || true; }
trap restore EXIT

run() {
  echo "----------------------------------------------------------------------"
  echo "$1"
  echo "----------------------------------------------------------------------"
  npx vitest run src/bots/ffa-parity.test.ts 2>&1 |
    grep -E "^\s+(✓|×|→)|Tests  " | sed 's/^/   /'
  echo
  restore
}

echo "a0-121 — does src/bots/ffa-parity.test.ts still bite?"
echo "======================================================================"
echo "Branch $(git rev-parse --abbrev-ref HEAD), HEAD $(git rev-parse --short HEAD)."
echo "Each block: one perturbation applied to the branch tree, then the tree restored."
echo "The three goldens ARE re-baselined by a0-121 (the excavator's turnMul moved), so"
echo "these blocks prove the NEW hashes bite, not the old ones."
echo

run "0. CONTROL — the branch tree, untouched (the re-baselined hashes)"

sed -i 's/^export const WORLD_SIZE: Tunable<number> = 2400;/export const WORLD_SIZE: Tunable<number> = 2401;/' "$C"
run "1. WORLD_SIZE 2400 -> 2401 — one world unit (a0-117 §4 / a0-120 §1, reproduced)"

sed -i 's/\(\[ShipClass.Excavator\]: { speedMul: 0.9, accelMul: 1.0, turnMul: \)0.25/\10.26/' "$C"
run "2. the excavator's turnMul 0.25 -> 0.26 — one hundredth of the cell a0-121 moved"

sed -i 's/^export const BASE_TURN_RATE: Tunable<number> = 6.5;/export const BASE_TURN_RATE: Tunable<number> = 6.4;/' "$C"
run "3. BASE_TURN_RATE 6.5 -> 6.4 — the base the whole cast turns at"

sed -i 's/\(\[ShipClass.Interceptor\]: { speedMul: 1.3, accelMul: 1.2, turnMul: \)1.4/\11.41/' "$C"
run "4. the INTERCEPTOR's turnMul 1.4 -> 1.41 — a hull a0-121 did NOT touch"

run "5. CONTROL AGAIN — proves every restore above took"
