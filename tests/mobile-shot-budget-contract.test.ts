/**
 * tests/mobile-shot-budget-contract.test.ts — the golden-comparison budget rule,
 * made mechanical. OWNER: QA Agent.
 *
 * The sibling of tests/mobile-budget-contract.test.ts, one level down. That file
 * keeps a TEST from riding the suite's flat default; this one keeps a GOLDEN
 * COMPARISON from riding `toHaveScreenshot`'s own 5 s default — which is not
 * enough to capture a dpr-3 phone frame twice on a loaded runner, and is how PR
 * #291's two `iphone` goldens went red against baselines that were correct
 * (q8-01).
 *
 * Like its sibling it is a source-level contract run by `npm test` (vitest), so
 * it costs no browser time and fails on the cheapest job in CI. It lives OUTSIDE
 * tests/mobile/ because Playwright's `testMatch` would otherwise collect it.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CI_SLOW_FACTOR } from './mobile/budget-model';
import {
  captureMsFor,
  DEVICE_MATRIX,
  GOLDEN_CI_RETRIES,
  goldenRetriesFor,
  GOLDEN_SHOT_TIMEOUT_MS,
  megapixelsOf,
  SHOT_FLOOR_MS,
  SHOT_ROUND_TO_MS,
  shotBudgetMsFor,
  STABILISATION_CAPTURES,
} from './mobile/shot-budget';

const CONFIG = fileURLToPath(new URL('../playwright.config.ts', import.meta.url));
const MOBILE_DIR = fileURLToPath(new URL('./mobile', import.meta.url));
const GOLDENS = join(MOBILE_DIR, 'goldens.spec.ts');

const { iphone: IPHONE, pixel: PIXEL, desktop: DESKTOP } = DEVICE_MATRIX;

/** Source with comments stripped — these files document themselves heavily and
 *  legitimately quote the patterns the rules below ban. */
const readCode = (path: string): string =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');

describe('golden-comparison budget', () => {
  it('states the matrix the config emulates — one source, no drift', () => {
    // playwright.config.ts's header documents these numbers in prose; the
    // projects take them from here. If a device profile moves, its screenshot
    // budget moves with it.
    expect(IPHONE).toEqual({ width: 390, height: 844, deviceScaleFactor: 3 });
    expect(PIXEL).toEqual({ width: 412, height: 915, deviceScaleFactor: 2.6 });
    expect(DESKTOP).toEqual({ width: 1280, height: 800, deviceScaleFactor: 1 });

    const config = readCode(CONFIG);
    expect(config).toContain('DEVICE_MATRIX');
    // No project may restate a viewport by hand.
    expect(config.match(/viewport:\s*\{\s*width:\s*\d/g)).toBeNull();
  });

  it('counts the pixels a capture actually rasterises — dpr squares the area', () => {
    // 1280×800 at dpr 1 is the control; 390×844 at dpr 3 is ~2.9× its area
    // (~9× the *desktop-equivalent* work per CSS pixel), which is the whole
    // reason one flat assertion default could not serve both.
    expect(megapixelsOf(DESKTOP)).toBeCloseTo(1.024, 3);
    expect(megapixelsOf(IPHONE)).toBeCloseTo(2.962, 3);
    expect(megapixelsOf(IPHONE) / megapixelsOf(DESKTOP)).toBeGreaterThan(2.8);
  });

  it('models the measured per-capture cost (studio container, hardware GL)', () => {
    // Measured at `scale: 'css'` (what toHaveScreenshot uses): ~0.96 s desktop,
    // ~1.57 s pixel, ~1.81 s iphone. The fit is allowed to be generous, never
    // optimistic — an underestimate here is the failure this file exists to
    // prevent, so every projection must sit at or above what was measured.
    expect(captureMsFor(megapixelsOf(DESKTOP))).toBeGreaterThanOrEqual(960);
    expect(captureMsFor(megapixelsOf(PIXEL))).toBeGreaterThanOrEqual(1_570);
    expect(captureMsFor(megapixelsOf(IPHONE))).toBeGreaterThanOrEqual(1_810);
  });

  it('budgets every frame in the matrix above the default it used to ride', () => {
    for (const frame of Object.values(DEVICE_MATRIX)) {
      expect(shotBudgetMsFor(frame)).toBeGreaterThanOrEqual(SHOT_FLOOR_MS);
      expect(shotBudgetMsFor(frame) % SHOT_ROUND_TO_MS).toBe(0);
    }
    expect(shotBudgetMsFor(DESKTOP)).toBe(30_000);
    expect(shotBudgetMsFor(PIXEL)).toBe(45_000);
    expect(shotBudgetMsFor(IPHONE)).toBe(45_000);
  });

  it('is proportional: the 3× frame is budgeted above the 1× one', () => {
    expect(shotBudgetMsFor(IPHONE)).toBeGreaterThan(shotBudgetMsFor(DESKTOP));
  });

  it('ships the MAXIMUM over the matrix, so no frame is under-budgeted', () => {
    // One number because Playwright 1.49.1 has no project-level screenshot
    // timeout (see shot-budget.ts). Sizing at the max is the safe direction: it
    // over-budgets the desktop control and under-budgets nothing.
    const every = Object.values(DEVICE_MATRIX).map((f) => shotBudgetMsFor(f));
    expect(GOLDEN_SHOT_TIMEOUT_MS).toBe(Math.max(...every));
    expect(GOLDEN_SHOT_TIMEOUT_MS).toBe(45_000);
  });

  it('pays for the stabilisation PAIR, at the suite-wide software-GL allowance', () => {
    // Playwright will not diff a frame it has not captured twice identically, so
    // two captures is the floor on a PASSING golden — and a budget that cannot
    // fit the floor reports a timeout instead of a diff.
    expect(STABILISATION_CAPTURES).toBe(2);
    const pairMs = captureMsFor(megapixelsOf(IPHONE)) * STABILISATION_CAPTURES;
    expect(GOLDEN_SHOT_TIMEOUT_MS).toBeGreaterThanOrEqual(pairMs * CI_SLOW_FACTOR);
    // …and that pair does NOT fit Playwright's own 5 s default at the suite's
    // software-GL allowance. This is the regression, stated as arithmetic.
    expect(pairMs * CI_SLOW_FACTOR).toBeGreaterThan(5_000);
  });

  it('every golden takes the model number, and none writes its own', () => {
    const source = readCode(GOLDENS);

    // The shared options object carries the budget by NAME, never as a literal.
    expect(source).toMatch(/const GOLDEN = \{[^}]*timeout: GOLDEN_SHOT_TIMEOUT_MS/);
    expect(/const\s+(GOLDEN|MENU_GOLDEN)\b[^;]*timeout:\s*\d/.test(source)).toBe(false);

    // And no call site overrides it inline. The failure mode this bans is the one
    // that was already here: `MENU_GOLDEN = { ...GOLDEN, timeout: 30_000 }` fixed
    // one spec's goldens, the next goldens written did not get it, and the suite
    // was back to two rules — which is the state PR #291 hit.
    const inlineOverrides = [...source.matchAll(/toHaveScreenshot\([^)]*timeout/g)].map((m) => m[0]);
    expect(
      inlineOverrides,
      'A screenshot timeout written into a call says nothing about the frame it shoots.\n' +
        'Pass GOLDEN / MENU_GOLDEN instead (tests/mobile/shot-budget.ts).',
    ).toEqual([]);

    // The boot fixtures' own `waitForSelector` / `waitForFunction` caps are a
    // different instrument — they bound a WEDGE and name what never arrived — so
    // the rule above leaves them alone, and they must still be there.
    expect([...source.matchAll(/timeout:\s*[\d_]+/g)].length).toBeGreaterThan(0);
  });

  // ── The extra retry, and the scope that makes it safe (q9-01) ─────────────
  //
  // A 31× runner took the phone BUILD WHEEL golden past its 90 s budget AND past
  // its single retry, reddening `main` on a correct baseline. The goldens now get
  // one more attempt on CI. The whole safety argument is the SCOPE — goldens
  // only, because only they assert on a deterministic frozen frame — so the scope
  // is pinned here rather than left to a code comment.

  it('gives the goldens one extra CI attempt, and nothing locally', () => {
    // Three attempts on CI, against the suite-wide two.
    expect(GOLDEN_CI_RETRIES).toBe(2);
    expect(goldenRetriesFor(true)).toBe(GOLDEN_CI_RETRIES);
    // Locally, zero: a golden that fails on this hardware is telling you
    // something, and re-running it twice more costs a minute to hear it again.
    expect(goldenRetriesFor(false)).toBe(0);
  });

  it('applies it by NAME, at goldens.spec.ts file scope', () => {
    const source = readCode(GOLDENS);
    // File scope, so every golden in the file is covered and none is singled out
    // — and by name, so the number stays reviewable in one place.
    expect(source).toMatch(/test\.describe\.configure\(\s*\{\s*retries:\s*GOLDEN_RETRIES\s*\}\s*\)/);
    expect(/describe\.configure\(\s*\{\s*retries:\s*\d/.test(source)).toBe(false);
  });

  it('leaves the suite-wide retry at 1 — the extra attempt is NOT global', () => {
    // This is the claim a reviewer has to be able to check: every behavioural
    // spec in tests/mobile/ still gets exactly two attempts. A second re-run
    // there could paper over a genuine intermittent bug in the product, because
    // those tests assert on behaviour rather than on a frozen frame.
    const config = readCode(CONFIG);
    expect(config).toMatch(/retries:\s*process\.env\.CI\s*\?\s*1\s*:\s*0/);
    // …and no project block quietly reintroduces it as a per-device retry.
    expect(config.match(/projects:[\s\S]*\bretries\s*:/)).toBeNull();
  });

  it('no OTHER spec in tests/mobile configures retries', () => {
    const offenders = readdirSync(MOBILE_DIR)
      .filter((f) => f.endsWith('.spec.ts') && f !== 'goldens.spec.ts')
      .filter((f) => /describe\.configure\([^)]*retries/.test(readCode(join(MOBILE_DIR, f))));
    expect(
      offenders,
      'Only the goldens may take an extra attempt: their assertion is a pure function of a\n' +
        'frozen world, so a re-run cannot turn a real mismatch green. A behavioural spec has no\n' +
        'such guarantee — fix the flake instead (tests/mobile/shot-budget.ts GOLDEN_CI_RETRIES).\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });

  it('no golden waits on a flat stopwatch for the frame to be drawn', () => {
    // The other half of q8-01: `waitForTimeout(500)` is ~30 frames here and can
    // be none at all on a loaded runner, so the frame gets shot before the
    // renderer has drawn the staged state. Wait on frames instead
    // (tests/mobile/render-settle.ts).
    const source = readCode(GOLDENS);
    expect(source).toContain('settleFrames(page)');
    const stopwatches = [...source.matchAll(/waitForTimeout\(\s*\d+/g)].map((m) => m[0]);
    expect(
      stopwatches,
      'A millisecond wait proves less on the machine that gates merges than it does here.\n' +
        'Use settleFrames(page) — it waits for drawn frames and fails fast if drawing stops.\n' +
        stopwatches.join('\n'),
    ).toEqual([]);
  });
});
