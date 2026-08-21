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
 * **a0-22 extended it to the halo's COLOUR, for the same reason and on the same
 * instrument** — *"our mockups had different colored blooms these are all 1 color
 * there are no stars in them"* — and **a0-45 replaced what that block asserts
 * without touching how it asserts it.** a0-22 could only put a hue on the
 * *scatter*, because the star's own point was pinned to a grey value ramp; the
 * design colours the point, from the star's own temperature, and paints its halo
 * and its cross in the same colour. So the claim that has to survive the trip
 * from `starFieldSprite` to the frame is now **one colour per star, submitted
 * three times**, and the second half of the developer's sentence is answered the
 * same way it was: the point is submitted inside every halo, last, and it is the
 * brightest thing at that centre. The geometry read-back below records each
 * fill's colour, which is the identical read
 * `evidence/a0-22-bloom-colour/probe-star-in-bloom.mjs` takes off the running
 * build. Nothing here weakens an a0-18 assertion — the file only gains.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import {
  BLOOM,
  SPIKE,
  STAR_LAYERS,
  VOID_SEED,
  VoidBackdrop,
  coverSpan,
  starFieldSprite,
  type MapId,
} from './backdrop';
import { MOCKUP_STARS, STAR_TEMPERATURE_COLORS, haloRadiusOf, starRadius } from './mockup-reference';
import {
  falloffRamp,
  premultiplied,
  rampPixels,
  rampUpload,
  rampUploadPath,
  type RampUpload,
} from './textures';
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

/**
 * **Every diffraction cross on a layer, by the centre it is drawn on** (a0-123),
 * with how many arms arrived there.
 *
 * A cross arrives as two stroked polylines, each a `moveTo`/`lineTo` pair through
 * the star — so the arm's MIDPOINT is the star's centre, and it is the key
 * {@link submittedStars} groups fills under. Reading the centre back off the
 * geometry rather than off the sprite definition is what lets "which stars wear a
 * cross" be answered at the frame, which is the only place the developer can see
 * it.
 *
 * The midpoint is rounded to 4 decimals to match `./shapes` `round`, which is the
 * quantisation the fills' own keys already carry; without it an exact-string join
 * against a fill centre would miss on float noise and the test would read zero
 * crosses and pass everything.
 */
function crossArmsByCentre(layer: Graphics): Map<string, number> {
  const ctx = (layer as unknown as { context?: { instructions?: unknown[] } }).context;
  const out = new Map<string, number>();
  const q = (v: number): number => Math.round(v * 10000) / 10000;
  for (const raw of (ctx?.instructions ?? []) as { action?: string; data?: unknown }[]) {
    if (raw.action !== 'stroke') continue;
    const data = raw.data as { path?: { instructions?: { action?: string; data?: number[] }[] } };
    const pts = (data.path?.instructions ?? []).filter(
      (p) => p.action === 'moveTo' || p.action === 'lineTo',
    );
    expect(pts.length, 'a spike arm is a moveTo and a lineTo').toBe(2);
    const [a, b] = pts.map((p) => p.data as [number, number]) as [
      [number, number],
      [number, number],
    ];
    const key = `${q((a[0] + b[0]) / 2)},${q((a[1] + b[1]) / 2)}`;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
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

  /**
   * **a0-123 changed how MANY stars bloom and which of them flare. It did not
   * touch how hard a bloom blooms** — and that is asserted here rather than
   * claimed in a PR body, because it is the thing that has gone wrong twice.
   *
   * The developer, on a0-44: *"on the designs their bloom radius was larger… why
   * does this keep getting messed up"*. Both numbers below are the design's own,
   * settled by a0-44/a0-45, and both are one careless edit from a brief about
   * star COUNTS. The two assertions immediately after this one measure the same
   * two numbers **at the frame**; this pair pins the constants those are measured
   * against, so a build cannot satisfy them by moving the target.
   */
  it('leaves the halo’s radius and its alpha exactly where a0-44 put them', () => {
    expect(BLOOM.radius, 'halo radius, star-radii — 5 + 13 × 0.48').toBe(11.24);
    expect(BLOOM.peakAlpha, 'halo peak alpha, ABSOLUTE — 0.42 × 0.48').toBe(0.2016);
    // And the two the cross is drawn from, which a0-123 also leaves alone: only
    // WHETHER an arm is drawn changed, never how long or how bright it is.
    expect(SPIKE.length, 'arm length, star-radii — halo × 0.62').toBe(6.9688);
    expect(SPIKE.peakAlpha, 'arm alpha, ABSOLUTE — 0.22 × 0.48').toBe(0.1056);
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

  /**
   * **A cross is its own draw** (a0-123), at the frame.
   *
   * This replaces `expect(strokes).toBe(blooms * 2)` — *"two arms per bloomed
   * star"* — which pinned the rule the developer has now overturned: *"make it so
   * not all of them have that cross, that should also be a random thing so some
   * of them with bloom have that others don't"*.
   *
   * The old assertion is not merely relaxed into a range. It is **inverted**: the
   * thing that must now be true at the frame is that the two populations *both
   * exist*, which `blooms * 2` forbade and which a loosened `toBeLessThanOrEqual`
   * would also pass on a build that had simply stopped drawing crosses at all.
   * So all three are asserted — some do, some do not, and nothing that failed to
   * bloom wears one.
   *
   * Every number here is read off `Graphics`'s own instruction list, the same far
   * end of the pipeline the rest of this file measures; the sprite definition is
   * not consulted and cannot vouch for itself.
   */
  it('a cross is its own draw, not a property of blooming', () => {
    for (const [key, gfx] of starLayers(boot())) {
      const stars = submittedStars(gfx);
      const bloomed = bloomedOf(stars);
      const armsAt = crossArmsByCentre(gfx);

      // 1. **Nothing that did not bloom wears a cross.** Blooming is still what
      //    makes a star ELIGIBLE — a0-123 loosened which of the eligible flare,
      //    not which are allowed to. This is the half of the old assertion that
      //    survives intact, and it is the half a0-44 was reported on.
      const bloomedAt = new Set(bloomed.map((s) => `${s.x},${s.y}`));
      for (const centre of armsAt.keys()) {
        expect(bloomedAt.has(centre), `${key}: a cross at ${centre} on a star with no halo`).toBe(
          true,
        );
      }

      // 2. **Some bloomed stars carry a cross and some do not** — the developer's
      //    sentence, at a fixed seed, as two counts that must both be non-zero.
      const crossed = bloomed.filter((s) => armsAt.has(`${s.x},${s.y}`));
      const bare = bloomed.filter((s) => !armsAt.has(`${s.x},${s.y}`));
      expect(bloomed.length, `${key} submitted bloomed stars`).toBeGreaterThan(20);
      expect(crossed.length, `${key}: no bloomed star wears a cross`).toBeGreaterThan(0);
      expect(bare.length, `${key}: EVERY bloomed star wears a cross — a0-123 undone`).toBeGreaterThan(
        0,
      );
      // …and stated once more as the negation of exactly what this replaced, so a
      // build that reverts the rule fails on the sentence that named it.
      const strokes = [...armsAt.values()].reduce((n, arms) => n + arms, 0);
      expect(strokes, `${key}: ${strokes} arms — the old rule's ${bloomed.length * 2}`).not.toBe(
        bloomed.length * 2,
      );

      // 3. **A crossed star wears a WHOLE cross.** Two arms or none: one arm is a
      //    star that lost half its flare, which no rule in the art produces and
      //    which the count assertions above would happily accept.
      for (const [centre, arms] of armsAt) {
        expect(arms, `${key}: ${arms} arm(s) at ${centre} — a cross is two`).toBe(2);
      }

      // 4. **At the design's chance**, which is what makes it a draw rather than
      //    a pattern. ±30% is the sampling noise on a count this size, matching
      //    the bloom-ratio bound above; the assertion is "the arms arrive at the
      //    ruled rate", not a golden number.
      const rate = crossed.length / bloomed.length;
      const want = SPIKE.chance;
      expect(rate, `${key} cross rate ${rate.toFixed(3)} vs the ruled ${want.toFixed(2)}`)
        .toBeGreaterThan(want * 0.7);
      expect(rate, `${key} cross rate ${rate.toFixed(3)} vs the ruled ${want.toFixed(2)}`)
        .toBeLessThan(Math.min(1, want * 1.3));

      // 5. **And the draw is not the star's brightness wearing a disguise.** The
      //    cross comes off its own stream (`../art/backdrop` `starFieldSprite`),
      //    so the crossed and the bare halves of the bloomed population must be
      //    the same population — if the bit had been derived from magnitude, the
      //    crossed stars would be systematically the big ones. Compared on the
      //    star's own point radius, which is monotone in magnitude.
      const meanR = (xs: SubmittedStar[]): number =>
        xs.reduce((t, s) => t + Math.min(...s.radii), 0) / xs.length;
      const spread = Math.abs(meanR(crossed) - meanR(bare)) / meanR(bloomed);
      expect(
        spread,
        `${key}: crossed stars mean r ${meanR(crossed).toFixed(3)} vs bare ${meanR(bare).toFixed(3)}` +
          ' — the cross is tracking magnitude',
      ).toBeLessThan(0.1);
    }
  });

  it('keeps the cross inside the halo, and the halo the design’s size (a0-40, a0-44)', () => {
    for (const [key, gfx] of starLayers(boot())) {
      expect(bloomedOf(submittedStars(gfx)).length, `${key} bloomed at all`).toBeGreaterThan(0);
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

describe('the star’s COLOUR reaches the frame, and the whole star wears it (a0-45)', () => {
  /**
   * **a0-45 replaced what this block guards, and the instrument is unchanged.**
   *
   * a0-22's version asserted that a halo carried one of two ratified `BLOOM_TINTS`
   * while the star's point stayed on the grey value ramp — the arrangement that
   * existed because the point could not be coloured. The design colours the
   * point: a star has a *temperature*, and its point, its halo and its cross are
   * all painted in `starColorFor(temp)`. So the claim that has to survive the
   * trip from `starFieldSprite` to the frame is a different one, and it is
   * stronger — **one colour per star, submitted three times**.
   *
   * Everything a0-22 put on the stage is still checked here on the new
   * arrangement: the point is submitted last and therefore on top; it is the
   * brightest of the three; the frame carries more than one bloom colour; and no
   * layer invents a colour the design cannot produce.
   */
  it('submits one colour per star — the point, its halo and its arms agree', () => {
    // The shape of the defect this guards: a generator that coloured the point
    // from the temperature and left the halo on a ramp (or on a tint) would put
    // a grey glow around a blue star. It is invisible to a golden and it is one
    // edit away — it is, in fact, exactly what `main` does.
    for (const [key, gfx] of starLayers(boot())) {
      for (const star of bloomedOf(submittedStars(gfx))) {
        const [halo, core] = star.colors as [number, number];
        expect(
          STAR_TEMPERATURE_COLORS.has(core),
          `${key}: a star POINT was submitted ${hex(core)}, which starColorFor cannot produce`,
        ).toBe(true);
        expect(halo, `${key}: halo ${hex(halo)} is not its own star's colour ${hex(core)}`).toBe(core);
      }
    }
  });

  it('puts both of the design’s temperatures on the stage, on every layer', () => {
    // The design's field is 78% blue-white and 22% amber, and both have to reach
    // the frame on every depth — a layer that lost one of the two branches would
    // read as a single-temperature sky and would pass every count assertion.
    const layers = starLayers(boot());
    for (const [key, gfx] of layers) {
      const hot = new Set<number>();
      const cool = new Set<number>();
      for (const star of bloomedOf(submittedStars(gfx))) {
        const c = star.colors[0]!;
        const [r, , b] = [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
        (b > r ? hot : cool).add(c);
      }
      expect(hot.size, `${key}: no blue-white bloom on the stage`).toBeGreaterThan(0);
      expect(cool.size, `${key}: no amber bloom on the stage`).toBeGreaterThan(0);
    }
    // …and nothing anywhere on the stage is a value-ramp colour or an a0-22 tint.
    for (const [key, gfx] of layers) {
      for (const star of submittedStars(gfx)) {
        for (const c of star.colors) {
          expect(
            STAR_TEMPERATURE_COLORS.has(c),
            `${key}: the stage carries ${hex(c)}, which is not a star colour`,
          ).toBe(true);
        }
      }
    }
  });

  it('keeps the frame’s blooms mostly blue-white, in the design’s own proportion', () => {
    // The claim is about a *frame*, so the count has to be per-screenful: a
    // layer's baked field is `coverSpan` of its own parallax, so `near` bakes a
    // field five times `deep`'s and a raw total over the whole stage over-weights
    // the near layers. Normalising by field area recovers the share a player
    // actually sees, which is the design's own 0.61 / 0.30 / 0.09.
    let hot = 0;
    let total = 0;
    for (const [key, gfx] of starLayers(boot())) {
      const spec = STAR_LAYERS.find((l) => l.key === key)!;
      const area =
        coverSpan(spec.parallax, VIEW.w, BOUNDS.w) * coverSpan(spec.parallax, VIEW.h, BOUNDS.h);
      const perScreen = (VIEW.w * VIEW.h) / area;
      for (const star of bloomedOf(submittedStars(gfx))) {
        const c = star.colors[0]!;
        total += perScreen;
        if ((c & 0xff) > ((c >> 16) & 0xff)) hot += perScreen;
      }
    }
    expect(total, 'the stage bloomed at all').toBeGreaterThan(10);
    expect(
      hot / total,
      `${hot.toFixed(1)}/${total.toFixed(1)} of a screenful's blooms are blue-white`,
    ).toBeCloseTo(MOCKUP_STARS.temperature.hotShare, 1);
  });

  it('draws the star LAST, so a coloured bloom still has a star in it', () => {
    // The developer's second sentence, as an assertion on the frame: the point is
    // submitted after its halo, so it is painted on top of it — and since the
    // halo's alpha is absolute (0.2016) while the point's runs to 0.5, the star
    // is the brightest thing inside its own glow whatever its temperature.
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


// ---------------------------------------------------------------------------
// a0-53 — measured off the shipped frame
// ---------------------------------------------------------------------------
//
// **Every bloom assertion above this line — and every one in `backdrop.test.ts`
// — measures the MODEL.** They read the shapes `starFieldSprite` authors, or the
// instructions the live `Graphics` submits, and check those against the design's
// own rules. That is the right instrument for "did the halo reach the stage",
// and it is why four rounds of green tests have coexisted with a developer
// opening the game and seeing the wrong thing:
//
//   a0-22  the bloom's colour        measured, correct, still reported
//   a0-44  the halo radius vs spike  measured, correct, still reported
//   a0-45  the halo vs spike alpha   measured, correct, still reported
//   a0-53  the radius, again
//
// a0-53 measured the **lit pixel** instead, and the break is past every one of
// those instruments. LESSONS §26 says assert relationships rather than values;
// this block is the other half of it — assert them on **the artefact the player
// is looking at**, in pixels.
//
// ## The frames
//
// Both are real renders, committed under `evidence/a0-53-bloom-radius/frames/`
// so the gate and the audit measure the same bytes, and both are captured with
// QA's own frozen boot (`?debug=1&freeze=1`, desktop 1280×800 at dpr 1 — which
// is `octagon`, and therefore sky NONE: ground and stars, nothing else):
//
//  · `renderer-probe.png` — the whole real `src/render` `Renderer`, driven as
//    `src/main.ts` drives it, built by the app's own Vite production pipeline
//    (`evidence/a0-53-bloom-radius/vite.probe.config.ts`). **This is the frame
//    the art is responsible for**, and the one this file gates.
//  · `desktop-frozen-octagon.png` — the shipped client, from `dist/`.
//
// The camera offset each was drawn at is captured beside it, so the frames can
// be REGISTERED: the same `starFieldSprite` call in this process names every
// star in them, and each measured blob is compared with the radius IT declared
// rather than with a population average.
//
// ## The two `it`s, and why the second is `it.fails`
//
// The art draws the design's radius: measured 24–30 px against a declared
// 24.3–27.5, in a dev build and in a production bundle, through `VoidBackdrop`
// alone and through the whole `Renderer`. **The shipped bundle draws the same
// stars at 17–19 px**, and the cause is not in `src/art/`: the identical
// `index.html`, from the identical source, built with a different Vite config
// draws it correctly (`evidence/a0-53-bloom-radius/audit.txt`). It is a
// bundling/scene-composition fragility in how the sky's thousands of gradient
// fills get batched, and every candidate fix inside Art's own files — a render
// group on the void, grouping the halos into one contiguous run, dropping the
// ramp's mipmaps — was tried against the shipped bundle and measured as NOT
// fixing it.
//
// So the second assertion was recorded as `it.fails`, with the instruction that
// the day the bundle stopped eating the outer band it had to become a plain
// `it`. **a0-62 is that day, and the paragraph above it is wrong in one place:
// the cause was NOT outside `src/art/`.** The falloff ramp reached the GPU
// premultiplied twice, so every soft fill painted `f²`, and a0-53's control
// ("the identical index.html, built by the probe config, is correct") does not
// reproduce — that bundle measures 0.690 today as well. What made a probe
// correct and the game wrong was never the build: it was that a probe page
// uploads no image texture, and `UNPACK_PREMULTIPLY_ALPHA_WEBGL` is global GL
// state (./textures `rampUpload`; `evidence/a0-62-app-shell-bloom/`). The
// second `it` now measures the shipped bundle at the same viewport, boot and
// camera offset, and passes.

describe('measured off the shipped frame', () => {
  const FRAMES = join(__dirname, '../../evidence/a0-53-bloom-radius/frames');
  /** The frozen desktop golden's viewport, and `octagon`'s arena (`WORLD_SIZE`). */
  const SHOT = { w: 1280, h: 800 };
  const ARENA = { w: 2400, h: 2400 };
  /** The camera offset both frames were drawn at (`shipScreen − shipWorld`). */
  const OFFSET = { x: -1328, y: -800 };

  interface Frame {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8Array;
  }

  const frame = (file: string): Frame => PNG.sync.read(readFileSync(join(FRAMES, file))) as unknown as Frame;
  /** a0-62's frames — the same viewport, boot and camera offset, one build later. */
  const A0_62 = join(__dirname, '../../evidence/a0-62-app-shell-bloom/frames');
  const frame62 = (file: string): Frame =>
    PNG.sync.read(readFileSync(join(A0_62, file))) as unknown as Frame;

  const lumaOf = (img: Frame, x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return NaN;
    const i = (y * img.width + x) * 4;
    return 0.2126 * img.data[i]! + 0.7152 * img.data[i + 1]! + 0.0722 * img.data[i + 2]!;
  };

  /** Median light on the ring of radius `r`. A median, so the four diffraction
   *  arms — a few per cent of any ring — cannot set the answer, and neither can
   *  one stray texel. */
  const ring = (img: Frame, cx: number, cy: number, r: number): number => {
    const s: number[] = [];
    const n = Math.max(8, Math.ceil(2 * Math.PI * r * 3));
    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * k) / n;
      const v = lumaOf(img, Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a)));
      if (!Number.isNaN(v)) s.push(v);
    }
    s.sort((a, b) => a - b);
    return s[s.length >> 1] ?? NaN;
  };

  interface Bloom {
    readonly sx: number;
    readonly sy: number;
    /** The star's OWN radius — what the design's rule scales. */
    readonly starR: number;
    readonly layer: string;
  }

  /**
   * **The bloom threshold the two frames in this block were DRAWN at** (a0-123).
   *
   * Both PNGs are historical captures — a0-53's frozen desktop shot and a0-62's
   * shipped bundle — and a capture is a record of the build that made it. a0-123
   * raised {@link BLOOM}`.threshold` from this to 0.92, so enumerating "the
   * blooms in this frame" from today's constant asks the wrong question of a file
   * that cannot answer a new one: it returns a *subset*, and the samples it drops
   * are real halos sitting in those pixels.
   *
   * It is not a tolerance and it is not a copy of a live number — it is the value
   * of a variable at a moment in the past, so it is written down rather than
   * derived, and it is pinned to these two files and nothing else. If either
   * frame is ever re-captured, this moves with it.
   *
   * (The count is what breaks, not the measurement: on today's constant this
   * block still finds 2 clean blooms and both still measure correct. But 2 is
   * under the 4 the assertions require to call a median a median, and a bar
   * lowered to fit is a bar that stops catching a0-53's defect.)
   */
  const FRAME_BLOOM_THRESHOLD = 0.86;

  /**
   * Every bloomed star **in the frame**, registered: the same `starFieldSprite`
   * call the client made, placed by the camera offset it drew at.
   *
   * The blooms are taken from the star POINTS, by the radius the frame's own
   * threshold implies, rather than from the halos in today's sprite — see
   * {@link FRAME_BLOOM_THRESHOLD}. `starRadius` is monotone in magnitude, so
   * "radius at or above the threshold star's" is exactly "magnitude above the
   * threshold", which is `starBlooms` written in the one unit the frame records.
   */
  const registered = (): { blooms: Bloom[]; points: { x: number; y: number; r: number }[] } => {
    const blooms: Bloom[] = [];
    const points: { x: number; y: number; r: number }[] = [];
    const cut = starRadius(FRAME_BLOOM_THRESHOLD);
    for (const spec of STAR_LAYERS) {
      const w = coverSpan(spec.parallax, SHOT.w, ARENA.w);
      const h = coverSpan(spec.parallax, SHOT.h, ARENA.h);
      const px = SHOT.w / 2 + OFFSET.x * spec.parallax;
      const py = SHOT.h / 2 + OFFSET.y * spec.parallax;
      const mine: { x: number; y: number; r: number }[] = [];
      for (const s of starFieldSprite(spec, VOID_SEED, w, h).shapes) {
        // Today's halos are skipped outright: which stars carry one is the very
        // thing that moved, and the point beneath each is in the list regardless.
        if (s.path.kind !== 'circle' || s.fill?.falloff) continue;
        mine.push({ x: px + s.path.cx, y: py + s.path.cy, r: s.path.r });
      }
      points.push(...mine);
      // The star's own radius is what the design's rule scales, and here it is
      // also what identifies the star as one this frame drew a halo around.
      for (const p of mine) {
        if (p.r >= cut - 1e-9) blooms.push({ sx: p.x, sy: p.y, starR: p.r, layer: spec.key });
      }
    }
    return { blooms, points };
  };

  /**
   * Drawn-versus-designed for every bloom the frame lets you measure.
   *
   * A bloom is only measurable where the frame around it is EMPTY SKY, and the
   * two disqualifiers are asked of the two different sources: another star close
   * enough to add its own light is a MODEL question, and anything that is not
   * the backdrop at all — a rock, the station, the HUD — is a PIXEL question,
   * asked by requiring the annulus beyond this star's own reach to be at ground.
   */
  const ratios = (img: Frame): { ratio: number; b: Bloom; drawn: number; design: number }[] => {
    const { blooms, points } = registered();
    const ground = lumaOf(img, 2, 2);
    const out: { ratio: number; b: Bloom; drawn: number; design: number }[] = [];
    for (const b of blooms) {
      if (b.sx < 50 || b.sy < 50 || b.sx > SHOT.w - 50 || b.sy > SHOT.h - 50) continue;
      let crowded = false;
      for (const o of blooms) if (o !== b && Math.hypot(o.sx - b.sx, o.sy - b.sy) < 32) crowded = true;
      for (const p of points) {
        if (p.r < 1.2) continue; // a faint star adds under one code value
        const d = Math.hypot(p.x - b.sx, p.y - b.sy);
        if (d > 0.01 && d < 32) crowded = true;
      }
      if (crowded) continue;

      // ── THE DESIGN SIDE IS A RULE, NOT A NUMBER ANYONE TYPED ──────────────
      // `5 + 13 × intensity` is the design preview's own line, scaled by the
      // radius of the very star being measured. `BLOOM.radius` is never read
      // here, so this cannot be satisfied by a constant agreeing with itself —
      // which is exactly how 4.3 passed a gate for a whole release (a0-44).
      const design = haloRadiusOf(BLOOM.intensity) * b.starR;

      let clean = true;
      for (let r = Math.ceil(design * 1.15); r <= Math.ceil(design * 2); r++) {
        if (!(ring(img, b.sx, b.sy, r) - ground < 1.0)) clean = false;
      }
      if (!clean) continue;

      let drawn = 0;
      for (let r = 1; r <= Math.ceil(design * 1.6); r++) {
        if (ring(img, b.sx, b.sy, r) - ground > 0.6) drawn = r;
      }
      out.push({ ratio: drawn / design, b, drawn, design });
    }
    return out;
  };

  const median = (a: number[]): number => [...a].sort((x, y) => x - y)[a.length >> 1]!;

  /**
   * The floor is the 8-bit frame, not slack. Past `t = 0.9` the design's own
   * gradient carries under 5% of its peak, which over Floor is under one code
   * value — so a CORRECTLY drawn halo measures a few per cent short of its
   * geometry. Measured across every correct reference: per-star **0.879–0.925**,
   * field median **0.908**. The shipped bundle measures per-star **0.666** and a
   * field median of **0.690**. The bars sit in the gap, near enough the middle
   * that neither a stray texel nor a Chromium version moves the answer:
   * a correct field clears them by 0.08 and the defect misses by 0.13.
   */
  const PER_STAR = 0.8;
  const FIELD = 0.85;

  it('the art draws the design radius, in pixels of a real frame', () => {
    const img = frame('renderer-probe.png');
    expect(img.width, 'the reference is the frozen desktop shot').toBe(SHOT.w);
    expect(img.height).toBe(SHOT.h);

    const rows = ratios(img);
    expect(rows.length, 'the frame carries measurable blooms on clean sky').toBeGreaterThanOrEqual(4);
    for (const r of rows) {
      expect(
        r.ratio,
        `${r.b.layer} bloom at (${Math.round(r.b.sx)},${Math.round(r.b.sy)}): drawn ${r.drawn}px against the design's ${r.design.toFixed(2)}px`,
      ).toBeGreaterThan(PER_STAR);
    }
    const m = median(rows.map((r) => r.ratio));
    expect(m, 'the field as a whole draws the design radius').toBeGreaterThan(FIELD);
    // "Not close enough, the same" cuts both ways: a halo that overshot the
    // design would be just as wrong as one that fell short.
    expect(m, 'and does not exceed it').toBeLessThan(1.15);
  });

  /**
   * **This was `it.fails`, and a0-62 flipped it.**
   *
   * a0-53 recorded it KNOWN RED with the instruction that *"the day the bundle
   * stops eating the halo's outer band this goes red and must become a plain
   * `it`"*. That day is a0-62: the shipped client drew these stars at 17–19 px
   * because the falloff ramp reached the GPU premultiplied twice, so every soft
   * fill painted `f²` (`./textures` `rampUpload`;
   * `evidence/a0-62-app-shell-bloom/`). a0-53's diagnosis — "the cause is
   * outside `src/art/`" — was wrong, and its own control does not reproduce: the
   * identical `index.html` built by the probe config measures 0.690 today too.
   *
   * The frame is a0-62's, captured from the shipped bundle at the same viewport,
   * the same frozen boot and the same camera offset as a0-53's. a0-53's
   * `desktop-frozen-octagon.png` stays where it is, unmeasured by this file now,
   * as the historical record of what the defect looked like.
   */
  it('...and so does the shipped bundle', () => {
    const rows = ratios(frame62('fixed-dpr1.png'));
    expect(rows.length, 'the shipped frame carries measurable blooms on clean sky').toBeGreaterThanOrEqual(4);
    for (const r of rows) {
      expect(
        r.ratio,
        `${r.b.layer} bloom at (${Math.round(r.b.sx)},${Math.round(r.b.sy)}): drawn ${r.drawn}px against the design's ${r.design.toFixed(2)}px`,
      ).toBeGreaterThan(PER_STAR);
    }
    expect(median(rows.map((r) => r.ratio)), 'the shipped field draws the design radius').toBeGreaterThan(
      FIELD,
    );
  });
});


// ---------------------------------------------------------------------------
// a0-62 — the ramp's trip to the GPU
// ---------------------------------------------------------------------------
//
// **Every test above this line, and every frame a0-22/44/45/53 measured, ran on
// a page with no image texture on it.** That is not a detail about the harness;
// it is the whole bug, and it is why five rounds of green measurements coexisted
// with a developer photographing stars that have *"no glowing bloom"* at all.
//
// `UNPACK_PREMULTIPLY_ALPHA_WEBGL` is GLOBAL GL state. pixi 8.6.6 sets it in
// exactly one place — `glUploadImageResource`, which does
// `gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, alphaMode === 'premultiply-alpha-on-upload')`
// on every image or canvas upload — and `glUploadBufferImageResource` never
// touches it. The falloff ramp was a `BufferImageSource` carrying ALREADY
// premultiplied texels, so it inherited whatever the last upload left behind:
//
//   · a page with fonts and atlases (the game) leaves the flag TRUE, and the
//     ramp is premultiplied a SECOND time — `rgb = a²/255`;
//   · a page with none (`field-probe`, `renderer-probe`, `sky-preview`, this
//     runner) leaves it FALSE, and the ramp is correct.
//
// Measured off the GPU of the running client, not argued: authored 203 arrives
// as 161, 154 as 93, 68 as 18 — `a²/255` to the code value
// (`evidence/a0-62-app-shell-bloom/audit.txt`, `probe-ramp.mjs`). Squaring is not
// a dimmer halo, it is a different curve: it takes 80% of the light out at
// `t = 0.35` and puts the whole outer half of every star's glow under one 8-bit
// code value, while leaving the point and the diffraction cross — flat fill and
// stroke, neither of which samples the ramp — untouched. That is the
// developer's photograph.
//
// ## Why this block is named for the resolution
//
// The brief that found this asked for a gate named `at the resolution the app
// bakes at`, on the hypothesis that `src/main.ts`'s `resolution: dpr` /
// `Math.min(dpr, 2)` was the variable. **It is not** — the app shell was driven
// at deviceScaleFactor 1, 1.5, 2 and 3 and all four collapse identically
// (audit.txt). The name is kept because it is the handle a sixth round will
// look for, and because what it now gates is the same question asked properly:
// what the app's own upload does to the ramp, rather than what a probe's does.
//
// ## Why this is not a tautology
//
// The model below is pixi's upload rule, and it is anchored to the numbers
// measured off the GPU rather than to itself: the FIRST assertion replays the
// old arrangement and requires it to reproduce 203→161, 154→93, 68→18. A model
// that could not produce the defect could not gate the fix either.

describe('the ramp reaches the GPU premultiplied ONCE (a0-62)', () => {
  /**
   * pixi 8.6.6's GL upload, as its two uploaders actually behave.
   *
   *  - `image` (`glUploadImageResource`) PINS `UNPACK_PREMULTIPLY_ALPHA_WEBGL`
   *    from the source's own `alphaMode`, every upload, so what came before
   *    cannot reach it.
   *  - `buffer` (`glUploadBufferImageResource`) never calls `pixelStorei` at
   *    all, so it uploads under whatever flag the page happened to leave set.
   */
  const uploaded = (u: RampUpload, flagBefore: boolean): Uint8Array => {
    const premultiplyOnUpload =
      u.via === 'image' ? u.alphaMode === 'premultiply-alpha-on-upload' : flagBefore;
    const out = Uint8Array.from(u.pixels);
    if (!premultiplyOnUpload) return out;
    for (let i = 0; i < out.length; i += 4) {
      const a = out[i + 3]!;
      out[i] = Math.round((out[i]! * a) / 255);
      out[i + 1] = Math.round((out[i + 1]! * a) / 255);
      out[i + 2] = Math.round((out[i + 2]! * a) / 255);
    }
    return out;
  };

  /** The ramp is 256², so its centre row runs from the core out past the rim. */
  const RAMP_SIZE = 256;
  const texel = (px: Uint8Array, out: number): [number, number] => {
    const i = ((RAMP_SIZE / 2) * RAMP_SIZE + RAMP_SIZE / 2 + out) * 4;
    return [px[i]!, px[i + 3]!];
  };

  it('reproduces the collapse the GPU read-back measured, so the model can gate it', () => {
    // The arrangement this brief replaced: already-premultiplied texels through
    // the uploader that pins nothing, on a page whose fonts left the flag true.
    const old = {
      pixels: premultiplied(rampPixels('halo')),
      alphaMode: 'premultiplied-alpha',
      via: 'buffer',
    } as const satisfies RampUpload;

    const gpu = uploaded(old, true);
    // The three texels probe-ramp.mjs read back off the running client. The
    // authored value is whatever the design's curve puts there; the assertion is
    // that the model turns it into the number the GPU actually held.
    for (const out of [10, 20, 40, 60, 80]) {
      const [, authored] = texel(old.pixels, out);
      const [rgb] = texel(gpu, out);
      expect(rgb, `texel +${out}: authored ${authored} collapses to a²/255`).toBe(
        Math.round((authored * authored) / 255),
      );
    }
    // …and that IS a collapse, not a rounding: at the design's own knee the
    // halo keeps under a third of the light it was authored with.
    const [rgb] = texel(gpu, 40);
    const [, authored] = texel(old.pixels, 40);
    expect(rgb / authored, 'the knee of the halo keeps under a third of its ink').toBeLessThan(0.35);
  });

  it('at the resolution the app bakes at', () => {
    // The app is not this runner: it bakes with `resolution: window.devicePixelRatio`
    // and it has fonts, atlases and a build badge on the page, so by the time the
    // sky is drawn the premultiply flag is whatever those left set. This asserts
    // the ramp is right under BOTH — which is the only way a page's texture
    // schedule can stop being able to change what a star looks like.
    for (const curve of ['smooth', 'halo'] as const) {
      const design = premultiplied(rampPixels(curve));
      // What a browser gets. `rampUploadPath()` is 'buffer' in this DOM-free
      // runner, so the browser's path is named explicitly rather than sampled.
      const upload = rampUpload(curve, 'image');

      for (const flagBefore of [false, true]) {
        const gpu = uploaded(upload, flagBefore);
        for (const out of [0, 10, 20, 40, 60, 80, 100, 120]) {
          const [wantRgb, wantA] = texel(design, out);
          const [gotRgb, gotA] = texel(gpu, out);
          expect(
            gotRgb,
            `${curve} texel +${out}, flag ${flagBefore} before the upload: ` +
              `rgb ${gotRgb} against the design's ${wantRgb}`,
          ).toBeCloseTo(wantRgb, -0.4);
          expect(gotA, `${curve} texel +${out}: alpha is untouched by the flag`).toBe(wantA);
        }
      }
    }
  });

  it('keeps the ramp on a source type whose uploader pins the flag', () => {
    // The assertion above is about bytes; this one is about the door they go
    // through, because straight-alpha bytes on the uploader that pins NOTHING
    // would be the same bug the other way round.
    expect(rampUpload('halo', 'image').alphaMode, 'a browser asks for the premultiply').toBe(
      'premultiply-alpha-on-upload',
    );
    expect(rampUploadPath(), 'a DOM-free runner has no canvas and no GPU').toBe('buffer');
    // …and the buffer fallback is still self-consistent: premultiplied texels
    // declared as premultiplied, which is the only correct pairing for an
    // uploader that pins nothing.
    const fallback = rampUpload('halo', 'buffer');
    expect(fallback.alphaMode).toBe('premultiplied-alpha');
    expect(Array.from(fallback.pixels.slice(0, 4))).toEqual(
      Array.from(premultiplied(rampPixels('halo')).slice(0, 4)),
    );
    // The texture this runner actually builds agrees with the descriptor, so the
    // two cannot drift apart unnoticed.
    expect((falloffRamp('halo').source as { alphaMode?: string }).alphaMode).toBe(fallback.alphaMode);
  });
});
