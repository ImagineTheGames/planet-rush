/**
 * evidence/capture-a0-04-nameplates.mjs — a0-04 "ship names are always lit".
 * OWNER: UI Engineer.
 *
 * The developer, on a live build: *"sometimes other ships names are dim and
 * sometimes they are lit, they should always be lit...."* The label used to drop
 * to NAMEPLATE_FADE_ALPHA (0.4) while its entity was damaged or firing; a0-04
 * retires that. These frames are the proof it landed on screen, and that what the
 * fade was protecting — the health bar owning the eye in a brawl — survived it.
 *
 * Three scenes, all off the REAL preview bundle (verified per run against
 * /version.json, which carries the sha of the build actually being served):
 *
 *   PAIR (frozen). `?freeze=1` pins the sim so the staged frame holds still.
 *     `__healthbarStage.damageEnemy(f)` parks the same enemy ship at the same spot
 *     beside the centred local ship twice: once at FULL hull (calm, no bar) and
 *     once at 35% (shot, bar up). Same ship, same pixels, one variable — so
 *     `a0-04-nameplate-pair.png` puts the two names side by side and the eye can
 *     do the comparison the developer was making. The drawn alpha of every label
 *     in both frames is read back off the real Text objects
 *     (`__nameplateStage.plates()`) and printed, so the claim is a number too.
 *
 *   BRAWL (live). A real `?debug=1` match, no freeze: poll until several bot ships
 *     are on screen at once, pull one more in with `stageBot()`, then shoot them
 *     through the ratified debug write seam (`__planetRush.damageShip`, which
 *     queues and lands on a tick boundary) so bars are up across the crowd.
 *     `a0-04-nameplate-brawl.png` is the "are the bars still readable underneath"
 *     frame — the assertion the brief would not take on faith.
 *
 * Usage:  node evidence/capture-a0-04-nameplates.mjs
 *         EVIDENCE_BASE_URL=http://localhost:4198 node evidence/...   (own preview)
 */
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';
const VP = { width: 1280, height: 800 };
const DSF = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const readPlates = (page) =>
  page.evaluate(() =>
    window.__nameplateStage.plates().map((p) => ({
      owner: p.owner,
      kind: p.kind,
      text: p.text,
      alpha: p.alpha,
      x: Math.round(p.x),
      y: Math.round(p.y),
    })),
  );
const readBars = (page) =>
  page.evaluate(() =>
    window.__healthbarStage.bars().map((b) => ({
      owner: b.owner,
      fraction: +b.fraction.toFixed(2),
      x: Math.round(b.x),
      y: Math.round(b.y),
    })),
  );

async function boot(browser, query) {
  const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: DSF });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page._errors = errors;
  await page.goto(`${BASE}/?${query}`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () =>
      typeof window.__nameplateStage?.plates === 'function' &&
      typeof window.__healthbarStage?.damageEnemy === 'function',
    undefined,
    { timeout: 30_000 },
  );
  return page;
}

/** Stitch two equal-sized crops into one side-by-side PNG with a dark gutter. */
function stitch(leftPath, rightPath, outPath, gutter = 16) {
  const a = PNG.sync.read(readFileSync(leftPath));
  const b = PNG.sync.read(readFileSync(rightPath));
  const height = Math.max(a.height, b.height);
  const out = new PNG({ width: a.width + gutter + b.width, height });
  // Gutter in the HUD's own near-black, so the two frames read as two panels.
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = 10; out.data[i + 1] = 12; out.data[i + 2] = 16; out.data[i + 3] = 255;
  }
  PNG.bitblt(a, out, 0, 0, a.width, a.height, 0, 0);
  PNG.bitblt(b, out, 0, 0, b.width, b.height, a.width + gutter, 0);
  writeFileSync(outPath, PNG.sync.write(out));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const version = await fetch(`${BASE}/version.json`).then((r) => r.json());
  console.log(`build under glass: ${version.sha} (${version.time})`);

  const browser = await chromium.launch();

  // ── PAIR: the same ship, calm and shot, at the same brightness ────────────
  const frozen = await boot(browser, 'debug=1&freeze=1');

  // `damageEnemy` sets the hull AND parks the ship; `stageBot` parks the SAME bot
  // at its own spot without touching the hull. Calling them in this order leaves
  // the ship at one fixed position in both frames with only the hull differing —
  // which is what makes the two crops comparable pixel for pixel.
  const calmStage = await frozen.evaluate(() => {
    const staged = window.__healthbarStage.damageEnemy(1); // full hull: calm, no bar
    window.__nameplateStage.stageBot(); // …parked clear of the home station's art
    return staged;
  });
  if (!calmStage) throw new Error('no enemy available to stage');
  await sleep(700);
  const calmPlates = await readPlates(frozen);
  const calmBars = await readBars(frozen);
  await frozen.screenshot({ path: join(OUT, 'a0-04-nameplate-calm.png') });
  console.log('CALM  plates:', JSON.stringify(calmPlates));
  console.log('CALM  bars  :', JSON.stringify(calmBars));

  // The crop that will become the left panel — centred on the staged ship's label.
  const target = calmPlates.find((p) => p.owner === calmStage.owner && p.kind === 'ship');
  if (!target) throw new Error('the staged enemy drew no label');
  const clip = {
    x: Math.max(0, target.x - 130),
    y: Math.max(0, target.y - 12),
    width: 260,
    height: 96,
  };
  await frozen.screenshot({ path: join(OUT, 'a0-04-crop-calm.png'), clip });

  // Same ship, same position, 35% hull — a bar is up and it is being shot.
  const shotStage = await frozen.evaluate(() => {
    const staged = window.__healthbarStage.damageEnemy(0.35);
    window.__nameplateStage.stageBot(); // back to the calm frame's exact spot
    return staged;
  });
  await sleep(700);
  const shotPlates = await readPlates(frozen);
  const shotBars = await readBars(frozen);
  await frozen.screenshot({ path: join(OUT, 'a0-04-nameplate-shot.png') });
  await frozen.screenshot({ path: join(OUT, 'a0-04-crop-shot.png'), clip });
  console.log('SHOT  staged:', JSON.stringify(shotStage));
  console.log('SHOT  plates:', JSON.stringify(shotPlates));
  console.log('SHOT  bars  :', JSON.stringify(shotBars));

  stitch(
    join(OUT, 'a0-04-crop-calm.png'),
    join(OUT, 'a0-04-crop-shot.png'),
    join(OUT, 'a0-04-nameplate-pair.png'),
  );
  console.log('pair errors:', JSON.stringify(frozen._errors));

  // ── BRAWL: bars still readable under lit names ────────────────────────────
  const live = await boot(browser, 'debug=1');
  // Past the 10 s spawn protection (GDD §2.2) — damage filed before it lifts is
  // absorbed, and a "brawl" of untouched hulls proves nothing.
  await live.waitForFunction(() => window.__planetRush.ticks > 700, undefined, { timeout: 120_000 });

  let best = null;
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    // Top every bot up with damage through the ratified write seam (queued, applied
    // on a tick boundary), so bars are up across whoever is on screen this frame.
    await live.evaluate(() => {
      for (let owner = 1; owner < 8; owner++) window.__planetRush.damageShip(owner, 16);
    });
    // …and pull one hull in tight beside the centred local ship, so the crowd is
    // a crowd rather than three specks.
    await live.evaluate(() => window.__nameplateStage.stageBot());
    await sleep(450);

    const plates = await readPlates(live);
    const bars = await readBars(live);
    const ships = plates.filter((p) => p.kind === 'ship' && p.owner !== 0);
    const barred = ships.filter((s) => bars.some((b) => b.owner === s.owner && b.fraction < 0.95));
    const score = ships.length + barred.length;
    if (!best || score > best.score) {
      // Nothing here is frozen — the sim is live — so the pictured frame sits
      // BETWEEN two readbacks rather than matching either exactly: `plates` above
      // was read just before the shutter, `after` just after it. A hull that
      // crossed the edge of the viewport in between shows up as a label in one
      // list and not the other, which is why both are printed.
      await live.screenshot({ path: join(OUT, 'a0-04-nameplate-brawl.png') });
      // …and a close-up of the thick of it, around the centred local ship, where
      // stageBot parked a bot: this is the "are the bars still readable" crop.
      await live.screenshot({
        path: join(OUT, 'a0-04-nameplate-brawl-crop.png'),
        clip: { x: 360, y: 130, width: 560, height: 420 },
      });
      best = {
        score,
        before: plates,
        beforeBars: bars,
        plates: await readPlates(live),
        bars: await readBars(live),
        ships: ships.length,
        barred: barred.length,
      };
      console.log(`BRAWL candidate: ${ships.length} labelled ships, ${barred.length} wearing bars`);
    }
    if (ships.length >= 3 && barred.length >= 2) break;
  }
  const brawlPlates = [...best.before, ...best.plates];
  console.log('BRAWL plates (frame before the shutter):', JSON.stringify(best.before));
  console.log('BRAWL bars   (frame before the shutter):', JSON.stringify(best.beforeBars));
  console.log('BRAWL plates (frame after the shutter) :', JSON.stringify(best.plates));
  console.log('BRAWL bars   (frame after the shutter) :', JSON.stringify(best.bars));
  console.log('brawl errors:', JSON.stringify(live._errors));

  const alphas = [...calmPlates, ...shotPlates, ...brawlPlates].map((p) => p.alpha);
  console.log('every drawn alpha across all three scenes:', JSON.stringify([...new Set(alphas)]));

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
