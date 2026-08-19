/**
 * evidence/a0-99-wheel-and-hud/drive.ts — reach the build wheel and the match HUD.
 * OWNER: QA Manager (a0-99).
 *
 * a0-96's method, unchanged, pointed at two new screens: every press lands at
 * the physical point the CLIENT ITSELF says it drew that control at, never at a
 * hit-test seam and never at a "just set the state" method, and the readbacks
 * beside each frame are a CROSS-CHECK — where a readback and an image ever
 * disagree the image wins and the disagreement is the story.
 *
 * ── THE TWO BOOTS, AND WHY THERE ARE TWO ────────────────────────────────────
 * Both are the SAME production bundle (`npm run build` + `npm run preview`,
 * ./playwright.config.ts). They differ only in the query string, and each can
 * prove something the other cannot:
 *
 *  - {@link bootMatchFrontDoor} — `/?gate=0` → PLAY → PLAY SOLO → RUSH. The
 *    match a player actually gets, with the menu's settings behind it and the
 *    match's own DOM overlays on top. This is the only boot that can show what
 *    is layered over the HUD, because `?debug=1` never passes through the front
 *    door where those overlays are decided (a0-96/a0-97's whole finding lived
 *    in exactly that gap). It has NO wheel seam: what it proves, it proves in
 *    pixels and in {@link topmostAt}.
 *  - {@link bootDebugMatch} — `/?debug=1`. Drops straight into an offline match
 *    with no menu, and installs the read-back seams `__pressStage` (what the
 *    view DREW on each wedge, and where it drew it) and `window.__planetRush.layout`
 *    (every positioned element's declared anchor and actual rendered rect). This
 *    is the boot that can answer "where does the client think each segment is",
 *    which is the coordinate the brief asks every press to land on.
 *
 * Every manifest attestation names which boot its frame came from. A frame whose
 * boot is not stated is a frame that is quietly claiming to be both.
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
}
/** One Build wedge exactly as the shipped view drew it this frame. */
export interface DrawnWedge {
  readonly label: string;
  readonly target?: string;
  readonly costLabel?: string;
  readonly capLabel?: string;
  readonly costPaint?: string;
  readonly selected?: boolean;
  readonly affordable?: boolean;
  readonly [k: string]: unknown;
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
        online: boolean;
        ship: { x: number; y: number; vx: number; vy: number } | null;
        controls: Control[];
        buttonPoint: Point;
      };
    };
    __pressStage?: {
      openBuild(ore?: number): { open: boolean; banked: number } | null;
      wedges(): DrawnWedge[];
      wedgeClientPoint(i: number): Point | null;
      clientPoint(x: number, y: number): Point;
      logicalViewport(): { width: number; height: number };
      setOre(ore: number): number | null;
      bank(): number | null;
    };
    __planetRush?: {
      /** A GETTER (not a method): the frozen entry array as of this frame. */
      readonly layout?: readonly LayoutRow[];
      placement?(opts?: { tolerance?: number }): Array<{ id: string; ok: boolean }>;
      readonly viewport?: { width?: number; height?: number };
    };
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

/** Park the pointer off every affordance. A mouse left where a wedge was would
 *  HOVER it, and a hovered wedge is a selected wedge — so unless a frame says
 *  otherwise, these frames are the screen AT REST. */
export async function park(page: Page): Promise<void> {
  await page.mouse.move(1, 1);
  await settleFrames(page, 8);
}

/**
 * The topmost DOM element at a physical page point — a0-96's finding tool, kept
 * verbatim in shape. The pause DONE plate was unpressable because a DOM button
 * at the maximum z-index sat over the canvas at DONE's own centre, and the frame
 * alone could only show that the word was hidden. `document.elementFromPoint`
 * is the browser's own answer to "who gets this press", so it is the answer
 * recorded beside every control point below.
 *
 * `isCanvas: true` means the press reaches the game. Anything else names the
 * element that is going to eat it instead.
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

/** Boot through the FRONT DOOR into a live offline match: PLAY → PLAY SOLO →
 *  RUSH — a0-96's path, unchanged. */
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

/** Boot `?debug=1` — straight into an offline match, with the wheel and layout
 *  seams installed. Same production bundle; only the query string differs. */
export async function bootDebugMatch(page: Page, query = '?debug=1'): Promise<void> {
  await page.goto(`/${query}`);
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__pressStage?.wedges === 'function', undefined, { timeout: 30_000 });
  await page.evaluate(() => (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready);
  await settleFrames(page, 8);
}

/** What the shipped view drew on the five Build wedges this frame. */
export async function wedges(page: Page): Promise<DrawnWedge[]> {
  return page.evaluate(() => (window.__pressStage?.wedges() ?? []).map((w) => ({ ...w })));
}

/** Every positioned element's declared anchor and ACTUAL drawn rect this frame
 *  (`?debug=1` only). The HUD half of the brief — "anything drawn over anything
 *  else" — is a question about these rectangles. */
export async function layoutRows(page: Page): Promise<LayoutRow[]> {
  return page.evaluate(() => {
    const l = window.__planetRush?.layout;
    if (!l) return [];
    return l.map((e) => ({ id: e.id, anchor: { ...e.anchor }, bounds: { ...e.bounds } }));
  });
}

/** Press wedge `i` where `__pressStage` says the view drew it: a real tap on the
 *  touch profile, a real click otherwise. Returns the page point pressed, so the
 *  manifest can state the coordinate rather than describe it. */
export async function pressWedge(page: Page, i: number, touch: boolean): Promise<Point> {
  const p = await page.evaluate((k) => {
    const c = window.__pressStage!.wedgeClientPoint(k);
    return c ? { ...c } : null;
  }, i);
  expect(p, `the client reports where it drew Build wedge ${i}`).not.toBeNull();
  if (touch) await page.touchscreen.tap(p!.x, p!.y);
  else await page.mouse.click(p!.x, p!.y);
  await settleFrames(page, 8);
  return p!;
}

/** Move a real cursor onto wedge `i` (desktop hover — the shipped `pointermove`
 *  route) without pressing, and leave it there. */
export async function hoverWedge(page: Page, i: number): Promise<Point> {
  const p = await page.evaluate((k) => {
    const c = window.__pressStage!.wedgeClientPoint(k);
    return c ? { ...c } : null;
  }, i);
  expect(p, `the client reports where it drew Build wedge ${i}`).not.toBeNull();
  await page.mouse.move(p!.x, p!.y);
  await settleFrames(page, 8);
  return p!;
}
