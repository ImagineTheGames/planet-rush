/**
 * evidence/p1-05-summary-sequence/skip-consumes-the-first-tap.mjs — rule 1's other
 * half, proved on the REAL booted client. OWNER: UI Engineer.
 *
 * `summary-sequence.test.ts` proves a skip lands on the same numbers. It cannot
 * prove the thing that actually bites a player:
 *
 *   > *"The first input skips and does not also press a button, or a
 *   > double-tapping player rematches by accident."* — plan §6.4 rule 1
 *
 * That lives in the wiring (`src/main.ts`'s pointer path), so it is checked here,
 * through a real tap at the real REMATCH plate, with `matchId()` — how many worlds
 * this boot has built — as the witness:
 *
 *   1. stage a finished match and put the sequence mid-flight (`summarySeek`);
 *   2. tap REMATCH → the sequence skips and `matchId` **does not move**;
 *   3. tap REMATCH again → `matchId` **increases**: the second tap acts.
 *
 * Run:  node evidence/p1-05-summary-sequence/skip-consumes-the-first-tap.mjs
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DIST = resolve(HERE, '../../dist');
const PORT = 4189;
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

const server = await new Promise((ok) => {
  const s = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let file = join(DIST, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname.endsWith('/')) file = join(DIST, 'index.html');
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  s.listen(PORT, () => ok(s));
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const settle = () =>
  page.evaluate(
    () =>
      new Promise((done) => {
        let n = 0;
        const step = () => (++n >= 3 ? done() : requestAnimationFrame(step));
        requestAnimationFrame(step);
      }),
  );

try {
  await page.goto(`http://127.0.0.1:${PORT}/?debug=1`);
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__endScreenStage?.screen === 'function');
  await page.evaluate(() => window.__endScreenStage.endMatch());
  await page.waitForFunction(() => window.__endScreenStage.screen() === 'result');

  // Put the sequence mid-flight: a staged boot otherwise rests at its end state,
  // and a settled sequence is deliberately not skippable.
  await page.evaluate(() => window.__endScreenStage.summarySeek(2.0));
  await settle();
  const before = await page.evaluate(() => ({
    matchId: window.__endScreenStage.matchId(),
    done: window.__endScreenStage.summary().done,
    buttons: window.__endScreenStage.buttons(),
  }));

  // A real tap, on the real REMATCH plate. The plate's rect is not exposed by the
  // seam, so this is where the layout draws it on this viewport — the left
  // column's first plate at 1280×800, which the golden of the same screen shows.
  const TAP = { x: 300, y: 553 };
  await page.mouse.click(TAP.x, TAP.y);
  await settle();
  const afterFirst = await page.evaluate(() => ({
    matchId: window.__endScreenStage.matchId(),
    screen: window.__endScreenStage.screen(),
    done: window.__endScreenStage.summary()?.done ?? null,
  }));

  await page.mouse.click(TAP.x, TAP.y);
  await settle();
  const afterSecond = await page.evaluate(() => ({
    matchId: window.__endScreenStage.matchId(),
    screen: window.__endScreenStage.screen(),
  }));

  const skipped = afterFirst.matchId === before.matchId && afterFirst.done === true;
  const acted = afterSecond.matchId > before.matchId;
  console.log(
    JSON.stringify({ before, afterFirst, afterSecond, skipped, acted }, null, 2),
  );
  console.log(
    skipped && acted
      ? 'PASS — the first tap skipped and did not rematch; the second rematched.'
      : 'FAIL — see the readback above.',
  );
  process.exitCode = skipped && acted ? 0 : 1;
} finally {
  await browser.close();
  server.close();
}
