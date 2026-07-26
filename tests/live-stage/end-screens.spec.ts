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

  // --- Respawn countdown (field request v0.2.2) --------------------------
  /** Kill the LOCAL ship while its core stands — a *respawnable* death, driven
   *  through the sim's own `killShip`. Returns whether it staged. */
  killLocalShip(): boolean;
  /** The local ship's liveness — false while dead, true again after respawn. */
  shipAlive(): boolean;
  /** The sim's own respawn clock for the local ship (seconds; 0 when alive). */
  respawnTimer(): number;
  /** The respawn countdown the HUD actually DREW this frame. */
  respawnCountdown(): { show: boolean; seconds: number; text: string };
}
interface StageWindow {
  __endScreenStage?: EndScreenStage;
  /** The upgrade-wheel seam — reused here for the p4-16 tie-in (buy an upgrade
   *  immediately after respawn and assert it applies). */
  __upgradeWheelStage?: {
    setOre(ore: number): { banked: number } | null;
    buyTier(i: number): { result: string; tier: number } | null;
    tierOf(i: number): number | null;
  };
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

test('a ship death with the core alive raises the RESPAWNING countdown, it decrements on sim ticks, clears at respawn, and an upgrade bought right after applies (field request v0.2.2 + p4-16)', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // Live sim (no ?freeze): the countdown must be watched running down on the
  // sim's OWN respawn clock, which a pinned frame cannot show.
  await page.goto('/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__endScreenStage?.killLocalShip === 'function', undefined, {
    timeout: 20_000,
  });
  await page.waitForFunction(() => typeof window.__upgradeWheelStage?.buyTier === 'function', undefined, {
    timeout: 20_000,
  });

  // The upgrade the developer bought after respawning — record the tier before
  // any of this, so the p4-16 assertion at the end is a genuine +1.
  const tierBefore = await page.evaluate(() => window.__upgradeWheelStage!.tierOf(0));
  expect(tierBefore, 'a stock tier to upgrade from').not.toBeNull();

  // --- Kill the ship while the core stands → the RESPAWNING countdown. ---
  const killed = await page.evaluate(() => window.__endScreenStage!.killLocalShip());
  expect(killed, 'the local ship was alive to kill (core still standing)').toBe(true);

  await page.waitForFunction(() => window.__endScreenStage!.respawnCountdown().show === true, undefined, {
    timeout: 20_000,
  });
  const dead = await page.evaluate(() => ({
    countdown: window.__endScreenStage!.respawnCountdown(),
    screen: window.__endScreenStage!.screen(),
    shipAlive: window.__endScreenStage!.shipAlive(),
  }));
  expect(dead.countdown.show, 'the RESPAWNING countdown is up while dead-and-respawning').toBe(true);
  expect(dead.countdown.text, 'it reads RESPAWNING with the seconds').toMatch(/RESPAWNING\s+\d/i);
  expect(dead.countdown.seconds, 'it counts whole seconds off the sim clock').toBeGreaterThan(0);
  // Distinct from ELIMINATION: the core is alive, so the DEFEATED flow never
  // takes the screen — this is a respawn, not a defeat (GDD §2.7).
  expect(dead.screen, 'no DEFEATED overlay — the core is alive, this death is not final').toBe('none');
  expect(dead.shipAlive, 'the ship is dead while the countdown runs').toBe(false);

  // Screenshot the countdown for the PR body.
  await page.screenshot({ path: 'tests/live-stage/end-screens-respawn-evidence.png' });

  // --- It decrements on the sim's OWN ticks (never a UI-side timer). ---
  const startSeconds = dead.countdown.seconds;
  const decremented = await page
    .waitForFunction(
      (start) => {
        const c = window.__endScreenStage!.respawnCountdown();
        // Still counting (show), but a whole second lower — the ceiling of the
        // sim timer fell, so the number is the sim's, not the UI's.
        return c.show && c.seconds < start && c.seconds > 0 ? { seconds: c.seconds } : null;
      },
      startSeconds,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());
  expect(decremented!.seconds, 'the countdown ticked down as the sim clock fell').toBeLessThan(startSeconds);

  // --- It clears the instant the ship exists again, and controls return. ---
  const respawned = await page
    .waitForFunction(
      () => {
        const s = window.__endScreenStage!;
        return s.shipAlive() && s.respawnCountdown().show === false ? { alive: true } : null;
      },
      undefined,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());
  expect(respawned!.alive, 'the ship respawned and the countdown vanished').toBe(true);

  // --- The p4-16 tie-in: buy an upgrade IMMEDIATELY after respawn — it applies. ---
  // The developer's exact report was that an upgrade bought right after respawn
  // did nothing. Give the fresh ship ore and buy a tier through the sim's own
  // validated purchase; the tier must climb.
  await page.evaluate(() => window.__upgradeWheelStage!.setOre(999));
  const bought = await page.evaluate(() => window.__upgradeWheelStage!.buyTier(0));
  expect(bought, 'the buy resolved').not.toBeNull();
  expect(bought!.result, 'the upgrade applied right after respawn (p4-16 regression)').toBe('ok');
  expect(bought!.tier, 'the tier climbed by one — the upgrade actually took').toBe((tierBefore ?? 0) + 1);

  expect(pageErrors, 'no page errors across the whole respawn-countdown flow').toEqual([]);
});
