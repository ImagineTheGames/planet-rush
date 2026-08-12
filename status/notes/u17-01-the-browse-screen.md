# u17-01 — the browse screen (working note)

**Branch:** `agent/ui/u17-01-browse-screen` · **PR:** #401 (open, every check
green). Cut from `agent/netcode/n10-01-lobby-list-route` because the screen calls
`readLobbyList` / `joinListing`, which existed only there; **#400 has since merged
and `main` is merged in** (`784f815` — one conflict, two neighbouring comments in
the storage-key block, both kept), so the diff is this brief's work alone.
**Spec:** `docs/lobby-browser-plan.md` §4 and §5.

---

## BUILT

| Commit | What |
|---|---|
| `0a03a35` | the pure model — `src/ui/lobby-browser.ts`, the two `online-copy` lines, `EntryState.mode` + `chooseJoinMode` |
| `2927481` | the rects — the mode switch, the rows, the JOIN buttons, the mode-aware hit test |
| `4a7da88` | the view — `src/ui/lobby-browser-view.ts`, segment chips in `lobby-entry-view.ts` |
| `fdbaf01` | `src/main.ts` — the poll lifecycle, the row press, the seam |
| `a4c89b2` | n10-01's two dark-matter allowlist entries closed out |
| `91db67a` | the phone evidence — `tests/browse/lobby-browse.spec.ts`, `playwright.u17.config.ts`, four frames |

**Gates:** `npx tsc --noEmit` clean; `npx vitest run` green (**292 files / 5220
tests**); `npm run dark-matter:check` clean. On PR #401: both CI jobs, the perf
gate and **all six mobile-emulation shards** pass.

**Evidence:** `tests/browse/lobby-browse.spec.ts` + `playwright.u17.config.ts` —
four frames at 390 px landscape against a fixtured fleet (`page.route` answers
every allocator call; nothing reaches a deployment and nothing spends money):
`evidence/images/u17-lobby-browse/{browse-populated,browse-empty,browse-refused,browse-code-mode}.png`.

**Goldens did NOT move.** The home screen is untouched and no baseline covers the
JOIN screen, so there was nothing to re-baseline: the eight doors / title /
settings goldens were re-run against this build and pass unchanged. The mobile
specs that walk this screen (`campaign-door`, `landscape-lock`, `voice-copy-fit`)
were re-run too — 27 passed.

### The evidence run earned its keep: three bugs and an honesty gap

1. **Rows sorted at merge time**, i.e. before the region probes answer — so the
   first listing froze in arrival order and never re-ranked. The sort moved into
   `browseModel` (per frame, against whatever has been measured by then) and
   `pressBrowseRowAt` maps the drawn index back through the same model.
2. **A pooled row came back without its plate** — `body` was missing from the
   row's visible set, so the first frame after an empty list was four rows of
   floating text and no JOIN button.
3. **A refused row put the connect panel over the list** — a modal with RETRY on
   it, for a seat somebody else took. A refusal about the ROOM now ends the trace
   and speaks in the message slot; `network` / `bad-response` keep the panel,
   which is what it is for (a0-28).
4. A `CLOSED` row was still advertising `4 SEATS OPEN` beside its own `CLOSED`
   button. The seat clause goes when a row leaves the listing.

---

## DECISIONS (and what was rejected)

### The switch shares the code cells' ROW — measured before it was built

The plan draws a two-segment switch "at the top of the join screen". Taken
literally that is a row of its own, and at the developer's 844×390 it does not
fit: the band is 221 px, the keypad's floor is 148 of it, and a 48 px switch plus
a gutter leaves the code cells **2 px**.

So the switch takes the LEADING end of the row the cells are already on and the
cells take the rest. Measured after: cells 61 px → 48, keys **34 px → 37** — the
code screen comes out of this brief with bigger keys than it went in with. A band
too narrow to seat the switch beside four legible cells stacks them instead
(`JoinSwitchShape`), which is the tall viewport that has the height to spend.

**Rejected:** the switch in the header beam (costs the band nothing, but puts
controls in the letterhead — a theme decision I would have been inventing); a
switch that only appears on one mode (buries the other, which is the ruling).

### The row shows its region on EVERY row

Plan §4/E2 says that at one region the ping moves to a single line above the list
and only appears per-row once the fleet has two. The developer's ruling is
narrower and settled: *"a browse shouldn't show the room code, just the room owner
id and location / ping"*. The row carries it always. (The suppression rule would
also have been a second code path to keep honest for a saving of one line.)

### A row and its JOIN button are ONE target

The developer asked for a JOIN button and got one — a `secondary` chip at the
row's trailing end. The whole row answers the same press, because at 390 px a
55 px row is what a thumb actually lands on. One action, two rects, no ambiguity
about which one you hit.

### What a stale row does

Rows the listing stops offering read `FULL` or `CLOSED`, lose their brightness,
and refuse a press with a sentence **and an immediate re-read** — the refusal is a
claim about a photograph, so the remedy is a newer photograph. An `open` row is
**never** refused locally however stale it is (Trap 5): the round trip is the only
authority.

### The plan's D4 could not be kept literally

D4 asks a row tap to produce the identical `EntryIntent` a typed code does. It
cannot: n10-01 replaced the code in the listing with a derived handle *on purpose*
so the payload is not a code-harvesting feed, and the room's code only comes back
IN the answer. The convergence is one step later than the plan drew it — at
`ResolvedConnection` / `connectMatch` — and it is total: same trace, same socket,
same seat, same failures.

### Copy

- Segments say **BROWSE** and **ENTER ROOM CODE**, the developer's own words. That
  is the a0-15 exception (the entry screen says what the button does), and the
  keypad's own `CLAIM CODE` heading is untouched because the plan pins the CODE
  segment as today's screen, unchanged.
- An empty list: `NO OPEN CLAIMS RIGHT NOW` / `Press ENTER ROOM CODE, or go BACK
  to HOST one.` Both are swept by `voice-door-labels.test.ts` now, which is why
  `BROWSE`, `ENTER ROOM CODE`, `BACK` and the headline carry `NOT_A_DOOR` reasons.
- A refused row: `That claim filled up while you were looking. Pick another.` and
  `That claim has closed. Pick another, or press SOLO.` — the two lines n10-01
  left the UI lane, in `online-copy.ts` with the rest of the refusals.

---

## WHAT A PLAYER SEES WHEN A ROOM FILLS UP WHILE THEY ARE LOOKING AT IT

They press JOIN on a row that says `2 PLAYERS · 4 SEATS OPEN`. The tap goes to the
allocator — it is not refused locally — and comes back **409**. The screen then,
in one frame:

- the message slot under the wordmark reads, in threat red, **"That claim filled
  up while you were looking. Pick another."**;
- **the list is still there**, on the same screen, at the same scroll — never a
  modal, never a bounce back to the doors;
- **that row** is marked: its button now says `FULL`, it is dimmed, and it will not
  answer another press;
- a refresh is fired at once, so within one cycle the row either comes back open
  (a seat freed) or reads `CLOSED` for one cycle and leaves.

If the room did not fill but *ended*, the same press comes back 404 and the line
is "That claim has closed. Pick another, or press SOLO." — two different facts,
two different sentences, which is why `listingFailureMessage` is its own table and
not a cast of the keypad's.

---

## NEXT

Nothing is blocked. What is deliberately **not** here:

- Nothing in `src/net/`, `server/` or `allocator/` was touched by me — n10-01
  built that half and it is on `main`.
- **`tests/browse/` is not in CI.** `playwright.config.ts`'s `testDir` is
  `tests/mobile/`, and this spec needs a bundle built with an allocator URL plus
  route interception, which that suite does not do. Adding a CI job is
  `.github/workflows/ci.yml` — Platform's file. Flagged, not taken.
- **No golden for the browse screen.** `tests/mobile/goldens.spec.ts` is QA's, and
  this spec makes no comparison and re-baselines nothing.
- **The PRIVATE toggle** (`lobbyChoice.listed` is wired and tested end to end by
  n10-01; the lobby row that flips it is unbuilt) and **the HOST door's hint**,
  which §2 says is lying by omission under a public default. Both are lobby-screen
  work, neither is this brief's, and both are worth a brief of their own.
- **D5 (fleet sizing)** — unanswered and the developer's. Nothing here spends.

### Flagged, not fixed (cross-owner)

- `src/net/connect-trace.ts` `refusalGloss` has **no `room-gone` case**, so the
  Machine-level refusal n10-01 added narrates as a bare token. One line, in the
  netcode lane's file.
- `src/art/materials.ts#PLATE_MOTION` is still in the dark-matter allowlist and
  the scan now says it is no longer dark (u16-01 wired it). A NOTE, not a failure;
  left alone because it is not this brief's.
- `tests/mobile/voice-copy-fit.spec.ts` writes `evidence/voice-*-3-keypad.png` one
  tap after PLAY → JOIN, which now lands on BROWSE. The spec still passes (it
  asserts nothing about that shot) but the picture no longer matches its filename:
  it wants one more press on the ENTER ROOM CODE segment. QA's file; the images in
  the tree were restored rather than re-committed as browse screens.
