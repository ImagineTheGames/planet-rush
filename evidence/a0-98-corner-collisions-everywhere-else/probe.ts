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
 *
 * ── WHAT a0-114 CHANGED, AND WHY THIS FILE IS WHERE THE GAP WAS ────────────
 * a0-98 photographed a0-114's defect and scored the frame clear. The frame is
 * `shots/broken/phone-798x384-doors-error.png`: the refusal panel's DOWNLOAD LOG
 * (`src/net/connect-trace-view`) opaque over the HOST plate, only the bottom
 * sliver of the four letters showing. The state was `doors-error`, driven through
 * a REAL refusal on the profile a0-111 reported, and the report says
 * `"collisions": []`.
 *
 * Three faults, all here, none of them in the states the sweep chose:
 *
 *  1. **One cover was recognised.** `collides` asked whether the topmost element
 *     was the CORNER affordance, by id. Every other thing the client can raise
 *     over the canvas was recorded truthfully in `topmost` and then scored
 *     `false`. Fixed by {@link Verdict}`.foreign`: a cover is now *anything that
 *     is not the canvas and not the control itself*, named rather than matched.
 *  2. **One point was probed.** Nine rows in the a0-98 table carry a box and
 *     every one of them was hit-tested at its CENTRE and nowhere else. HOST is
 *     `{x:403,y:141.5,w:372,h:62}`; the buttons end at y≈160; the centre is
 *     y=172.5. A cover taking the top third of a plate is invisible to a
 *     centre probe, and `elementFromPoint` at 173 answers `CANVAS#app` honestly.
 *     Fixed by {@link probePoints}: nine points off the box the CLIENT reported.
 *  3. **The overlap column was measured against one box.** `coveredFraction`
 *     came from `logBox()` — the corner offer. On this screen the corner offer is
 *     `mounted:false`, so the one column that measures partial cover read `null`
 *     for every door. Fixed by {@link harvestOverlays}: every mounted fixed
 *     surface over the game, found generically.
 *
 * The rule the harvest side already followed — *"deliberately not a hand-written
 * list … a hand-written list finds only the controls whoever wrote it thought
 * of"* — was never applied to the cover side. It is now. Re-run over a0-98's own
 * unchanged states, this instrument turns its own broken table red.
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
  /** How much of that box the offer's own box sits on, 0-1. Reported beside
   *  {@link collides} because the two answer different questions: a minimap whose
   *  centre is clear and whose bottom third is buried is not "fine", and a table
   *  that showed only the centre would say it was. */
  readonly coveredFraction: number | null;

  // --- a0-114: the general question, beside a0-98's specific one ----------

  /** The nine points off this control's own reported box, each with the
   *  browser's verdict. `[]` where the seam reported a point and no box.
   *  a0-98 probed exactly one of these (the centre) and that is how a cover
   *  taking the top third of the HOST plate got scored clear. */
  readonly verdicts: readonly Verdict[];
  /** The distinct ids of everything FOREIGN found standing on this control —
   *  anything that is neither the canvas nor the control itself. Empty is the
   *  clean answer; this is the column a0-98 did not have. */
  readonly coveredBy: readonly string[];
  /** `live && coveredBy.length > 0` — the general form of {@link collides},
   *  which stays as a0-97 and a0-98 defined it so the two tables still compare. */
  readonly covered: boolean;
  /** How much of the box the union of every mounted overlay sits on, 0-1.
   *  {@link coveredFraction} measures the corner offer alone. */
  readonly foreignFraction: number | null;
}

/** One probed point and what the browser said was on top of it. */
export interface Verdict {
  readonly x: number;
  readonly y: number;
  /** Where on the box this point is — `centre`, `top-left`, `top`, … */
  readonly at: string;
  /** `CANVAS#app` means the game got the press. Anything else names what took it. */
  readonly topmost: string;
  /** Neither the canvas nor the control's own element: something is in the way. */
  readonly foreign: boolean;
}

/** A mounted DOM surface standing over the game, found generically. */
export interface Overlay {
  readonly id: string;
  readonly box: Box;
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
  /** a0-114: every LIVE control with something foreign standing on it, whatever
   *  that something is. A superset of {@link collisions}, and the list a sweep
   *  has to read if it wants to claim it covered a screen. */
  readonly covered?: readonly Cover[];
  /** Every fixed DOM surface that was over the game in this frame, measured. */
  readonly overlays?: readonly Overlay[];
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
): Promise<Omit<Cover, 'coveredFraction' | 'verdicts' | 'coveredBy' | 'covered' | 'foreignFraction'>[]> {
  return page.evaluate((wanted) => {
    const out: {
      control: string;
      page: { x: number; y: number };
      topmost: string;
      live: boolean;
      onScreen: boolean;
      collides: boolean;
      box: Box | null;
    }[] = [];
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
 * **The whole of a control's own reported rect, hit-tested — a0-114's fix to the
 * instrument.**
 *
 * a0-98 asked `elementFromPoint` once per control, at its centre, and that is a
 * question about a point rather than about a target. A thumb reaches for a plate,
 * not for its centroid, and a cover that takes the top third of a plate leaves the
 * centre answering `CANVAS#app` perfectly truthfully. That is exactly how the HOST
 * door passed: `{x:403,y:141.5,w:372,h:62}`, buttons ending at y≈160, centre at
 * y=172.5 — twelve pixels of clearance, and a0-111 could still only read the
 * bottom sliver of the word.
 *
 * Nine points, all derived from the box the CLIENT reported and none of them
 * chosen by hand: the centre, the four edge midpoints and the four corners, each
 * pulled `INSET` inward so a corner is a point ON the control rather than on the
 * boundary between it and its neighbour.
 *
 * One `evaluate` for every point of every control, so rect and hit-test come from
 * one layout — the lesson {@link harvestAndProbeDomControls} already learned when
 * the CONNECTION LOST card's ticking label made it report two different frames.
 */
export const PROBE_INSET_PX = 2;

export async function probePoints(
  page: Page,
  targets: readonly { control: string; box: Box; ownerId: string | null }[],
): Promise<Record<string, Verdict[]>> {
  return page.evaluate(
    ({ list, inset }) => {
      const name = (el: Element): string => {
        let id = '';
        for (let n: Element | null = el; n; n = n.parentElement) {
          if (n.id) {
            id = n.id;
            break;
          }
        }
        return id ? `${el.tagName}#${id}` : el.tagName;
      };
      const out: Record<string, { x: number; y: number; at: string; topmost: string; foreign: boolean }[]> = {};
      for (const t of list) {
        const { x, y, width, height } = t.box;
        const i = Math.min(inset, width / 2, height / 2);
        const l = x + i;
        const r = x + width - i;
        const top = y + i;
        const bot = y + height - i;
        const cx = x + width / 2;
        const cy = y + height / 2;
        const points: { x: number; y: number; at: string }[] = [
          { x: cx, y: cy, at: 'centre' },
          { x: cx, y: top, at: 'top' },
          { x: cx, y: bot, at: 'bottom' },
          { x: l, y: cy, at: 'left' },
          { x: r, y: cy, at: 'right' },
          { x: l, y: top, at: 'top-left' },
          { x: r, y: top, at: 'top-right' },
          { x: l, y: bot, at: 'bottom-left' },
          { x: r, y: bot, at: 'bottom-right' },
        ];
        const owner = t.ownerId ? document.getElementById(t.ownerId) : null;
        const rows: { x: number; y: number; at: string; topmost: string; foreign: boolean }[] = [];
        for (const p of points) {
          const on = p.x >= 0 && p.y >= 0 && p.x <= window.innerWidth && p.y <= window.innerHeight;
          const hit = on ? document.elementFromPoint(p.x, p.y) : null;
          if (!on) {
            rows.push({ x: Math.round(p.x), y: Math.round(p.y), at: p.at, topmost: 'off-viewport', foreign: false });
            continue;
          }
          if (!hit) {
            rows.push({ x: Math.round(p.x), y: Math.round(p.y), at: p.at, topmost: 'nothing', foreign: false });
            continue;
          }
          // FOREIGN, defined without a list of ids: a canvas control is clear when
          // the canvas took the point; a DOM control is clear when it, or something
          // inside it, did. Everything else is in the way, whatever it calls itself.
          const mine = owner ? owner === hit || owner.contains(hit) : hit.tagName === 'CANVAS';
          rows.push({ x: Math.round(p.x), y: Math.round(p.y), at: p.at, topmost: name(hit), foreign: !mine });
        }
        out[t.control] = rows;
      }
      return out;
    },
    {
      // Copied plainly: Playwright serialises the argument, and a readonly tuple
      // crosses that boundary as a plain array anyway.
      list: targets.map((t) => ({ control: t.control, box: { ...t.box }, ownerId: t.ownerId })),
      inset: PROBE_INSET_PX,
    },
  );
}

/**
 * **Every fixed DOM surface standing over the game right now**, found the way the
 * control side has always been found: structurally, with no list of ids.
 *
 * a0-98's `coveredFraction` was measured against `logBox()` and nothing else, so on
 * a screen where the corner offer is not mounted — the doors, every refusal the
 * front door raises — the one column that measures PARTIAL cover was `null` for
 * every row. The refusal panel (`src/net/connect-trace-view`) is one of these and
 * was never in that comparison.
 *
 * The walk is `document.body`'s own children, plus anything the top layer holds:
 * an element counts when it is laid out, not hidden, positioned `fixed` or
 * `absolute`, and is not the game root or the canvas itself.
 */
export async function harvestOverlays(page: Page): Promise<Overlay[]> {
  return page.evaluate(() => {
    const out: { id: string; box: { x: number; y: number; width: number; height: number } }[] = [];

    /** Does this element itself put ink on the screen? Its OWN paint — a container
     *  is not painting because something inside it is. */
    const paints = (el: Element, style: CSSStyleDeclaration): boolean => {
      const bg = style.backgroundColor;
      if (bg && bg !== 'transparent' && !/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)/.test(bg)) return true;
      if (style.borderStyle !== 'none' && parseFloat(style.borderWidth || '0') > 0) return true;
      if (style.backgroundImage && style.backgroundImage !== 'none') return true;
      for (const n of Array.from(el.childNodes)) {
        if (n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '') return true;
      }
      return false;
    };

    const label = (el: Element): string => {
      if (el.id) return el.id;
      const cls = (el.className || '').toString().trim().split(/\s+/)[0];
      return cls ? `${el.tagName.toLowerCase()}.${cls}` : el.tagName.toLowerCase();
    };

    const walk = (el: Element, depth: number): void => {
      if (depth > 6) return;
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'CANVAS') return;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return;
      if ((el as HTMLElement).hidden) return;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      // Take the element when it PAINTS or when it TAKES A PRESS — a0-97's rule is
      // that a control drawn over your target is the bug whether or not it swallows
      // the press, so both count and neither is enough on its own. A container that
      // does neither is not a cover: its children might be, so descend past it. The
      // refusal panel is exactly that shape — `pointer-events:none` on a transparent
      // flex box with two opaque buttons inside — and measuring its ROOT would call
      // a plate 20% buried when 12% of it is under anything a player can see.
      if (paints(el, style) || style.pointerEvents !== 'none') {
        out.push({ id: label(el), box: { x: r.x, y: r.y, width: r.width, height: r.height } });
        return;
      }
      for (const child of Array.from(el.children)) walk(child, depth + 1);
    };

    for (const el of Array.from(document.body.children)) {
      // The game root is not chrome over the game, and neither is anything inside
      // it: everything under the canvas's own parent IS the app.
      if (el.id === 'app' || el.querySelector('canvas')) continue;
      const style = getComputedStyle(el);
      if (style.position !== 'fixed' && style.position !== 'absolute') continue;
      walk(el, 0);
    }
    return out;
  });
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
  // a0-114: everything standing over the game this frame, found structurally. The
  // corner offer is one of these; before a0-114 it was the only one anything was
  // measured against.
  const overlays = await harvestOverlays(page);
  // …and the whole of every reported rect, hit-tested in one layout.
  const verdicts = await probePoints(
    page,
    canvas.filter((c) => c.box).map((c) => ({ control: c.control, box: c.box as Box, ownerId: null })),
  );
  const covers: Cover[] = [];
  for (const c of canvas) {
    const onScreen = c.x >= 0 && c.y >= 0 && c.x <= viewport.width && c.y <= viewport.height;
    const topmost = onScreen ? await topmostAt(page, c.x, c.y) : 'off-viewport';
    const rows = verdicts[c.control] ?? [];
    const coveredBy = [...new Set(rows.filter((v) => v.foreign).map((v) => v.topmost))];
    covers.push({
      control: c.control,
      page: { x: Math.round(c.x), y: Math.round(c.y) },
      topmost,
      live: c.live,
      onScreen,
      // a0-97's definition, unchanged, so this table and a0-98's still compare.
      collides: c.live && (topmost.includes(LOG_ROOT_ID) || topmost.includes(LOG_BUTTON_ID)),
      box: c.box,
      coveredFraction: c.box && offerBox ? overlapFraction(c.box, offerBox) : null,
      verdicts: rows,
      coveredBy,
      covered: c.live && coveredBy.length > 0,
      foreignFraction: c.box ? unionFraction(c.box, overlays.map((o) => o.box)) : null,
    });
  }
  // The DOM half, rect and hit-test taken together (see the helper's note).
  const dom = await harvestAndProbeDomControls(page);
  const domVerdicts = await probePoints(
    page,
    dom
      .filter((d) => d.box)
      .map((d) => ({ control: d.control, box: d.box as Box, ownerId: d.control.replace(/^dom#/, '') })),
  );
  for (const d of dom) {
    const rows = domVerdicts[d.control] ?? [];
    const coveredBy = [...new Set(rows.filter((v) => v.foreign).map((v) => v.topmost))];
    covers.push({
      ...d,
      coveredFraction: d.box && offerBox ? overlapFraction(d.box, offerBox) : null,
      verdicts: rows,
      coveredBy,
      covered: d.live && coveredBy.length > 0,
      foreignFraction: d.box
        ? unionFraction(
            d.box,
            // An element is not chrome over itself: the control's own box is
            // excluded, or the refusal panel would report its own buttons as
            // buried — the same mistake the first online run made with the
            // CONNECTION LOST card.
            overlays.filter((o) => o.id !== d.control.replace(/^dom#/, '')).map((o) => o.box),
          )
        : null,
    });
  }
  return {
    state,
    profile: profile.id,
    viewport: { width: profile.width, height: profile.height, dpr: profile.dpr, touch: profile.touch },
    log: offer,
    controls: covers,
    collisions: covers.filter((c) => c.collides),
    covered: covers.filter((c) => c.covered),
    overlays,
    coveredButDead: covers.filter(
      (c) => !c.live && (c.topmost.includes(LOG_ROOT_ID) || c.topmost.includes(LOG_BUTTON_ID)),
    ),
    context,
  };
}

/** What fraction of `box` a set of rects covers between them, 0-1. Sampled on a
 *  fine grid rather than summed, because overlapping overlays would otherwise
 *  count the same pixel twice and report more than the whole. */
function unionFraction(box: Box, overs: readonly Box[]): number {
  if (overs.length === 0 || box.width <= 0 || box.height <= 0) return 0;
  const steps = 40;
  let inside = 0;
  for (let iy = 0; iy < steps; iy++) {
    const y = box.y + ((iy + 0.5) / steps) * box.height;
    for (let ix = 0; ix < steps; ix++) {
      const x = box.x + ((ix + 0.5) / steps) * box.width;
      if (overs.some((o) => x >= o.x && x <= o.x + o.width && y >= o.y && y <= o.y + o.height)) inside++;
    }
  }
  return Math.round((inside / (steps * steps)) * 100) / 100;
}

/** What fraction of `box` the `over` rect sits on. Plain geometry, reported as
 *  context beside the browser's own verdict — never in place of it. */
function overlapFraction(box: Box, over: Box): number {
  const w = Math.max(0, Math.min(box.x + box.width, over.x + over.width) - Math.max(box.x, over.x));
  const h = Math.max(0, Math.min(box.y + box.height, over.y + over.height) - Math.max(box.y, over.y));
  const area = box.width * box.height;
  return area > 0 ? Math.round(((w * h) / area) * 100) / 100 : 0;
}
