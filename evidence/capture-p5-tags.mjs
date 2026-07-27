/**
 * evidence/capture-p5-tags.mjs — "difficulty tags on bot nameplates" (p5).
 * OWNER: QA Manager. Reads the SHIPPED ?debug=1 `window.__nameplateStage` back and
 * LOOKS at the drawn labels. Two views:
 *
 *   CLOSE  — ?freeze: `stageBot()` parks the first bot (Rusty) beside the local
 *      ship so both labels draw; the bot reads "Rusty (EASY)" with the (EASY)
 *      suffix a step DIMMER (NAMEPLATE_SUFFIX_ALPHA 0.55) than the name, and the
 *      local "YOU" carries NO suffix. Crisp, close, deterministic.
 *   LADDER — a wide LIVE match (no freeze): the camera sees several bots at once;
 *      poll the drawn plates until EASY, MEDIUM and HARD suffixes are all on screen
 *      (or as many as roam into view), each dimmer than its name, the local YOU with
 *      none. Capture the richest frame(s); the readback names every plate shot.
 *
 * Usage: node evidence/capture-p5-tags.mjs   (needs a server on $EVIDENCE_BASE_URL)
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';
const plateList = (page) => page.evaluate(() => window.__nameplateStage.plates().map((x) => ({ owner: x.owner, kind: x.kind, text: x.text, suffix: x.suffix, local: x.local, x: Math.round(x.x), y: Math.round(x.y) })));

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const readback = {};

  // ── CLOSE (freeze, stageBot) ──────────────────────────────────────────────
  {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(BASE + '/?debug=1&freeze=1', { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.__nameplateStage?.stageBot === 'function', { timeout: 20_000 });
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    const staged = await page.evaluate(() => window.__nameplateStage.stageBot());
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const plates = await plateList(page);
    const difficulties = await page.evaluate(() => window.__nameplateStage.difficulties());
    await page.screenshot({ path: join(OUT, 'p5-tags-close.png') });
    readback.close = { staged, difficulties, plates };
    await ctx.close();
  }

  // ── LADDER (whole arena, all eight nameplates) ────────────────────────────
  // `__tapCommanderStage.stage()` teleports the LOCAL ship to the arena centre, so
  // the follow-camera sits at the middle of the 8-planet ring. A viewport wide
  // enough to hold the ring then draws every planet's nameplate at once: the local
  // "YOU" with NO suffix, and the seven rivals each carrying their REAL tier suffix
  // (the data-driven `difficulties()` table), EASY / MEDIUM / HARD all on one frame,
  // each suffix a step dimmer than its name.
  {
    const ctx = await browser.newContext({ viewport: { width: 2000, height: 2000 }, deviceScaleFactor: 1.5 });
    const page = await ctx.newPage();
    await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.__tapCommanderStage?.stage === 'function', { timeout: 25_000 });
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    const staged = await page.evaluate(() => window.__tapCommanderStage.stage());
    await page.waitForTimeout(500);
    const plates = await plateList(page);
    const difficulties = await page.evaluate(() => window.__nameplateStage.difficulties());
    const tiers = [...new Set(plates.filter((p) => p.suffix).map((p) => p.suffix))];
    await page.screenshot({ path: join(OUT, 'p5-tags-ladder.png') });
    readback.ladder = { staged, difficulties, tiers, plates };
    await ctx.close();
  }

  writeFileSync(join(OUT, 'p5-tags-readback.json'), JSON.stringify(readback, null, 2));
  console.log(JSON.stringify(readback, null, 2));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
