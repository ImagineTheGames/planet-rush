# a0-86 — explosions may burn red

Branch: `agent/art/a0-86-red-explosions`. Owner: Art Agent.

**A colour round on the existing lab. Nothing is ported.** The developer asked why
explosions are only blue; the ruling is that `threatRed` is a STATE colour
(danger), an explosion is a danger event, so red is legal — and `signalYellow`
stays ore, at any brightness.

## PLAN (in progress)

- `tools/explosion-lab/heat.ts` — the heat map: `plasma → threatRed`,
  `plasmaHot → shotEnemy3`. Applied to BOTH the baked look and the emitted tint.
- Each of the nineteen candidates gains a twin, ids `<id>-C` / `<id>-R`.
- `src/art/vfx/kinds.test.ts` — `no explosion particle lands on ore yellow`.
- style-guide.md: the cold rule narrowed to non-destruction energy.

## NEXT

Everything.
