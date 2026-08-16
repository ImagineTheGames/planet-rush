/**
 * evidence/a0-56-playtest-log/capture.mjs — a0-56 evidence: the log still holds
 * the match after the developer has left it. OWNER: Platform Engineer.
 *
 * Re-lives the exact session the developer reported on 2026-08-16 — *"because it
 * said i never left the main menu but i was in the pause menu in the middle of a
 * match"* — against the REAL preview bundle, and exports the log the way they do:
 * by pressing DOWNLOAD LOG on the pause menu.
 *
 *   1. Boot `?debug=1`, straight into an offline match, and play it: real thrust,
 *      real fire, real sim ticks.
 *   2. ESC → EXIT → LEAVE, clicked at the points the client itself drew them
 *      (`__pauseStage`), which is the path that navigates the page and used to
 *      take the log with it.
 *   3. On the menu: PLAY → PLAY SOLO → RUSH! into a second match.
 *   4. ESC → DOWNLOAD LOG, and the file Chromium actually wrote is opened off
 *      disk and parsed.
 *
 * It runs the scenario TWICE. The second pass makes `sessionStorage` throw on
 * access — which is precisely what the client did before this brief, since with no
 * store the log is memory-only — so the two files beside each other are the fix and
 * the defect, captured by one script on one build.
 *
 * Nothing here is stubbed except that storage denial: the match is the sim's own,
 * the clicks are real clicks, the navigation is the client's own `exitToMenu`, and
 * the JSON is the bytes the browser saved.
 *
 * Usage: node evidence/a0-56-playtest-log/capture.mjs   (needs preview on $EVIDENCE_BASE_URL)
 * Launch under the sandboxed-Chromium LD_LIBRARY_PATH where the lane needs it.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4196';
const VW = 1280;
const VH = 800;

/** Deny `sessionStorage` the way a private-mode WebView does — which reproduces
 *  the pre-a0-56 client exactly, since `browserPlaytestLogStore()` then returns
 *  null and the log is memory-only. */
const DENY_STORAGE = () => {
  Object.defineProperty(window, 'sessionStorage', {
    configurable: true,
    get() {
      throw new Error('SecurityError: storage is disabled in this context');
    },
  });
};

async function waitFor(page, fn, arg, timeout = 20_000) {
  await page.waitForFunction(fn, arg, { timeout });
}

/** Click a pause control at the physical point the client drew it. */
async function clickPause(page, kind) {
  const box = await page.locator('canvas').boundingBox();
  const p = await page.evaluate(
    (k) => {
      const c = window.__pauseStage.read().controls.find((x) => x.kind === k);
      return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
    },
    kind,
  );
  if (!p) throw new Error(`no pause control ${kind}`);
  await page.mouse.click(box.x + p.x, box.y + p.y);
}

/** Fly the ship for a bit, so the match is a match and not a still frame. */
async function play(page, ms) {
  const until = Date.now() + ms;
  const keys = ['KeyW', 'KeyA', 'KeyD', 'Space'];
  let i = 0;
  while (Date.now() < until) {
    const key = keys[i++ % keys.length];
    await page.keyboard.down(key);
    await page.waitForTimeout(160);
    await page.keyboard.up(key);
  }
}

/** One full session, ending in a real DOWNLOAD LOG press. Returns the parsed file. */
async function session(browser, { storage, tag }) {
  const context = await browser.newContext({
    viewport: { width: VW, height: VH },
    deviceScaleFactor: 1,
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  if (!storage) await page.addInitScript(DENY_STORAGE);

  // 1. Straight into a match, and play it.
  await page.goto(`${BASE}/?debug=1`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await waitFor(page, () => typeof window.__pauseStage?.read === 'function');
  await waitFor(page, () => window.__pauseStage.read().simTicks > 30);
  await play(page, 4_000);
  const ticksPlayed = await page.evaluate(() => window.__pauseStage.read().simTicks);

  // What the tab is holding at this point — the whole question of this brief.
  const stored = await page.evaluate(() => {
    try {
      return window.sessionStorage.getItem('planet-rush:playtest-log');
    } catch {
      return null;
    }
  });

  // 2. ESC → EXIT → LEAVE: the pause menu's own way back, which navigates.
  await page.keyboard.press('Escape');
  await waitFor(page, () => window.__pauseStage.read().screen === 'menu');
  await clickPause(page, 'exit');
  await waitFor(page, () => window.__pauseStage.read().screen === 'confirm');
  await clickPause(page, 'leave');

  // 3. On the menu: PLAY → PLAY SOLO → RUSH! into a second match.
  await waitFor(page, () => typeof window.__mainMenu?.play === 'function');
  await page.evaluate(() => window.__mainMenu.play());
  await waitFor(page, () => typeof window.__onlineMenu?.solo === 'function');
  await page.evaluate(() => window.__onlineMenu.solo());
  await waitFor(page, () => typeof window.__lobby?.rush === 'function');
  await page.evaluate(() => window.__lobby.rush());
  await waitFor(page, () => window.__mainMenu?.matchStarted === true);
  await waitFor(page, () => typeof window.__pauseStage?.read === 'function');
  await waitFor(page, () => window.__pauseStage.read().simTicks > 30);
  await play(page, 2_000);

  // 4. ESC → DOWNLOAD LOG, and read back the bytes Chromium wrote.
  await page.keyboard.press('Escape');
  await waitFor(page, () => window.__pauseStage.read().open === true);
  await page.waitForSelector('#playtest-download-log-button', { state: 'visible', timeout: 10_000 });
  await page.screenshot({ path: join(HERE, `pause-download-log-${tag}.png`) });
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20_000 }),
    page.locator('#playtest-download-log-button').click(),
  ]);
  const path = await download.path();
  const text = readFileSync(path, 'utf8');
  writeFileSync(join(HERE, `${tag}.json`), text);

  await context.close();
  return { parsed: JSON.parse(text), filename: download.suggestedFilename(), errors, ticksPlayed, stored };
}

/** Count events by kind, for the manifest. */
function tally(events) {
  const by = {};
  for (const e of events) by[e.kind] = (by[e.kind] ?? 0) + 1;
  return by;
}

const browser = await chromium.launch();
try {
  const fixed = await session(browser, { storage: true, tag: 'after-return-to-menu' });
  const before = await session(browser, { storage: false, tag: 'without-persistence' });

  const lines = [];
  const say = (s) => lines.push(s);
  say('# a0-56 — the exported log after returning to the menu');
  say('');
  say('Captured by `capture.mjs` against the preview bundle, one script, one build.');
  say('Both passes drive the same session: an offline match, ESC → EXIT → LEAVE (the');
  say('pause menu\'s own way out, which navigates the page), PLAY → PLAY SOLO → RUSH!');
  say('into a second match, then ESC → DOWNLOAD LOG. The file below is the one');
  say('Chromium actually saved.');
  say('');
  for (const [title, run, file] of [
    ['WITH the fix (`after-return-to-menu.json`)', fixed, 'after-return-to-menu.json'],
    ['WITHOUT persistence — the client as it shipped (`without-persistence.json`)', before, 'without-persistence.json'],
  ]) {
    const p = run.parsed;
    say(`## ${title}`);
    say('');
    say('```');
    say(`file          ${run.filename}`);
    say(`summary       ${p.summary}`);
    say(`coverage      ${p.coverage}`);
    say(`span          ${p.span.fromMs}ms – ${p.span.toMs}ms   (durationMs ${p.durationMs})`);
    say(`restored      ${p.restored}`);
    say(`events        ${p.events.length}   dropped ${p.dropped}   capacity ${p.capacity}`);
    say(`by kind       ${JSON.stringify(tally(p.events))}`);
    say(`match events  ${p.events.filter((e) => e.kind === 'match').map((e) => e.msg).join(', ') || '(none)'}`);
    say(`page errors   ${run.errors.length === 0 ? 'none' : run.errors.join(' | ')}`);
    say('```');
    say('');
    say('First ten lines of the timeline:');
    say('');
    say('```');
    for (const e of p.events.slice(0, 10)) say(`${String(e.at).padStart(7)}ms  ${e.kind.padEnd(7)} ${e.msg}`);
    say('```');
    say('');
    void file;
  }
  writeFileSync(join(HERE, 'manifest.md'), lines.join('\n') + '\n');

  console.log(`WITH persistence   : coverage=${fixed.parsed.coverage} events=${fixed.parsed.events.length} restored=${fixed.parsed.restored} match=${fixed.parsed.events.filter((e) => e.kind === 'match').length}`);
  console.log(`WITHOUT (as shipped): coverage=${before.parsed.coverage} events=${before.parsed.events.length} restored=${before.parsed.restored} match=${before.parsed.events.filter((e) => e.kind === 'match').length}`);
  console.log(`errors: fixed=${fixed.errors.length} before=${before.errors.length}`);
} finally {
  await browser.close();
}
