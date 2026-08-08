/**
 * tests/live-stage/end-screens-teams.spec.ts — the a0-09 evidence run. OWNER: UI
 * Engineer.
 *
 * The developer, 2026-08-07, with a screenshot of the end screen:
 *
 *   > *"i lost somehow but my team is the one that won..."*
 *
 * It read **DEFEAT** — *"Player 7 took the claim."* Player 7 was their teammate.
 *
 * `end-of-match.test.ts` proves the model reads a side correctly. It cannot prove
 * the shipped client HANDS it one — and that is the whole M2 dark-matter class
 * this directory exists for (`end-screens.spec.ts`: merged, unit-passed, never
 * wired). The side reaching the summary is a wiring fact: `src/main.ts`
 * `currentOutcome` must pass the same `alarmAllies()` roster the klaxon is scoped
 * to, or the outcome arrives sideless and `endKind` falls back to teams-of-one —
 * which is FFA-correct and TEAMS-wrong, in exactly the way that produced the
 * screenshot. So this boots the REAL bundle in a REAL sided world.
 *
 * `?debug=1&sides=2` is the debug boot's TEAMS switch (`readDebugSides`): it fills
 * in the same `teams` table the lobby would have authored, so the world is built
 * by the ordinary path — real allegiance, real spawn placement. Sides alternate by
 * slot, so the local seat 0 holds side A with slots 2, 4 and 6.
 *
 * The crowning is the sim's own and is the heart of the bug: `resolveWinner`
 * reports the LAST surviving core it walks, so a side left holding several cores
 * reports its highest slot — an **ally**, even with the local reactor intact. Both
 * scenarios below are therefore genuine ally wins, not staged labels.
 *
 * Both halves of the developer's screen were wrong — the headline said DEFEAT and
 * the line under it was an opponent's sentence about a friend — so the corrected
 * end screen is shot, and so is the ELIMINATED state on the way to it.
 *
 * A note on the pictures, so nobody reads more into them than is there: the
 * end-of-match backdrop is **opaque and covers the whole viewport**
 * (`end-of-match-view.ts`). Both scenarios therefore end on *pixel-identical*
 * frames — same headline, same subhead, same plates, with the differing world
 * underneath painted over. That is by design, not a mistake, and it is why the
 * eliminated run's distinguishing evidence is the ELIMINATED-with-SPECTATE frame
 * in the MIDDLE of it rather than a duplicate of the final one. The assertions,
 * not the screenshots, are what separate the two paths.
 */
import { test, expect } from '@playwright/test';

type EndScreen = 'none' | 'defeated' | 'result';
type EndButton = 'rematch' | 'spectate' | 'menu';

/** The `?debug=1`-only seam this spec drives — `src/main.ts`
 *  `installEndScreenStage`. Only the members this run needs. */
interface EndScreenStage {
  eliminateLocal(): boolean;
  /** Drop every core NOT on the local player's side — the side wins, with an
   *  ALLY crowned by the sim's own `resolveWinner`. */
  winAlly(): boolean;
  screen(): EndScreen;
  buttons(): EndButton[];
  spectate(): void;
  /** The slots this client believes are on its side. */
  side(): number[];
  /** The words the summary actually resolved: kind, headline, subhead. */
  result(): { kind: string; headline: string; subhead: string } | null;
  ticks(): number;
}
declare const window: Window & { __endScreenStage?: EndScreenStage };

const TEAMS_MATCH = '/?debug=1&sides=2';

/** Boot the real bundle into a sided world and wait for the staging seam. */
async function bootTeams(page: import('@playwright/test').Page): Promise<string[]> {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  // Live sim (no ?freeze): the eliminated → SPECTATE → side-wins sequence has to
  // be watched running, which a pinned frame cannot show.
  await page.goto(TEAMS_MATCH, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__endScreenStage?.winAlly === 'function', undefined, {
    timeout: 20_000,
  });
  return pageErrors;
}

test('a TEAMS win taken by an ALLY reads VICTORY, and the line under it says your side took the claim', async ({
  page,
}) => {
  const pageErrors = await bootTeams(page);

  // The world really is sided: the local seat has allies, which is the premise
  // the whole bug lives on. In FFA this set is `{0}` and nothing below is a test.
  const side = await page.evaluate(() => window.__endScreenStage!.side());
  expect(side, 'the debug boot built a SIDED world — the local seat has allies').toEqual([0, 2, 4, 6]);

  // --- The developer's match: your side takes the claim, an ally holds it. ---
  const staged = await page.evaluate(() => window.__endScreenStage!.winAlly());
  expect(staged, 'there was an ally left holding a core to crown').toBe(true);

  await page.waitForFunction(() => window.__endScreenStage!.screen() === 'result', undefined, {
    timeout: 20_000,
  });
  const shown = await page.evaluate(() => ({
    result: window.__endScreenStage!.result(),
    buttons: window.__endScreenStage!.buttons(),
  }));

  // THE BUG, in one assertion. Before a0-09 this read 'defeat'.
  expect(shown.result!.kind, 'your side took the claim — that is a VICTORY, not a DEFEAT').toBe(
    'victory',
  );
  expect(shown.result!.headline, 'the headline is the win').toBe('CLAIM HELD');

  // …and the other half of the screenshot: the line under it. "Player 7 took the
  // claim." is an opponent's sentence; an ally win says whose side took it and
  // then names who held it.
  expect(shown.result!.subhead, 'the line reads as YOUR side taking the claim').toContain('Your side');
  expect(shown.result!.subhead, 'and it still names who actually held it').toMatch(/Player \d/);
  expect(shown.result!.subhead, 'never the opponent-shaped sentence').not.toMatch(/^Player \d+ took/);

  // Ratified and unchanged (field report v0.1.2, GDD §4.7): the whole-match-over
  // screen offers REMATCH and BACK TO MENU, Rematch first.
  expect(shown.buttons, 'the result screen still offers REMATCH + BACK TO MENU').toEqual([
    'rematch',
    'menu',
  ]);

  await page.screenshot({ path: 'tests/live-stage/teams-ally-victory-evidence.png' });
  expect(pageErrors, 'no page errors across the teams end-screen flow').toEqual([]);
});

test('eliminated → SPECTATE → your side wins: still VICTORY, never DEFEAT and never ELIMINATED', async ({
  page,
}) => {
  const pageErrors = await bootTeams(page);

  // --- Your core dies while your side fights on. That is ELIMINATED, not a
  //     defeat (`docs/team-bots-plan.md` §1.4 — a team can win after your home is
  //     gone), and it still offers SPECTATE.
  const eliminated = await page.evaluate(() => window.__endScreenStage!.eliminateLocal());
  expect(eliminated, 'the local core was available to destroy').toBe(true);

  await page.waitForFunction(() => window.__endScreenStage!.screen() === 'defeated', undefined, {
    timeout: 20_000,
  });
  const dead = await page.evaluate(() => ({
    result: window.__endScreenStage!.result(),
    buttons: window.__endScreenStage!.buttons(),
  }));
  expect(dead.result!.kind, 'your core dying while your side fights on is ELIMINATED').toBe(
    'eliminated',
  );
  expect(dead.buttons, 'ELIMINATED still offers SPECTATE + REMATCH').toEqual(['rematch', 'spectate']);

  // The ONE frame of this run that does not look like the other test's. The
  // end-of-match backdrop is opaque and covers the whole viewport
  // (`end-of-match-view.ts`), so both scenarios FINISH on pixel-identical
  // screens — same CLAIM HELD, same subhead, same two plates, and the differing
  // world underneath painted over. A second photo of that frame proves nothing
  // the first already does. What is unique to this path is the middle of it:
  // ELIMINATED standing while the match is still live, offering SPECTATE. That
  // is the state the brief asks to verify survives, so that is what gets shot.
  await page.screenshot({ path: 'tests/live-stage/teams-eliminated-spectate-evidence.png' });

  // --- SPECTATE: the overlay drops and the live match plays on. ---
  const before = await page.evaluate(() => window.__endScreenStage!.ticks());
  await page.evaluate(() => window.__endScreenStage!.spectate());
  const watching = await page
    .waitForFunction(
      (t) => {
        const s = window.__endScreenStage!;
        return s.screen() === 'none' && s.ticks() > t + 2 ? { ticks: s.ticks() } : null;
      },
      before,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());
  expect(watching!.ticks, 'the sim keeps ticking while spectating').toBeGreaterThan(before);

  // --- …and your side finishes the job while you watch. ---
  const staged = await page.evaluate(() => window.__endScreenStage!.winAlly());
  expect(staged, 'an ally was still holding a core after your own fell').toBe(true);

  await page.waitForFunction(() => window.__endScreenStage!.screen() === 'result', undefined, {
    timeout: 20_000,
  });
  const shown = await page.evaluate(() => window.__endScreenStage!.result());

  // The developer's screenshot in slow motion — and it ends on the right word.
  expect(shown!.kind, 'your side won while you spectated: VICTORY').toBe('victory');
  expect(shown!.kind, 'the match is over — ELIMINATED is a live-match state').not.toBe('eliminated');
  expect(shown!.headline).toBe('CLAIM HELD');
  expect(shown!.subhead).toContain('Your side');

  await page.screenshot({ path: 'tests/live-stage/teams-eliminated-then-side-wins-evidence.png' });
  expect(pageErrors, 'no page errors across the eliminate → spectate → win flow').toEqual([]);
});
