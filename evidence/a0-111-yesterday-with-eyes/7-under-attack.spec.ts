/**
 * evidence/a0-111-yesterday-with-eyes/7-under-attack.spec.ts — the under-attack
 * prompt, in both station states. OWNER: QA Manager (a0-111).
 *
 * a0-99 found the prompt telling a player to *"follow the arrow"* while their
 * station was centred on screen and no arrow was drawn, and said in as many words
 * that it could not capture the OFF-SCREEN case. That missing frame is what a0-104
 * turned on. The brief: **put it on the record now.**
 *
 * ── HOW THE SIEGE IS HELD ───────────────────────────────────────────────────
 * The alarm latches for ALARM_HOLD_S = 5 s and drains at 2 HP/s, and a dpr-2
 * screenshot plus its round trips take longer than that — so a burst of damage
 * followed by a leisurely capture photographs a RELEASED alarm, and worse: the
 * UNDER-ATTACK prompt *completes* on a siege survived, so an alarm that lapses
 * mid-capture retires the very prompt this is about. a0-104's harness solved that
 * with a pump and this uses the same shape: 2 HP every 400 ms in the page, through
 * `__planetRush.damageCore` — the queued debug Action drained on a tick boundary
 * through the sim's OWN damage function — with a floor, because a dead station
 * switches the alarm off and a siege is not a demolition.
 *
 * Nothing about the HUD is staged. The two states are reached by MOVING THE SHIP,
 * which is a thing a player does with a thumb:
 *   - home ON screen  — `__oreHudStage.dock(0)`, the ship parked at its own station
 *   - home OFF screen — `__oreHudStage.mine(0)`, the ship parked at station+(900,900)
 *
 * What is read back: the sentence the band actually drew (`__onboardingStage`),
 * the renderer's own visible-world rectangle (so "off screen" is a number, not an
 * impression), and whether `alarm-arrow` and `alarm-frame` appear in the layout
 * registry — the client's own answer to "was there an arrow", taken off the same
 * flag that draws it.
 */
import { test } from '@playwright/test';
import { PROFILES } from './profiles';
import { bootDebugMatch, layoutRows, park } from './drive';
import { frame, note } from './shot';
import { settleFrames } from '../../tests/mobile/render-settle';

/** Below this the pump stops: a dead station switches the alarm off entirely. */
const FLOOR_HP = 30;
const MINE_OFFSET = { x: 900, y: 900 };

async function startSiege(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate((floor) => {
    const w = window as unknown as { __a0111Pump?: number };
    if (w.__a0111Pump !== undefined) return;
    w.__a0111Pump = window.setInterval(() => {
      const hp = window.__planetRush?.coreHp?.(0) ?? null;
      if (hp !== null && hp > floor) window.__planetRush?.damageCore?.(0, 2);
    }, 400);
  }, FLOOR_HP);
}

async function stopSiege(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __a0111Pump?: number };
    if (w.__a0111Pump !== undefined) window.clearInterval(w.__a0111Pump);
    w.__a0111Pump = undefined;
  });
}

/** Wait until the HUD itself says the alarm is up — `alarm-frame` in the layout
 *  registry, the pulsing screen frame the arrow keys off. (`__alarmStage` is the
 *  AUDIO half and is silent in a browser that has had no user gesture; it is
 *  recorded anyway.) Returns how many polls it took, or -1. */
async function waitForAlarm(page: import('@playwright/test').Page): Promise<number> {
  for (let i = 0; i < 40; i++) {
    const rows = await layoutRows(page);
    if (rows.some((r) => r.id === 'alarm-frame')) return i;
    await page.waitForTimeout(300);
  }
  return -1;
}

async function readback(
  page: import('@playwright/test').Page,
  where: 'home' | 'away',
): Promise<unknown> {
  const rows = await layoutRows(page);
  const state = await page.evaluate(() => ({
    prompt: window.__onboardingStage?.prompt() ?? null,
    device: window.__onboardingStage?.device() ?? null,
    scheme: window.__onboardingStage?.scheme() ?? null,
    world: window.__viewStage?.world() ?? null,
    viewport: window.__viewStage?.viewport() ?? null,
    alarm: window.__alarmStage?.read() ?? null,
    coreHp: window.__planetRush?.coreHp?.(0) ?? null,
    ship: window.__pauseStage?.read().ship ?? null,
  }));
  // Where HOME is, from the staging the seam documents: `mine()` leaves the
  // station standing and moves the ship to station + (900, 900).
  const ship = state.ship;
  const home =
    ship && where === 'away' ? { x: ship.x - MINE_OFFSET.x, y: ship.y - MINE_OFFSET.y } : ship;
  const w = state.world;
  const homeOnScreen =
    home && w ? home.x >= w.left && home.x <= w.right && home.y >= w.top && home.y <= w.bottom : null;
  return {
    ...state,
    home,
    homeOnScreen,
    arrowDrawn: rows.some((r) => r.id === 'alarm-arrow'),
    alarmFrameDrawn: rows.some((r) => r.id === 'alarm-frame'),
    promptDrawn: rows.some((r) => r.id === 'onboarding'),
    arrowRect: rows.find((r) => r.id === 'alarm-arrow')?.bounds ?? null,
    promptRect: rows.find((r) => r.id === 'onboarding')?.bounds ?? null,
    elements: rows.map((r) => r.id),
  };
}

for (const profile of PROFILES) {
  for (const where of ['home', 'away'] as const) {
    test(`a0-111 under attack, station ${where === 'home' ? 'ON' : 'OFF'} screen — ${profile.id}`, async ({
      browser,
    }) => {
      test.setTimeout(300_000);
      const context = await browser.newContext({
        viewport: { width: profile.width, height: profile.height },
        deviceScaleFactor: profile.dpr,
        isMobile: profile.touch,
        hasTouch: profile.touch,
      });
      const page = await context.newPage();
      await bootDebugMatch(page);

      // Park the ship first, so the alarm comes up over the view it is about.
      await page.evaluate((w) => {
        if (w === 'home') window.__oreHudStage?.dock(0);
        else window.__oreHudStage?.mine(0);
      }, where);
      await settleFrames(page, 8);

      await startSiege(page);
      const polls = await waitForAlarm(page);
      // Re-park: the ship drifts while the siege is being established, and the
      // whole question is where HOME is relative to the glass at the moment of
      // the photograph.
      await page.evaluate((w) => {
        if (w === 'home') window.__oreHudStage?.dock(0);
        else window.__oreHudStage?.mine(0);
      }, where);
      await settleFrames(page, 8);
      await park(page);

      const name = `${profile.id}-under-attack-${where === 'home' ? 'on-screen' : 'off-screen'}`;
      await frame(page, name);
      const read = await readback(page, where);
      await stopSiege(page);

      note(name, {
        profile: profile.label,
        boot: '?debug=1 on the production bundle (no ?freeze — the build stamp is in frame)',
        stationState: where === 'home' ? 'the local station ON screen' : 'the local station OFF screen',
        staging: `${where === 'home' ? '__oreHudStage.dock(0)' : '__oreHudStage.mine(0)'}, plus a held siege: __planetRush.damageCore(0, 2) every 400ms above a ${FLOOR_HP} HP floor`,
        alarmPolls: polls,
        ...(read as Record<string, unknown>),
      });
      await context.close();
    });
  }
}
