/**
 * evidence/a0-45-star-temperature-colour/blue-probe/probe.spec.ts — what are
 * the 79 pixels? OWNER: Art Agent.
 *
 * CI shard 2/6 fails a0-23's negative assertion on PR #424:
 *
 *   the stick zone no longer wears plasma (a0-23)
 *   expect(received).toBeLessThan(expected)   Expected: < 40   Received: 79
 *
 * `isBlueGlow` is `b - r > 20 && g - r > 8 && b > 38` (tests/mobile/pixels.ts).
 * a0-45 paints 78% of stars on the design's hot branch — rgb(160,205,255) at
 * t=1 down to rgb(178,209,233) at t=0.55, a `b - r` of 95 down to 54 — so the
 * hypothesis is that the pixels the assertion is now counting are STARS seen
 * through the stick ring's own arc, not a plasma ring that came back.
 *
 * This probe does not assert. It reproduces the failing test's exact sample —
 * same boot, same screenshot, same `affordanceArcRegion('touch-left-stick')` —
 * and prints every matching pixel's colour, so the hypothesis is settled by
 * reading the pixels rather than by reasoning about them. Run it against this
 * branch and against a `main` worktree; the difference is the answer.
 *
 * ```sh
 * PREVIEW_PORT=4246 npx playwright test \
 *   --config evidence/a0-45-star-temperature-colour/blue-probe/playwright.config.ts
 * ```
 */
import { test, type Page } from '@playwright/test';
import { decode, isBlueGlow, isBoneGhost, isPlasma, type Img, type Region } from '../../../tests/mobile/pixels';

/** The failing test's own arc, read from the app's layout registry. */
async function arcRegion(page: Page, wanted: string): Promise<Region | null> {
  return page.evaluate((id) => {
    const pr = (
      window as unknown as {
        __planetRush?: {
          viewport: { w: number; h: number };
          layout: { id: string; bounds: { x: number; y: number; width: number; height: number } }[];
        };
      }
    ).__planetRush;
    const e = pr?.layout.find((x) => x.id === id);
    if (!pr || !e || !(pr.viewport.w > 0) || !(pr.viewport.h > 0)) return null;
    const { x, y, width, height } = e.bounds;
    void height;
    return {
      x0: (x + width * 0.35) / pr.viewport.w,
      y0: (y - 4) / pr.viewport.h,
      x1: (x + width * 0.65) / pr.viewport.w,
      y1: (y + 6) / pr.viewport.h,
    };
  }, wanted);
}

/** Every matching pixel in the region, with its coordinates and colour. */
function matches(img: Img, r: Region): { x: number; y: number; rgb: [number, number, number] }[] {
  const px0 = Math.max(0, Math.floor(r.x0 * img.width));
  const py0 = Math.max(0, Math.floor(r.y0 * img.height));
  const px1 = Math.min(img.width, Math.ceil(r.x1 * img.width));
  const py1 = Math.min(img.height, Math.ceil(r.y1 * img.height));
  const out: { x: number; y: number; rgb: [number, number, number] }[] = [];
  for (let y = py0; y < py1; y++) {
    for (let x = px0; x < px1; x++) {
      const i = (y * img.width + x) * 4;
      const [cr, cg, cb, ca] = [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
      if (isBlueGlow(cr, cg, cb, ca)) out.push({ x, y, rgb: [cr, cg, cb] });
    }
  }
  return out;
}

test('what is blue in the left stick arc', async ({ page }) => {
  test.setTimeout(120_000);
  const vp = page.viewportSize();
  if (vp && vp.height > vp.width) await page.setViewportSize({ width: vp.height, height: vp.width });
  await page.goto('/?debug=1');
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForTimeout(4000);

  const img = decode(await page.screenshot());
  const arc = await arcRegion(page, 'touch-left-stick');
  if (!arc) throw new Error('touch-left-stick is not registered');

  const hits = matches(img, arc);
  const px0 = Math.floor(arc.x0 * img.width);
  const py0 = Math.floor(arc.y0 * img.height);
  const px1 = Math.ceil(arc.x1 * img.width);
  const py1 = Math.ceil(arc.y1 * img.height);

  console.log(`ARC device px: x ${px0}..${px1}  y ${py0}..${py1}  (${px1 - px0}×${py1 - py0})`);
  console.log(`isBlueGlow matched: ${hits.length}`);
  console.log(`isPlasma matched:   ${hits.filter((h) => isPlasma(...h.rgb, 255)).length}`);

  // Group identical colours — a ring is one stroke colour over a gradient; a
  // star field is a scatter of unrelated ones.
  const byColor = new Map<string, number>();
  for (const h of hits) {
    const k = `${h.rgb[0]},${h.rgb[1]},${h.rgb[2]}`;
    byColor.set(k, (byColor.get(k) ?? 0) + 1);
  }
  console.log(`distinct colours: ${byColor.size}`);
  for (const [k, n] of [...byColor.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    const [r, g, b] = k.split(',').map(Number);
    console.log(`  ${k.padEnd(14)} ×${String(n).padStart(3)}   b-r ${b - r}  g-r ${g - r}`);
  }

  // Where are they? Stars are point-like clusters; a ring stroke is a band that
  // runs the full width of the arc at a fixed y.
  const byRow = new Map<number, number>();
  for (const h of hits) byRow.set(h.y, (byRow.get(h.y) ?? 0) + 1);
  console.log('rows (y → count):');
  for (const [y, n] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  y=${y}  ×${n}`);
  }
  const xs = hits.map((h) => h.x);
  console.log(`x span of hits: ${Math.min(...xs)}..${Math.max(...xs)} of arc ${px0}..${px1}`);

  // --- The discriminator ---------------------------------------------------
  // A RING is a stroke that crosses the arc: it lights (nearly) every column of
  // the band. A STAR is a point: it lights a handful. Measure the Bone ring's
  // own column coverage in the same band — it is drawn in exactly the geometry
  // the plasma ring had, so it is the honest proxy for "what would a returned
  // plasma ring cover here".
  const columns = (pred: (r: number, g: number, b: number, a: number) => boolean): number => {
    let n = 0;
    for (let x = px0; x < px1; x++) {
      for (let y = py0; y < py1; y++) {
        const i = (y * img.width + x) * 4;
        if (pred(img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3])) {
          n++;
          break;
        }
      }
    }
    return n;
  };
  const width = px1 - px0;
  const pct = (n: number): string => `${n}/${width} = ${((100 * n) / width).toFixed(0)}%`;
  console.log(`COLUMN COVERAGE across the arc band (width ${width}):`);
  console.log(`  isBlueGlow  ${pct(columns(isBlueGlow))}`);
  console.log(`  isPlasma    ${pct(columns(isPlasma))}`);
  console.log(`  isBoneGhost ${pct(columns(isBoneGhost))}   <- what a ring covers`);

  // The SECOND broken assertion. CI never reached it — the arc failed first and
  // masked it — but the sky lights this band too. What is in it, and how bright?
  report(img, { x0: 0.46, y0: 0.95, x1: 0.68, y1: 1.0 }, 'TOUCH REGION_STRIP_MID (sky only — no strip is drawn)');

  console.log(`TOUCH registered layout ids: ${JSON.stringify(await ids(page))}`);
});

/** Every element id the layout registry publishes this frame. */
async function ids(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const pr = (window as unknown as { __planetRush?: { layout: { id: string }[] } }).__planetRush;
    return pr ? pr.layout.map((e) => e.id) : [];
  });
}

/** Colour distribution of `isBlueGlow` matches in a band: how blue, how bright. */
function report(img: Img, band: Region, label: string): void {
  const px0 = Math.max(0, Math.floor(band.x0 * img.width));
  const px1 = Math.min(img.width, Math.ceil(band.x1 * img.width));
  const py0 = Math.max(0, Math.floor(band.y0 * img.height));
  const py1 = Math.min(img.height, Math.ceil(band.y1 * img.height));
  const hits: [number, number, number][] = [];
  for (let y = py0; y < py1; y++) {
    for (let x = px0; x < px1; x++) {
      const i = (y * img.width + x) * 4;
      const [r, g, b, a] = [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
      if (isBlueGlow(r, g, b, a)) hits.push([r, g, b]);
    }
  }
  console.log(`${label}  (band ${px1 - px0}×${py1 - py0})`);
  console.log(`  isBlueGlow pixels: ${hits.length}`);
  console.log(`  isPlasma   pixels: ${hits.filter(([r, g, b]) => isPlasma(r, g, b, 255)).length}`);
  if (!hits.length) return;
  const bs = hits.map((h) => h[2]).sort((x, y) => x - y);
  const brs = hits.map((h) => h[2] - h[0]).sort((x, y) => x - y);
  const q = (a: number[], p: number): number => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  console.log(`  b   min ${bs[0]}  p50 ${q(bs, 0.5)}  p90 ${q(bs, 0.9)}  p99 ${q(bs, 0.99)}  max ${bs[bs.length - 1]}`);
  console.log(
    `  b-r min ${brs[0]}  p50 ${q(brs, 0.5)}  p90 ${q(brs, 0.9)}  p99 ${q(brs, 0.99)}  max ${brs[brs.length - 1]}`,
  );
}

/**
 * The negative control the gate is worth nothing without: **a real plasma stroke
 * through a real band**, measured rather than inferred.
 *
 * The touch stick ring is Bone since a0-23, so the arc probe above can only show
 * what a ring's *geometry* covers, not what a plasma one would score. The desktop
 * controls strip is the plasma stroke that still ships (GDD §2.2) — same kind of
 * object, same kind of band. If `isBlueGlow` column coverage over it reads ~100%,
 * then `STROKE_COLUMN_RATIO = 0.5` is a bar a returned plasma affordance fails,
 * and the converted assertions can still go red for the reason they name.
 */
test.describe('desktop control', () => {
  test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false });

  test('what a real plasma stroke covers', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/?debug=1');
    await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
    await page.waitForTimeout(4000);
    const img = decode(await page.screenshot());

    // Both bands the touch test asserts over. STRIP_MID is the one that matters:
    // on desktop the strip IS drawn there, so this is literally "what a leaked
    // controls strip scores in the band the touch assertion watches".
    const BANDS: Record<string, Region> = {
      REGION_STRIP_LEFT: { x0: 0.015, y0: 0.95, x1: 0.32, y1: 1.0 },
      REGION_STRIP_MID: { x0: 0.46, y0: 0.95, x1: 0.68, y1: 1.0 },
    };

    console.log('DESKTOP — what a REAL plasma stroke scores (the negative control):');
    for (const [label, band] of Object.entries(BANDS)) report(img, band, `  ${label} — REAL STRIP`);
    console.log(`DESKTOP registered layout ids: ${JSON.stringify(await ids(page))}`);
    for (const [label, band] of Object.entries(BANDS)) {
      const px0 = Math.floor(band.x0 * img.width);
      const px1 = Math.ceil(band.x1 * img.width);
      const py0 = Math.floor(band.y0 * img.height);
      const py1 = Math.ceil(band.y1 * img.height);

      let cols = 0;
      let px = 0;
      let minX = Infinity;
      let maxX = -Infinity;
      for (let x = px0; x < px1; x++) {
        let hit = false;
        for (let y = py0; y < py1; y++) {
          const i = (y * img.width + x) * 4;
          if (isBlueGlow(img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3])) {
            px++;
            hit = true;
          }
        }
        if (hit) {
          cols++;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
        }
      }
      const w = px1 - px0;
      const span = maxX >= minX ? maxX - minX + 1 : 0;
      console.log(`  ${label} (width ${w}):`);
      console.log(`    pixels  ${px}`);
      console.log(`    columns ${cols}/${w} = ${((100 * cols) / w).toFixed(0)}%`);
      console.log(`    x-span  ${span}/${w} = ${((100 * span) / w).toFixed(0)}%`);
    }
  });
});
