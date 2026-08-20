/**
 * evidence/a0-118-the-four-fixes/1-draw.spec.ts — the outcome a0-111 could not
 * produce, asked for again. OWNER: QA Manager (a0-118).
 *
 * a0-111's verdict, in its own words: *"Eight destroyed reactors, and the screen
 * reads DEFEAT / 'Player 8 won.'"* a0-113 was briefed off that frame and merged
 * (6671a9de, PR #491). A fix is a claim until something looks at it.
 *
 * TWO experiments, because they answer two different questions:
 *
 *  A. `eight-at-once` — a0-111's experiment, REPRODUCED EXACTLY, down to the
 *     retry loop and the single-call burst. Same staging, same profiles, same
 *     readback. If the words under the headline changed, the change is the fix
 *     and nothing else, because nothing else about the experiment moved.
 *
 *  B. `last-two` — the case a REAL match produces. Six seats are killed one at a
 *     time (the match keeps running: more than one team still stands), leaving
 *     the local player and one rival. Those last two are then killed in a SINGLE
 *     call, so their cores fall on the same tick. a0-113's commit message says
 *     the no-survivor branch "fires ONLY on a same-tick wipe of the last two or
 *     more teams" — this is that branch reached from a field of eight, with the
 *     local player in it, which is what a player would actually be looking at.
 *
 * Staging is the sim's own damage function through the ?debug=1 queue
 * (`__planetRush.damageCore`), drained FIFO inside one tick, exactly as a0-111
 * did it. Nothing about the end screen's WORDS is staged, and there is still no
 * draw seam to stage them with. Every burst is RETRIED as a batch because a fresh
 * world holds `station.spawnProtect` up for the opening seconds and
 * `damageStation` refuses every point of damage while it is — a0-111's second
 * trap, kept, because it is still true of this bundle.
 *
 * `?debug=1` and NO `?freeze=1`: `src/main.ts` sets `buildBadge.visible =
 * !flags.freeze`, so a frozen frame is one with the build stamp deliberately
 * hidden, and this brief has to be able to say which build it photographed.
 */
import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { PROFILES } from './profiles';
import { bootDebugMatch, layoutRows, park } from './drive';
import { frame, note } from './shot';

type Case = 'eight-at-once' | 'last-two';

const ALL_SEATS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

/** Every core's HP, in seat order. */
async function coreHp(page: Page): Promise<(number | null)[]> {
  return page.evaluate(() => Array.from({ length: 8 }, (_, p) => window.__planetRush!.coreHp?.(p) ?? null));
}

/** Queue one lethal write per named seat in a SINGLE call, retried as a batch
 *  until every one of them is down. One call is what makes the deaths
 *  simultaneous: the debug queue drains FIFO inside one tick, so the whole batch
 *  lands on the same tick or none of it does. The retry is for spawn protection,
 *  and every attempt is the same simultaneous batch. */
async function killTogether(page: Page, seats: readonly number[]): Promise<boolean> {
  for (let attempt = 0; attempt < 30; attempt++) {
    await page.evaluate((ss) => {
      for (const p of ss) window.__planetRush!.damageCore?.(p, 999);
    }, seats as number[]);
    await page.waitForTimeout(500);
    const hp = await page.evaluate(
      (ss) => (ss as number[]).map((p) => window.__planetRush!.coreHp?.(p) ?? 0),
      seats as number[],
    );
    if (hp.every((h) => h <= 0)) return true;
  }
  return false;
}

/** Wait for an end screen, skip the count-up the way an input does, wait for the
 *  sequence's own `done`. A frame taken mid-count is a frame of another screen. */
async function settleEndScreen(page: Page): Promise<string> {
  await page
    .waitForFunction(() => window.__endScreenStage!.screen() !== 'none', undefined, { timeout: 30_000 })
    .catch(() => undefined);
  const screen = await page.evaluate(() => window.__endScreenStage!.screen());
  if (screen === 'none') return screen;
  await page.evaluate(() => window.__endScreenStage!.summarySkip());
  await page
    .waitForFunction(() => (window.__endScreenStage!.summary()?.done ?? true) === true, undefined, { timeout: 20_000 })
    .catch(() => undefined);
  await park(page);
  return screen;
}

for (const profile of PROFILES) {
  for (const kind of ['eight-at-once', 'last-two'] as const satisfies readonly Case[]) {
    test(`a0-118 the draw — ${kind} — ${profile.id}`, async ({ browser }) => {
      test.setTimeout(300_000);
      const context = await browser.newContext({
        viewport: { width: profile.width, height: profile.height },
        deviceScaleFactor: profile.dpr,
        isMobile: profile.touch,
        hasTouch: profile.touch,
      });
      const page = await context.newPage();
      await bootDebugMatch(page);
      await page.waitForTimeout(800);

      let staging: string;
      let hpBeforeTheLastBurst: (number | null)[] | null = null;
      let landed: boolean;
      if (kind === 'eight-at-once') {
        landed = await killTogether(page, ALL_SEATS);
        staging =
          'a0-111 reproduced exactly: one lethal __planetRush.damageCore(p, 999) queued for all EIGHT seats in a SINGLE call, retried as a batch until spawn protection lapsed and it landed, so every core fell on the same tick';
      } else {
        // Six seats first, one at a time, each retried until it is down. The
        // match keeps running through all six — more than one team still stands
        // — so this is the field thinning the way a match thins it.
        for (const p of [7, 6, 5, 4, 3, 2]) {
          for (let attempt = 0; attempt < 30; attempt++) {
            const hp = await page.evaluate((s) => {
              window.__planetRush!.damageCore?.(s, 999);
              return window.__planetRush!.coreHp?.(s) ?? 0;
            }, p);
            await page.waitForTimeout(400);
            const now = await page.evaluate((s) => window.__planetRush!.coreHp?.(s) ?? 0, p);
            if (now <= 0 || hp <= 0) break;
          }
        }
        await page.waitForTimeout(600);
        hpBeforeTheLastBurst = await coreHp(page);
        // ...and now the last two, together, in one call.
        landed = await killTogether(page, [0, 1]);
        staging =
          'the case a real match produces: seats 7,6,5,4,3,2 killed ONE AT A TIME (the match keeps running — more than one team still stands), leaving the LOCAL player (seat 0) and one rival (seat 1); those last two then killed in a SINGLE call, so their cores fell on the same tick';
      }
      await page.waitForTimeout(1_200);

      const screen = await settleEndScreen(page);
      const name = `${profile.id}-draw-${kind}`;
      await frame(page, name);

      const read = await page.evaluate(() => ({
        screen: window.__endScreenStage!.screen(),
        result: window.__endScreenStage!.result(),
        buttons: window.__endScreenStage!.buttons(),
      }));
      const cores = await coreHp(page);

      note(name, {
        profile: profile.label,
        boot: '?debug=1 on the production bundle (no ?freeze — the build stamp is in frame)',
        experiment: kind,
        staging,
        burstLanded: landed,
        hpBeforeTheLastBurst,
        coreHpAfter: cores,
        everyCoreDown: cores.every((h) => (h ?? 1) <= 0),
        screenReported: screen,
        // The two words this whole brief turns on, taken off the client's own
        // strings. The PICTURE is what the attestation is written from.
        headline: read.result?.headline ?? null,
        subhead: read.result?.subhead ?? null,
        result: read.result,
        buttons: read.buttons,
        // a0-111's own two questions of this screen, asked again unchanged.
        subheadNamesAPlayer: /player\s*\d/i.test(read.result?.subhead ?? ''),
        subheadSaysWon: /\bwon\b|\bwin[s]?\b/i.test(read.result?.subhead ?? ''),
        elements: (await layoutRows(page)).map((r) => r.id),
      });
      await context.close();
    });
  }
}
