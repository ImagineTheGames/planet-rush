#!/usr/bin/env bash
# evidence/a0-130-bolt-inside-the-band/shard-identity.sh — the sharded runner IS
# the long run. OWNER: Bot Engineer (brief a0-130).
#
# a0-126 proved this for `harness/cli mirrors`; this brief runs a different
# script (`./section.ts`), so the proof is re-run for it rather than inherited.
# Sixteen seeds of the Easy pool as one process and as four shards merged: the
# artifacts must be byte-identical, because `runBotMatch(seed, slots)` reads
# nothing but its own two arguments.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
S=evidence/a0-130-bolt-inside-the-band/section.ts
TMP=/tmp/a0130-id
rm -rf "$TMP"; mkdir -p "$TMP"

echo "=== shard identity: 16 seeds of the Easy pool, one process vs four ==="
echo "--- block 1: one process, seeds 1..16 ---"
npx vite-node "$S" easy --seeds 16 --from 1 --data "$TMP/whole" | tail -1

echo "--- block 2: four shards of four seeds each ---"
for i in 0 1 2 3; do
  npx vite-node "$S" easy --seeds 4 --from $((1 + i * 4)) --data "$TMP/s$i" > "$TMP/s$i.log" 2>&1 &
done
wait
npx vite-node evidence/a0-126-the-last-two-points/merge.ts "$TMP/merged/tier.json" \
  "$TMP/s0/tier.json" "$TMP/s1/tier.json" "$TMP/s2/tier.json" "$TMP/s3/tier.json"

echo "--- block 3: do they agree, byte for byte? ---"
# `label` records what was asked for and differs by construction (one process was
# asked for 16 seeds, a shard for 4); every match row, seed list, rotation count
# and telemetry pool below it must not.
jq -S 'del(.label)' "$TMP/whole/tier.json" > "$TMP/a.json"
jq -S 'del(.label)' "$TMP/merged/tier.json" > "$TMP/b.json"
if cmp -s "$TMP/a.json" "$TMP/b.json"; then
  echo "IDENTICAL — the merged shards are the whole run, byte for byte."
else
  echo "DIFFER — the sharded runner is not the long run. Every table in this report is void."
  diff <(head -50 "$TMP/a.json") <(head -50 "$TMP/b.json") | head -20
  exit 1
fi
