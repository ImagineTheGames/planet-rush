/**
 * tests/mobile/build-wheel-gantry.spec.ts — the Gantry/Bone wedge, DRIVEN.
 * OWNER: UI Engineer (u7-02, GDD §2.5, style-guide §2.1).
 *
 * The wedge's copy and its states are unit-green in `src/ui/build-wheel.test.ts`
 * and its fit budget in `src/ui/hud-geometry.test.ts`. Neither can reach the
 * thing that actually broke on this screen once before: **the real click path.**
 * This project shipped a build wheel whose model tests were green while WEAPON
 * bounced back to the Build wheel and upgrades were dead — the seams said one
 * thing and the pointer did another.
 *
 * So every interaction here is a REAL synthesized event on the canvas — a
 * `touchscreen.tap` on the phone profiles, a `mouse.click` and the real `E` key
 * binding on desktop — into the same `main.ts` handler a thumb or a mouse uses.
 * The `?debug=1` seams are used only to READ BACK what the shipped bundle drew
 * (`__pressStage.wedges()`, the sibling of the upgrade wheel's `wedges()`), never
 * to drive the wheel.
 *
 * What it proves, per profile and in both orientations:
 *
 *  1. A real open — the BUILD button on touch, the `E` binding on desktop — puts
 *     the four-line Gantry stack on screen: the name, what it spends on, the
 *     cost, and the count over its cap.
 *  2. The cost numeral takes BOTH of its ratified colours off the same wedge:
 *     signal yellow while it is payable, threat red the moment it is not
 *     (style-guide §2.1). Nothing else on the wheel takes red.
 *  3. A capped wedge quotes `FULL` and counts (`4 / 4 BUILT`) rather than capping
 *     silently — the u2-02 close.
 *  4. A real press on a capped wedge is REFUSED: the count does not move and the
 *     bank does not move, so the wheel never dangles a build the sim would refuse.
 *  5. REPAIR REACTOR still shows the real HP a tap restores before the tap, and
 *     UPGRADE SHIP still opens a second screen rather than quoting a price.
 *
 * Runs WITHOUT `?freeze=1` where the sim has to move (4), and with the sim live
 * throughout — the wheel is read from what was drawn, not from a pinned frame.
 */
import { test, expect, type Page } from '@playwright/test';
import { budgetTest } from './budgets';
import { waitForSimTicks } from './sim-clock';

const TOUCH_PROJECTS = ['iphone', 'pixel'];
const isTouchProject = (name: string): boolean => TOUCH_PROJECTS.includes(name);

// --- Touch-visuals BUILD button geometry (mirrors src/platform/touch-visuals.ts)
//
// The centre these four numbers describe is computed IN THE PAGE, inside
// `pressBuildAffordance`: the logical viewport it needs has to be read across
// the wire anyway, and doing the subtraction on this side would cost a second
// crossing (see the round-trip note below).
const EDGE_MARGIN = 28;
const R_STICK = 64;
const BUILD_GAP = 18;
const R_BUILD = 38;


// --- What the shipped view drew ---------------------------------------------

interface DrawnWedge {
  id: string;
  label: string;
  sub: string;
  target: string;
  caps: string;
  costLabel: string;
  cost: number | null;
  ready: boolean;
  costPaint: 'ore' | 'refused' | 'spent' | 'none';
}

interface PressStage {
  openBuild(ore: number): { open: boolean; banked: number } | null;
  setOre(ore: number): number | null;
  wedges(): DrawnWedge[];
  bank(): number | null;
  clientPoint(x: number, y: number): { x: number; y: number };
  logicalViewport(): { width: number; height: number };
}

/**
 * The wheel radius at or above which a wedge carries the handoff's full copy
 * (`WHEEL_FULL_COPY_RADIUS`, src/art/materials.ts). Mirrored here rather than
 * imported, the same discipline this suite uses for the touch-visuals geometry
 * above: if it drifts, the assertion fails loudly naming which form it got.
 */
const FULL_COPY_RADIUS = 188;

/** The count/cap line this profile should be drawing, given the drawn radius. */
function expectedCaps(radius: number, built: number, cap: number): string {
  return radius >= FULL_COPY_RADIUS ? `${built} / ${cap} BUILT` : `${built}/${cap} BUILT`;
}

/** The same, as a pattern, where the count itself is whatever the match holds. */
function capsPattern(radius: number, cap: number): RegExp {
  return radius >= FULL_COPY_RADIUS ? new RegExp(`^\\d+ / ${cap} BUILT$`) : new RegExp(`^\\d+/${cap} BUILT$`);
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * ── WHY THIS FILE COUNTS ITS ROUND TRIPS (a0-00b) ──────────────────────────
 * Profiled on PR #321's shard 2, `page.evaluate` accounted for the great bulk of
 * what this spec family spent — across calls that each read a getter or found an
 * id in an array, and each cost **2–3 seconds**. Nothing was computing for 2.5 s.
 * A CDP `Runtime.evaluate` cannot run until the page's main thread yields, and
 * under the runner's software GL the main thread is painting for very nearly the
 * whole frame, so **one round trip costs about one frame** — ~1 s there against
 * ~16 ms here. That, and not the work it does, is why `[pixel] :314` timed out at
 * 300 s while the same test passed in 126 s on `iphone`.
 *
 * So the reads below are batched into as few crossings as the journey allows.
 * Not one assertion moves: the seams read are the same seams, the values the same
 * values, and every press is still a real synthesized event.
 */

/** Read the drawn Build-wheel wedges off the real client. Read-back only. */
async function drawnWedges(page: Page): Promise<DrawnWedge[]> {
  return page.evaluate(() => {
    const s = (window as unknown as { __pressStage?: PressStage }).__pressStage;
    return s ? s.wedges() : [];
  });
}

/** The wheel's drawn bounds, its wedges and the bank, off ONE frame — so the
 *  three can no longer disagree with each other by a frame either. */
async function drawnState(page: Page): Promise<{ wheel: Rect | null; wedges: DrawnWedge[]; bank: number | null }> {
  return page.evaluate(() => {
    interface Entry {
      id: string;
      bounds: { x: number; y: number; width: number; height: number };
    }
    const pr = (window as unknown as { __planetRush?: { layout: Entry[] } }).__planetRush;
    const s = (window as unknown as { __pressStage?: PressStage }).__pressStage;
    return {
      wheel: pr?.layout.find((e) => e.id === 'build-wheel')?.bounds ?? null,
      wedges: s ? s.wedges() : [],
      bank: s ? s.bank() : null,
    };
  });
}

const wedge = (all: DrawnWedge[], id: string): DrawnWedge | undefined => all.find((w) => w.id === id);

/** The layout registry's record of what was drawn this frame. */
async function registered(page: Page, id: string): Promise<Rect | null> {
  return page.evaluate((wanted) => {
    interface Entry {
      id: string;
      bounds: Rect;
    }
    interface Rect {
      x: number;
      y: number;
      width: number;
      height: number;
    }
    const pr = (window as unknown as { __planetRush?: { layout: Entry[] } }).__planetRush;
    const hit = pr?.layout.find((e) => e.id === wanted);
    return hit ? hit.bounds : null;
  }, id);
}

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

/** Force the play orientation before boot (portrait is the ROTATE-overlay state). */
async function useLandscape(page: Page): Promise<void> {
  const vp = page.viewportSize();
  if (vp && vp.height > vp.width) await page.setViewportSize({ width: vp.height, height: vp.width });
}

/** One real press on this device's BUILD affordance — the button under the left
 *  thumb on touch, the `E` binding on desktop (GDD §2.4's table, both cells). */
async function pressBuildAffordance(page: Page, touch: boolean): Promise<void> {
  if (touch) {
    // The button is drawn in LOGICAL space (landscape, even portrait-held), so
    // the tap point crosses the client's own transform on the way back out —
    // in the same crossing that reads the viewport, because the geometry
    // between them is arithmetic that does not need to come home to be done.
    const p = await page.evaluate((geom) => {
      const s = (window as unknown as { __pressStage?: PressStage }).__pressStage!;
      const lvp = s.logicalViewport();
      const stickCenterY = lvp.height - geom.edgeMargin - geom.rStick;
      return s.clientPoint(
        geom.edgeMargin + geom.rStick,
        stickCenterY - geom.rStick - geom.buildGap - geom.rBuild,
      );
    }, { edgeMargin: EDGE_MARGIN, rStick: R_STICK, buildGap: BUILD_GAP, rBuild: R_BUILD });
    await page.touchscreen.tap(p.x, p.y);
  } else {
    await page.locator('canvas').click({ position: { x: 8, y: 8 } }); // focus the canvas
    await page.keyboard.press('e');
  }
  await waitForSimTicks(page, 4, { what: 'the wheel opening' });
}

/**
 * Open the Build wheel through the REAL affordance, and prove it opened by the
 * registry rather than by a seam.
 *
 * Retries the press, and the guard is what makes that safe: the affordance is a
 * TOGGLE, so a blind second press would close a wheel the first one opened —
 * hence the registry check before every attempt. A retry is needed because the
 * precondition is the SIM's, not the test's: the wheel only opens while the ship
 * is docked at its own station (`updateBuildWheel`), and on a runner driving
 * three device profiles at once the first press can land in the frames before
 * the client has resolved that. Waiting on the wheel alone would hang; pressing
 * again after a beat is the honest retry. (Found by a full-suite run, u7-06.)
 */
async function openWheelForReal(page: Page, touch: boolean): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await registered(page, 'build-wheel')) return;
    await pressBuildAffordance(page, touch);
    if (await registered(page, 'build-wheel')) return;
    await waitForSimTicks(page, 10, { what: 'the ship to settle docked at its station' });
  }
  expect(
    await registered(page, 'build-wheel'),
    'three real presses on the BUILD affordance did not open the wheel',
  ).not.toBeNull();
}

/** Bank exactly `ore` and let the wheel redraw against it. */
async function setOre(page: Page, ore: number): Promise<void> {
  await page.evaluate((o) => {
    const s = (window as unknown as { __pressStage?: PressStage }).__pressStage;
    s?.setOre(o);
  }, ore);
  await waitForSimTicks(page, 3, { what: 'the wheel re-pricing' });
}

// A LOGICAL point becomes a client point through the client's OWN transform —
// identity on desktop and in landscape, a 90° turn on a portrait-held phone,
// which is the whole reason it is never guessed on this side. Every caller now
// applies it inside the crossing that reads the geometry it is transforming
// (`pressBuildAffordance`, `pressWedge`), so there is no separate hop for it.

/**
 * A real press at the drawn centre of wedge `index`, through the device's own
 * event: a thumb tap on touch, a mouse click on desktop.
 *
 * Finding the wheel and turning the wedge's centre into a client point is ONE
 * crossing, not two: both readings come off the same seams on the same frame,
 * and the trigonometry between them does not need to travel to be done. It is
 * also strictly more correct — the rect the angle is measured from and the
 * transform applied to it are now guaranteed to be the same frame's.
 */
async function pressWedge(page: Page, index: number, count: number, touch: boolean): Promise<void> {
  const p = await page.evaluate(
    (want: { index: number; count: number }) => {
      interface Entry {
        id: string;
        bounds: { x: number; y: number; width: number; height: number };
      }
      const pr = (window as unknown as { __planetRush?: { layout: Entry[] } }).__planetRush;
      const b = pr?.layout.find((e) => e.id === 'build-wheel')?.bounds;
      if (!b) return null;
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      const r = b.width / 2;
      // Segment 0 sits at twelve o'clock and the rest run clockwise (build-wheel.ts).
      const angle = -Math.PI / 2 + (want.index * 2 * Math.PI) / want.count;
      const s = (window as unknown as { __pressStage?: PressStage }).__pressStage!;
      return s.clientPoint(cx + Math.cos(angle) * r * 0.6, cy + Math.sin(angle) * r * 0.6);
    },
    { index, count },
  );
  expect(p, 'the wheel is not drawn, so there is nothing to press').not.toBeNull();
  if (touch) await page.touchscreen.tap(p!.x, p!.y);
  else await page.mouse.click(p!.x, p!.y);
  await waitForSimTicks(page, 3, { what: 'the press to resolve' });
}

// ===========================================================================

test.describe('the Gantry/Bone wedge, through the real click path (u7-02)', () => {
  test('a real open draws the four-line stack, and the cost takes both of its colours', async ({
    page,
  }, testInfo) => {
    const touch = isTouchProject(testInfo.project.name);
    budgetTest({
      work: 'landscape boot → open the wheel through the real BUILD affordance → read the drawn wedges at two ore levels → one refused press on a capped wedge',
      measuredSeconds: 26,
    });

    await useLandscape(page);
    await bootDebug(page);
    await openWheelForReal(page, touch);

    const label = `${testInfo.project.name}/landscape`;

    // --- Flush: RADAR's 6 is payable, so its numeral is ore-yellow -----------
    await setOre(page, 8);
    let all = await drawnWedges(page);
    expect(all.length, `[${label}] the wheel drew no wedges`).toBe(5);

    const drawnRadius = (await registered(page, 'build-wheel'))!.width / 2;
    const radar = wedge(all, 'satellite')!;
    expect(radar.costLabel, `[${label}] the cost is one number — the cost (a0-03)`).toBe('6');
    expect(radar.costPaint, `[${label}] a payable cost is ore-yellow`).toBe('ore');
    expect(radar.caps, `[${label}] RADAR counts against its cap`).toBe(expectedCaps(drawnRadius, 0, 1));
    expect(radar.target, `[${label}] every wedge names what it spends on (GDD §2.5)`).toBe('YOUR STATION');

    // --- Short: the same numeral, in threat red (style-guide §2.1) -----------
    await setOre(page, 4);
    all = await drawnWedges(page);
    const short = wedge(all, 'satellite')!;
    expect(short.costLabel, `[${label}] the same number at 4 ore — only the COLOUR moves`).toBe('6');
    expect(short.costPaint, `[${label}] a cost that cannot be paid is threat red`).toBe('refused');

    // The carve-out's limits, on the same frame: red is spent ONLY on a numeral
    // whose price is out of reach. Not on a capped wedge, not on an inert one,
    // not on the wedge that opens a screen (style-guide §2.1, limits 1 and 2).
    for (const w of all) {
      if (w.costPaint !== 'refused') continue;
      expect(w.cost, `[${label}] ${w.id} drew red without a price`).not.toBeNull();
      expect(
        w.cost!,
        `[${label}] ${w.id} drew its cost red at ${w.cost} against a bank of 4 — red means "cannot pay", nothing else`,
      ).toBeGreaterThan(4);
    }
    // Both colours are on the ONE frame, which is the whole point of the pair:
    // 4 ore pays for a turret (3) and a repair (1) but not a shield (5) or a
    // radar (6), so the wheel is showing yellow and red side by side.
    expect(
      all.some((w) => w.costPaint === 'ore'),
      `[${label}] no payable cost drew in ore yellow`,
    ).toBe(true);
    expect(
      all.some((w) => w.costPaint === 'refused'),
      `[${label}] no unpayable cost drew in threat red`,
    ).toBe(true);

    // --- Capped: FULL, and a count rather than silence (closing u2-02) -------
    // The frozen showcase is not staged here — this is a LIVE match — so the caps
    // are whatever the opening seconds hold. Assert the grammar, not the number.
    const turret = wedge(all, 'turret')!;
    expect(turret.caps, `[${label}] TURRET must count against its cap`).toMatch(capsPattern(drawnRadius, 4));
    const shield = wedge(all, 'shield')!;
    expect(shield.caps, `[${label}] SHIELD must count against its cap`).toMatch(capsPattern(drawnRadius, 2));

    // --- The two wedges that are NOT capped ---------------------------------
    const repair = wedge(all, 'repair')!;
    expect(repair.caps, `[${label}] REPAIR REACTOR has a cooldown, not a cap`).toBe('');
    // p5-08 survives the restyle: the wedge still names the deal before the tap.
    expect(repair.sub, `[${label}] REPAIR REACTOR must still state its effect or its reason`).toMatch(
      /^(\+\d+ HP|REACTOR FULL|NO REPAIR|REPAIR in \d+s|NEED \d+ ORE)$/,
    );
    const upgrade = wedge(all, 'upgrade')!;
    expect(upgrade.cost, `[${label}] UPGRADE SHIP prices its rows in the panel, not here`).toBeNull();
    expect(upgrade.costLabel, `[${label}] UPGRADE SHIP keeps its arrow rather than a number`).toBe('OPEN ▸');
    expect(upgrade.caps, `[${label}] UPGRADE SHIP has no cap to count`).toBe('');
  });

  test('a real press on a capped wedge is refused — the count and the bank hold still', async ({
    page,
  }, testInfo) => {
    const touch = isTouchProject(testInfo.project.name);
    budgetTest({
      work: 'landscape boot → open the wheel → build to the shield cap → press the capped wedge for real → assert nothing moved',
      measuredSeconds: 30,
    });

    await useLandscape(page);
    await bootDebug(page);
    await openWheelForReal(page, touch);

    const label = `${testInfo.project.name}/landscape`;

    // Fund the bank well past a shield, then order shields until the wedge caps.
    // Every order is a REAL press on the drawn wedge, so this exercises the same
    // door a player uses — including the one that must eventually say no.
    const SHIELD_INDEX = 1; // WHEEL_ORDER: turret, shield, satellite, repair, upgrade
    await setOre(page, 99);
    for (let i = 0; i < 3; i++) {
      // Still governed by the DRAWN wedge — what the client rendered, not what
      // the model thinks. `pressWedge` now finds the wheel and applies the
      // client transform in its own single crossing, so a turn of this loop
      // costs three frames rather than four.
      if (wedge(await drawnWedges(page), 'shield')!.costLabel === 'FULL') break;
      await pressWedge(page, SHIELD_INDEX, 5, touch);
      await waitForSimTicks(page, 5, { what: 'the shield order to be counted' });
    }

    const capState = await drawnState(page);
    let all = capState.wedges;
    const drawnRadius = capState.wheel!.width / 2;
    const atCap = expectedCaps(drawnRadius, 2, 2);
    const capped = wedge(all, 'shield')!;
    expect(capped.caps, `[${label}] the SHIELD wedge should be at its cap`).toBe(atCap);
    expect(capped.costLabel, `[${label}] a capped wedge quotes no price`).toBe('FULL');
    expect(capped.costPaint, `[${label}] a capped cost is steel, never red — poverty is not the reason`).toBe(
      'spent',
    );
    expect(capped.ready, `[${label}] a capped wedge draws dark`).toBe(false);

    // The refusal itself: press it for real and prove NOTHING moved. Queued
    // construction counts against the cap (GDD §2.5), so this is also the proof
    // that a player cannot buy past one by tapping fast.
    // The bank BEFORE came off the same frame the cap state did (`drawnState`
    // above), so this costs no crossing of its own; the bank AFTER comes off the
    // same frame as the count it is asserted beside, which is the frame the
    // claim "nothing moved" is actually about.
    const bankBefore = capState.bank;
    await pressWedge(page, SHIELD_INDEX, 5, touch);
    await waitForSimTicks(page, 10, { what: 'any order the refused press might have placed' });
    const settled = await drawnState(page);
    all = settled.wedges;
    expect(wedge(all, 'shield')!.caps, `[${label}] the capped press moved the count`).toBe(atCap);
    expect(settled.bank, `[${label}] the capped press spent ore`).toBe(bankBefore);
  });
});

test.describe('PORTRAIT-HELD — the wheel drives through the landscape lock', () => {
  test('opens and reads correctly with the game root rotated 90°', async ({ page }, testInfo) => {
    test.skip(!isTouchProject(testInfo.project.name), 'portrait-held is a phone state');
    budgetTest({
      work: 'boot PORTRAIT-HELD → open the wheel through the real BUILD button → read the drawn wedges back',
      measuredSeconds: 20,
    });

    // No `useLandscape`: the phone profiles are portrait by default and the game
    // is landscape-locked, so this frame goes through the 90° rotation the tests
    // above never touch. A radial control verified in landscape proves nothing
    // about a held phone — this project has been bitten by exactly that (PR #93,
    // a layer registering in a different space than it drew in).
    await bootDebug(page);
    await openWheelForReal(page, true);

    const label = `${testInfo.project.name}/portrait-held`;
    await setOre(page, 4);
    const all = await drawnWedges(page);
    expect(all.length, `[${label}] the wheel drew no wedges portrait-held`).toBe(5);
    const bounds = (await registered(page, 'build-wheel'))!;
    const radar = wedge(all, 'satellite')!;
    expect(radar.costLabel, `[${label}] the bare cost survives the rotation`).toBe('6');
    expect(radar.costPaint, `[${label}] and so does the refused colour`).toBe('refused');
    expect(radar.caps, `[${label}] and so does the count`).toBe(expectedCaps(bounds.width / 2, 0, 1));

    // The wheel is still on screen inside the rotated LOGICAL viewport — the
    // space it is actually drawn in, which portrait-held is not the client's.
    const vp = await page.evaluate(() => {
      const s = (window as unknown as { __pressStage?: PressStage }).__pressStage!;
      return s.logicalViewport();
    });
    expect(bounds.x, `[${label}] the wheel spilled off the left edge`).toBeGreaterThanOrEqual(-1);
    expect(bounds.y, `[${label}] the wheel spilled off the top edge`).toBeGreaterThanOrEqual(-1);
    expect(bounds.x + bounds.width, `[${label}] the wheel spilled off the right edge`).toBeLessThanOrEqual(
      vp.width + 1,
    );
    expect(bounds.y + bounds.height, `[${label}] the wheel spilled off the bottom edge`).toBeLessThanOrEqual(
      vp.height + 1,
    );
  });
});
