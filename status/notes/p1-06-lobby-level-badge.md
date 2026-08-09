# p1-06-lobby-level-badge.md — working notes (ui)

Scratch memory for THIS brief, across retries and resumes. Keep it current as you
work; a future you reads it first. This is a working note, not evidence — "done"
is still the DoD, the PR and QA's attestation, never a line written here.

Branch: `agent/ui/p1-06-lobby-level-badge`, cut from `origin/main` @ `6a644e4`.
Contract: `docs/progression-plan.md` §Q2, §2.1 (and §5 Task PR-6). **The plan
wins where it and the brief disagree** — they disagree in exactly ONE place, and
it is recorded under DECISIONS 1 below and fixed in the brief.

## THE GROUND THIS STARTS FROM (read before touching anything)

- pr-01 `src/progression/profile.ts` (`loadProfile`, `freshProfile`, the backup
  key) and pr-03 `curve.ts` (`levelForXp`, `xpToReach`) are merged in `main`.
- `src/ui/lobby.ts` is the pure model, `lobby-geometry.ts` the rects,
  `lobby-view.ts` draws. **Extend, do not fork** — a0-06 (character picker),
  a0-11 (open rooms start empty) and u7-03 (Gantry/Bone) all landed here already
  and the row's segment order is `bar | STATE | body | team | tier | ?`.
- `main.ts` `openLobby()` is where every persisted lobby value is read in
  (`readShipClass`, `readPlayerName`, `readMapId`) — the badge's level joins them.

## BUILT

| commit | what |
|---|---|
| `6994896` | **`platform.storage.remove`** — interface, browser impl, two test fakes, four tests. For MIGRATION; the reset button that used to motivate it is cancelled (§Q4). |
| `e29baa5` | **The badge.** `LobbyState.level` + `LobbyOptions.level`, `levelBadgeLabel`, `LobbySeatView.levelBadge`, `drawLevelBadge` in the view, `readCareerLevel` in `main.ts`. And `src/ui/level-badge.test.ts` — 17 tests, the ruling quoted in the names, THE ABSENCE included. |
| *(in `e29baa5`)* | `__lobby` gains `levelBadges` + `levelBadgeBounds`, pure read-back. |
| `9b1be2a` | **Evidence** — `evidence/p1-06-lobby-level-badge/`: `capture.mjs`, six PNGs at 844×390 dpr 3, `frames.json`, `README.md`. |
| `ea34d9c` | **Goldens** — two NEW region baselines over the badge's own bounds (desktop + landscape phone), and the five lobby baselines re-generated. |
| PR | *(opened below — see NEXT)* |

## DECISIONS (why, and what was rejected)

1. **The one place the plan and the brief disagree, and the plan wins.** The
   brief's test 4 says *"no other surface in the game renders a level or any XP …
   raw XP is private to its owner, always — the badge shows a level, never an XP
   total, not even your own."* Read as written that forbids two things the
   developer ratified in the same pass: the end-of-match summary's **own** XP
   count-up and level bar (plan §6, §6.3 beat 3 — *"the progress bar filling up to
   show you current level, whats left till next level"*, the developer's own
   words), and the hangar's level block (a0-14). The brief concedes the point
   itself two lines later by scoping its own assertion to *"end-of-match.ts's
   **opponent-facing paths**"*.
   **Resolved the plan's way:** the ruling's subject is *nobody else's level,
   ever, and no XP on any in-match surface*; your own career on your own screen is
   the owner reading their own record. The absence test is scoped to that, and
   `level-badge.test.ts`'s header says so in as many words rather than leaving the
   next lane to re-derive it. Brief amended under *AS BUILT*.
   **Rejected:** asserting the literal sentence — it would have failed on `main`
   the day it was written, against two merged, ratified screens.
2. **The badge rides the row's TIER chip rect.** The two can never both want it
   (tier chip is bot-only, badge is your-seat-only), so it takes a rect that was
   already laid out and already empty on your row: no new segment in
   `seatTrailing`, nothing else on the row narrows, and the order of surrender a
   narrowing row keeps is untouched. **Rejected:** a sixth segment (would have
   cost the `?` or the side chip on the notched phone — a ratified mechanic paying
   for a new one, which is exactly the trade `lobby-geometry.ts` exists to
   prevent), and drawing it inline after the name (competes with the ping, and
   `SEAT_ROW_BODY_MIN` is 56px of P-number-and-name with nothing spare).
3. **`LVL`, not `LEVEL`.** The chip is `ROSTER.trailingWidth` = 54 and floors at
   40. `MEDIUM` is already the word that gets auto-fitted down at that floor;
   `LEVEL 7` is longer. The brief left the copy to the lane.
4. **The badge is a value, not a control** — `inert` material like the tier chip,
   and the hit test is untouched: `lobbyHitTest` already declines to name the tier
   rect, so a tap there falls through to the row body, where the character cycle
   refuses on a human seat. No new target, no new refusal.
5. **The level is read when the LOBBY opens, not once at boot.** The summary
   screen banks XP at the end of every match, so a rematch or a walk back to the
   roster has a level the front door's read is already stale about. One
   `loadProfile` per lobby is one `localStorage` read.
6. **Derived from `state.you`, not from a captured slot index.** Online the server
   seats you (`seatLocalPlayer`), and a badge pinned to the slot the lobby was
   built with would stay behind on a stranger's row. Tested.
7. **The full-frame goldens could not see the badge, and that is written down.**
   A ~54×48px chip is an order of magnitude under `maxDiffPixelRatio: 0.01` on a
   dpr-3 frame — all five lobby baselines passed unchanged against the build that
   added it. Fixed both halves: baselines re-generated, and two region goldens
   added over `__lobby.levelBadgeBounds`. **Rejected:** tightening the tolerance
   (it exists for antialiasing; the file header explains why it must stay
   non-zero) and leaving it (a baseline that cannot see the feature it depicts).

## NEXT

- [x] `npx tsc --noEmit`
- [x] `npm test -- --run` — 260 files / 4542 tests green (before the goldens
      commit; re-run before the PR since `goldens.spec.ts` gained two tests that
      the two vitest *contract* files scan).
- [x] goldens differ from `origin/main`
- [x] `git merge-base --is-ancestor origin/main HEAD`
- [ ] push, open the PR, and say in it: the plan/brief disagreement above, the
      copy choice (`LVL`), and the golden-tolerance finding.
- [ ] PR checks green.

**Not in scope, deliberately:** no reset button (§Q4 — `remove` exists for
migration and nothing calls it yet); no unlock content (§4 — the plan designs
none); no level on the wire (`LobbySlot` carries none and must not grow one).
