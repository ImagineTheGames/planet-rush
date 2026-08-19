/**
 * evidence/a0-97-nothing-covers-done/1-what-is-on-top.spec.ts — OWNER: UI Engineer (a0-97).
 *
 * a0-96 photographed the collision and proved it with a press: on the pause
 * SETTINGS screen the DOM DOWNLOAD LOG button sits on the DONE plate, and a press
 * at the point the client says it drew DONE at downloads a log and leaves the
 * screen up. This capture does three things with that:
 *
 *  1. **Names the mechanism, mechanically.** At the physical centre of every
 *     control the client reports drawing — on EVERY pause screen, not just the one
 *     that was photographed — it asks the browser `document.elementFromPoint`.
 *     The answer is the element a real press lands on. `CANVAS` means the game got
 *     the press; anything else names the thing sitting over it, by id.
 *  2. **Enumerates the stack.** Pause reaches exactly two screens — `settings` and
 *     `confirm` — so all three are walked, and every control on each is checked.
 *     A fix that closes one collision and leaves a sibling open would show here.
 *  3. **Presses DONE** at the client's own reported coordinates and records what
 *     the seam says next. Before the fix the answer is `settings` (the screen did
 *     not close); after it, `menu`.
 *
 * Nothing is asserted about the outcome — the run is the finding, and it is run
 * twice, once on the broken code and once on the fix (`A0_97_STAGE`).
 *
 * The driving comes from a0-96's own harness (`../a0-96-settings-screen/drive`),
 * read-only and unmodified, so this capture reaches the screen through exactly the
 * front door QA's finding came through: PLAY → PLAY SOLO → RUSH! → ESC → SETTINGS,
 * every press landing where the client itself says it drew the control.
 */
import { test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROFILES } from '../a0-96-settings-screen/profiles';
import { bootMatchFrontDoor, bootMenu, openPauseSettings, park, pressPause } from '../a0-96-settings-screen/drive';

const HERE = dirname(fileURLToPath(import.meta.url));
const STAGE = process.env.A0_97_STAGE ?? 'broken';
const SHOTS = join(HERE, 'shots', STAGE);

interface Cover {
  readonly kind: string;
  readonly at: { x: number; y: number };
  readonly topmost: string;
}

for (const profile of PROFILES) {
  test(`a0-97 what is on top of every pause control — ${profile.id} (${STAGE})`, async ({ browser }) => {
    test.setTimeout(300_000);
    mkdirSync(SHOTS, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: profile.touch,
      hasTouch: profile.touch,
      acceptDownloads: true,
    });
    const page = await context.newPage();
    const downloads: string[] = [];
    page.on('download', (d) => downloads.push(d.suggestedFilename()));

    await bootMenu(page);
    await bootMatchFrontDoor(page);

    const box = await page.locator('canvas').boundingBox();
    if (!box) throw new Error('no canvas box');

    /** Walk the controls the client says are on screen right now, and ask the
     *  browser what a press at each of them would actually hit. */
    const sweep = async (): Promise<Cover[]> => {
      const controls = await page.evaluate(() =>
        window.__pauseStage!.read().controls.map((c) => ({ kind: c.kind, x: c.physicalCenter.x, y: c.physicalCenter.y })),
      );
      const out: Cover[] = [];
      for (const c of controls) {
        const at = { x: box.x + c.x, y: box.y + c.y };
        // What the browser says is on top at that page point, named the way a
        // report can use it: the tag, plus the id of the nearest identified
        // ancestor. `CANVAS` means the game got the press.
        const topmost = await page.evaluate(({ x, y }) => {
          const el = document.elementFromPoint(x, y);
          if (!el) return 'nothing';
          let id = '';
          for (let n: Element | null = el; n; n = n.parentElement) {
            if (n.id) {
              id = n.id;
              break;
            }
          }
          return id ? `${el.tagName}#${id}` : el.tagName;
        }, at);
        out.push({ kind: c.kind, at, topmost });
      }
      return out;
    };

    /** Where the DOM log affordance is, if it is on screen at all. */
    const logBox = async (): Promise<unknown> =>
      page.evaluate(() => {
        const root = document.getElementById('playtest-download-log');
        if (!root) return { mounted: false };
        const r = root.getBoundingClientRect();
        return {
          mounted: true,
          hidden: root.hidden,
          rect: { x: r.x, y: r.y, width: r.width, height: r.height },
          label: document.getElementById('playtest-download-log-button')?.textContent ?? '',
        };
      });

    // --- The pause MENU ----------------------------------------------------
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__pauseStage!.read().screen === 'menu', undefined, { timeout: 20_000 });
    await park(page);
    const menu = { controls: await sweep(), log: await logBox() };
    await page.screenshot({ path: join(SHOTS, `${profile.id}-pause-menu.png`) });

    // --- The CONFIRM screen (EXIT TO MENU → "Leave the match?") ------------
    await pressPause(page, 'exit', profile.touch);
    await page.waitForFunction(() => window.__pauseStage!.read().screen === 'confirm', undefined, { timeout: 20_000 });
    await park(page);
    const confirm = { controls: await sweep(), log: await logBox() };
    await page.screenshot({ path: join(SHOTS, `${profile.id}-pause-confirm.png`) });
    await pressPause(page, 'stay', profile.touch);
    await page.waitForFunction(() => window.__pauseStage!.read().screen === 'menu', undefined, { timeout: 20_000 });

    // --- The SETTINGS screen — the one a0-96 photographed ------------------
    await pressPause(page, 'settings', profile.touch);
    await page.waitForFunction(() => window.__pauseStage!.read().screen === 'settings', undefined, { timeout: 20_000 });
    await park(page);
    const settings = { controls: await sweep(), log: await logBox() };
    await page.screenshot({ path: join(SHOTS, `${profile.id}-pause-settings.png`) });

    // --- …and the press itself, at the client's own reported DONE point ----
    const done = await page.evaluate(() => {
      const c = window.__pauseStage!.read().controls.find((x) => x.kind === 'back');
      return c ? { ...c.physicalCenter } : null;
    });
    const screenBefore = await page.evaluate(() => window.__pauseStage!.read().screen);
    if (done) {
      if (profile.touch) await page.touchscreen.tap(box.x + done.x, box.y + done.y);
      else await page.mouse.click(box.x + done.x, box.y + done.y);
    }
    await page.waitForTimeout(1_500); // a player's beat; a download is async
    const screenAfter = await page.evaluate(() => window.__pauseStage!.read().screen);
    await page.screenshot({ path: join(SHOTS, `${profile.id}-after-done-press.png`) });

    writeFileSync(
      join(SHOTS, `${profile.id}-cover-report.json`),
      `${JSON.stringify(
        { stage: STAGE, profile: profile.id, viewport: { width: profile.width, height: profile.height, dpr: profile.dpr, touch: profile.touch }, menu, confirm, settings, donePress: { at: done, screenBefore, screenAfter, downloads } },
        null,
        2,
      )}\n`,
    );
    await context.close();
  });
}
