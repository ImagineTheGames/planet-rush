/**
 * tests/mobile/goldens.spec.ts — GOLDEN-SCENE screenshots. OWNER: QA Agent.
 *
 * Deterministic visual baselines of the real preview build under
 * `?debug=1&freeze=1`. `?freeze=1` pins the seeded sim at a fixed tick
 * (freeze.ts) and the renderer is a pure function of that world — nothing
 * animates off the wall clock (spawn protection is a static alpha, the wave/ore
 * flashes derive from the frozen `world.time`) — so the same frame is drawn on
 * every boot and machine. That determinism is what lets us diff the whole frame
 * with NOTHING masked (per brief) and still be stable; the only residual noise
 * is font/GPU antialiasing, which the small `maxDiffPixelRatio` tolerates.
 *
 * Two baselines, per brief: the desktop control and one landscape phone. Each
 * test is gated to a single project so exactly one baseline is generated for it
 * (Playwright already suffixes the snapshot name with project + platform).
 *
 * Regenerate after an intentional visual change with:
 *   npx playwright test tests/mobile/goldens.spec.ts --update-snapshots
 */
import { test, expect, type Page } from '@playwright/test';
import { budgetTest } from './budgets';
import { settleFrames } from './render-settle';
import { GOLDEN_SHOT_TIMEOUT_MS } from './shot-budget';

/**
 * The options every golden in this file passes, and the two things they say.
 *
 * `maxDiffPixelRatio` — small but tolerant of font/GPU antialiasing; the frozen
 * frame is otherwise byte-stable. It is NOT the knob for a slow runner. It is
 * here for antialiasing, and widening it to swallow a half-composited frame
 * would blind the one gate that catches a real visual regression.
 *
 * `timeout` — the budget the COMPARISON gets, which is the thing that was
 * actually short. `toHaveScreenshot` will not diff a frame it has not captured
 * twice identically, and two dpr-3 phone captures cost ~3.6 s in the studio
 * container before the compare even starts; against Playwright's own 5 s default
 * that does not fit on a loaded software-GL runner, and the golden fails as a
 * *timeout* with no pixels to look at. The number is derived from the largest
 * frame in the device matrix rather than guessed — tests/mobile/shot-budget.ts,
 * which also explains why it rides here rather than in playwright.config.ts.
 */
const GOLDEN = { maxDiffPixelRatio: 0.01, timeout: GOLDEN_SHOT_TIMEOUT_MS } as const;

/**
 * The debug boot's TEAMS switch (`src/main.ts` `readDebugSides`) — `?sides=2`
 * builds the frozen world with the lobby's own default 4v4 split. `?debug=1`
 * skips the lobby by contract, so without this the frozen scene is always a
 * free-for-all and a SIDE LABEL could never appear in a baseline.
 */
const TEAMS_SCENE = '/?debug=1&freeze=1&sides=2';

/**
 * Boot the frozen debug build and wait until it is genuinely settled: the Pixi
 * canvas is attached, the debug hook reports `frozen`, and web fonts have
 * loaded (the HUD/strip text is drawn into the canvas, so an unloaded font would
 * shift pixels). No masking — freeze makes the frame deterministic.
 */
async function bootFrozen(page: Page, url = '/?debug=1&freeze=1'): Promise<void> {
  await page.goto(url);
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const pr = (window as unknown as { __planetRush?: { frozen?: boolean } }).__planetRush;
      return !!pr && pr.frozen === true;
    },
    undefined,
    { timeout: 20_000 },
  );
  await page.evaluate(() => (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready);
  // A couple of render frames after freeze so the final composited frame is up —
  // counted, not timed. This was `waitForTimeout(500)`, on the reasoning that the
  // frozen frame is time-invariant so an early shot is the same deterministic
  // frame. True of the WORLD, silent about the COMPOSITOR: 500 ms is ~30 frames
  // here and can be none at all on a loaded software-GL runner, which shoots a
  // frame the renderer has not drawn yet. `?freeze=1` pins the sim so there is no
  // tick to wait on (./sim-clock.ts) — so wait on the frames themselves, with
  // their own stall watchdog (./render-settle.ts).
  await settleFrames(page);
}

test('golden: desktop frozen scene', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop baseline only');
  budgetTest({
    work: 'desktop boot of the frozen scene → font settle → one full-frame golden comparison',
    measuredSeconds: 5,
  });

  await bootFrozen(page);
  await expect(page).toHaveScreenshot('desktop-frozen.png', GOLDEN);
});

test('golden: landscape phone frozen scene', async ({ page }, testInfo) => {
  // One landscape phone baseline (brief). The iPhone-ish profile is the pick.
  test.skip(testInfo.project.name !== 'iphone', 'one landscape phone baseline only (iphone)');
  budgetTest({
    work: 'rotate to landscape → boot the frozen scene → font settle → one full-frame golden comparison at dpr 3',
    measuredSeconds: 8,
  });

  const vp = page.viewportSize();
  if (vp) await page.setViewportSize({ width: vp.height, height: vp.width }); // portrait → landscape
  await bootFrozen(page);
  await expect(page).toHaveScreenshot('phone-landscape-frozen.png', GOLDEN);
});

// ---------------------------------------------------------------------------
// The side labels, in a TEAMS scene (u3 — ratified 2026-08-05)
// ---------------------------------------------------------------------------
//
// "Friendly/Enemy plus Letters — Friendly A, Enemy B, Enemy C, Enemy D etc..."
// The FFA baselines above cannot show that: FFA is teams-of-one and draws no side
// label at all, by design (GDD §2.1), so a change to the wording is invisible in
// them — which is exactly why these exist rather than a note in a PR body.
//
// The scene is the ordinary frozen world booted with sides (`TEAMS_SCENE`), plus
// the nameplate stage's `stageBot()` — the same debug affordance the live-stage
// nameplate spec uses — which parks one rival's ship and home beside the camera so
// an ALLY label and an ENEMY label are both on screen at once. Both are the real
// drawn layer: what these baselines prove is that a player can read who is on
// their side without moving, on a pointer screen and under a thumb.

/** Boot the frozen TEAMS scene and stage a rival beside the local player, so the
 *  frame carries `YOU FRIENDLY A` and `Rusty ENEMY B (EASY)` at once. Deterministic:
 *  the stage writes fixed offsets from the local ship into an already-frozen world. */
async function bootFrozenTeams(page: Page): Promise<void> {
  await bootFrozen(page, TEAMS_SCENE);
  const staged = await page.evaluate(() => {
    const stage = (window as unknown as { __nameplateStage?: { stageBot(): unknown } })
      .__nameplateStage;
    return stage ? stage.stageBot() : null;
  });
  expect(staged, 'the nameplate stage seated a rival to label').not.toBeNull();
  // The labels are drawn from the render loop, not from the call above — so wait
  // for the loop to have run, in frames rather than in milliseconds.
  await settleFrames(page);
  const plates = await page.evaluate(() => {
    const stage = (window as unknown as {
      __nameplateStage?: { plates(): { teamLabel: string }[] };
    }).__nameplateStage;
    return stage ? stage.plates().map((p) => p.teamLabel) : [];
  });
  // Fail here, naming what is missing, rather than shipping a baseline of a scene
  // that quietly stopped carrying the thing it is a baseline OF.
  expect(plates, 'both sides are on screen, in words').toEqual(
    expect.arrayContaining(['FRIENDLY A', 'ENEMY B']),
  );
}

test('golden: desktop frozen TEAMS scene — FRIENDLY A / ENEMY B', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop baseline only');
  budgetTest({
    work: 'desktop boot of the frozen TEAMS scene → stage a rival → font settle → one full-frame golden comparison',
    measuredSeconds: 6,
  });

  await bootFrozenTeams(page);
  await expect(page).toHaveScreenshot('desktop-frozen-teams.png', GOLDEN);
});

test('golden: landscape phone frozen TEAMS scene — FRIENDLY A / ENEMY B', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone', 'one landscape phone baseline only (iphone)');
  budgetTest({
    work: 'rotate to landscape → boot the frozen TEAMS scene → stage a rival → font settle → one full-frame golden comparison at dpr 3',
    measuredSeconds: 9,
  });

  const vp = page.viewportSize();
  if (vp) await page.setViewportSize({ width: vp.height, height: vp.width }); // portrait → landscape
  await bootFrozenTeams(page);
  await expect(page).toHaveScreenshot('phone-landscape-frozen-teams.png', GOLDEN);
});

// ---------------------------------------------------------------------------
// The FRONT DOOR, in Gantry/Bone (u7-01 — ratified 2026-08-05)
// ---------------------------------------------------------------------------
//
// The developer ratified a LOOK ("the theme and looks is what we want") and
// should be able to see whether they got it. The frozen-match baselines above
// cannot show it: `?debug=1` skips the menu by contract, so the title and
// settings screens appear in no baseline in this repo and a total re-skin of
// them would leave every golden byte-identical.
//
// These five cover the two screens u7-01 owns, on both form factors and
// portrait-held — the state the landscape lock rotates the whole root through,
// where a menu has been stranded off-screen before (the M1 field report).
//
// Determinism, and the one thing it does not cover: a clean boot is what shows
// the menu (`?debug=1` skips it, and `?freeze=1` is gated on `debug`, so there is
// no frozen flavour of these screens to ask for). Neither screen animates and
// both are pure functions of the viewport, so the frame is stable — EXCEPT the
// build badge in the bottom-left corner, which carries the commit sha and
// therefore changes every commit.
//
// That is deliberately not masked. The stamp is ~250 inked pixels against a
// 1.02 M-pixel desktop frame (0.03% of `maxDiffPixelRatio`'s 1% budget), so a new
// sha cannot fail a baseline — and leaving it in means every one of these images
// answers "which build am I looking at?", which is the whole reason the badge is
// never hidden behind a flag in the first place.

/**
 * Boot a clean build to the main menu and wait until it is laid out and settled.
 *
 * "Settled" is two things, and the second one is not optional on a phone. The
 * menu lays out in the LOGICAL (landscape) viewport, and under emulation that
 * viewport arrives in more than one step — the initial size, then whatever
 * `visualViewport` reports once the mobile chrome has resolved — each of which
 * re-lays the screen out. Screenshotting between the two produced a frame that
 * changed under Playwright's own stability check and hung the comparison until
 * it timed out. So: wait for the seam, then wait for the logical viewport to
 * report the same size twice running, and only then shoot.
 */
async function bootMenu(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const m = (window as unknown as {
        __mainMenu?: { visible: boolean; screen: string; controls: unknown[] };
      }).__mainMenu;
      return !!m && m.visible && m.controls.length > 0;
    },
    undefined,
    { timeout: 20_000 },
  );
  await page.evaluate(() => (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready);
  await waitForStableViewport(page);
  // Then the frames themselves. `waitForStableViewport` proves the LAYOUT has
  // stopped moving; this proves the screen was re-drawn at the size it settled
  // on. It replaces a flat `waitForTimeout(1200)` that bought ~72 frames here and
  // could buy one on a loaded runner (./render-settle.ts).
  await settleFrames(page);
}

/**
 * The menu screens' screenshot options — now just {@link GOLDEN}.
 *
 * This used to carry `timeout: 30_000` of its own, for the right reason: these
 * boot the REAL app rather than a frozen sim, `toHaveScreenshot` will not shoot
 * until it has taken two identical frames in a row, and on a software-GL runner
 * the menu's first frames land slower than the default allowed — which fails as
 * a *timeout*, not as a pixel diff, and reads like a broken screen when it is a
 * slow one.
 *
 * Every word of that turned out to be true of every golden in this file, not
 * just these: PR #291's two `iphone` goldens failed exactly this way, and had no
 * such override to save them. So the number moved from one spec's local guess to
 * a model that derives it from the frame (tests/mobile/shot-budget.ts) and
 * applies to all of them. 30 s was the right order of magnitude — the model
 * gives a dpr-3 phone frame 45 s.
 *
 * Kept as a name because it still says something a reader wants: these tests
 * shoot a MENU, not a frozen scene.
 */
const MENU_GOLDEN = GOLDEN;

/** Poll the menu's own logical viewport until it stops moving. */
async function waitForStableViewport(page: Page): Promise<void> {
  const read = async (): Promise<string> =>
    page.evaluate(() => {
      const m = (window as unknown as {
        __mainMenu?: { logicalViewport: { width: number; height: number } };
      }).__mainMenu;
      return m ? `${m.logicalViewport.width}x${m.logicalViewport.height}` : '';
    });
  let previous = await read();
  for (let i = 0; i < 20; i++) {
    // Frames, not milliseconds: a viewport change is only observable after the
    // screen has been laid out and drawn again, so a drawn frame is the honest
    // poll interval — and one that means the same thing at 60 fps and at 1
    // (./render-settle.ts). Returns on the first pair of readings that agree,
    // which is the first iteration in every measured run.
    await settleFrames(page, 2);
    const next = await read();
    if (next !== '' && next === previous) return;
    previous = next;
  }
}

/**
 * Open the settings screen the way a player does — a real press at the physical
 * point the seam says SETTINGS is drawn at, through the landscape-lock remap —
 * rather than by calling a debug method. A baseline of a screen reached by a
 * seam proves the screen renders; a baseline of one reached by a press proves it
 * is also reachable.
 */
async function openSettings(page: Page): Promise<void> {
  const point = await page.evaluate(() => {
    const m = (window as unknown as {
      __mainMenu?: { controls: { kind: string; physicalCenter: { x: number; y: number } }[] };
    }).__mainMenu;
    const c = m?.controls.find((k) => k.kind === 'settings');
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  });
  expect(point, 'the menu reports where SETTINGS is drawn').not.toBeNull();
  await page.mouse.click(point!.x, point!.y);
  await page.waitForFunction(
    () => (window as unknown as { __mainMenu?: { screen: string } }).__mainMenu?.screen === 'settings',
    undefined,
    { timeout: 10_000 },
  );
  // The pointer is left sitting on where SETTINGS was, which on a desktop would
  // hover whatever settings row landed under it. Park it in a corner so the
  // baseline is the screen at rest rather than the screen mid-hover.
  await page.mouse.move(1, 1);
  await settleFrames(page);
}

/**
 * Open THE DOORS the way a player does — a real press on PLAY at the physical
 * point the seam reports, through the landscape-lock remap.
 */
async function openDoors(page: Page): Promise<void> {
  const point = await page.evaluate(() => {
    const m = (window as unknown as {
      __mainMenu?: { controls: { kind: string; physicalCenter: { x: number; y: number } }[] };
    }).__mainMenu;
    const c = m?.controls.find((k) => k.kind === 'play');
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  });
  expect(point, 'the menu reports where PLAY is drawn').not.toBeNull();
  await page.mouse.click(point!.x, point!.y);
  await page.waitForFunction(
    () => {
      const d = (window as unknown as { __onlineMenu?: { visible: boolean; doorControls: unknown[] } })
        .__onlineMenu;
      return !!d && d.visible && d.doorControls.length > 0;
    },
    undefined,
    { timeout: 10_000 },
  );
  // Park the pointer off every plate: a desktop mouse left sitting where PLAY was
  // would hover whichever door landed under it, and a hovered plate is a brighter
  // plate (u7-01's 90ms hover). The baseline is the screen at REST.
  await page.mouse.move(1, 1);
  await settleFrames(page);
}

/** …and the CODEX, the same way: a real press on the menu's own CODEX plate. */
async function openCodex(page: Page): Promise<void> {
  const point = await page.evaluate(() => {
    const m = (window as unknown as {
      __mainMenu?: { controls: { kind: string; physicalCenter: { x: number; y: number } }[] };
    }).__mainMenu;
    const c = m?.controls.find((k) => k.kind === 'codex');
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  });
  expect(point, 'the menu reports where CODEX is drawn').not.toBeNull();
  await page.mouse.click(point!.x, point!.y);
  await page.waitForFunction(
    () => (window as unknown as { __mainMenu?: { screen: string } }).__mainMenu?.screen === 'codex',
    undefined,
    { timeout: 10_000 },
  );
  await page.mouse.move(1, 1);
  await settleFrames(page);
}

test('golden: desktop title screen — Gantry/Bone', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop baseline only');
  budgetTest({
    work: 'desktop boot to the main menu → viewport + font settle → one full-frame golden comparison',
    measuredSeconds: 8,
  });

  await bootMenu(page);
  await expect(page).toHaveScreenshot('desktop-title.png', MENU_GOLDEN);
});

test('golden: desktop settings screen — Gantry/Bone', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop baseline only');
  budgetTest({
    work: 'desktop boot to the main menu → viewport + font settle → press SETTINGS → one full-frame golden comparison',
    measuredSeconds: 10,
  });

  await bootMenu(page);
  await openSettings(page);
  await expect(page).toHaveScreenshot('desktop-settings.png', MENU_GOLDEN);
});

test('golden: landscape phone title screen — Gantry/Bone', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone', 'one landscape phone baseline only (iphone)');
  budgetTest({
    work: 'rotate to landscape → boot to the main menu → viewport + font settle → one full-frame golden comparison at dpr 3',
    measuredSeconds: 12,
  });

  const vp = page.viewportSize();
  if (vp) await page.setViewportSize({ width: vp.height, height: vp.width }); // portrait → landscape
  await bootMenu(page);
  await expect(page).toHaveScreenshot('phone-landscape-title.png', MENU_GOLDEN);
});

test('golden: landscape phone settings screen — Gantry/Bone', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone', 'one landscape phone baseline only (iphone)');
  budgetTest({
    work: 'rotate to landscape → boot to the main menu → viewport + font settle → press SETTINGS → one full-frame golden comparison at dpr 3',
    measuredSeconds: 14,
  });

  const vp = page.viewportSize();
  if (vp) await page.setViewportSize({ width: vp.height, height: vp.width }); // portrait → landscape
  await bootMenu(page);
  await openSettings(page);
  await expect(page).toHaveScreenshot('phone-landscape-settings.png', MENU_GOLDEN);
});

test('golden: PORTRAIT-HELD phone title screen — the frame survives the lock', async ({
  page,
}, testInfo) => {
  // The phone profiles are portrait by default and Planet Rush is landscape-locked,
  // so this frame goes through the 90° rotation the desktop never touches — and the
  // beams, the margins and the plate stack are all children of the rotating root.
  // A frame verified on a desktop proves nothing about a held phone.
  test.skip(testInfo.project.name !== 'iphone', 'one portrait-held phone baseline only (iphone)');
  budgetTest({
    work: 'boot to the main menu PORTRAIT-HELD (landscape lock rotation) → viewport + font settle → one full-frame golden comparison at dpr 3',
    measuredSeconds: 12,
  });

  await bootMenu(page);
  await expect(page).toHaveScreenshot('phone-portrait-title.png', MENU_GOLDEN);
});

test('golden: PORTRAIT-HELD phone settings screen — six thumb rows, two columns', async ({
  page,
}, testInfo) => {
  // The screen the field report was actually on: under the landscape lock a
  // portrait phone hands settings a wide, short logical viewport, and six rows do
  // not stack into it at thumb height. This is the baseline of the two-column
  // answer, in the new material.
  test.skip(testInfo.project.name !== 'iphone', 'one portrait-held phone baseline only (iphone)');
  budgetTest({
    work: 'boot to the main menu PORTRAIT-HELD → viewport + font settle → press SETTINGS → one full-frame golden comparison at dpr 3',
    measuredSeconds: 14,
  });

  await bootMenu(page);
  await openSettings(page);
  await expect(page).toHaveScreenshot('phone-portrait-settings.png', MENU_GOLDEN);
});

test('golden: PORTRAIT-HELD phone frozen TEAMS scene — the labels survive the lock', async ({
  page,
}, testInfo) => {
  // The phone profiles are portrait by default and Planet Rush is landscape-locked
  // (src/platform/orientation.ts), so this frame goes through the 90° rotation the
  // other two never touch — and the labels are drawn as children of the rotating
  // game root. A label verified on a desktop proves nothing about a held phone;
  // this project has been bitten by exactly that (PR #93, the nameplate layer
  // registering in a different space than it drew in).
  test.skip(testInfo.project.name !== 'iphone', 'one portrait-held phone baseline only (iphone)');
  budgetTest({
    work: 'boot the frozen TEAMS scene PORTRAIT-HELD (landscape lock rotation) → stage a rival → font settle → one full-frame golden comparison at dpr 3',
    measuredSeconds: 9,
  });

  await bootFrozenTeams(page);
  await expect(page).toHaveScreenshot('phone-portrait-frozen-teams.png', GOLDEN);
});

// ---------------------------------------------------------------------------
// THE DOORS and THE CODEX, in Gantry/Bone (u7-04)
// ---------------------------------------------------------------------------
//
// The two screens the Gantry chain forgot. The handoff named five — title, build
// wheel, lobby, ship select, settings — and neither of these is among them, so
// while the screen in FRONT of the doors had been re-skinned, the doors and the
// codex were still the thing the handoff diagnosed: 1px hairlines on black.
//
// **They appeared in no golden either**, which is the other half of why they were
// missed: a total re-skin of both would have left every baseline in this file
// byte-identical. The doors screen in particular is the FIRST screen a player
// touches after PLAY and had no visual gate at all. It has one now.
//
// Five baselines, chosen for what each one can fail that the others cannot:
//  - the doors on a desktop (the stacked shape, four plates, one of them bright)
//  - the doors on a landscape phone (the TWO-COLUMN shape — a different layout
//    branch, not the same picture smaller)
//  - the codex on a desktop and on a landscape phone (the tab row, the rail and
//    the article at two very different widths)
//  - the codex PORTRAIT-HELD, which goes through the landscape lock's 90°
//    rotation — the densest screen in the game through the transform that has
//    stranded a menu off-screen before (the M1 field report).
//
// Determinism is the same as the menu baselines above: a clean boot, no
// animation, both screens pure functions of the viewport, and the build badge
// deliberately unmasked.

test('golden: desktop THE DOORS — Gantry/Bone', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop baseline only');
  budgetTest({
    work: 'desktop boot to the main menu → viewport + font settle → press PLAY → one full-frame golden comparison',
    measuredSeconds: 10,
  });

  await bootMenu(page);
  await openDoors(page);
  await expect(page).toHaveScreenshot('desktop-doors.png', MENU_GOLDEN);
});

test('golden: landscape phone THE DOORS — the two-column shape', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone', 'one landscape phone baseline only (iphone)');
  budgetTest({
    work: 'rotate to landscape → boot to the main menu → viewport + font settle → press PLAY → one full-frame golden comparison at dpr 3',
    measuredSeconds: 14,
  });

  const vp = page.viewportSize();
  if (vp) await page.setViewportSize({ width: vp.height, height: vp.width }); // portrait → landscape
  await bootMenu(page);
  await openDoors(page);
  await expect(page).toHaveScreenshot('phone-landscape-doors.png', MENU_GOLDEN);
});

test('golden: desktop CODEX — the densest text screen in the game', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop baseline only');
  budgetTest({
    work: 'desktop boot to the main menu → viewport + font settle → press CODEX → one full-frame golden comparison',
    measuredSeconds: 10,
  });

  await bootMenu(page);
  await openCodex(page);
  await expect(page).toHaveScreenshot('desktop-codex.png', MENU_GOLDEN);
});

test('golden: landscape phone CODEX — a tab row, a rail and an article at 844px', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone', 'one landscape phone baseline only (iphone)');
  budgetTest({
    work: 'rotate to landscape → boot to the main menu → viewport + font settle → press CODEX → one full-frame golden comparison at dpr 3',
    measuredSeconds: 14,
  });

  const vp = page.viewportSize();
  if (vp) await page.setViewportSize({ width: vp.height, height: vp.width }); // portrait → landscape
  await bootMenu(page);
  await openCodex(page);
  await expect(page).toHaveScreenshot('phone-landscape-codex.png', MENU_GOLDEN);
});

test('golden: PORTRAIT-HELD phone CODEX — the dense screen through the lock', async ({
  page,
}, testInfo) => {
  // The brief's hard case, and the one no desktop frame can speak to: a tab row
  // plus a list plus an article, at 390px wide, through the 90° rotation the
  // landscape lock puts the whole root through.
  test.skip(testInfo.project.name !== 'iphone', 'one portrait-held phone baseline only (iphone)');
  budgetTest({
    work: 'boot to the main menu PORTRAIT-HELD (landscape lock rotation) → viewport + font settle → press CODEX → one full-frame golden comparison at dpr 3',
    measuredSeconds: 14,
  });

  await bootMenu(page);
  await openCodex(page);
  await expect(page).toHaveScreenshot('phone-portrait-codex.png', MENU_GOLDEN);
});
