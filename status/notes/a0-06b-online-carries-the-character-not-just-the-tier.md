# a0-06b-online-carries-the-character-not-just-the-tier.md — working notes (netcode)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

Branch: `agent/netcode/a0-06b-wire-botPersonalities`, cut from `origin/main` at
`22bf4e7` (which already contains a0-06, PR #319 merged).

## BUILT

**`5b29a72` — the wire carries the CHARACTER, and the room seats it.**

- `src/net/transport.ts` — `LobbyChoiceMessage.botPersonalities?: readonly
  PersonalityId[]`, one entry per BOT seat in the same order and of the same
  length as `botDifficulties`. Also `LobbySlot.botPersonality?`, so the room's
  broadcast can say **which** Hard bot it seated rather than only that one is
  there. `PersonalityId` is imported **type-only** from `../bots`.
- `src/net/wire.ts` — `parseBotPersonalities`. Bounded at `MAX_PLAYERS`, rejected
  **whole** rather than per-entry (the `parseSeatStates` rule: one dropped entry
  shifts every seat after it and hands seat 5's character to seat 2), and
  **dropped rather than refused**, so a bad cast never costs its sender the hull
  riding the same message. Membership against `ROSTER` with `Array.includes` —
  the file's one runtime import from outside `src/net`, argued in the comment.
- `src/net/session.ts` — `chooseInLobby` options (class + `OnlineSession`
  interface) and `OnlineSessionConfig` carry it.
- `server/room.ts` — `private botPersonalities`, set from the creator's
  `lobbyChoice` only; `castFor` prefers it; `lobbyState()` echoes
  `botPersonality` wherever it already echoed `botDifficulty`.

**`0797b4a` — the host's cast rides every `lobbyChoice`. MARKED PROPOSED.**

`src/main.ts` `sendChoice()` sends `botPersonalities` beside `botDifficulties`.
Separate commit because `src/main.ts` is not Netcode's file — its owner can take
it, move it or drop it without touching the seam. **Without it the seam is a
field nobody fills.**

**`18dc51c` — tests, and the evidence readback.**

- `tests/server/room-cast.test.ts` (new, 10 cases) — the room through the real
  wire parser: exact names; two Wardens in/out in two distinct seats; the
  no-`botPersonalities` fallback byte-for-byte; neither row → roster order; a
  SHORT cast falling back **per seat**; a guest unable to re-cast; prototype-chain
  names refused; same seed + same lobby → identical snapshot bytes twice; a
  different cast on the same seed diverging.
- `tests/net/online-cast.test.ts` (new, 2 cases) — the same claim over a **real
  socket**, real `MatchServer`, real `src/ui/lobby` model driven the way
  `main.ts` `sendChoice` drives it. Writes the readback.
- `src/net/wire.test.ts` — round trip with repeats; `ROSTER` as the allow-list;
  a malformed cast dropped whole.
- `evidence/a0-06b-online-cast/readback.json`.

**`eb5c367` — `matchStart` names who is flying each seat.**

`MatchStartSlot.personality?`, filled by the room. Needed because the roster that
*ends* the lobby carried the hull and the side and nothing about who was in the
ship, so an online client named its own lobby's guess. Rides RUSH! once, never
the snapshot.

**`8febcba` — `evidence/a0-06b-online-cast/README.md`**, saying what the readback
proves and why the cast is all-HARD (a mixed-tier cast makes a readback that looks
fine under the old code too).

**`99ee324` — the two `tests/net/` journeys declare their budgets.**
`tests/net/budget-contract.test.ts` caught this in the FULL suite run and not in
a targeted one: every test in that directory that lets time pass must pass
`netBudget({work, measuredSeconds})` as `it()`'s third argument, or it rides
vitest's flat 5 s default. **A targeted `vitest run <file>` will never tell you
this** — the contract test lives in a different file. Run the whole suite before
believing a new `tests/net/` file is green.

**`b5aa33d` — `docs/netcode-cast-wire.md`**, and `docs/design-amendments.md`'s
"Known remaining gap" struck through with what closed it.

## DECISIONS

- **THE CHARACTER ROW IS AUTHORITATIVE; THE TIER IS DERIVED FROM IT.** `castFor`
  answers in a fixed order — `botPersonalities[i]` → `botDifficulties[i]` →
  roster order — and where the first answers, the second is **never read for that
  seat**. The tier the room then publishes is `PERSONALITIES[c].difficulty`. So
  the two rows cannot disagree because only one of them is consulted; there is no
  reconciliation step to get wrong later.
- **Rejected: validate-and-refuse** (drop the whole `lobbyChoice` when tier and
  character disagree). It turns a benign stale field into the host losing their
  cast *and* their hull, on a message where every other malformed field is dropped
  rather than refused.
- **Rejected: deleting `botDifficulties`.** The tier is still *shown* (ratified:
  shown, not chosen), and an old client that sends only tiers must keep getting a
  sane room — deleting the row drops every such client to roster order.
- **Rejected: one row of `{character, tier}` pairs.** Cleaner on paper; breaks
  every existing client for a field the server derives anyway.
- **The two rows cannot slide against each other**, and that is by construction,
  not convention: both are built from the same filter over the same seats
  (`isBotSeat`), so same length, same order. The failure mode of a misaligned pair
  is not a crash — it is seat 5's character quietly arriving at seat 2.
- **The fallback is PER SEAT, not wholesale.** Three names in a room seating five
  bots resolves three by name and two by tier. A whole-array fallback would throw
  a partial pick away in silence.
- **`ROSTER.includes`, never `in PERSONALITIES`.** a0-06's own guard was
  `chosen in PERSONALITIES`; `PERSONALITIES` is an object literal so `in` walks
  the prototype and `constructor` / `toString` / `valueOf` / `hasOwnProperty` /
  `__proto__` all passed. On the client that was unreachable. **On the wire it is
  the front door.** Pinned by a test over all five keys, in two files.
- **`src/net` → `src/bots` is a NEW import edge and it is deliberate.** Type-only
  in `transport.ts`/`session.ts`; runtime in `wire.ts` for `ROSTER`. The
  alternative — a seven-word union re-typed in the wire — is a second roster free
  to drift, and the failure mode of a stale allow-list is a host's pick silently
  dropped, i.e. this exact bug again. `server/` already imports `src/bots`
  (`server/README.md`), `src/sim/match-config.ts:17` already names `PersonalityId`
  as living in a higher layer, and no cycle exists (`src/bots` imports no
  `src/net`).

### Traps hit, worth not re-hitting

- **Asserting on tiers is what passes on the bug.** `botDifficulty === 'hard'`
  was true the whole time the wrong character was seated — three characters share
  the Hard tier. Every case in both new files asserts on **names**; where a tier
  assertion survives it is the second half of a pair whose first half named a
  character.
- **A test that only proves the room is not enough.** The room-level file
  hand-builds the wire, so it cannot catch "nobody fills the field", which is the
  actual shape of the a0-06 gap. Hence the real-socket file.
- **Verified the tests fail without the fix**, rather than assuming: disabling
  `castFor`'s new branch turns 8 of the 10 room-level cases red. The 2 that stay
  green are the fallback cases — correct, they do not depend on the branch.
- **The evidence cast is deliberately all-HARD with three Wardens.** A mixed-tier
  cast makes a readback that looks fine under the old code too. All-Hard is the
  case where the tier row provably names 3⁷ different casts, and the readback
  records the different cast the same lobby produced before this brief, computed
  rather than described.

## NEXT

- **Not done, and it is UI's:** `src/ui/lobby-flow.ts` `choiceFor` builds the
  same `lobbyChoice` for the flow model and still sends tiers alone;
  `src/ui/lobby.ts` `applyLobbySlots` still re-derives a name from
  `LobbySlot.botDifficulty` instead of reading the `botPersonality` the room now
  publishes; and `botDifficulties`' doc comment in `src/ui/lobby.ts:1225` still
  says the gap is open. None costs correctness on the shipped online path — the
  room seats the host's cast either way — but until they land a *guest's* roster
  shows its own guess at the names. Flagged in the PR body.
- `src/main.ts` (`0797b4a`) is marked PROPOSED; its owner may relocate it.
- Nothing else outstanding. Do not invent any.
