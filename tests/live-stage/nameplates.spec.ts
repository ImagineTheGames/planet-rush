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
  /** The labels the real layer drew last frame — owner, kind, text, suffix, colour,
   *  the opacity it drew at (a0-04), and pos. */
  plates(): Array<{ owner: number; kind: 'ship' | 'station'; text: string; suffix: string; color: number; alpha: number; x: number; y: number; local: boolean }>;
  /** The per-slot name table the match built (data-driven source of the labels). */
  names(): Array<string | undefined>;
  /** The per-slot difficulty table (mirror of `names`), source of the suffixes. */
  difficulties(): Array<string | undefined>;
}
/** The health-bar live-stage seam, borrowed here to put a ship in a REAL fight —
 *  `damageEnemy` parks a live enemy beside the centred local ship and drops its
 *  hull, so the bar layer must draw a bar over it. That is the state the label
 *  used to fade under (a0-04). */
interface HealthbarStage {
  damageEnemy(fraction: number): { owner: number; fraction: number } | null;
  bars(): Array<{ owner: number; fraction: number; x: number; y: number; local: boolean }>;
}
interface StageWindow {
  __nameplateStage?: NameplateStage;
  __healthbarStage?: HealthbarStage;
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

test('a ship being shot wears its name as brightly as a calm one (a0-04)', async ({ page }) => {
  // The developer, on a live build: *"sometimes other ships names are dim and
  // sometimes they are lit, they should always be lit."* The unit tests pin the
  // model; this pins the pixels' own number — the alpha the REAL layer applied to
  // a Text object on a real boot, over a ship the health-bar layer is drawing a
  // bar for.
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto('/?debug=1&freeze=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => typeof window.__nameplateStage?.stageBot === 'function' &&
      typeof window.__healthbarStage?.damageEnemy === 'function',
    undefined,
    { timeout: 20_000 },
  );

  // Put an enemy in a fight: parked beside the centred local ship at 35% hull, so
  // a bar MUST be up over it (damaged ⇒ a bar) — the exact clutter the retired
  // fade keyed off.
  const shot = await page.evaluate(() => window.__healthbarStage!.damageEnemy(0.35));
  expect(shot, 'an enemy was available to stage').not.toBeNull();

  // Wait for a frame where the bar layer has drawn that ship's bar AND the label
  // layer has drawn its name, plus at least one label over an undamaged entity to
  // compare against (the calm side of the pair).
  const frame = await page
    .waitForFunction(
      (owner) => {
        const plates = window.__nameplateStage!.plates();
        const bars = window.__healthbarStage!.bars();
        const shotPlate = plates.find((p) => p.owner === owner && p.kind === 'ship');
        const shotBar = bars.find((b) => b.owner === owner && b.fraction < 1);
        const calm = plates.filter((p) => !bars.some((b) => b.owner === p.owner));
        return shotPlate && shotBar && calm.length > 0 ? { plates, bars } : null;
      },
      shot!.owner,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());

  const plates = frame!.plates;
  const bars = frame!.bars;
  const shotPlate = plates.find((p) => p.owner === shot!.owner && p.kind === 'ship')!;
  const calmPlates = plates.filter((p) => !bars.some((b) => b.owner === p.owner));

  // One number across the frame: the shot ship's name, and every calm entity's.
  for (const calm of calmPlates) {
    expect(
      shotPlate.alpha,
      `the shot ship's name (${shotPlate.text}) is as bright as the calm ${calm.kind} label (${calm.text})`,
    ).toBeCloseTo(calm.alpha, 5);
  }
  expect(new Set(plates.map((p) => p.alpha)).size, 'every drawn label shares one opacity').toBe(1);
  expect(shotPlate.alpha, 'and that opacity is the full one').toBeCloseTo(0.92, 5);

  // Rule 3's surviving half, on the real stage: the label is drawn ABOVE the bar
  // it shares a ship with, so full brightness still cannot cover the bar. Both
  // readbacks report a TOP edge in screen px (y grows downward), so the label's
  // top being the smaller number is the whole claim — measured off two independent
  // layers, not off one shared constant.
  const shotBar = bars.find((b) => b.owner === shot!.owner)!;
  expect(shotPlate.y, 'the lit label sits above the health bar it shares a ship with').toBeLessThan(
    shotBar.y,
  );

  expect(pageErrors, 'no page errors while lighting a shot ship’s name').toEqual([]);
});
