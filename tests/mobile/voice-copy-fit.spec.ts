/**
 * tests/mobile/voice-copy-fit.spec.ts — the industrial voice, measured. OWNER: UI Engineer.
 *
 * GDD §4.7 makes length part of the clarity rule, not a separate layout concern:
 *
 *   > **Length is part of clarity.** The HUD runs at 11–15px and nameplates
 *   > truncate at 12 characters. A longer in-register word that ellipsizes has
 *   > traded information for flavour, which this rule forbids. Measure before
 *   > you ship it.
 *
 * l2-02 made eight labels longer — `ORE ·` → `YIELD ·`, `VICTORY` (7) →
 * `CLAIM HELD` (10), `WAITING FOR THE HOST` (20) → `WAITING FOR THE CLAIM
 * HOLDER` (28), and the four entry doors into phrases — and this project has
 * shipped text that fit on desktop and overflowed on a phone. So the measurement
 * is a test, not a screenshot somebody once looked at.
 *
 * a0-15 sent the entry doors back to plain words (`SOLO` / `HOST` / `JOIN`) on
 * the developer's ratification, which only ever makes them fit more easily — but
 * "shorter, so it must fit" is the assumption this file exists to refuse, and the
 * hints under them are NEW copy at the tightest measurement in the sweep. Both
 * halves are measured below, and the headroom is printed on pass.
 *
 * ── WHY THIS CAN'T BE A UNIT TEST ──────────────────────────────────────────
 * Text width is a font fact, and the fonts are the browser's. `makeText` hands a
 * family stack and a pixel size to Pixi, which measures with the same engine this
 * spec's `measureText` uses — so measuring in the real booted page is measuring
 * what is actually drawn. A jsdom unit test would have to invent advance widths.
 *
 * ── WHAT IT ASSERTS, AND WHAT IT DELIBERATELY DOESN'T ──────────────────────
 * It asserts **the words fit the box**. It does not assert where the box is or
 * how wide it is — `lobby-geometry.test.ts` and `src/ui/*.test.ts` own that, and
 * duplicating it here would give two files a reason to disagree. The rect widths
 * below are therefore quoted constants with their derivation named, re-derivable
 * by calling the layout function at that viewport.
 *
 * None of these rects has a shrink-to-fit or an ellipsis: `drawDoor`,
 * `drawToggle` and the end-screen headline all centre the text and let it spill.
 * Overflow here is silent, which is exactly why it needs an assertion.
 *
 * ── THE CAVEAT THE NUMBERS USED TO DEPEND ON, NOW SPENT (u14-01) ───────────
 * This block used to warn that `src/ui/typography.ts` named Audiowide/Oxanium
 * and the page did not load them — no `@font-face`, no font file in the repo, so
 * every string here was really measured in the fallback. It said that if the real
 * faces were ever added this spec would re-measure against them and fail if a
 * label stopped fitting, and that "Audiowide is materially wider than Trebuchet,
 * so that is a real possibility."
 *
 * **They were added, on 2026-08-11, and it was a real possibility.** Audiowide
 * measures ~14% wider than Trebuchet at the same size (`CLAIM HELD` at 16px:
 * 112.0px against 98.2px), which is a whole extra character on a headline. Every
 * label below was re-measured against the self-hosted faces and every one still
 * fits; the tightest is 36% headroom. The mechanism the caveat described is why
 * that is known rather than assumed — this spec measures the FULL declared stack,
 * so it measures whatever the page actually resolves, and the page now resolves
 * the ratified faces because `index.html` blocks boot until they have loaded.
 * The headroom column is still printed on pass, because the next copy change is
 * the one that spends it.
 *
 * ── WHY THE STACKS ARE IMPORTED AND NOT RETYPED (r6-01) ────────────────────
 * This file shipped with its own copy of the two stacks, and the body one said
 * `"DejaVu Sans Mono"` — the value a1-01 had already retired on `main` for the
 * exact reason that bit here. DejaVu is on the GitHub runner and NOT in the
 * studio container, so the two machines measured two different faces:
 *
 *   container  fell through to generic `monospace` -> WenQuanYi Zen Hei Mono,
 *              5.500px/char at 11px  -> the solo hint measured 385/420, "8%
 *              headroom", GREEN
 *   CI runner  matched DejaVu Sans Mono, 6.626px/char -> 464/420, OVER, RED
 *
 * So this spec passed locally and failed on CI for 43 hours while reporting a
 * confident headroom column, and the copy it was guarding really was too long.
 * The real stack names **Liberation Mono**, which Playwright installs as a hard
 * dependency of its chromium on every Linux it supports and which the container
 * ships too — 6.601px/char, within 0.4% of the runner's DejaVu. Importing it is
 * what makes a measurement taken here mean the same thing there.
 */
import { test, expect, type Page } from '@playwright/test';
import { budgetTest } from './budgets';
// IMPORTED, never re-typed. This file used to carry its own copy of the two
// stacks, and the copy went stale the moment a1-01 changed the real one — see
// the note above. `src/ui/typography.ts` is pure data (no Pixi, no DOM), so a
// spec can read it directly, and now a face swap is one line in one place.
import { FONT_BODY, FONT_HEADING } from '../../src/ui/typography';
// a0-32: the committed per-glyph table, and the arithmetic built on it. This spec
// is what stops it rotting into a note — see `the glyph table still measures what
// it says it measures` below.
import { ADVANCE_EM, LINE_HEIGHT_EM } from '../../src/ui/font-metrics.data';
import { textWidth } from '../../src/ui/font-metrics';
import type { MetricFace } from '../../src/ui/font-metrics';

/**
 * One measured claim: a string, the face and size it is drawn at, and the box it
 * has to fit inside. `where` names the source line so a failure points at the
 * label rather than at this file.
 */
interface FitCase {
  readonly where: string;
  readonly text: string;
  readonly font: string;
  readonly size: number;
  readonly box: number;
}

/**
 * Fixed-width chrome only — buttons, chips and the headline band. These are the
 * rects that do NOT grow with the viewport, so they are the ones a longer word
 * can break. Free-flowing copy (hints, refusals, the HUD's own labels) is bounded
 * by the content box, which is 812px at the narrowest supported logical viewport,
 * and is covered by the screenshots below instead.
 *
 * Box widths, and where each comes from:
 *   420 — `entryLayout(vp).doors[i].width`, constant across all three viewports
 *         (the door column is capped, not proportional).
 *   200 — `lobbyLayout(vp).abundance.width` / `.modeToggle.width`, likewise fixed.
 *   812 — `endOfMatchLayout({844×390}).headline.width`: the NARROWEST case, the
 *         phone held in portrait. Mobile is landscape-locked, so a 390×844 phone
 *         presents a 844×390 LOGICAL viewport — width is the plentiful axis there
 *         and height is the scarce one, which is why the tight number is 812 and
 *         not 358.
 */
const CASES: readonly FitCase[] = [
  // --- The four doors (lobby-entry.ts DOOR_OPTIONS, drawn at 16px heading) ----
  // Plain by ratification (a0-15) and the shortest labels on the screen — kept
  // measured anyway, because CAMPAIGN is now the long one and a future door word
  // arrives here first.
  { where: 'DOOR_OPTIONS.campaign', text: 'CAMPAIGN', font: FONT_HEADING, size: 16, box: 420 },
  { where: 'DOOR_OPTIONS.solo', text: 'SOLO', font: FONT_HEADING, size: 16, box: 420 },
  { where: 'DOOR_OPTIONS.create', text: 'HOST', font: FONT_HEADING, size: 16, box: 420 },
  { where: 'DOOR_OPTIONS.join', text: 'JOIN', font: FONT_HEADING, size: 16, box: 420 },

  // --- The lobby toggle chips (lobby-view.ts drawControls, 12px heading) ------
  // Every value of each toggle, because the chip is sized for the longest one and
  // only the longest one can break it. `YIELD · STANDARD` is the new worst case.
  { where: 'lobby YIELD chip', text: 'YIELD · STANDARD', font: FONT_HEADING, size: 12, box: 200 },
  { where: 'lobby YIELD chip', text: 'YIELD · SCARCE', font: FONT_HEADING, size: 12, box: 200 },
  { where: 'lobby YIELD chip', text: 'YIELD · RICH', font: FONT_HEADING, size: 12, box: 200 },
  { where: 'lobby MODE chip', text: 'MODE · TEAMS', font: FONT_HEADING, size: 12, box: 200 },

  // --- The end-screen headlines (end-of-match.ts HEADLINES, 48px heading) -----
  // The largest text in the game, in the narrowest band it is ever drawn in.
  { where: 'HEADLINES.victory', text: 'CLAIM HELD', font: FONT_HEADING, size: 48, box: 812 },
  { where: 'HEADLINES.defeat', text: 'CLAIM LOST', font: FONT_HEADING, size: 48, box: 812 },
  { where: 'HEADLINES.draw', text: 'NO CLAIMANT', font: FONT_HEADING, size: 48, box: 812 },
  { where: 'HEADLINES.eliminated', text: 'ELIMINATED', font: FONT_HEADING, size: 48, box: 812 },

  // --- The guest's rush hint (lobby-view.ts, 11px body) ----------------------
  // Bounded by the lobby content box (812 at the narrowest logical viewport), not
  // by the 280px RUSH! button it is centred under — it is a free Text below the
  // button, not clipped to it.
  {
    where: 'lobby rushHint (guest)',
    text: 'WAITING FOR THE CLAIM HOLDER',
    font: FONT_BODY,
    size: 11,
    box: 812,
  },
  // …and the HOST's refusals (a0-11; `src/ui/lobby` NEEDS_TWO / NEEDS_TWO_SIDES).
  // These share the strip with the head-count tally, and the strip is the first
  // thing the narrowest footer gives up — a refusal that does not fit is not
  // drawn at all (`lobby-view.ts`: `visible = … rushHint.width >= text width`),
  // which is the dead button it was written to replace.
  { where: 'lobby rushHint (needs 2)', text: 'NEEDS 2 — ADD A BOT OR WAIT', font: FONT_BODY, size: 11, box: 812 },
  { where: 'lobby rushHint (needs 2 sides)', text: 'NEEDS 2 SIDES', font: FONT_BODY, size: 11, box: 812 },

  // --- The entry screen's refusals (lobby-entry-view.ts, 12px body) ----------
  // The longest of the four, which is the one that decides the set.
  {
    where: 'ENTRY_ERRORS.full',
    text: 'That claim is full. Ask for a rematch, or press SOLO.',
    font: FONT_BODY,
    size: 12,
    box: 812,
  },
  // ALL FOUR hints, bounded by the DOOR (420) rather than by the content box: a
  // hint is centred under its button and reads as part of it, so the button's
  // width is the honest container even though nothing clips at it.
  //
  // This is the tightest group in the sweep and the only copy in the game that
  // has actually overflowed: the sweep's solo hint drew 462px into a 420px door
  // at 70 chars, silently, because `drawDoor` centres and lets text spill. The
  // budget is 63 characters at 11px — Liberation Mono is 0.6em, so
  // 420 / 6.601 = 63.6. a0-15 rewrote three of the four in plain words and they
  // are all well inside it; measured rather than assumed, which is the point.
  {
    where: 'DOOR_OPTIONS.campaign hint',
    text: 'A run of linked contracts, one claim after another.',
    font: FONT_BODY,
    size: 11,
    box: 420,
  },
  {
    where: 'DOOR_OPTIONS.solo hint',
    text: 'Play on your own against bots. No internet needed.',
    font: FONT_BODY,
    size: 11,
    box: 420,
  },
  {
    where: 'DOOR_OPTIONS.create hint',
    text: 'Start a new game and get a code for friends to join.',
    font: FONT_BODY,
    size: 11,
    box: 420,
  },
  {
    where: 'DOOR_OPTIONS.join hint',
    text: 'Type in a friend’s code to join their game.',
    font: FONT_BODY,
    size: 11,
    box: 420,
  },
];

/**
 * Measure every case in the booted page, after fonts have settled. Returns the
 * drawn width alongside its box so a failure can report headroom rather than a
 * bare boolean.
 */
async function measure(page: Page): Promise<Array<FitCase & { drawn: number }>> {
  return page.evaluate((cases: readonly FitCase[]) => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    return cases.map((c) => {
      ctx.font = `${c.size}px ${c.font}`;
      return { ...c, drawn: ctx.measureText(c.text).width };
    });
  }, CASES);
}

/** Boot the clean (non-debug) build and wait for the menu and the fonts.
 *
 *  `?gate=0` because this walks through the front door on its way somewhere
 *  else, and the title gate (a0-50) is a DOOR — a thing a person operates. The
 *  flag turns off that screen and nothing else: the menu, the doors and the
 *  lobby below are the real ones. See `src/ui/title-gate.ts` `gateEnabled`. */
async function bootMenu(page: Page): Promise<void> {
  await page.goto('/?gate=0');
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { __mainMenu?: { visible?: boolean } }).__mainMenu;
      return !!m && m.visible === true;
    },
    undefined,
    { timeout: 15_000 },
  );
  await page.evaluate(() => (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready);
}

test('every voiced label fits the fixed-width chrome it is drawn in', async ({ page }, testInfo) => {
  budgetTest({
    work: 'boot the menu → font settle → measure 18 voiced labels against their boxes',
    measuredSeconds: 6,
  });

  await bootMenu(page);
  const measured = await measure(page);

  const over = measured.filter((m) => m.drawn > m.box);
  const report = measured
    .map(
      (m) =>
        `  ${m.drawn > m.box ? 'OVER' : ' ok '} ${String(Math.round(m.drawn)).padStart(4)}/${m.box}px ` +
        `(${Math.round((1 - m.drawn / m.box) * 100)}% headroom)  ${m.where}: "${m.text}"`,
    )
    .join('\n');

  // Printed on pass as well as failure: the headroom column is the evidence the
  // PR body cites, and it is what tells a future reader whether the next longer
  // word has room. `${testInfo.project.name}` because the fallback face a viewport
  // resolves is not guaranteed identical across device emulations.
  console.log(`[voice-copy-fit / ${testInfo.project.name}]\n${report}`);

  expect(over.map((m) => `${m.where}: "${m.text}" ${Math.round(m.drawn)}px > ${m.box}px`)).toEqual([]);
});

/**
 * Eyes-on evidence for the PR body, both form factors. Not a golden — no
 * baseline, no diff — because these are menu screens whose content is a function
 * of copy and layout only, and the assertion above is the durable check. These
 * exist so a human can read what the voice actually became.
 */
/**
 * The committed glyph table, re-measured in the real booted page (a0-32).
 *
 * `src/ui/font-metrics.data.ts` is what lets a UNIT test answer "does this label
 * fit this shape" — the whole reason the wedge and the BUILD button can be
 * asserted headless now instead of eyeballed in a screenshot. It is generated by
 * `tools/font-metrics-scan.mjs` from `public/fonts/*.woff2`, and a generated file
 * that nothing checks is a note that happens to compile. So this walks every row
 * of it against `measureText` in the page that actually loaded those files.
 *
 * Two claims, and they are different claims:
 *
 *  1. **The per-glyph advances are exact.** Inside the faces' `unicode-range` the
 *     browser is drawing from the file in this repo, so this must agree to the
 *     pixel on every machine — that is why only that range is tabled at all (the
 *     a1-01 trap, spelled out in the scanner's header).
 *  2. **The whole-string arithmetic lands where it claims to.** The engine rounds
 *     every glyph advance to a whole pixel and adds them up — it does not kern,
 *     and it does not add fractions — which is why `font-metrics.ts` rounds per
 *     glyph rather than once at the end. Summed the other way a 28-glyph line
 *     comes out three pixels light, and light is the direction a fit budget may
 *     not be wrong in. The residual is the engine's SECOND quantisation, of the
 *     type size, which this model deliberately does not reproduce because it only
 *     ever makes the model read wide.
 */

/** How far the headless model may sit from the page, px, and in which direction.
 *
 *  Above zero it is reading WIDE, which is safe and expected at the fractional
 *  type sizes the wheel's profile ramp produces (the engine measures 13px metrics
 *  for a 13.435px request; this model does not). Below zero it is reading light,
 *  and a fit budget that reads light is the defect this whole brief is about — so
 *  the floor is a whole pixel of the engine's own rounding and not a pixel more.
 */
const MODEL_LIGHT_TOLERANCE = 1;
test('the glyph table still measures what it says it measures', async ({ page }, testInfo) => {
  budgetTest({
    work: 'boot the menu → font settle → re-measure the committed per-glyph table and the real UI strings',
    measuredSeconds: 7,
  });

  await bootMenu(page);

  const stacks: Record<MetricFace, { font: string; weight: string }> = {
    heading: { font: FONT_HEADING, weight: '400' },
    headingBold: { font: FONT_HEADING, weight: 'bold' },
    body: { font: FONT_BODY, weight: '400' },
    bodyBold: { font: FONT_BODY, weight: '700' },
    bodyBlack: { font: FONT_BODY, weight: '800' },
  };

  const measured = await page.evaluate(
    ([tables, lineHeights, stacksIn]) => {
      const ctx = document.createElement('canvas').getContext('2d')!;
      const REF = 1000;
      const round = (n: number) => Math.round(n * 1e4) / 1e4;
      const drift: Array<{ face: string; glyph: string; tabled: number; real: number }> = [];
      const lines: Array<{ face: string; tabled: number; real: number }> = [];
      for (const [face, table] of Object.entries(tables)) {
        const s = (stacksIn as Record<string, { font: string; weight: string }>)[face]!;
        ctx.letterSpacing = '0px';
        ctx.font = `${s.weight} ${REF}px ${s.font}`;
        for (const [glyph, tabled] of Object.entries(table as Record<string, number>)) {
          const real = round(ctx.measureText(glyph).width / REF);
          if (real !== tabled) drift.push({ face, glyph, tabled, real });
        }
        const m = ctx.measureText('|ÉqM');
        lines.push({
          face,
          tabled: (lineHeights as Record<string, number>)[face]!,
          real: round((m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / REF),
        });
      }
      return { drift, lines };
    },
    [ADVANCE_EM, LINE_HEIGHT_EM, stacks] as const,
  );

  expect(
    measured.drift.map((d) => `${d.face} "${d.glyph}": table says ${d.tabled}em, the page draws ${d.real}em`),
    'the committed table is stale — run `node tools/font-metrics-scan.mjs`',
  ).toEqual([]);
  expect(measured.lines.filter((l) => l.real !== l.tabled)).toEqual([]);

  // …and the whole-string claim: the model is an upper bound on what Pixi will
  // measure, over the real UI copy above rather than over invented strings.
  const strings = await page.evaluate((cases: readonly FitCase[]) => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    return cases.map((c) => {
      ctx.letterSpacing = '0px';
      ctx.font = `${c.size}px ${c.font}`;
      // Pixi adds its tracking BETWEEN glyphs (n − 1 gaps) rather than after each
      // — `CanvasTextMetrics._measureText`, with `experimentalLetterSpacing` off.
      return { where: c.where, text: c.text, plain: ctx.measureText(c.text).width };
    });
  }, CASES);

  const light: string[] = [];
  const report: string[] = [];
  for (const s of strings) {
    const c = CASES.find((x) => x.where === s.where && x.text === s.text)!;
    const face: MetricFace = c.font === FONT_HEADING ? 'heading' : 'body';
    const model = textWidth(c.text, { face, size: c.size, tracking: 0 });
    const delta = model - s.plain;
    if (delta < -MODEL_LIGHT_TOLERANCE) {
      light.push(`${c.where}: model ${model.toFixed(2)}px < page ${s.plain.toFixed(2)}px`);
    }
    report.push(
      `  ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}px on ${s.plain.toFixed(0)}px (${c.text.length} glyphs)  ${c.where}`,
    );
  }
  console.log(`[font-metrics model vs page / ${testInfo.project.name}]\n${report.join('\n')}`);
  expect(light, 'the headless width model reads light — a fit budget may not be optimistic').toEqual([]);
});

test('screenshots the voiced screens for review', async ({ page }, testInfo) => {
  budgetTest({
    work: 'boot the menu → walk main menu, doors, keypad → capture three screens',
    measuredSeconds: 12,
  });

  const tag = testInfo.project.name;
  await bootMenu(page);
  await page.screenshot({ path: `evidence/voice-${tag}-1-main-menu.png` });

  // PLAY → the doors. Driven through the seam's physical tap point, which is how
  // the rest of this suite reaches a control (the game is one canvas, and on a
  // touch project the whole UI is rotated 90° — a raw viewport coordinate would
  // land on the wrong control).
  const play = await page.evaluate(() => {
    const m = (
      window as unknown as {
        __mainMenu?: {
          controls?: ReadonlyArray<{ kind: string; physicalCenter: { x: number; y: number } }>;
        };
      }
    ).__mainMenu;
    return m?.controls?.find((c) => c.kind === 'play')?.physicalCenter ?? null;
  });
  expect(play, 'the main menu seam reports a PLAY control').not.toBeNull();
  await page.mouse.click(play!.x, play!.y);
  await page.waitForFunction(
    () => {
      const d = (window as unknown as { __onlineMenu?: { visible?: boolean } }).__onlineMenu;
      return !!d && d.visible === true;
    },
    undefined,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(300);
  await page.screenshot({ path: `evidence/voice-${tag}-2-doors.png` });

  // JOIN → the code pad, where ENTER THE CLAIM CODE is drawn.
  const join = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __onlineMenu?: {
          doorControls?: ReadonlyArray<{ kind: string; physicalCenter: { x: number; y: number } }>;
        };
      }
    ).__onlineMenu;
    return d?.doorControls?.find((c) => c.kind === 'join')?.physicalCenter ?? null;
  });
  expect(join, 'the doors seam reports a JOIN control').not.toBeNull();
  await page.mouse.click(join!.x, join!.y);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `evidence/voice-${tag}-3-keypad.png` });
});
