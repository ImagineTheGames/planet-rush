/**
 * tests/live-stage/region-order.spec.ts — from the United States, Virginia must
 * sort above São Paulo. OWNER: Netcode Engineer (a0-29).
 *
 * The developer's report was not "the picker is broken" — the picker renders, it
 * labels both regions and it shows pings. It was **"the strings still showed GRU
 * at the end… we have 2 regions so something is off"**: the numbers feeding the
 * picker were wrong, and the wrong number picked the region. Their own phone in
 * Florida read
 *
 *   [GRU 218ms] · IAD 229ms
 *
 * — two regions 5,000 km apart, 11 ms apart on screen, so which one "won" was a
 * coin flip, and it landed on Brazil.
 *
 * A unit test cannot answer this. The defect only exists when real probes share a
 * real connection to a real edge, so the only test that can fail the way the
 * developer's client failed is one that boots the REAL bundle against the REAL
 * fleet and reads the real ranking back off `window.__onlineMenu`. That is this
 * spec, and its assertion is the developer's acceptance case verbatim.
 *
 * ---------------------------------------------------------------------------
 * IT IS ONLY HONEST FROM A MACHINE WHOSE NEAREST REGION IS KNOWN
 * ---------------------------------------------------------------------------
 * "Virginia beats São Paulo" is a fact about *where the client is*, not about the
 * code. Run from São Paulo it should fail, and failing there would be correct. So
 * the spec asks the fleet where this machine appears to be — `/health` with no
 * steer is answered by the region the anycast edge considers nearest — and skips
 * unless that region is the one the assertion is written for. It never guesses,
 * and it never asserts geography it did not establish.
 *
 * Gated on `PR_LIVE_REGIONS=1` (its config sets it) because it needs the public
 * internet and a deployed fleet, neither of which the unit suite may assume.
 *
 *   npx playwright test --config tests/live-stage/playwright.region-order.config.ts
 */
import { expect, test, type Page } from '@playwright/test';

/** The fleet this spec measures, and the region it expects to win from here. */
const GAMESERVER = 'https://planet-rush-gameserver.fly.dev';
const NEAREST = 'iad';
const FARTHEST = 'gru';

/**
 * The gap geography demands. Virginia is ~1,300 km from Florida and São Paulo is
 * ~6,500 km, so the honest difference is 60–100 ms. The bug's signature was not
 * merely the wrong order — it was the two numbers *collapsing together*, which is
 * what made the order a coin flip. Ordering alone would pass half the time on the
 * broken build, so the gap is asserted too.
 */
const MIN_GAP_MS = 50;

/** One region as `__onlineMenu` publishes it. */
interface RegionInfo {
  id: string;
  label: string;
  pingMs: number | null;
}

interface OnlineSeam {
  visible: boolean;
  regionPickerVisible: boolean;
  regions: readonly RegionInfo[];
  regionSelected: string | null;
  regionLine: string;
  notice: string;
}

interface MainMenuSeam {
  online(): void;
}

declare const window: Window & { __mainMenu?: MainMenuSeam; __onlineMenu?: OnlineSeam };

test.skip(process.env['PR_LIVE_REGIONS'] !== '1', 'needs the deployed fleet — run its own config');

/** Where the edge thinks this machine is: `/health` with no steer is served by
 *  the region the anycast POP picked, which is the nearest one by definition. */
async function edgeNearestRegion(): Promise<string | null> {
  try {
    const response = await fetch(`${GAMESERVER}/health`);
    if (!response.ok) return null;
    const body = (await response.json()) as { region?: unknown };
    return typeof body.region === 'string' ? body.region : null;
  } catch {
    return null;
  }
}

/** Boot a clean client, open the doors, and wait for the survey to land. */
async function openDoorsAndSurvey(page: Page): Promise<void> {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__mainMenu?.online === 'function', undefined, {
    timeout: 20_000,
  });
  await page.evaluate(() => window.__mainMenu!.online());
  await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 10_000 });
  // The survey is fired when the doors open and lands when the fleet answers.
  await page.waitForFunction(
    () => (window.__onlineMenu?.regions.length ?? 0) > 0 &&
      window.__onlineMenu!.regions.every((r) => r.pingMs !== null),
    undefined,
    { timeout: 30_000 },
  );
  expect(pageErrors, 'no page errors opening the doors on a live fleet').toEqual([]);
}

test('from the US, the region picker ranks Virginia above São Paulo', async ({ page }) => {
  const nearest = await edgeNearestRegion();
  test.skip(nearest === null, 'the live fleet did not answer — nothing to measure');
  test.skip(
    nearest !== NEAREST,
    `this machine's nearest region is ${nearest}, not ${NEAREST} — the assertion is written for a US client`,
  );

  await openDoorsAndSurvey(page);

  const read = await page.evaluate(() => ({
    regionPickerVisible: window.__onlineMenu!.regionPickerVisible,
    regions: window.__onlineMenu!.regions,
    regionSelected: window.__onlineMenu!.regionSelected,
    regionLine: window.__onlineMenu!.regionLine,
    notice: window.__onlineMenu!.notice,
  }));
  // eslint-disable-next-line no-console -- the readback IS the evidence this spec exists to produce
  console.log(`\n  __onlineMenu readback\n  ${JSON.stringify(read, null, 2).replace(/\n/g, '\n  ')}\n`);

  // The picker itself was never the defect and must stay exactly as it was.
  expect(read.regionPickerVisible, 'two regions still draw a picker').toBe(true);
  expect(read.regions.length, 'the fleet still advertises both regions').toBeGreaterThanOrEqual(2);

  const ids = read.regions.map((r) => r.id);
  expect(ids, 'both fleet regions are listed').toContain(NEAREST);
  expect(ids, 'both fleet regions are listed').toContain(FARTHEST);

  // The developer's acceptance case: the near region sorts first and is selected.
  expect(ids[0], `${NEAREST} sorts above ${FARTHEST} from the United States`).toBe(NEAREST);
  expect(read.regionSelected, 'and it is the one a CREATE will ask for').toBe(NEAREST);

  // …by a gap geography can explain, not by a coin flip.
  const near = read.regions.find((r) => r.id === NEAREST)!;
  const far = read.regions.find((r) => r.id === FARTHEST)!;
  expect(near.pingMs, 'the near region was measured').not.toBeNull();
  expect(far.pingMs, 'the far region was measured').not.toBeNull();
  expect(
    far.pingMs! - near.pingMs!,
    `${FARTHEST} is ~5,000 km further away than ${NEAREST}; a gap under ${MIN_GAP_MS}ms means the ` +
      'probe is measuring something other than the network path',
  ).toBeGreaterThan(MIN_GAP_MS);

  // The line the doors actually print, with the selection bracketed.
  expect(read.regionLine).toMatch(new RegExp(`^\\[${NEAREST.toUpperCase()} \\d+ms\\]`, 'i'));

  await page.screenshot({ path: 'tests/live-stage/region-order-doors-evidence.png' });
});
