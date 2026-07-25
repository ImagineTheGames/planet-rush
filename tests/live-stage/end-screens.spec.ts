/**
 * tests/live-stage/end-screens.spec.ts — the end-of-match / DEFEATED screens are
 * wired into boot, verified in the REAL booted client. OWNER: UI Engineer (field
 * report v0.1.2).
 *
 * The developer's report: "there was no end match screen after my planet died."
 * The home core died and NOTHING happened. The d7-01 end-of-match views (PR #45)
 * merged and unit-passed, but `main.ts` boot never wired them onto sim state — the
 * exact M2 dark-matter class the healthbars, the main menu, and the ore deposit
 * were all caught in: merged, component-tested, invisible in the shipped game. A
 * headless unit test cannot catch a missing *wire*; only booting the real bundle
 * and driving a real death can.
 *
 * Two distinct moments, two screens (GDD §2.7, §4.7), both asserted here on the
 * live client through the `?debug=1` `window.__endScreenStage` seam `main.ts`
 * installs — which stages deaths through the sim's OWN `destroyCore`, never fakes
 * the UI:
 *
 *  - **Your elimination** (core dies, the others fight on): the DEFEATED overlay,
 *    offering SPECTATE + REMATCH. Choosing SPECTATE drops the overlay and the live
 *    match plays on (the sim never stopped) — proven by the sim's tick count still
 *    climbing with no overlay up.
 *  - **Match end** (last core standing): the result screen — REMATCH + BACK TO
 *    MENU — shown even to a spectator watching someone else take the system.
 *
 * And REMATCH boots a NEW world, proven by the match counter advancing.
 *
 * It runs WITHOUT `?freeze=1` on purpose: SPECTATE has to be watched letting the
 * LIVE sim keep ticking, which a pinned frame cannot show.
 */
import { test, expect } from '@playwright/test';

type EndScreen = 'none' | 'defeated' | 'result';
type EndButton = 'rematch' | 'spectate' | 'menu';

/** The `?debug=1`-only seam this spec drives — installed in `src/main.ts`
 *  (`installEndScreenStage`), staging deaths through the sim's own rule. */
interface EndScreenStage {
  /** Destroy the LOCAL core while the others stand — the DEFEATED case. */
  eliminateLocal(): boolean;
  /** Destroy every core but one non-local survivor — the match-end case. */
  endMatch(): boolean;
  /** Which end screen the wiring has up this frame. */
  screen(): EndScreen;
  /** The buttons that screen is offering. */
  buttons(): EndButton[];
  /** Drive SPECTATE / REMATCH exactly as a tap would. */
  spectate(): void;
  rematch(): void;
  /** Worlds built this boot — REMATCH bumps it (proof a new world booted). */
  matchId(): number;
  /** The sim's own step count — climbs while the match runs. */
  ticks(): number;
}
interface StageWindow {
  __endScreenStage?: EndScreenStage;
}
declare const window: Window & StageWindow;

test('a dead core raises the DEFEATED overlay, spectate keeps the match live, match-end shows the result, rematch reboots', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // Live sim (no ?freeze): spectate must be able to keep ticking.
  await page.goto('/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });

  // The staging seam installs during boot; wait for it before driving it.
  await page.waitForFunction(() => typeof window.__endScreenStage?.eliminateLocal === 'function', undefined, {
    timeout: 20_000,
  });

  // --- Moment 1: your core dies, the others fight on → the DEFEATED overlay. ---
  const staged = await page.evaluate(() => window.__endScreenStage!.eliminateLocal());
  expect(staged, 'the local core was available to destroy').toBe(true);

  await page.waitForFunction(() => window.__endScreenStage!.screen() === 'defeated', undefined, {
    timeout: 20_000,
  });
  const defeated = await page.evaluate(() => ({
    screen: window.__endScreenStage!.screen(),
    buttons: window.__endScreenStage!.buttons(),
  }));
  expect(defeated.screen, 'the DEFEATED overlay is up after the local core dies').toBe('defeated');
  expect(defeated.buttons, 'DEFEATED offers SPECTATE and REMATCH — never a dead silent screen').toEqual([
    'rematch',
    'spectate',
  ]);

  // Screenshot the DEFEATED overlay for the PR body.
  await page.screenshot({ path: 'tests/live-stage/end-screens-defeated-evidence.png' });

  // --- Choose SPECTATE: the overlay drops and the LIVE match plays on. ---
  const ticksBeforeSpectate = await page.evaluate(() => window.__endScreenStage!.ticks());
  await page.evaluate(() => window.__endScreenStage!.spectate());

  await page.waitForFunction(() => window.__endScreenStage!.screen() === 'none', undefined, {
    timeout: 20_000,
  });
  // The match is still running: the sim's own clock keeps advancing with no overlay
  // up — "watch the rest" (GDD §2.7), the match continuing visibly.
  const spectating = await page
    .waitForFunction(
      (before) => {
        const s = window.__endScreenStage!;
        return s.screen() === 'none' && s.ticks() > before + 2 ? { ticks: s.ticks() } : null;
      },
      ticksBeforeSpectate,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());
  expect(
    spectating!.ticks,
    'the sim keeps ticking while spectating — the match continues visibly',
  ).toBeGreaterThan(ticksBeforeSpectate);

  // --- Moment 2: the last core falls → the result screen. ---
  const ended = await page.evaluate(() => window.__endScreenStage!.endMatch());
  expect(ended, 'there was a survivor to crown').toBe(true);

  await page.waitForFunction(() => window.__endScreenStage!.screen() === 'result', undefined, {
    timeout: 20_000,
  });
  const result = await page.evaluate(() => ({
    screen: window.__endScreenStage!.screen(),
    buttons: window.__endScreenStage!.buttons(),
  }));
  expect(result.screen, 'the result screen is up once the last core stands').toBe('result');
  expect(result.buttons, 'the result screen offers REMATCH and BACK TO MENU (GDD §4.7)').toEqual([
    'rematch',
    'menu',
  ]);

  // Screenshot the result screen for the PR body.
  await page.screenshot({ path: 'tests/live-stage/end-screens-result-evidence.png' });

  // --- REMATCH: a NEW world boots (straight to a fresh match, GDD §2.7). ---
  const matchIdBefore = await page.evaluate(() => window.__endScreenStage!.matchId());
  await page.evaluate(() => window.__endScreenStage!.rematch());

  const rematched = await page
    .waitForFunction(
      (before) => {
        const s = window.__endScreenStage!;
        return s.matchId() > before && s.screen() === 'none' ? { matchId: s.matchId() } : null;
      },
      matchIdBefore,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());
  expect(rematched!.matchId, 'REMATCH built a new world, not re-showed the old one').toBeGreaterThan(
    matchIdBefore,
  );

  expect(pageErrors, 'no page errors across the whole end-screen flow').toEqual([]);
});
