/**
 * tests/live-stage/minimap.spec.ts — the minimap, drawn and driven on the REAL
 * booted client. OWNER: UI Engineer (GDD §2.2; field request v0.2.2).
 *
 * The model is unit-green (src/ui/minimap.test.ts) — the fit, the two-state
 * toggle, the scene. What a unit test cannot reach is the last mile: that the
 * shipped bundle routes a REAL click into the toggle, redraws the two states, and
 * tracks the local ship's dot as it moves. This spec proves exactly that, with
 * real input (the p1a rule):
 *
 *   - a click on the collapsed corner square EXPANDS the overlay;
 *   - a click on the overlay COLLAPSES it again;
 *   - the local ship's dot MOVES on the map as the player thrusts (two frames).
 *
 * **u6-01 — the press OFF the open radar.** The overlay used to close only when the
 * press landed on it; a press outside fell through and *flew the ship* while the
 * overlay stayed open. That defect lived exactly where a unit test cannot see it —
 * in which layer receives a real press — so it is proven here with real synthesized
 * input on the canvas, on three profiles (desktop pointer, landscape-held touch,
 * PORTRAIT-held touch through the landscape lock), each asserting BOTH halves:
 * the overlay dismisses, and the downstream that used to receive the press (the
 * Tap-Commander pilot on desktop, the thrust stick on touch) received nothing.
 * Each also re-presses the SAME point once COLLAPSED and asserts it DOES reach
 * gameplay — the guard that stops the fix from eating flight input.
 *
 * It reads the drawn state back through the UI lane's `__minimapStage` seam
 * (installed in src/main.ts, reading `Hud.debugMinimap()`), which reports the
 * active rect (so the test knows where to click), the toggle state, and the
 * own-ship dot's screen position. Runs WITHOUT `?freeze=1`: the ship's motion and
 * the toggle both live on the running loop, which a pinned frame cannot show.
 *
 * Desktop profile (the live-stage config): logical == physical (no landscape
 * rotation), so the rect the seam reports maps straight to click coordinates.
 */
import { test, expect, type Page, type CDPSession } from '@playwright/test';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface DrawnMinimap {
  expanded: boolean;
  rect: Rect;
  ownDot: { x: number; y: number } | null;
  stationCount: number;
  shipCount: number;
  oreCount: number;
  satelliteCount: number;
  coverageCount: number;
  collapseRing: boolean;
}
interface Point {
  x: number;
  y: number;
}
interface MinimapStage {
  state(): DrawnMinimap;
  /** The LOGICAL (landscape) viewport the map lays out in. */
  viewport(): { width: number; height: number };
  /** LOGICAL → PHYSICAL (CSS px) — the landscape lock's rotation, so a portrait
   *  handset's real press lands where the logical point actually is. */
  physicalPoint(lx: number, ly: number): Point;
  buildSatellite(): { satRange: number; enemyDist: number } | null;
  killSatellite(): boolean;
}
/** The Tap-Commander seam (Platform's, src/main.ts `__tapCommanderStage`) — the
 *  subset the u6-01 tests read. It is the honest downstream of `main.ts:1503`: in
 *  the tap scheme a press the minimap does NOT consume becomes a pilot order that
 *  flies the ship, which is exactly what an open radar used to let through. */
interface TapCommanderStage {
  stage(): { ship: Point; bot: Point; botId: number } | null;
  order(): { kind: 'waypoint' | 'target' | 'none' };
  readout(): { scheme: string; shipPos: Point | null; firing: boolean; alive: boolean };
}
/** `window.__planetRush.input` (src/platform/debug-hook.ts) — the abstract input
 *  the SIM was handed this frame. `thrust` is the touch answer to "did a stick
 *  engage under that press": a dynamic stick dragged is thrust the sim received. */
interface InputReadout {
  frame: number;
  types: string[];
  fire: boolean;
  thrust: Point;
}
interface StageWindow {
  __minimapStage?: MinimapStage;
  __tapCommanderStage?: TapCommanderStage;
  __planetRush?: {
    input?: InputReadout;
    /** The layout registry the same frame fills — every affordance actually on
     *  screen, in LOGICAL space, so the outside press can dodge them all. */
    layout?: { id: string; bounds: Rect }[];
  };
}
declare const window: Window & StageWindow;

const CENTRE = (r: Rect): { x: number; y: number } => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

async function bootMinimap(page: Page): Promise<DrawnMinimap> {
  await page.goto('/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__minimapStage?.state === 'function', undefined, {
    timeout: 20_000,
  });
  // Wait until the world is wired (stations fed), the minimap is actually drawing,
  // and the layout registry has this frame's affordances in it — the u6-01 tests
  // choose their press point against that registry, so an empty one would let them
  // press a control instead of empty space.
  await page.waitForFunction(
    () => {
      const s = window.__minimapStage?.state();
      const layout = window.__planetRush?.layout;
      return !!s && s.rect.width > 0 && s.stationCount > 0 && Array.isArray(layout) && layout.length > 0;
    },
    undefined,
    { timeout: 20_000 },
  );
  return page.evaluate(() => window.__minimapStage!.state());
}

// ---------------------------------------------------------------------------
// u6-01 — "with the radar open, a press outside it flies your ship"
//
// The shared fixture for the outside press. It is computed from the DRAWN rect
// and the live logical viewport (the `__minimapStage` seam), never hardcoded, and
// the test asserts it really is outside — a layout change must not be able to
// quietly move "outside" onto the map and make these tests vacuous.
//
// Reading WHERE to press through a seam is fine; the press itself is a real
// synthesized pointer/touch on the canvas, because the defect is precisely about
// which layer receives a real press ("test the door as a door").
// ---------------------------------------------------------------------------

interface OutsidePress {
  /** The press point in LOGICAL (landscape) space, where the map lays out. */
  logical: Point;
  /** The same point in PHYSICAL CSS px — where a real press must actually land.
   *  Identical to `logical` unless the handset is held PORTRAIT (landscape lock). */
  physical: Point;
  /** The drag end for the touch profiles, physical CSS px — a stick that engaged
   *  under this press would produce thrust across this drag. */
  physicalDragTo: Point;
  /** Proof the fixture is honest: the point is outside the drawn minimap rect. */
  insideDrawnRect: boolean;
  /** Everything the layout registry had on screen when the point was chosen —
   *  reported so a failure says what the press was dodging. */
  blockerIds: string[];
}

/**
 * A press point in the LEFT half — the thrust stick's own territory (GDD §2.4), so
 * "no stick engaged" is asserted exactly where a stick *would* have engaged — that
 * is clear of the drawn minimap AND of every other affordance registered on screen.
 *
 * That second half is not fussiness: the first cut of this test pressed a hardcoded
 * left-mid point and landed on the touch BUILD button (the ship spawns docked, so
 * it is up), which claims presses *before* the minimap in `main.ts` — the press
 * opened the build wheel and the test read a dismissal that never happened. So the
 * point is chosen against `window.__planetRush.layout`, the registry the same frame
 * fills, and the only registered rect it is allowed to sit in is the left stick zone
 * (which is the point). A layout change moves the press rather than breaking it.
 */
async function outsidePress(page: Page): Promise<OutsidePress> {
  const found = await page.evaluate(() => {
    const stage = window.__minimapStage!;
    const rect = stage.state().rect;
    const vp = stage.viewport();
    const layout = window.__planetRush?.layout ?? [];
    // Treat every registered affordance as claiming a press before the glance map
    // does — a deny-list, so a control added later is dodged automatically rather
    // than silently pressed. The exceptions are the entries that provably claim
    // nothing: the left stick zone (whose whole job is to receive this press), and
    // the sim-space overlays that merely FOLLOW entities across the screen —
    // nameplates and hull bars span most of the arena and are pure readouts, so
    // counting them would leave no empty space anywhere.
    const INERT = ['touch-left-stick', 'nameplates', 'healthbars', 'ship-local'];
    const blockers = layout.filter((e) => !INERT.includes(e.id)).map((e) => e.bounds);
    const PAD = 16;
    const clear = (r: { x: number; y: number; width: number; height: number }, x: number, y: number): boolean =>
      x < r.x - PAD || x > r.x + r.width + PAD || y < r.y - PAD || y > r.y + r.height + PAD;

    const dragBy = vp.width * 0.09;
    for (const fy of [0.5, 0.34, 0.26, 0.62, 0.2, 0.74]) {
      for (const fx of [0.12, 0.2, 0.28, 0.07, 0.36]) {
        const x = vp.width * fx;
        const y = vp.height * fy;
        if (x > vp.width * 0.45) continue; // must stay in the LEFT (thrust) half
        if (x - dragBy < 4) continue; // …with room for the drag to stay on screen
        if (!clear(rect, x, y)) continue;
        if (!blockers.every((b) => clear(b, x, y))) continue;
        return {
          logical: { x, y },
          physical: stage.physicalPoint(x, y),
          physicalDragTo: stage.physicalPoint(x - dragBy, y),
          insideDrawnRect: false,
          blockerIds: layout.map((e) => e.id),
        };
      }
    }
    return {
      failed: true as const,
      rect,
      vp,
      registry: layout.map((e) => ({ id: e.id, bounds: e.bounds })),
    };
  });
  expect(
    'failed' in found!,
    `no press point clear of the map and every registered affordance: ${JSON.stringify(found)}`,
  ).toBe(false);
  return found as OutsidePress;
}

/** Open the overlay with a REAL press on the collapsed corner (the gesture the
 *  player uses), and return the drawn state once it is up. */
async function openRadar(page: Page, press: (p: Point) => Promise<void>): Promise<DrawnMinimap> {
  const collapsed = await page.evaluate(() => {
    const stage = window.__minimapStage!;
    const rect = stage.state().rect;
    const c = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    return stage.physicalPoint(c.x, c.y);
  });
  await press(collapsed);
  await page.waitForFunction(() => window.__minimapStage!.state().expanded === true, undefined, {
    timeout: 10_000,
  });
  return page.evaluate(() => window.__minimapStage!.state());
}

/** The abstract input the sim was handed this frame. */
async function readInput(page: Page): Promise<InputReadout> {
  return page.evaluate(() => window.__planetRush!.input!);
}

/**
 * A real touch DRAG (CDP), read mid-hold and then released — the same shape the
 * parity suite uses. A tap alone could never prove "no stick engaged": a dynamic
 * stick that engages under a motionless thumb reports zero thrust anyway, so the
 * press has to actually DRAG for the assertion to mean anything.
 */
async function dragAndReadThrust(page: Page, from: Point, to: Point): Promise<InputReadout> {
  const client: CDPSession = await page.context().newCDPSession(page);
  try {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
    for (let i = 1; i <= 6; i++) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: from.x + ((to.x - from.x) * i) / 6, y: from.y + ((to.y - from.y) * i) / 6 }],
      });
    }
    await page.waitForTimeout(250); // a handful of fixed ticks while held
    return await readInput(page);
  } finally {
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(() => {});
    await client.detach();
  }
}

const THRUST_MAG = (r: InputReadout): number => Math.hypot(r.thrust.x, r.thrust.y);

test.describe('the minimap draws and toggles on the real booted client', () => {
  test('a real click toggles collapsed ↔ expanded', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    const initial = await bootMinimap(page);
    expect(initial.expanded, 'the minimap boots collapsed').toBe(false);
    expect(initial.ownDot, 'the local ship dot is drawn on the corner map').not.toBeNull();

    // --- Click the collapsed corner → the overlay EXPANDS --------------------
    const collapsedCentre = CENTRE(initial.rect);
    await page.mouse.click(collapsedCentre.x, collapsedCentre.y);
    await page.waitForFunction(() => window.__minimapStage!.state().expanded === true, undefined, {
      timeout: 10_000,
    });
    const expanded = await page.evaluate(() => window.__minimapStage!.state());
    expect(expanded.expanded, 'a click on the corner expands the overlay').toBe(true);
    // The overlay is larger than the corner square it replaced.
    expect(expanded.rect.width, 'the overlay is bigger than the corner').toBeGreaterThan(initial.rect.width);

    await page.screenshot({ path: 'tests/live-stage/minimap-expanded-evidence.png' });

    // --- Click the overlay → it COLLAPSES back --------------------------------
    const overlayCentre = CENTRE(expanded.rect);
    await page.mouse.click(overlayCentre.x, overlayCentre.y);
    await page.waitForFunction(() => window.__minimapStage!.state().expanded === false, undefined, {
      timeout: 10_000,
    });
    const collapsed = await page.evaluate(() => window.__minimapStage!.state());
    expect(collapsed.expanded, 'a click on the overlay collapses it again').toBe(false);

    await page.screenshot({ path: 'tests/live-stage/minimap-collapsed-evidence.png' });

    expect(pageErrors, `no page errors: ${pageErrors.join('\n')}`).toEqual([]);
  });

  test('u6-01: with the radar OPEN, a real click OUTSIDE it dismisses it and never flies the ship', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    await bootMinimap(page);

    // Stage the downstream that the defect used to reach. In the Tap-Commander
    // scheme a click `main.ts:1503` does NOT consume becomes a pilot MOVE order —
    // "the ship flies" made observable. The stage parks the local ship still at the
    // arena centre with the field cleared, and clears any standing order.
    await page.waitForFunction(() => typeof window.__tapCommanderStage?.stage === 'function', undefined, {
      timeout: 20_000,
    });
    const staged = await page.evaluate(() => window.__tapCommanderStage!.stage());
    expect(staged, 'the tap-commander stage parked a ship + a bot').not.toBeNull();
    await page.waitForFunction(() => window.__tapCommanderStage!.readout().scheme === 'tap', undefined, {
      timeout: 10_000,
    });
    const parked = await page.evaluate(() => window.__tapCommanderStage!.readout());
    expect(parked.shipPos, 'the local ship is in the world').not.toBeNull();

    // Open the radar with a real click on the corner square.
    const expanded = await openRadar(page, async (p) => page.mouse.click(p.x, p.y));
    expect(expanded.expanded).toBe(true);
    await page.screenshot({ path: 'tests/live-stage/minimap-dismiss-open-evidence.png' });

    // The press the field report is about: a real click on empty screen, OFF the
    // overlay, while it is open.
    const off = await outsidePress(page);
    expect(off.insideDrawnRect, 'the fixture point really is off the overlay').toBe(false);
    await page.mouse.click(off.physical.x, off.physical.y);

    // 1. It dismisses.
    await page.waitForFunction(() => window.__minimapStage!.state().expanded === false, undefined, {
      timeout: 10_000,
    });

    // 2. …and it went NOWHERE else. No pilot order was taken, so the ship was never
    //    told to fly — the actual bug, asserted at the layer that used to receive
    //    the press rather than by re-reading the minimap.
    await page.waitForTimeout(300); // give an order that WAS taken time to show up
    const after = await page.evaluate(() => ({
      minimap: window.__minimapStage!.state(),
      order: window.__tapCommanderStage!.order(),
      readout: window.__tapCommanderStage!.readout(),
    }));
    expect(after.minimap.expanded, 'the press off the open radar dismissed it').toBe(false);
    expect(after.order.kind, 'no pilot order — the press never reached gameplay').toBe('none');
    const drift = Math.hypot(
      after.readout.shipPos!.x - parked.shipPos!.x,
      after.readout.shipPos!.y - parked.shipPos!.y,
    );
    // The parked ship has no order and no thrust, so it should not have travelled;
    // the tolerance only covers incidental sim jostle, not a flight.
    expect(drift, `the ship did not fly (drifted ${drift.toFixed(1)} world units)`).toBeLessThan(20);

    await page.screenshot({ path: 'tests/live-stage/minimap-dismiss-outside-evidence.png' });

    // 3. The asymmetry, on the real client: the SAME click, now that the map is
    //    COLLAPSED, must fall through and fly the ship. If this ever stops
    //    happening, the fix has started eating gameplay input — the worse bug.
    await page.mouse.click(off.physical.x, off.physical.y);
    await page.waitForFunction(() => window.__tapCommanderStage!.order().kind !== 'none', undefined, {
      timeout: 10_000,
    });
    const fellThrough = await page.evaluate(() => window.__tapCommanderStage!.order());
    expect(fellThrough.kind, 'collapsed: the same press reaches gameplay, as it must').not.toBe('none');
    expect(
      await page.evaluate(() => window.__minimapStage!.state().expanded),
      'and the collapsed map did not open from a press that missed it',
    ).toBe(false);

    expect(pageErrors, `no page errors: ${pageErrors.join('\n')}`).toEqual([]);
  });

  test('the local ship dot tracks the player thrusting (two frames)', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    const initial = await bootMinimap(page);
    expect(initial.ownDot, 'the local ship dot is drawn').not.toBeNull();
    const before = initial.ownDot!;

    // Real input: hold thrust (W) so the local ship flies across the arena, then
    // read the own-ship dot again — it must have moved on the map (dots track sim
    // positions, GDD §2.2). Keyboard is genuine device input, the p1a rule.
    await page.keyboard.down('KeyW');
    await page.waitForFunction(
      (b) => {
        const dot = window.__minimapStage!.state().ownDot;
        if (!dot) return false;
        const dx = dot.x - b.x;
        const dy = dot.y - b.y;
        return dx * dx + dy * dy > 4; // moved > 2px on the minimap
      },
      before,
      { timeout: 10_000 },
    );
    const moved = await page.evaluate(() => window.__minimapStage!.state().ownDot);
    await page.keyboard.up('KeyW');

    expect(moved, 'the own-ship dot is still drawn after moving').not.toBeNull();
    const dx = moved!.x - before.x;
    const dy = moved!.y - before.y;
    expect(Math.hypot(dx, dy), 'the own-ship dot moved as the ship thrust').toBeGreaterThan(2);

    expect(pageErrors, `no page errors: ${pageErrors.join('\n')}`).toEqual([]);
  });

  test('the minimap is fog-of-war: a radar satellite reveals coverage, killing it collapses it', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    // The map boots as fog-of-war (feature f1): coverage is the local player's own
    // ship + station discs, so there is always at least one disc. We wait for that,
    // then STAGE a satellite through the seam — the fog itself is computed by the
    // real pipeline (`../sim/sensing` → `feedMinimap` → the pure scene), so the
    // seam cannot fake the wiring it proves.
    const before = await bootMinimap(page);
    expect(before.coverageCount, 'fog is active — the local player already senses a slice').toBeGreaterThan(0);

    // --- Build a satellite → a LARGE coverage disc appears + a distant enemy is
    //     revealed under it (the enemy is parked in the satellite-only band) ------
    const staged = await page.evaluate(() => window.__minimapStage!.buildSatellite());
    expect(staged, 'a local station + an enemy were available to stage').not.toBeNull();
    // The staged geometry is honest: the enemy sits inside the satellite's reach.
    expect(staged!.enemyDist, 'enemy is within the satellite sensor range').toBeLessThan(staged!.satRange);

    await page.waitForFunction(
      (b) => {
        const s = window.__minimapStage!.state();
        return s.coverageCount > b.coverageCount && s.shipCount > b.shipCount;
      },
      before,
      { timeout: 10_000 },
    );
    const withSat = await page.evaluate(() => window.__minimapStage!.state());
    expect(withSat.coverageCount, 'the satellite adds a coverage disc').toBeGreaterThan(before.coverageCount);
    expect(withSat.satelliteCount, 'the satellite itself draws as a dot').toBeGreaterThan(before.satelliteCount);
    expect(withSat.shipCount, 'the distant enemy is revealed under the new coverage').toBeGreaterThan(
      before.shipCount,
    );

    await page.screenshot({ path: 'tests/live-stage/minimap-fog-coverage-evidence.png' });

    // --- Kill the satellite → its coverage collapses the same tick; the distant
    //     enemy it revealed drops off the map (the satellite-killed moment) -------
    const killed = await page.evaluate(() => window.__minimapStage!.killSatellite());
    expect(killed, 'the staged satellite was there to kill').toBe(true);

    await page.waitForFunction(
      (w) => {
        const s = window.__minimapStage!.state();
        return s.coverageCount < w.coverageCount && s.shipCount < w.shipCount;
      },
      withSat,
      { timeout: 10_000 },
    );
    const afterKill = await page.evaluate(() => window.__minimapStage!.state());
    expect(afterKill.coverageCount, 'the satellite coverage disc is gone').toBeLessThan(withSat.coverageCount);
    expect(afterKill.shipCount, 'the distant enemy vanished with its coverage').toBeLessThan(withSat.shipCount);

    await page.screenshot({ path: 'tests/live-stage/minimap-fog-collapsed-evidence.png' });

    expect(pageErrors, `no page errors: ${pageErrors.join('\n')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The TOUCH profile — brief item 4, "Real input, both profiles". The fog wiring
// is device-independent (feedMinimap does not branch on touch), but the toggle
// GESTURE and the collapsed-corner geometry are: a phone gets a *really small*
// corner left of the FIRE column, and the toggle is a tap, not a click. This block
// overrides the project's desktop `use` with a landscape-phone touch context — the
// spec owns which profiles ITS tests exercise, so the shared live-stage config
// (Platform's lane) stays desktop — and drives the SAME build→reveal→kill cycle
// with a REAL TAP toggle, proving the sensed-state reads on touch too and both
// states fog identically on a phone.
// ---------------------------------------------------------------------------
test.describe('the minimap is fog-of-war on TOUCH too (real tap input, brief item 4)', () => {
  test.use({
    // A landscape handset (post landscape-lock, so no rotation prompt) — the wider
    // of the two profiles the model pins the placement on (PHONE_WIDE).
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });

  test('a real tap toggles the fogged corner; a satellite reveals coverage, killing it collapses it', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    const before = await bootMinimap(page);
    expect(before.expanded, 'the touch minimap boots collapsed').toBe(false);
    expect(before.coverageCount, 'fog is active on touch — the player already senses a slice').toBeGreaterThan(0);
    // The touch corner is the *really small* glance object (the developer spec), so
    // this is genuinely the phone geometry, not the desktop square.
    expect(before.rect.width, 'the collapsed corner is the small touch square').toBeLessThan(120);

    // --- Real TOUCH input: tap the collapsed corner → the overlay EXPANDS, and the
    //     expanded overlay is STILL fog-of-war (both states fog identically) --------
    const corner = CENTRE(before.rect);
    await page.touchscreen.tap(corner.x, corner.y);
    await page.waitForFunction(() => window.__minimapStage!.state().expanded === true, undefined, {
      timeout: 10_000,
    });
    const expanded = await page.evaluate(() => window.__minimapStage!.state());
    expect(expanded.expanded, 'a real tap on the corner expands the overlay').toBe(true);
    expect(expanded.rect.width, 'the overlay is bigger than the touch corner').toBeGreaterThan(before.rect.width);
    expect(expanded.coverageCount, 'the expanded overlay is fog-of-war too — coverage still reads').toBeGreaterThan(
      0,
    );
    // Tap the overlay back to the corner so the reveal cycle plays on the collapsed
    // glance map (the state a phone player actually lives in).
    const overlayCentre = CENTRE(expanded.rect);
    await page.touchscreen.tap(overlayCentre.x, overlayCentre.y);
    await page.waitForFunction(() => window.__minimapStage!.state().expanded === false, undefined, {
      timeout: 10_000,
    });
    const collapsed = await page.evaluate(() => window.__minimapStage!.state());

    // --- Build a satellite → a coverage disc + a distant enemy appear on the touch
    //     map, exactly as on desktop (the wiring is one code path) ------------------
    const staged = await page.evaluate(() => window.__minimapStage!.buildSatellite());
    expect(staged, 'a local station + an enemy were available to stage').not.toBeNull();
    expect(staged!.enemyDist, 'enemy is within the satellite sensor range').toBeLessThan(staged!.satRange);

    await page.waitForFunction(
      (b) => {
        const s = window.__minimapStage!.state();
        return s.coverageCount > b.coverageCount && s.shipCount > b.shipCount;
      },
      collapsed,
      { timeout: 10_000 },
    );
    const withSat = await page.evaluate(() => window.__minimapStage!.state());
    expect(withSat.coverageCount, 'the satellite adds a coverage disc on touch').toBeGreaterThan(
      collapsed.coverageCount,
    );
    expect(withSat.shipCount, 'the distant enemy is revealed under the new coverage').toBeGreaterThan(
      collapsed.shipCount,
    );

    await page.screenshot({ path: 'tests/live-stage/minimap-fog-touch-coverage-evidence.png' });

    // --- Kill the satellite → its coverage collapses; the distant enemy drops -----
    const killed = await page.evaluate(() => window.__minimapStage!.killSatellite());
    expect(killed, 'the staged satellite was there to kill').toBe(true);

    await page.waitForFunction(
      (w) => {
        const s = window.__minimapStage!.state();
        return s.coverageCount < w.coverageCount && s.shipCount < w.shipCount;
      },
      withSat,
      { timeout: 10_000 },
    );
    const afterKill = await page.evaluate(() => window.__minimapStage!.state());
    expect(afterKill.coverageCount, 'the satellite coverage disc is gone on touch').toBeLessThan(
      withSat.coverageCount,
    );
    expect(afterKill.shipCount, 'the distant enemy vanished with its coverage').toBeLessThan(withSat.shipCount);

    await page.screenshot({ path: 'tests/live-stage/minimap-fog-touch-collapsed-evidence.png' });

    expect(pageErrors, `no page errors: ${pageErrors.join('\n')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// u6-01 on TOUCH — the same assertions, because ONE code path serves both
// (docs/input-parity.md). Two profiles, because the press has two different
// journeys to make:
//
//   - LANDSCAPE-held: logical == physical, the plain phone case;
//   - PORTRAIT-held: the landscape lock rotates the root 90°, so the physical
//     point a real touch must land on is NOT the logical point the map lays out
//     at. A press that dismissed correctly in landscape and reached the wrong
//     layer in portrait would be exactly the kind of hole this fix exists to
//     close, so it is pressed for real through the rotation, not assumed.
//
// The touch downstream is the dynamic thrust stick (GDD §2.4): the press lands in
// the LEFT half and DRAGS, so a stick that engaged under it would hand the sim a
// thrust — read back at `window.__planetRush.input`, the abstract input the sim
// actually received. Zero thrust there is "no stick engaged", proven at the sim's
// own door.
// ---------------------------------------------------------------------------

/** The shared u6-01 touch journey: open the radar with a real tap, drag OFF it,
 *  and assert the drag dismissed the overlay without ever reaching the sticks —
 *  then that the same drag DOES reach them once the map is collapsed. */
async function runTouchDismissJourney(page: Page, evidence: string): Promise<void> {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await bootMinimap(page);
  await page.waitForFunction(() => !!window.__planetRush?.input, undefined, { timeout: 20_000 });

  // Open the radar with a REAL tap on the corner square (physical point, so the
  // portrait rotation is crossed for real).
  const expanded = await openRadar(page, async (p) => page.touchscreen.tap(p.x, p.y));
  expect(expanded.expanded, 'a real tap on the corner opened the radar').toBe(true);
  await page.screenshot({ path: `tests/live-stage/${evidence}-open-evidence.png` });

  // --- The press the field report is about: a real touch DRAG off the overlay,
  //     in the left half where the thrust stick lives ---------------------------
  const off = await outsidePress(page);
  expect(off.insideDrawnRect, 'the fixture point really is off the overlay').toBe(false);
  const duringOpen = await dragAndReadThrust(page, off.physical, off.physicalDragTo);

  expect(THRUST_MAG(duringOpen), `no stick engaged under the press (thrust ${JSON.stringify(duringOpen.thrust)})`)
    .toBeLessThan(0.05);
  await page.waitForFunction(() => window.__minimapStage!.state().expanded === false, undefined, {
    timeout: 10_000,
  });
  const dismissed = await page.evaluate(() => window.__minimapStage!.state());
  expect(dismissed.expanded, 'the touch off the open radar dismissed it').toBe(false);
  await page.screenshot({ path: `tests/live-stage/${evidence}-dismissed-evidence.png` });

  // --- The asymmetry: the SAME drag, now COLLAPSED, must reach the stick -------
  const duringCollapsed = await dragAndReadThrust(page, off.physical, off.physicalDragTo);
  expect(
    THRUST_MAG(duringCollapsed),
    `collapsed: the same drag flies the ship (thrust ${JSON.stringify(duringCollapsed.thrust)})`,
  ).toBeGreaterThan(0.2);
  expect(
    await page.evaluate(() => window.__minimapStage!.state().expanded),
    'and the collapsed map did not open from a press that missed it',
  ).toBe(false);

  expect(pageErrors, `no page errors: ${pageErrors.join('\n')}`).toEqual([]);
}

test.describe('u6-01 on TOUCH — landscape-held', () => {
  test.use({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });

  test('radar open: a real touch off the map dismisses it and no stick engages', async ({ page }) => {
    await runTouchDismissJourney(page, 'minimap-dismiss-touch');
  });
});

test.describe('u6-01 on TOUCH — PORTRAIT-held (through the landscape lock)', () => {
  test.use({
    // A portrait handset: the root is rotated 90°, so logical (landscape) space and
    // physical CSS px genuinely differ — the press is mapped back through
    // `__minimapStage.physicalPoint` and dispatched at the physical spot.
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
  });

  test('radar open: a real touch off the map dismisses it and no stick engages', async ({ page }) => {
    // Prove the profile is genuinely the rotated one before trusting the rest: the
    // logical viewport must be landscape while the physical one is portrait.
    await bootMinimap(page);
    const vp = await page.evaluate(() => window.__minimapStage!.viewport());
    expect(vp.width, 'the game lays out LANDSCAPE while the phone is held portrait').toBeGreaterThan(vp.height);
    const mapped = await page.evaluate(() => window.__minimapStage!.physicalPoint(10, 20));
    expect(mapped, 'physical != logical — the landscape lock is really rotating').not.toEqual({ x: 10, y: 20 });

    await runTouchDismissJourney(page, 'minimap-dismiss-portrait');
  });
});
