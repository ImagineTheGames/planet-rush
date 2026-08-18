/**
 * evidence/a0-77-settings-help/measure.spec.ts — the numbers. OWNER: UI Engineer (a0-77).
 *
 * The brief's hardest sentence is a measurement, not a look:
 *
 * > *"The `?` must not crowd the control it explains, and must not overlap the
 * > value or the steppers at the narrowest supported width."*
 *
 * So every number in `audit.txt` is READ OFF THE SHIPPED CLIENT — `__mainMenu
 * .settingsControls`, which now reports each row, each row's `?`, each volume
 * row's −/+ and DONE with the LOGICAL rect the client laid it out in and the
 * PHYSICAL point a real press must land on. Nothing here re-derives the layout:
 * a number this file computed would be a measurement of this file.
 *
 * It also drives the affordance through its whole grammar at each profile — open
 * by tap, dismiss by tapping away, dismiss by tapping the same `?` again, open by
 * keyboard — and records what the client said each time. Raw readings land in
 * `./readback.json`.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { settleFrames } from '../../tests/mobile/render-settle';
import { PROFILES, type Profile } from './profiles';
import { bootMenu, controls, control, openSettings, type Control } from './boot';

const HERE = dirname(fileURLToPath(import.meta.url));

interface Reading {
  readonly profile: string;
  readonly label: string;
  readonly viewport: { width: number; height: number };
  readonly logicalViewport: { width: number; height: number };
  readonly rotated: boolean;
  readonly rows: { kind: string; label: string; value: string }[];
  readonly controls: Control[];
  /** The grammar, walked: what the client reported after each real gesture. */
  readonly grammar: Record<string, string>;
}

const readings: Reading[] = [];

/** Which row's explanation the client says is open, by TITLE — `''` for none.
 *  Read from `__mainMenu.settingsHelpTitle`, which the client writes from the
 *  same model it draws: it can neither claim a panel that is not up nor name a
 *  row other than the one on the glass. A boolean would pass a `?` that opened
 *  its neighbour's explanation; a title does not. */
async function openTitle(page: Page): Promise<string> {
  return page.evaluate(() => window.__mainMenu?.settingsHelpTitle ?? '');
}

for (const profile of PROFILES) {
  test(`a0-77 readback — ${profile.id}`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: profile.touch,
      hasTouch: profile.touch,
    });
    const page = await context.newPage();
    await bootMenu(page);
    await openSettings(page);

    const all = await controls(page);
    const rows = await page.evaluate(() => (window.__mainMenu?.settingsRows ?? []).map((r) => ({ ...r })));
    const view = await page.evaluate(() => ({
      logicalViewport: { ...window.__mainMenu!.logicalViewport },
      rotated: window.__mainMenu!.rotated,
    }));

    // ---- the assertions the audit's tables restate -------------------------
    // Every row has a `?`, and it is a real touch target.
    const helps = all.filter((c) => c.kind.startsWith('help:'));
    expect(helps.length, 'one `?` per row').toBe(rows.length);
    for (const h of helps) {
      expect(h.logical.width, `${h.kind} is thumb-wide`).toBeGreaterThanOrEqual(48);
      expect(h.logical.height, `${h.kind} is thumb-tall`).toBeGreaterThanOrEqual(48);
    }
    // …and on every volume row it ends before the − begins, with the whole pip
    // band between them. This is the brief's sentence, at this width.
    for (const stepper of all.filter((c) => c.kind.startsWith('minus:') || c.kind.startsWith('plus:'))) {
      const help = helps.find((h) => h.kind.slice('help:'.length) === stepper.kind.split(':').slice(1).join(':'));
      expect(help, `a ? for ${stepper.kind}`).toBeTruthy();
      expect(help!.logical.x + help!.logical.width, `${help!.kind} clears ${stepper.kind}`).toBeLessThanOrEqual(
        stepper.logical.x,
      );
    }

    // ---- the grammar, driven with real presses ----------------------------
    const grammar: Record<string, string> = {};
    const tightest = await control(page, 'help:volume:master');
    const gesture = async (x: number, y: number): Promise<void> => {
      if (profile.touch) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
      await settleFrames(page, 6);
    };

    grammar['at rest'] = await openTitle(page);
    await gesture(tightest.physicalCenter.x, tightest.physicalCenter.y);
    grammar['after a press on the ? of MASTER VOLUME'] = await openTitle(page);
    await gesture(tightest.physicalCenter.x, tightest.physicalCenter.y);
    grammar['after a second press on the same ?'] = await openTitle(page);
    await gesture(tightest.physicalCenter.x, tightest.physicalCenter.y);
    await gesture(1, 1);
    grammar['after a press away from every control'] = await openTitle(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    grammar['after ArrowDown then Enter, no pointer'] = await openTitle(page);
    await page.keyboard.press('Escape');
    await settleFrames(page, 6);
    grammar['after Escape'] = await openTitle(page);
    grammar['…and the screen is still SETTINGS'] = await page.evaluate(() => window.__mainMenu?.screen ?? '');

    readings.push({
      profile: profile.id,
      label: profile.label,
      viewport: { width: profile.width, height: profile.height },
      logicalViewport: view.logicalViewport,
      rotated: view.rotated,
      rows,
      controls: all,
      grammar,
    });
    await context.close();
  });
}

test.afterAll(() => {
  mkdirSync(HERE, { recursive: true });
  writeFileSync(join(HERE, 'readback.json'), `${JSON.stringify(readings, null, 2)}\n`);
});

// Referenced so the profile type stays honest if a profile field is renamed.
export type { Profile };
