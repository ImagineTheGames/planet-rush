#!/usr/bin/env bash
# evidence/a0-126-the-last-two-points/run.sh — one section, sharded across cores.
# OWNER: QA Agent (brief a0-126).
#
#   run.sh <label> <section> <seeds> <shards> [sed-expr …]
#
# Patches src/sim/constants.ts with the sed exprs, runs `mirrors <section>` as
# <shards> processes over disjoint seed spans, merges them, restores the tree.
# Sequential across labels by construction — the tree is the experiment, so two
# labels may never overlap — but parallel *within* a label, because a shard reads
# nothing but its own seed (harness/mirrors `mergeSections`, and the identity
# proof in shard-identity.txt).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
LABEL=$1; SECTION=$2; SEEDS=$3; SHARDS=$4; shift 4
OUT="tests/reports/a0-126-data/$LABEL"
TMP="/tmp/a0-126-shards/$LABEL"
trap 'git checkout -- src/sim/constants.ts' EXIT
for e in "$@"; do sed -i "$e" src/sim/constants.ts; done
echo "--- $LABEL · $SECTION · seeds 1..$SEEDS · $SHARDS shards ---"
git diff --stat src/sim/constants.ts | tail -1
rm -rf "$TMP"; mkdir -p "$TMP" "$OUT"

per=$(( (SEEDS + SHARDS - 1) / SHARDS ))
pids=(); parts=()
for ((i = 0; i < SHARDS; i++)); do
  from=$(( 1 + i * per ))
  (( from > SEEDS )) && break
  n=$(( per )); (( from + n - 1 > SEEDS )) && n=$(( SEEDS - from + 1 ))
  npx vite-node harness/cli.ts mirrors "$SECTION" --seeds "$n" --from "$from" --data "$TMP/s$i" \
    > "$TMP/s$i.log" 2>&1 &
  pids+=($!); parts+=("$TMP/s$i/$SECTION.json")
done
fail=0
for p in "${pids[@]}"; do wait "$p" || fail=1; done
if (( fail )); then echo "SHARD FAILED — logs in $TMP"; tail -5 "$TMP"/*.log; exit 1; fi
npx vite-node evidence/a0-126-the-last-two-points/merge.ts "$OUT/$SECTION.json" "${parts[@]}"
