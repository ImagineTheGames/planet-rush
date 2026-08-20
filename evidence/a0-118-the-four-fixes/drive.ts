/**
 * evidence/a0-111-yesterday-with-eyes/drive.ts — reach yesterday's seven screens
 * the way a player reaches them. OWNER: QA Manager (a0-111).
 *
 * a0-96's method, kept through a0-99 and pointed at a new list: every press lands
 * at the physical point the CLIENT ITSELF says it drew that control at, never at
 * a hit-test seam and never at a "just set the state" method, and the readbacks
 * beside each frame are a CROSS-CHECK — where a readback and an image disagree
 * the image wins and the disagreement is the story.
 *
 * ── THE TWO BOOTS, AND WHY THERE ARE TWO ────────────────────────────────────
 * Both are the SAME production bundle (`npm run build` + `npm run preview`,
 * ./playwright.config.ts). They differ only in the query string:
 *
 *  - `?gate=0` — the FRONT DOOR. The menu, the doors, the join screens, the
 *    lobby, map select and the menu settings screen. These are the screens items
 *    2, 3 and 4 are about, and `?debug=1` cannot reach any of them: it skips the
 *    menu and the lobby entirely (`src/main.ts`, the harness contract).
 *  - `?debug=1` — straight into an offline match with the read-back seams
 *    installed (`__planetRush.layout`, `__endScreenStage`, `__oreHudStage`,
 *    `__onboardingStage`, `__viewStage`, `__minimapStage`). Items 1, 5, 6 and 7.
 *
 * Every manifest attestation names which boot its frame came from. A frame whose
 * boot is not stated is a frame that is quietly claiming to be both.
 *
 * ── THE BUILD STAMP ─────────────────────────────────────────────────────────
 * The brief asks for the build stamp to be visible, so NO capture here passes
 * `?freeze=1`: `src/main.ts` sets `buildBadge.visible = !flags.freeze`, so a
 * frozen frame is a frame with the stamp deliberately hidden. Everything below
 * runs against a live sim and wears its sha in the corner.
 */
import { expect, type Page } from '@playwright/test';
import { settleFrames } from '../../tests/mobile/render-settle';

export interface Point {
  readonly x: number;
  readonly y: number;
}
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export interface Control {
  readonly kind: string;
  readonly physicalCenter: Point;
  readonly physicalBounds?: Rect;
}
/** One settings row as the client reports it drawing it. */
export interface RowReport {
  readonly kind: string;
  readonly label: string;
  readonly value: string;
  readonly disabled?: boolean;
}
/** One layout-registry row: what the element is, and the rect it really occupied. */
export interface LayoutRow {
  readonly id: string;
  readonly anchor: { region: string; margin?: number };
  readonly bounds: Rect;
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
      play(): void;
    };
    __onlineMenu?: {
      visible: boolean;
      screen: string;
      status: string;
      error: string;
      notice: string;
      title: string;
      code: string;
      joinMode: string;
      browseRows: readonly Record<string, unknown>[];
      doorControls: readonly Control[];
      messageBounds: Rect;
      solo(): void;
    };
    __lobby?: {
      visible: boolean;
      room: string;
      online: boolean;
      you: number;
      isHost: boolean;
      humanCount: number;
      rush(): void;
    };
    __pauseStage?: {
      read(): {
        screen: string;
        open: boolean;
        simTicks: number;
        controls: Control[];
        ship: { x: number; y: number } | null;
      };
    };
    __planetRush?: {
      readonly layout?: readonly LayoutRow[];
      readonly viewport?: { width?: number; height?: number };
      coreHp?(player: number): number | null;
      damageCore?(player: number, amount: number): unknown;
    };
    __endScreenStage?: {
      eliminateLocal(): boolean;
      endMatch(): boolean;
      winLocal(): boolean;
      screen(): string;
      buttons(): string[];
      result(): { kind: string; headline: string; subhead: string } | null;
      summarySkip(): boolean;
      summary(): { done: boolean; buttonsLive: boolean } | null;
    };
    __oreHudStage?: {
      mine(ore: number): { cargo: number; cargoCap: number; banked: number } | null;
      dock(ore: number): { cargo: number; banked: number } | null;
      hold(): unknown;
      total(): number;
      readout(): { cargo: number; banked: number } | null;
    };
    __onboardingStage?: {
      prompt(): { visible: boolean; text: string; bounds: Rect } | null;
      device(): string;
      scheme(): string;
    };
    __viewStage?: {
      world(): { left: number; top: number; right: number; bottom: number; width: number; height: number };
      viewport(): { width: number; height: number };
    };
    __alarmStage?: { read(): { active: boolean; engagements: number; sounds: number } };
  }
}

/** The canvas origin in page space. The seams report canvas-local physical
 *  points; a real press adds this back (0,0 while the canvas fills the window —
 *  added anyway, so the harness does not depend on that staying true). */
export async function origin(page: Page): Promise<Point> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas bounding box');
  return { x: box.x, y: box.y };
}

/** Park the pointer off every affordance. A mouse left where a control was would
 *  HOVER it, and a hovered plate is a brighter plate — so unless a frame says
 *  otherwise, these frames are the screen AT REST. */
export async function park(page: Page): Promise<void> {
  await page.mouse.move(1, 1);
  await settleFrames(page, 8);
}

/**
 * The topmost DOM element at a physical page point — a0-96's finding tool, kept
 * verbatim in shape. The pause DONE plate was unpressable because a DOM button at
 * the maximum z-index sat over the canvas at DONE's own centre, and the frame
 * alone could only show that the word was hidden. `document.elementFromPoint` is
 * the browser's own answer to "who gets this press", so it is recorded beside
 * every press below. `isCanvas: true` means the press reaches the game.
 */
export async function topmostAt(page: Page, x: number, y: number): Promise<{
  tag: string;
  id: string;
  cls: string;
  text: string;
  zIndex: string;
  isCanvas: boolean;
}> {
  return page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px as number, py as number);
    if (!el) return { tag: '(none)', id: '', cls: '', text: '', zIndex: '', isCanvas: false };
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id ?? '',
      cls: typeof el.className === 'string' ? el.className : '',
      text: (el.textContent ?? '').trim().slice(0, 60),
      zIndex: cs.zIndex,
      isCanvas: el.tagName.toLowerCase() === 'canvas',
    };
  }, [x, y]);
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

/** Boot `?debug=1` — straight into an offline match, seams installed. */
export async function bootDebugMatch(page: Page, query = '?debug=1'): Promise<void> {
  await page.goto(`/${query}`);
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__oreHudStage?.mine === 'function', undefined, { timeout: 30_000 });
  await page.evaluate(() => (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready);
  await settleFrames(page, 8);
}

/** A real press at a physical page point: a tap on the touch profile, a click
 *  otherwise. Returns the point, so a note can STATE the coordinate. */
export async function pressAt(page: Page, p: Point, touch: boolean): Promise<Point> {
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
  await park(page);
  return p;
}

/** Where the client says it drew a named control on one of the seams. */
export async function controlPoint(
  page: Page,
  source: 'menu' | 'settings' | 'doors' | 'pause',
  kind: string,
): Promise<{ point: Point | null; kinds: string[] }> {
  const o = await origin(page);
  const found = await page.evaluate(
    ([src, k]) => {
      const all: Control[] =
        src === 'menu'
          ? (window.__mainMenu?.controls ?? [])
          : src === 'settings'
            ? (window.__mainMenu?.settingsControls ?? [])
            : src === 'doors'
              ? ((window.__onlineMenu?.doorControls ?? []) as Control[])
              : (window.__pauseStage?.read().controls ?? []);
      const hit = all.find((x) => x.kind === k);
      return { point: hit ? { ...hit.physicalCenter } : null, kinds: all.map((x) => x.kind) };
    },
    [source, kind] as const,
  );
  return {
    point: found.point ? { x: o.x + found.point.x, y: o.y + found.point.y } : null,
    kinds: found.kinds,
  };
}

/** Press a named control where the client says it drew it, and report both the
 *  coordinate and who the browser says would receive that press. */
export async function pressControl(
  page: Page,
  source: 'menu' | 'settings' | 'doors' | 'pause',
  kind: string,
  touch: boolean,
): Promise<{ point: Point; topmost: Awaited<ReturnType<typeof topmostAt>> }> {
  const found = await controlPoint(page, source, kind);
  expect(found.point, `the ${source} screen reports a control named ${kind} (has: ${found.kinds.join(', ')})`).not.toBeNull();
  const topmost = await topmostAt(page, found.point!.x, found.point!.y);
  await pressAt(page, found.point!, touch);
  return { point: found.point!, topmost };
}

/** Every positioned element's declared anchor and ACTUAL drawn rect this frame
 *  (`?debug=1` only). */
export async function layoutRows(page: Page): Promise<LayoutRow[]> {
  return page.evaluate(() =>
    (window.__planetRush?.layout ?? []).map((e) => ({ id: e.id, anchor: { ...e.anchor }, bounds: { ...e.bounds } })),
  );
}

/** The whole of `localStorage`, so a "before and after" is the real store rather
 *  than a seam's opinion of it. */
export async function storage(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const out: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) out[k] = localStorage.getItem(k) ?? '';
    }
    return out;
  });
}

/** The settings rows the menu says it is drawing, this frame. */
export async function menuRows(page: Page): Promise<RowReport[]> {
  return page.evaluate(() => (window.__mainMenu?.settingsRows ?? []).map((r) => ({ ...r })));
}
