# a1-01 — main is red: the doors and the CODEX

Shot with `evidence/capture-a1-doors-frame-cost.mjs`, one pass per profile,
against the real `vite preview` build of each tree:

- `before-*` — `origin/main` @ `5d66213` (built in a throwaway worktree)
- `after-*` — this branch @ `bb054ad`

Three profiles, matching the mobile suite's device matrix
(`tests/mobile/shot-budget.ts`): desktop 1280×800 dpr 1, phone held **landscape**
844×390 dpr 3, and phone held **portrait** 390×844 dpr 3 — the last goes through
the landscape lock's 90° root rotation, which has stranded a menu off-screen
before.

## What to look at, and what NOT to expect

**The pictures should look almost the same.** That is the point, and it is worth
saying plainly: the defect was never that these screens looked wrong. u7-04's
Gantry/Bone re-skin is ratified and stays exactly as it is. The defect is that
both screens repainted their entire plate set *every frame*, which pegs the main
thread on the software-GL CI runner — so the failures were **timeouts**, not
assertions, and they landed in specs that only walk *through* the doors
(`slot-state`, `landscape-lock`) rather than in the specs that own them.

The one visible difference is the **body text face**: `FONT_BODY`'s fallback moved
from `"DejaVu Sans Mono"` (which only the CI runner has) to `"Liberation Mono"`
(which both the runner and the studio container have). Compare the door hints —
"A run of linked contracts, one claim after another." — between `before-` and
`after-`. Everything structural is unchanged: four doors, CAMPAIGN above PLAY
SOLO, PLAY SOLO the single bright plate, BACK and SETTINGS in the footer beam.

`*-doors-coming-soon.png` is the state a resting frame cannot show: the CAMPAIGN
teaser **answered**. `Coming Soon…` chalk-bright in the message slot, the four
doors still up, no keypad, no lobby — the u9-01 behaviour, intact before and after.

## The measurement that IS the before/after

`before-frame-cost.json` / `after-frame-cost.json`, median rAF delta over 60
frames, with the frozen match sampled in the same run on the same machine as the
yardstick (a ratio, because this suite runs on hardware GL locally and software GL
on the runner, ~6× apart):

| profile | screen | before | after |
|---|---|---|---|
| desktop | THE DOORS | 130.5 ms · **3.75×** | 17.0 ms · 0.47× |
| desktop | THE CODEX | 96.8 ms · **2.78×** | 17.1 ms · 0.48× |
| phone landscape | THE DOORS | 506.4 ms · **5.90×** | 53.1 ms · 0.61× |
| phone landscape | THE CODEX | 304.7 ms · **3.55×** | 52.7 ms · 0.61× |
| phone portrait | THE DOORS | 510.1 ms · **6.03×** | 57.9 ms · 0.70× |
| phone portrait | THE CODEX | 311.6 ms · **3.68×** | 58.3 ms · 0.70× |

Half a second per frame is about two frames a second, on the first screen a player
touches after PLAY. `tests/mobile/menu-frame-cost.spec.ts` now holds every static
Gantry screen to this ratio, not just the title.
