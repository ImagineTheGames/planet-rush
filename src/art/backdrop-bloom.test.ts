/**
 * src/art/backdrop-bloom.test.ts — the bloom survives the renderer. OWNER: Art Agent.
 *
 * **a0-18.** The developer, from live play: *"the bloom orbs are gone, but they
 * are gone completely, they were supposed to be there with subtle bloom on random
 * stars…"*. Three renderer briefs had just landed — a1-11's texture pooling,
 * a1-12's viewport cull — and the leading suspicion was that one of them had
 * quantised or culled a 6%-alpha wash out of the frame.
 *
 * It had not. Measured on the served bundle against `ecc1496^`, same arena, same
 * seed, same viewport, same pinned tick: the void's own pixels differ by **68 of
 * 5,184,000**, all 68 at one rock's edge, and the star layers submit an identical
 * 319 bloomed stars of 1,624 before and after
 * (`evidence/a0-18-bloom-gone/`). **The bloom was never gone.**
 *
 * So this file exists for the reason the round exposed rather than the bug it went
 * looking for: **nothing in the suite could have told the difference.**
 *
 *  · `backdrop.test.ts` asserts the halos are in the {@link SpriteDef} — what the
 *    generator AUTHORS. It is DOM-free and stops there, so every renderer change
 *    in the game's history could have dropped the halos on the way to the frame
 *    and it would still have passed.
 *  · The goldens cannot help. The frozen scene runs the default arena, `octagon`,
 *    and while `octagon` does carry all three star layers, a halo at
 *    `BLOOM.intensity[1]` paints **Δ14 of luma at its widest ring** over Floor —
 *    two builds either side of a total bloom loss produce plates a reviewer reads
 *    as identical. That is why the a1-11/a1-12 re-baseline review did not catch
 *    it, and it is why a golden is the wrong instrument for this and always was.
 *
 * The gap between those two is the whole distance from `starFieldSprite` to the
 * screen, and it is where all three suspects lived. This file closes it, by
 * asserting on **what the live `Graphics` submits** — `context.instructions`,
 * grouped by centre, which is the identical read-back
 * `evidence/a0-18-bloom-gone/probe-bloom.mjs` takes off the running build through
 * Pixi's devtools hook. The unit test and the evidence therefore agree, to the
 * instruction, on what "the bloom is on the stage" means.
 *
 * Every assertion here fails if the halos stop reaching the frame — whether that
 * is a bake that quantises 6% to nothing, a cull that reaches a backdrop layer, a
 * reducer that sheds more than it claims, or an editor that "improves" `BLOOM`
 * upward (a0-07 chose the lowest of the three magnitudes shown, on purpose).
 */

import { describe, expect, it } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { BLOOM, STAR_LAYERS, VoidBackdrop, type MapId } from './backdrop';

/** The developer's desktop, over a mid-sized arena. */
const VIEW = { w: 1440, h: 900 } as const;
/** A phone at the other end of the range — the device a1-11/a1-12 were tuned for. */
const PHONE = { w: 844, h: 390 } as const;
const BOUNDS = { w: 3200, h: 2000 } as const;

/** One star, as the frame received it: every fill submitted at a single centre,
 *  in submitted order. */
interface SubmittedStar {
  readonly x: number;
  readonly y: number;
  /** Radii in submitted order — bloom is authored back-to-front, so a bloomed
   *  star arrives outer halo, inner halo, then its own point. */
  readonly radii: number[];
  readonly alphas: number[];
}

/**
 * Read a star layer off the stage exactly as the live probe does: walk the
 * `Graphics`'s own instruction list, take every filled circle, and group by
 * centre. Three fills at one centre is a bloomed star; one is a plain one.
 *
 * This deliberately does NOT go through `starFieldSprite` — the point is to
 * measure the far end of the pipeline, so the sprite definition is not consulted
 * and cannot vouch for itself.
 */
function submittedStars(layer: Graphics): SubmittedStar[] {
  // `context.instructions` is Pixi 8's own record of what was played into the
  // Graphics. Typed as unknown and narrowed here rather than cast wholesale, so a
  // Pixi upgrade that changes the shape fails loudly instead of silently reading
  // zero stars and passing.
  const ctx = (layer as unknown as { context?: { instructions?: unknown[] } }).context;
  expect(ctx, 'the layer is a Graphics with a GraphicsContext').toBeTruthy();
  const instructions = ctx?.instructions;
  expect(Array.isArray(instructions), 'the context exposes an instruction list').toBe(true);

  const byCentre = new Map<string, { x: number; y: number; radii: number[]; alphas: number[] }>();
  for (const raw of instructions as { action?: string; data?: unknown }[]) {
    if (raw.action !== 'fill') continue;
    const data = raw.data as { style?: { alpha?: number }; path?: { instructions?: { action?: string; data?: number[] }[] } };
    const circle = data.path?.instructions?.find((p) => p.action === 'circle');
    if (!circle?.data) continue;
    const [x, y, r] = circle.data as [number, number, number];
    const key = `${x},${y}`;
    const entry = byCentre.get(key) ?? { x, y, radii: [], alphas: [] };
    entry.radii.push(r);
    entry.alphas.push(data.style?.alpha ?? Number.NaN);
    byCentre.set(key, entry);
  }
  return [...byCentre.values()];
}

/** The star layers on the stage, in draw order, keyed by their layer key. */
function starLayers(b: VoidBackdrop): Map<string, Graphics> {
  const out = new Map<string, Graphics>();
  for (const child of b.view.children as Container[]) {
    const label = child.label ?? '';
    if (label.startsWith('void-stars-')) out.set(label.replace('void-stars-', ''), child as Graphics);
  }
  return out;
}

function boot(view = VIEW, mapId: MapId = 'octagon', reduced = false): VoidBackdrop {
  const b = new VoidBackdrop();
  b.setMap(mapId);
  if (reduced) b.setReduceVfx(true);
  b.configure(BOUNDS.w, BOUNDS.h, view.w, view.h);
  return b;
}

const bloomedOf = (stars: SubmittedStar[]) => stars.filter((s) => s.radii.length >= 3);
const plainOf = (stars: SubmittedStar[]) => stars.filter((s) => s.radii.length === 1);

describe('the bloom reaches the frame, not just the sprite definition', () => {
  it('submits a halo for BLOOM.scatter of the stars in every layer', () => {
    const layers = starLayers(boot());
    expect([...layers.keys()], 'all three depth layers are on the stage').toEqual(
      STAR_LAYERS.map((s) => s.key),
    );

    for (const [key, gfx] of layers) {
      const stars = submittedStars(gfx);
      // A layer that submitted nothing at all is the failure this whole round was
      // called to rule out; assert it is not that before measuring a ratio of it.
      expect(stars.length, `${key} submitted stars`).toBeGreaterThan(50);

      const bloomed = bloomedOf(stars);
      expect(bloomed.length, `${key} submitted bloomed stars`).toBeGreaterThan(0);

      // Every star is either plain or fully bloomed — a group of 2 would mean a
      // halo went missing on the way to the frame, which is precisely the defect
      // shape the brief suspected of the pooling.
      expect(
        bloomed.length + plainOf(stars).length,
        `${key}: every star is 1 fill or 3, never a partial halo`,
      ).toBe(stars.length);

      // The seeded scatter, measured at the frame. Loose bounds on purpose: the
      // count is a draw from the seed, so ±30% is the sampling noise on a few
      // hundred stars, and the assertion under test is "the halos arrive at
      // roughly the ratified rate", not a golden number.
      const ratio = bloomed.length / stars.length;
      expect(ratio, `${key} bloom ratio ${ratio.toFixed(3)} vs BLOOM.scatter`).toBeGreaterThan(
        BLOOM.scatter * 0.7,
      );
      expect(ratio, `${key} bloom ratio ${ratio.toFixed(3)} vs BLOOM.scatter`).toBeLessThan(
        BLOOM.scatter * 1.3,
      );
    }
  });

  it('submits each halo at the ratified radius and the ratified alpha', () => {
    for (const [key, gfx] of starLayers(boot())) {
      for (const star of bloomedOf(submittedStars(gfx))) {
        expect(star.radii.length, `${key}: a bloomed star is three fills`).toBe(3);
        const [outer, inner, core] = star.radii as [number, number, number];
        const [outerA, innerA, coreA] = star.alphas as [number, number, number];

        // Radii are multiples of the star's OWN radius (BLOOM.radii), which is
        // what makes the bloom scale with the star instead of being a fixed disc.
        // 1e-3 absorbs the 4-decimal quantisation in `round` (../art/shapes).
        expect(inner, `${key}: inner halo is ${BLOOM.radii[0]}x the star`).toBeCloseTo(
          core * BLOOM.radii[0],
          2,
        );
        expect(outer, `${key}: outer halo is ${BLOOM.radii[1]}x the star`).toBeCloseTo(
          core * BLOOM.radii[1],
          2,
        );

        // Alphas are fractions of the star's own alpha (BLOOM.intensity). This is
        // the assertion that a bake which quantises a 6% wash to zero — suspect
        // one of a0-18, and the one the brief said to test first — cannot pass.
        expect(innerA, `${key}: inner halo alpha is ${BLOOM.intensity[0]}x the star's`).toBeCloseTo(
          coreA * BLOOM.intensity[0],
          3,
        );
        expect(outerA, `${key}: outer halo alpha is ${BLOOM.intensity[1]}x the star's`).toBeCloseTo(
          coreA * BLOOM.intensity[1],
          3,
        );

        // Subtle is not absent. The faintest halo in the set is the deep layer's
        // outer ring at 0.26 x 0.065 = 0.0169, and it must survive as a positive
        // alpha rather than being floored away.
        expect(outerA, `${key}: the faintest halo still carries ink`).toBeGreaterThan(0);
      }
    }
  });

  it('draws the halo BEHIND the star, so the point sits on its own glow', () => {
    for (const [key, gfx] of starLayers(boot())) {
      for (const star of bloomedOf(submittedStars(gfx))) {
        const [outer, inner, core] = star.radii as [number, number, number];
        // Submitted order is draw order (../art/textures `drawSprite`), so the
        // core arriving last is what puts it on top. Reversed, a 16%-alpha disc
        // would wash over every star it belongs to.
        expect(outer, `${key}: widest ring first`).toBeGreaterThan(inner);
        expect(inner, `${key}: then the inner ring`).toBeGreaterThan(core);
      }
    }
  });
});

describe('nothing downstream may take the bloom back off the stage', () => {
  it('keeps every star layer drawing when the reducer engages mid-match', () => {
    // Suspect three of a0-18. `setReduceVfx`'s own doc comment says the stars,
    // "near-free once baked, stay" — this is that sentence, asserted. The frozen
    // probe cannot test it at all, because `?freeze=1` pins the tier to full
    // (src/main.ts), so on the golden path this claim was pure documentation.
    const b = boot();
    const before = new Map(
      [...starLayers(b)].map(([k, g]) => [k, bloomedOf(submittedStars(g)).length]),
    );
    expect([...before.values()].every((n) => n > 0), 'the bloom is there to begin with').toBe(true);

    b.setReduceVfx(true);
    for (let frame = 0; frame < 120; frame++) b.configure(BOUNDS.w, BOUNDS.h, VIEW.w, VIEW.h);

    const after = starLayers(b);
    expect([...after.keys()], 'all three layers are still on the stage').toEqual([...before.keys()]);
    for (const [key, gfx] of after) {
      expect(gfx.visible, `${key} is still drawing`).toBe(true);
      expect(gfx.renderable, `${key} is still renderable`).toBe(true);
      expect(gfx.alpha, `${key} is at full alpha`).toBe(1);
      expect(bloomedOf(submittedStars(gfx)).length, `${key} kept every bloomed star`).toBe(
        before.get(key),
      );
    }
  });

  it('blooms on a device that boots ALREADY throttled', () => {
    // The mid-match test above is not enough on its own, and the hole was found by
    // running the defect rather than by reading the code
    // (`evidence/a0-18-bloom-gone/mutation-check.mjs`): r9-01's density pin makes
    // `configure` a no-op once a sky is committed, so a reducer that sheds star
    // layers inside the build loop is never reached mid-match and the assertion
    // passes over the bug. The device that boots with the manual reduce-VFX
    // setting already on runs that loop at the reduced tier from frame one — the
    // quieter half of the same loss r9-01 named, and the case that catches it.
    const throttled = starLayers(boot(VIEW, 'octagon', true));
    expect([...throttled.keys()], 'a throttled boot still builds all three layers').toEqual(
      STAR_LAYERS.map((s) => s.key),
    );
    for (const [key, gfx] of throttled) {
      expect(gfx.visible, `${key} draws at the reduced tier`).toBe(true);
      expect(bloomedOf(submittedStars(gfx)).length, `${key} blooms at the reduced tier`).toBeGreaterThan(0);
    }
  });

  it('keeps the bloom through a resize while throttled', () => {
    // The other way into the build loop at the reduced tier, and the one a player
    // actually hits: a mobile URL-bar reflow or a rotate IS a rebuild trigger
    // (r9-01 — it re-bakes the same sky rather than taking the chance to shed it).
    // A reducer that thins the star field would take effect here, mid-match, in
    // front of someone.
    const b = boot();
    const before = new Map(
      [...starLayers(b)].map(([k, g]) => [k, bloomedOf(submittedStars(g)).length]),
    );
    b.setReduceVfx(true);
    b.configure(BOUNDS.w, BOUNDS.h, VIEW.w, VIEW.h - 120); // the URL bar arrives
    b.configure(BOUNDS.w, BOUNDS.h, PHONE.h, PHONE.w); // and a rotate, for good measure

    const after = starLayers(b);
    expect([...after.keys()], 'every layer survived both rebuilds').toEqual([...before.keys()]);
    for (const [key, gfx] of after) {
      expect(gfx.visible, `${key} still draws after the reflow`).toBe(true);
      // Not the same COUNT — the field is re-authored for the new viewport, so a
      // smaller screen legitimately holds fewer stars. The assertion is that the
      // rate survives: the halos are still arriving with the field.
      const stars = submittedStars(gfx);
      expect(stars.length, `${key} rebuilt a field`).toBeGreaterThan(20);
      const ratio = bloomedOf(stars).length / stars.length;
      expect(ratio, `${key} still blooms at BLOOM.scatter after the reflow`).toBeGreaterThan(
        BLOOM.scatter * 0.7,
      );
    }
  });

  it('blooms on a phone as well as a desktop', () => {
    // The cull and the pooling were both tuned against a phone, and both take the
    // viewport as an input. A bloom that only survives at desktop scale would be
    // a regression for most of the players.
    for (const [key, gfx] of starLayers(boot(PHONE))) {
      const stars = submittedStars(gfx);
      expect(stars.length, `${key} has a field at phone scale`).toBeGreaterThan(20);
      expect(bloomedOf(stars).length, `${key} blooms at phone scale`).toBeGreaterThan(0);
    }
  });

  it('blooms on every arena, including the five that carry a sky', () => {
    // The goldens only ever see `octagon`. a0-07 chose "subtle" precisely so bloom
    // would survive a bright nebula without adding to it, and that half of the
    // decision has never been under test on any arena that has one.
    const arenas: MapId[] = ['octagon', 'compass', 'oval', 'diamond', 'line', 'crescents'];
    for (const arena of arenas) {
      const layers = starLayers(boot(VIEW, arena));
      expect([...layers.keys()], `${arena} carries all three star layers`).toEqual(
        STAR_LAYERS.map((s) => s.key),
      );
      for (const [key, gfx] of layers) {
        expect(bloomedOf(submittedStars(gfx)).length, `${arena}/${key} blooms`).toBeGreaterThan(0);
      }
    }
  });
});
