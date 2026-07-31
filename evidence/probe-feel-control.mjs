/**
 * evidence/probe-feel-control.mjs — the CONTROL for `online-feel`. OWNER: QA Manager.
 *
 * WHY THIS EXISTS. Every capture round of `online-actions` produced a live log with
 * a 5–6 second window in it at a large, nearly-constant correction (219 u, 249 u,
 * 330 u, 505 u, 526 u — one value per window, held for the whole window). That is
 * the exact shape of the post-respawn divergence this gate failed on last round,
 * and reporting it again would have been the easy thing to do. Two facts say it is
 * NOT that, and both are in the transcripts:
 *
 *   1. THE ONE RUN THAT RECORDED A REAL DEATH DID NOT BREACH AT IT.
 *      images/online-actions-f1-guest-log.json carries `death@162656ms` and
 *      `eliminated@162656ms`. Its breach windows are at 87–92 s and 102–106 s. The
 *      seconds after the actual death are the calmest in the session: mean 0 u,
 *      worst 0 u, 146 s of it.
 *   2. THE WIRE INSTRUMENT, WITH NO BROWSER AT ALL, DOES NOT BREACH EITHER.
 *      evidence/respawn-tail.live.test.ts across three live runs on this build:
 *      two of them killed the ship outright (minHullSeen 0) and held it dead for
 *      262 and 280 consecutive reconciles — and recorded ZERO breaching
 *      reconciles. Last round the same instrument recorded 149 breaches at a
 *      constant 1346.691 u and never once observed its own ship dead.
 *
 * What the windows DO line up with is my own instrument: each one falls inside a
 * phase where the capture is taking screenshots in a tight loop — the homing
 * search (a full-page screenshot every ~150 ms), the station series, the hull
 * burst. A page stalled in `screenshot()` is a page that is not sending input, and
 * a client that stops sending input while authority keeps simulating diverges by
 * however far the ship travelled meanwhile — which is exactly a large constant
 * error for the length of the stall.
 *
 * So this run is the same live two-client match with THE CAMERA OFF: the front
 * door, RUSH!, and then straight flight for three minutes with not one screenshot
 * taken until the ships have stopped and the log is being exported. If the windows
 * are mine, they are absent here. If they are the game's, they are not.
 *
 *   node evidence/probe-feel-control.mjs [tag] [seconds]
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
mkdirSync(OUT, { recursive: true });
const BASE = process.env.EVIDENCE_BASE_URL ?? 'https://imaginethegames.github.io/planet-rush/';
const TAG = process.argv[2] ?? 'ctl1';
const FLY_S = Number(process.argv[3] ?? 180);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(browser, who) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, { timeout: 60_000 });
  const box = await page.locator('canvas').boundingBox();
  return { who, page, context, box, press: (p) => page.mouse.click(box.x + p.x, box.y + p.y) };
}
const menuPoint = (page, k) =>
  page.evaluate((kind) => {
    const c = (window.__mainMenu?.controls ?? []).find((x) => x.kind === kind);
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  }, k);
const doorPoint = (page, k) =>
  page.evaluate((kind) => {
    const c = (window.__onlineMenu?.doorControls ?? []).find((x) => x.kind === kind);
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  }, k);

async function reachLobby(c, walk, tries = 8) {
  for (let i = 1; i <= tries; i++) {
    await walk(c);
    try {
      await c.page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 22_000 });
      return i;
    } catch {
      await c.page.reload({ waitUntil: 'load', timeout: 60_000 });
      await c.page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, { timeout: 60_000 });
    }
  }
  throw new Error('never reached the lobby');
}

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const host = await boot(browser, 'host');
const guest = await boot(browser, 'guest');
const run = { probe: 'feel-control', tag: TAG, base: BASE, flySeconds: FLY_S, capturedAt: new Date().toISOString() };
try {
  await reachLobby(host, async (c) => {
    await c.press(await menuPoint(c.page, 'play'));
    await c.page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 30_000 });
    await c.press(await doorPoint(c.page, 'create'));
  });
  const room = await host.page.evaluate(() => window.__lobby.room);
  run.room = room;
  await reachLobby(guest, async (c) => {
    await c.press(await menuPoint(c.page, 'play'));
    await c.page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 30_000 });
    await c.press(await doorPoint(c.page, 'join'));
    await c.page.waitForFunction(() => window.__onlineMenu?.screen === 'join', undefined, { timeout: 20_000 });
    for (const ch of room) await c.press(await doorPoint(c.page, `key:${ch}`));
    await c.press(await doorPoint(c.page, 'submit'));
  });
  await host.page.waitForFunction(() => window.__lobby?.humanCount === 2, undefined, { timeout: 30_000 });
  await host.press(await host.page.evaluate(() => window.__lobby.rushControl.physicalCenter));
  for (const c of [host, guest]) {
    await c.page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 60_000 });
  }

  // ---- THE CAMERA IS OFF FROM HERE. -------------------------------------------
  // Straight flight, one direction change every 12 s, trigger cold. No screenshot,
  // no page.evaluate poll, nothing that can stall the render or the input loop.
  const KEYS = ['KeyD', 'KeyW', 'KeyA', 'KeyS'];
  const end = Date.now() + FLY_S * 1000;
  let i = 0;
  while (Date.now() < end) {
    const k = KEYS[i % KEYS.length];
    const k2 = KEYS[(i + 2) % KEYS.length];
    await Promise.all([host.page.keyboard.down(k), guest.page.keyboard.down(k2)]);
    await sleep(12_000);
    await Promise.all([host.page.keyboard.up(k), guest.page.keyboard.up(k2)]);
    await sleep(600);
    i++;
  }
  for (const c of [host, guest]) for (const k of KEYS) await c.page.keyboard.up(k).catch(() => {});
  await sleep(2_000);

  // ---- Camera back on, only now. ----------------------------------------------
  for (const c of [host, guest]) {
    await c.page.screenshot({ path: join(OUT, `feel-control-${TAG}-${c.who}-match.png`) });
    await c.page.keyboard.press('Escape');
    await sleep(900);
    const button = c.page.locator('#playtest-copy-log-button');
    await button.waitFor({ state: 'visible', timeout: 20_000 });
    await button.click();
    await sleep(1_200);
    await c.page.screenshot({ path: join(OUT, `feel-control-${TAG}-${c.who}-copylog.png`) });
    const text = await c.page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    if (!text) throw new Error(`${c.who}: COPY LOG produced nothing`);
    const log = JSON.parse(text);
    writeFileSync(join(OUT, `feel-control-${TAG}-${c.who}-log.json`), JSON.stringify(log, null, 2));
    run[`summary_${c.who}`] = log.summary;
    run[`dropped_${c.who}`] = log.dropped;
  }
  run.ok = true;
} finally {
  await host.context.close().catch(() => {});
  await guest.context.close().catch(() => {});
  await browser.close();
}
writeFileSync(join(OUT, `feel-control-${TAG}.json`), JSON.stringify(run, null, 2));
console.log(JSON.stringify(run, null, 2));
