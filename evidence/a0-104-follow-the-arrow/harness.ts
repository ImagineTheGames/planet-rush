/**
 * evidence/a0-104-follow-the-arrow/harness.ts — boot, stage a siege, read back
 * what the HUD drew. OWNER: UI Engineer (a0-104).
 *
 * a0-99's method, kept: every frame comes off the PRODUCTION bundle under
 * `?debug=1`, the damage is staged through the sim's own damage function on a
 * tick boundary (`__planetRush.damageCore` — a queued debug Action, not a poke
 * at world state), and nothing about the HUD is staged at all. No element is
 * shown, hidden, moved or armed here. We hurt the station, park the ship
 * somewhere, and photograph what the shipped HUD decided to do about it.
 *
 * THE ONE THING THIS ADDS TO a0-99, AND THE WHOLE REASON THE BRIEF EXISTS
 * ---------------------------------------------------------------------------
 * a0-99 could only capture the siege with the player's own station ON SCREEN,
 * and could not tell from that frame alone whether the missing arrow or the
 * present sentence was the defect. So both states are staged here, on the same
 * boot, seconds apart:
 *
 *  - **home on screen** — `__oreHudStage.dock(0)` parks the local ship at its own
 *    station (a shipped seam, used by the ore-deposit captures);
 *  - **home off screen** — `__oreHudStage.mine(0)` parks it at `station + (900,
 *    900)`, which is that seam's own documented staging ("far from home").
 *
 * Neither call touches the alarm, the arrow or the prompt. They move the ship,
 * which is a thing a player does with a thumb.
 *
 * WHAT IS READ BACK, AND WHY THESE
 * ---------------------------------------------------------------------------
 *  - `window.__planetRush.layout` — every positioned element's DRAWN rect. The
 *    arrow registers as `alarm-arrow` on exactly the frames it draws
 *    (`Hud.describeLayout`), so the row's presence or absence is the client's own
 *    answer to "was there an arrow", taken from the same flag that draws it.
 *  - `__onboardingStage.prompt()` — the sentence the band actually drew.
 *  - `__viewStage.world()` — the renderer's own visible-world rectangle, so
 *    "off screen" is a number and not an impression.
 *  - `__alarmStage.read()` — that the siege really is up.
 *
 * Where a readback and the PNG ever disagree, the PNG is the finding and the
 * disagreement is the story (a0-96's rule, kept).
 */
import { expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { settleFrames } from '../../tests/mobile/render-settle';

export const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'shots');

/** The offset `__oreHudStage.mine()` parks the ship at, relative to its own
 *  station. Declared here because it is what lets a readback state where HOME
 *  is: the seam moves the ship and leaves the station where it stands. */
export const MINE_OFFSET = { x: 900, y: 900 };

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export interface LayoutRow {
  readonly id: string;
  readonly anchor: { region: string; margin?: number };
  readonly bounds: Rect;
}
export interface WorldRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

declare global {
  interface Window {
    __planetRush?: {
      readonly layout?: readonly LayoutRow[];
      damageCore?(player: number, amount: number): unknown;
      coreHp?(player: number): number | null;
    };
    __oreHudStage?: {
      mine(ore: number): { cargo: number; cargoCap: number; banked: number } | null;
      dock(ore: number): { cargo: number; banked: number } | null;
    };
    __onboardingStage?: {
      prompt(): { visible: boolean; text: string; bounds: Rect } | null;
      device(): string;
      scheme(): string;
    };
    __viewStage?: {
      world(): WorldRect;
      viewport(): { width: number; height: number };
    };
    __alarmStage?: { read(): { active: boolean; engagements: number; sounds: number } };
    __pauseStage?: { read(): { ship: { x: number; y: number } | null } };
  }
}

export async function frame(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

export function note(name: string, data: unknown): void {
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(join(SHOTS, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
}

/** Boot `?debug=1` — straight into an offline match, seams installed. Same
 *  production bundle as every other capture; only the query string differs. */
export async function bootDebugMatch(page: Page): Promise<void> {
  await page.goto('/?debug=1');
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__oreHudStage?.mine === 'function', undefined, {
    timeout: 30_000,
  });
  await page.waitForFunction(
    () => typeof window.__onboardingStage?.prompt === 'function',
    undefined,
    { timeout: 30_000 },
  );
  await page.evaluate(() =>
    (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready,
  );
  await settleFrames(page, 8);
}

export async function layoutRows(page: Page): Promise<LayoutRow[]> {
  return page.evaluate(() =>
    (window.__planetRush?.layout ?? []).map((e) => ({
      id: e.id,
      anchor: { ...e.anchor },
      bounds: { ...e.bounds },
    })),
  );
}

/** Park the local ship AT its own station, or 900/900 away from it. Returns the
 *  ship's world position afterwards, so the note can state the geometry. */
export async function park(page: Page, where: 'home' | 'away'): Promise<{ x: number; y: number } | null> {
  await page.evaluate((w) => {
    if (w === 'home') window.__oreHudStage?.dock(0);
    else window.__oreHudStage?.mine(0);
  }, where);
  await settleFrames(page, 6);
  return page.evaluate(() => {
    const s = window.__pauseStage?.read().ship;
    return s ? { x: s.x, y: s.y } : null;
  });
}

/**
 * Hold a real siege on the local station for as long as the capture needs, and
 * stop before it becomes a demolition.
 *
 * **Why a pump and not a burst.** The alarm latches for `ALARM_HOLD_S` = 5
 * seconds (`src/ui/alarm.ts`), and on the desktop profile a dpr-2 screenshot
 * plus the round trips around it take longer than that. The first cut of this
 * harness hit the core a few times and then took its time — and the frame it
 * produced was of a released alarm. Worse, a release is not just a missing
 * frame: UNDER-ATTACK *completes* on a siege survived, so an alarm that lapses
 * mid-capture retires the very prompt the capture is about, and every frame
 * after it is honestly promptless for the wrong reason.
 *
 * So the pressure runs in the page, continuously, for the whole capture: 2 HP
 * every 400 ms through `damageCore` — the same queued debug Action drained on a
 * tick boundary through the sim's OWN damage function. That is 5 HP/s against a
 * bucket that drains at `ALARM_DRAIN_HP_PER_S` = 2, so it crosses the 5 HP
 * threshold in a couple of seconds and stays over it. Which is simply what a real
 * attacker parked on a reactor does; the alarm's trigger is not touched, it is
 * fed and left to make its own decision.
 *
 * **And the floor.** The pump refuses to fire below `FLOOR_HP`, because a dead
 * station switches the alarm off (`Hud.updateAlarm` returns early on
 * `stationAlive === false`) and the first cut of this harness photographed a
 * station at 0 core HP for exactly that reason. A siege is not a demolition.
 */
export const FLOOR_HP = 30;

export async function startSiege(page: Page): Promise<void> {
  await page.evaluate((floor) => {
    const w = window as unknown as { __a0104Pump?: number };
    if (w.__a0104Pump !== undefined) return;
    w.__a0104Pump = window.setInterval(() => {
      const hp = window.__planetRush?.coreHp?.(0) ?? null;
      if (hp !== null && hp > floor) window.__planetRush?.damageCore?.(0, 2);
    }, 400);
  }, FLOOR_HP);
}

export async function stopSiege(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __a0104Pump?: number };
    if (w.__a0104Pump !== undefined) window.clearInterval(w.__a0104Pump);
    w.__a0104Pump = undefined;
  });
}

/**
 * Wait until the HUD itself says the alarm is up, and report how long it took.
 *
 * The verdict read is `alarm-frame` in the layout registry — the pulsing screen
 * frame, which the HUD registers on exactly the frames it draws. That is the
 * alarm the ARROW keys off, which is the one this brief is about;
 * `__alarmStage.read().active` is the AUDIO half and reports its own machine,
 * silent in a browser that has had no user gesture. Recorded beside every frame
 * anyway, for the same reason a0-99 recorded everything.
 */
export async function waitForAlarm(page: Page): Promise<number> {
  const started = 0;
  for (let i = 0; i < 40; i++) {
    const rows = await layoutRows(page);
    if (rows.some((r) => r.id === 'alarm-frame')) return i;
    await page.waitForTimeout(300);
  }
  return started - 1;
}

/** Everything the client says about this frame, in one object. */
export async function readback(page: Page, ship: { x: number; y: number } | null, where: 'home' | 'away'): Promise<unknown> {
  const rows = await layoutRows(page);
  const state = await page.evaluate(() => ({
    prompt: window.__onboardingStage?.prompt() ?? null,
    device: window.__onboardingStage?.device() ?? null,
    scheme: window.__onboardingStage?.scheme() ?? null,
    world: window.__viewStage?.world() ?? null,
    viewport: window.__viewStage?.viewport() ?? null,
    alarm: window.__alarmStage?.read() ?? null,
    coreHp: window.__planetRush?.coreHp?.(0) ?? null,
  }));
  // Where HOME is, from the staging the seam documents: `mine()` leaves the
  // station standing and moves the ship to station + (900, 900).
  const home =
    ship && where === 'away' ? { x: ship.x - MINE_OFFSET.x, y: ship.y - MINE_OFFSET.y } : ship;
  const w = state.world;
  const homeOnScreen =
    home && w ? home.x >= w.left && home.x <= w.right && home.y >= w.top && home.y <= w.bottom : null;
  return {
    ...state,
    ship,
    home,
    homeOnScreen,
    arrowDrawn: rows.some((r) => r.id === 'alarm-arrow'),
    alarmFrameDrawn: rows.some((r) => r.id === 'alarm-frame'),
    promptDrawn: rows.some((r) => r.id === 'onboarding'),
    elements: rows.map((r) => r.id),
    rows,
  };
}

/** A soft check that the capture staged what it claims to have staged: the alarm
 *  is up, and the station it is up about is still alive. Never a verdict on the
 *  game — only on the harness. */
export function assertStaged(read: { alarmFrameDrawn: boolean; coreHp: number | null }): void {
  expect(read.alarmFrameDrawn, 'the staged siege reached the alarm').toBe(true);
  expect(read.coreHp ?? 0, 'the station survived the staging').toBeGreaterThan(0);
}
