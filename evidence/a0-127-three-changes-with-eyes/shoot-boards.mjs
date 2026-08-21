/**
 * evidence/a0-127-three-changes-with-eyes/shoot-boards.mjs — the real board, next
 * to its card. OWNER: QA Manager (a0-127).
 *
 * a0-124's claim is that a preview is generated from the same source the match
 * builds from, so a difference between a card and the board it advertises is a
 * defect. Testing that with eyes needs a picture of the WHOLE arena, and the game
 * never shows one: the follow camera holds the ship at the middle of a phone- or
 * desktop-sized window, and the minimap draws only what the player has sensed.
 *
 * So the specimen is the production bundle in a window big enough to hold the
 * arena — 3300×2100 for the two WIDE maps (3200×2000) and 2500×2500 for the
 * SQUARE ones (2400×2400), at dpr 1 — with the ship flown to the arena's centre
 * with REAL taps so the board is centred in it. That is an unusual window and it
 * is stated in the attestation; it is not an unusual BUILD. Everything in frame is
 * the shipped renderer drawing the shipped world.
 *
 * The arena is chosen the way a player chooses it: `planet-rush:mapId` is the key
 * MAP SELECT writes (`src/ui/map-picker.ts` MAP_STORAGE_KEY), set before boot, and
 * the debug boot reads it through `readMapId` — the same read a lobby boot makes.
 *
 * One thing the frames cannot settle, and it is stated rather than smoothed over:
 * the card is built at `MAP_PREVIEW_SEED` 0 and the offline match at `MATCH_SEED`
 * 1, and the seed advances on every rematch. Station berths are pure geometry and
 * ignore the seed; the ORE field is stamped at world build from the seed. So the
 * question the frames can answer is whether the card shows the board's berths and
 * the shape of its field, not whether it shows tonight's individual rocks.
 */
import { chromium } from 'playwright';
import { BASE, elements, frame, note, park, settle, stamp } from './lib.mjs';

const ARENAS = [
  { id: 'line', name: 'The Line', bounds: { width: 3200, height: 2000 }, viewport: { width: 3300, height: 2100 } },
  { id: 'octagon', name: 'The Ring', bounds: { width: 2400, height: 2400 }, viewport: { width: 2500, height: 2500 } },
];

const browser = await chromium.launch();
const readback = [];

for (const arena of ARENAS) {
  const page = await browser.newPage({ viewport: arena.viewport, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.addInitScript((id) => localStorage.setItem('planet-rush:mapId', id), arena.id);
  await page.goto(`${BASE}/?debug=1`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 60_000 });
  await page.waitForFunction(() => typeof window.__oreHudStage?.mine === 'function', undefined, { timeout: 60_000 });
  await page.evaluate(() => document.fonts?.ready);
  await settle(page, 12);

  const centre = { x: arena.bounds.width / 2, y: arena.bounds.height / 2 };
  const spawn = await page.evaluate(() => window.__pauseStage.read().ship);
  for (let i = 0; i < 20; i++) {
    const ship = await page.evaluate(() => window.__pauseStage.read().ship);
    if (Math.hypot(ship.x - centre.x, ship.y - centre.y) < 40) break;
    const world = await page.evaluate(() => window.__viewStage.world());
    const vp = await page.evaluate(() => window.__viewStage.viewport());
    const sx = ((centre.x - world.left) / world.width) * vp.width;
    const sy = ((centre.y - world.top) / world.height) * vp.height;
    await page.mouse.click(Math.max(6, Math.min(vp.width - 6, sx)), Math.max(6, Math.min(vp.height - 6, sy)));
    await settle(page, 30);
  }
  await park(page);

  const name = `board-${arena.id}`;
  await frame(page, name);
  const ship = await page.evaluate(() => window.__pauseStage.read().ship);
  const world = await page.evaluate(() => window.__viewStage.world());
  const row = {
    arena: arena.id,
    arenaName: arena.name,
    bounds: arena.bounds,
    viewport: arena.viewport,
    dpr: 1,
    spawn,
    ship,
    visibleWorld: world,
    wholeArenaInFrame:
      world.left <= 0 && world.top <= 0 && world.right >= arena.bounds.width && world.bottom >= arena.bounds.height,
    matchClock: await page.evaluate(() => window.__pauseStage.read().simTicks ?? null),
    stamp: await stamp(page),
    ids: (await elements(page)).map((e) => e.id),
  };
  readback.push(row);
  console.log(`${name}: ship ${ship.x.toFixed(0)},${ship.y.toFixed(0)} whole arena in frame: ${row.wholeArenaInFrame}`);
  await page.close();
}

note('boards-readback', readback);
await browser.close();
