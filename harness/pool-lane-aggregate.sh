#!/usr/bin/env bash
# harness/pool-lane-aggregate.sh — three lanes, one box, time until all are done.
# OWNER: QA Agent (a0-00c).
#
# This is the measurement a0-00c is actually about, and the one the spinner rig
# next door cannot make.
#
# ── why the obvious measurement says nothing ──────────────────────────────────
#
# `pool-contention-bench.sh` holds a fixed competing load and times one lane's
# suite. Run the arithmetic on what that measures and it collapses: the Linux
# scheduler splits the box between *runnable threads*, so
#
#     uncapped:  6 own workers / (6 + 12 competing) = 1/3 of 6 cores = 2 cores
#     capped:    2 own workers / (2 +  4 competing) = 1/3 of 6 cores = 2 cores
#
# Both arms hand this lane exactly two cores' worth. The comparison is rigged to
# come out flat before a single test runs, and whatever difference does appear is
# scheduling overhead plus whatever the neighbouring lanes happened to be doing.
# It is a fair-share result, not a throughput result — worth reporting as the
# reason a single lane's wall time is NOT where the win lives, and worth not
# mistaking for the win itself.
#
# ── what this measures instead ────────────────────────────────────────────────
#
# The claim is about the box, not about one lane: three lanes each spawning a
# pool sized for the whole container oversubscribe it 3x, and everyone finishes
# late. So run three lanes for real and time the last one home.
#
# Each of the three gets a DISJOINT third of the suite (`vitest --run --shard`),
# which does two things: no two runs execute the same spec, so they cannot
# collide over a test artifact and manufacture red that belongs to the
# instrument; and the total CPU work is held constant across both arms at
# exactly one suite. Only the worker count differs:
#
#     before:  3 shards x 6 workers = 18 workers on 6 cores
#     after:   3 shards x 2 workers =  6 workers on 6 cores
#
# Same specs, same assertions, same total work, same commit. The only variable is
# how many workers the box is asked to hold at once, which is the one thing this
# change touches.
#
# Usage:  bash harness/pool-lane-aggregate.sh <label> <workers-per-lane>

set -uo pipefail

LABEL="${1:?usage: aggregate.sh <label> <workers-per-lane>}"
WORKERS="${2:?}"
SHARDS=3

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

PIDS=()
STARTS=()
cleanup() {
  for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null; done
}
trap cleanup INT TERM

LOAD_START="$(cut -d' ' -f1 /proc/loadavg)"
START="$(date +%s)"

for i in $(seq 1 "$SHARDS"); do
  (
    VITEST_MAX_WORKERS="$WORKERS" npx vitest --run --reporter=dot \
      --shard="${i}/${SHARDS}" > "/tmp/agg-${LABEL}-shard${i}.log" 2>&1
    echo "$? $(date +%s)" > "/tmp/agg-${LABEL}-shard${i}.done"
  ) &
  PIDS+=($!)
done

# The number that matters: when the LAST lane finishes. A lane that finishes
# early has not helped anyone if the sweep is still blocked on its neighbour.
wait
END="$(date +%s)"
LOAD_END="$(cut -d' ' -f1 /proc/loadavg)"
WALL=$((END - START))

WORST_RC=0
PER_SHARD=""
for i in $(seq 1 "$SHARDS"); do
  read -r rc endts < "/tmp/agg-${LABEL}-shard${i}.done"
  [ "$rc" -ne 0 ] && WORST_RC="$rc"
  PER_SHARD="${PER_SHARD}${i}:$((endts - START))s(rc=${rc}) "
done

printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
  "$LABEL" "$WORKERS" "$((WORKERS * SHARDS))" "$WALL" "$WORST_RC" "$LOAD_START" "$LOAD_END"
{
  echo "── ${LABEL}: 3 lanes x ${WORKERS} workers = $((WORKERS * SHARDS)) on 6 cores ──"
  echo "   all done in ${WALL}s   worst rc=${WORST_RC}   load ${LOAD_START} -> ${LOAD_END}"
  echo "   per shard: ${PER_SHARD}"
} >&2
