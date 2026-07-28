/**
 * tests/live-stage/nameplates.spec.ts — player-name labels, verified in the REAL
 * booted client. OWNER: UI Engineer (field request v0.2.1).
 *
 * The model tests (`src/ui/nameplates.test.ts`) prove *which* entities get a label
 * and *what* it says — but they cannot prove the label is WIRED: that on a real
 * boot the feed hands the layer every ship + owned station, projected to screen,
 * with the lobby's names, and the layer draws them. The health bars shipped dead
 * twice for exactly that gap, so — same discipline — this boots the production
 * bundle, stages a bot's ship and home station on-screen through the `?debug=1`
 * live-stage seam (`window.__nameplateStage`, installed in `main.ts`), and asserts
 * a real label display object tracks each, carrying the name the match's own slot
 * table resolved.
 *
 * `?freeze=1` pins the sim to a fixed seeded frame so the staged entities hold
 * still, which is what makes the assertion deterministic on a slow CI runner.
 */
import { test, expect } from '@playwright/test';

/** The shape of the `?debug=1`-only globals this spec drives (mirrors the seams
 *  installed in `src/main.ts`: `installNameplateStage`, and the layout hook). */
interface NameplateStage {
  /** Park the first bot's ship + home station on-screen beside the local ship;
   *  returns the bot's slot, the name the table resolved, and its difficulty tier,
   *  or null. */
  stageBot(): { owner: number; name: string; difficulty: string | undefined } | null;
  /** The labels the real layer drew last frame — owner, kind, text, suffix, colour, pos. */
  plates(): Array<{ owner: number; kind: 'ship' | 'station'; text: string; suffix: string; color: number; x: number; y: number; local: boolean }>;
  /** The per-slot name table the match built (data-driven source of the labels). */
  names(): Array<string | undefined>;
  /** The per-slot difficulty table (mirror of `names`), source of the suffixes. */
  difficulties(): Array<string | undefined>;
}
interface StageWindow {
  __nameplateStage?: NameplateStage;
  __planetRush?: {
    viewport: { width: number; height: number };
    placement(): Array<{ id: string; ok: boolean }>;
  };
}
declare const window: Window & StageWindow;

test('name labels render over a bot ship and its station in the real booted client', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto('/?debug=1&freeze=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });

  // The staging seam installs during boot; wait for it before driving it.
  await page.waitForFunction(
    () => typeof window.__nameplateStage?.stageBot === 'function',
    undefined,
    { timeout: 20_000 },
  );

  // The local ship's own label is off by default (field request rule 3) — at the
  // frozen spawn frame, no label should be flagged `local`.
  const before = await page.evaluate(() => window.__nameplateStage!.plates());
  expect(
    before.some((p) => p.local),
    'the local ship carries no own-name label by default',
  ).toBe(false);

  // Stage the first bot's ship + home station beside the centred local ship.
  const staged = await page.evaluate(() => window.__nameplateStage!.stageBot());
  expect(staged, 'a bot was available to stage').not.toBeNull();
  expect(staged!.name, 'the bot resolved to a real name').toBeTruthy();

  // Let the render loop draw a frame with the staged bot, then read back the labels
  // the REAL layer drew — this is the assertion the field request needed.
  const plates = await page
    .waitForFunction(
      (owner) => {
        const p = window.__nameplateStage!.plates();
        const hasShip = p.some((x) => x.owner === owner && x.kind === 'ship');
        const hasStation = p.some((x) => x.owner === owner && x.kind === 'station');
        return hasShip && hasStation ? p : null;
      },
      staged!.owner,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());

  const shipLabel = plates!.find((p) => p.owner === staged!.owner && p.kind === 'ship');
  const stationLabel = plates!.find((p) => p.owner === staged!.owner && p.kind === 'station');
  expect(shipLabel, 'a drawn label tracks the bot ship').toBeDefined();
  expect(stationLabel, 'a drawn label tracks the bot station').toBeDefined();

  // The text is the lobby/match name for that slot — data-driven, not invented.
  const names = await page.evaluate(() => window.__nameplateStage!.names());
  expect(shipLabel!.text, 'the ship label matches the slot name').toBe(staged!.name);
  expect(stationLabel!.text, 'the station label matches the slot name').toBe(staged!.name);
  expect(names[staged!.owner], 'the name table is the source of the label text').toBe(staged!.name);

  // The bot's difficulty rides along as a recessive suffix — `(EASY|MEDIUM|HARD)`
  // — on BOTH its ship and its station, sourced from the mirror difficulty table
  // (field request v0.2.2). Human seats never carry one (asserted below).
  const difficulties = await page.evaluate(() => window.__nameplateStage!.difficulties());
  const tier = (staged!.difficulty ?? '').toUpperCase();
  expect(tier, 'the staged bot resolved to a difficulty tier').toBeTruthy();
  const expectedSuffix = `(${tier})`;
  expect(shipLabel!.suffix, 'the ship label carries the bot difficulty suffix').toBe(expectedSuffix);
  expect(stationLabel!.suffix, 'the station label carries the bot difficulty suffix').toBe(expectedSuffix);
  expect(
    (difficulties[staged!.owner] ?? '').toUpperCase(),
    'the difficulty table is the source of the suffix',
  ).toBe(tier);

  // The local (human) player carries NO difficulty suffix on any drawn label.
  for (const p of plates!.filter((x) => x.owner === 0)) {
    expect(p.suffix, 'a human seat never shows a difficulty suffix').toBe('');
  }

  // Both are tinted the same owner identity colour (ship trim, bar and name agree).
  expect(stationLabel!.color, 'ship and station labels share the owner colour').toBe(shipLabel!.color);

  // They TRACK their entities: both were parked to the right of the centred local
  // ship, so both labels sit right of the viewport centre.
  const viewport = await page.evaluate(() => window.__planetRush!.viewport);
  expect(shipLabel!.x, 'the ship label is over the bot ship, right of the local ship').toBeGreaterThan(
    viewport.width / 2,
  );
  expect(stationLabel!.x, 'the station label is over the bot station, right of the local ship').toBeGreaterThan(
    viewport.width / 2,
  );

  // Registered at its declared anchor: the layout registry records the nameplate
  // layer inside its `full` zone (the "if it should appear somewhere, it appears
  // there" contract — the labels are at registered anchors).
  const placement = await page.evaluate(() => window.__planetRush!.placement());
  const entry = placement.find((e) => e.id === 'nameplates');
  expect(entry, 'the nameplate layer registered with the layout registry').toBeDefined();
  expect(entry!.ok, 'the nameplate layer sits inside its declared `full` anchor').toBe(true);

  expect(pageErrors, 'no page errors while staging the name labels').toEqual([]);
});
