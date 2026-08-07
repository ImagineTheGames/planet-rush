# r7-01-unstick-n3-region-picker.md — working notes (netcode)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

## BUILT

- **`c3e53b8`, `f26aae4`, `e045b06` — three merges of `origin/main`.** Main moved
  under this branch twice more while the brief was being worked. `e045b06` is the
  current one: it brings `u7-06`'s upgrade wheel (`eb75891`, PR #300) — new
  `src/ui/` work, `tests/mobile/upgrade-wheel-gantry.spec.ts`, four new upgrade
  wheel baselines and a `style-guide.md` edit. Clean, zero conflicts, and it
  touches nothing of mine: `git diff HEAD^1 HEAD -- src/net/ server/ allocator/
  tests/net/ docs/` is empty.

- **`5dac226` — the joiner waits for its own welcome.** A genuine race in
  `tests/net/online-lobby-flow.test.ts`, found because the full unit suite went
  red under load. Detail below; it is my file and it is now correct.

## DECISIONS

### The brief's diagnosis is wrong, and the evidence excludes it

The brief says #305's red golden — `[iphone] goldens.spec.ts › golden: landscape
phone BUILD WHEEL` — is a stale baseline judged against `a3-01`'s new render, and
that merging main brings the new baseline. **It does not, because there is no new
baseline for that test.** `496a215` re-baselined seven files and
`phone-landscape-build-wheel-iphone-linux.png` is not one of them. Re-verified
this session across all three trees:

```
pre-merge HEAD^1 : 39548c3133a67155ce08b3949f42138bc30534f9
origin/main      : 39548c3133a67155ce08b3949f42138bc30534f9
merged HEAD      : 39548c3133a67155ce08b3949f42138bc30534f9
```

Byte-identical. The merge cannot change what that golden compares against, so the
stale-baseline theory is not merely unsupported — it is excluded.

### What the red actually was: the clock, and q9-01's retry has now landed

The CI failure line was `Test timeout of 90000ms exceeded.`, not a pixel
mismatch. Two independent confirmations stand from the previous session: the
run's artifact holds two trace zips and **zero** actual/expected/diff PNGs (a
test that dies before comparing writes none), and the decoded trace accounts for
all 90 s with the shot itself getting 29.8 s of its 45 s entitlement before the
*test* clock killed it. The runner took **47.4 min** for a suite budgeted at
8.9 min — ~5× off-model on top of the 10× `CI_SLOW_FACTOR` already pays.

The fix was QA's, not mine: `GOLDEN_RETRIES = 2` scoped to `goldens.spec.ts`.
The previous session escalated it as unmerged; **it has since landed** (`d2797dc`,
PR #311) and this branch inherited it at `f26aae4`. That escalation is closed. I
did not touch `tests/mobile/` at any point.

### The unit suite went red on a race that is mine — fixed, and measured first

`npm test -- --run` failed on `tests/net/online-lobby-flow.test.ts > "the model
refuses a guest"`: `pressRush` was ACCEPTED from a guest, so the identity
assertion that nothing moved failed. Not a merge break — the file had not been
touched since `ab710d1`, well before any of this.

**The barrier was one hop too early.** The tests waited on `room.humanCount === 2`
— the SERVER's count, which rises when the socket is seated — and then read
`guestSession.you` on the next line. `OnlineSession.player` starts at `0`
(`src/net/session.ts:208`) and is only assigned when the `welcome` is read
(`:635`). A guest opened inside that window builds its lobby with `you: 0`; the
room's creator IS player 0, so `you === host`, `isHost` is true, and the guest's
model believes it is the CREATOR. Every host-only rule inverts silently —
`pressRush` accepted, `isYou` landing on the host's seat, bot difficulties and
match shape riding out from a client with no business sending them.

**Measured before fixing, because "plausible" is not "true".** A scratch probe
(written, run, then deleted — it asserted nothing worth keeping) polled at
event-loop granularity instead of through `until`'s 10 ms sleep:

| poll granularity | guest still holds host's id at `humanCount===2` |
|---|---|
| `until`'s 10 ms sleep | **0 / 25** rounds |
| `setImmediate` (true width) | **25 / 25** rounds, settling in 1 event-loop turn |

So the window is *always* open and is normally covered by that 10 ms sleep. That
is why it is invisible on a quiet box — **37/37 isolated runs passed**, including
12 deliberately run against the unfixed file — and bites only when the loop is
saturated and a timer fires before the socket read is serviced. The original
failure dump corroborates it independently: the guest's lobby printed `you: 0`
**and** the host's `vanguard` hull, which is exactly what `applyLobbySlots`
produces for a guest that believes it is seat 0.

`welcomed()` waits for the state the assertions actually depend on — the two
sessions disagreeing about who they are, since two live humans in one room never
share an id. Applied at all five joiner sites. **No assertion weakened, no budget
moved**; it is the same correction as `e7134cb` in this very file ("wait for the
sample the assertion is about, not for one that exists").

This is the opposite of the capacity case below, and the distinction is the whole
point: fixing a test's synchronisation makes it assert what it claims; moving a
threshold makes it assert less.

### What I did NOT do

* **Did NOT re-baseline.** Forbidden by the brief, and independently wrong: there
  is no pixel disagreement on record to fix, and re-shooting from this branch
  would overwrite `a3-01`'s deliberate colour decision with a frame nobody
  looked at. `git diff --stat origin/main HEAD -- tests/mobile/` is empty.
* **Did NOT touch `tests/mobile/`** — QA's, including the `measuredSeconds: 9`
  that makes this the most marginal golden in the matrix.
* **Did NOT touch the capacity gate.** See below.

### The capacity gate is wrong, still, and it is not this brief's to fix

`tests/net/capacity/capacity-regression.test.ts` asserts an absolute
`maxLagMs < 33`. Readings on this host, same box, over the session:

| tree | maxLagMs | load |
|---|---|---|
| `origin/main` @ `81f5b76`, clean | 114.66 | 31–50 |
| this branch, earlier | 56.96 | 31–50 |
| this branch, this session | 34.23 → **passed on re-run** | 29 → 8.5 |

It tracks box load, not code — main read *worse* than my branch. `m11-01` already
decided the design question from measurement on this host and wrote it down: the
CI gate "is a CPU gate (normalised to a bare sim step, so it is portable across
runners) and **not a lag gate**". The CI-able subset kept an absolute lag gate
anyway. That inconsistency is the actual bug, and the file's own normalised gate
passed comfortably throughout (1.4× a sim step against a budget of 12).

The right fix mirrors the ramp's `baselineExceedsLimit`: measure the host's idle
loop-lag floor and hold the assertion only where the reading means something.
That is a re-measurement job — the file says budgets move "only with a
re-measured `docs/server-capacity.md` in the same commit" — and weakening a
server capacity gate inside an unrelated region-picker unstick is how a real 2×
regression walks in later. Reported, not silenced.

### :4173 is contended across lanes, and the check has to be a fingerprint

`playwright.config.ts` hardcodes `PREVIEW_PORT = 4173` with
`reuseExistingServer: !process.env.CI`. A previous session found **lane-1's**
preview holding it; a mobile run then would have described lane-1's bundle while
being reported as mine, green or red, with nothing in the output saying so. That
is almost certainly what poisoned the previous session's "before" run (4 failed /
92 passed, a red set sharing nothing with the CI red it was meant to reproduce).

This session lane-1 had moved to 4193 and :4173 was **lane-3's own**. Verified by
fingerprint rather than by ownership, because `vite preview` serves from disk and
a preview started before a rebuild silently begins serving the new bundle:

```
served :4173 = 1e6e2d8da64dcf8f60cc97efc0de4230
dist on disk = 1e6e2d8da64dcf8f60cc97efc0de4230   → MATCH, post-merge build
```

Two traps worth keeping: `ss`/`netstat` return nothing in this sandbox, so a port
check must be curl + fingerprint rather than a socket list; and the preview binds
**IPv6-only**, so `curl 127.0.0.1:4173` returns `000` while `localhost` returns
200 — a v4-only probe reports "free" for a port that is very much taken.

## NEXT

### State of the DoD

| line | result |
|---|---|
| `npx tsc --noEmit` | **green** |
| `npm test -- --run` | **green — 233 files, 3881 tests, 0 failed** |
| `npm run test:mobile` | in flight against this lane's verified build |
| `git merge-base --is-ancestor origin/main HEAD` | **green** (`e045b06`) |

### Remaining

1. Record the mobile summary line and put the before/after into PR #305's body,
   with the blob-identity proof.
2. The suite is now **207 tests locally**, not 96 — u7's merged
   `upgrade-wheel-gantry.spec.ts` and four new baselines. A summary line from
   before the merge is not comparable on count; the comparable fact is the named
   golden's verdict and the absence of any snapshot in the diff.
3. If the wheel golden fails again, check for the absence of actual/expected/diff
   PNGs *before* believing anything about pixels. It now has two retries behind
   it (inherited, not written by me), and a retry cannot turn a genuine diff
   green — a frozen scene is a pure function of the seeded world.

### For the Director

- **q9-01's golden retry has landed** (`d2797dc`, PR #311) and is inherited here.
  The previous escalation is closed.
- **The capacity gate wants its own brief.** It asserts an absolute lag on a host
  where `m11-01`'s own measurements say lag is not a capacity reading. It passed
  today at load 8.5 and read 114.66 ms on clean main at load 31–50, so it will
  flip red whenever a neighbouring lane is busy — and a real 2× regression on a
  quiet runner would be invisible to it. My file, I have the fix shape, it needs
  re-measurement rather than a drive-by edit. Say the word.
- **:4173 is contended across lanes** and `reuseExistingServer` is true locally,
  so any lane can run the mobile suite against another lane's bundle and report
  it as its own — it fails *quietly*, with plausible numbers. An env-overridable
  port in QA's `playwright.config.ts` would fix it for everyone.
