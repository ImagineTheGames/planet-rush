# b2-02 — the same radio seam, on the server

`readback.json` is written by `tests/net/online-radio.test.ts` on every run: a
real `MatchServer`, a real four-seat room authored through real encoded frames,
and real `MatchRoom.update` ticks. Nothing in it is typed by hand, and no callout
in it was filed by the test — the wounded bot decided to speak on its own.

**The match.** A human host and Sable on one side; two Wardens on the other
(`cast`, `teams`). One Warden is jumped in open space with an enemy on top of it
and its teammate five hundred units away. That is deliberately the case Layer A
cannot carry: the under-attack klaxon rings for a **home**, and a teammate in the
field has no klaxon.

**What to read, in order.**

- `channel.members` is `[2, 3]` and `channel.sharedObject` is `true` — the two
  Wardens are on **one** ring, not two equal ones.
- `channel.loneBotOnTheOtherSide` is `true`: Sable's only ally is a human, so
  Sable has no channel. That is the parity rule, not a gap — `send` spends the
  sender's seeded stream once per member, so putting a human's seat on the roster
  would shift every ally's aim and make an online bot fight differently than the
  identical offline lineup does (`docs/netcode-radio-seam.md` §2).
- `timeline` is the whole chain, in sim seconds: the `help` is filed at `0.0167`,
  is readable only at `0.25` (`latencySeconds`, Hard's `callLatency`), is heard
  at `0.2667`, and is answered at `0.3167`.
  `readableInTheTickItWasSent` is `false` — the determinism floor, which is what
  keeps bot iteration order out of every decision.
- `allyDecision` is the sentence the brief asks for, in the ally's own brain: the
  ally-response latch names seat **2**, and the behaviour is `defend-ally`.
- `beforeB2_02` is what this same match did before the fix: the room seated its
  bots one at a time, every one of them took `createBot`'s `radio: null`, and the
  whole timeline above was a single silence.

**The FFA control is not in this file, on purpose.** It is a state hash — the
determinism replay's own fingerprint over every ship, rock, chunk, station,
turret, shield, job and projectile after 60 s of a served free-for-all at the
same seed — pinned in `tests/net/online-radio.test.ts` as `FFA_GOLDEN`, measured
on `origin/main` at ea7521f and re-measured unchanged with b2-02 applied. A
readback saying "no calls were filed" would stay green through a real drift; the
hash cannot.

The seating half — who is on a channel, when it re-opens for a stand-in, and when
a reclaimed seat leaves it — is pinned in `tests/server/room-radio.test.ts`.
Rationale and the rejected alternatives: `docs/netcode-radio-seam.md`.
