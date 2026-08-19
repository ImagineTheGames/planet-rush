/**
 * evidence/a0-96-settings-screen/drive.ts — reach both settings screens the way a
 * player reaches them. OWNER: QA Manager (a0-96).
 *
 * Every press below lands at the physical point the CLIENT ITSELF says it drew
 * that control at (`__mainMenu.settingsControls` / `__pauseStage.read().controls`,
 * both already through the landscape-lock remap) — never a hit-test seam, never a
 * "just set the state" method. The brief exists because four briefs shipped on
 * green CI without anything with eyes on the screen; a capture that reached the
 * screen through a back door would be the same mistake in a new costume.
 *
 * The one seam this file DOES read is `settingsRows` (label + value, straight off
 * the model the view is drawing). It is written to a readback file beside the
 * frames as a CROSS-CHECK, never as the finding: the manifest attestation says
 * what the image shows, and where the readback and the image ever disagreed the
 * image would win and the disagreement would be the story.
 */
import { expect, type Page } from '@playwright/test';
import { settleFrames } from '../../tests/mobile/render-settle';

export interface Point {
  readonly x: number;
  readonly y: number;
}
export interface Control {
  readonly kind: string;
  readonly physicalCenter: Point;
}
/** One settings row as the client reports it drawing it. */
export interface RowReport {
  readonly kind: string;
  readonly label: string;
  readonly value: string;
}

declare global {
  interface Window {
    __mainMenu?: {
      visible: boolean;
      screen: string;
      matchStarted: boolean;
      controls: Control[];
      settingsControls: Control[];
      settingsRows: RowReport[];
      settingsHelpTitle: string;
      controlScheme: string;
      matchControlScheme: string | null;
      play(): void;
    };
    __onlineMenu?: { solo(): void };
    __lobby?: { rush(): void };
    __pauseStage?: {
      read(): {
        screen: string;
        open: boolean;
        pausable: boolean;
        frozen: boolean;
        simTicks: number;
        controls: Control[];
        buttonPoint: Point;
      };
    };
  }
}

/** The canvas origin in page space. The seams report canvas-local physical
 *  points, so a real press adds this back (it is 0,0 while the canvas fills the
 *  window — added anyway, so the harness does not depend on that staying true). */
async function origin(page: Page): Promise<Point> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas bounding box');
  return { x: box.x, y: box.y };
}

/** Boot to the real main menu, past the title gate. */
export async function bootMenu(page: Page, query = '?gate=0'): Promise<void> {
  await page.goto(`/${query}`);
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => !!window.__mainMenu?.visible && window.__mainMenu.controls.length > 0, undefined, {
    timeout: 30_000,
  });
  await page.evaluate(() => (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready);
  await settleFrames(page, 8);
}

/** Press SETTINGS on the menu; wait until the screen says it is up. */
export async function openMenuSettings(page: Page): Promise<void> {
  const o = await origin(page);
  const p = await page.evaluate(() => {
    const c = window.__mainMenu?.controls.find((k) => k.kind === 'settings');
    return c ? { ...c.physicalCenter } : null;
  });
  expect(p, 'the menu reports where SETTINGS is drawn').not.toBeNull();
  await page.mouse.click(o.x + p!.x, o.y + p!.y);
  await page.waitForFunction(() => window.__mainMenu?.screen === 'settings', undefined, { timeout: 20_000 });
  await park(page);
}

/** Park the pointer off every plate. A mouse left where a control was would hover
 *  it, and a hovered plate is a brighter plate: unless a frame says otherwise,
 *  these frames are the screen AT REST. */
export async function park(page: Page): Promise<void> {
  await page.mouse.move(1, 1);
  await settleFrames(page, 8);
}

/** Press a MENU settings control by kind (`fireMode`, `controls`, `reduceVfx`,
 *  `minus:volume:master`, `help:controls`, `back`, …) with a real press at the
 *  point the client drew it — a tap on the touch profiles, a click otherwise. */
export async function pressMenu(page: Page, kind: string, touch: boolean): Promise<void> {
  const o = await origin(page);
  const p = await page.evaluate((k) => {
    const all = window.__mainMenu?.settingsControls ?? [];
    const c = all.find((x) => x.kind === k);
    return c ? { point: { ...c.physicalCenter }, kinds: all.map((x) => x.kind) } : { point: null, kinds: all.map((x) => x.kind) };
  }, kind);
  expect(p.point, `the settings screen reports a control named ${kind} (has: ${p.kinds.join(', ')})`).not.toBeNull();
  if (touch) await page.touchscreen.tap(o.x + p.point!.x, o.y + p.point!.y);
  else await page.mouse.click(o.x + p.point!.x, o.y + p.point!.y);
  await park(page);
}

/** What the MENU settings screen says its rows are, this frame. */
export async function menuRows(page: Page): Promise<RowReport[]> {
  return page.evaluate(() => (window.__mainMenu?.settingsRows ?? []).map((r) => ({ ...r })));
}

/** Boot through the FRONT DOOR into a live offline match: PLAY → PLAY SOLO →
 *  RUSH. The match reads its settings from storage at boot, which is exactly the
 *  wire a0-92 built and exactly what a debug boot would skip. */
export async function bootMatchFrontDoor(page: Page): Promise<void> {
  await page.evaluate(() => window.__mainMenu!.play());
  await page.waitForFunction(() => typeof window.__onlineMenu?.solo === 'function', undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__onlineMenu!.solo());
  await page.waitForFunction(() => typeof window.__lobby?.rush === 'function', undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__lobby!.rush());
  await page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__pauseStage?.read === 'function', undefined, { timeout: 30_000 });
  await page.waitForFunction(() => window.__pauseStage!.read().simTicks > 5, undefined, { timeout: 30_000 });
  await settleFrames(page, 8);
}

/** Real ESC → the pause overlay → SETTINGS. */
export async function openPauseSettings(page: Page, touch: boolean): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__pauseStage!.read().screen === 'menu', undefined, { timeout: 20_000 });
  await pressPause(page, 'settings', touch);
  await page.waitForFunction(() => window.__pauseStage!.read().screen === 'settings', undefined, { timeout: 20_000 });
  await park(page);
}

/** Press a PAUSE control by kind at the point the client drew it. */
export async function pressPause(page: Page, kind: string, touch: boolean): Promise<void> {
  const o = await origin(page);
  const p = await page.evaluate((k) => {
    const all = window.__pauseStage!.read().controls;
    const hit = all.filter((x) => x.kind === k);
    return { point: hit[0] ? { ...hit[0].physicalCenter } : null, kinds: all.map((x) => x.kind) };
  }, kind);
  expect(p.point, `the pause overlay reports a control named ${kind} (has: ${p.kinds.join(', ')})`).not.toBeNull();
  if (touch) await page.touchscreen.tap(o.x + p.point!.x, o.y + p.point!.y);
  else await page.mouse.click(o.x + p.point!.x, o.y + p.point!.y);
  await park(page);
}
