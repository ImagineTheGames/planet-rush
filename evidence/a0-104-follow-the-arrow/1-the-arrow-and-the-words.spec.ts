/**
 * evidence/a0-104-follow-the-arrow/1-the-arrow-and-the-words.spec.ts
 * OWNER: UI Engineer (a0-104).
 *
 * a0-99 caught the siege in one state only — the player's own station ON SCREEN,
 * the band reading "Your station is under attack — Follow the arrow", and no
 * arrow on either viewport. It named two possible readings and refused to pick
 * between them without the frame it had not captured. This captures both frames,
 * on both profiles, off the production bundle:
 *
 *   1-home-on-screen   — a0-99's own state, reproduced. The station is under the
 *                        ship, the arrow is (correctly) hidden.
 *   2-home-off-screen  — the frame a0-99 could not take. The ship is 900/900
 *                        away, the station is outside the visible world, and the
 *                        arrow is on the edge.
 *
 * ONE BOOT PER FRAME, and a fresh browser context with it. Onboarding completion
 * is persisted to the career profile (`src/ui/onboarding-memory.ts`), so two legs
 * sharing a context would have the first leg's siege deciding what the second one
 * is allowed to show. Each frame is a first match.
 *
 * Nothing is asserted about the game. The only expectation in this file is that
 * the HARNESS staged what it claims to have staged (the alarm is up) — the
 * finding itself is whatever comes back in the PNG and the readback beside it.
 */
import { test } from '@playwright/test';
import { PROFILES } from './profiles';
import {
  assertStaged,
  bootDebugMatch,
  frame,
  note,
  park,
  readback,
  startSiege,
  stopSiege,
  waitForAlarm,
} from './harness';

/**
 * `before` / `after`, from the environment. The BEFORE run is this exact spec
 * against the pre-fix `src/ui/onboarding.ts` + `src/ui/hud.ts` (the merge base's
 * copies, checked out into the tree for the run) — same harness, same bundle
 * pipeline, same profiles, so the pair differs in the code under it and in
 * nothing else. See ./README.md for the two commands.
 */
const TAG = process.env.A0_104_TAG ?? 'after';

const LEGS = [
  {
    id: '1-home-on-screen',
    where: 'home' as const,
    what: "a0-99's state: the local ship parked at its own station (__oreHudStage.dock(0))",
  },
  {
    id: '2-home-off-screen',
    where: 'away' as const,
    what: 'the frame a0-99 could not take: the ship at station + (900, 900) (__oreHudStage.mine(0))',
  },
];

for (const profile of PROFILES) {
  for (const leg of LEGS) {
    test(`a0-104 ${TAG} ${leg.id} — ${profile.id}`, async ({ browser }) => {
      test.setTimeout(300_000);
      const context = await browser.newContext({
        viewport: { width: profile.width, height: profile.height },
        deviceScaleFactor: profile.dpr,
        isMobile: profile.touch,
        hasTouch: profile.touch,
      });
      const page = await context.newPage();
      await bootDebugMatch(page);
      await page.waitForTimeout(900);

      await park(page, leg.where);
      // The siege runs for the whole capture, in the page — see `startSiege` in
      // ./harness.ts for why a burst of damage is not enough and why the pump
      // has a floor. Nothing about the HUD is staged: this hurts the reactor and
      // photographs what the shipped HUD decided to do about it.
      await startSiege(page);
      const polls = await waitForAlarm(page);
      const ship = await park(page, leg.where);

      const read = (await readback(page, ship, leg.where)) as {
        alarmFrameDrawn: boolean;
        coreHp: number | null;
      };
      await frame(page, `${profile.id}-${TAG}-${leg.id}`);
      // …and what the client still said once the shutter had closed, so a frame
      // taken across a lapse shows up as a disagreement rather than passing.
      const afterShot = (await readback(page, ship, leg.where)) as { alarmFrameDrawn: boolean };
      await stopSiege(page);

      note(`${profile.id}-${TAG}-${leg.id}`, {
        profile: profile.label,
        tag: TAG,
        boot: '?debug=1 on the production bundle, fresh context (no carried onboarding memory)',
        staged: leg.what,
        damage:
          "damageCore(0, 2) every 400ms through the sim's own damage function on a tick boundary, held for the whole capture and floored at 30 core HP so the station survives",
        pollsToAlarm: polls,
        stillUpAfterTheShot: afterShot.alarmFrameDrawn,
        ...read,
      });
      assertStaged(read);
      await context.close();
    });
  }
}
