/**
 * tests/mobile/upgrade-wheel-gantry.spec.ts — the Gantry/Bone UPGRADE wedge,
 * DRIVEN. OWNER: UI Engineer (u7-06, GDD §2.5, style-guide §2.1).
 *
 * The wedge's copy and its states are unit-green in `src/ui/upgrade-wheel.test.ts`
 * and its fit budget in `src/ui/hud-geometry.test.ts`. Neither can reach the
 * thing that actually broke on this screen family once before: **the real click
 * path.** This project shipped a wheel whose model tests were green while the
 * WEAPON wedge bounced back to the build wheel and upgrades were dead — the
 * seams said one thing and the pointer did another.
 *
 * So every interaction here is a REAL synthesized event: a `touchscreen.tap` on
 * the phone profiles, a `mouse.click` on desktop, and the real `E` and `Escape`
 * key bindings for the keyboard path — into the same `main.ts` handlers a thumb,
 * a mouse or a keyboard uses. The `?debug=1` seams are used only to READ BACK
 * what the shipped bundle drew (`__upgradeWheelStage.wedges()`) and to set the
 * bank, never to open a wheel or press a wedge.
 *
 * And the route in is the real one: nobody arrives at this screen directly. A
 * player opens the BUILD wheel and presses UPGRADE SHIP, so that is what these
 * do — the arrow this screen lives behind is part of the path under test.
 *
 * What it proves, per profile and in both orientations:
 *
 *  1. Reaching UPGRADE SHIP through a real press draws the Gantry stack: the
 *     name, the stat this tier moves, `cost/held`, and the ladder pips.
 *  2. The cost numeral takes BOTH of its ratified colours off the same wedge —
 *     signal yellow while it is payable, threat red the moment it is not
 *     (style-guide §2.1) — and nothing else on the wheel takes red.
 *  3. A maxed track quotes `MAX` in steel rather than a price, and still shows
 *     the value it finished at: this is the one screen ship stats appear on
 *     (GDD §2.5), so a finished track does not go blank.
 *  4. A real press on WEAPON opens the sub-wheel (it does not bounce to the
 *     build wheel), where DAMAGE and SPEED carry the same four lines.
 *  5. The keyboard path: `E` opens, `Escape` pops one level — sub-wheel to
 *     upgrade wheel to build wheel — the same gesture the hub tap performs.
 *  6. Every drawn wedge clears the 48 px touch floor at the radius the client
 *     actually drew, on the device it drew it on.
 *
 * Runs with the sim live throughout: the wheel is read from what was drawn, not
 * from a pinned frame.
 */
import { test, expect, type Page } from '@playwright/test';
import { budgetTest } from './budgets';
import { waitForSimTicks } from './sim-clock';

const TOUCH_PROJECTS = ['iphone', 'pixel'];
const isTouchProject = (name: string): boolean => TOUCH_PROJECTS.includes(name);

// --- Touch-visuals BUILD button geometry (mirrors src/platform/touch-visuals.ts)
//
// The centre these four numbers describe is computed IN THE PAGE, inside
// `pressBuildAffordance`, rather than here: the logical viewport it needs has to
// be read across the wire anyway, and doing the arithmetic on this side would
// mean a second crossing for a subtraction (see the round-trip note below).
const EDGE_MARGIN = 28;
const R_STICK = 64;
const BUILD_GAP = 18;
const R_BUILD = 38;

/**
 * The wheel radius at or above which a wedge carries the handoff's full copy
 * (`WHEEL_FULL_COPY_RADIUS`, src/art/materials.ts). Mirrored here rather than
 * imported, the same discipline `build-wheel-gantry.spec.ts` uses for the
 * touch-visuals geometry above: if it drifts, the assertion fails loudly naming
 * which form it got.
 */
const FULL_COPY_RADIUS = 188;

/** The platform floor for a tappable affordance, CSS px (GDD §2.4, §4.3). */
const TOUCH_TARGET_MIN = 48;

/** The hub disc radius as a fraction of the outer ring — both wheel profiles
 *  agree to within a rounding (`WHEEL_PROFILES`, .319 desktop / .32 phone), and
 *  the wedge ring starts there. Mirrored, like the constant above. */
const HUB_FRACTION = 0.319;

/** The stat line this profile should be drawing, given the drawn radius: the
 *  padded arrow where there is room for it, the compact one where there is not. */
function expectedStat(radius: number, current: string, next: string): string {
  return radius >= FULL_COPY_RADIUS ? `${current} → ${next}` : `${current}→${next}`;
}

/** The same as a pattern, where the values themselves are whatever hull the
 *  match dealt — two runs of digits (with an optional `%`) either side of the
 *  arrow, spaced or not according to the profile. */
function statPattern(radius: number): RegExp {
  const gap = radius >= FULL_COPY_RADIUS ? ' ' : '';
  return new RegExp(`^\\d+%?${gap}→${gap}\\d+%?$`);
}

// --- What the shipped view drew ---------------------------------------------

interface WeaponPip {
  track: string;
  label: string;
  tier: number;
  maxTier: number;
}

interface DrawnUpgradeWedge {
  kind: 'track' | 'weapon';
  track: string | null;
  label: string;
  tier: number;
  maxTier: number;
  current: string;
  next: string | null;
  cost: number | null;
  state: 'ready' | 'unaffordable' | 'maxed';
  summary: WeaponPip[] | null;
  stat: string;
  costLabel: string;
  tiers: string;
  ready: boolean;
  costPaint: 'ore' | 'refused' | 'spent' | 'none';
}

interface UpgradeStage {
  setOre(ore: number): { banked: number } | null;
  buyTier(i: number): { result: string; tier: number } | null;
  wedges(): DrawnUpgradeWedge[];
}

interface PressStage {
  clientPoint(x: number, y: number): { x: number; y: number };
  logicalViewport(): { width: number; height: number };
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * ── WHY THIS FILE COUNTS ITS ROUND TRIPS (a0-00b) ──────────────────────────
 * Profiled on PR #321's shard 2, `page.evaluate` accounted for **172 of the
 * 249 seconds** these six tests spent — across a hundred calls that each read a
 * getter or found an id in an array, and each cost **2–3 seconds**. Nothing was
 * computing for 2.5 s. A CDP `Runtime.evaluate` cannot run until the page's main
 * thread yields, and under the runner's software GL the main thread is painting
 * for very nearly the whole frame, so **one round trip costs about one frame** —
 * ~1 s there against ~16 ms here. This spec made ~17 of them per test; the
 * neighbours that finish in seconds make a handful. That, and not the work it
 * does, is why it took minutes and why `:375` and `:417` timed out at 300 s.
 *
 * So every read below is batched into as few crossings as the journey allows,
 * and reads that were separate calls a frame apart are now one call that answers
 * both. Not one assertion moves: the seams read are the same seams, the values
 * are the same values, and the presses are still real synthesized events.
 */

/** Read the drawn upgrade wedges off the real client. Read-back only. */
async function drawnWedges(page: Page): Promise<DrawnUpgradeWedge[]> {
  return page.evaluate(() => {
    const s = (window as unknown as { __upgradeWheelStage?: UpgradeStage }).__upgradeWheelStage;
    return s ? s.wedges() : [];
  });
}

const wedge = (all: DrawnUpgradeWedge[], label: string): DrawnUpgradeWedge | undefined =>
  all.find((w) => w.label === label);

/** What one crossing brings back: the wheels' drawn bounds and the wedges on
 *  whichever wheel is on top, read off the SAME frame — which is also why they
 *  can no longer disagree with each other by a frame. */
interface DrawnState {
  buildWheel: Rect | null;
  upgradeWheel: Rect | null;
  wedges: DrawnUpgradeWedge[];
}

/** The layout registry's record of what was drawn this frame, plus the wedges,
 *  in ONE round trip (see the note above). */
async function drawnState(page: Page): Promise<DrawnState> {
  return page.evaluate(() => {
    interface Entry {
      id: string;
      bounds: { x: number; y: number; width: number; height: number };
    }
    const pr = (window as unknown as { __planetRush?: { layout: Entry[] } }).__planetRush;
    const rect = (id: string): Entry['bounds'] | null => pr?.layout.find((e) => e.id === id)?.bounds ?? null;
    const s = (window as unknown as { __upgradeWheelStage?: UpgradeStage }).__upgradeWheelStage;
    return { buildWheel: rect('build-wheel'), upgradeWheel: rect('upgrade-wheel'), wedges: s ? s.wedges() : [] };
  });
}

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

/** A LOGICAL point in client space — identity on desktop and in landscape, a 90°
 *  turn on a portrait-held phone, which is the whole reason it goes through the
 *  client's own transform rather than being guessed here. */
async function toClient(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate((p: { x: number; y: number }) => {
    const s = (window as unknown as { __pressStage?: PressStage }).__pressStage!;
    return s.clientPoint(p.x, p.y);
  }, { x, y });
}

/**
 * A real press at a LOGICAL point, through the device's own event.
 *
 * It does NOT wait for the sim afterwards: every caller wants a settle of its
 * own length and used to add a second one on top, so the press paid two round
 * trips where the journey only ever needed the caller's. The wait is now the
 * caller's alone, and it is always still there.
 */
async function pressAt(page: Page, x: number, y: number, touch: boolean): Promise<void> {
  const p = await toClient(page, x, y);
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

/**
 * One real press on this device's BUILD affordance — the button under the left
 *  thumb on touch, the `E` binding on desktop (GDD §2.4's table, both cells).
 *
 * The touch path resolves the button's centre and puts it through the client's
 * own transform in ONE crossing: the viewport read and the transform were two
 * calls a frame apart, and the geometry between them is arithmetic that does not
 * need to come home to be done.
 */
async function pressBuildAffordance(page: Page, touch: boolean): Promise<void> {
  if (touch) {
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
  await waitForSimTicks(page, 4, { what: 'the build wheel opening' });
}

/**
 * Open the BUILD wheel through the REAL affordance, and prove it opened by the
 * layout registry rather than by a seam.
 *
 * Retries the press, and the guard is what makes that safe: the affordance is a
 * TOGGLE, so a blind second press would close a wheel the first one opened —
 * hence the registry check before every attempt. A retry is needed because the
 * precondition is the sim's, not the test's: the wheel only opens while the ship
 * is docked at its own station (`updateBuildWheel`), and on a loaded runner
 * running three projects the first press can land in the frames before the
 * client has resolved that. Waiting on the wheel alone would hang; pressing
 * again after a beat is the honest retry.
 */
async function openBuildForReal(page: Page, touch: boolean): Promise<Rect> {
  let bounds = await registered(page, 'build-wheel');
  for (let attempt = 0; attempt < 3 && !bounds; attempt++) {
    await pressBuildAffordance(page, touch);
    bounds = await registered(page, 'build-wheel');
    if (bounds) break;
    await waitForSimTicks(page, 10, { what: 'the ship to settle docked at its station' });
  }
  expect(bounds, 'three real presses on the BUILD affordance did not open the build wheel').not.toBeNull();
  // Handed back rather than re-read: the caller needs this rect to aim its next
  // press at, and re-reading it is a whole frame spent learning what we know.
  return bounds!;
}

/** A real press at the drawn centre of wedge `index` of `count`, on whichever
 *  wheel is currently on top. Segment 0 sits at twelve o'clock and the rest run
 *  clockwise — the one convention both wheels share. */
async function pressWedge(
  page: Page,
  bounds: Rect,
  index: number,
  count: number,
  touch: boolean,
): Promise<void> {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const r = bounds.width / 2;
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
  // 0.6 of the outer radius sits inside the wedge ring (0.32‥1.0), where the
  // words are drawn — the honest middle of the pressable wedge.
  await pressAt(page, cx + Math.cos(angle) * r * 0.6, cy + Math.sin(angle) * r * 0.6, touch);
}

/**
 * Get to the upgrade wheel the way a player does: open the BUILD wheel, then
 * press UPGRADE SHIP for real. Returns the upgrade wheel's drawn bounds.
 *
 * UPGRADE SHIP is index 4 of the build wheel's five segments (`WHEEL_ORDER`:
 * turret, shield, satellite, repair, upgrade).
 */
async function openUpgradeForReal(page: Page, touch: boolean): Promise<Rect> {
  const build = await openBuildForReal(page, touch);
  await pressWedge(page, build, 4, 5, touch);
  await waitForSimTicks(page, 7, { what: 'the upgrade wheel opening' });
  const upgrade = await registered(page, 'upgrade-wheel');
  expect(
    upgrade,
    'a real press on UPGRADE SHIP did not open the upgrade wheel — this is the exact bug that shipped once',
  ).not.toBeNull();
  return upgrade!;
}

/** Bank exactly `ore` and let the wheel redraw against it. */
async function setOre(page: Page, ore: number): Promise<void> {
  await page.evaluate((o) => {
    const s = (window as unknown as { __upgradeWheelStage?: UpgradeStage }).__upgradeWheelStage;
    s?.setOre(o);
  }, ore);
  await waitForSimTicks(page, 3, { what: 'the wheel re-pricing' });
}

/** Assert one wedge carries the whole Gantry stack rather than a subset of it. */
function expectStackedWedge(w: DrawnUpgradeWedge, radius: number, label: string): void {
  expect(w.stat, `[${label}] ${w.label} drew no stat line — this is the screen stats live on`).toMatch(
    statPattern(radius),
  );
  expect(w.costLabel, `[${label}] ${w.label} must price its next tier as cost/held`).toMatch(/^\d+\/\d+$/);
  expect(w.tiers, `[${label}] ${w.label} must pip where it sits on its ladder`).toMatch(/^[●○]+$/);
  expect(
    w.tiers.length,
    `[${label}] ${w.label} pipped ${w.tiers.length} rungs for a ladder of ${w.maxTier}`,
  ).toBe(w.maxTier);
}

// ===========================================================================

test.describe('the Gantry/Bone upgrade wedge, through the real click path (u7-06)', () => {
  test('UPGRADE SHIP opens it, and every wedge carries the four-line stack', async ({ page }, testInfo) => {
    const touch = isTouchProject(testInfo.project.name);
    budgetTest({
      work: 'landscape boot → open the build wheel through the real affordance → real press on UPGRADE SHIP → read the drawn upgrade wedges at two ore levels',
      measuredSeconds: 28,
    });

    await useLandscape(page);
    await bootDebug(page);
    const bounds = await openUpgradeForReal(page, touch);
    const radius = bounds.width / 2;
    const label = `${testInfo.project.name}/landscape`;

    // --- Flush: every track is payable, so every numeral is ore-yellow -------
    await setOre(page, 99);
    let all = await drawnWedges(page);
    expect(all.length, `[${label}] the upgrade wheel drew no wedges`).toBe(4);
    expect(
      all.map((w) => w.label),
      `[${label}] the main wheel is about the SHIP, with WEAPON opening the sub-wheel`,
    ).toEqual(['WEAPON', 'ENGINE', 'CARGO', 'HULL']);

    for (const w of all.filter((x) => x.kind === 'track')) {
      expectStackedWedge(w, radius, label);
      expect(w.costPaint, `[${label}] ${w.label} is payable at 99 ore`).toBe('ore');
      expect(w.ready, `[${label}] ${w.label} should draw bright`).toBe(true);
    }

    // The WEAPON wedge fills the same slots differently: its stat line is a pip
    // row per weapon track, and it quotes OPEN ▸ where the others quote a price —
    // the same words in the same slot as the build wheel's UPGRADE SHIP.
    const weapon = wedge(all, 'WEAPON')!;
    expect(weapon.costLabel, `[${label}] WEAPON opens a screen rather than spending`).toBe('OPEN ▸');
    expect(weapon.costPaint, `[${label}] a signpost is chalk, never a cost colour`).toBe('none');
    expect(weapon.cost, `[${label}] WEAPON quotes no price`).toBeNull();
    expect(weapon.stat, `[${label}] WEAPON says its tracks' tiers at a glance`).toMatch(
      /^DAMAGE [●○]+\n *SPEED [●○]+$/,
    );

    // --- Short: the same numerals, in threat red (style-guide §2.1) ---------
    // 1 ore pays for nothing on this ladder (the cheapest tier is 2).
    await setOre(page, 1);
    all = await drawnWedges(page);
    for (const w of all.filter((x) => x.kind === 'track')) {
      expect(w.costLabel, `[${label}] ${w.label} re-prices against the bank`).toMatch(/^\d+\/1$/);
      expect(w.costPaint, `[${label}] ${w.label} cannot be paid for at 1 ore`).toBe('refused');
      expect(w.ready, `[${label}] an unaffordable wedge draws dark, with a reason`).toBe(false);
      // The carve-out's limit: red is spent ONLY on a numeral whose price is out
      // of reach. Nothing else on this wheel takes it.
      expect(w.cost, `[${label}] ${w.label} drew red without a price`).not.toBeNull();
      expect(
        w.cost!,
        `[${label}] ${w.label} drew red at ${w.cost} against a bank of 1 — red means "cannot pay", nothing else`,
      ).toBeGreaterThan(1);
    }
    expect(
      wedge(all, 'WEAPON')!.costPaint,
      `[${label}] a broke player still gets to see the weapon tracks exist`,
    ).toBe('none');
  });

  test('a maxed track quotes MAX in steel and still shows what it finished at', async ({ page }, testInfo) => {
    const touch = isTouchProject(testInfo.project.name);
    budgetTest({
      work: 'landscape boot → real route to the upgrade wheel → buy CARGO to the top of its ladder through the sim → read the finished wedge back',
      measuredSeconds: 30,
    });

    await useLandscape(page);
    await bootDebug(page);
    const bounds = await openUpgradeForReal(page, touch);
    const label = `${testInfo.project.name}/landscape`;

    await setOre(page, 999);
    // Buy CARGO to the top through the sim's own validated purchase. The point of
    // this test is the drawn state of a FINISHED ladder, not the press that gets
    // there — the press path has its own test above.
    // The read that decides whether to buy and the buy itself go over in ONE
    // crossing: they were a frame apart, four times over, which is twelve
    // seconds of runner spent asking a question whose answer is already on the
    // same object as the button. `maxed` is still read from the DRAWN wedge, so
    // the loop is still governed by what the client rendered.
    const CARGO_FLAT_INDEX = 2; // TRACK_ORDER: power, engine, cargo, hull
    for (let i = 0; i < 4; i++) {
      const maxed = await page.evaluate((idx) => {
        const s = (window as unknown as { __upgradeWheelStage?: UpgradeStage }).__upgradeWheelStage;
        if (s?.wedges().find((w) => w.label === 'CARGO')?.state === 'maxed') return true;
        s?.buyTier(idx);
        return false;
      }, CARGO_FLAT_INDEX);
      if (maxed) break;
      await waitForSimTicks(page, 4, { what: 'the tier to be counted' });
    }

    const finished = await drawnState(page);
    const cargo = wedge(finished.wedges, 'CARGO')!;
    expect(cargo.state, `[${label}] CARGO should be at the top of its ladder`).toBe('maxed');
    expect(cargo.costLabel, `[${label}] a finished ladder quotes no price`).toBe('MAX');
    expect(cargo.costPaint, `[${label}] MAX is steel, never red — poverty is not the reason`).toBe('spent');
    expect(cargo.ready, `[${label}] a finished wedge draws dark`).toBe(false);
    // ...and it has NOT gone blank. This is the one screen ship stats appear on
    // (GDD §2.5), so a track that is done still says what it finished at.
    expect(cargo.current, `[${label}] a maxed track still shows its value`).toMatch(/^\d+$/);
    expect(cargo.stat, `[${label}] the stat line is the value, not the word MAX twice`).toBe(cargo.current);
    expect(cargo.tiers, `[${label}] a finished ladder fills every pip`).toBe('●'.repeat(cargo.maxTier));

    // The wheel is still the same wheel around it — off the same frame the
    // finished wedge was read from, which is the frame the claim is about.
    expect(finished.upgradeWheel?.width).toBe(bounds.width);
  });

  test('a real press on WEAPON drills in — it does not bounce to the build wheel', async ({ page }, testInfo) => {
    const touch = isTouchProject(testInfo.project.name);
    budgetTest({
      work: 'landscape boot → real route to the upgrade wheel → real press on the WEAPON wedge → read the sub-wheel back → Escape out one level',
      measuredSeconds: 30,
    });

    await useLandscape(page);
    await bootDebug(page);
    const bounds = await openUpgradeForReal(page, touch);
    const radius = bounds.width / 2;
    const label = `${testInfo.project.name}/landscape`;
    await setOre(page, 99);

    // WEAPON is wedge 0 — twelve o'clock on the main wheel.
    await pressWedge(page, bounds, 0, 4, touch);
    await waitForSimTicks(page, 7, { what: 'the sub-wheel opening' });

    // Both wheels' bounds and the wedges now on top, off ONE frame — three
    // crossings collapsed into one, and the three can no longer disagree by a
    // frame about which wheel the press landed on.
    const after = await drawnState(page);
    expect(
      after.upgradeWheel,
      `[${label}] the WEAPON press left the upgrade wheel entirely — the exact shipped bug`,
    ).not.toBeNull();
    expect(
      after.buildWheel,
      `[${label}] the WEAPON press bounced back to the build wheel`,
    ).toBeNull();

    const sub = after.wedges;
    expect(
      sub.map((w) => w.label),
      `[${label}] the sub-wheel draws the weapon-group tracks`,
    ).toEqual(['DAMAGE', 'SPEED']);
    for (const w of sub) expectStackedWedge(w, radius, label);

    // Escape pops ONE level — the keyboard twin of the hub tap (field report
    // v0.2.4). Back on the main upgrade wheel, not out of the wheel entirely.
    await page.keyboard.press('Escape');
    await waitForSimTicks(page, 4, { what: 'the back to resolve' });
    expect(
      (await drawnWedges(page)).map((w) => w.label),
      `[${label}] Escape did not land back on the main upgrade wheel`,
    ).toEqual(['WEAPON', 'ENGINE', 'CARGO', 'HULL']);

    // ...and again pops to the build wheel, never straight to the match.
    await page.keyboard.press('Escape');
    await waitForSimTicks(page, 4, { what: 'the second back to resolve' });
    expect(
      await registered(page, 'build-wheel'),
      `[${label}] a second Escape should land on the build wheel, one level at a time`,
    ).not.toBeNull();
  });

  test('every drawn wedge is a thumb target on the device that drew it', async ({ page }, testInfo) => {
    const touch = isTouchProject(testInfo.project.name);
    budgetTest({
      work: 'landscape boot → real route to the upgrade wheel → measure the drawn wedge arc and ring depth against the 48px floor',
      measuredSeconds: 22,
    });

    await useLandscape(page);
    await bootDebug(page);
    const bounds = await openUpgradeForReal(page, touch);
    const label = `${testInfo.project.name}/landscape`;

    const count = (await drawnWedges(page)).length;
    const outer = bounds.width / 2;
    const inner = outer * HUB_FRACTION;
    const mid = (outer + inner) / 2;
    const arc = (2 * Math.PI * mid) / count;
    const depth = outer - inner;

    // The headless budget (src/ui/hud-geometry.test.ts) computes this from the
    // viewport; this computes it from the radius the client ACTUALLY drew, which
    // is the number a thumb meets.
    expect(
      Math.min(arc, depth),
      `[${label}] a drawn wedge is ${arc.toFixed(0)}px of arc by ${depth.toFixed(0)}px deep at r=${outer.toFixed(0)}`,
    ).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN);
    // The hub BACK disc is a target too — it is the only way out on touch.
    expect(2 * inner, `[${label}] the hub BACK disc is ${(2 * inner).toFixed(0)}px across`).toBeGreaterThanOrEqual(
      TOUCH_TARGET_MIN,
    );
  });
});

test.describe('PORTRAIT-HELD — the upgrade wheel drives through the landscape lock', () => {
  test('opens through a real thumb and reads correctly with the root rotated 90°', async ({ page }, testInfo) => {
    test.skip(!isTouchProject(testInfo.project.name), 'portrait-held is a phone state');
    budgetTest({
      work: 'boot PORTRAIT-HELD → real BUILD button → real press on UPGRADE SHIP → read the drawn wedges back and check they stayed on screen',
      measuredSeconds: 26,
    });

    // No `useLandscape`: the phone profiles are portrait by default and the game
    // is landscape-locked, so this frame goes through the 90° rotation the tests
    // above never touch. A radial control verified in landscape proves nothing
    // about a held phone — this project has been bitten by exactly that (PR #93,
    // a layer registering in a different space than it drew in).
    await bootDebug(page);
    const bounds = await openUpgradeForReal(page, true);
    const radius = bounds.width / 2;
    const label = `${testInfo.project.name}/portrait-held`;

    await setOre(page, 99);
    const all = await drawnWedges(page);
    expect(all.length, `[${label}] the upgrade wheel drew no wedges portrait-held`).toBe(4);
    for (const w of all.filter((x) => x.kind === 'track')) {
      expectStackedWedge(w, radius, label);
      expect(w.costPaint, `[${label}] the cost colour survives the rotation`).toBe('ore');
    }
    expect(wedge(all, 'WEAPON')!.costLabel, `[${label}] and so does the OPEN signpost`).toBe('OPEN ▸');

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

test.describe('the stat line adapts to the arc it is drawn on (u7-06)', () => {
  test('the profile decides the padding, and both values survive either way', async ({ page }, testInfo) => {
    const touch = isTouchProject(testInfo.project.name);
    budgetTest({
      work: 'landscape boot → real route to the upgrade wheel → assert the stat line takes the form this radius calls for',
      measuredSeconds: 22,
    });

    await useLandscape(page);
    await bootDebug(page);
    const bounds = await openUpgradeForReal(page, touch);
    const radius = bounds.width / 2;
    const label = `${testInfo.project.name}/landscape`;
    await setOre(page, 99);

    const engine = wedge(await drawnWedges(page), 'ENGINE')!;
    // Whatever hull the match dealt, the stat line is exactly `current → next`
    // in the form this radius calls for — padded on a desktop, tight on a phone.
    expect(engine.next, `[${label}] ENGINE has a next tier to quote at 99 ore`).not.toBeNull();
    expect(
      engine.stat,
      `[${label}] at r=${radius.toFixed(0)} the stat line should be ${
        radius >= FULL_COPY_RADIUS ? 'padded' : 'compact'
      }`,
    ).toBe(expectedStat(radius, engine.current, engine.next!));
    // Nothing is dropped by the compact form: both values are still on the line.
    expect(engine.stat, `[${label}] the current value left the line`).toContain(engine.current);
    expect(engine.stat, `[${label}] the next value left the line`).toContain(engine.next!);
  });
});
