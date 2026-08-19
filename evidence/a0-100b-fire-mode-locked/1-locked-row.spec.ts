/**
 * evidence/a0-100b-fire-mode-locked/1-locked-row.spec.ts — the FIRE MODE row
 * under Tap Commander, photographed. OWNER: UI Engineer (a0-100b).
 *
 * The brief asks for three things to be looked at: **the locked row on a phone
 * and a desktop, and the help panel as it renders.** This capture takes them
 * through the front door — every press lands at the physical point the CLIENT
 * says it drew that control at (`__mainMenu.settingsControls`, already through
 * the landscape-lock remap), never at a hit-test seam and never by setting state.
 *
 * Per profile, five frames and one readback:
 *
 *   1  settings, seated on the shipped default (CONTROLS = TAP COMMANDER):
 *      FIRE MODE reads AUTO-FIRE, dim, beside five rows that are not
 *   2  the `?` panel open on that row — the reason the lock carries (p4-03)
 *   3  the screen after ONE press on the row: unchanged, which is the point
 *   4  CONTROLS switched to the sticks: the same row live, AUTO-AIM, bright
 *   5  one press there: MANUAL — the control for the frames above, so "it does
 *      not move" is a finding about the lock and not about the harness
 *
 * The readback (`rows.json`) is the model's own `label` / `value` / `disabled`
 * for all six rows at each of those points. It is a CROSS-CHECK and never the
 * finding: where it and the image ever disagreed, the image would win and the
 * disagreement would be the story.
 */
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootMenu, openMenuSettings, park, pressMenu } from '../a0-96-settings-screen/drive';
import { PROFILES } from './profiles';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'shots');

/** One row as the client reports drawing it. a0-96's `drive.ts` reads `label` and
 *  `value`; the seam also carries `disabled` since a0-100b — the model's own flag,
 *  not a second computation of it — so this file reads the rows itself rather than
 *  widening QA's helper. */
interface Row {
  readonly kind: string;
  readonly label: string;
  readonly value: string;
  readonly disabled: boolean;
}

const rows = (page: import('@playwright/test').Page): Promise<Row[]> =>
  page.evaluate(
    () => (window.__mainMenu?.settingsRows ?? []).map((r) => ({ ...r })) as unknown as Row[],
  );

for (const profile of PROFILES) {
  test(`a0-100b the locked FIRE MODE row — ${profile.id}`, async ({ browser }) => {
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
      page.screenshot({ path: join(SHOTS, `${profile.id}-${name}.png`) });

    // A first-run save, so the scheme really is the shipped default rather than
    // whatever a previous frame in this file left behind.
    await context.clearCookies();
    await bootMenu(page);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await bootMenu(page);
    await openMenuSettings(page);
    await park(page);

    const seated = await rows(page);
    await shot('1-locked-tap-autofire');

    // The reason, where the row keeps it.
    await pressMenu(page, 'help:fireMode', profile.touch);
    const helpTitle = await page.evaluate(() => window.__mainMenu?.settingsHelpTitle ?? '');
    await shot('2-help-panel');
    await pressMenu(page, 'help:fireMode', profile.touch); // close it again
    await park(page);

    // ONE press on the row itself.
    await pressMenu(page, 'fireMode', profile.touch);
    const afterPress = await rows(page);
    await shot('3-after-one-press');

    // The control: the same row on the scheme where it is live.
    await pressMenu(page, 'controls', profile.touch); // TAP COMMANDER → the sticks
    const sticks = await rows(page);
    await shot('4-sticks-live-autoaim');
    await pressMenu(page, 'fireMode', profile.touch);
    const sticksPressed = await rows(page);
    await shot('5-sticks-manual');

    const fire = (all: readonly Row[]): Row => all.find((r) => r.kind === 'fireMode')!;

    writeFileSync(
      join(SHOTS, `${profile.id}-rows.json`),
      `${JSON.stringify(
        {
          profile,
          helpTitle,
          frames: {
            '1 seated (tap)': seated,
            '3 after one press (tap)': afterPress,
            '4 sticks': sticks,
            '5 sticks, one press': sticksPressed,
          },
        },
        null,
        2,
      )}\n`,
    );

    // The frames are the evidence; these are the claims they have to be able to
    // carry, asserted so a capture that quietly stopped reaching the screen
    // cannot pass as a clean result.
    expect(fire(seated).value).toBe('AUTO-FIRE');
    expect(fire(seated).disabled).toBe(true);
    expect(fire(afterPress)).toEqual(fire(seated)); // one press changed nothing
    expect(helpTitle).toBe('FIRE MODE');
    expect(fire(sticks)).toMatchObject({ value: 'AUTO-AIM', disabled: false });
    expect(fire(sticksPressed)).toMatchObject({ value: 'MANUAL', disabled: false });

    await context.close();
  });
}
