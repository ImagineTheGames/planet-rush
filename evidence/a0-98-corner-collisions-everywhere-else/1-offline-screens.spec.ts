/**
 * evidence/a0-98-corner-collisions-everywhere-else/1-offline-screens.spec.ts —
 * OWNER: UI Engineer (a0-98).
 *
 * a0-97 swept the pause stack and stopped there, honestly and by its brief. The
 * mechanism it named is not specific to pause: the DOWNLOAD LOG affordance is
 * raised from FOUR places in `src/main.ts`, and only the two pause ones are
 * guarded. This capture walks the three the guard never sees on the offline
 * bundle — the boot-failure screen, the front door's refusals, and the screens
 * either side of them — and asks the browser the same question at every control
 * the client says it drew.
 *
 * Nothing is asserted here. The run IS the finding: it is taken twice, once on
 * today's code and once on the fix (`A0_98_STAGE`), and the two tables are the
 * PR's evidence. The assertions live in `src/net/playtest-log-button.test.ts`.
 *
 * The disconnect case — the one that matters most, and the one that can arrive on
 * any screen — needs a real allocator and a real match server behind the bundle,
 * so it is `./2-online-disconnect.spec.ts` on its own config.
 */
import { test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROFILES } from '../a0-96-settings-screen/profiles';
import { sweepState, type StateReport } from './probe';

const HERE = dirname(fileURLToPath(import.meta.url));
const STAGE = process.env.A0_98_STAGE ?? 'broken';
const SHOTS = join(HERE, 'shots', STAGE);

/** Let the client settle without importing a suite helper: these screens are not
 *  all Pixi, and the boot-failure one has no render loop at all. */
async function beat(page: import('@playwright/test').Page, ms = 900): Promise<void> {
  await page.waitForTimeout(ms);
  await page.mouse.move(1, 1);
  await page.waitForTimeout(200);
}

for (const profile of PROFILES) {
  test(`a0-98 what is on top, offline screens — ${profile.id} (${STAGE})`, async ({ browser }) => {
    test.setTimeout(600_000);
    mkdirSync(SHOTS, { recursive: true });
    const reports: StateReport[] = [];

    const newPage = async (): Promise<import('@playwright/test').Page> => {
      const context = await browser.newContext({
        viewport: { width: profile.width, height: profile.height },
        deviceScaleFactor: profile.dpr,
        isMobile: profile.touch,
        hasTouch: profile.touch,
        acceptDownloads: true,
      });
      contexts.push(context);
      return context.newPage();
    };
    const contexts: import('@playwright/test').BrowserContext[] = [];

    const out = join(SHOTS, `${profile.id}-offline-report.json`);
    const flush = (): void => {
      writeFileSync(out, `${JSON.stringify({ stage: STAGE, profile: profile.id, reports }, null, 2)}\n`);
    };
    // Each state is recorded and FLUSHED on its own. A walk that cannot reach the
    // sixth screen must still hand over the five it did reach — a capture that
    // loses its whole table to one bad step is a capture that reports nothing.
    const record = async (
      page: import('@playwright/test').Page,
      state: string,
      context?: Record<string, unknown>,
    ): Promise<void> => {
      try {
        const report = await sweepState(page, state, profile, context);
        reports.push(report);
        await page.screenshot({ path: join(SHOTS, `${profile.id}-${state}.png`) });
      } catch (err) {
        reports.push({
          state,
          profile: profile.id,
          viewport: { width: profile.width, height: profile.height, dpr: profile.dpr, touch: profile.touch },
          log: { mounted: false },
          controls: [],
          collisions: [],
          context: { unreached: String(err) },
        });
      }
      flush();
    };

    try {
    // =====================================================================
    // 1. THE BOOT-FAILURE SCREEN (`main.ts` presentBootFailure, site 4 of 4)
    // =====================================================================
    // Forced the way a player meets it: a machine that cannot give the page a GL
    // context. `probeWebGl` (`@platform/gl-probe`) walks every context id and
    // gets null from each, `boot()` throws, and the whole of it lands on the
    // friendly screen with RETRY on it — the real path, not a staged screen.
    {
      const page = await newPage();
      await page.addInitScript(() => {
        const proto = HTMLCanvasElement.prototype as unknown as {
          getContext: (id: string) => unknown;
        };
        proto.getContext = function getContext(): unknown {
          return null;
        };
      });
      await page.goto('/?gate=0');
      await page.waitForSelector('#boot-error', { state: 'visible', timeout: 60_000 });
      await beat(page);
      await record(page, 'boot-failure');
    }

    // =====================================================================
    // 2-6. THE FRONT DOOR AND WHAT IT REFUSES (site 3 of 4)
    // =====================================================================
    // One page, walked: the doors at rest, the doors refused, the room list, the
    // keypad refused, and the lobby PLAY SOLO opens. The offline artifact has no
    // allocator baked in, so CREATE and JOIN really do fail here — that is the
    // "can't reach the servers" page the log offer was written for, reached the
    // only honest way.
    {
      const page = await newPage();
      await page.goto('/?gate=0');
      await page.waitForSelector('canvas', { state: 'attached', timeout: 60_000 });
      await page.waitForFunction(
        () => !!(window as never as { __mainMenu?: { visible: boolean } }).__mainMenu?.visible,
        undefined,
        { timeout: 60_000 },
      );
      await beat(page);
      await record(page, 'menu');

      // PLAY → the doors.
      await page.evaluate(() => (window as never as { __mainMenu: { play(): void } }).__mainMenu.play());
      await page.waitForFunction(
        () => (window as never as { __onlineMenu?: { visible: boolean } }).__onlineMenu?.visible === true,
        undefined,
        { timeout: 60_000 },
      );
      await beat(page);
      await record(page, 'doors-idle', await entryContext(page));

      // CREATE ROOM, with nothing behind it — the refusal the offer exists for.
      await page.evaluate(() => (window as never as { __onlineMenu: { create(): void } }).__onlineMenu.create());
      await waitForEntryStatus(page, 'error');
      await beat(page, 1_500);
      await record(page, 'doors-error', await entryContext(page));

      // JOIN → the room list (the default mode), still carrying that refusal.
      await page.evaluate(() => (window as never as { __onlineMenu: { join(): void } }).__onlineMenu.join());
      await beat(page, 1_200);
      await record(page, 'join-browse', await entryContext(page));

      // …and the KEYPAD, refused. An eight-column pad of room-code keys, and
      // `entryFailed` leaves `entry.screen` exactly where it was, so the offer
      // that `screen === 'online' && status === 'error'` raises lands on it.
      await page.evaluate(() =>
        (window as never as { __onlineMenu: { setJoinMode(m: string): void } }).__onlineMenu.setJoinMode('code'),
      );
      await beat(page, 800);
      await record(page, 'join-keypad-idle', await entryContext(page));
      const code = await page.evaluate(() => {
        const seam = (window as never as {
          __onlineMenu: { typeCode(c: string): void; submit(): void; doorControls: { kind: string }[] };
        }).__onlineMenu;
        const keys = seam.doorControls.filter((c) => c.kind.startsWith('key:')).map((c) => c.kind.slice(4));
        const typed = keys.slice(0, 4);
        for (const ch of typed) seam.typeCode(ch);
        seam.submit();
        return typed.join('');
      });
      await waitForEntryStatus(page, 'error');
      await beat(page, 1_500);
      await record(page, 'join-keypad-error', { ...(await entryContext(page)), codeTyped: code });

      // BACK, then PLAY SOLO → the lobby. Nothing on the lobby raises the offer
      // today; the row is here because "does not collide" has to be measured too.
      await page.evaluate(() => (window as never as { __onlineMenu: { back(): void } }).__onlineMenu.back());
      await beat(page, 600);
      await page.evaluate(() => (window as never as { __onlineMenu: { solo(): void } }).__onlineMenu.solo());
      await page.waitForFunction(
        () => typeof (window as never as { __lobby?: { rush(): void } }).__lobby?.rush === 'function',
        undefined,
        { timeout: 60_000 },
      );
      await beat(page, 1_200);
      await record(page, 'lobby');

      // RUSH! → a live offline match. Two rows: the match owning the screen, and
      // the pause menu, which is a0-97's known-good and the control for this run.
      await page.evaluate(() => (window as never as { __lobby: { rush(): void } }).__lobby.rush());
      await page.waitForFunction(
        () => (window as never as { __mainMenu?: { matchStarted: boolean } }).__mainMenu?.matchStarted === true,
        undefined,
        { timeout: 60_000 },
      );
      await page.waitForFunction(
        () => (window as never as { __pauseStage?: { read(): { simTicks: number } } }).__pauseStage!.read().simTicks > 5,
        undefined,
        { timeout: 60_000 },
      );
      await beat(page, 1_200);
      await record(page, 'match-live-offline', await pauseContext(page));

      await page.keyboard.press('Escape');
      await page.waitForFunction(
        () =>
          (window as never as { __pauseStage: { read(): { screen: string } } }).__pauseStage.read().screen === 'menu',
        undefined,
        { timeout: 30_000 },
      );
      await beat(page);
      await record(page, 'match-pause-menu', await pauseContext(page));
    }

    } finally {
      flush();
      for (const context of contexts) await context.close();
    }
  });
}

/** The front door's own state, for the record beside each row. */
async function entryContext(page: import('@playwright/test').Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const seam = (window as never as {
      __onlineMenu?: { visible: boolean; screen: string; status: string; error: string; joinMode: string; title: string };
    }).__onlineMenu;
    return seam
      ? {
          entryVisible: seam.visible,
          entryScreen: seam.screen,
          entryStatus: seam.status,
          entryError: seam.error,
          joinMode: seam.joinMode,
          title: seam.title,
        }
      : {};
  });
}

/** The match's own state, for the two match rows. */
async function pauseContext(page: import('@playwright/test').Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const seam = (window as never as {
      __pauseStage?: { read(): { screen: string; online: boolean; frozen: boolean } };
    }).__pauseStage;
    const corner = (window as never as {
      __cornerStage?: { session(): { state: string | null; closeReason: string | null } };
    }).__cornerStage;
    return {
      pauseScreen: seam?.read().screen ?? null,
      online: seam?.read().online ?? null,
      session: corner?.session() ?? null,
    };
  });
}

/** Wait for the front door to reach a status — and if it never does, say so in
 *  the row rather than losing the walk. A screen that refused to refuse is itself
 *  a finding about this bundle, not a reason to report nothing. */
async function waitForEntryStatus(page: import('@playwright/test').Page, status: string): Promise<void> {
  await page
    .waitForFunction(
      (want) => (window as never as { __onlineMenu?: { status: string } }).__onlineMenu?.status === want,
      status,
      { timeout: 45_000 },
    )
    .catch(() => {
      /* recorded by `entryContext` as whatever status it actually reached */
    });
}
