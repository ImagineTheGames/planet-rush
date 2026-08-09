#!/usr/bin/env bash
# harness/pool-contention-bench.sh — measure the test suite under a KNOWN load.
# OWNER: QA Agent (a0-00c).
#
# The number a0-00c is judged on is contention, not a single run: a lane's suite
# with two other lanes busy, before and after the worker cap. The trap in
# measuring that opportunistically is that "two other lanes busy" is not a
# constant — over the course of one afternoon the studio box drifted between
# load 8 and load 17, and a before/after pair taken at those two loads compares
# the weather, not the change. (Measured 2026-08-09: the *uncapped* run came in
# at 214 s on a load-8 box and the *capped* run at 574 s on a load-17 box, which
# reads exactly backwards from the truth.)
#
# So this script supplies the competing load itself. Each of the other two lanes
# is modelled as its worker demand — one busy process per worker it would spawn —
# which is the only thing about a neighbouring lane that this change affects:
#
#     before:  2 other lanes x 6 uncapped workers = 12 spinners,  self at 6
#     after:   2 other lanes x 2 capped   workers =  4 spinners,  self at 2
#
# Spinners rather than three real suite runs on purpose: three vitest runs in one
# working tree collide over test artifacts and produce red that is an artifact of
# the measurement rather than of the code. CPU demand is what oversubscribes the
# box, and CPU demand is what this reproduces — deterministically, and without
# writing to another lane's tree.
#
# Usage:  bash harness/pool-contention-bench.sh <label> <self-workers> <spinners>
# Prints one line of TSV to stdout and a human summary to stderr. Wall time is
# the whole `vitest --run`, process start to exit, which is what a lane's DoD
# actually waits on.
#
# It kills only the PIDs it started. It never touches another lane's processes.

set -uo pipefail

LABEL="${1:?usage: bench.sh <label> <self-workers> <spinners>}"
WORKERS="${2:?}"
SPINNERS="${3:?}"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

PIDS=()
cleanup() {
  for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null; done
  wait 2>/dev/null
}
trap cleanup EXIT INT TERM

# The competing lanes. A bare shell spin loop: no allocation, no I/O, nothing but
# a runnable thread the scheduler has to find a core for — which is precisely the
# resource an oversized worker pool takes from its neighbours.
for _ in $(seq 1 "$SPINNERS"); do
  bash -c 'while :; do :; done' &
  PIDS+=($!)
done

# Let the load settle so the suite starts against the load it is meant to face,
# not against a box still ramping up.
[ "$SPINNERS" -gt 0 ] && sleep 10

LOAD_START="$(cut -d' ' -f1 /proc/loadavg)"
START="$(date +%s)"
VITEST_MAX_WORKERS="$WORKERS" npx vitest --run --reporter=dot > "/tmp/bench-${LABEL}.log" 2>&1
RC=$?
END="$(date +%s)"
LOAD_END="$(cut -d' ' -f1 /proc/loadavg)"
WALL=$((END - START))

FILES="$(grep -oE 'Test Files.*' "/tmp/bench-${LABEL}.log" | head -1)"
TESTS="$(grep -oE 'Tests  .*' "/tmp/bench-${LABEL}.log" | head -1)"

printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
  "$LABEL" "$WORKERS" "$SPINNERS" "$WALL" "$RC" "$LOAD_START" "$LOAD_END"
{
  echo "── ${LABEL}: ${WORKERS} workers, ${SPINNERS} competing ──"
  echo "   wall ${WALL}s   rc=${RC}   load ${LOAD_START} -> ${LOAD_END}"
  echo "   ${FILES}"
  echo "   ${TESTS}"
} >&2
