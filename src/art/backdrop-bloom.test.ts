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
 *
 * **a0-22 extends it to the halo's COLOUR, for the same reason and on the same
 * instrument.** *"our mockups had different colored blooms these are all 1 color
 * there are no stars in them"* — so a bloom's tint (`BLOOM_TINTS`) is now part of
 * what has to survive the trip from `starFieldSprite` to the frame, and so is the
 * thing that answers the second half of that sentence: **the star's own point is
 * submitted inside every halo, last, and never in the halo's colour**. The
 * geometry read-back below already grouped fills by centre; it now records each
 * fill's colour too, which is the identical read
 * `evidence/a0-22-bloom-colour/probe-star-in-bloom.mjs` takes off the running
 * build. Nothing here weakens an a0-18 assertion — the file only gains.
 */

import { describe, expect, it } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import {
  BLOOM,
  BLOOM_TINTS,
  SPIKE,
  STAR_LAYERS,
  VoidBackdrop,
  coverSpan,
  type MapId,
} from './backdrop';
import { MOCKUP_STARS, starAlpha } from './mockup-reference';
import { hex } from './palette';

/**
 * **The fraction of stars that bloom, from the design's own two numbers**
 * (a0-40). Magnitude is `u^exponent` for a uniform `u`, so the population above
 * the threshold is `1 − threshold^(1/exponent)` — about 6.2%. It is derived
 * rather than typed in, so a change to the design's curve moves this with it and
 * cannot leave the frame silently over- or under-blooming.
 *
 * This replaces `BLOOM.scatter`. The rule changed: a0-07's bloom was a seeded
 * scatter at any magnitude and the design's is the brightest stars, so "how many
 * blooms should reach the frame" is now a property of the curve.
 */
const BLOOM_RATE = 1 - Math.pow(MOCKUP_STARS.bloom.threshold, 1 / MOCKUP_STARS.magnitudeExponent);

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
  /** Fill colours, in the same submitted order (a0-22). */
  readonly colors: number[];
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

  const byCentre = new Map<
    string,
    { x: number; y: number; radii: number[]; alphas: number[]; colors: number[] }
  >();
  for (const raw of instructions as { action?: string; data?: unknown }[]) {
    if (raw.action !== 'fill') continue;
    const data = raw.data as {
      style?: { alpha?: number; color?: number };
      path?: { instructions?: { action?: string; data?: number[] }[] };
    };
    const circle = data.path?.instructions?.find((p) => p.action === 'circle');
    if (!circle?.data) continue;
    const [x, y, r] = circle.data as [number, number, number];
    const key = `${x},${y}`;
    const entry = byCentre.get(key) ?? { x, y, radii: [], alphas: [], colors: [] };
    entry.radii.push(r);
    entry.alphas.push(data.style?.alpha ?? Number.NaN);
    entry.colors.push(data.style?.color ?? Number.NaN);
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

function boot(
  view: { readonly w: number; readonly h: number } = VIEW,
  mapId: MapId = 'octagon',
  reduced = false,
): VoidBackdrop {
  const b = new VoidBackdrop();
  b.setMap(mapId);
  if (reduced) b.setReduceVfx(true);
  b.configure(BOUNDS.w, BOUNDS.h, view.w, view.h);
  return b;
}

// A bloomed star submits TWO fills at its centre since a0-40 — one soft-falloff
// halo and the point on top of it — where it used to submit three (two flat
// rings and the point). Its diffraction cross is two strokes, and strokes are
// not fills, so they do not enter this grouping.
const bloomedOf = (stars: SubmittedStar[]) => stars.filter((s) => s.radii.length >= 2);
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

      // Every star is either plain or fully bloomed — a group of more than 2
      // would mean the halo and the point disagreed about their centre, which is
      // precisely the defect shape the brief suspected of the pooling.
      expect(
        bloomed.length + plainOf(stars).length,
        `${key}: every star is 1 fill or 2, never a partial halo`,
      ).toBe(stars.length);
      expect(bloomed.every((s) => s.radii.length === 2), `${key}: a bloom is one halo`).toBe(true);

      // The design's threshold, measured at the frame. Loose bounds on purpose:
      // the count is a draw from the seed, so ±30% is the sampling noise, and the
      // assertion under test is "the halos arrive at the design's rate", not a
      // golden number.
      const ratio = bloomed.length / stars.length;
      expect(ratio, `${key} bloom ratio ${ratio.toFixed(3)} vs the design's ${BLOOM_RATE.toFixed(3)}`)
        .toBeGreaterThan(BLOOM_RATE * 0.7);
      expect(ratio, `${key} bloom ratio ${ratio.toFixed(3)} vs the design's ${BLOOM_RATE.toFixed(3)}`)
        .toBeLessThan(BLOOM_RATE * 1.3);
    }
  });

  it('submits each halo at the design’s radius and the design’s alpha', () => {
    for (const [key, gfx] of starLayers(boot())) {
      for (const star of bloomedOf(submittedStars(gfx))) {
        expect(star.radii.length, `${key}: a bloomed star is two fills`).toBe(2);
        const [halo, core] = star.radii as [number, number];
        const [haloA, coreA] = star.alphas as [number, number];

        // The halo is a multiple of the star's OWN radius, which is what makes
        // the bloom scale with the star instead of being a fixed disc. 1e-2
        // absorbs the 4-decimal quantisation in `round` (../art/shapes).
        expect(halo, `${key}: the halo is ${BLOOM.radius}x the star`).toBeCloseTo(core * BLOOM.radius, 2);
        // …and its alpha is the design's ABSOLUTE peak — the same wash on every
        // bloomed star, whatever its own alpha (a0-44). This is the assertion
        // that a bake which quantises a faint wash to zero — suspect one of
        // a0-18, and the one that brief said to test first — cannot pass.
        expect(haloA, `${key}: halo alpha is the design's ${BLOOM.peakAlpha}`).toBeCloseTo(
          BLOOM.peakAlpha,
          3,
        );
        // It is emphatically NOT a fraction of the star's own any more, and the
        // bright end of the field is where the two rules differ most.
        expect(haloA, `${key}: the halo does not scale with its star`).not.toBeCloseTo(
          coreA * BLOOM.intensity,
          3,
        );
        // The faintest halo in the game belongs to the faintest star that blooms
        // at all, and it must survive as a positive alpha rather than be floored.
        expect(haloA, `${key}: the faintest halo still carries ink`).toBeGreaterThan(0);
      }
    }
  });

  it('draws the halo BEHIND the star, so the point sits on its own glow', () => {
    for (const [key, gfx] of starLayers(boot())) {
      for (const star of bloomedOf(submittedStars(gfx))) {
        const [halo, core] = star.radii as [number, number];
        // Submitted order is draw order (../art/textures `drawSprite`), so the
        // core arriving last is what puts it on top. Reversed, a 48%-alpha disc
        // would wash over every star it belongs to.
        expect(halo, `${key}: the halo comes first and is the wider disc`).toBeGreaterThan(core);
      }
    }
  });

  it('gives every bloomed star its diffraction cross, and nothing else one (a0-40)', () => {
    // The design draws the halo and the spikes on one population, because a halo
    // and a spike are one physical event. This is that, at the frame: two stroked
    // polylines per bloomed star, and the arms are the star's own colour.
    for (const [key, gfx] of starLayers(boot())) {
      const blooms = bloomedOf(submittedStars(gfx)).length;
      const ctx = (gfx as unknown as { context?: { instructions?: unknown[] } }).context;
      const strokes = ((ctx?.instructions ?? []) as { action?: string }[]).filter(
        (i) => i.action === 'stroke',
      ).length;
      expect(strokes, `${key}: two arms per bloomed star`).toBe(blooms * 2);
      // **This assertion used to be the other way round** — `SPIKE.length >
      // BLOOM.radius`, "the arms reach past the halo's own radius" — and it
      // passed for as long as the defect lived, because it was written from the
      // numbers rather than from the design. In the design the cross is measured
      // OFF the halo (`halo × 0.62`), so it is inside the glow by construction,
      // and a build where it is not is the one the developer photographed:
      // *"some of these with the lil crosshair looking things"* on stars with
      // *"none of them have the bloom effect"* (a0-44).
      expect(SPIKE.length, 'the arms stay inside the halo’s own radius').toBeLessThan(BLOOM.radius);
    }
  });
});

describe('the bloom’s COLOUR reaches the frame, and a star sits inside it (a0-22)', () => {
  const tints = new Set<number>(Object.values(BLOOM_TINTS));
  /** The steel value ramp a star's own point is drawn from (style-guide §1). */
  const ramp = new Set<number>(STAR_LAYERS.flatMap((l) => l.inks.map((i) => i.color)));

  it('submits the tint on the halo and the star’s own colour on the point', () => {
    // The shape of the defect this guards: a generator that tinted the point as
    // well would put a cyan dot in the sky where §1 requires a bright one. It is
    // invisible to a golden and it is one edit away. (Before a0-40 a bloom was
    // two flat rings and this also checked they agreed; a soft falloff is one
    // shape, so there is no longer a ring to disagree with.)
    for (const [key, gfx] of starLayers(boot())) {
      for (const star of bloomedOf(submittedStars(gfx))) {
        const [halo, core] = star.colors as [number, number];
        expect(ramp.has(core), `${key}: a star POINT was submitted ${hex(core)}`).toBe(true);
        expect(tints.has(core), `${key}: the point took the halo's tint`).toBe(false);
        expect(
          tints.has(halo) || halo === core,
          `${key}: halo ${hex(halo)} is neither a ratified tint nor the star's own colour`,
        ).toBe(true);
      }
    }
  });

  it('puts a tinted bloom on the stage, in every hue, on the layers that carry one', () => {
    const layers = starLayers(boot());
    const seen = new Map<string, Set<number>>();
    for (const [key, gfx] of layers) {
      const hues = new Set<number>();
      for (const star of bloomedOf(submittedStars(gfx))) {
        const halo = star.colors[0]!;
        if (tints.has(halo)) hues.add(halo);
      }
      seen.set(key, hues);
    }
    for (const spec of STAR_LAYERS) {
      const declared = new Set(spec.inks.map((i) => i.halo).filter((h): h is number => h !== undefined));
      const onStage = seen.get(spec.key)!;
      // Every hue the layer declares reaches the frame…
      for (const h of declared) {
        expect(onStage.has(h), `${spec.key} declares ${hex(h)} but the stage has none`).toBe(true);
      }
      // …and no layer invents one it never declared. `deep` declares none, which
      // is the assertion that the far layer stayed on the value ramp.
      for (const h of onStage) {
        expect(declared.has(h), `${spec.key} submitted an undeclared tint ${hex(h)}`).toBe(true);
      }
    }
    expect(
      new Set([...seen.values()].flatMap((s) => [...s])).size,
      'the frame carries more than one bloom hue',
    ).toBeGreaterThan(1);
  });

  it('keeps the steel ramp the majority of what a FRAME blooms', () => {
    // a0-07's void is a steel field, and this change is a minority of tints in
    // it, not a repaint. The claim is about a *frame*, so the count has to be
    // per-screenful: a layer's baked field is `coverSpan` of its own parallax, so
    // `near` bakes a field five times `deep`'s and a raw total over the whole
    // stage over-weights the two layers that carry a tint. Normalising by field
    // area recovers the share a player actually sees, which is the design's own
    // 0.61 / 0.30 / 0.09.
    let tinted = 0;
    let total = 0;
    for (const [key, gfx] of starLayers(boot())) {
      const spec = STAR_LAYERS.find((l) => l.key === key)!;
      const area =
        coverSpan(spec.parallax, VIEW.w, BOUNDS.w) * coverSpan(spec.parallax, VIEW.h, BOUNDS.h);
      const perScreen = (VIEW.w * VIEW.h) / area;
      for (const star of bloomedOf(submittedStars(gfx))) {
        total += perScreen;
        if (tints.has(star.colors[0]!)) tinted += perScreen;
      }
    }
    expect(total, 'the stage bloomed at all').toBeGreaterThan(10);
    expect(tinted, 'no tinted bloom reached the stage').toBeGreaterThan(0);
    expect(
      tinted / total,
      `${tinted.toFixed(1)}/${total.toFixed(1)} of a screenful's blooms are tinted`,
    ).toBeLessThan(0.5);
  });

  it('draws the star LAST, so a coloured bloom still has a star in it', () => {
    // The developer's second sentence, as an assertion on the frame: the point is
    // submitted after both of its halo rings, so it is painted on top of them —
    // and since the point keeps the ramp's white/steel while the halo takes a
    // hue, a tinted bloom is now the EASIEST place in the sky to find a star.
    for (const [key, gfx] of starLayers(boot())) {
      for (const star of bloomedOf(submittedStars(gfx))) {
        const [haloA, coreA] = star.alphas as [number, number];
        expect(coreA, `${key}: the point is fainter than its own halo`).toBeGreaterThan(haloA);
        // Submitted order is draw order, so "last" is "on top".
        expect(star.radii[1], `${key}: the point is not the last fill at its centre`).toBe(
          Math.min(...star.radii),
        );
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
      expect(ratio, `${key} still blooms at the design's rate after the reflow`).toBeGreaterThan(
        BLOOM_RATE * 0.7,
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
