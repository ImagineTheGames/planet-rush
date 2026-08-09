/**
 * evidence/p1-05-summary-sequence/capture.mjs — the summary sequence, photographed
 * on the REAL booted client. OWNER: UI Engineer (brief
 * `docs/briefs/pr-05-summary-sequence.md`, the evidence line).
 *
 * Five frames at 844×390 — a landscape phone, the size plan §6.4 rule 4 is
 * written against — of ONE sequence:
 *
 *   1. beat 0, the result alone (the ache gets its beat, GDD §4.7);
 *   2. beat 1, mid-count, rows arriving and counting up from zero;
 *   3. beat 3, the bar mid-fill toward the next level;
 *   4. beat 5, the settle, with the buttons live;
 *   5. the same sequence under `prefers-reduced-motion: reduce` — the same final
 *      numbers, held from the first frame, with the level-up still marked.
 *
 * The clock is PINNED for the first four (`__endScreenStage.summarySeek`) rather
 * than raced with a stopwatch: four stills of one sequence is the evidence, four
 * stills of four sequences is not. Every number in every frame is still the
 * sequence's own — the seam pins the clock the view reads and nothing else.
 *
 * The match is a real one: the client boots `?debug=1` (no lobby), plays for a
 * few seconds so ore, distance and hulls are genuinely accrued, and the win is
 * staged through the sim's own `destroyCore` — which also means nobody is
 * credited with those station deaths, so the STATIONS DESTROYED row shows `—`
 * rather than `0` (plan §1.3c). That is the Crush case, photographed.
 *
 * Run:  node evidence/p1-05-summary-sequence/capture.mjs
 * (builds first if `dist/` is stale: `npm run build`)
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DIST = resolve(HERE, '../../dist');
const PORT = 4187;
const VIEWPORT = { width: 844, height: 390 };
/** How long the real match runs before the win is staged, in ms. */
const PLAY_MS = 9000;

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

/** The smallest static server that can serve a Vite build — no preview process
 *  to shepherd, and no port negotiation with whatever else the lane is running. */
function serve(root, port) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let file = join(root, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname.endsWith('/')) file = join(root, 'index.html');
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) => server.listen(port, () => ok(server)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Boot the debug client, FLY for a few seconds, lose a hull, and stage a win for
 * the local seat.
 *
 * The flying is the point: the rows are the accrual observer's own measurements,
 * so a client that sat still would photograph seven zeros and prove nothing about
 * a count-up. The keys are real keys through the real input funnel — nothing here
 * writes a number into the summary.
 */
async function stageWin(page, base) {
  await page.goto(`${base}/?debug=1`);
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__endScreenStage?.screen === 'function', null, {
    timeout: 30_000,
  });

  // Fly: thrust, then bank right, then thrust again — a few thousand units of
  // DISTANCE TRAVELLED, and whatever ore the arena happens to put in the way.
  await page.keyboard.down('KeyW');
  await sleep(PLAY_MS * 0.4);
  await page.keyboard.down('KeyD');
  await sleep(PLAY_MS * 0.4);
  await page.keyboard.up('KeyW');
  await sleep(PLAY_MS * 0.2);
  await page.keyboard.up('KeyD');

  // One hull lost, through the sim's own kill path, so SHIPS USED reads 2 and the
  // free-respawn design (GDD §2.7) is visible in the sheet rather than assumed.
  await page.evaluate(() => window.__endScreenStage.killLocalShip());
  await page.waitForFunction(() => window.__endScreenStage.shipAlive() === true, null, { timeout: 20_000 });

  const staged = await page.evaluate(() => window.__endScreenStage.winLocal());
  if (!staged) throw new Error('could not stage a local win');
  await page.waitForFunction(() => window.__endScreenStage.screen() === 'result', null, { timeout: 15_000 });
}

/** Three animation frames, so what was staged has actually been drawn. */
async function settle(page) {
  await page.evaluate(
    () =>
      new Promise((done) => {
        let n = 0;
        const step = () => (++n >= 3 ? done() : requestAnimationFrame(step));
        requestAnimationFrame(step);
      }),
  );
}

async function shot(page, name, seconds, log) {
  await page.evaluate((s) => window.__endScreenStage.summarySeek(s), seconds);
  await settle(page);
  const model = await page.evaluate(() => window.__endScreenStage.summary());
  await page.screenshot({ path: join(HERE, `${name}.png`) });
  log.push({ frame: name, at: seconds === null ? 'live' : `${seconds}s`, model });
  return model;
}

const server = await serve(DIST, PORT);
const base = `http://127.0.0.1:${PORT}`;
const browser = await chromium.launch();
const log = [];

try {
  // --- The four beats, one sequence, clock pinned -----------------------------
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 3 });
  await stageWin(page, base);
  await shot(page, '1-beat0-result-alone', 0.6, log);
  await shot(page, '2-beat1-mid-count', 2.2, log);
  await shot(page, '3-beat3-bar-mid-fill', 4.3, log);
  await shot(page, '4-beat5-settle', 30, log);
  const career = await page.evaluate(() => window.__endScreenStage.career());
  log.push({ career });
  await page.close();

  // --- …and the same sequence with the OS asking for less motion --------------
  const reduced = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 3 });
  await reduced.emulateMedia({ reducedMotion: 'reduce' }); // the real media query, not a flag
  await stageWin(reduced, base);
  await settle(reduced);
  const reducedModel = await reduced.evaluate(() => window.__endScreenStage.summary());
  await reduced.screenshot({ path: join(HERE, '5-reduced-motion.png') });
  log.push({ frame: '5-reduced-motion', at: 'first frame', model: reducedModel });
  const reducedCareer = await reduced.evaluate(() => window.__endScreenStage.career());
  log.push({ career: reducedCareer });
  await reduced.close();

  writeFileSync(join(HERE, 'frames.json'), `${JSON.stringify(log, null, 2)}\n`);
  console.log(JSON.stringify(log, null, 2));
} finally {
  await browser.close();
  server.close();
}
