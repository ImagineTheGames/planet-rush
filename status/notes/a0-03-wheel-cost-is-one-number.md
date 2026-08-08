# a0-03-wheel-cost-is-one-number.md — working notes (ui)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

Branch `agent/ui/a0-03-wheel-cost-one-number`, cut from `origin/main` at
`4960540` (which already contains l2-02's voice sweep — read DECISIONS #1).

## BUILT

- **The wedge cost is one number.** `segmentCostLabel` returns `` `${cost}` ``
  instead of `` `${cost}/${floor(spendableOre)}` ``. That is the entire
  behaviour change; every state machine around it is untouched.
- **The `5/4` rationale is deleted, not orphaned.** `build-wheel.ts`'s comment
  arguing that a player reading `5/4` "knows they are one ore short without the
  wheel having to say so" is gone with the code, replaced by the retraction and
  its date. Same for the stale `cost/held` line in `wheel-stack.ts`,
  `build-wheel-view.ts`, `hud-geometry.ts`(+`.test`) — the *build* wheel ones only.
- **`build-wheel.test.ts` re-pointed, not deleted.** The `cost/held` describe
  became `the cost line — the cost, one number (a0-03)`: payable wedge draws the
  bare cost with `costPaint: 'ore'`; unaffordable draws the bare cost with
  `'refused'`; **no cost label contains `/`** over six frames × five wedges
  (ready / unaffordable / capped / inactive-cooling / inactive-collapsed);
  `FULL` still steel; the count line still `n / m BUILT` and still separate.
- **Top-left caption `ORE`** (`hud.ts`), plus the `chrome.ts:45` comment, the
  `ore-hud.ts` header, and the copy-sweep row that shipped `BANKED`.
- **GDD §2.5** amended in place: the `cost/held` clause struck from the
  2026-08-06 marker line, the bullet rewritten with the retraction verbatim, the
  count-over-cap bullet explicitly marked untouched. §2.2 carries the caption.
- **`docs/design-amendments.md`** — new top entry with both quotes and both open
  questions.

## DECISIONS

**1. The top-left already said `BANKED`, not `TOTAL`.** The brief quotes
`hud.ts:592` as `makeText('TOTAL', …)`. It was `TOTAL` when the developer
screenshotted it; l2-02's voice sweep took an `[OPT]` row to `BANKED` and merged
into main at 20:04 on the same day, hours after the report. So this brief's
rename is really `BANKED → ORE`, and it supersedes an l2-02 decision rather than
the original. Both the copy-sweep doc and the amendments entry say so — a future
reader finding `BANKED` in the sweep table needs to know it lost.

**2. `ORE` now sits on two different numbers, and I did not resolve it.** Top-left
= bank alone. Wheel hub = `spendableOre` (hold + bank) — and the hub's caption
*already* read `ORE` before this brief (`build-wheel-view.ts:377`). Hold 3 / bank
5 → **5** top-left, **8** in the hub. The brief anticipated exactly this and told
me: rename as asked, screenshot both at a non-empty hold, and if the honest
resolution is that the *hub* should read something else, say so and leave it.
Done: both readouts are in the PR body, the question is flagged in GDD §2.2 and
in the amendments entry, and **nothing about either number's meaning changed.**
Rejected: inventing `BANKED ORE` / `SAFE` for the top-left (the brief forbids a
third label to dodge the question), and quietly re-pointing the hub at `banked`
(that changes what a number MEANS to make a word fit, and would break the wheel's
own affordability display).

**3. The UPGRADE wheel still prices `12/8`, deliberately.** The retraction came
with a *build*-wheel screenshot and names that screen's numerals; the brief's
enumerated scope, its "what must NOT change" list and its DoD all name
`build-wheel.test.ts` and nothing on the upgrade side. So I changed the build
wheel only. **But it is not a comfortable state:** `style-guide.md` §2.1 rules
the two wheels one control — "a player crosses between them in one press; a rule
that changed colour across that press would be the drift this section exists to
prevent" — and that argument reads on grammar as much as on hue. Flagged loudly
in GDD §2.5's upgrade-wheel bullet (marked ⚠ OPEN, with the reason), in the
amendments entry, and at the top of the PR body with both wheels screenshotted.
It is a one-line change (`upgrade-wheel.ts` `costLabelOf`) plus goldens whenever
the developer says the word. **Do not "tidy" it up without a ratification** —
widening past a brief this specific is how a neighbour gets cut (LESSONS §14),
and it is the same mistake in the other direction.

**4. Files outside `src/ui/` reverted.** `src/main.ts` and `src/art/materials.ts`
both carry stale `cost/held` doc comments. I edited them, then reverted: they are
Platform's and Art's. Named in the PR body for their owners instead.

**5. QA-owned specs touched only where they pinned the string.**
`tests/mobile/build-wheel-gantry.spec.ts` (3 assertions) and
`tests/mobile/goldens.spec.ts` (1 assertion + 2 comments) asserted `6/8` / `6/4`
and would have failed red on a correct build. Minimal re-point, same intent,
called out for QA in the PR body. `tests/mobile/upgrade-wheel-gantry.spec.ts`
untouched — see #3.

## NEXT

- [ ] Goldens re-baselined in the container, eyes on every image, one line of
      justification each (the four build-wheel shots + every shot carrying the
      top-left caption: frozen ×2, frozen-teams ×3, and any wheel shot that shows
      the HUD behind it).
- [ ] PR body: the developer's screenshot beside the new render at the SAME ore
      count (2 held), and the top-left + hub in one frame at a non-empty hold.
- [ ] Both open questions restated at the top of the PR for the developer.
- [ ] Coordinate with a0-08 ("picked up ore from dead ships dont count"): looting
      raises `cargo`, so the top-left banked figure correctly does not move —
      almost certainly the same root. Between us the two numbers have to tell a
      story a player can follow; a readout captioned `ORE` that does not move
      when you pick up ore is worse than one captioned `TOTAL` that does not.
