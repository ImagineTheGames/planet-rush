# Decision hysteresis — the flee/fight flap, fixed (v0.2.2 field report)

**Author:** Bot Engineer · **Scope:** `src/bots/` · **Status:** report, not a
contract · **Branch:** `agent/bots/p5-decision-hysteresis`

## The photograph

The developer photographed a low-health Warden "oscillating between attacking
and fleeing … twitching in place beside its own planet, never actually went
anywhere." That is textbook **threshold flapping**: FLEE engaged at `hp < X`,
and on the next decision — the bot having backed off a hair — the condition read
false, ATTACK/DEFEND re-engaged, the ship drove back in, `hp < X` again. A single
boundary shared by two mutually-exclusive behaviors has no memory, so it cannot
commit to either, and the ship shivers in place.

## The fix: dual thresholds + a latched commitment

The whole fix is one primitive and its application.

- **`src/bots/commitment.ts`** — a `Latch` (`{ on }`) and a pure `commit(latch,
  enter, exit)`. It enters its committed state on one condition and leaves it
  only on a *different*, deliberately separated one; between the two it holds.
  That gap **is** the hysteresis. The primitive carries no domain knowledge, so
  the same three lines guard any flap-prone pair (flee/fight today; siege/retreat
  and chase/mine are the same shape). The committed bit lives on the `Brain`
  (`brain.fleeing`), beside the sim — it can never desync a replay (GDD §4.8),
  and the fog-honesty suite still passes because the latch reads only the view.

- **The flee band** (`behaviors.ts` `wantsRetreat`):
  - **Enter** when hull is under the tier's nerve (`retreatThreshold`) and an
    engageable ship is inside `THREAT_RANGE` (`WEAPON_RANGE·1.6`).
  - **Exit** when the bot has *arrived somewhere* — cleared `RETREAT_CLEAR_RANGE`
    (`WEAPON_RANGE·2.6`) of every threat — or its hull is whole again
    (`retreatRecoverFraction`, i.e. it respawned; ship hull does not regenerate
    mid-life, GDD §2.5).
  - The gap between `THREAT_RANGE` and `RETREAT_CLEAR_RANGE` is the spatial
    hysteresis: a bot backing off does not re-read a pursuer that has only just
    left knife range as "gone" and wheel back into it.

- **Fleeing goes somewhere** (`behaviors.ts` `retreat`): home is the destination
  — retreat *into* the turrets (GDD §2.6) — **unless** the threat is already at
  home, in which case the bot flees flat away from it rather than into the siege.
  Either way the flee vector has a positive component away from the threat, so a
  low-HP bot's distance from it **increases every decision** instead of
  oscillating. Per-character read: Warden/Patch (homebody) run for their own
  cover; Sable/Bolt (low `caution`) enter later and leave sooner, so they flee
  shallower; Rusty (high `caution`) breaks off earliest.

- **The priority exception** (`behaviors.ts` `coreUnderFinalAssault` /
  `lastStandDefend`, a branch *above* `retreat` in all three trees): a core under
  final assault (`< CORE_FINAL_ASSAULT` and under attack, pre-collapse) outranks
  self-preservation. It defends home *and clears the flee commitment*, so a bot
  mid-retreat abandons the run for the last stand — which is exactly what a
  strictly-higher priority in a hysteresis pair is for.

Collapse cancels the whole thing (no hold worth saving, respawn is free — GDD
§2.3, §2.7) and releases the latch, so the endgame reads unchanged.

## Tests (`src/bots/commitment.test.ts`)

- the `commit` latch's enter / hold / exit / safety-wins semantics;
- the flee band **holds** through the gap a single threshold flaps in, and the
  band only *holds* a commitment, never *starts* one;
- **the screenshot scenario**: a low-HP Warden sieged at home opens distance from
  the threat monotonically over 45 ticks and stays committed to the flee;
- **bounded flips**: over 30 s of live pursuit the flee/fight flip count stays
  under a small named ceiling (pre-fix this flapped many times a second);
- the priority exception interrupts a committed retreat and re-commits after;
- determinism: two identical pursuits produce identical behavior traces.

## Balance — controlled A/B (21 rotated matches, identical seeds)

The roster is rotated through the seats so character and seat position are
decoupled (same method as `bot-balance-day4.md`). Base = this branch's parent.

| | Warden | Foreman | Sable | Patch | Rusty | Bolt | Vulture | timeouts | median |
|---|---|---|---|---|---|---|---|---|---|
| **base (pre-fix)** | 12 | 5 | 2 | 2 | 0 | 0 | 0 | 0 / 21 | 13.8 min |
| **after (hysteresis)** | 12 | 6 | 1 | 0 | 1 | 1 | 0 | 0 / 21 | 13.6 min |

The anti-flap change is **behaviorally surgical**: win rates barely move (Warden
12 → 12; the rest reshuffle within run-to-run noise), median match length is
unchanged, and every match still ends inside the timeout with the tier ordering
intact (Hard Warden top, Medium Foreman next, Easy rarely). That is the correct
result for a commitment fix — it removes the twitch in the specific low-HP,
near-a-threat scenario the field report caught, without disturbing the roster
balance, which remains QA's knob (`bot-balance-day4.md`, finding 1). No timeouts,
no regressions.
