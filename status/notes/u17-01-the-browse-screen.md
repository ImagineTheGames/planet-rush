# u17-01 — the browse screen (working note)

**Branch:** `agent/ui/u17-01-browse-screen` (stacked on
`agent/netcode/n10-01-lobby-list-route`, PR #400 — **not merged yet**; this branch
was cut from it because the screen calls `readLobbyList` / `joinListing`, which
exist only there). **Spec:** `docs/lobby-browser-plan.md` §4 and §5.

---

## BUILT

| Commit | What |
|---|---|
| `0a03a35` | the pure model — `src/ui/lobby-browser.ts`, the two `online-copy` lines, `EntryState.mode` + `chooseJoinMode` |
| `2927481` | the rects — the mode switch, the rows, the JOIN buttons, the mode-aware hit test |
| `4a7da88` | the view — `src/ui/lobby-browser-view.ts`, segment chips in `lobby-entry-view.ts` |
| (wiring) | `src/main.ts` — the poll lifecycle, the row press, the seam |
| (gate) | n10-01's two dark-matter allowlist entries closed out |

**Gates:** `npx tsc --noEmit` clean; `npm test -- --run` green (152 files / 2832
tests); `npm run dark-matter:check` clean.

**Evidence:** `tests/browse/lobby-browse.spec.ts` + `playwright.u17.config.ts` —
four frames at 390 px landscape against a fixtured fleet (`page.route` answers
every allocator call; nothing reaches a deployment and nothing spends money).

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

- Re-baseline goldens if the doors/keypad frames moved (the home screen is
  untouched; the JOIN screen now opens on BROWSE).
- PR, with the four evidence frames.

### Flagged, not fixed (cross-owner)

- `src/net/connect-trace.ts` `refusalGloss` has **no `room-gone` case**, so the
  Machine-level refusal n10-01 added narrates as a bare token. One line, in the
  netcode lane's file.
- `src/art/materials.ts#PLATE_MOTION` is still in the dark-matter allowlist and
  the scan now says it is no longer dark (u16-01 wired it). A NOTE, not a failure;
  left alone because it is not this brief's.
