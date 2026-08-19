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

/** One control, and what is on top of it. */
export interface Cover {
  /** Where it came from and what it is — `__lobby.rushControl`, `hud:minimap`, … */
  readonly control: string;
  /** The page point that was probed. */
  readonly page: { x: number; y: number };
  /** `CANVAS` means the game got the press. Anything else names what took it. */
  readonly topmost: string;
  /** True when the topmost element is the log affordance — a proved collision. */
  readonly collides: boolean;
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
  /** Free-form context the state wants on the record (session state, screen, …). */
  readonly context?: Record<string, unknown>;
}

/**
 * Every canvas control the client reports drawing, right now, from every
 * live-stage seam on the page — returned as **canvas-local physical points**, the
 * space every one of those seams speaks.
 *
 * The walk is structural: anything with a numeric `physicalCenter.x/y` is a
 * control, named by its path plus whichever of `kind` / `id` / `door` / `owner` /
 * `index` it carries. `__cornerStage` (a0-98, `main.ts` `installCornerStage`)
 * contributes the drawn HUD — the minimap, the fire button, the controls strip —
 * which is the half no other seam reports and the half the disconnect case is
 * about.
 *
 * Zero-size rects are dropped: the seams report a `nowhere` rect for a control the
 * current screen does not draw, and a press at (0,0) is not a finding about a
 * corner.
 */
export async function harvestCanvasControls(
  page: Page,
): Promise<{ control: string; x: number; y: number }[]> {
  return page.evaluate(() => {
    type Anon = Record<string, unknown>;
    const w = window as unknown as Anon;
    const roots: Record<string, unknown> = {};
    for (const name of ['__mainMenu', '__onlineMenu', '__lobby']) {
      if (w[name]) roots[name] = w[name];
    }
    for (const name of ['__pauseStage', '__cornerStage']) {
      const seam = w[name] as { read?: () => unknown } | undefined;
      if (seam && typeof seam.read === 'function') {
        try {
          roots[name] = seam.read();
        } catch {
          // A seam that cannot read this frame simply contributes nothing.
        }
      }
    }

    const out: { control: string; x: number; y: number }[] = [];
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

    const walk = (path: string, node: unknown, depth: number): void => {
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
          out.push({ control: label(path, rec), x: pc.x, y: pc.y });
        }
      }

      if (Array.isArray(node)) {
        node.forEach((v, i) => walk(`${path}[${i}]`, v, depth + 1));
        return;
      }
      for (const key of Object.keys(rec)) {
        if (key === 'physicalCenter' || key === 'physicalBounds') continue;
        if (key === 'logical' || key === 'logicalBounds' || key === 'joinBounds') continue;
        const v = rec[key];
        if (v !== null && typeof v === 'object') walk(`${path}.${key}`, v, depth + 1);
      }
    };

    for (const [name, root] of Object.entries(roots)) walk(name, root, 0);
    return out;
  });
}

/** The DOM controls on screen right now, as **page points** — their own boxes'
 *  centres, straight off `getBoundingClientRect`. */
export async function harvestDomControls(
  page: Page,
  ids: readonly string[] = DOM_CONTROL_IDS,
): Promise<{ control: string; x: number; y: number }[]> {
  return page.evaluate((wanted) => {
    const out: { control: string; x: number; y: number }[] = [];
    for (const id of wanted) {
      const el = document.getElementById(id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      out.push({ control: `dom#${id}`, x: r.x + r.width / 2, y: r.y + r.height / 2 });
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

/** The canvas origin in page space — the seams report canvas-local physical
 *  points, so a real probe adds this back. Zero while the canvas fills the
 *  window; added anyway, so nothing here depends on that staying true. */
export async function canvasOrigin(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('canvas').boundingBox();
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
  }));
  const dom = await harvestDomControls(page);
  const covers: Cover[] = [];
  for (const c of [...canvas, ...dom]) {
    const topmost = await topmostAt(page, c.x, c.y);
    covers.push({
      control: c.control,
      page: { x: Math.round(c.x), y: Math.round(c.y) },
      topmost,
      collides: topmost.includes(LOG_ROOT_ID) || topmost.includes(LOG_BUTTON_ID),
    });
  }
  return {
    state,
    profile: profile.id,
    viewport: { width: profile.width, height: profile.height, dpr: profile.dpr, touch: profile.touch },
    log: await logBox(page),
    controls: covers,
    collisions: covers.filter((c) => c.collides),
    context,
  };
}
