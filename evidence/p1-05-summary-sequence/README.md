# p1-05 — the end-of-match summary as a choreographed sequence

Evidence for `docs/briefs/pr-05-summary-sequence.md` (plan `docs/progression-plan.md` §6).
Regenerate with `npm run build && node evidence/p1-05-summary-sequence/capture.mjs`.

## The five frames — the REAL booted client, 844×390, dpr 3

One match, really played: `?debug=1`, thrust and bank on real keys through the real
input funnel, one hull lost through the sim's own `killShip`, and the win staged
through the sim's own `destroyCore`. The first four frames are **one sequence** with
its clock pinned (`__endScreenStage.summarySeek`) — four stills of four different
sequences would not be evidence of a timeline.

| # | file | beat | what the client reported that frame |
|---|---|---|---|
| 1 | `1-beat0-result-alone.png` | 0 @ 0.6 s | `phase: result` — CLAIM HELD, the rule, the line, and **nothing else on the screen**. The ache gets its beat (GDD §4.7). |
| 2 | `2-beat1-mid-count.png` | 1 @ 2.2 s | `phase: rows` — five rows landed, `DISTANCE TRAVELLED` **mid-count at 1 361** on its way to 1 488, `SHIPS USED` still fading in, no XP total, no bar. |
| 3 | `3-beat3-bar-mid-fill.png` | 3 @ 4.3 s | `phase: fill` — bar at **0.827** under `LEVEL 1`, readout live: **`+248 XP · 52 TO NEXT`**. |
| 4 | `4-beat5-settle.png` | 5 @ 30 s | `phase: settle`, `done`, `buttonsLive` — `LEVEL 2`, bar 0.061, `+355 XP · 854 TO NEXT`. |
| 5 | `5-reduced-motion.png` | — | The same staging under a real `prefers-reduced-motion: reduce` media emulation: the **same final numbers on the first frame**, `leveledUp: true` — the level-up is marked, not dropped. |

`frames.json` is the model behind each photograph, as the client reported it.

**`STATIONS DESTROYED` reads `—`, not `0`, in every frame.** The win was staged by
destroying cores directly, so nobody was credited with those deaths — which is the
Crush case exactly (plan §1.3c, Trap 12): a stat that cannot be credited to a real
player is not shown rather than estimated.

**The write happened, once.** `__endScreenStage.career()` reads the profile back
through `progression/profile.ts` after the sequence: `{ xp: 355, level: 2, matches: 1 }`
on a fresh career — 200 (win) + 140 (7 placement rungs) + 15 (a wave) — and the
reduced-motion run, which never watched a frame of animation, banked **the identical
355 / level 2 / 1 match**. Skipping the beat cannot skip the write, because the write
happens before there is anything to skip.

## The skip assertion, named

`src/ui/summary-sequence.test.ts` →
**`skipping (rule 1) › lands BYTE-IDENTICAL final models from every 100 ms mark`**

It runs three sequences (a fresh career, one mid-level, one about to level) to
completion, then re-runs each with a skip injected at **every 100 ms mark** from
before the first frame to past the last, and asserts `JSON.stringify(frame)` is
character-for-character identical to the watched ending. Its sibling,
**`reduced motion (rule 3) › is the sequence's own END STATE, byte for byte`**, holds
the same line for the motion preference.

Both were verified RED before they were left green: a skip that resolves 50 ms early
fails all three, and so do a station row that shows `0` for the Crush, a missing
collapse past three level-ups, and a first fill that is not paid in full.
