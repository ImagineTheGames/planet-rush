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

(kept current below)

## DECISIONS

## NEXT
