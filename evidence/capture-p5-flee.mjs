/**
 * evidence/capture-p5-flee.mjs — "a wounded bot COMMITS to its retreat" (p5
 * decision-hysteresis, PR #139). OWNER: QA Manager. The field report photographed
 * a low-HP bot flapping between attack and flee, "twitching in place, never
 * actually going anywhere." The fix is a hysteresis LATCH (src/bots/commitment.ts):
 * FLEE enters when wounded + a threat is in range, and only leaves once the bot has
 * CLEARED the far ring of every threat (or its hull is whole again) — so a value
 * hovering on the enter boundary can never toggle the committed retreat.
 *
 * This re-stages the screenshot scenario naturally and reads it back frame by frame:
 *   - Centre the camera on the arena (`__tapCommanderStage.stage()` parks the local
 *     ship at the middle of the 8-planet ring, so the WHOLE flee is on screen).
 *   - Wound the first bot to 20% hull right beside the local ship — a threat in
 *     range — with the shipped `__healthbarStage.damageEnemy` seam, ONCE.
 *   - Then leave it alone and watch: it drives off in one committed heading toward
 *     its own home planet (its destination — home is where the turrets are), its
 *     distance from the threat growing every read, NEVER oscillating in place.
 *   - Caption the flee-enter HP (staged) and the flee-exit HP (read back).
 *
 * Runs WITHOUT ?freeze (the retreat must step the sim).
 *
 * Usage: node evidence/capture-p5-flee.mjs   (needs a server on $EVIDENCE_BASE_URL)
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 2000, height: 2000 }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__tapCommanderStage?.stage === 'function', { timeout: 25_000 });
  await page.waitForFunction(() => typeof window.__healthbarStage?.damageEnemy === 'function', { timeout: 20_000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});

  // Centre the camera on the arena, then wound the first bot to 20% right beside
  // the local ship (a threat in range). ONE call — then hands off.
  await page.evaluate(() => window.__tapCommanderStage.stage());
  await page.waitForTimeout(300);
  const staged = await page.evaluate(() => window.__healthbarStage.damageEnemy(0.2));
  const enterHp = staged.fraction;

  const read = (owner) => page.evaluate((o) => {
    const pr = window.__planetRush;
    const plates = window.__nameplateStage.plates();
    const botShip = plates.find((x) => x.owner === o && x.kind === 'ship');
    const botPlanet = plates.find((x) => x.owner === o && x.kind === 'planet');
    const me = pr.shipScreen;
    const bar = window.__healthbarStage.bars().find((x) => x.owner === o);
    const name = window.__nameplateStage.names()[o];
    return {
      me,
      bot: botShip ? { x: Math.round(botShip.x), y: Math.round(botShip.y) } : null,
      home: botPlanet ? { x: Math.round(botPlanet.x), y: Math.round(botPlanet.y) } : null,
      hp: bar ? bar.fraction : null,
      name,
    };
  }, owner);

  const dist = (a, b) => Math.round(Math.hypot(a.x - b.x, a.y - b.y));
  const track = [];
  await page.waitForTimeout(200);
  const start = await read(staged.owner);
  await page.screenshot({ path: join(OUT, 'p5-flee-start.png') });

  let midShot = false, minHome = Infinity, arriveHp = null;
  let end = start;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(110);
    const d = await read(staged.owner);
    // Bot died / left health framing: it fled all the way (kept committed even as
    // fire finished it) — stop and keep the closest-to-home frame already saved.
    if (!d.bot || d.hp === null || d.hp <= 0.01) break;
    const dThreat = dist(d.bot, d.me);
    const dHome = d.home ? dist(d.bot, d.home) : null;
    track.push({ t: i, dThreat, dHome, hp: d.hp, bot: d.bot });
    if (!midShot && dThreat > (track[0]?.dThreat ?? 0) + 150) {
      midShot = true;
      await page.screenshot({ path: join(OUT, 'p5-flee-mid.png') });
    }
    // Keep the frame where the fleeing bot is CLOSEST to its home — its destination
    // reached, distance from the threat at its widest.
    if (dHome !== null && dHome < minHome && dThreat > (track[0]?.dThreat ?? 0)) {
      minHome = dHome;
      arriveHp = d.hp;
      end = d;
      await page.screenshot({ path: join(OUT, 'p5-flee-end.png') });
    }
  }

  // Monotonic-travel check: displacement from the flee-start position, per read.
  const p0 = track[0]?.bot;
  const displacement = track.map((t) => (p0 ? Math.round(Math.hypot(t.bot.x - p0.x, t.bot.y - p0.y)) : 0));
  const monotonic = displacement.every((d, i) => i === 0 || d >= displacement[i - 1] - 6); // near-monotone (small settle noise)

  const readback = {
    botOwner: staged.owner,
    botName: start.name,
    enterHp,
    arriveHp,
    minDistFromHome: Number.isFinite(minHome) ? minHome : null,
    startDistFromThreat: track[0]?.dThreat ?? null,
    endDistFromThreat: track[track.length - 1]?.dThreat ?? null,
    startDistFromHome: track[0]?.dHome ?? null,
    endDistFromHome: track[track.length - 1]?.dHome ?? null,
    totalDisplacement: displacement[displacement.length - 1] ?? null,
    monotonicTravel: monotonic,
    samples: track.filter((_, i) => i % 4 === 0),
  };
  writeFileSync(join(OUT, 'p5-flee-readback.json'), JSON.stringify(readback, null, 2));
  console.log(JSON.stringify(readback, null, 2));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
