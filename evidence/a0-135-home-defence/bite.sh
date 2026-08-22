#!/usr/bin/env bash
# evidence/a0-135-home-defence/bite.sh — does src/bots/ffa-parity.test.ts still
# bite after a0-135 re-baked its three goldens? OWNER: Bot Engineer (a0-135).
#
# The rule that governs a re-baseline in this repo: *"a golden you re-baked
# without proving it still bites is a deleted test"*. This is a0-120's protocol
# (`evidence/a0-120-parity-bites/bite.txt`) run again on the a0-135 hashes: each
# perturbation is applied to a clean tree, the file is run, and the tree is
# restored. The control at the end is what proves the restore.
#
# Run: bash evidence/a0-135-home-defence/bite.sh 2>&1 | tee evidence/a0-135-home-defence/bite.txt
set -u
cd "$(dirname "$0")/../.." || exit 1

run() { npx vitest run src/bots/ffa-parity.test.ts --reporter=basic 2>&1 | grep -E "^ *(✓|×|→|Tests )" | head -12; }
rule() { printf '\n----------------------------------------------------------------------\n%s\n----------------------------------------------------------------------\n' "$1"; }

echo "a0-135 — does src/bots/ffa-parity.test.ts still bite?"
echo "======================================================================"
echo "Branch $(git rev-parse --abbrev-ref HEAD), HEAD $(git rev-parse --short HEAD)."
echo "Goldens under test: f01248a1 / 7b967ee1 / 11bfa3bd (seeds 20260806 / 7 / 991)."

rule "0. CONTROL — the branch as committed, untouched"
run

rule "1. WORLD_SIZE 2400 -> 2401 — one world unit (a0-120 §1, reproduced)"
cp src/sim/constants.ts /tmp/a0135-constants.bak
sed -i 's/export const WORLD_SIZE: Tunable<number> = 2400;/export const WORLD_SIZE: Tunable<number> = 2401;/' src/sim/constants.ts
run
cp /tmp/a0135-constants.bak src/sim/constants.ts

rule "2. A BOT perturbation — Rusty's caution 1.3 -> 0.2 (a0-120 §3b, reproduced)"
cp src/bots/personalities.ts /tmp/a0135-personalities.bak
sed -i '0,/caution: 1.3,/s//caution: 0.2,/' src/bots/personalities.ts
run
cp /tmp/a0135-personalities.bak src/bots/personalities.ts

rule "3. CONTROL — the tree restored, which is what says 1 and 2 were the perturbations"
run
git diff --quiet src/sim/constants.ts src/bots/personalities.ts && echo "  (tree clean: both files byte-identical to the commit)" || echo "  !! TREE NOT RESTORED"
