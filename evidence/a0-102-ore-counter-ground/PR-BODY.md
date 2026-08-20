# a0-102 — the ore counter has a ground now, and it is the HUD's own

QA failed the top-left of both a0-99 profiles: the counter *"drawn straight onto
whatever the world put there"*, with an asteroid carrying a **yellow ore crystal**
and a **gold vein ring** within a few tens of pixels of the counter's own
signal-yellow numeral. They were explicit that the frame was still readable, and
just as explicit about why that is not the point: *"what it has is no guarantee
that it will be, and the thing most likely to drift under a counter that reads
ore is a rock with ore on it."*

## Which of the two it was

The brief asked me to say whether the HUD already had a treatment for this or
whether no readout had one. **It has one, and this counter was drawing it.**

Every corner readout — `ORE`, `HOME`, the wave clock — wears the same chrome:
a `SCRIM.corner` scrim closed by a Bone edge rule, never a plate (`./instrument`,
u7-07). `Hud.drawOreChrome` was calling `drawScrim` on every frame the number
changed. So this is not a missing-language finding.

**The bug is that the scrim was sized to a rect coincident with its own type.**

```
width  = max(labelWidth, numeralWidth) + hudSpace(18)   // from the glyphs' own x
height = ruleY + hudSpace(SCRIM_BLEED)                  // from the glyphs' own y
```

All 18 px of slack sat to the **right** of the numeral, and none above, below or
left of it. A scrim decays to nothing at every edge — that is exactly what makes
it a scrim instead of a panel — so a rect coincident with the type puts the type
in the falloff. Measured on the shipped baseline at the desktop reference:

| where                           | coverage |
|---------------------------------|----------|
| `ORE`, leading glyph            | 0.15     |
| `ORE`, mid                      | 0.37     |
| banked numeral, leading column  | 0.15     |
| the closing rule                | 0.09–0.40|
| the one point that reached peak | 0.55     |

`SCRIM.corner`'s own doc says 0.55 is *"enough that 11px Oxanium survives a lit
asteroid passing under it, **and no more**"*. By that file's own stated reasoning
everything under 0.55 is not enough, and 0.55 was being reached at a single point
no glyph was standing on. **Chrome that was drawn and could not be seen.** QA read
the frame correctly.

There is a matching false premise in the test suite, which is how this survived a
file that already measured the right number: `instrument.test.ts`'s *"the stated
peak is a plateau the readout sits on"* asserts the peak at ±0.29 of the rect from
its centre and commented *"which is where the label's own glyphs are"*. They were
not — they were at the corner. Corrected in place.

## The fix

- **`instrument.ts`** — `scrimPlateau(rect, anchor)`: the part of a scrim that is
  actually dark, i.e. the innermost band where the advertised peak is reached and
  held. And `scrimGround(ink)`: the smallest `center` scrim whose plateau covers a
  given ink box. `drawScrim` now **interpolates its bands from the full rect to
  `scrimPlateau`**, so the shape of a scrim's core is decided in one place and the
  three cannot drift apart. See *The same defect, one level down* below.
- **`hud-geometry.ts`** — `oreCounterLayout(label, numeral, scale)`: pure, fed
  measured text, returning the two lines, the rule, the cluster's ink box and the
  ground under all of it. `TOTAL_LABEL_H` moved here as `ORE_LABEL_LEADING`, with
  the eyebrow/bank reference sizes, for `PROMPT_TYPE`'s reason — the ground has to
  be sized before any `Text` exists, so the geometry has to know the size.
- **`hud.ts`** draws from it and places both lines from it.

**One thing the evidence caught that the tests did not.** The first cut of this
kept the closing rule's 9 px-a-side overhang *and* then paid the ground's own
third on top of it, which pushed `ORE` to x = 70 on a landscape phone —
two pixels off the corner pause button, whose `PAUSE_BUTTON_LEFT` of 72 exists
precisely to be "past the top-left ORE block". Every test was green; the shot was
not. The rule spans the widest line of type now (a rule is a closing edge, not a
margin), the air the 18 px was buying comes from the ground where there is more of
it, and the clearance is asserted with its bound stated — `leaves the corner PAUSE
BUTTON alone`, every touch profile, banks up to 999. Wheel prices run 1–14 and a
hold is `CARGO_CAP_MAX` = 8 a trip, so four figures is not a state this economy
reaches, and that constant's own doc already assumed two-to-three digits. If that
changes, the test fails and the fix is to re-derive `PAUSE_BUTTON_LEFT`, not to
widen the bound.

**Why the counter moved.** The falloff has to go somewhere, and there are only two
places: onto the type, or into padding. It could not be bled outward — `ore-hud`
registers at `top-left` with margin `HUD_PAD`, `describeLayout` records what the
element *draws*, and a ground reaching past the margin fails QA's layout contract
on a real device (`tests/mobile/layout.spec.ts` failed on exactly that when the
corner scrims were first written; hud.ts carries the note). So the ground keeps
the corner and the type sits inside it, a third of the ink box in — that third is
what `1 / SCRIM_CORE` costs. The 18 px the cluster always carried is still 18 px;
it is split either side of the type now instead of spent entirely to the right,
where nothing was reading. `SCRIM_BLEED` is part of that inflation rather than
added by hand.

**The numeral's colour is untouched.** Signal yellow is ore by the palette
contract (style-guide §2) and the palette audit owns it; the separation comes from
the ground, as the brief requires.

## The same defect, one level down

The dark-matter gate (a1-09) went red on `scrimPlateau`: exported, tested four
ways, called by no production code — the `matchAbundance` shape the gate exists
to catch. Worth writing down that **neither `npx tsc --noEmit` nor `npm test`
runs that check**; it is a step of the `Typecheck, test, build` job, and a branch
can be green locally and red on it.

The gate offers wire-it-up, delete-it, or allowlist-with-a-reason. Allowlisting
would have been a lie, because `drawScrim`'s innermost band **already was the
plateau** — inset `scrimTaper` a side, `SCRIM_CORE` of the height, the same
anchor solve — computed from a second copy of those three lines. So the ground a
readout is handed (`scrimGround` → `scrimPlateau`) and the darkness actually
drawn agreed only because two copies of the same arithmetic happened to match.

That is this brief's defect at a smaller scale: a scrim whose rect is not the
thing it was solved against. The bands now interpolate from the full rect to
`scrimPlateau(rect, anchor)` — algebraically the previous expression, so no
pixels move and the goldens pass untouched — and `t = 1` lands on the plateau by
definition rather than by coincidence.

Two things came along because they would otherwise have regressed:

- Cost floats aimed at a hardcoded `PAD + 8, PAD + TOTAL_LABEL_H`. The numeral
  moved, so they now aim through the layout and off `oreGroup.x` — which also
  makes them follow the content box on an ultrawide, which they did not before.
- The chrome's redraw key was the banked *number*. The ground is sized from the
  measured text, so the key is the measured boxes now: `ORE` never changes and its
  width does, and a cluster first laid out against the boot fallback face would
  have kept that placement for the whole match.

## Definition of done

- **`the ore counter is legible over any world behind it`** — `hud-geometry.test.ts`.
  Asserts the ground exists, is the counter's own (never bled past the group
  origin), and that its **plateau** — not its rect — contains both glyph boxes and
  the rule. Every profile in the matrix, six bank widths. It is deliberately
  written against the plateau: the rect is mostly falloff, and falloff is what
  a0-99 photographed.
- Beside it, `is the fix a0-102 filed — the shipped rect FAILED the assertion
  above` reproduces the old sizing and asserts it fails all three containments, so
  *"failing today"* stays checkable after today.
- Plus an anchor sweep (the element grew **inward**: `ore-hud` and `banked-total`
  are still inside `top-left`/`HUD_PAD` everywhere), and four tests in
  `instrument.test.ts` including one that samples the **drawn** bands' coverage at
  the ink's four corners rather than trusting the arithmetic.
- **Evidence**: `evidence/a0-102-ore-counter-ground/shots/*-before-after.png` —
  the counter over the ore-bearing asteroid, before | after, at 4×, cut from the
  frozen golden scene on both profiles.

  Measured on those two frames, in luminance:

  | | before | after |
  |---|---|---|
  | ore crystals behind the counter (121 px) | **178.6** | **50.1** |
  | the banked numeral itself | 187.8 | 187.7 |
  | numeral ÷ crystal | **1.05×** | **3.75×** |

  QA's words were *"the same hue, at a similar size, with nothing separating
  them"*. At 1.05× there was nothing separating them. The numeral did not move a
  shade — the ore behind it lost two thirds of its luminance, because the ground
  dims everything under it and the readout is drawn on top of the ground.

- **Goldens rebaked** from the merged tree — with a caveat QA should see.
  `--update-snapshots` rewrote **nothing**: this change passes the existing
  baselines. `maxDiffPixelRatio` is 0.01, i.e. 1,229 px of the 122,880 px top
  band; the moved glyphs and rule come to roughly half that, and the scrim's
  darkening of the rock falls under `pixelmatch`'s per-pixel threshold and is not
  counted at all. A change this visible to a reader is invisible to that gate.
  I rebaked the two HUD-band baselines deliberately (deleted and regenerated),
  since they exist to depict the corner instruments; the full-frame baselines were
  left alone because they pass and rewriting them wholesale would put antialiasing
  churn in the diff. **The tolerance is QA's and is untouched** — flagging it, not
  changing it.
- `tests/mobile/layout.spec.ts` re-run: the grown element is still inside its
  declared anchor on a real device.

## Not changed here — flagged for the Director

`HOME` and the wave clock have the same coincident-edge shape.
`drawStationChrome` puts all 18 px of its slack to the **left** of the bar and
none above; the clock pads ±12 in x (it is centre-anchored) but nothing above its
first line. Neither is as exposed as this one — `HOME` inks a blue bar and bone
type, not a yellow numeral over yellow rock — and both have dependents that make
them a brief of their own: the touch zoom control stacks off `stationChromeHeight`
and the peer-presence banner hangs off the clock's drawn footprint. `scrimGround`
is there for whoever picks that up.
