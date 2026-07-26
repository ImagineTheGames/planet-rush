/**
 * evidence/warden-watch.mjs — round-10: a focused continuous watch of ONE
 * turreted planet in the natural match, to catch a turret at REST and then
 * sliding to engage a naturally-arrived attacker. OWNER: QA Manager.
 *
 * Read-only, no staging. Local ship idle at home; wide 1:1 camera. Warden (p7)
 * sits on-screen with two rim turrets. We clip-screenshot the Warden region every
 * ~60ms and log per frame: tick, coreHp(7), turret muzzle beams (seam-certain
 * turret pixel + aim), and every drawn bar (the two STATIC bars near the rim are
 * the turrets; a moving non-owner bar is an attacker). Afterwards the cleanest
 * rest→slide→fire window is chosen by LOOKING.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4174';
const SECONDS = Number(process.argv[2] ?? 55);
const VP = { width: 2560, height: 2560 };
const CLIP = { x: 760, y: 300, width: 820, height: 820 }; // around Warden core ~(1122,669)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SNAP = () => {
  const pr = window.__planetRush;
  const sw = pr.shipWorld, ss = pr.shipScreen;
  const S = (wx, wy) => ({ x: Math.round(ss.x + (wx - sw.x)), y: Math.round(ss.y + (wy - sw.y)) });
  const turret = (pr.beams ?? []).filter((b) => b.source === 'turret' && b.shooter === 7).map((b) => {
    const o = S(b.origin.x, b.origin.y), e = S(b.end.x, b.end.y);
    return { ox: o.x, oy: o.y, ex: e.x, ey: e.y, hit: !!b.hit };
  });
  const bars = (window.__healthbarStage?.bars?.() ?? []).map((b) => ({ o: b.owner, x: Math.round(b.x), y: Math.round(b.y), f: +b.fraction.toFixed(2), local: b.local }));
  return { tick: pr.ticks, core7: pr.coreHp(7), turret, bars };
};

async function main() {
  const DIR = '/tmp/warden';
  mkdirSync(DIR, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__planetRush?.coreHp === 'function', undefined, { timeout: 25_000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForFunction(() => (window.__planetRush?.ticks ?? 0) >= 780, undefined, { timeout: 60_000 });
  const build = await page.evaluate(() => window.__planetRush?.build ?? null);
  // Fast-forward CHEAPLY (no screenshots) to just before Sable's siege of Warden
  // (~tick 15983 in this deterministic seed), then capture densely through it.
  const START = Number(process.env.START_TICK ?? 15200);
  const END = Number(process.env.END_TICK ?? 17300);
  await page.waitForFunction((t) => (window.__planetRush?.ticks ?? 0) >= t, START, { timeout: 460_000 });
  const frames = [];
  let i = 0;
  while (true) {
    const s = await page.evaluate(SNAP);
    const path = join(DIR, `f${String(i).padStart(3, '0')}.png`);
    await page.screenshot({ path, clip: CLIP });
    frames.push({ i, path, ...s });
    i++;
    if (s.tick >= END || i >= 500) break;
    await sleep(40);
  }
  writeFileSync(join(DIR, 'watch.json'), JSON.stringify({ build, clip: CLIP, frames }, null, 2));
  console.log('[warden-watch] frames', frames.length, 'ticks', frames[0].tick, '->', frames[frames.length - 1].tick, 'build', build?.sha);
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
