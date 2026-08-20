# a0-102 — the ore counter's ground

## What the evidence is

`shots/*-before-after.png` — the top-left corner of the **golden scene**, at 4×,
before this branch on the left and after it on the right.

The A/B is cut from the golden baselines rather than from a bespoke capture,
because the golden scene already *is* the frame QA filed a0-99 on. `?freeze=1`
pins the seeded sim at a fixed tick and the renderer is a pure function of that
world, so the frame is identical on every boot and machine — and at that tick an
ore-bearing asteroid is drifting under the counter on both profiles: three
signal-yellow crystals and a gold vein ring, the hue and the size QA named.

    before = git show origin/main:tests/mobile/goldens.spec.ts-snapshots/<f>
    after  = the rebaked baseline on this branch

Same scene, same tick, same renderer. The only thing between the two images is
the change. Regenerate with:

    node evidence/a0-102-ore-counter-ground/crop.mjs

## What to look at

**Before.** `ORE`, the numeral `3` and the thin rule under them are drawn onto
the asteroid. There *is* a scrim under them — `SCRIM.corner`, 0.55, the same
chrome HOME and the wave clock wear — but it was sized to a rect coincident with
the type's own box, and a scrim decays to nothing at its edges. So the type sat
in the falloff:

| where                          | coverage |
|--------------------------------|----------|
| `ORE`, leading glyph           | 0.15     |
| `ORE`, mid                     | 0.37     |
| banked numeral, leading column | 0.15     |
| the closing rule               | 0.09–0.40|
| the one point that reached peak| 0.55     |

`SCRIM.corner`'s own doc calls 0.55 *"enough that 11px Oxanium survives a lit
asteroid passing under it, **and no more**"* — so by that constant's own
reasoning the counter had no ground, whatever the draw call was named. QA read
the frame correctly.

**After.** The counter sits in a soft dark blot that holds full coverage across
both glyph boxes and the rule, and still fades to nothing at its own boundary —
no panel edge, no box, the world still reads through it. The type starts a third
of its ink box in from the HUD margin, which is where the falloff went: it could
not be bled outward, because `ore-hud` registers what it *draws* and a ground
past the margin fails QA's layout contract.

The numeral is the same signal yellow it was. Yellow means ore (style-guide §2);
the separation comes from the ground.

## The number QA's finding turns on

Measured on the two golden frames above — the ore crystals *behind* the counter,
and the counter's own numeral, in luminance:

| | before | after |
|---|---|---|
| ore crystals behind the counter (121 px) | **178.6** | **50.1** |
| the banked numeral itself | 187.8 | 187.7 |
| numeral ÷ crystal | **1.05×** | **3.75×** |

That is the whole fix in one row. QA's complaint was *"the same hue, at a similar
size, with nothing separating them"* — and at 1.05× there was nothing separating
them. The numeral did not move a shade; the ore behind it lost two thirds of its
luminance, because the ground dims everything drawn under it and the readout is
drawn on top of the ground.

(The drop is 0.72 where the scrim's coverage is 0.55 because a crystal is far
brighter than the rock the constant was reasoned about, so the same coverage
takes more of it. And it is not 0.55 for the rock either — `SCRIM_COLOR` is
`PALETTE.vacuum`, not black, so 0.55 coverage of it costs a lit rock ~0.46 of its
luminance.)

**The landscape-phone crop shows something different, and deliberately so.** At
that tick the counter has open sky behind it, and a scrim over black is invisible
— which is the rule the whole treatment is built on: the world reads through it,
and where there is no world there is nothing to dim. What that crop is evidence
of is the *placement*: `ORE` clears the corner pause button with air to spare.
The first cut of this branch did not, and that shot is why the rule lost its
overhang (`ORE_RULE_OVERHANG`, deleted).

## A note for QA on the golden gate

`--update-snapshots` rewrote **nothing**: this change passes the existing
baselines. `GOLDEN.maxDiffPixelRatio` is 0.01 — 1,229 px of the 122,880 px top
band — and the counter's moved glyphs plus its rule come to roughly half that,
while the scrim's own darkening of the rock is under `pixelmatch`'s per-pixel
threshold and is not counted at all. So a change this visible to a reader is
invisible to the gate.

The two HUD-band baselines were therefore rebaked deliberately (deleted and
regenerated), because they exist to depict the corner instruments and should
depict the shipped ones. The full-frame baselines were left alone: they pass, and
rewriting them wholesale would put antialiasing churn in the diff. The tolerance
itself is QA's and is untouched.
