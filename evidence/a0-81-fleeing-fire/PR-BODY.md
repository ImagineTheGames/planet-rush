# a0-81 — a bot running home is still shooting at whoever is chasing it

> *"when rusty was fleeing from me he could have auto fired at me but instead he
> didnt it was like he was in a retreat or return to base target but thats dumb
> because its unfair for him to just target his base and not fire at me at same
> time because thats what i would do"*
> — the developer, 2026-08-17, from a live match

The last clause is the standard, and it is the one GDD §2.9 already sets: a bot
drives the **same action interface a human does**, so it has to be allowed to do
what a human does. A human fleeing with a full hold fires over their shoulder.

**Movement intent and fire intent are now independent.** A bot that is
retreating, hauling or banking fires at a hostile in range and in arc on exactly
the terms a player has — weapon reload, the same allegiance predicate, the same
aim-error model, the same fog.

Full audit, both instruments and every number below:
`evidence/a0-81-fleeing-fire/audit.txt`.

---

## The audit: which of the two it was

The brief offered two hypotheses. It is the second, and starker than "gated".

**Not one target field doing two jobs.** `retreat(ctx, threat)` takes the threat
it is running from as an *argument* and reads the destination separately off
`self.station`. There is no shared `target` slot on `Brain` that a destination
and an aim point are both written into — checked field by field.

**A fire intent nailed shut by the travelling branch.** Every branch whose job
was "fly somewhere" ended with a literal `fire(false)` and **no `aim` action at
all** — `retreat` (all three exits), `haulHome`/`homeErrand`, `spendAtHome`,
`defendHome`'s empty guard ring, `defendAlly`'s transit leg.

The missing `aim` is the half that made it read as broken rather than passive:
with no aim action the sim's facing ladder (`sim/step.ts` `desiredFacing`) falls
through to *"nose follows travel"*, so a retreating bot was not holding fire
while looking at you — it was pointed at its own doorstep with its back to the
chase. That is precisely *"it was like he was in a retreat or return to base
target"*.

**It was deliberate**, and this PR overrides a ratified line rather than
repairing an oversight. `retreat`'s old doc: *"with a live threat the weapon is
off — a retreating bot does not advertise (GDD §2.2)."* Retired, with the
reasoning kept in the code: gunfire is the loudest tell, but there is nothing
left to hide from a ship that is already inside weapon range and chasing. Out of
range the trigger is still up, so the quiet case is untouched.

**And it costs the flight nothing** — arithmetic, not a concession. `sim/step.ts`
`integrate` applies `intent.thrust` in *world space* and never reads
`ship.angle`; facing steers only the gun. A hull thrusting home with its nose
over its shoulder gets home at exactly the speed it always did. That is the
developer's *"it costs them nothing"*, and why they expect it to happen.

---

## What this does to bot difficulty in practice

**Read this section as a deliberate balance change, not a side effect.**

Eight full 8-slot FFA matches, shipped cast, 300 s each, both builds, identical
script (`evidence/a0-81-fleeing-fire/audit.ts`). A *chased* tick is a retreat
tick with a hostile inside weapon range; a *shot* is a projectile that actually
left the barrel.

| tier | chased ticks | shots BEFORE | shots AFTER | shots / chased-sec | trigger held |
|---|---|---|---|---|---|
| Easy | 22,395 | **0** | 500 | 0.00 → **1.34** | 29% |
| Medium | 19,921 | **0** | 717 | 0.00 → **2.16** | 59% |
| Hard | 10,605 | **0** | 410 | 0.00 → **2.32** | 75% |

Across 64 bot-seats a bot was chased while retreating for **16 minutes of sim
time and fired zero shots**. Not rarely, not badly — *no bot in the game could do
it at all, at any tier*. That is what the developer met.

**Bots are meaningfully harder to farm, which is the point.** A chase now costs
hull. Chasing a wounded bot home was a free kill and is now a trade.

**The ladder survives, and with no new knob.** Easy is a third as willing to have
the gun on target as Hard and lands 42% fewer shots per second of being chased.
That spread is the existing aim-error model doing its job on a new behaviour —
`aimJitter` (0.32 rad at Easy vs ~0.02 at Hard) sprays the committed bearing,
`aimLatency` leads a juking chaser where it *was* going, and `reactionInterval`
(1/6 s vs 1/24 s) refreshes the whole aim four times less often while a chase's
geometry changes every metre. Same doctrine as the radio: *"there is no separate
'be bad at it' knob."*

### Why every tier, and not Medium-and-up

The brief invited a Medium-and-up proposal. Rejected, decisively: **the bot in
the report is Rusty, and Rusty is Easy.** A Medium gate ships the developer's own
match back to them unchanged. The brief draws the line itself — Easy being bad at
it is different from no bot in the game being able to do it at all — and the
`0.00 / 0.00 / 0.00` row above is that sentence measured.

### ⚠️ Second-order effect the balance crew should watch

48 full 2v2 team matches, both builds
(`evidence/a0-81-fleeing-fire/contention-probe.ts`):

| | ship deaths / match | ship damage / match |
|---|---|---|
| pre-a0-81 | 9.0 | 564 |
| a0-81 | **5.0** | **391** |

**Bot-vs-bot matches run 44% less lethal.** The mechanism is the stated goal
working in both directions: a bot that shoots back damages its pursuer, the
pursuer crosses its *own* nerve threshold and breaks off too, and a chase that
used to end in a kill now ends in two ships disengaging. Against a human that is
exactly what was asked for. Bot against bot it reads as mutual disengagement, and
this is the number to revisit if solo matches turn out too quiet.

---

## Where covering fire applies — and where it deliberately does not

Wired into the branches that sit **above** the combat branches in all three
trees: `retreat`, `haulHome`/`homeErrand`, `spendAtHome`, `defendHome`'s idle
ring, `defendAlly`'s transit. Reaching one of those means the bot was denied a
fight by an **outranking commitment**, and a commitment is a reason not to fly at
someone, never a reason not to shoot them.

**Deliberately not** `roam`, `scavenge` or `hunt`. Those sit *below*
`potshot`/`attack` in every tree, so reaching them means the tier's own attack
gate declined — Easy's `potshot` demands `weights.triangle.attack >= 0.4` before
Rusty will shoot at something already in front of it. Arming them would hand the
Easy tree the seek-and-destroy branch §2.9 withholds from it ("attacks rarely"):
a balance change wearing a bug fix's clothes. The defect was a suppressed
trigger, not a missing appetite. Pinned by a test.

Unchanged: an ally is never covering fire at any range in any tier
(`isTargetable`, tested with two slots sharing a side because FFA cannot prove
it), and a bot with nothing in range emits the same released trigger and no aim
it always did.

---

## The mirror case the brief asked about

*Does a bot that is attacking keep making economic decisions?* **Not the same
defect — with one half that was, and is fixed here.**

- **Half of it was the same defect, and it is fixed.** `spendAtHome` hard-coded
  `fire(false)` while the bot orbited its own dock with the wheel open — a bot
  banking or buying had its trigger nailed down for exactly the same reason a
  fleeing one did. Same one line, same fix.
- **The rest is tree priority.** `spend`, `haul` and `fix-base` sit *above*
  `potshot`/`attack`/`hunt` in all three trees, so a bot with a full hold does
  that *instead* of picking a fight. Nothing is suppressed; the economy wins the
  tick. That is §2.3's triangle and §2.9's "Easy attacks rarely".
- **Banking cannot be suppressed by anything, for anyone.** The hold auto-drains
  inside your own atmosphere (`DEPOSIT_RANGE`) — no verb, no wheel. A bot
  fighting in its own atmosphere banks exactly like a human, because neither is
  doing anything.
- **Mine and shoot are one trigger**, so a human cannot do both either.
- **One real asymmetry, reported and left alone: `defend` outranks `spend`,** so a
  bot answering the alarm at its own docked station will not press the wheel
  while it fights, where a human could. Deliberately not changed — the GDD
  already ruled on the trade (§2.5 *"defenses are bought before the attack, not
  during it"*; §2.6 *"a siege cannot be out-repaired"*). **A design call for the
  Director, not a defect.**

---

## Tests, and three documented re-baselines

**New:** `src/bots/behaviors.test.ts` — `a retreating bot still fires on what is
chasing it`, plus six cases (the flight is untouched, every tier can, a teammate
draws nothing, empty space is still silent, a hauler gets the same gun,
roam/scavenge stay unarmed). **Verified failing on the pre-fix build**:
`expected null not to be null` (no aim action at all) and `rusty (easy) shoots
back: expected 0 to be greater than 0`.

Three seed-locked soaks in `src/bots/` are pinned to literals that a deliberate
behaviour change necessarily moves. **None is relaxed to fit**; each carries the
before/after measurement in its own note.

- **`ffa-parity`** — the three golden hashes. Rule 3 in that file forbids
  re-baselining for a *Stage-1 team-aware path leaking into FFA*, and a0-81 is
  provably not one: `coveringFire` branches on `isTargetable` (the single
  `hostile` stamp, true for every ship in teams-of-one) and on nothing about
  sides, radios or ally lists. It moves FFA and Teams by the identical mechanism
  — the a0-05 category. The two non-hash cases that would catch a real leak are
  untouched.
- **`team-winning`** — the fixture seed, 13 → 4. That file documents this exact
  fragility and *prescribes a re-scan rather than the next number*; this is its
  fourth instance (a0-10, b3-01, a0-58, now a0-81). Seeds 1–16 re-scanned; seed 4
  is the largest-margin replacement (13,924-tick window, 4 orders), not the first
  green one.
- **`field-division`** — the ally/foe contention bar, 1.6 → 2.4, and **this one
  is a finding rather than a number.** The bar is a ratio against an *enemy-pair
  control*, and friendly fire is off — allies never shoot each other — so a
  **combat** change can only ever move the denominator. Over 48 seeds on both
  builds: **ally 4.06% → 4.13% (flat — the quantity the stage is about did not
  move)**, foe 3.12% → 1.89%. The ratio is kept with the bar re-measured, and a
  **new absolute assertion on the ally rate (< 5%)** is added beside it, so the
  re-baseline leaves nothing unguarded — that number is untouchable by a combat
  change by construction.

`npx tsc --noEmit` and `npm test -- --run` both green.

---

## For the Director

The `retreat` doc line this PR retires — *"a retreating bot does not advertise"* —
was a ratified design position, now overridden by the developer's report. If
`docs/design-amendments.md` should carry it as a ratification entry, that file is
the Director's; the reasoning is written up in full in the code and in
`evidence/a0-81-fleeing-fire/audit.txt` §1, ready to fold in.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
