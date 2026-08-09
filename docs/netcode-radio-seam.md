# The radio seam, on the server — how a served bot gets a teammate

*Netcode Engineer, b2-02. Companion to `docs/team-bots-plan.md` §2 (Stage 2, the
team callout channel) and to b2-01, which closes the same seam on the offline
`match-boot` path. Written against
`agent/netcode/b2-02-radio-seam-server-room`.*

---

## 1. The silence

`src/bots/radio.ts` is **Layer B** of the team-bots plan: the callout channel
allied bots talk on, with a latency, a miss rate and a cooldown, so cooperation
is a skill rather than telepathy. Layer A — the ally klaxon a human already
hears — is free and comes from the world; Layer B is everything the HUD does not
carry, and the plan's own example is the one this brief turns on: *the klaxon
rings for a **home**, and a teammate jumped in open space has no klaxon.*

Offline, `createBots` (`src/bots/harness.ts`) opens one ring per side, because it
is the only function that sees a whole lineup at once. `server/room.ts` never
did. It seats bots **one at a time** — at RUSH!, once per BOT seat, and again
whenever a pilot drops and a stand-in takes the controls — so every online bot
took `createBot`'s quiet default, `radio: null`. The harness says so in as many
words, and says whose problem it is:

> A caller that seats bots one at a time — the match server, the QA harness's
> per-seat builder — gets `createBot`'s quiet default (`radio: null`) and
> therefore Layer A only… wiring a shared channel through the server's slot table
> is netcode's file, not this one.

So an online Teams match ran with allies deaf to each other, and the same two
bots fought differently depending on whether a server had dealt their seats.

`MatchRoom.wireRadios()` is the fix: one channel per side, opened from the slot
table, handed to that side's bots.

---

## 2. The decision that took the thinking: who is a *member*

`TeamRadio.members` is not decoration. `send` draws **one number from the
sender's seeded stream per member**, and that stream is the same one the bot's
aim spread and its escape headings come out of. Membership is therefore a
behavioural input, not a routing detail.

**Members are the seats on that side that a BOT is flying — and only those.**
That is `createBots`' rule, copied deliberately, because it is the only rule
under which an online lineup and the identical offline lineup produce the same
bots. Consider a 1-human/3-bot side:

| | members | draws per `send` |
|---|---|---|
| offline (`createBots`) | the 3 bots | 2 |
| online, humans included | the 3 bots + the human | 3 |
| online, **as shipped** | the 3 bots | 2 |

The middle row is the tempting one — it makes a side's roster "complete" and it
would have made a mid-match substitute a member from the start. It also makes
every ally's next decision different from the offline one, which is exactly the
divergence this brief exists to remove ("a bot should not fight differently
because a server dealt its seat"). It was rejected on that ground alone.

A human loses nothing by not being on the ring: Layer A is what a human plays
on, and it is derived from the world.

### FFA falls out, with no mode check

In FFA a side *is* a seat (`Slot.team === Slot.player`, and `compactRoster`
re-derives it after the roster is compacted), so every side has exactly one
member and `teamRadio` answers `null`. `send` on `null` is a no-op that draws no
random number; `receive` on `null` is the shared empty array. Nothing in
`wireRadios` asks the room what mode it is in — the same structural degradation
the plan asks for at §2.5, one layer further out.

The control in `tests/net/online-radio.test.ts` is a **state hash** of a served
FFA match measured on `origin/main` and re-measured unchanged here, rather than a
"no calls were filed" assertion, which would stay green through a real drift.

---

## 3. The seat that changes hands

A side's bot roster is not fixed for the match. A dropped pilot's seat gains a
bot (`vacate`, GDD §4.2's substitution) and a reclaimed seat loses one
(`reclaim`), so `wireRadios` runs at all three moments and compares before it
rebuilds:

- **membership unchanged** → the side keeps the very ring it had. This is every
  tick but a handful;
- **membership moved** → a new `TeamRadio` (its `members` is fixed at
  construction), with the **calls already in flight copied across it**, `at` and
  `seq` included, so the total order `receive` sorts by is continuous. The side
  did not stop existing because one of its pilots did, and a siege call should
  not be swallowed by a teammate's phone locking;
- **no bots left on a side** → the entry is dropped.

A stand-in that joined mid-siege is *not* retro-fitted into the `heardBy` masks
of calls made before it arrived. It was not there; the mask was rolled among the
members of the moment.

---

## 4. What this change is not

- **Not on the wire.** The ring lives beside the bots, never in `World` — the
  determinism replay hashes the world and replays recorded inputs (GDD §4.8), and
  a channel in there could desync it, besides landing on a 494-byte snapshot
  budget that is not the bots' (plan Trap 5). Nothing here is encoded,
  broadcast or predicted; `src/net/` is untouched by this brief.
- **Not a new cost model.** Latency, miss chance, cooldown, ring capacity and
  hearsay staleness are `src/bots`' numbers, per tier, and this file reuses them
  verbatim (plan §2.3). The server adds no dial and relaxes none.
- **Not a change to what may be said.** `Callout` has nowhere to put an
  unscouted core's HP or anyone's bank, and `src/bots/radio.ts` imports nothing
  from `src/sim` (§2.2, fog honesty at §2.9).
- **Not a change to the cast.** `botPersonalities` (a0-06b) still decides who is
  seated; `wireRadios` reads the finished seating and never authors it.

---

## 5. The bug found underneath it

The channel is keyed by seat id, which is what made this visible:
`startMatch` seated its bots **above** a0-11's `compactRoster`, and a bot carries
the seat id it was built with for the rest of the match. In any room with an OPEN
chair below a BOT chair, every bot perceived a different seat than the one it
flew — and the last one perceived a seat that no longer exists, which `perceive`
answers with a *blind* view while `inputsFor` files that blind decision against a
real ship anyway.

Seating now happens after the renumbering. The cast is unaffected: compaction
preserves slot order and `castFor` spends the host's picks in that order either
way. `tests/server/bot-seat.test.ts` pins both halves.
