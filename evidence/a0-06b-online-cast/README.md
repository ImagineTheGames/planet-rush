# a0-06b — the online room seats the characters the host picked

`readback.json` is written by `tests/net/online-cast.test.ts` on every run: one
host, one **real socket**, the real `MatchServer`, and the real lobby model
(`src/ui/lobby`) driven the way `src/main.ts` `sendChoice` drives it. Nothing in
it is typed by hand.

**What to read.** `lobbyCast`, `seatedCast` and `matchStartCast` are the same
seven names in the same order — what the host picked, what authority seated, and
what the roster that ended the lobby named. `identical: true` is that claim.

**Why the cast is seven all-HARD seats with three Wardens.** Every entry in
`tiers` is `"hard"`, so the tier row cannot tell these seven seats apart — three
characters share the Hard tier, and `["hard"×7]` names 3⁷ different casts. A
mixed-tier cast would have produced a readback that looked fine under the old
code too. Three Wardens is also the developer's own balanced 4v4 of Hard bots,
which needs a fourth Hard character that does not exist — so the repeat is the
ordinary way to author a symmetric match, not an edge case
(`seatsPerCharacter`).

**`preA0_06bWouldHaveSeated`** is what this same lobby got before this brief,
computed rather than described: the tier survived the hop, the character row did
not exist, and the room re-derived a Hard character by index. Same tiers,
different names. That list is the bug.

`hulls` is there because a bot flies its character's hull (GDD §2.11) — three
Excavators for the three Wardens, and a silhouette on the minimap is information
(style-guide §4).

Rationale and the rejected alternatives: `docs/netcode-cast-wire.md`.
