/**
 * evidence/a0-111-yesterday-with-eyes/3-fire-mode.spec.ts — the FIRE MODE row
 * under Tap Commander, after a0-100b locked it. OWNER: QA Manager (a0-111).
 *
 * a0-96 photographed this row when it was a control that responded and changed
 * nothing: it said AUTO-AIM, it toggled to MANUAL, and the match played
 * identically either way. The brief's question now is a different one — the row
 * is supposed to read `AUTO-FIRE`, be VISIBLY disabled, and not toggle — and it
 * asks for the press to be made at the coordinates the client reports and for the
 * stored value to be written down either side of it.
 *
 * ── THE CONTROL FOR THE MEASUREMENT ─────────────────────────────────────────
 * "I pressed it and nothing happened" is worth nothing on its own: a press that
 * missed produces exactly the same sentence. So every run here ends by switching
 * CONTROLS to the sticks scheme — where the row is *supposed* to be live — and
 * pressing FIRE MODE again at the same kind of reported point. If that press does
 * not move the value and the store, then this harness cannot press this row at
 * all and nothing above it means anything. The readback carries both.
 *
 * ── AND THE `?` ─────────────────────────────────────────────────────────────
 * a0-100b says the row's help panel should now explain the LOCK rather than
 * explain CONTROLS. So the panel is opened with a real press on `help:fireMode`
 * and photographed, and the words in it are read off the frame.
 *
 * Both ways into settings are walked, because a0-100c's whole point was that
 * there are exactly two: the MENU's SETTINGS door, and the PAUSE overlay's.
 */
import { test } from '@playwright/test';
import { PROFILES } from './profiles';
import {
  bootMenu,
  controlPoint,
  menuRows,
  park,
  pressAt,
  pressControl,
  storage,
  topmostAt,
} from './drive';
import { frame, note } from './shot';
import { recordWords, drawnWords, hits, fullStrings } from './words';
import { settleFrames } from '../../tests/mobile/render-settle';

const FIRE_MODE_KEY = 'planet-rush:fireMode';
const SCHEME_KEY = 'planet-rush:controlScheme';

/** One press on a settings row, with everything a reader needs to judge it:
 *  where it landed, who the browser says received it, and the row + the STORE
 *  either side. */
async function pressRow(
  page: import('@playwright/test').Page,
  kind: string,
  touch: boolean,
): Promise<unknown> {
  const found = await controlPoint(page, 'settings', kind);
  const before = { rows: await menuRows(page), store: await storage(page) };
  const who = found.point ? await topmostAt(page, found.point.x, found.point.y) : null;
  if (found.point) await pressAt(page, found.point, touch);
  await settleFrames(page, 8);
  const after = { rows: await menuRows(page), store: await storage(page) };
  const row = (rows: { kind: string; label: string; value: string; disabled?: boolean }[]): unknown =>
    rows.find((r) => r.kind === (kind.startsWith('help:') ? kind.slice(5) : kind)) ?? null;
  return {
    control: kind,
    pressedAt: found.point,
    topmostAtThatPoint: who,
    rowBefore: row(before.rows),
    rowAfter: row(after.rows),
    storedFireModeBefore: before.store[FIRE_MODE_KEY] ?? '(absent)',
    storedFireModeAfter: after.store[FIRE_MODE_KEY] ?? '(absent)',
    storedSchemeBefore: before.store[SCHEME_KEY] ?? '(absent)',
    storedSchemeAfter: after.store[SCHEME_KEY] ?? '(absent)',
  };
}

for (const profile of PROFILES) {
  test(`a0-111 FIRE MODE is locked under Tap Commander — ${profile.id}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: profile.touch,
      hasTouch: profile.touch,
    });
    const page = await context.newPage();
    await recordWords(page);
    await bootMenu(page);

    await pressControl(page, 'menu', 'settings', profile.touch);
    await page.waitForFunction(() => window.__mainMenu?.screen === 'settings', undefined, { timeout: 20_000 });
    await park(page);
    await frame(page, `${profile.id}-fire-1-at-rest`);

    const scheme = await page.evaluate(() => window.__mainMenu!.controlScheme);
    const atRest = { rows: await menuRows(page), store: await storage(page) };

    // Two presses, so "it did not toggle" is not a claim resting on one press.
    const press1 = await pressRow(page, 'fireMode', profile.touch);
    await frame(page, `${profile.id}-fire-2-after-one-press`);
    const press2 = await pressRow(page, 'fireMode', profile.touch);
    await frame(page, `${profile.id}-fire-3-after-two-presses`);

    // The `?` panel.
    const helpPress = await pressRow(page, 'help:fireMode', profile.touch);
    await settleFrames(page, 10);
    await frame(page, `${profile.id}-fire-4-help-panel`);
    const helpTitle = await page.evaluate(() => window.__mainMenu!.settingsHelpTitle);
    const helpWords = await drawnWords(page);
    // Close it again with a second press on the same `?`, so the control frame
    // below is the plain screen and not the screen with a panel over it.
    await pressRow(page, 'help:fireMode', profile.touch);

    // --- THE CONTROL: the same row on the scheme where it is meant to be live.
    const schemeSwitch = await pressRow(page, 'controls', profile.touch);
    await settleFrames(page, 10);
    await frame(page, `${profile.id}-fire-5-sticks-scheme`);
    const liveRowPress = await pressRow(page, 'fireMode', profile.touch);
    await frame(page, `${profile.id}-fire-6-sticks-after-press`);

    const words = await drawnWords(page);
    note(`${profile.id}-fire-mode`, {
      profile: profile.label,
      boot: '?gate=0 on the production bundle → SETTINGS (the menu door)',
      controlSchemeAtRest: scheme,
      rowsAtRest: atRest.rows,
      storeAtRest: atRest.store,
      press1,
      press2,
      helpPress,
      helpTitle,
      helpPanelText: fullStrings(helpWords),
      // The control for the measurement — if this one does not move, nothing above it counts.
      schemeSwitch,
      liveRowPress,
      claimHits: hits(words, 'claim'),
      screenText: fullStrings(words),
    });
    await context.close();
  });

  test(`a0-111 FIRE MODE on the PAUSE settings screen — ${profile.id}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: profile.touch,
      hasTouch: profile.touch,
    });
    const page = await context.newPage();
    await recordWords(page);
    await bootMenu(page);

    // The front door into a real match, then the OTHER way into settings.
    await page.evaluate(() => window.__mainMenu!.play());
    await page.waitForFunction(() => typeof window.__onlineMenu?.solo === 'function', undefined, { timeout: 30_000 });
    await page.evaluate(() => window.__onlineMenu!.solo());
    await page.waitForFunction(() => typeof window.__lobby?.rush === 'function', undefined, { timeout: 30_000 });
    await page.evaluate(() => window.__lobby!.rush());
    await page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 30_000 });
    await page.waitForFunction(() => (window.__pauseStage?.read().simTicks ?? 0) > 5, undefined, { timeout: 30_000 });
    await settleFrames(page, 8);

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__pauseStage!.read().screen === 'menu', undefined, { timeout: 20_000 });
    await pressControl(page, 'pause', 'settings', profile.touch);
    await page.waitForFunction(() => window.__pauseStage!.read().screen === 'settings', undefined, { timeout: 20_000 });
    await park(page);
    await frame(page, `${profile.id}-fire-pause-1-at-rest`);

    const before = await storage(page);
    const found = await controlPoint(page, 'pause', 'fireMode');
    const who = found.point ? await topmostAt(page, found.point.x, found.point.y) : null;
    if (found.point) await pressAt(page, found.point, profile.touch);
    await settleFrames(page, 8);
    await frame(page, `${profile.id}-fire-pause-2-after-press`);
    const after = await storage(page);

    const words = await drawnWords(page);
    note(`${profile.id}-fire-mode-pause`, {
      profile: profile.label,
      boot: '?gate=0 → PLAY → SOLO → RUSH → Esc → SETTINGS (the pause door)',
      pauseControls: found.kinds,
      pressedAt: found.point,
      topmostAtThatPoint: who,
      storedFireModeBefore: before[FIRE_MODE_KEY] ?? '(absent)',
      storedFireModeAfter: after[FIRE_MODE_KEY] ?? '(absent)',
      storedSchemeBefore: before[SCHEME_KEY] ?? '(absent)',
      storedSchemeAfter: after[SCHEME_KEY] ?? '(absent)',
      claimHits: hits(words, 'claim'),
      screenText: fullStrings(words),
    });
    await context.close();
  });
}
