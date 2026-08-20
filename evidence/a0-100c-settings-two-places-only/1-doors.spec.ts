/**
 * evidence/a0-100c-settings-two-places-only/1-doors.spec.ts — the doors screen's
 * footer beam, photographed. OWNER: UI Engineer (a0-100c).
 *
 * The brief asks for **the doors screen before and after, on a phone and a
 * desktop** — and, before anything is deleted, for the PR to establish whether
 * the SETTINGS button navigated or was dead chrome. This capture answers both
 * with the same presses, through the front door: boot, PLAY, and then a real
 * press at the point the client actually drew the trailing footer plate at.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PRESS POINT IS COMPUTED AND NOT READ FROM A SEAM
 * ---------------------------------------------------------------------------
 * It cannot be read from one. `__onlineMenu.doorControls` (src/main.ts) reports
 * the four doors, the join-screen segments and BACK — **and not SETTINGS.** The
 * live-stage seam had the same hole in it as `NAV_EDGES`: the button was drawn
 * on a live screen and recorded by nothing that describes the screen. That is
 * the finding, so this file works around it rather than papering over it.
 *
 * So the point is derived from BACK, which the seam does report. Both plates are
 * `beamPlate`s on one footer strip with one gutter — BACK bolted to the leading
 * end, SETTINGS to the trailing end (`lobby-geometry.ts` `entryLayout`) — so the
 * trailing plate is the leading plate's MIRROR about the canvas centre. BACK's
 * reference width is 140 and SETTINGS' is 190, so the mirror of BACK's *centre*
 * lands 70 reference-px inside the trailing plate's outer edge, comfortably
 * within a 190-wide plate whichever way the squeeze factor moves them together.
 *
 * The mirror is arithmetic, and arithmetic can be wrong. So no frame here is
 * asked to be believed on its own: **every press asserts the screen it lands
 * on.** BEFORE, the assertion is that this press opens settings — which is the
 * proof that the button navigated. AFTER, the assertion is that the identical
 * press changes nothing — which is the proof the control is gone rather than
 * merely invisible. A missed press fails the run instead of quietly producing a
 * frame that says what the author hoped.
 *
 * Per profile, run with MODE=before:
 *
 *   1  the doors, at rest, footer beam carrying BACK and SETTINGS
 *   2  where that SETTINGS press lands: the settings screen
 *   3  where DONE then lands: the MAIN MENU — one screen further out than the
 *      doors the player pressed from. `closeSettings()` is unconditional
 *      (`screen = 'menu'`), so the button was never a round trip.
 *
 * …and with MODE=after:
 *
 *   1  the doors, at rest, footer beam carrying BACK alone
 *   2  the same press, landing on nothing: still the doors
 *   3  BACK, still one press to the main menu — where settings lives
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootMenu, park } from '../a0-96-settings-screen/drive';
import { PROFILES } from './profiles';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'shots');
/** `before` photographs the shipped button; `after` photographs its absence. */
const MODE = process.env.A0_100C_MODE === 'after' ? 'after' : 'before';

interface Point {
  readonly x: number;
  readonly y: number;
}

/** The canvas origin in page space — the seams report canvas-local physical
 *  points, so a real press adds this back (a0-96 `drive.ts`, same reason). */
async function canvasBox(page: Page): Promise<{ x: number; y: number; width: number }> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas bounding box');
  return { x: box.x, y: box.y, width: box.width };
}

/** Press a MAIN MENU button by kind, with a real press where the client drew it. */
async function pressMenuButton(page: Page, kind: string, touch: boolean): Promise<void> {
  const o = await canvasBox(page);
  const p = await page.evaluate((k) => {
    const c = (window.__mainMenu?.controls ?? []).find((x) => x.kind === k);
    return c ? { ...c.physicalCenter } : null;
  }, kind);
  expect(p, `the main menu reports where ${kind} is drawn`).not.toBeNull();
  if (touch) await page.touchscreen.tap(o.x + p!.x, o.y + p!.y);
  else await page.mouse.click(o.x + p!.x, o.y + p!.y);
  await park(page);
}

/** BACK's drawn centre on the doors, canvas-local physical — the one footer
 *  plate the seam does report, and the anchor the mirror is taken from. */
async function backCentre(page: Page): Promise<Point> {
  const p = await page.evaluate(() => {
    const c = (window.__onlineMenu?.doorControls ?? []).find((x) => x.kind === 'back');
    return c ? { ...c.physicalCenter } : null;
  });
  expect(p, 'the doors report where BACK is drawn').not.toBeNull();
  return p!;
}

for (const profile of PROFILES) {
  test(`a0-100c the doors' footer beam (${MODE}) — ${profile.id}`, async ({ browser }) => {
    test.setTimeout(300_000);
    mkdirSync(SHOTS, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: profile.touch,
      hasTouch: profile.touch,
    });
    const page = await context.newPage();
    const shot = (name: string): Promise<Buffer> =>
      page.screenshot({ path: join(SHOTS, `${profile.id}-${MODE}-${name}.png`) });

    // A first-run boot, so the doors are the shipped ones rather than whatever a
    // previous frame left in storage (the join screen remembers its mode).
    await context.clearCookies();
    await bootMenu(page);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await bootMenu(page);

    // --- PLAY opens the doors ------------------------------------------------
    await pressMenuButton(page, 'play', profile.touch);
    await page.waitForFunction(() => window.__mainMenu?.screen === 'online', undefined, { timeout: 20_000 });
    await park(page);

    // The footer beam, at rest. THE frame the brief asks for.
    await shot('1-doors');

    // --- The press, at the trailing end of the footer beam --------------------
    const box = await canvasBox(page);
    const back = await backCentre(page);
    // The mirror is taken in the space the seam REPORTS in, which is the
    // un-rotated page space the canvas is laid out in — `logicalToPhysical`
    // (src/platform/orientation.ts) is the identity while the root is not
    // rotated, so "physical" here is CSS pixels and the device pixel ratio never
    // enters. Scaling by `dpr` here is what the first run of this capture did,
    // and it put the press in empty space beside the door plates.
    const target: Point = { x: box.width - back.x, y: back.y };
    const rotated = await page.evaluate(() => window.__mainMenu?.rotated ?? false);
    // A rotated root would put the footer beam down a screen EDGE, and a mirror
    // about the horizontal centre would then name a point on the wrong side of
    // the glass. Both profiles are landscape, so this holds — asserted rather
    // than assumed, because the arithmetic below is only true while it does.
    expect(rotated, 'both profiles are landscape, so the root is not rotated').toBe(false);

    if (profile.touch) await page.touchscreen.tap(box.x + target.x, box.y + target.y);
    else await page.mouse.click(box.x + target.x, box.y + target.y);
    await park(page);

    const landed = await page.evaluate(() => window.__mainMenu?.screen ?? '');

    if (MODE === 'before') {
      // THE VERDICT: the button navigates. Not dead chrome.
      expect(landed, 'the trailing footer plate opens the settings screen').toBe('settings');
      await shot('2-press-opens-settings');

      // …and DONE does not come back to the doors. `closeSettings()` sets
      // `screen = 'menu'` unconditionally, so the way out of a screen opened
      // FROM the doors is the main menu — the player is put one screen further
      // out than where they pressed from.
      const o = await canvasBox(page);
      const done = await page.evaluate(() => {
        const c = (window.__mainMenu?.settingsControls ?? []).find((x) => x.kind === 'back');
        return c ? { ...c.physicalCenter } : null;
      });
      expect(done, 'the settings screen reports where DONE is drawn').not.toBeNull();
      if (profile.touch) await page.touchscreen.tap(o.x + done!.x, o.y + done!.y);
      else await page.mouse.click(o.x + done!.x, o.y + done!.y);
      await park(page);
      expect(
        await page.evaluate(() => window.__mainMenu?.screen ?? ''),
        'DONE lands on the MAIN MENU, not back on the doors it was opened from',
      ).toBe('menu');
      await shot('3-done-lands-on-main-menu');
    } else {
      // The control is GONE, not merely undrawn: the identical press that opened
      // settings before now lands on nothing and the doors keep the screen.
      expect(landed, 'the same press now lands on nothing — the doors keep the screen').toBe('online');
      await shot('2-same-press-lands-on-nothing');

      // BACK still leaves, which is the developer's own argument: the doors keep
      // their way out, and it reaches the menu where settings lives one press away.
      const o = await canvasBox(page);
      const back2 = await backCentre(page);
      if (profile.touch) await page.touchscreen.tap(o.x + back2.x, o.y + back2.y);
      else await page.mouse.click(o.x + back2.x, o.y + back2.y);
      await park(page);
      expect(
        await page.evaluate(() => window.__mainMenu?.screen ?? ''),
        'BACK still reaches the main menu, where SETTINGS is one press away',
      ).toBe('menu');
      await shot('3-back-reaches-the-menu-where-settings-lives');
    }

    // A plain readback beside the frames: what the doors say they drew. It is a
    // CROSS-CHECK and never the finding — where it and the image disagreed, the
    // image would win and the disagreement would be the story.
    writeFileSync(
      join(SHOTS, `${profile.id}-${MODE}-doors.json`),
      `${JSON.stringify({ profile: profile.id, mode: MODE, pressedAt: target, backCentre: back, landed }, null, 2)}\n`,
    );

    await context.close();
  });
}
