# a0-113 — the DRAW screen cannot be reached

Branch `agent/gameplay/a0-113-a-draw-that-can-occur`. Working note, not evidence.

## FINDING (settled by reading the code, before touching it)

`resolveWinner` (`src/sim/match.ts:326-364`) has two branches:

- **one surviving team** → that team wins;
- **no surviving team** → `lastToDie(m.eliminated)` — the *last entry* of the
  elimination order (`src/sim/match.ts:349`, `:376`).

`m.eliminated` is appended to inside `eliminate()` (`src/sim/match.ts:147-152`)
as each core reaches zero, in within-tick resolution order. So the all-dead
branch **always** crowns somebody whenever any core was ever destroyed.
`lastToDie` returns `null` only for an *empty* elimination list, i.e. a world
whose every station was born a wreck (derelict, `alive === false` from
construction — `src/sim/state.ts:495-505`). No shipped map builds one:
`MIN_MATCH_SIZE = 2` live players (`src/sim/match-config.ts:89`) and
derelict-fill only pads the `8-N` unused board positions.

**Therefore `endKind === 'draw'` (`src/ui/end-of-match.ts:144-148`, `winner ===
null && matchOver`) is unreachable in any real match.** QA's eight-dead-reactors
screen naming "Player 8" is not a rendering bug: it is `lastToDie` returning the
last seat the debug queue happened to kill.

### The structural point

The all-dead branch fires **only** when the last ≥2 teams die on the *same
tick*. `resolveWinner` runs at the end of every step and latches (`phase ===
'ended'` returns early), so a state with exactly one surviving team ends the
match that tick — the count can never walk 1 → 0. So the tiebreak is not an
occasional tiebreak: it is *the whole of* the simultaneous-death case. Either it
always applies (status quo: no draw ever) or it never applies (every all-dead
ending is a draw). There is no middle ground to design.

### Is simultaneous death real?

Yes, and measured. `docs/design-amendments.md:2076-2090` records mutual
extinction at **2 of 24 shipped-cast seeds** under the pre-ration bot economy —
"no survivor to crown, the match resolved only by the last-to-die tiebreak
(seed 1: `0` and `1` … dying together at t=850 → 8 eliminated)" — and states the
"mutual-extinction path stays legal for genuinely identical cores".
`src/bots/match-endgame.test.ts:102` runs one today.

So the brief's **first** branch holds: the state is reachable in real play, and
the resolution is what refuses to call it a draw.

## BUILT

Branch `agent/gameplay/a0-113-a-draw-that-can-occur`, three commits:

1. `d51fb44e` **test(a0-113): the draw the sim cannot reach — red.**
   `src/sim/outcome.test.ts`, 10 cases. Six red on today's code:
   `every seat dying on the same tick is a draw` (QA's eight-seat wipe),
   `two seats destroying each other on the same tick is a draw` (the real
   one), `the draw does not depend on which core the tick resolved first`,
   `collapse taking the last cores together is a draw`, `a draw ends the
   match once and is never re-decided`, `both sides' last cores dying on
   one tick is a draw`. Four already green and kept green: a survivor by
   one tick wins, seven-of-eight is a victory, and the TEAMS ally path.

2. `6671a9de` **fix(a0-113).** `resolveWinner`'s no-survivor branch sets
   `winner`/`winningTeam` to null instead of `lastToDie(m.eliminated)`.
   `lastToDie()` and `teamOfOwner()` deleted (the latter had no other
   caller). `match.eliminated` untouched. Docs corrected in `match.ts`,
   `state.ts`, `step.ts`. Four cases in `match.test.ts` that encoded the
   tiebreak rewritten, plus the idle-field case (below).

3. `50198413` **test(a0-113) [CROSS-LANE].** `src/bots/match-endgame.test.ts`
   asserted the tiebreak (`expect(result.winner).toBe(order[order.length -
   1])`, line 112). One assertion + comment, its own commit, flagged in the
   PR for the Bots owner. It is the ONLY file outside `src/sim/` the change
   touches.

4. `dcdbae67` **test(a0-113) [CROSS-LANE: src/bots, tests/harness].** Two 2v2
   suites asserted "there is always a winner" and met real draws. See below —
   this is the strongest evidence on the branch.

### The unforced draw, already in our own suite

`match.test.ts` "delivers the whole field yield, and the idle field then
resolves itself" — seed 11, two players, the shipped map, **no input at
all** — now ends `winner === null`. Two untouched cores at identical HP
under identical collapse entropy reach zero on the same tick. No debug
queue, no QA rig: a shipped configuration that draws. That case is the
answer to "can this happen in real play".

### Measured: the shipped bot cast draws, and the scripted harness 2v2 ALWAYS draws

Ran both failing suites under a throwaway diagnostic (deleted; never committed):

- **`src/bots/team-winning.test.ts`, 2v2 of the shipped cast, seed 4.** Home
  death times `[843.72, 850.02, 850.02, 850.02]`. Slot 1 (team 0) and BOTH of
  team 1's homes reach zero on the same collapse tick. 7 of 8 seeds still
  decide; seed 4 is a draw. Real bots, shipped map, no rig.
- **`tests/harness/match.test.ts`, scripted raiders vs turtles.**
  `survived=[0,0,0,0]` at t=850.02 on seed 7 **and on every other seed tried
  (1-10)**. That test was named *"one team survives"* and was green only because
  the tiebreak invented a winner; its `if (slot.survived)` loop never ran an
  iteration. The scripted raiders never break two turtles before the collapse —
  a balance observation for the harness owner, out of scope here.

## DECISIONS

**Made it a draw; did not keep the tiebreak.** The deciding fact is
structural, not aesthetic: the no-survivor branch fires *only* on a
same-tick wipe (see FINDING), so the tiebreak was not a tiebreak, it was
the entire simultaneous-death case. Keeping it means DRAW can never
happen; removing it means every all-dead ending is one. No third option
exists to design, so "make the tiebreak smarter" was rejected on the way
in.

**GDD §1 line 49 now contradicts the sim, and I did not edit it.** It
reads *"If the final reactors die in the same instant, the reactor (in
Teams, the side) that reached zero last in the simulation's resolution
order wins — whoever dies last, wins."* The brief rules the other way
("the resolution is wrong and must return a draw"). The brief is the
later instruction and the Director's; GDD.md is not my file. **Flagged in
the PR as an amendment for the Director.** Line 690's changelog fragment
("ties resolve last-to-die") needs the same edit.

**Did not touch the copy, per the brief.** None was needed: the UI already
ships the whole screen — `HEADLINES.draw = 'DRAW'` and
`subheadFor` → `'No reactor survived the collapse.'`
(`src/ui/end-of-match.ts:271`, `:328-329`), accent null. `winner:
PlayerId | null` is already the wire type end-to-end
(`src/net/transport.ts:754-757`, `loopback.ts:325`, `server/room.ts:1373`,
`lobby-flow.ts:826-830`), so online draws too, with no net change.
**One copy nit reported, not fixed:** the subhead says "the collapse", and
a draw also arrives by mutual destruction under fire. Writer's call.

**Rejected: making only the two-seat case a draw and leaving the eight-seat
wipe a win.** No principle separates them — both are "nobody outlived
anybody" — and it would have preserved the exact artefact QA photographed.

## NEXT

- Nothing outstanding on the sim.
- For the Director: GDD §1 line 49 + line 690 need amending to the draw
  rule. The sim is now the odd one out until they are.
- For the Bots owner: review commits 3 and 4 (`50198413`, `dcdbae67`).
- For the QA/harness owner: commit 4's second half, and the balance question it
  exposes — the scripted 2v2 never produces a survivor on any seed 1-10.
- For the writer/UI: the draw subhead names the collapse only.
