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

/** Small but tolerant of font/GPU antialiasing — the frozen frame is otherwise
 *  byte-stable. */
const GOLDEN = { maxDiffPixelRatio: 0.01 } as const;

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
  // A couple of render frames after freeze so the final composited frame is up.
  // Wall-clock here, deliberately: `?freeze=1` pins the sim, so there is no tick
  // clock to wait on (the whole suite otherwise waits on ticks — ./sim-clock.ts).
  // It is also harmless: the frozen frame is time-invariant, so a slow host that
  // takes this wait "early" simply screenshots the same deterministic frame.
  await page.waitForTimeout(500);
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
  // The labels are drawn from the render loop, not from the call above.
  await page.waitForTimeout(500);
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
  await page.waitForTimeout(1200);
}

/**
 * The menu screens' screenshot options.
 *
 * Same pixel tolerance as {@link GOLDEN}, but a longer assertion timeout: these
 * boot the REAL app rather than a frozen sim, and `toHaveScreenshot` will not
 * shoot until it has taken two identical frames in a row. On a software-GL runner
 * with three device projects in flight, the menu's first couple of frames land
 * slower than the 10 s default allows — which fails as a *timeout*, not as a
 * pixel diff, and reads like a broken screen when it is a slow one. Measured
 * settled and byte-identical across six consecutive frames once it is up.
 */
const MENU_GOLDEN = { ...GOLDEN, timeout: 30_000 } as const;

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
    await page.waitForTimeout(200);
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
  await page.waitForTimeout(300);
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
  // screen at rest rather than the screen mid-hover.
  await page.mouse.move(1, 1);
  await page.waitForTimeout(600);
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
  await page.waitForTimeout(400);
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
