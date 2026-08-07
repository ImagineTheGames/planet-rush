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
import { GOLDEN_RETRIES, GOLDEN_SHOT_TIMEOUT_MS } from './shot-budget';

/**
 * One extra attempt on CI, for this file and no other (q9-01).
 *
 * A 31× runner took the phone BUILD WHEEL golden past its 90 s budget and past
 * its single retry, and reddened `main` against a baseline that was correct — a
 * timeout, with no actual/expected/diff, because nothing was ever captured. The
 * fix is an attempt, not a bigger ceiling: chasing 31× with budgets would give a
 * genuine hang minutes to hide in.
 *
 * It cannot mask a real regression. Every scene in this file is frozen and
 * deterministic, so a frame that mismatches its baseline mismatches on all three
 * attempts, and Playwright reports `flaky` only when an attempt PASSES. The
 * scope is the reviewable part, and it is pinned mechanically by
 * tests/mobile-shot-budget-contract.test.ts: the number lives in
 * ./shot-budget.ts, it is applied here at file scope, and the suite-wide
 * `retries: 1` in playwright.config.ts is unchanged for every behavioural spec.
 */
test.describe.configure({ retries: GOLDEN_RETRIES });

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
// The Gantry/Bone BUILD WHEEL (u7-02 — ratified 2026-08-05)
// ---------------------------------------------------------------------------
//
// The frozen scenes above are a ship two seconds into a match, so the Build
// wheel is closed in every one of them and the screen this deliverable rebuilt
// is invisible to the whole golden suite. These open it.
//
// The wheel is staged through `__pressStage.openBuild(ore)` — the ?debug=1 seam
// that parks the local ship docked at its own station, banks it a stated amount
// and opens the wheel. Nothing else is touched, so the frame stays as
// deterministic as the scenes above: the seeded world is still pinned at
// FREEZE_TICK, and `stampDefenseShowcase` has already stood the local station's
// four turrets (three built, one on the scaffold) and two shields, which is what
// makes this frame carry the cap counts at all.
//
// What each baseline is FOR, so a reviewer knows what a diff means:
//   · the four-line wedge stack — name / target / `cost/held` / count over cap;
//   · `FULL` and `4 / 4 BUILT` on a capped wedge (turret, shield);
//   · the cost numeral in BOTH of its ratified colours — signal yellow at ore 8
//     where RADAR's 6 is payable, threat red at ore 4 where it is not;
//   · `OPEN ▸` where UPGRADE SHIP would otherwise carry a price;
//   · and the whole look at a phone's radius, where the copy goes compact.

/** The design's own frame: four ore in the bank, so the wheel has one thing it
 *  can afford and several it cannot. */
const WHEEL_ORE_SHORT = 4;
/** Eight ore: RADAR's 6 is payable, so the cost numeral draws in signal yellow. */
const WHEEL_ORE_FLUSH = 8;

interface PressStage {
  openBuild(ore: number): { open: boolean; banked: number } | null;
  wedges(): Array<{ id: string; costLabel: string; caps: string; costPaint: string }>;
}

/** Boot the frozen scene and open the Build wheel at the local station with
 *  `ore` banked. Fails naming what is missing, rather than baselining a scene
 *  that quietly stopped carrying the thing it is a baseline OF. */
async function bootFrozenBuildWheel(page: Page, ore: number): Promise<void> {
  await bootFrozen(page);
  const staged = await page.evaluate((o) => {
    const s = (window as unknown as { __pressStage?: PressStage }).__pressStage;
    return s ? s.openBuild(o) : null;
  }, ore);
  expect(staged, 'the ?debug=1 press stage is installed').not.toBeNull();
  expect(staged!.open, 'the Build wheel is up at the local station').toBe(true);
  // The wedges are drawn from the render loop, not from the call above — so wait
  // on the frames that draw them, not on a stopwatch. This helper was written on
  // the pre-q8-01 `waitForTimeout(500)` pattern and merged in after that pattern
  // was retired everywhere else in this file: opening the wheel is exactly the
  // kind of state change ./render-settle.ts exists for, and a software-GL runner
  // that fits no frames into 500 ms would shoot the wheel before it had wedges.
  // `tests/mobile-shot-budget-contract.test.ts` is what catches a relapse.
  await settleFrames(page);
  const wedges = await page.evaluate(() => {
    const s = (window as unknown as { __pressStage?: PressStage }).__pressStage;
    return s ? s.wedges() : [];
  });
  const turret = wedges.find((w) => w.id === 'turret');
  const radar = wedges.find((w) => w.id === 'satellite');
  expect(turret?.caps, 'the capped TURRET wedge is counting (u7-02)').toMatch(/^4\s*\/\s*4 BUILT$/);
  expect(turret?.costLabel, 'a capped wedge quotes no price').toBe('FULL');
  expect(radar?.costLabel, 'the RADAR wedge shows cost over spendable ore').toBe(`6/${ore}`);
  expect(radar?.costPaint, 'the cost numeral takes the colour its state ratifies').toBe(
    ore >= 6 ? 'ore' : 'refused',
  );
}

test('golden: desktop BUILD WHEEL — a payable cost, in signal yellow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop baseline only');
  budgetTest({
    work: 'desktop boot of the frozen scene → open the Build wheel with 8 ore → font settle → one full-frame golden comparison',
    measuredSeconds: 6,
  });

  await bootFrozenBuildWheel(page, WHEEL_ORE_FLUSH);
  await expect(page).toHaveScreenshot('desktop-build-wheel.png', GOLDEN);
});

test('golden: desktop BUILD WHEEL — a cost that cannot be paid, in threat red', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop baseline only');
  budgetTest({
    work: 'desktop boot of the frozen scene → open the Build wheel with 4 ore → font settle → one full-frame golden comparison',
    measuredSeconds: 6,
  });

  // The second half of the style-guide §2.1 carve-out. Two baselines rather than
  // one because the colours are the whole amendment: a single frame could only
  // ever show one of them, and "the red one still looks right" is exactly the
  // thing a reviewer has to be able to check with their eyes.
  await bootFrozenBuildWheel(page, WHEEL_ORE_SHORT);
  await expect(page).toHaveScreenshot('desktop-build-wheel-short.png', GOLDEN);
});

test('golden: landscape phone BUILD WHEEL — the compact copy, at 390 px', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone', 'one landscape phone baseline only (iphone)');
  budgetTest({
    work: 'rotate to landscape → boot the frozen scene → open the Build wheel with 4 ore → font settle → one full-frame golden comparison at dpr 3',
    measuredSeconds: 9,
  });

  // The hard one. A 390 px phone gives the wheel a 140 px radius, so a wedge's
  // four lines sit on a 72° arc barely 115 px across — which is why the metrics
  // are stated twice (src/art/materials.ts WHEEL_PROFILES) and why the count line
  // goes compact here. This baseline is what proves the derived numbers landed.
  const vp = page.viewportSize();
  if (vp) await page.setViewportSize({ width: vp.height, height: vp.width }); // portrait → landscape
  await bootFrozenBuildWheel(page, WHEEL_ORE_SHORT);
  await expect(page).toHaveScreenshot('phone-landscape-build-wheel.png', GOLDEN);
});

test('golden: PORTRAIT-HELD phone BUILD WHEEL — the wheel survives the lock', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone', 'one portrait-held phone baseline only (iphone)');
  budgetTest({
    work: 'boot the frozen scene PORTRAIT-HELD (landscape lock rotation) → open the Build wheel with 4 ore → font settle → one full-frame golden comparison at dpr 3',
    measuredSeconds: 9,
  });

  // Held in portrait, the whole game root is rotated 90° by the landscape lock
  // (src/platform/orientation.ts) and the wheel is drawn as a child of it. A
  // radial control verified on a desktop proves nothing about a held phone, and
  // this project has been bitten by exactly that (PR #93).
  await bootFrozenBuildWheel(page, WHEEL_ORE_SHORT);
  await expect(page).toHaveScreenshot('phone-portrait-build-wheel.png', GOLDEN);
});

// ---------------------------------------------------------------------------
// The Gantry/Bone UPGRADE WHEEL (u7-06)
// ---------------------------------------------------------------------------
//
// The screen behind the build wheel's UPGRADE SHIP wedge, and **the place ship
// stats are shown** (GDD §2.5). It is closed in every frozen scene above and it
// is not the wheel the four baselines above open, so a total restyle of it would
// leave the whole golden suite byte-identical.
//
// Staged through `__upgradeWheelStage.openUpgrade(ore)` — the ?debug=1 seam that
// parks the local ship docked, banks it a stated amount and opens the upgrade
// wheel directly. The seeded world is still pinned at FREEZE_TICK, so the frame
// is as deterministic as the scenes above.
//
// What each baseline is FOR, so a reviewer knows what a diff means:
//   · the four-line upgrade stack — name / the stat this tier moves / `cost/held`
//     / the ladder pips;
//   · the cost numeral in BOTH of its ratified colours — signal yellow at 99 ore
//     where every track is payable, threat red at 1 ore where none is;
//   · `OPEN ▸` on the WEAPON wedge, in the same slot as the build wheel's, with
//     its DAMAGE/SPEED pip rows above it;
//   · and the stat line — the densest text on any wheel in the game — at a
//     phone's radius, where it goes compact.

/** Every track payable: the cost numerals draw in signal yellow. */
const UPGRADE_ORE_FLUSH = 99;
/** One ore buys nothing on this ladder (the cheapest tier is 2), so every cost
 *  numeral draws in threat red. */
const UPGRADE_ORE_SHORT = 1;

interface UpgradeStage {
  openUpgrade(ore: number): { open: boolean } | null;
  wedges(): Array<{
    label: string;
    stat: string;
    costLabel: string;
    tiers: string;
    costPaint: string;
  }>;
}

/**
 * Boot the frozen scene and open the UPGRADE wheel with `ore` banked. Fails
 * naming what is missing rather than baselining a scene that quietly stopped
 * carrying the thing it is a baseline OF.
 */
async function bootFrozenUpgradeWheel(page: Page, ore: number): Promise<void> {
  await bootFrozen(page);
  const staged = await page.evaluate((o) => {
    const s = (window as unknown as { __upgradeWheelStage?: UpgradeStage }).__upgradeWheelStage;
    return s ? s.openUpgrade(o) : null;
  }, ore);
  expect(staged, 'the ?debug=1 upgrade stage is installed').not.toBeNull();
  expect(staged!.open, 'the upgrade wheel is up').toBe(true);
  // The wedges are drawn from the render loop, not from the call above.
  await settleFrames(page);
  const wedges = await page.evaluate(() => {
    const s = (window as unknown as { __upgradeWheelStage?: UpgradeStage }).__upgradeWheelStage;
    return s ? s.wedges() : [];
  });
  const engine = wedges.find((w) => w.label === 'ENGINE');
  const weapon = wedges.find((w) => w.label === 'WEAPON');
  expect(engine?.stat, 'the ENGINE wedge is drawing its stat line (u7-06)').toMatch(/^\d+% ?→ ?\d+%$/);
  expect(engine?.costLabel, 'the ENGINE wedge prices its next tier as cost/held').toBe(`3/${ore}`);
  expect(engine?.tiers, 'the ENGINE wedge pips its ladder position').toMatch(/^[●○]+$/);
  expect(engine?.costPaint, 'the cost numeral takes the colour its state ratifies').toBe(
    ore >= 3 ? 'ore' : 'refused',
  );
  expect(weapon?.costLabel, 'the WEAPON wedge signposts the sub-wheel').toBe('OPEN ▸');
}

test('golden: desktop UPGRADE WHEEL — payable tiers, in signal yellow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop baseline only');
  budgetTest({
    work: 'desktop boot of the frozen scene → open the upgrade wheel with 99 ore → font settle → one full-frame golden comparison',
    measuredSeconds: 6,
  });

  await bootFrozenUpgradeWheel(page, UPGRADE_ORE_FLUSH);
  await expect(page).toHaveScreenshot('desktop-upgrade-wheel.png', GOLDEN);
});

test('golden: desktop UPGRADE WHEEL — tiers that cannot be paid for, in threat red', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop baseline only');
  budgetTest({
    work: 'desktop boot of the frozen scene → open the upgrade wheel with 1 ore → font settle → one full-frame golden comparison',
    measuredSeconds: 6,
  });

  // The second half of the style-guide §2.1 carve-out, on this wheel. Two
  // baselines rather than one because a single frame can only show one colour,
  // and "the red one still looks right" is exactly what a reviewer has to be
  // able to check with their eyes.
  await bootFrozenUpgradeWheel(page, UPGRADE_ORE_SHORT);
  await expect(page).toHaveScreenshot('desktop-upgrade-wheel-short.png', GOLDEN);
});

test('golden: landscape phone UPGRADE WHEEL — the compact stat line, at 390 px', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone', 'one landscape phone baseline only (iphone)');
  budgetTest({
    work: 'rotate to landscape → boot the frozen scene → open the upgrade wheel with 99 ore → font settle → one full-frame golden comparison at dpr 3',
    measuredSeconds: 9,
  });

  // The hard one. `111% → 123%` is two formatted values and a glyph on one row —
  // the densest text on any wheel in the game — and at a 140 px radius it is
  // drawn at 9 px. This baseline is what proves the derived phone column landed.
  const vp = page.viewportSize();
  if (vp) await page.setViewportSize({ width: vp.height, height: vp.width }); // portrait → landscape
  await bootFrozenUpgradeWheel(page, UPGRADE_ORE_FLUSH);
  await expect(page).toHaveScreenshot('phone-landscape-upgrade-wheel.png', GOLDEN);
});

test('golden: PORTRAIT-HELD phone UPGRADE WHEEL — the wheel survives the lock', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone', 'one portrait-held phone baseline only (iphone)');
  budgetTest({
    work: 'boot the frozen scene PORTRAIT-HELD (landscape lock rotation) → open the upgrade wheel with 99 ore → font settle → one full-frame golden comparison at dpr 3',
    measuredSeconds: 9,
  });

  // Held in portrait the whole game root is rotated 90° by the landscape lock,
  // and this wheel is drawn as a child of it (PR #93's lesson).
  await bootFrozenUpgradeWheel(page, UPGRADE_ORE_FLUSH);
  await expect(page).toHaveScreenshot('phone-portrait-upgrade-wheel.png', GOLDEN);
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

// ---------------------------------------------------------------------------
// THE PAUSE MENU and THE END-OF-MATCH SUMMARY, in Gantry/Bone (u7-05)
// ---------------------------------------------------------------------------
//
// The other two screens the Gantry chain forgot, and — like the doors and the
// CODEX before them — **they appeared in no golden**, for a reason worth stating
// once: every baseline above shoots either a MENU (`/`, which never reaches a
// match) or a FROZEN MATCH (`?debug=1`, which never reaches an overlay). Both of
// these screens live in the gap: mid-play, over a match. A total re-skin of
// either left every baseline in this file byte-identical.
//
// End-of-match in particular deserved one and had none: it is the screen a player
// stares at longest, it is the one screen carrying the tone contract's
// station-death beat (GDD §4.7), and until now nothing could tell whether it had
// quietly become a celebration.
//
// Six baselines, each chosen for what it alone can fail:
//   desktop-pause               the three-plate stack, one of them bright
//   phone-landscape-pause       the same stack in a 50px-beam frame at 844×390
//   phone-portrait-pause        …through the landscape lock's 90° rotation
//   desktop-pause-confirm       a DIFFERENT shape: two plates, and the bright one
//                               is the SECOND — the "STAY is the default" rule,
//                               which is now a brightness rule and nothing else
//   desktop-end-result          the result: the identity rule, and REMATCH bright
//   phone-portrait-end-eliminated  threat red, the cause line, SPECTATE, held
//
// Determinism. The four pause shots and the ELIMINATED one ride `?freeze=1`: the
// overlay is a pure function of the viewport and the world under it is pinned.
// The RESULT screen cannot be frozen — `world.match.phase` only reaches 'ended'
// on a sim TICK — so it is shot over a live match, which is deterministic for a
// different reason: since u7-05 that overlay's backdrop is opaque and covers the
// whole viewport, so the running match under it contributes no pixels. The build
// badge stays unmasked here exactly as it is above.

/**
 * The two mid-play seams these screens are reached through, named locally rather
 * than on `Window`: the live-stage specs already declare their own (richer)
 * shapes for both, and two `declare global` blocks for one property do not merge
 * — they collide. Every other reader in this file casts at the call site for the
 * same reason.
 */
interface PauseSeam {
  read(): {
    open: boolean;
    controls: { kind: string; physicalCenter: { x: number; y: number } }[];
    buttonPoint: { x: number; y: number };
  };
}
interface EndSeam {
  eliminateLocal(): boolean;
  endMatch(): boolean;
  screen(): 'none' | 'defeated' | 'result';
}
type StagedWindow = { __pauseStage?: PauseSeam; __endScreenStage?: EndSeam };

/** Boot the FROZEN debug scene and wait for the mid-play seams to be installed. */
async function bootStaged(page: Page, url = '/?debug=1&freeze=1'): Promise<void> {
  await bootFrozen(page, url);
  await waitForStages(page);
}

/**
 * Boot the debug build with the sim RUNNING — the one screen that needs it. The
 * result screen is reached when `world.match.phase` becomes 'ended', which only
 * happens on a sim tick, so `?freeze=1` (whose whole job is that there are no
 * ticks) cannot reach it. `bootFrozen`'s wait is on the freeze hook, so this is
 * the same boot with that one wait replaced by the seams themselves.
 */
async function bootLive(page: Page): Promise<void> {
  await page.goto('/?debug=1');
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await waitForStages(page);
  await page.evaluate(() => (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready);
  await settleFrames(page);
}

async function waitForStages(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as StagedWindow;
      return typeof w.__pauseStage?.read === 'function' && typeof w.__endScreenStage?.screen === 'function';
    },
    undefined,
    { timeout: 20_000 },
  );
}

/**
 * Open the pause overlay the way THIS device does — ESC on a keyboard, a thumb on
 * the corner affordance on a phone (the corner button is touch-only by contract,
 * `pauseButtonVisible`). A baseline of a screen reached by a real press proves it
 * is reachable as well as drawn.
 */
async function openPause(page: Page, touch: boolean): Promise<void> {
  if (touch) {
    const point = await page.evaluate(
      () => (window as unknown as StagedWindow).__pauseStage!.read().buttonPoint,
    );
    await page.touchscreen.tap(Math.round(point.x), Math.round(point.y));
  } else {
    await page.keyboard.press('Escape');
  }
  await page.waitForFunction(
    () => (window as unknown as StagedWindow).__pauseStage!.read().open === true,
    undefined,
    { timeout: 10_000 },
  );
  // Park the pointer off every plate: a hovered plate is a brighter plate, and
  // the baseline is the screen at REST.
  await page.mouse.move(1, 1);
  await settleFrames(page);
}

/** Press a pause control at the physical point the client says it drew it at. */
async function pressPause(page: Page, kind: string): Promise<void> {
  const point = await page.evaluate((k) => {
    const c = (window as unknown as StagedWindow).__pauseStage!.read().controls.find((x) => x.kind === k);
    return c ? c.physicalCenter : null;
  }, kind);
  expect(point, `the pause overlay reports where ${kind} is drawn`).not.toBeNull();
  await page.mouse.click(Math.round(point!.x), Math.round(point!.y));
  await page.mouse.move(1, 1);
  await settleFrames(page);
}

/** Stage an end screen through the sim's OWN elimination path and wait for the
 *  wiring to put it up. Never fakes the UI — only the deaths that drive it. */
async function stageEnd(page: Page, want: 'defeated' | 'result'): Promise<void> {
  const staged = await page.evaluate((w) => {
    const stage = (window as unknown as StagedWindow).__endScreenStage!;
    return w === 'defeated' ? stage.eliminateLocal() : stage.endMatch();
  }, want);
  expect(staged, `the end-screen stage set up the ${want} case`).toBe(true);
  await page.waitForFunction(
    (w) => (window as unknown as StagedWindow).__endScreenStage!.screen() === w,
    want,
    { timeout: 15_000 },
  );
  await page.mouse.move(1, 1);
  await settleFrames(page);
}

test('golden: desktop PAUSE MENU — Gantry/Bone', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop baseline only');
  budgetTest({
    work: 'desktop boot of the frozen scene → ESC → font settle → one full-frame golden comparison',
    measuredSeconds: 6,
  });

  await bootStaged(page);
  await openPause(page, false);
  await expect(page).toHaveScreenshot('desktop-pause.png', GOLDEN);
});

test('golden: desktop PAUSE CONFIRM — the bright plate is the SAFE one', async ({ page }, testInfo) => {
  // The one screen in the game where the emphasised button is not the first one,
  // and the rule it exists for (developer §1) is now carried by brightness alone.
  test.skip(testInfo.project.name !== 'desktop', 'desktop baseline only');
  budgetTest({
    work: 'desktop boot of the frozen scene → ESC → press EXIT TO MENU → font settle → one full-frame golden comparison',
    measuredSeconds: 7,
  });

  await bootStaged(page);
  await openPause(page, false);
  await pressPause(page, 'exit');
  await expect(page).toHaveScreenshot('desktop-pause-confirm.png', GOLDEN);
});

test('golden: landscape phone PAUSE MENU — a 50px beam frame at 844×390', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone', 'one landscape phone baseline only (iphone)');
  budgetTest({
    work: 'rotate to landscape → boot the frozen scene → tap the corner affordance → font settle → one full-frame golden comparison at dpr 3',
    measuredSeconds: 9,
  });

  const vp = page.viewportSize();
  if (vp) await page.setViewportSize({ width: vp.height, height: vp.width }); // portrait → landscape
  await bootStaged(page);
  await openPause(page, true);
  await expect(page).toHaveScreenshot('phone-landscape-pause.png', GOLDEN);
});

test('golden: PORTRAIT-HELD phone PAUSE MENU — the overlay through the lock', async ({
  page,
}, testInfo) => {
  // How a phone is actually held mid-match, and the transform the desktop never
  // touches. Also the shot that shows the corner affordance's own placement, since
  // the tap that opened this overlay had to land on it.
  test.skip(testInfo.project.name !== 'iphone', 'one portrait-held phone baseline only (iphone)');
  budgetTest({
    work: 'boot the frozen scene PORTRAIT-HELD (landscape lock rotation) → tap the corner affordance → font settle → one full-frame golden comparison at dpr 3',
    measuredSeconds: 9,
  });

  await bootStaged(page);
  await openPause(page, true);
  await expect(page).toHaveScreenshot('phone-portrait-pause.png', GOLDEN);
});

test('golden: desktop END OF MATCH — the result, and the identity rule', async ({ page }, testInfo) => {
  // Shot over a LIVE match on purpose: `world.match.phase` only reaches 'ended' on
  // a sim tick, so there is no frozen flavour of this screen to ask for. It is
  // deterministic because the overlay is opaque over the whole viewport.
  test.skip(testInfo.project.name !== 'desktop', 'desktop baseline only');
  budgetTest({
    work: 'desktop boot of the debug match → stage a resolved match → font settle → one full-frame golden comparison',
    measuredSeconds: 7,
  });

  await bootLive(page);
  await stageEnd(page, 'result');
  await expect(page).toHaveScreenshot('desktop-end-of-match.png', GOLDEN);
});

test('golden: PORTRAIT-HELD phone ELIMINATED — the one red word, held', async ({
  page,
}, testInfo) => {
  // The other face of the screen: threat red on the result (your reactor was
  // destroyed — damage, the one thing style-guide §2 reserves red for), the
  // placement-and-cause line, and SPECTATE instead of BACK TO MENU. Frozen: an
  // elimination needs no tick to resolve, so this one is pinned.
  test.skip(testInfo.project.name !== 'iphone', 'one portrait-held phone baseline only (iphone)');
  budgetTest({
    work: 'boot the frozen scene PORTRAIT-HELD → stage a local elimination → font settle → one full-frame golden comparison at dpr 3',
    measuredSeconds: 9,
  });

  await bootStaged(page);
  await stageEnd(page, 'defeated');
  await expect(page).toHaveScreenshot('phone-portrait-eliminated.png', GOLDEN);
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

// ---------------------------------------------------------------------------
// The LOBBY and SHIP SELECT, in Gantry/Bone (u7-03 — ratified 2026-08-05)
// ---------------------------------------------------------------------------
//
// The screen where the design and our shipped reality diverge most, and the one
// with the most per row in the game: an identity bar, a P-number, a name, a
// slot-state control, a side chip, a difficulty chip and a ping — beside four
// hull tiles carrying six stats each, and four arena cards.
//
// It appears in no baseline in this repo before now. `?debug=1` skips the lobby
// by contract exactly as it skips the menu, so a total re-skin of it would have
// left every existing golden byte-identical — the same hole u7-01 opened these
// menu baselines to close, one screen further along.
//
// Five images, because this screen has three things worth seeing and two of them
// need a mode change to appear:
//
//   · desktop / phone-landscape / portrait-HELD — the frame, the roster, ship
//     select with its stats, and the arena row, on both form factors and through
//     the 90° rotation the landscape lock puts a held phone through;
//   · desktop + phone-landscape in TEAMS — the `FRIENDLY A` / `ENEMY B` side
//     chips, which FFA draws nowhere at all (GDD §2.1: teams-of-one has no side
//     worth naming), so an FFA-only baseline could never show a change to them.
//
// Determinism: the lobby is a pure function of its state, nothing on it animates
// before RUSH! is pressed, and the offline lobby seats the same seven-character
// cast at the same difficulties on every boot (`ui/lobby` `castForEmptySeat`
// mirrors the server's rule). The build badge in the corner carries the commit
// sha and is deliberately not masked, for the reason stated above.

/** The `window.__lobby` seam (`src/main.ts` LobbySeam), narrowed to what a
 *  baseline needs: is it up, and where are the two controls we press. */
interface LobbyGoldenSeam {
  readonly visible: boolean;
  readonly slotCount: number;
  readonly mode: string;
  readonly seatStates: readonly { readonly label: string }[];
  readonly modeControl: { readonly physicalCenter: { readonly x: number; readonly y: number } };
}

/**
 * Boot clean and walk the ratified play flow to the lobby with REAL presses —
 * PLAY → the doors → PLAY SOLO → the roster — rather than by calling a seam.
 * A baseline of a screen reached by a press proves it is also reachable.
 */
async function openLobby(page: Page): Promise<void> {
  await bootMenu(page);
  const play = await page.evaluate(() => {
    const m = (window as unknown as {
      __mainMenu?: { controls: { kind: string; physicalCenter: { x: number; y: number } }[] };
    }).__mainMenu;
    const c = m?.controls.find((k) => k.kind === 'play');
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  });
  expect(play, 'the menu reports where PLAY is drawn').not.toBeNull();
  await page.mouse.click(play!.x, play!.y);

  await page.waitForFunction(
    () => {
      const d = (window as unknown as {
        __onlineMenu?: { visible: boolean; doorControls: unknown[] };
      }).__onlineMenu;
      return !!d && d.visible && d.doorControls.length > 0;
    },
    undefined,
    { timeout: 20_000 },
  );
  const solo = await page.evaluate(() => {
    const d = (window as unknown as {
      __onlineMenu?: { doorControls: { kind: string; physicalCenter: { x: number; y: number } }[] };
    }).__onlineMenu;
    const c = d?.doorControls.find((k) => k.kind === 'solo');
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  });
  expect(solo, 'the doors report where PLAY SOLO is drawn').not.toBeNull();
  await page.mouse.click(solo!.x, solo!.y);

  await page.waitForFunction(
    () => {
      const l = (window as unknown as { __lobby?: LobbyGoldenSeam }).__lobby;
      return !!l && l.visible && l.slotCount === 8 && l.seatStates.length === 8;
    },
    undefined,
    { timeout: 20_000 },
  );
  // The pointer is left sitting where PLAY SOLO was, which on a desktop would
  // hover whatever roster row landed under it. Park it so the baseline is the
  // screen at rest rather than the screen mid-hover — then wait for the frames
  // that redraw it, in frames rather than in milliseconds (./render-settle.ts).
  await page.mouse.move(1, 1);
  await settleFrames(page);
}

/** Press MODE the way a player does, and wait for the roster to re-word itself
 *  in `FRIENDLY` / `ENEMY`. Read-back proof, not a seam call. */
async function switchToTeams(page: Page): Promise<void> {
  const mode = await page.evaluate(() => {
    const l = (window as unknown as { __lobby?: LobbyGoldenSeam }).__lobby;
    return l ? { x: l.modeControl.physicalCenter.x, y: l.modeControl.physicalCenter.y } : null;
  });
  expect(mode, 'the lobby reports where the MODE toggle is drawn').not.toBeNull();
  await page.mouse.click(mode!.x, mode!.y);
  await page.waitForFunction(
    () => (window as unknown as { __lobby?: LobbyGoldenSeam }).__lobby?.mode === 'teams',
    undefined,
    { timeout: 10_000 },
  );
  await page.mouse.move(1, 1);
  await settleFrames(page);
}

/** Portrait → landscape, for the profiles that declare portrait viewports. */
async function rotateToLandscape(page: Page): Promise<void> {
  const vp = page.viewportSize();
  if (vp) await page.setViewportSize({ width: vp.height, height: vp.width });
}

test('golden: desktop lobby + ship select — Gantry/Bone', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop baseline only');
  budgetTest({
    work: 'desktop boot to the menu → press PLAY → press PLAY SOLO → lobby settle → one full-frame golden comparison',
    measuredSeconds: 12,
  });

  await openLobby(page);
  await expect(page).toHaveScreenshot('desktop-lobby.png', MENU_GOLDEN);
});

test('golden: desktop lobby in TEAMS — FRIENDLY A / ENEMY B on the roster', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop baseline only');
  budgetTest({
    work: 'desktop boot → lobby → press MODE → TEAMS roster settle → one full-frame golden comparison',
    measuredSeconds: 14,
  });

  await openLobby(page);
  await switchToTeams(page);
  await expect(page).toHaveScreenshot('desktop-lobby-teams.png', MENU_GOLDEN);
});

test('golden: landscape phone lobby + ship select — Gantry/Bone', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone', 'one landscape phone baseline only (iphone)');
  budgetTest({
    work: 'rotate to landscape → boot → press PLAY → press PLAY SOLO → lobby settle → one full-frame golden comparison at dpr 3',
    measuredSeconds: 16,
  });

  await rotateToLandscape(page);
  await openLobby(page);
  await expect(page).toHaveScreenshot('phone-landscape-lobby.png', MENU_GOLDEN);
});

test('golden: landscape phone lobby in TEAMS — the side chips under a thumb', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone', 'one landscape phone baseline only (iphone)');
  budgetTest({
    work: 'rotate to landscape → boot → lobby → press MODE → TEAMS roster settle → one full-frame golden comparison at dpr 3',
    measuredSeconds: 18,
  });

  await rotateToLandscape(page);
  await openLobby(page);
  await switchToTeams(page);
  await expect(page).toHaveScreenshot('phone-landscape-lobby-teams.png', MENU_GOLDEN);
});

test('golden: PORTRAIT-HELD phone lobby — the roster survives the lock', async ({
  page,
}, testInfo) => {
  // The phone profiles are portrait by default and Planet Rush is landscape-locked,
  // so this frame goes through the 90° rotation the desktop never touches — and
  // the beams, the separator and eight roster rows are all children of the
  // rotating root. A frame verified on a desktop proves nothing about a held
  // phone, and this screen is the one with the most controls per row in the game.
  test.skip(testInfo.project.name !== 'iphone', 'one portrait-held phone baseline only (iphone)');
  budgetTest({
    work: 'boot to the menu PORTRAIT-HELD (landscape lock rotation) → press PLAY → press PLAY SOLO → lobby settle → one full-frame golden comparison at dpr 3',
    measuredSeconds: 16,
  });

  await openLobby(page);
  await expect(page).toHaveScreenshot('phone-portrait-lobby.png', MENU_GOLDEN);
});
