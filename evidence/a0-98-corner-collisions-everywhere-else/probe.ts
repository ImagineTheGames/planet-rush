/**
 * evidence/a0-98-corner-collisions-everywhere-else/probe.ts — OWNER: UI Engineer (a0-98).
 *
 * The one question this whole capture asks, in one place: **at the point the
 * client itself says it drew a control, what would a real press actually hit?**
 *
 * `document.elementFromPoint` is the answer, and it is the answer for the reason
 * a0-97 gave and a0-28 proved the hard way: z-index does not decide this on its
 * own. The DOWNLOAD LOG affordance carries `z-index:2147483647`, the largest the
 * platform has, and was still painted UNDER a fullscreen element's `::backdrop`
 * for a whole milestone. Reasoning about the stack from source has already been
 * wrong here. Asking the browser cannot be.
 *
 * Three helpers:
 *
 *  - {@link harvestCanvasControls} — every control the client reports drawing,
 *    harvested GENERICALLY. It walks the live-stage seams and collects any object
 *    carrying a `physicalCenter`, whatever seam it came from and whatever that
 *    seam calls it. Deliberately not a hand-written list of kinds: a hand-written
 *    list finds only the controls whoever wrote it thought of, and this brief
 *    exists because a0-97's sweep was scoped to the screens its brief named.
 *  - {@link harvestDomControls} — the same for the controls that are DOM rather
 *    than canvas: the boot-error RETRY, and the CONNECTION LOST card's RECONNECT /
 *    ABANDON MATCH / BACK TO MENU (`src/net/link-loss-view`).
 *  - {@link topmostAt} — the browser's own verdict at a page point, named the way
 *    a report can use it.
 *
 * Nothing here asserts. The capture is the finding; the assertions live in
 * `src/net/playtest-log-button.test.ts`.
 */
import type { Page } from '@playwright/test';

/** The affordance under investigation (`src/net/playtest-log-button`). */
export const LOG_ROOT_ID = 'playtest-download-log';
export const LOG_BUTTON_ID = 'playtest-download-log-button';

/** The CONNECTION LOST card's own ids (`src/net/link-loss-view`), and the boot
 *  screen's (`@platform/boot-error`). Spelled out rather than imported so a rename
 *  shows up here as a control that stopped being found. */
export const DOM_CONTROL_IDS: readonly string[] = [
  'boot-error-retry',
  'pr-link-loss-reconnect',
  'pr-link-loss-abandon',
  'pr-link-loss-menu',
];

/** A rect in page space. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One control, and what is on top of it. */
export interface Cover {
  /** Where it came from and what it is — `__lobby.rushControl`, `hud:minimap`, … */
  readonly control: string;
  /** The page point that was probed. */
  readonly page: { x: number; y: number };
  /** `CANVAS` means the game got the press. Anything else names what took it. */
  readonly topmost: string;
  /** Whether the client would route a press here at all. Drawn-but-dead elements
   *  (the HUD under an open pause overlay) are recorded and marked, never counted:
   *  chrome over something nobody can press is not the defect. */
  readonly live: boolean;
  /** False when the reported point is outside the viewport — the boot screen's
   *  RETRY is below the fold on a short phone. Not a collision, and not a clean
   *  bill of health either: a cell the probe could not reach. */
  readonly onScreen: boolean;
  /** True when the topmost element is the log affordance — a proved collision.
   *  The brief's definition, and a0-97's: the topmost element at the control's own
   *  reported point. */
  readonly collides: boolean;
  /** The control's own box in page space, where the seam reports one. */
  readonly box: Box | null;
  /** How much of that box the offer's own box sits on, 0–1. Reported beside
   *  {@link collides} because the two answer different questions: a minimap whose
   *  centre is clear and whose bottom third is buried is not "fine", and a table
   *  that showed only the centre would say it was. */
  readonly coveredFraction: number | null;
}

/** The log affordance's own state, as the page has it. */
export interface LogBox {
  readonly mounted: boolean;
  readonly hidden?: boolean;
  readonly rect?: { x: number; y: number; width: number; height: number };
  readonly label?: string;
  readonly hint?: string;
}

/** One state's whole finding: what the offer was doing, and what it was on. */
export interface StateReport {
  readonly state: string;
  readonly profile: string;
  readonly viewport: { width: number; height: number; dpr: number; touch: boolean };
  readonly log: LogBox;
  readonly controls: readonly Cover[];
  readonly collisions: readonly Cover[];
  /** Drawn under the offer but not pressable on this screen — recorded so the
   *  table can distinguish "nothing was covered" from "nothing live was". */
  readonly coveredButDead: readonly Cover[];
  /** Free-form context the state wants on the record (session state, screen, …). */
  readonly context?: Record<string, unknown>;
}

/**
 * Every canvas control the client reports drawing **on the screen that is up right
 * now** — returned as canvas-local physical points, the space every seam speaks.
 *
 * Two rules, and both were learned from a bad first run:
 *
 *  1. **Only what is on screen.** `__mainMenu` reports `settingsControls`,
 *     `codexControls` and `hangarControls` at all times, whatever screen is
 *     actually up, and the first pass of this capture duly "found" the connect
 *     panel sitting on a volume `?` that nobody was drawing. A control the client
 *     is not painting cannot be covered, and reporting it as covered is worse than
 *     reporting nothing. So each seam's list is gated on that seam's own
 *     `visible`/`screen`.
 *  2. **Drawn is not the same as live.** While the pause overlay is up, `main.ts`
 *     `pointerdown` consumes every press before the match sees it — *"a tap lands
 *     on a pause control or on nothing, but never falls through to the frozen
 *     match under it"*. The minimap keeps being DRAWN under that overlay, and it
 *     is not a control there. Each row carries `live` so the table can say which
 *     it is instead of quietly counting one as the other.
 *
 * Beyond that the walk is structural: anything with a numeric `physicalCenter.x/y`
 * is a control, named by its path plus whichever of `kind` / `id` / `door` /
 * `owner` / `index` it carries. Deliberately not a hand-written list of kinds — a
 * hand-written list finds only the controls whoever wrote it thought of, and this
 * brief exists because a0-97's sweep was scoped to the screens its brief named.
 *
 * `__cornerStage` (a0-98, `main.ts` `installCornerStage`) contributes the drawn
 * HUD — the minimap, the fire button, the controls strip — which is the half no
 * other seam reports and the half the disconnect case is about.
 */
export async function harvestCanvasControls(
  page: Page,
): Promise<{ control: string; x: number; y: number; live: boolean; box: Box | null }[]> {
  return page.evaluate(() => {
    type Anon = Record<string, unknown>;
    const w = window as unknown as Anon;

    /** Each root, with whether the screen it belongs to is the one being drawn. */
    const roots: { name: string; node: unknown; live: boolean }[] = [];

    const menu = w.__mainMenu as
      | { visible?: boolean; screen?: string; matchStarted?: boolean; [k: string]: unknown }
      | undefined;
    if (menu?.visible) {
      const on = (screen: string): boolean => menu.screen === screen;
      if (on('menu')) roots.push({ name: '__mainMenu.controls', node: menu.controls, live: true });
      if (on('settings')) roots.push({ name: '__mainMenu.settingsControls', node: menu.settingsControls, live: true });
      if (on('codex')) roots.push({ name: '__mainMenu.codexControls', node: menu.codexControls, live: true });
      if (on('hangar')) roots.push({ name: '__mainMenu.hangarControls', node: menu.hangarControls, live: true });
    }

    const doors = w.__onlineMenu as { visible?: boolean; [k: string]: unknown } | undefined;
    if (doors?.visible) {
      roots.push({ name: '__onlineMenu.doorControls', node: doors.doorControls, live: true });
      roots.push({ name: '__onlineMenu.browseRows', node: doors.browseRows, live: true });
    }

    const lobby = w.__lobby as { visible?: boolean; [k: string]: unknown } | undefined;
    if (lobby?.visible) roots.push({ name: '__lobby', node: lobby, live: true });

    // The pause overlay's own controls — an empty list while it is closed.
    let pauseOpen = false;
    const pause = w.__pauseStage as { read?: () => { open: boolean; controls: unknown } } | undefined;
    if (pause && typeof pause.read === 'function') {
      try {
        const read = pause.read();
        pauseOpen = read.open;
        roots.push({ name: '__pauseStage.controls', node: read.controls, live: true });
      } catch {
        /* a seam that cannot read this frame contributes nothing */
      }
    }

    // …and everything the frame actually drew. Live only while the match owns the
    // pointer: with the overlay up these are painted, not pressable.
    const corner = w.__cornerStage as { read?: () => { elements: unknown } } | undefined;
    if (corner && typeof corner.read === 'function') {
      try {
        roots.push({ name: '__cornerStage.elements', node: corner.read().elements, live: !pauseOpen });
      } catch {
        /* likewise */
      }
    }

    const out: { control: string; x: number; y: number; live: boolean; box: Box | null }[] = [];
    const seen = new Set<unknown>();

    const label = (path: string, node: Anon): string => {
      const bits: string[] = [];
      for (const key of ['kind', 'id', 'door', 'owner', 'index']) {
        const v = node[key];
        if (typeof v === 'string' && v !== '') bits.push(v);
        else if (typeof v === 'number') bits.push(String(v));
      }
      return bits.length > 0 ? `${path}<${bits.join(':')}>` : path;
    };

    const walk = (path: string, node: unknown, depth: number, live: boolean): void => {
      if (node === null || typeof node !== 'object' || depth > 7) return;
      if (seen.has(node)) return;
      seen.add(node);

      const rec = node as Anon;
      const pc = rec.physicalCenter as { x?: unknown; y?: unknown } | undefined;
      if (pc && typeof pc.x === 'number' && typeof pc.y === 'number') {
        const box = (rec.physicalBounds ?? rec.logicalBounds ?? rec.logical) as
          | { width?: unknown; height?: unknown }
          | undefined;
        const drawn =
          !box ||
          typeof box.width !== 'number' ||
          typeof box.height !== 'number' ||
          (box.width > 0 && box.height > 0);
        // A control at the origin with no box is the seams' "nowhere" rect.
        if (drawn && (pc.x !== 0 || pc.y !== 0)) {
          const b = rec.physicalBounds as Box | undefined;
          out.push({
            control: label(path, rec),
            x: pc.x,
            y: pc.y,
            live,
            box: b && typeof b.width === 'number' ? { x: b.x, y: b.y, width: b.width, height: b.height } : null,
          });
        }
      }

      if (Array.isArray(node)) {
        node.forEach((v, i) => walk(`${path}[${i}]`, v, depth + 1, live));
        return;
      }
      for (const key of Object.keys(rec)) {
        if (key === 'physicalCenter' || key === 'physicalBounds') continue;
        if (key === 'logical' || key === 'logicalBounds' || key === 'joinBounds') continue;
        const v = rec[key];
        if (v !== null && typeof v === 'object') walk(`${path}.${key}`, v, depth + 1, live);
      }
    };

    for (const root of roots) walk(root.name, root.node, 0, root.live);
    return out;
  });
}

/**
 * The DOM controls on screen right now, **measured and probed in the same turn**.
 *
 * One `evaluate`, not two, and that is a correctness fix rather than a saving. The
 * CONNECTION LOST card ticks a grace countdown ON the RECONNECT button's own label
 * (`src/net/link-loss` `reconnectLabel`), so the card re-renders about once a
 * second and its buttons shift under a flex row as the label's width changes. A
 * harvest-then-probe pass therefore reports the box from one layout and the
 * topmost element from the next, and the first online run of this capture duly
 * showed both of the card's buttons "covered" — by the card that contains them.
 * Rect and hit-test have to come from the same frame or they are not about the
 * same button.
 */
export async function harvestAndProbeDomControls(
  page: Page,
  ids: readonly string[] = DOM_CONTROL_IDS,
): Promise<Omit<Cover, 'coveredFraction'>[]> {
  return page.evaluate((wanted) => {
    const out: Omit<Cover, 'coveredFraction'>[] = [];
    for (const id of wanted) {
      const el = document.getElementById(id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      // Outside the viewport there is nothing to hit-test against, and
      // `elementFromPoint` answers null there — which must be recorded as a cell the
      // probe could not reach, NOT as a clear one. The boot-error RETRY starts below
      // the fold on a 798x384 phone, and the first pass of this table called that
      // "clear": the exact false all-clear this capture exists to avoid.
      const onScreen = x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight;
      const hit = onScreen ? document.elementFromPoint(x, y) : null;
      let named = 'nothing';
      if (hit) {
        let owner = '';
        for (let n: Element | null = hit; n; n = n.parentElement) {
          if (n.id) {
            owner = n.id;
            break;
          }
        }
        named = owner ? `${hit.tagName}#${owner}` : hit.tagName;
      }
      out.push({
        control: `dom#${id}`,
        page: { x: Math.round(x), y: Math.round(y) },
        topmost: onScreen ? named : 'off-viewport',
        live: true,
        onScreen,
        collides: named.includes('playtest-download-log'),
        box: { x: r.x, y: r.y, width: r.width, height: r.height },
      });
    }
    return out;
  }, ids);
}

/**
 * What the browser says is on top at a page point, named the way a report can use
 * it: the tag plus the id of the nearest identified ancestor. `CANVAS` means the
 * game got the press. a0-97's naming, verbatim, so the two tables read as one.
 */
export async function topmostAt(page: Page, x: number, y: number): Promise<string> {
  return page.evaluate(
    ({ px, py }) => {
      const el = document.elementFromPoint(px, py);
      if (!el) return 'nothing';
      let id = '';
      for (let n: Element | null = el; n; n = n.parentElement) {
        if (n.id) {
          id = n.id;
          break;
        }
      }
      return id ? `${el.tagName}#${id}` : el.tagName;
    },
    { px: x, py: y },
  );
}

/** Where the DOM log affordance is, if it is on screen at all. */
export async function logBox(page: Page): Promise<LogBox> {
  return page.evaluate(
    ({ rootId, buttonId }) => {
      const root = document.getElementById(rootId);
      if (!root) return { mounted: false };
      const r = root.getBoundingClientRect();
      return {
        mounted: true,
        hidden: root.hidden,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        label: document.getElementById(buttonId)?.textContent ?? '',
        hint: document.getElementById('playtest-download-log-hint')?.textContent ?? '',
      };
    },
    { rootId: LOG_ROOT_ID, buttonId: LOG_BUTTON_ID },
  );
}

/**
 * The canvas origin in page space — the seams report canvas-local physical
 * points, so a real probe adds this back. Zero while the canvas fills the window;
 * added anyway, so nothing here depends on that staying true.
 *
 * `count()` first, and that is not defensiveness: **the boot-failure screen has no
 * canvas at all** (`@platform/boot-error` writes over `#app`), and a bare
 * `boundingBox()` on a locator that matches nothing waits for an element that is
 * never coming. The first run of this capture hung there for the full ten minutes
 * and reported not one row.
 */
export async function canvasOrigin(page: Page): Promise<{ x: number; y: number }> {
  if ((await page.locator('canvas').count()) === 0) return { x: 0, y: 0 };
  const box = await page.locator('canvas').boundingBox({ timeout: 10_000 }).catch(() => null);
  return box ? { x: box.x, y: box.y } : { x: 0, y: 0 };
}

/**
 * The whole sweep for one state: harvest every control the client says it drew,
 * ask the browser what is on top of each, and record the log affordance's own
 * state beside it.
 *
 * A collision is `topmost` naming the log affordance — the brief's own definition,
 * and the reason the probe is a browser question rather than a rect intersection:
 * an element can overlap a control and still not take the press.
 */
export async function sweepState(
  page: Page,
  state: string,
  profile: { id: string; width: number; height: number; dpr: number; touch: boolean },
  context?: Record<string, unknown>,
): Promise<StateReport> {
  const origin = await canvasOrigin(page);
  const canvas = (await harvestCanvasControls(page)).map((c) => ({
    control: c.control,
    x: origin.x + c.x,
    y: origin.y + c.y,
    live: c.live,
    box: c.box ? { ...c.box, x: c.box.x + origin.x, y: c.box.y + origin.y } : null,
  }));
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  const offer = await logBox(page);
  const offerBox = offer.mounted && offer.hidden === false ? (offer.rect ?? null) : null;
  const covers: Cover[] = [];
  for (const c of canvas) {
    const onScreen = c.x >= 0 && c.y >= 0 && c.x <= viewport.width && c.y <= viewport.height;
    const topmost = onScreen ? await topmostAt(page, c.x, c.y) : 'off-viewport';
    covers.push({
      control: c.control,
      page: { x: Math.round(c.x), y: Math.round(c.y) },
      topmost,
      live: c.live,
      onScreen,
      collides: c.live && (topmost.includes(LOG_ROOT_ID) || topmost.includes(LOG_BUTTON_ID)),
      box: c.box,
      coveredFraction: c.box && offerBox ? overlapFraction(c.box, offerBox) : null,
    });
  }
  // The DOM half, rect and hit-test taken together (see the helper's note).
  for (const d of await harvestAndProbeDomControls(page)) {
    covers.push({ ...d, coveredFraction: d.box && offerBox ? overlapFraction(d.box, offerBox) : null });
  }
  return {
    state,
    profile: profile.id,
    viewport: { width: profile.width, height: profile.height, dpr: profile.dpr, touch: profile.touch },
    log: offer,
    controls: covers,
    collisions: covers.filter((c) => c.collides),
    coveredButDead: covers.filter(
      (c) => !c.live && (c.topmost.includes(LOG_ROOT_ID) || c.topmost.includes(LOG_BUTTON_ID)),
    ),
    context,
  };
}

/** What fraction of `box` the `over` rect sits on. Plain geometry, reported as
 *  context beside the browser's own verdict — never in place of it. */
function overlapFraction(box: Box, over: Box): number {
  const w = Math.max(0, Math.min(box.x + box.width, over.x + over.width) - Math.max(box.x, over.x));
  const h = Math.max(0, Math.min(box.y + box.height, over.y + over.height) - Math.max(box.y, over.y));
  const area = box.width * box.height;
  return area > 0 ? Math.round(((w * h) / area) * 100) / 100 : 0;
}
