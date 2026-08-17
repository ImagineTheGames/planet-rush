/**
 * src/art/backdrop-fill.test.ts — **the per-frame fill budget, swept across
 * viewport sizes.** OWNER: Art Agent (a0-75).
 *
 * ## Why this file exists
 *
 * The developer reported a0-75 as *"for the host everything is super choppy"*,
 * and then bisected it without any instrument from us: they moved hosting to
 * their phone (still choppy on the PC), then dragged the window smaller (*"the
 * game plays much better"*). The studio's own performance gate could not have
 * found that, and it is worth being precise about why rather than filing it as
 * bad luck:
 *
 *  - `tests/harness/perf.test.ts` profiles the **sim**, which has no viewport;
 *  - `tests/perf/draw-budget.spec.ts` counts **draw calls and submitted
 *    entities**, which barely move with the viewport;
 *  - `tests/perf/frame-time.spec.ts` measures **one fixed viewport**, and gates
 *    only on hardware CI does not have.
 *
 * Every one of those is a real gate and none of them has an axis called *area*.
 * So the defect that was actually shipped — a per-pixel cost that is fine at
 * 1280×720 and four times worse at 3440×1440, and worse again at 32:9 — was
 * invisible to all three at once. This file is that missing axis, and it is a
 * unit test rather than a browser suite deliberately: **fragments are countable
 * without a GPU** (`./shapes` `shapeArea`), so the budget can be enforced on
 * every push instead of on a machine somebody has to own.
 *
 * ## What it asserts, and what it deliberately does not
 *
 * It asserts a **ceiling on `Σ overdraw`** — how many times the GPU blends each
 * screen pixel for the backdrop, per frame — and it asserts that the number is
 * **flat across aspect ratios**, which is the specific regression a0-75 found.
 * It does not assert milliseconds: a millisecond belongs to a browser with a GPU
 * (`tests/perf/frame-time.spec.ts`), and a millisecond measured in CI would be a
 * claim about SwiftShader wearing the costume of a claim about a phone.
 *
 * The ceilings are set from the measured post-fix numbers with headroom, in the
 * spirit of `harness/perf.ts`: to catch a **regression in kind** — a layer that
 * stops being cached, a feature size that goes back on the frame's width, a sky
 * that quietly doubles — and not to shave a percent.
 */

import { describe, expect, it } from 'vitest';
import {
  NEBULAE,
  NEBULA_IDS,
  STAR_LAYERS,
  VOID_SEED,
  coverSpan,
  nebulaSprite,
  skyCacheResolution,
  starFieldSprite,
  type NebulaId,
} from './backdrop';
import { spriteArea } from './shapes';
import { MOCKUP_PANEL, featureSpan } from './mockup-reference';

/** The wide arena (`src/sim/maps.ts` `WIDE`) — `oval` and `diamond`, and the
 *  bigger of the two boards, so the honest denominator. `backdrop.test.ts`
 *  already refuses to let art's copy of these drift from the sim's. */
const WIDE = { w: 3200, h: 2000 };

/**
 * **The sweep.** Six shapes, and every one of them is a real screen somebody
 * plays on: the landscape-locked phone, the desktop control profile
 * (`docs/perf-gate.md`), two 16:9 rungs, the developer's own 21:9 ultrawide, and
 * the 32:9 the brief asks the budget to be stated at.
 *
 * The point of a *sweep* rather than a profile is that a0-75's defect was
 * invisible at any single size — it is a slope, and one point has no slope.
 */
const VIEWPORTS = [
  { name: 'phone 798×384', w: 798, h: 384 },
  { name: 'desktop 1280×800', w: 1280, h: 800 },
  { name: '1920×1080', w: 1920, h: 1080 },
  { name: '2560×1440', w: 2560, h: 1440 },
  { name: 'ultrawide 3440×1440', w: 3440, h: 1440 },
  { name: '32:9 5120×1440', w: 5120, h: 1440 },
] as const;

/**
 * How many times each screen pixel is blended for one layer, per frame.
 *
 * The field's elements are uniform over the field, so the expected coverage of
 * any screen-sized window inside it is total-area ÷ field-area. That equality is
 * the whole reason a per-frame budget can be computed from geometry at all, and
 * it holds because the void is authored **per screenful** (`backdrop.ts`
 * `NebulaSpec.build`).
 */
function overdrawOf(area: number, fieldW: number, fieldH: number): number {
  return area / (fieldW * fieldH);
}

/** The sky's per-frame fill at a viewport — **as the frame pays it**, which
 *  since a0-75 is `1` when the layer is baked (`./backdrop` `skyCacheResolution`):
 *  one textured quad, whatever the geometry inside it was. */
function skyFill(id: NebulaId, w: number, h: number): { raw: number; paid: number; cached: boolean } {
  if (id === 'none') return { raw: 0, paid: 0, cached: false };
  const spec = NEBULAE[id];
  const fw = coverSpan(spec.parallax, w, WIDE.w);
  const fh = coverSpan(spec.parallax, h, WIDE.h);
  const raw = overdrawOf(spriteArea(nebulaSprite(id, VOID_SEED, fw, fh, 1, w, h)), fw, fh);
  const cached = skyCacheResolution(fw, fh) !== null;
  return { raw, paid: cached ? 1 : raw, cached };
}

/** The whole star field's per-frame fill at a viewport — every layer, points
 *  and bloom together. Never cached: a star is 0.4–2.45 px across and a
 *  resampled point is a different star. */
function starFill(w: number, h: number): number {
  let sum = 0;
  for (const spec of STAR_LAYERS) {
    const fw = coverSpan(spec.parallax, w, WIDE.w);
    const fh = coverSpan(spec.parallax, h, WIDE.h);
    sum += overdrawOf(spriteArea(starFieldSprite(spec, VOID_SEED, fw, fh)), fw, fh);
  }
  return sum;
}

/** The ground is one opaque quad: overdraw 1, and it is the only layer in the
 *  void that is not a blend. */
const GROUND_FILL = 1;

function backdropFill(id: NebulaId, w: number, h: number): number {
  return GROUND_FILL + skyFill(id, w, h).paid + starFill(w, h);
}

// ---------------------------------------------------------------------------
// The budget
// ---------------------------------------------------------------------------

/**
 * **The ceiling: 2.5 blended screenfuls of backdrop per frame, at every
 * viewport and on every map.**
 *
 * Where it comes from. After a0-75 the worst map measures `1.000` ground +
 * `1.000` baked sky + `0.331` stars = **2.331**, and that number is flat across
 * the whole sweep because every term in it is now scale- and aspect-invariant.
 * 2.5 is that with a little room, and it is set on the *shape* of the stack
 * rather than on a percentage: the ground is one opaque pass, the sky is one
 * textured pass, and the star field is a third of a pass. **Anything above ~2.4
 * means a layer stopped being a single pass**, which is a regression in kind and
 * exactly what this gate is for.
 *
 * For scale, what it was when the developer filed a0-75: **5.40** at 3440×1440
 * and **7.39** at 5120×1440 on `oval`, and **7.00** on `diamond`.
 */
const BACKDROP_FILL_CEILING = 2.5;

/**
 * **The sky's own ceiling, once baked.** A cached layer is one textured quad, so
 * anything above 1 means the cache did not engage — a silent, invisible, 3× fill
 * regression, which is the failure this whole brief is about. Slack of 1% for
 * the ground quad's own two-pixel overhang and nothing else.
 */
const SKY_FILL_CEILING = 1.01;

describe('the per-frame fill budget, across viewport sizes (a0-75)', () => {
  it('reports the table the audit quotes — every sky, every viewport', () => {
    const rows: string[] = [];
    rows.push(
      `${'viewport'.padEnd(20)}${'Mpx'.padStart(6)}  ` +
        NEBULA_IDS.map((id) => NEBULAE[id].name.slice(0, 6).padStart(7)).join(''),
    );
    for (const vp of VIEWPORTS) {
      rows.push(
        vp.name.padEnd(20) +
          ((vp.w * vp.h) / 1e6).toFixed(2).padStart(6) +
          '  ' +
          NEBULA_IDS.map((id) => backdropFill(id, vp.w, vp.h).toFixed(3).padStart(7)).join(''),
      );
    }
    // eslint-disable-next-line no-console
    console.log(`\nbackdrop fill, × per screen pixel per frame\n${rows.join('\n')}\n`);
    expect(rows).toHaveLength(VIEWPORTS.length + 1);
  });

  it('holds the budget on every map at every viewport, including 32:9', () => {
    for (const vp of VIEWPORTS) {
      for (const id of NEBULA_IDS) {
        const fill = backdropFill(id, vp.w, vp.h);
        expect(
          fill,
          `${NEBULAE[id].name} at ${vp.name} blends ${fill.toFixed(3)} screenfuls a frame`,
        ).toBeLessThanOrEqual(BACKDROP_FILL_CEILING);
      }
    }
  });

  /**
   * **The a0-75 regression itself.** Feature size used to be a fraction of the
   * frame's *width* while element count is per frame *area*, so a sky's coverage
   * was proportional to W/H and an ultrawide paid a third more than a 16:9 for
   * the same picture — a 32:9 paid double. `featureSpan` fixed it; this is the
   * assertion that it stays fixed, stated on the RAW geometry rather than on
   * what the frame pays, because the cache would otherwise hide it at 1.000
   * forever and the bake itself would silently get more expensive.
   */
  it('does not charge a wide screen more for the same sky — raw geometry, every aspect', () => {
    for (const id of NEBULA_IDS) {
      if (id === 'none') continue;
      const raw = VIEWPORTS.map((vp) => skyFill(id, vp.w, vp.h).raw);
      const lo = Math.min(...raw);
      const hi = Math.max(...raw);
      expect(
        hi / lo,
        `${NEBULAE[id].name} raw fill spans ${lo.toFixed(3)}–${hi.toFixed(3)} across the sweep`,
      ).toBeLessThan(1.15);
    }
  });

  it('is the identity on the design’s own 16:9 — no sky was re-art-directed', () => {
    // The claim the fix rests on: `featureSpan` returns exactly `screenW` at the
    // panel's aspect, so every number the design measured still means what it
    // measured. Asserted on the rule, not on a constant someone typed.
    for (const [w, h] of [
      [MOCKUP_PANEL.w, MOCKUP_PANEL.h],
      [1280, 720],
      [1920, 1080],
      [2560, 1440],
    ]) {
      expect(featureSpan(w!, h!)).toBeCloseTo(w!, 6);
    }
    // …and off it, it holds a blob's share of the frame constant: the span
    // squared is proportional to the frame's area at any shape.
    const share = (w: number, h: number): number => featureSpan(w, h) ** 2 / (w * h);
    expect(share(3440, 1440)).toBeCloseTo(share(1280, 720), 9);
    expect(share(5120, 1440)).toBeCloseTo(share(1280, 720), 9);
  });

  it('bakes every sky at every viewport — an uncached sky is a 3× fill regression', () => {
    for (const vp of VIEWPORTS) {
      for (const id of NEBULA_IDS) {
        if (id === 'none') continue;
        const sky = skyFill(id, vp.w, vp.h);
        expect(sky.cached, `${NEBULAE[id].name} at ${vp.name} did not fit the cache`).toBe(true);
        expect(sky.paid).toBeLessThanOrEqual(SKY_FILL_CEILING);
      }
    }
  });

  /**
   * The cache is a texture the size of the parallax field, and the memory it
   * costs is the price of the fill it saves. Stated as a test so the trade is a
   * number in CI rather than a sentence in a PR body — 8 MB at the developer's
   * ultrawide, and the phone the game has to run on pays under 2.
   */
  it('states what the cache costs in memory, and holds it at 8 MB everywhere', () => {
    const pow2 = (n: number): number => 2 ** Math.ceil(Math.log2(Math.max(1, n)));
    const rows: string[] = [];
    let worst = 0;
    for (const vp of VIEWPORTS) {
      for (const id of NEBULA_IDS) {
        if (id === 'none') continue;
        const spec = NEBULAE[id];
        const fw = coverSpan(spec.parallax, vp.w, WIDE.w);
        const fh = coverSpan(spec.parallax, vp.h, WIDE.h);
        const res = skyCacheResolution(fw, fh);
        expect(res, `${NEBULAE[id].name} at ${vp.name}`).not.toBeNull();
        const bytes = pow2(Math.ceil(fw * res!)) * pow2(Math.ceil(fh * res!)) * 4;
        worst = Math.max(worst, bytes);
        if (id === 'plasmaReef') {
          rows.push(
            `  ${vp.name.padEnd(20)} ${(bytes / 1024 / 1024).toFixed(1).padStart(5)} MB  at 1/${(1 / res!).toFixed(1)}`,
          );
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`\nsky cache texture, Plasma Reef over the wide arena\n${rows.join('\n')}\n`);
    expect(worst / 1024 / 1024).toBeLessThanOrEqual(8);
  });
});
