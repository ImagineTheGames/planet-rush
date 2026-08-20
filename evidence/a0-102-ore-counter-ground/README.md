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
