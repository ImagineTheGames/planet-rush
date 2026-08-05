/**
 * tests/mobile/build-flow.spec.ts — the BUILD BUTTON PERSISTS. OWNER: UI Engineer.
 *
 * Regression guard for a field report on a live build: *"after building, the
 * build menu button disappeared (the one you click to show the build menu)."*
 * The open-build-wheel button is a permanent HUD fixture whenever the player is
 * near their own station (GDD §2.2, §2.4), and it must survive the full cycle:
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
import { budgetTest } from './budgets';
import { waitForSimTicks } from './sim-clock';

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
 *  independent (rAF-polled against the sim's own clock).
 *
 *  Delegates to the suite's shared waiter (./sim-clock.ts), which adds the piece
 *  this local copy lacked: a stall watchdog. A construction wait that never
 *  advances now fails in 10 s naming how far it got, instead of quietly eating
 *  the whole journey budget and reporting as "slow" (QA charter: a hung match is
 *  a failed test, never a hung harness). */
async function advanceSimTicks(page: Page, n: number, what?: string): Promise<void> {
  await waitForSimTicks(page, n, what ? { what } : {});
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

    // This test drives a FULL construction cycle: it advances the sim ~650 fixed
    // steps so a real 10 s-buildTime turret finishes (line ~219). On the
    // software-WebGL CI runner a render frame can be ~1 fps and the loop admits at
    // most MAX_FRAME_SECONDS (0.25 s ⇒ 15 steps) of catch-up per frame, so those
    // 650 steps alone cost ~44 render frames ≈ ~45 s of wall clock — before the
    // several tap→settle round-trips on top. That is irreducible without weakening
    // what the test proves (the button survives a completed build). It is NOT a
    // minimap cost — the map's per-frame render is negligible (an A/B removing its
    // offscreen texture pass moved the advance by 0 ms), and the BUILD button is
    // claimed before the minimap in the pointer handler (main.ts), on the opposite
    // screen corner. Touch-only (desktop is skipped above).
    //
    // This used to be `test.slow()` — a blanket 3× of whatever the global cap
    // happened to be, which says nothing about the work and moves silently when
    // someone edits the config. Budget the journey from what it does instead
    // (q7-01, ./budgets.ts).
    budgetTest({
      work: 'landscape boot → tap BUILD → order a turret → 650 sim ticks of construction → 3 more taps',
      measuredSeconds: 29,
    });

    await useLandscape(page);
    await bootDebug(page);

    const label = `${testInfo.project.name}/landscape`;

    // The ship spawns orbiting its own station, i.e. docked (state.ts), so the
    // button is a fixture from the first frame — no need to fly home first.
    const before = await snapshot(page);
    expect(before.present, `[${label}] __planetRush absent — served with ?debug=1?`).toBe(true);
    const w = before.viewport.width;
    const h = before.viewport.height;
    expect(w, `[${label}] expected landscape (w > h)`).toBeGreaterThan(h);

    // (1) BEFORE — the button is on screen, and the wheel is not yet.
    const btn0 = find(before, 'build-button');
    expect(btn0, `[${label}] BEFORE: build-button not registered — the button is not on screen at the station`).toBeTruthy();
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
    await advanceSimTicks(page, 650, 'turret construction (10 s buildTime = 600 ticks)');
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

// The BACK cycle (field report v0.2.4): drill BUILD → UPGRADE SHIP → WEAPON, then
// tap the hub BACK-BACK-BACK back out to closed — one level per tap. Real touch
// taps through the layout contract, on both phone profiles, so the "no way back up
// a level" bug is a red-if-it-regresses test rather than a screenshot.
test.describe('the wheel BACK cycle — drill in, hub-tap back out (field report v0.2.4)', () => {
  test('BUILD → UPGRADE → WEAPON, then hub BACK×3 pops one level each to closed', async ({
    page,
  }, testInfo) => {
    test.skip(!isTouchProject(testInfo.project.name), 'the wheel is tap-operated on touch (GDD §2.4)');
    budgetTest({
      work: 'landscape boot → 6 wheel taps (drill BUILD → UPGRADE → WEAPON, then BACK ×3), each with a 2-tick settle',
      measuredSeconds: 23,
    });

    await useLandscape(page);
    await bootDebug(page);

    const label = testInfo.project.name;
    const boot = await snapshot(page);
    const w = boot.viewport.width;
    const h = boot.viewport.height;

    // Open the Build wheel from its button.
    const c = buildButtonCenter(w, h);
    await tap(page, c.x, c.y);
    let snap = await snapshot(page);
    expect(has(snap, 'build-wheel'), `[${label}] the wheel did not open`).toBe(true);
    // The hub BACK affordance is registered thumb-sized at centre while a wheel is up.
    expect(has(snap, 'wheel-hub-back'), `[${label}] the hub BACK affordance is not registered`).toBe(true);

    // Geometry from the drawn wheel (registry bounds, not guessed pixels).
    const wheel = find(snap, 'build-wheel')!;
    const cx = wheel.bounds.x + wheel.bounds.width / 2;
    const cy = wheel.bounds.y + wheel.bounds.height / 2;
    const r = wheel.bounds.width / 2;

    // Drill: UPGRADE SHIP (index 3 → angle π, LEFT of the hub) opens the upgrade wheel.
    await tap(page, cx - r * 0.6, cy);
    snap = await snapshot(page);
    expect(has(snap, 'upgrade-wheel'), `[${label}] UPGRADE SHIP did not open the upgrade wheel`).toBe(true);

    // Drill: WEAPON (index 0 → twelve o'clock, UP from the hub) opens the sub-wheel.
    // It must NOT collapse back to the Build wheel — the upgrade wheel stays up.
    await tap(page, cx, cy - r * 0.6);
    snap = await snapshot(page);
    expect(has(snap, 'upgrade-wheel'), `[${label}] WEAPON collapsed the wheel instead of drilling in`).toBe(true);
    expect(has(snap, 'build-wheel'), `[${label}] WEAPON fell back to the Build wheel`).toBe(false);

    // BACK 1 — hub tap: WEAPON sub-wheel → upgrade wheel. One level, not a full
    // close: the upgrade wheel is still up and the Build wheel is not back yet.
    await tap(page, cx, cy);
    snap = await snapshot(page);
    expect(has(snap, 'upgrade-wheel'), `[${label}] BACK 1 closed too much — expected the upgrade wheel`).toBe(true);
    expect(has(snap, 'build-wheel'), `[${label}] BACK 1 jumped past the upgrade wheel to Build`).toBe(false);

    // BACK 2 — hub tap: upgrade wheel → Build wheel.
    await tap(page, cx, cy);
    snap = await snapshot(page);
    expect(has(snap, 'build-wheel'), `[${label}] BACK 2 did not land on the Build wheel`).toBe(true);
    expect(has(snap, 'upgrade-wheel'), `[${label}] BACK 2 left the upgrade wheel up`).toBe(false);

    // BACK 3 — hub tap: Build wheel → closed. The BUILD button is back (docked).
    await tap(page, cx, cy);
    snap = await snapshot(page);
    expect(has(snap, 'build-wheel'), `[${label}] BACK 3 did not close the wheel`).toBe(false);
    expect(has(snap, 'upgrade-wheel'), `[${label}] BACK 3 left the upgrade wheel up`).toBe(false);
    expect(has(snap, 'wheel-hub-back'), `[${label}] the hub affordance lingered after closing`).toBe(false);
    expect(has(snap, 'build-button'), `[${label}] the BUILD button did not return after closing`).toBe(true);
  });
});
