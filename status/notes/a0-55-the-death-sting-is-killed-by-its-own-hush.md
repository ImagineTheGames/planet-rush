# a0-55 — the station-death sting is cut off by its own hush

Branch: `agent/sound/a0-55-death-sting-survives-hush`
Owner: Sound Agent. Opened 2026-08-16.

## BUILT

The **preferred** fix, not the fallback: the death fall is routed to a path the
duck does not touch. The three seconds, the 0.12 s cut and the 0.9 s return are
byte-for-byte unchanged, and so is the sound itself.

- `ccc356d` — **fix(a0-55): the death sting takes a path the hush cannot reach**
  - `src/art/audio/graph.ts` — new `sting` gain node summed into `master`
    **past** the duck. The duck moves upstream of master
    (`buses → duck → master → destination`); gains commute, so nothing else
    changes acoustically. New `Route = Bus | 'sting'` for `play()`'s routing
    argument — `Bus` itself is untouched, so `weapons.ts`, `music.ts` and the
    settings path all compile unchanged.
  - The sting's level is the `sfx` bus's level, computed in one place
    (`applyBus`): the player's SFX slider **and** the alarm duck both still
    apply to it, and master is still on its path. The exemption is the hush and
    nothing else.
  - `src/art/audio/engine.ts` — `TELL.stationDeath` fires
    `flat(SOUND.stationDeath, 1, 'sting')`, and `flat()`'s hush gate skips the
    exempt route so a *second* home dying inside the first one's quiet is not a
    station destroyed in total silence.
  - `src/art/vfx/death-moment.ts` — doc only. Records the one exemption and the
    timing invariant it rests on; no behaviour, no numbers.
  - Tests: `src/art/audio/engine.test.ts` (new, 6 tests, incl. **the death
    sting outlives the hush**) and `src/art/vfx/death-moment.test.ts` (new,
    3 tests, incl. **cut does not begin before the death it holds**).
    `audio.test.ts` and `ui-cues.test.ts` had pinned the old topology; both
    updated in the same commit with the reason written in.
- `0493b1c` — **evidence(a0-55)**: `evidence/a0-55-death-sting/` — `envelope.txt`
  (measured table + drawn envelope), `envelope.ts` (the program), and four WAVs
  (`fall-`/`room-` × `before`/`after`).

The bug in one number, measured: the fall is 1.320 s; the player heard **0.133 s
of it, 10.1 % of its length and 12.2 % of its energy**, and **70.1 %** of it
lived past the cut unheard.

Gates: `npx tsc --noEmit` clean; `npm test -- --run` green.

## DECISIONS

- **Exempt bus, not delayed hush.** The brief's fallback (hold the quiet until
  the 1.1 s tail completes) would have cost ~1.1 s of a ratified three-second
  duration. The graph *can* express an exempt path, so it was not needed and was
  not taken.
- **The duck moved upstream of master rather than a mirrored second master.**
  The alternative — sting → destination with its own copy of the master volume —
  needs two params kept in sync forever, which is exactly the drift that
  produced this bug. One node, one path, one level.
- **Not a fifth `Bus`.** A bus means a slider and an alarm duck of its own; the
  fall should have neither, it should have the SFX ones. So it is a *routing*
  target (`Route`) whose gain is written by the same `applyBus` call that writes
  `sfx`'s.
- **The hush GATE is exempt too, not just the routing.** Routing the fall around
  the duck while `flat()` still refused to start it would have left overlapping
  deaths (which *refresh* the quiet) silent — the same bug, one death later.
- **Kept the pre-`trigger()` ordering.** It was never wrong, it was just never
  sufficient. The comment that claimed it was enough is now replaced with what
  actually delivers the intent.
- **Did not re-voice, did not lengthen the quiet.** a0-49 deliberately left
  `stationDeath` alone (`bank.ts:32`); this was a routing bug. `HUSH_S`,
  `HUSH_CUT_S`, `HUSH_RETURN_S` are asserted unchanged in
  `death-moment.test.ts`.
- **Test assertions are relationships** (LESSONS §26): the sting's path gain to
  the destination measured against the mix's *at the same instant*, and against
  its own value *before* the cut — no magic levels that a bus-trim change would
  invalidate.

## NEXT

- Nothing outstanding on the sound. The explosion **picture** is a0-56 and is
  the Art Agent's; this branch touches no visual file.
- If a later brief adds another hush-exempt voice, it goes through `Route` and
  must extend `engine.test.ts`'s "the exemption is one voice wide" assertion —
  that test is the leak detector for the three seconds.
