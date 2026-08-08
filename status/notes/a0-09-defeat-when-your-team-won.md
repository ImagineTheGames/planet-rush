# a0-09 — the game told the developer they lost a match their side won

Branch: `agent/ui/a0-09-team-aware-end-of-match`
Working note. Not evidence — the DoD, the PR and QA attestation are the record.

---

## BUILT

**`37a3d6a` — fix(a0-09): the end screen learns about sides**

- `src/ui/end-of-match.ts`
  - `MatchOutcome` gains `allies?: ReadonlySet<PlayerId>` — the owner slots on
    your side. The same roster shape the audio engine already takes for the
    alarm (`setAlarmScope(allies, …)`). **Absent means teams-of-one**, which is
    exactly FFA, so every FFA outcome and every pre-Teams fixture reads
    character for character.
  - `onYourSide(outcome, player)` — the summary's ONE allegiance question,
    exported. Headline, subhead and identity rule all route through it.
  - `endKind` — was `winner === you`, now `onYourSide(outcome, winner)`.
  - `subheadFor` — an ally win reads `Your side took the claim — Player 8 held
    it.` Self-win and enemy-win lines unchanged.
  - `accentFor` — the identity rule now carries the **winner's** colour on every
    end that has one (was `you` on victory / `winner` on defeat).
- `src/ui/lobby.ts` — `sideRosterOf(state, player)`: the lobby's twin of
  `art/audio/scope` `deriveAlarmAllies`, for the flow, which holds no `World`.
- `src/ui/lobby-flow.ts` — `flowMatchEnded` / `flowEliminated` carry the side.
- `src/main.ts` — `currentOutcome` passes `alarmAllies()`, the *same set* the
  klaxon is scoped to. **This is the half that deploys the fix in the shipped
  client**; without it the outcome arrives sideless and `endKind` correctly
  falls back to FFA, which is the bug.
- `src/ui/index.ts` — re-exports `onYourSide`, `sideRosterOf`.
- Tests: `end-of-match.test.ts` (re-pointed + the TEAMS block that did not
  exist), `lobby-flow.test.ts` (the flow-level teams end), `lobby.test.ts` (the
  roster, incl. FFA, closed seats, seatless player).

**`<evidence commit>` — the live-stage evidence run**

- `src/main.ts` — `installEndScreenStage` gains `winAlly()` (drop every core NOT
  on the local side; the sim's own `resolveWinner` crowns the ally), `side()`
  and `result()` (the WORDS the summary resolved — the report was about what the
  screen *said*).
- `tests/live-stage/end-screens-teams.spec.ts` — both developer scenarios in the
  REAL booted bundle at `?debug=1&sides=2`.
- Screenshots: `teams-ally-victory-evidence.png`,
  `teams-eliminated-then-side-wins-evidence.png`. Both read **CLAIM HELD** over
  *"Your side took the claim — Player 7 held it."*

Green: `npx tsc --noEmit`; `npm test -- --run` → 237 files, 3995 tests.
Live-stage: `end-screens-teams.spec.ts` 2/2, and the pre-existing FFA
`end-screens.spec.ts` 2/2 unbroken.

---

## DECISIONS

**The bug is bigger than the report says, and the report is still exactly
right.** `resolveWinner` (`src/sim/match.ts`) crowns the **last surviving core it
walks**, so a side that ends holding several cores reports its *highest slot*.
You could therefore win a Teams match with your own reactor intact and be told
DEFEAT, naming a teammate. The developer's screenshot is the general case, not
an eliminated-player edge.

**The side roster, not a boolean.** The brief allowed either a roster or a
resolved `sameSide(you, winner)`. Took the roster: it is the shape the alarm
already uses, so `main.ts` hands the summary and the klaxon *the identical Set*
— one predicate, one answer, no second notion of "my side" that can drift.

**Optional, not required.** `allies?` absent = teams-of-one = FFA. This is why
FFA is unchanged character for character and why no existing fixture, golden or
`MatchOutcome` literal anywhere in the repo had to move. Rejected making it
required: it would have been a repo-wide edit for zero behaviour.

**The colour seam → the WINNER's colour, always.** Rejected two alternatives:

- *Your colour on an ally victory.* The line under the rule names Player 8;
  painting the rule your colour puts the screen's two carriers of one fact in
  disagreement — a smaller copy of the bug a0-09 exists to fix.
- *Tint the rule by side (blue/red team motif).* The brief suggested the side
  indicator is "more honest", and in general it is — but **GDD §5.7 is explicit**
  that the motif's blue/red lands on the motif only: *"never a hull, never a
  ship's trim, never an HP bar"*, because at three and four sides the per-slot
  identity colour is what tells two enemies apart. This rule is the end screen's
  identity surface, the HP bar's sibling. So the side is carried where §2.1
  carries it — **in words**, by "Your side took the claim".

The change also *simplified* `accentFor`: victory-by-you had `winner === you`, so
the old two-branch split was invisible until an ally could win. Now one branch.

**The subhead names the ally.** "Your side took the claim" alone is a worse
answer than the wrong one — the player wants to know who. Kept `took the claim`
as the spine across all three lines so §4.7 register 2 still files a win and a
loss in one sentence shape.

**`main.ts` is Platform-owned and I edited it anyway** — two surgical, commented
changes (`currentOutcome`, three stage methods). The fix is undeployable
without the first; this is the same cross-lane wiring precedent s9-01 set for
`alarmAllies()` itself. Flagged in the PR body for Platform's review.

**Port 4173 was held by another lane's preview** serving a bundle from 12:50, and
`reuseExistingServer` reused it silently — the first evidence run failed against
code that predated the fix. Re-ran on a private port with a throwaway config
(deleted, not committed). Worth knowing: **a green live-stage run on this host is
not trustworthy without checking the served bundle.**

---

## The name table (asked for in the brief — findings only, not fixed)

The screen says **"Player 7"**, not a name, and the brief asked me to look
without fixing.

- The table **is reachable**: `playerNames: NameTable` is built in `main.ts`
  (~:1745) from the seated cast and lives in the *same closure* as
  `currentOutcome()`. Nothing structural is in the way.
- What is missing is a field: `MatchOutcome` carries no name, so the summary has
  nowhere to put one. `playerLabel()` in `end-of-match.ts` is the single place
  the string is minted — a one-field change, in one function.
- **Deliberately not done here.** `a0-06` is rebuilding how the lobby chooses
  characters and owns that table's shape; adding a second consumer mid-rebuild is
  how two lanes end up with two name tables. It should land after a0-06, as its
  own change, and it should also feed the *flow* path (`lobby-flow.ts`), which
  has `nameFor`/`playerNameTable` available and would otherwise diverge from the
  offline client.

---

## NEXT

Nothing outstanding for this brief. Open follow-ups for whoever picks them up:

1. **Names on the end screen** — above. Blocked on a0-06 by choice, not by code.
2. **The side is not drawn, only worded.** GDD §2.1's "added indicator" has no
   representation on this screen. If the Director wants one, the honest form
   under §5.7 is a *side chip / underline* beside the subhead (motif surface),
   never a tint on the identity rule. Not a defect; a deliberate gap.
3. **`world.match.winningTeam` exists and is unread by the UI.** The sim already
   records the winning team. This fix deliberately did not consume it (that
   would be the second notion of "my side" the brief forbids), but it is the
   natural source if the end screen ever wants to *name* the winning side.
