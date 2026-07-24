/**
 * tests/mobile/build-flow.spec.ts — the BUILD BUTTON PERSISTS. OWNER: UI Engineer.
 *
 * Regression guard for a field report on a live build: *"after building, the
 * build menu button disappeared (the one you click to show the build menu)."*
 * The open-build-wheel button is a permanent HUD fixture whenever the player is
 * near their own planet (GDD §2.2, §2.4), and it must survive the full cycle:
 * open the wheel → choose a structure → build completes → the button is still
 * there, still hittable, and a second tap opens the wheel again.
 *
 * This drives that exact cycle on a phone profile in **landscape** (the play
 * orientation — portrait is the ROTATE-overlay state, per emulation.spec.ts),
 * through real **touch** taps on the real Vite preview build, and asserts the
 * button at every step **through the layout contract** — `window.__planetRush`
 * under `?debug=1`, the registry's own record of what was actually drawn — never
 * by sampling pixels. Presence is "the registry has a `build-button` entry this
 * frame"; hittability is proven by *effect* — tapping it toggles the wheel, which
 * the registry reports as `build-wheel` appearing and disappearing.
 *
 * TIME BASE: the sim's own fixed-step clock (`__planetRush.ticks`), not wall
 * seconds. On the software-WebGL CI runner a frame can be ~1 fps, so any wait
 * phrased in milliseconds would be a wait on the host's frame rate; {@link
 * advanceSimTicks} waits on tick count so "let construction run" means the same
 * amount of *simulation* on a laptop and in CI (debug-hook.ts `ticks`).
 *
 * The button is drawn by the touch layer (`@platform/touch-visuals`); its
 * persistence rule and layout id/anchor are the UI's contract
 * (`src/ui/build-button.ts`), unit-tested there — this proves the wired build
 * actually honours it end to end.
 */
import { test, expect, type Page } from '@playwright/test';

const TOUCH_PROJECTS = ['iphone', 'pixel'];
const isTouchProject = (name: string): boolean => TOUCH_PROJECTS.includes(name);

// --- Touch-visuals button geometry (mirrors src/platform/touch-visuals.ts) ---
// The button sits directly above the left thrust stick, in the left thumb's
// reach. These are the same constants that draw it, so the tap lands where the
// affordance really is; if they ever drift, the "wheel opens" assertion fails
// loudly rather than silently missing.
const EDGE_MARGIN = 28;
const R_STICK = 64;
const BUILD_GAP = 18;
const R_BUILD = 38;

/** Screen-space centre of the BUILD button for a viewport, CSS px. */
function buildButtonCenter(_w: number, h: number): { x: number; y: number } {
  const stickCenterY = h - EDGE_MARGIN - R_STICK;
  return { x: EDGE_MARGIN + R_STICK, y: stickCenterY - R_STICK - BUILD_GAP - R_BUILD };
}

// --- Registry probe (same shape as layout.spec.ts, plus the tick clock) ------

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Entry {
  id: string;
  region: string;
  bounds: Rect;
  /** The registry's OWN within-anchor verdict for this entry. */
  within: boolean;
}
interface Snapshot {
  present: boolean;
  ticks: number;
  viewport: { width: number; height: number };
  entries: Entry[];
}

/** Read the whole current frame's layout + the sim's tick count in one shot. */
async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate((): Snapshot => {
    interface Anchor {
      region: string;
      margin?: number;
    }
    interface RawEntry {
      id: string;
      anchor: Anchor;
      bounds: Rect;
    }
    interface PlanetRush {
      layout: RawEntry[];
      ticks: number;
      viewport: { width: number; height: number };
      placement(): Array<{ id: string; ok: boolean }>;
    }
    const pr = (window as unknown as { __planetRush?: PlanetRush }).__planetRush;
    if (!pr) return { present: false, ticks: 0, viewport: { width: 0, height: 0 }, entries: [] };
    const ok = new Map(pr.placement().map((p) => [p.id, p.ok]));
    return {
      present: true,
      ticks: pr.ticks,
      viewport: pr.viewport,
      entries: pr.layout.map((e) => ({
        id: e.id,
        region: e.anchor.region,
        bounds: e.bounds,
        within: ok.get(e.id) ?? false,
      })),
    };
  });
}

const find = (snap: Snapshot, id: string): Entry | undefined => snap.entries.find((e) => e.id === id);
const has = (snap: Snapshot, id: string): boolean => snap.entries.some((e) => e.id === id);

/** Boot the preview build with the debug registry live (NOT frozen — the sim has
 *  to run so we can actually build), and wait for a populated frame. */
async function bootDebug(page: Page): Promise<void> {
  await page.goto('/?debug=1');
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const pr = (window as unknown as { __planetRush?: { layout?: unknown[]; ticks?: number } }).__planetRush;
      return !!pr && Array.isArray(pr.layout) && pr.layout.length > 0 && (pr.ticks ?? 0) > 3;
    },
    undefined,
    { timeout: 20_000 },
  );
}

/** Force landscape before boot — the playable orientation (portrait is the
 *  ROTATE-overlay state). Must run before `bootDebug`. */
async function useLandscape(page: Page): Promise<void> {
  const vp = page.viewportSize();
  if (vp && vp.height > vp.width) await page.setViewportSize({ width: vp.height, height: vp.width });
}

/** Wait for the sim to advance `n` fixed steps from now — render-rate
 *  independent (rAF-polled against the sim's own clock). */
async function advanceSimTicks(page: Page, n: number): Promise<void> {
  await page.evaluate(
    (want) =>
      new Promise<void>((resolve) => {
        const pr = (window as unknown as { __planetRush: { ticks: number } }).__planetRush;
        const t0 = pr.ticks;
        const poll = (): void => {
          if (pr.ticks - t0 >= want) resolve();
          else requestAnimationFrame(poll);
        };
        requestAnimationFrame(poll);
      }),
    n,
  );
}

/** A discrete touch tap, then let a couple of sim ticks apply it. */
async function tap(page: Page, x: number, y: number): Promise<void> {
  await page.touchscreen.tap(x, y);
  await advanceSimTicks(page, 2);
}

// ===========================================================================

test.describe('build button persists through the whole build cycle', () => {
  test('present + hittable before, during, and after construction; reopens on a second tap', async ({
    page,
  }, testInfo) => {
    test.skip(!isTouchProject(testInfo.project.name), 'the BUILD button is a touch affordance (GDD §2.4)');

    await useLandscape(page);
    await bootDebug(page);

    const label = `${testInfo.project.name}/landscape`;

    // The ship spawns orbiting its own planet, i.e. docked (state.ts), so the
    // button is a fixture from the first frame — no need to fly home first.
    const before = await snapshot(page);
    expect(before.present, `[${label}] __planetRush absent — served with ?debug=1?`).toBe(true);
    const w = before.viewport.width;
    const h = before.viewport.height;
    expect(w, `[${label}] expected landscape (w > h)`).toBeGreaterThan(h);

    // (1) BEFORE — the button is on screen, and the wheel is not yet.
    const btn0 = find(before, 'build-button');
    expect(btn0, `[${label}] BEFORE: build-button not registered — the button is not on screen at the planet`).toBeTruthy();
    expect(has(before, 'build-wheel'), `[${label}] BEFORE: the wheel should be closed`).toBe(false);

    // Position asserted via the layout contract (registry data), not pixels: the
    // registry's own within-anchor verdict holds, and the drawn rect sits in the
    // LEFT thumb's reach and into the lower half — where GDD §2.4 puts it.
    expect(btn0!.within, `[${label}] BEFORE: build-button escapes its declared anchor`).toBe(true);
    const cx0 = btn0!.bounds.x + btn0!.bounds.width / 2;
    expect(cx0, `[${label}] BEFORE: build-button should sit in the left half`).toBeLessThan(w / 2);
    expect(
      btn0!.bounds.y + btn0!.bounds.height,
      `[${label}] BEFORE: build-button should reach into the lower half (thumb zone)`,
    ).toBeGreaterThan(h / 2);

    // (2) OPEN — a tap on the button opens the wheel (proves it is hittable), and
    //     the button is STILL registered while the wheel is up.
    const c = buildButtonCenter(w, h);
    await tap(page, c.x, c.y);
    const opened = await snapshot(page);
    expect(has(opened, 'build-wheel'), `[${label}] a tap on the button did not open the wheel — not hittable`).toBe(true);
    expect(has(opened, 'build-button'), `[${label}] OPEN: the button vanished when the wheel opened`).toBe(true);

    // (3) DURING construction — tap the TURRET wedge (segment 0, twelve o'clock;
    //     starting ore 3 = turret cost 3, so it is affordable). Spending keeps
    //     the wheel open (GDD §2.5), and the button must remain through it. Read
    //     the wheel's real drawn radius from the registry so the wedge tap lands
    //     where it is actually drawn.
    const wheel = find(opened, 'build-wheel')!;
    const wheelCx = wheel.bounds.x + wheel.bounds.width / 2;
    const wheelCy = wheel.bounds.y + wheel.bounds.height / 2;
    const radius = wheel.bounds.width / 2;
    await tap(page, wheelCx, wheelCy - radius * 0.6); // TURRET, up from the hub
    const building = await snapshot(page);
    expect(has(building, 'build-button'), `[${label}] DURING: the button disappeared after ordering the turret`).toBe(true);

    // Let the turret's ~10 s build run out (buildTime 10 s = 600 ticks), then a
    // little past it — "after construction". The idle ship never undocks, so the
    // button is a fixture the whole time.
    await advanceSimTicks(page, 650);
    const after = await snapshot(page);
    const btnAfter = find(after, 'build-button');
    expect(btnAfter, `[${label}] AFTER: the button disappeared once construction finished — the reported bug`).toBeTruthy();
    expect(btnAfter!.within, `[${label}] AFTER: build-button escaped its anchor`).toBe(true);
    expect(after.ticks - before.ticks, `[${label}] the sim should have advanced past the build time`).toBeGreaterThanOrEqual(600);

    // (4) The button still closes the wheel...
    await tap(page, c.x, c.y);
    const closed = await snapshot(page);
    expect(has(closed, 'build-wheel'), `[${label}] the button should still close the wheel after building`).toBe(false);
    expect(has(closed, 'build-button'), `[${label}] the button vanished after closing the wheel`).toBe(true);

    // ...and a SECOND tap reopens it — the exact thing the field report said was
    // impossible ("the button to show the build menu disappeared").
    await tap(page, c.x, c.y);
    const reopened = await snapshot(page);
    expect(has(reopened, 'build-wheel'), `[${label}] a second tap did not reopen the wheel`).toBe(true);
    expect(has(reopened, 'build-button'), `[${label}] REOPEN: the button vanished on reopen`).toBe(true);
  });
});
