/**
 * evidence/a0-77-settings-help/boot.ts — reach the settings screen the way a
 * player does. OWNER: UI Engineer (a0-77).
 *
 * Every press below is a REAL press at the physical point the client itself says
 * it drew the control at (`__mainMenu.controls` / `.settingsControls`, through
 * the landscape-lock remap) — never a hit-test seam and never a debug method. A
 * frame of a screen reached by a seam proves the screen renders; a frame of one
 * reached by a press proves it is also reachable, which for a brand-new
 * affordance is the entire question.
 */
import { expect, type Page } from '@playwright/test';
import { settleFrames } from '../../tests/mobile/render-settle';

/** One control as the client reports it: what it is, where it is drawn (logical),
 *  and where a real press must land (physical, post-rotation). */
export interface Control {
  readonly kind: string;
  readonly physicalCenter: { x: number; y: number };
  readonly logical: { x: number; y: number; width: number; height: number };
}

declare global {
  interface Window {
    __mainMenu?: {
      visible: boolean;
      screen: string;
      controls: { kind: string; physicalCenter: { x: number; y: number } }[];
      settingsControls: Control[];
      settingsRows: { kind: string; label: string; value: string }[];
      settingsHelpTitle: string;
      logicalViewport: { width: number; height: number };
      rotated: boolean;
    };
  }
}

/** Boot to the real main menu — the front door, past the title gate. */
export async function bootMenu(page: Page): Promise<void> {
  await page.goto('/?gate=0');
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => !!window.__mainMenu?.visible && window.__mainMenu.controls.length > 0, undefined, {
    timeout: 30_000,
  });
  await page.evaluate(() => (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready);
  await settleFrames(page, 8);
}

/** Press SETTINGS on the menu, and wait until the screen says it is up. */
export async function openSettings(page: Page): Promise<void> {
  const point = await page.evaluate(() => {
    const c = window.__mainMenu?.controls.find((k) => k.kind === 'settings');
    return c ? { ...c.physicalCenter } : null;
  });
  expect(point, 'the menu reports where SETTINGS is drawn').not.toBeNull();
  await page.mouse.click(point!.x, point!.y);
  await page.waitForFunction(() => window.__mainMenu?.screen === 'settings', undefined, { timeout: 20_000 });
  // Park the pointer off every plate: a mouse left where SETTINGS was would hover
  // whatever row landed under it, and a hovered plate is a brighter plate. The
  // frames are the screen at REST unless a frame says otherwise.
  await page.mouse.move(1, 1);
  await settleFrames(page, 8);
}

/** Every settings control the client is reporting this frame. */
export async function controls(page: Page): Promise<Control[]> {
  return page.evaluate(() => (window.__mainMenu?.settingsControls ?? []).map((c) => ({ ...c })));
}

/** The control with this kind, or a failure that names what was on offer. */
export async function control(page: Page, kind: string): Promise<Control> {
  const all = await controls(page);
  const found = all.find((c) => c.kind === kind);
  expect(found, `the client reports a control named ${kind} (has: ${all.map((c) => c.kind).join(', ')})`).toBeTruthy();
  return found!;
}

/** Press a settings control by kind, with a real click at its own press point. */
export async function press(page: Page, kind: string): Promise<Control> {
  const c = await control(page, kind);
  await page.mouse.click(c.physicalCenter.x, c.physicalCenter.y);
  await page.mouse.move(1, 1);
  await settleFrames(page, 8);
  return c;
}

/** Tap a settings control with a real TOUCH press — the other half of "on
 *  pointer and on touch". A tap is not a click: it goes through the touch
 *  pipeline, and on touch there is no hover to fall back to. */
export async function tap(page: Page, kind: string): Promise<Control> {
  const c = await control(page, kind);
  await page.touchscreen.tap(c.physicalCenter.x, c.physicalCenter.y);
  await settleFrames(page, 8);
  return c;
}
