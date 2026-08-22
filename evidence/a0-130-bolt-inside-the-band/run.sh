#!/usr/bin/env bash
# evidence/a0-130-bolt-inside-the-band/run.sh — one arm, sharded across cores.
# OWNER: Bot Engineer (brief a0-130). Shape borrowed from a0-126's run.sh, with
# two substitutions: the tree this brief perturbs is the **cast**, so the file it
# patches is `src/bots/` (this lane's) rather than `src/sim/constants.ts` (QA's);
# and an arm can be a whole different *tree*, not only a different constant, so
# there is a `--ref` mode that checks `src/bots/` out of another commit.
#
#   run.sh <label> <pools> <seeds> <shards> [--ref REF] [sed-expr …]
#
#   pools     easy | medium | hard | roster | class  (see ./section.ts)
#   --ref     run the arm against `src/bots/` as of REF — this is how the
#             *shipped* baseline is measured after the candidate has been
#             committed, on the same seeds, from the same script.
#   sed-expr  applied to src/bots/personalities.ts, for weight-only arms.
#
# Sequential across labels by construction — the cast IS the experiment, so two
# labels may never overlap — but parallel *within* a label, because a shard reads
# nothing but its own seed (`harness/mirrors` `mergeSections`, and a0-126's
# identity proof, re-run for this runner in ./shard-identity.txt).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
LABEL=$1; POOLS=$2; SEEDS=$3; SHARDS=$4; shift 4
REF=""
if [[ "${1:-}" == "--ref" ]]; then REF=$2; shift 2; fi
case "$POOLS" in roster) ART=roster ;; class) ART=class ;; *) ART=tier ;; esac
OUT="tests/reports/a0-130-data/$LABEL"
TMP="/tmp/a0-130-shards/$LABEL"

# A dirty src/bots would silently become part of the arm and there would be no
# record of what ran. Refuse rather than measure something nobody can rebuild.
if ! git diff --quiet -- src/bots || ! git diff --cached --quiet -- src/bots; then
  echo "REFUSING: src/bots has uncommitted changes — commit them, then name the arm with --ref."
  exit 1
fi
trap 'git checkout -q HEAD -- src/bots' EXIT
[[ -n "$REF" ]] && git checkout -q "$REF" -- src/bots
for e in "$@"; do sed -i "$e" src/bots/personalities.ts; done
echo "--- $LABEL · pools $POOLS · seeds 1..$SEEDS · $SHARDS shards${REF:+ · src/bots @ $REF} ---"
git diff --stat -- src/bots | tail -1
rm -rf "$TMP"; mkdir -p "$TMP" "$OUT"

per=$(( (SEEDS + SHARDS - 1) / SHARDS ))
pids=(); parts=()
for ((i = 0; i < SHARDS; i++)); do
  from=$(( 1 + i * per ))
  (( from > SEEDS )) && break
  n=$(( per )); (( from + n - 1 > SEEDS )) && n=$(( SEEDS - from + 1 ))
  npx vite-node evidence/a0-130-bolt-inside-the-band/section.ts $POOLS \
    --seeds "$n" --from "$from" --data "$TMP/s$i" > "$TMP/s$i.log" 2>&1 &
  pids+=($!); parts+=("$TMP/s$i/$ART.json")
done
fail=0
for p in "${pids[@]}"; do wait "$p" || fail=1; done
if (( fail )); then echo "SHARD FAILED — logs in $TMP"; tail -5 "$TMP"/*.log; exit 1; fi
npx vite-node evidence/a0-126-the-last-two-points/merge.ts "$OUT/$ART.json" "${parts[@]}"
