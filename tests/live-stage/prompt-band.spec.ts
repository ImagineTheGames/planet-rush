/**
 * tests/live-stage/prompt-band.spec.ts — the onboarding prompt CLEARS the open
 * build wheel, in the REAL booted client, after a REAL press. OWNER: UI Engineer
 * (u7-07, GDD §2.10 / §2.5).
 *
 * ## What only a boot can prove
 *
 * The geometry is unit-green: `src/ui/hud-geometry.test.ts` resolves `promptBand`
 * against every profile in QA's matrix, in both orientations, using the layout
 * registry's own resolver. What it cannot reach is the number that actually
 * decides this — the prompt's **measured text height**. The band is bottom-
 * anchored, so the panel's top edge is `bandBottom − (textHeight + padding)`, and
 * `textHeight` comes from Pixi laying out a real string in a real font at a real
 * size. A unit test has to guess it; this reads back what the client drew.
 *
 * The failure it guards is not hypothetical. Before u7-07 the prompt was centred
 * on a flat `PROMPT_CENTER_Y = 0.72` of the viewport height, and the SPEND prompt
 * fires *while the wheel is open* by design (GDD §2.10) — so on a landscape phone
 * the band sat inside the wheel and covered the REPAIR REACTOR and RADAR wedges
 * outright. Both states are in `evidence/images/u7-gantry-match-hud/`.
 *
 * ## How it drives
 *
 * Every press is a REAL synthesized `pointerdown` at a LOGICAL point the
 * `?debug=1` `__tapCommanderStage` hands back — the same event a mouse click or a
 * thumb tap fires, into the same `main.ts` canvas handler — never a debug method
 * that opens the wheel directly (the p1a real-input rule). It runs WITHOUT
 * `?freeze`: the pilot needs a live tick to dock and the wheel needs one to open.
 *
 * The assertion reads the two rects out of the layout registry
 * (`window.__planetRush.layout`), which is the same data QA's placement suite
 * uses and the same rects the HUD reported having DRAWN — not a re-derivation of
 * the geometry this spec is checking.
 */
import { test, expect } from '@playwright/test';

interface Vec2 {
  x: number;
  y: number;
}

/** The `?debug=1` seam that docks the ship and hands back the points to press
 *  (installed in `installTapCommanderStage`, `src/main.ts`). */
interface TapCommanderStage {
  setScheme(scheme: 'sticks' | 'tap'): void;
  stageStationWheel(): { stationPoint: Vec2; outsidePoint: Vec2 } | null;
  wheelState(): { open: boolean; panelOpen: boolean };
}

interface LayoutEntry {
  id: string;
  bounds: { x: number; y: number; width: number; height: number };
}

interface RepairStage {
  /** Set the local core to exactly `hp` — a real HP fall, which is what the HUD
   *  derives "damage this tick" from (`src/ui/hud.ts` `updateAlarm`). */
  setCore(hp: number): { coreHp: number; maxCoreHp: number } | null;
}

interface StageWindow {
  __tapCommanderStage?: TapCommanderStage;
  __repairStage?: RepairStage;
  __planetRush?: {
    layout: LayoutEntry[];
    placement(): Array<{ id: string; ok: boolean }>;
  };
}
declare const window: Window & StageWindow;

/** A REAL press into the same canvas handler every real pointer crosses. */
async function realTap(page: import('@playwright/test').Page, at: Vec2): Promise<void> {
  await page.evaluate((p) => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas to tap');
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        clientX: p.x,
        clientY: p.y,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
        bubbles: true,
        cancelable: true,
      }),
    );
  }, at);
}

/** Frames, not milliseconds: the honest unit on a software-GL runner, where a
 *  flat wait can buy no drawn frames at all. */
async function frames(page: import('@playwright/test').Page, n = 4): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const step = (): void => {
          if (left-- <= 0) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    n,
  );
}

test.describe('the onboarding prompt clears the open build wheel on the real client', () => {
  test('tap your station → wheel opens → the SPEND prompt sits BELOW the wedges', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    await page.goto('/?debug=1', { waitUntil: 'load' });
    await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
    await page.waitForFunction(
      () => typeof window.__tapCommanderStage?.stageStationWheel === 'function',
      undefined,
      { timeout: 20_000 },
    );

    // Dock at the station in the tap scheme, then press the station itself — the
    // ratified way a player opens the wheel (developer p10).
    await page.evaluate(() => window.__tapCommanderStage!.setScheme('tap'));
    const staged = await page.evaluate(() => window.__tapCommanderStage!.stageStationWheel());
    expect(staged, 'the stage docked the ship and reported where its station is drawn').not.toBeNull();

    await realTap(page, staged!.stationPoint);
    await page.waitForFunction(() => window.__tapCommanderStage?.wheelState().open === true, undefined, {
      timeout: 10_000,
    });
    // The prompt is drawn from the render loop, so wait for drawn frames.
    await frames(page, 6);

    const entries = await page.evaluate(() => window.__planetRush!.layout.map((e) => ({ id: e.id, bounds: e.bounds })));
    const prompt = entries.find((e) => e.id === 'onboarding');
    const wheel = entries.find((e) => e.id === 'build-wheel');

    // Both have to be on screen for the assertion to mean anything: a prompt that
    // did not fire would pass a "does not overlap" check trivially.
    expect(wheel, 'the build wheel registered its drawn rect').toBeDefined();
    expect(prompt, 'the SPEND onboarding prompt fired with the wheel (GDD §2.10)').toBeDefined();

    const wheelBottom = wheel!.bounds.y + wheel!.bounds.height;
    expect(
      prompt!.bounds.y,
      `prompt top ${prompt!.bounds.y.toFixed(1)} must clear wheel bottom ${wheelBottom.toFixed(1)}`,
    ).toBeGreaterThanOrEqual(wheelBottom);

    // …and it is still inside the screen it promised to stay inside.
    const failures = await page.evaluate(() =>
      window.__planetRush!.placement().filter((p) => !p.ok).map((p) => p.id),
    );
    expect(failures, 'every registered element is inside its declared anchor').toEqual([]);

    await page.screenshot({ path: 'tests/live-stage/prompt-band-wheel-evidence.png' });
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });

  test('a prompt lands on the same bottom edge whether the wheel is open or not', async ({ page }) => {
    // The band is computed from `wheelBounds`, which is a pure function of the
    // VIEWPORT, not of whether the wheel happens to be open. That is deliberate: a
    // prompt that slid up the screen the moment the player closed the wheel would
    // be movement with no meaning behind it, on a HUD whose whole job is that
    // every movement means something.
    //
    // Proving it needs two DIFFERENT prompts, because a single one cannot be up in
    // both states — the SPEND prompt's own trigger IS the wheel being open (GDD
    // §2.10), so it goes down with the wheel by design. So: SPEND with the wheel
    // open, then the UNDER ATTACK prompt with it closed, and the two have to hang
    // from the same edge. Their heights differ (different sentences, different
    // wraps), which is exactly why the invariant is the BOTTOM edge — the band is
    // bottom-anchored.
    await page.goto('/?debug=1', { waitUntil: 'load' });
    await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
    await page.waitForFunction(
      () =>
        typeof window.__tapCommanderStage?.stageStationWheel === 'function' &&
        typeof window.__repairStage?.setCore === 'function',
      undefined,
      { timeout: 20_000 },
    );

    await page.evaluate(() => window.__tapCommanderStage!.setScheme('tap'));
    const staged = await page.evaluate(() => window.__tapCommanderStage!.stageStationWheel());
    expect(staged).not.toBeNull();

    await realTap(page, staged!.stationPoint);
    await page.waitForFunction(() => window.__tapCommanderStage?.wheelState().open === true, undefined, {
      timeout: 10_000,
    });
    await frames(page, 6);
    const withWheel = await page.evaluate(() => {
      const b = window.__planetRush!.layout.find((e) => e.id === 'onboarding')?.bounds;
      return b ? b.y + b.height : null;
    });
    expect(withWheel, 'the SPEND prompt was up while the wheel was open').not.toBeNull();

    // Press off the wheel: it closes without flying the ship (u6-01 / p10 rule).
    await realTap(page, staged!.outsidePoint);
    await page.waitForFunction(() => window.__tapCommanderStage?.wheelState().open === false, undefined, {
      timeout: 10_000,
    });
    await frames(page, 4);

    // Then a real siege on the own station, which rings the alarm and fires the
    // one prompt that belongs to it. A 30 HP fall clears ALARM_THRESHOLD_HP (5) by
    // six times over, so this is a siege and not a taunt-tap (GDD §2.2).
    const hit = await page.evaluate(() => window.__repairStage!.setCore(70));
    expect(hit, 'the station took a real hit').not.toBeNull();
    await page.waitForFunction(
      () => !!window.__planetRush!.layout.find((e) => e.id === 'onboarding'),
      undefined,
      { timeout: 10_000 },
    );
    await frames(page, 4);
    const withoutWheel = await page.evaluate(() => {
      const b = window.__planetRush!.layout.find((e) => e.id === 'onboarding')?.bounds;
      return b ? b.y + b.height : null;
    });

    expect(withoutWheel, 'the UNDER ATTACK prompt is up with the wheel closed').not.toBeNull();
    expect(
      withoutWheel!,
      `prompt bottom moved when the wheel closed: ${withWheel} → ${withoutWheel}`,
    ).toBeCloseTo(withWheel!, 1);

    await page.screenshot({ path: 'tests/live-stage/prompt-band-alarm-evidence.png' });
  });
});
