# n3-01 — the region picker, with MEASURED pings

**Branch:** `agent/netcode/n3-region-picker` · **Owner:** Netcode Engineer
**Working note.** Not evidence: the DoD, the PR and QA are what count.
**Design doc:** `docs/region-picker.md` (the reviewable artefact; this file is the
running log).

---

## BUILT

| Commit | What landed |
|---|---|
| `742a026` | `allocator/probe-target.ts` (the vendor seam: where to TIME a region), `/regions` publishes a probe target per region, `src/net/region-probe.ts` (the client measurement), `src/net/cors.ts` (the grant, now shared by allocator **and** match server), `/health` gets a CORS grant + preflight, `readRoomAdvert` in the allocator client. |
| `7a2187f` | Tests: `src/net/region-probe.test.ts` (25), `src/net/cors.test.ts` (9), `tests/allocator/probe-target.test.ts` (8), `/regions` probe cases in `tests/allocator/index.test.ts`, `readRoomAdvert` cases in `src/net/allocator-client.test.ts`, and `tests/net/region-picker.test.ts` — a real allocator + two live `/health` listeners, end to end. |
| `d3390e3` | `src/main.ts` wiring — survey on every visit to the doors, the override into the allocate body, the JOIN preview, the `__onlineMenu` seam — plus `docs/region-picker.md`. |
| `43d62d0` | The probe's deadline now covers reading the body, not just the request (a body that never streams is a hang the deadline missed). |

**DoD:** `npx tsc --noEmit` clean; `npm test -- --run` green on the final tree —
233 files / 3825 tests. **PR:** #305.

**What a player gets, today, without any UI work:** the doors screen's message
slot carries the measured fleet — `GRU 38ms · [IAD 224ms]`, the selection
bracketed — and the JOIN screen says `ROOM IN GRU · YOUR PING 38ms` once a full
code is typed, before commit. CREATE sends the selected region in the allocate
body.

---

## DECISIONS (and what was rejected)

1. **Time `/health` on the match server, not the allocator.** The allocator is one
   process in one region and is deliberately out of the gameplay path; timing it
   would measure the wrong hop. `/health` is the same process, port and datacentre
   as the socket the match will use.

2. **Verify the region that answers; never trust the steer.** Behind Fly's anycast
   edge, every region shares one hostname and the steer is a request header. If the
   edge ignores it, a naive probe reports the nearest POP's latency as that
   region's — a *wrong number*, which is worse than none. `/health` states its own
   `region`, so a mismatch is classified `wrong-region` and prints `—`.
   *Rejected:* trusting `Fly-Prefer-Region` and shipping whatever came back.

3. **Min of 3, not a mean.** The first sample pays TLS and a CORS preflight; a mean
   bakes that into the region's number permanently.

4. **`—`, never `0ms`; and an unmeasured region can never be the default.** With
   nothing measured the allocate sends **no** `region` field at all, so the m10-15a
   edge inference decides — the picker can only ever degrade *back* to the
   behaviour it was added on top of. This is the rule that keeps the old bug from
   coming back in a new coat: the last hard-coded region (`iad`) was not a
   preference but a pin, and it beat the inference.
   *Rejected:* defaulting to the first region in the list when nothing measured.

5. **The vendor lives in one file.** `allocator/probe-target.ts` sits beside
   `router.ts` and has the same shape: Fly steers by header against one hostname,
   direct deployments hand out a Machine's own URL, derived from the same
   `MATCH_URL_TEMPLATE` the socket dial uses — one variable, so the dial and the
   ping cannot point at different fleets. The client knows none of it.

6. **CORS extracted rather than copied.** The probe reads the match server from a
   GitHub Pages origin, so `/health` needed a grant. `src/net/cors.ts` is now the
   one implementation for both processes (the `fleet-auth`/`ticket` precedent).
   *Rejected:* `Access-Control-Allow-Origin: *` on `/health` — the allow-list costs
   nothing and keeps one rule for the whole fleet.

7. **The JOIN preview decides nothing.** `readRoomAdvert` returns `null` for "room
   gone", "allocator down" and "unreadable" alike, because a preview that could
   refuse a join would be a second, weaker gate saying what the join round trip
   already says with better copy (`resolveFailureCopy`).

8. **Re-measure on every visit to the doors**, not once per page load: a ping from
   twenty minutes and one network ago is a stale claim about a live connection.
   Concurrent callers share the probe in flight.

9. **The picker's PLATES are not in this change.** Drawing a row per region with a
   tap target is `src/ui/`'s, which this lane does not touch. The model, the
   measurement, the override path and the `__onlineMenu` seam are all here, plus
   the one text line through the message slot the doors screen already owns. See
   NEXT.

---

## NEXT

* **UI lane (handoff, not a blocker).** Bind a picker row per region to
  `__onlineMenu.regions` / `.selectRegion(id)` / `.regionPickerVisible`. Until then
  the numbers still reach the player as one line, but "one tap to override" has no
  plate to tap — the override path itself is built and tested end to end.
  `src/ui/online-copy.ts`'s `RegionInfo` + `crossRegionWarning` were written for
  this day and need no change.
* **Live check when the fleet passes one region** (it is single-region today, so
  there is nothing to pick between): confirm `Fly-Prefer-Region` actually steers —
  two `curl`s in `docs/region-picker.md` §7. If it does not, every region but the
  nearest reads `—` (the honest failure, not a wrong number) and the fix is a
  per-region host in `MATCH_HEALTH_URL`, a config change in one file.
* **Not blocked on anything.**

---

## RE-VERIFIED (resume, 2026-08-07)

Nothing to build; the branch was already complete and pushed. What a resume
checked, so the next one does not re-check it:

* `npx tsc --noEmit` — clean.
* `npm test -- --run` — 3824/3825. The one failure was
  `tests/net/capacity/capacity-regression.test.ts > the loop stays inside the
  tick budget at 12 rooms` (`215.87 > 33`), which **passes in isolation**
  (`npx vitest run tests/net/capacity/capacity-regression.test.ts` → 4/4, 62s of
  wall clock). It is m11-01's wall-clock perf guard and it measures the tick
  loop under whatever else the box is running; that full-suite run took 410s on
  a loaded machine. **Not this lane** — n3-01 touches the probe, the allocator's
  `/regions`, and the doors/JOIN wiring, none of which is in the tick loop.
  If a future run sees it red, re-run it alone before believing it.
* Branch is 5 ahead / **0 behind** `origin/main` — no merge owed.
* PR #305 open, `MERGEABLE`, head `def6b04` == local `HEAD`.

The only real gap this resume found: `/status/notes/n3-01-...md` (the absolute
path in the brief) was still the blank template while the committed copy under
`status/notes/` held the note. They are two different files on this box — write
**both**.
