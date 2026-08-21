#!/usr/bin/env bash
# Patch src/sim/constants.ts, run one mirrors section, restore. Sequential by
# construction: the tree is the experiment, so two runs may never overlap.
#   run.sh <label> <section> <seeds> [sed-expr ...]
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
LABEL=$1; SECTION=$2; SEEDS=$3; shift 3
trap 'git checkout -- src/sim/constants.ts' EXIT
for e in "$@"; do sed -i "$e" src/sim/constants.ts; done
echo "--- $LABEL ---"
git diff --stat src/sim/constants.ts | tail -1
mkdir -p "tests/reports/a0-121-data/$LABEL"
npx vite-node harness/cli.ts mirrors "$SECTION" --seeds "$SEEDS" --data "tests/reports/a0-121-data/$LABEL" 2>&1 | tail -3
