/**
 * evidence/a0-14-hangar/capture.ts — the shared walk both a0-14 captures take.
 * OWNER: UI Engineer.
 *
 * One helper, two projects (desktop and the 390 px phone), so the desktop frame
 * and the phone frame are the same screen reached the same way and any
 * difference between them is the layout rather than the route.
 *
 * Everything here goes through the shipped `window.__mainMenu` seam or through a
 * REAL press at the physical point that seam reports. Nothing calls into the
 * model: the claim is that a player can reach this screen, and a claim about a
 * player is not settled by calling a function they cannot.
 */
import { expect, type Page } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface PhysicalPoint {
  readonly x: number;
  readonly y: number;
}
export interface ControlReport {
  readonly kind: string;
  readonly index?: number;
  readonly physicalCenter: PhysicalPoint;
}
export interface MenuSeam {
  visible: boolean;
  screen: string;
  matchStarted: boolean;
  controls: readonly ControlReport[];
  hangarControls: readonly ControlReport[];
  hangarShip: string;
  hangarLevel: string;
  hangarEmpty: string;
}

declare global {
  interface Window {
    __mainMenu?: MenuSeam;
  }
}

/** The profile key the shipped reader reads — `src/progression/profile.ts`. */
export const PROFILE_KEY = 'planet-rush:profile';

/**
 * A real career, seeded into `localStorage` **before the bundle boots** so the
 * shipped `loadProfile` is what parses it.
 *
 * `xp: 16_400` is **level 7, part-way in** on the ratified curve (base 300 /
 * exp 1.6): level 7 begins at 14 920 lifetime XP and costs 6 750 to leave, so
 * the bar sits about a fifth full — a state a player is actually in, rather than
 * a round number picked to make a screenshot tidy. At the spike's measured
 * round-robin median (~619 XP a match, plan §1.3) that is roughly 27 matches,
 * which is what `matches` says.
 *
 * The first draft of this file guessed 12 000 and the screen answered LEVEL 6.
 * The screen was right — which is the curve and the reader doing their job in
 * the shipped bundle, and worth recording rather than quietly editing away.
 */
export const SEEDED_PROFILE = JSON.stringify({ v: 1, xp: 16_400, level: 7, matches: 27 });

/** Boot the front door with a given stored profile (or none at all). */
export async function openFrontDoor(page: Page, profile: string | null): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    },
    [PROFILE_KEY, profile] as const,
  );
  // `?gate=0` (a0-50): the title gate is a DOOR in front of this screen, opened
  // by a press over four beats. This capture is about the hangar, not the door.
  await page.goto('/?gate=0');
  await page.waitForFunction(() => window.__mainMenu?.visible === true);
}

/** The physical point of a named main-menu button, through the landscape-lock
 *  remap the seam already applies. */
export async function menuPoint(page: Page, kind: string): Promise<PhysicalPoint> {
  const point = await page.evaluate(
    (k) => window.__mainMenu?.controls.find((c) => c.kind === k)?.physicalCenter ?? null,
    kind,
  );
  expect(point, `no main-menu control reported for ${kind}`).not.toBeNull();
  return point as PhysicalPoint;
}

/** A real press on the canvas at a physical point. */
export async function press(page: Page, point: PhysicalPoint): Promise<void> {
  const box = await page.locator('canvas').boundingBox();
  expect(box, 'no canvas').not.toBeNull();
  await page.mouse.click(box!.x + point.x, box!.y + point.y);
}

/**
 * Press HANGAR and wait for the screen to own the display.
 *
 * A REAL press rather than the seam's `hangar()` method, deliberately: a screen
 * that can only be opened by a test hook is a screen that is not on the menu.
 */
export async function openHangar(page: Page): Promise<void> {
  await press(page, await menuPoint(page, 'hangar'));
  await page.waitForFunction(() => window.__mainMenu?.screen === 'hangar');
  // One rendered frame past the state change, so the capture is of the drawn
  // screen and not of the frame that was still the menu.
  await page.waitForTimeout(250);
}

/** What the hangar is saying, as strings — the readback that survives without
 *  the picture, and the only way to prove a screenshot of a panel is an HONEST
 *  empty panel rather than a blank one. */
export async function readHangar(page: Page): Promise<{ ship: string; level: string; empty: string }> {
  return page.evaluate(() => ({
    ship: window.__mainMenu?.hangarShip ?? '',
    level: window.__mainMenu?.hangarLevel ?? '',
    empty: window.__mainMenu?.hangarEmpty ?? '',
  }));
}

/** Append a reading to `readback.json`, beside the images. */
export function record(key: string, value: unknown): void {
  const path = resolve(import.meta.dirname, 'readback.json');
  let all: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      all = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch {
      all = {};
    }
  }
  all[key] = value;
  writeFileSync(path, `${JSON.stringify(all, null, 2)}\n`);
}
