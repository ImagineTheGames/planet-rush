<!-- Raw output of tests/net/capacity/ramp-cli.ts. This is the run behind the
     table in docs/server-capacity.md §2 — kept unedited so the document's
     numbers can be checked against the instrument that produced them.
     Command:
       npx vite-node tests/net/capacity/ramp-cli.ts -- --local --start 4 --step 4 \
         --max 40 --settle 20000 --sample 45000 --baseline 60000 --limit 1000
     The safety line was lifted (--limit 1000) so the whole curve was collected
     rather than stopping at the first breach; the verdict column is therefore
     'ok' throughout by construction and carries no meaning in this run. -->

## Capacity run — 2026-08-07T01:19:21.082Z

**Core:** Intel(R) Core(TM) Ultra 9 285H · 0.0152 ms per 8-station sim step (1100 worlds per core, sim only)

**Target:** local ws://127.0.0.1:40917/play

**Ramp:** start 4, step 4, ceiling 40 · settle 20s · sample 45s · confirm 60s · safety line 1000 ms

**Baseline (0 rooms):** lag 0.89 ms · CPU 0.6% of a core · RSS 62.7 MB

| rooms | live | loop lag median (ms) | loop lag max (ms) | CPU (% of core) | CPU/room (ms/s) | RSS (MB) | snapshot B/s per client | verdict |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 4 | 4 | 1.00 | 1.03 | 5.5 | 12.30 | 96.5 | 4230 | ok |
| 8 | 8 | 1.02 | 1.03 | 6.3 | 7.09 | 101.5 | 4225 | ok |
| 12 | 12 | 3.29 | 4.02 | 8.3 | 6.44 | 104.0 | 4157 | ok |
| 16 | 16 | 6.54 | 6.54 | 9.9 | 5.79 | 106.3 | 4112 | ok |
| 20 | 20 | 6.50 | 6.54 | 11.7 | 5.57 | 106.1 | 4113 | ok |
| 24 | 24 | 4.06 | 4.81 | 13.2 | 5.26 | 107.3 | 4050 | ok |
| 28 | 28 | 6.84 | 20.09 | 14.8 | 5.09 | 108.8 | 4026 | ok |
| 32 | 32 | 6.84 | 20.09 | 16.5 | 4.96 | 108.8 | 4029 | ok |
| 36 | 36 | 10.61 | 10.61 | 17.6 | 4.72 | 110.5 | 4008 | ok |
| 40 | 40 | 5.52 | 5.52 | 19.5 | 4.72 | 110.5 | 3991 | ok |

**Result: the honest N is 40 rooms** — the largest step that held median loop lag under 1000 ms with every room still flying.

### Rooms per guest, and what a room costs

**Inputs:** 4.72 ms CPU/s per room · process floor 5.93 ms CPU/s · 1.2 MB per room over a 63 MB floor · core slowdown ×1 · headroom 70% of the sustained quota

| guest (iad) | sustained quota | RAM | $/mo | rooms (CPU) | rooms (RAM) | **rooms** | bound by | $/room/mo |
|---|---:|---:|---:|---:|---:|---:|---|---:|
| shared-cpu-1x | 6.25% of a core | 256 MB | $1.94 | 8 | 118 | **8** | cpu | $0.24 |
| shared-cpu-1x | 6.25% of a core | 512 MB | $3.19 | 8 | 290 | **8** | cpu | $0.40 |
| shared-cpu-1x | 6.25% of a core | 1024 MB | $5.70 | 8 | 633 | **8** | cpu | $0.71 |
| shared-cpu-2x | 12.5% of a core | 512 MB | $3.89 | 17 | 290 | **17** | cpu | $0.23 |
| shared-cpu-2x | 12.5% of a core | 1024 MB | $6.39 | 17 | 633 | **17** | cpu | $0.38 |
| shared-cpu-4x | 25% of a core | 1024 MB | $7.78 | 35 | 633 | **35** | cpu | $0.22 |
| shared-cpu-8x | 50% of a core | 2048 MB | $15.55 | 72 | 1318 | **72** | cpu | $0.22 |
| performance-1x | 100% of a core | 2048 MB | $31.00 | 147 | 1318 | **147** | cpu | $0.21 |

_Prices: Fly.io published `iad` rates, read 2026-08-07. Quotas: shared sizes are n × 6.25% of a core sustained (burst above that is credit, not capacity); a performance CPU is a dedicated core._

**Advertise:** `capacity = 30` (measured 40, less 25% margin).
