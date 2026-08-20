/**
 * evidence/a0-114-refusal-over-the-doors/refusal-over-the-doors.spec.ts —
 * OWNER: UI Engineer (a0-114).
 *
 * a0-111 pressed HOST on a 798x384 phone, the allocator refused, and the panel
 * that came up to offer RETRY and DOWNLOAD LOG drew its DOWNLOAD LOG button over
 * the word HOST. This capture reaches that frame the only honest way — by
 * pressing the door — and then asks three questions the a0-98 sweep did not:
 *
 *  1. **What is on the doors?** Not at their centres: on the whole of the rect the
 *     client itself reported for each. `probePoints` (a0-114's addition to
 *     `../a0-98-corner-collisions-everywhere-else/probe`) hit-tests nine points off
 *     each reported box. HOST's centre answers `CANVAS#app` and always did; its
 *     top edge does not.
 *  2. **Is the door still live under there?** Two real presses at two points on the
 *     SAME plate — one the panel covers and one it does not — and the client's own
 *     state after each. This is the question the fix turns on: a control that is
 *     inert while the refusal is up would need the refusal to stop LOOKING live,
 *     and a control that is still pressable needs the refusal to get off it.
 *  3. **And the failure line?** `messageBounds` is not a control, so no sweep of
 *     controls will ever look at it. On the desktop profile it is where the panel
 *     lands, and the words the player is being asked to report are the words the
 *     report button is covering.
 *
 * Nothing here asserts. The run IS the finding, taken twice — `A0_114_STAGE=before`
 * on today's code and `=after` on the fix. The assertions live in
 * `src/net/playtest-log-button.test.ts`, the file a0-114's brief names.
 */
import { test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROFILES } from '../a0-96-settings-screen/profiles';
import {
  harvestOverlays,
  probePoints,
  sweepState,
  topmostAt,
  type Box,
  type StateReport,
} from '../a0-98-corner-collisions-everywhere-else/probe';

const HERE = dirname(fileURLToPath(import.meta.url));
const STAGE = process.env.A0_114_STAGE ?? 'before';
const SHOTS = join(HERE, 'shots', STAGE);

/** The refusal panel's own ids (`src/net/connect-trace-view`). Spelled out rather
 *  than imported so a rename shows up here as a surface that stopped being found. */
const PANEL_ID = 'pr-connect-trace';
const PANEL_RETRY_ID = 'pr-connect-trace-retry';
const PANEL_DOWNLOAD_ID = 'pr-connect-trace-download';

/** Let the client settle. The entry screen is static between state changes, so
 *  this is a wait for the state machine rather than for an animation. */
async function beat(page: Page, ms = 900): Promise<void> {
  await page.waitForTimeout(ms);
  await page.mouse.move(1, 1);
  await page.waitForTimeout(150);
}

/** The doors seam, as the client reports it this frame. */
interface DoorSeam {
  readonly kind: string;
  readonly physicalCenter: { x: number; y: number };
  readonly physicalBounds: Box;
}

async function doors(page: Page): Promise<DoorSeam[]> {
  return page.evaluate(
    () =>
      (window as never as { __onlineMenu: { doorControls: DoorSeam[] } }).__onlineMenu.doorControls.map((c) => ({
        kind: c.kind,
        physicalCenter: { ...c.physicalCenter },
        physicalBounds: { ...c.physicalBounds },
      })) as never,
  ) as Promise<DoorSeam[]>;
}

async function entryContext(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const seam = (window as never as {
      __onlineMenu: {
        visible: boolean;
        screen: string;
        status: string;
        error: string;
        title: string;
        messageBounds: { x: number; y: number; width: number; height: number };
      };
    }).__onlineMenu;
    return {
      entryVisible: seam.visible,
      entryScreen: seam.screen,
      entryStatus: seam.status,
      entryError: seam.error,
      title: seam.title,
      messageBounds: { ...seam.messageBounds },
    };
  });
}

/** Where the refusal panel and its two buttons actually stand, this frame. */
async function panel(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(
    ({ root, retry, download }) => {
      const rect = (id: string): Box | null => {
        const el = document.getElementById(id);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
      };
      const el = document.getElementById(root);
      return {
        mounted: !!el,
        hidden: el ? el.hidden : null,
        box: rect(root),
        retry: rect(retry),
        download: rect(download),
        hint: document.querySelector(`#${root} .pr-ct-hint`)?.textContent ?? '',
      };
    },
    { root: PANEL_ID, retry: PANEL_RETRY_ID, download: PANEL_DOWNLOAD_ID },
  ) as Promise<Record<string, unknown>>;
}

/** One real press at one page point, and everything the client did about it. */
async function pressAt(
  page: Page,
  touch: boolean,
  x: number,
  y: number,
): Promise<Record<string, unknown>> {
  const before = await page.evaluate(
    () => (window as never as { __onlineMenu: { status: string } }).__onlineMenu.status,
  );
  const topmost = await topmostAt(page, x, y);
  let downloaded: string | null = null;
  const onDownload = (d: { suggestedFilename(): string }): void => {
    downloaded = d.suggestedFilename();
  };
  page.on('download', onDownload as never);
  // `status` alone cannot answer this. A refused door goes `error` -> `connecting`
  // -> `error`, and with no allocator configured `startResolve` runs that whole
  // round trip SYNCHRONOUSLY — `base === null` fails on the next line — so no
  // sampler will ever catch the middle of it. What a press changes that OUTLASTS
  // it is the answer line: the CAMPAIGN teaser writes `Coming Soon…` into
  // `notice` (u9-01) and it stays there. So the whole readable state goes on the
  // record before and after, and each caller says which field its door moves.
  const state = (): Promise<Record<string, unknown>> =>
    page.evaluate(() => {
      const seam = (window as never as {
        __onlineMenu: { screen: string; status: string; error: string; notice: string; title: string };
        __lobby?: { visible?: boolean };
      });
      const m = seam.__onlineMenu;
      return {
        screen: m.screen,
        status: m.status,
        error: m.error,
        notice: m.notice,
        title: m.title,
        lobby: seam.__lobby?.visible === true,
      };
    });
  const stateBefore = await state();
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await beat(page, 1_500);
  const stateAfter = await state();
  const after = String(stateAfter.status);
  page.off('download', onDownload as never);
  const changed = Object.keys(stateAfter).filter((k) => stateAfter[k] !== stateBefore[k]);
  return {
    point: { x: Math.round(x), y: Math.round(y) },
    topmost,
    statusBefore: before,
    statusAfter: after,
    stateBefore,
    stateAfter,
    /** Which readable fields the press moved. Empty means the client did nothing. */
    changed,
    downloaded,
  };
}

for (const profile of PROFILES) {
  test(`a0-114 the refusal, over the doors — ${profile.id} (${STAGE})`, async ({ browser }) => {
    test.setTimeout(600_000);
    mkdirSync(SHOTS, { recursive: true });
    const findings: Record<string, unknown>[] = [];
    const reports: StateReport[] = [];
    const out = join(SHOTS, `${profile.id}-report.json`);
    const flush = (): void =>
      void writeFileSync(
        out,
        `${JSON.stringify({ stage: STAGE, profile: profile.id, findings, reports }, null, 2)}\n`,
      );

    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: profile.touch,
      hasTouch: profile.touch,
      acceptDownloads: true,
    });
    const page = await context.newPage();

    try {
      await page.goto('/?gate=0');
      await page.waitForSelector('canvas', { state: 'attached', timeout: 60_000 });
      await page.waitForFunction(
        () => !!(window as never as { __mainMenu?: { visible: boolean } }).__mainMenu?.visible,
        undefined,
        { timeout: 60_000 },
      );
      await beat(page);

      // PLAY -> the doors, through the front door, by pressing it.
      await page.evaluate(() => (window as never as { __mainMenu: { play(): void } }).__mainMenu.play());
      await page.waitForFunction(
        () => (window as never as { __onlineMenu?: { visible: boolean } }).__onlineMenu?.visible === true,
        undefined,
        { timeout: 60_000 },
      );
      await beat(page);
      await page.screenshot({ path: join(SHOTS, `${profile.id}-1-doors-idle.png`) });
      const idle = await doors(page);
      findings.push({ what: 'doors at rest', doors: idle, panel: await panel(page), ...(await entryContext(page)) });
      flush();

      // --- HOST, pressed for real at the point the client reports -----------
      // Not `__onlineMenu.create()`: a0-111 pressed the plate, and the whole
      // question is what a press at a plate's own coordinates reaches.
      const host = idle.find((d) => d.kind === 'create');
      if (!host) throw new Error('the doors seam reported no HOST plate');
      const hostPress = await pressAt(page, profile.touch, host.physicalCenter.x, host.physicalCenter.y);
      await page.waitForFunction(
        () => (window as never as { __onlineMenu: { status: string } }).__onlineMenu.status === 'error',
        undefined,
        { timeout: 60_000 },
      );
      await beat(page, 1_500);
      findings.push({ what: 'HOST pressed at its own reported centre', press: hostPress });
      flush();

      // =====================================================================
      // THE FRAME a0-111 SENT
      // =====================================================================
      await page.screenshot({ path: join(SHOTS, `${profile.id}-2-host-refused.png`) });
      const refused = await doors(page);
      const ctx = await entryContext(page);
      const surfaces = await panel(page);
      const overlays = await harvestOverlays(page);

      // Every door, on the WHOLE of its own reported rect. This is the probe a0-98
      // did not have: nine points per box instead of one, and a cover is anything
      // that is not the canvas rather than one affordance matched by id.
      const doorVerdicts = await probePoints(
        page,
        refused.map((d) => ({ control: `door<${d.kind}>`, box: d.physicalBounds, ownerId: null })),
      );
      // …and the failure LINE, which is not a control and which no sweep of
      // controls will ever look at.
      const messageVerdicts = await probePoints(page, [
        { control: 'message', box: ctx.messageBounds as Box, ownerId: null },
      ]);

      findings.push({
        what: 'the refusal, as drawn',
        ...ctx,
        panel: surfaces,
        overlays,
        doors: refused,
        doorVerdicts,
        messageVerdicts,
        coveredDoors: Object.entries(doorVerdicts)
          .filter(([, rows]) => rows.some((v) => v.foreign))
          .map(([control, rows]) => ({
            control,
            at: rows.filter((v) => v.foreign).map((v) => `${v.at} -> ${v.topmost}`),
          })),
      });
      flush();

      // The same state through a0-98's own unchanged sweep, so the two tables sit
      // side by side and the difference is the instrument and not the screen.
      reports.push(await sweepState(page, 'doors-host-refused', profile, ctx));
      flush();

      // =====================================================================
      // ARE THE DOORS LIVE UNDER IT? Two presses on ONE plate.
      // =====================================================================
      // The brief's fork. If the doors are pressable behind the refusal then the
      // refusal has to get off them; if they are inert then it must not leave them
      // looking live. Only a press answers that.
      //
      // CAMPAIGN is the plate the pair is taken on, and not because it is
      // convenient: it is one of the two the panel lands on, and it is the only
      // door on this screen whose answer OUTLIVES the press — `Coming Soon…` in
      // `notice` (u9-01). HOST and JOIN both end back on the same refusal they
      // started on, so a press on either is invisible in the client's own state
      // however it is sampled. The covered press is taken FIRST, so `notice` is
      // still empty when it lands and a change would be unambiguous.
      const verdicts = doorVerdicts['door<campaign>'] ?? [];
      const covered = verdicts.find((v) => v.foreign);
      const clear = verdicts.find((v) => !v.foreign && v.topmost !== 'off-viewport');
      if (covered) {
        findings.push({
          what: 'CAMPAIGN pressed where the refusal IS',
          at: covered.at,
          press: await pressAt(page, profile.touch, covered.x, covered.y),
        });
      } else {
        findings.push({
          what: 'CAMPAIGN pressed where the refusal IS',
          press: null,
          note: 'nothing foreign stands on the CAMPAIGN plate in this stage — there is no covered point to press',
        });
      }
      flush();
      if (clear) {
        findings.push({
          what: 'CAMPAIGN pressed where the refusal is NOT',
          at: clear.at,
          press: await pressAt(page, profile.touch, clear.x, clear.y),
        });
      }
      flush();
      await page.screenshot({ path: join(SHOTS, `${profile.id}-3-after-presses.png`) });

      // …and a0-111's own door, for the file a thumb aimed at HOST comes back with.
      const hostVerdicts = doorVerdicts['door<create>'] ?? [];
      const hostCovered = hostVerdicts.find((v) => v.foreign);
      findings.push({
        what: 'HOST pressed where the refusal IS',
        at: hostCovered?.at ?? null,
        press: hostCovered ? await pressAt(page, profile.touch, hostCovered.x, hostCovered.y) : null,
        note: hostCovered ? undefined : 'nothing foreign stands on the HOST plate in this stage',
      });
      flush();
    } catch (err) {
      findings.push({ what: 'unreached', error: String(err) });
      flush();
      throw err;
    } finally {
      flush();
      await context.close();
    }
  });
}
