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
 * l2-02 made eight labels longer — `PLAY SOLO` (9) → `SOLO CONTRACT` (13),
 * `ORE ·` → `YIELD ·`, `VICTORY` (7) → `CLAIM HELD` (10), `WAITING FOR THE HOST`
 * (20) → `WAITING FOR THE CLAIM HOLDER` (28) — and this project has shipped text
 * that fit on desktop and overflowed on a phone. So the measurement is a test,
 * not a screenshot somebody once looked at.
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
 * ── A CAVEAT THE NUMBERS DEPEND ON ─────────────────────────────────────────
 * `src/ui/typography.ts` names Audiowide/Oxanium and says the page loads them.
 * It does not: there is no `@font-face` in `index.html` and no font file in the
 * repo, so every string here is really drawn in the fallback (`Trebuchet MS` /
 * `Liberation Mono` and their substitutes). This spec measures the FULL declared
 * stack, so it measures whatever the page actually resolves — and if the real
 * faces are ever added, it re-measures against them and fails if a label stopped
 * fitting. Audiowide is materially wider than Trebuchet, so that is a real
 * possibility and the headroom is reported below rather than merely asserted.
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
  // --- The three doors (lobby-entry.ts DOOR_OPTIONS, drawn at 16px heading) ---
  { where: 'DOOR_OPTIONS.solo', text: 'SOLO CONTRACT', font: FONT_HEADING, size: 16, box: 420 },
  { where: 'DOOR_OPTIONS.create', text: 'OPEN A CLAIM', font: FONT_HEADING, size: 16, box: 420 },
  { where: 'DOOR_OPTIONS.join', text: 'JOIN A CLAIM', font: FONT_HEADING, size: 16, box: 420 },

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

  // --- The entry screen's refusals (lobby-entry-view.ts, 12px body) ----------
  // The longest of the four, which is the one that decides the set.
  {
    where: 'ENTRY_ERRORS.full',
    text: 'That claim is full. Ask for a rematch, or take a solo contract.',
    font: FONT_BODY,
    size: 12,
    box: 812,
  },
  // The longest of the FOUR hints (u9-01 added CAMPAIGN; this said "three"),
  // bounded by the DOOR (420) rather than by the content box: the hint is centred
  // under its button and reads as part of it, so the button's width is the honest
  // container even though nothing clips at it.
  //
  // Still the tightest case in the sweep, and the one that actually overflowed:
  // at 70 chars it drew 462px into a 420px door. Shortened to 57 (r6-01), it
  // draws 376px — 10% headroom, in line with its siblings (CAMPAIGN 337px,
  // OPEN A CLAIM 343px). The budget is 63 characters at 11px: Liberation Mono
  // is 0.6em, so 420 / 6.601 = 63.6. Watch this one if a longer hint is proposed.
  {
    where: 'DOOR_OPTIONS.solo hint',
    text: 'Work the claim alone. Bots hold the other seats. Offline.',
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

/** Boot the clean (non-debug) build and wait for the menu and the fonts. */
async function bootMenu(page: Page): Promise<void> {
  await page.goto('/');
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
    work: 'boot the menu → font settle → measure 14 voiced labels against their boxes',
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

  // JOIN A CLAIM → the code pad, where ENTER THE CLAIM CODE is drawn.
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
