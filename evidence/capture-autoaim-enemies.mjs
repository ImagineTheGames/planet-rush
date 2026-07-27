/**
 * evidence/capture-autoaim-enemies.mjs — evidence for `auto-aim-enemies-first`:
 * the player's auto-aim ladder puts a hittable ENEMY ahead of a rock (tier 1 over
 * tier 2, src/sim/step.ts acquireAimTarget), and falls to the rock when no enemy
 * is hittable. OWNER: capture tooling for the QA Manager (who writes the caption).
 *
 * ── WHY THE EFFECT IS THE PROOF (no target-readout seam exists) ─────────────
 * The auto-aim TARGET is not exposed, but its EFFECT is ground truth, read by two
 * seams that cannot be faked:
 *   • a shot that hit an ENEMY ⇒ that enemy's health-bar `fraction`/`hpText` falls
 *     (__healthbarStage.bars(): owner, fraction, hpText, screen x/y).
 *   • a shot that mined a ROCK ⇒ the hold `cargo` rises (__oreDepositStage.readout()).
 * `__tapCommanderStage.readout().firing` is the sim's own "a shot went out" tell.
 *
 * ── WHY THE SCENE IS SPLIT (honest scope) ──────────────────────────────────
 * No live-stage seam can place a hittable enemy AND a rock in the same frame:
 * stageRockOnly() parks every enemy far out with spawnProtect=999 (permanent, it
 * is in SECONDS), and stageAutoEngage() clears the asteroid field. So the ladder's
 * two OUTCOMES are shown deterministically on a real boot, then the DEVELOPER
 * scenario (an enemy amid a rock field) is shown from the live arena:
 *
 *   ROCK  (stageRockOnly false): a rock in weapon range, every enemy parked far &
 *         protected. The ship auto-mines — `cargo` CLIMBS, ZERO enemy bars. Tier 2.
 *   ENEMY (stageAutoEngage):     one bot parked in weapon range, the field cleared,
 *         a waypoint away. The ship flies the waypoint and auto-fires the BOT —
 *         its bar DRAINS, `cargo` stays 0. Tier 1 (the p9-02 auto-engage front door).
 *   CLUSTER (live arena):        the ship parked in the natural dense asteroid
 *         cluster with a real enemy in range — surrounded by minable rock, yet
 *         `cargo` is FLAT while the in-range enemy's bar DRAINS: enemies-first.
 *
 * ── OUTPUT ─────────────────────────────────────────────────────────────────
 *   evidence/images/autoaim-enemies-strip.png — captioned ROCK / ENEMY / CLUSTER.
 *   evidence/images/autoaim-rock.png / -enemy.png / -cluster.png — raw frames.
 *   /tmp/autoaim-readback.json — per-phase ground truth (cargo, bars, firing).
 *
 * Reproduce:
 *   export LD_LIBRARY_PATH=/tmp/pwlibs/root/usr/lib/x86_64-linux-gnu:/tmp/pwlibs/root/lib/x86_64-linux-gnu
 *   export EVIDENCE_BASE_URL=http://localhost:4188
 *   node evidence/capture-autoaim-enemies.mjs
 */
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4188';

async function snap(page) {
  return page.evaluate(() => {
    const pr = window.__planetRush;
    const r = window.__tapCommanderStage.readout();
    const bars = (window.__healthbarStage.bars() ?? []).map((b) => ({ owner: b.owner, local: b.local, fraction: b.fraction, hpText: b.hpText, x: Math.round(b.x), y: Math.round(b.y) }));
    return { tick: pr.ticks, firing: r.firing, sw: r.shipPos, ss: { x: pr.shipScreen.x, y: pr.shipScreen.y }, cargo: window.__oreDepositStage.readout()?.cargo ?? null, bars };
  });
}
const enemyBars = (s) => s.bars.filter((b) => !b.local);
function nearestEnemy(s) { let best = null, bd = Infinity; for (const b of enemyBars(s)) { const d = Math.hypot(b.x - s.ss.x, b.y - s.ss.y); if (d < bd) { bd = d; best = { ...b, dist: Math.round(d) }; } } return best; }
const wait = (page, ms) => page.waitForTimeout(ms);

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__tapCommanderStage?.setScheme === 'function', undefined, { timeout: 30000 });
  await page.waitForFunction(() => (window.__planetRush?.ticks ?? 0) >= 700, undefined, { timeout: 90000 });
  await page.mouse.click(640, 400);
  await page.evaluate(() => window.__tapCommanderStage.setScheme('tap'));
  const build = await page.evaluate(() => window.__planetRush?.build ?? null);
  const rec = { build, cluster: [], rock: [], enemy: [], errors: errs };
  let hpPrev = {};

  // ── CLUSTER (live, FIRST — before the deterministic phases teleport the ship to
  //    arena centre): drive into the dense natural asteroid field beside the ship's
  //    spawn, inject a real enemy in range, and record cargo FLAT amid rocks while
  //    the in-range enemy's bar DRAINS — enemies-first.
  const start = await page.evaluate(() => window.__tapCommanderStage.readout().shipPos);
  for (const [dx, dy] of [[-560, -40], [-540, -120], [-500, 40]]) {
    await page.evaluate(([x, y]) => window.__tapCommanderStage.tapWorld(x, y), [start.x + dx, start.y + dy]);
    for (let k = 0; k < 22; k++) await wait(page, 45);
  }
  let clusterFrame = null, clusterState = null; hpPrev = {};
  for (let i = 0; i < 90; i++) {
    await page.evaluate(() => window.__nameplateStage.stageBot()); // hold a real enemy in range+LOS beside the ship
    const p = await page.evaluate(() => window.__tapCommanderStage.readout().shipPos);
    await page.evaluate(([x, y]) => window.__tapCommanderStage.tapWorld(x, y), [p.x + (i % 2 ? 8 : -8), p.y]);
    const s = await snap(page);
    const hpNow = Object.fromEntries(enemyBars(s).map((b) => [b.owner, b.fraction]));
    const hits = [];
    for (const [o, f] of Object.entries(hpNow)) if (hpPrev[o] != null && f < hpPrev[o] - 1e-6) hits.push({ owner: +o, from: hpPrev[o], to: f });
    const rose = rec.cluster.length && s.cargo > rec.cluster.at(-1).cargo + 1e-6;
    const ne = nearestEnemy(s);
    rec.cluster.push({ i, tick: s.tick, firing: s.firing, cargo: s.cargo, rose, enemyHits: hits, nearEnemy: ne });
    if (!clusterFrame && hits.length && ne && ne.dist < 175 && !rose && i > 14) { clusterFrame = await page.screenshot(); clusterState = s; }
    hpPrev = hpNow;
    await wait(page, 45);
  }
  if (!clusterFrame) { clusterFrame = await page.screenshot(); clusterState = await snap(page); }
  writeFileSync(join(OUT, 'autoaim-cluster.png'), clusterFrame);
  console.log('CLUSTER hitFrames', rec.cluster.filter((x) => x.enemyHits.length).length, 'mineFrames', rec.cluster.filter((x) => x.rose).length);

  // ── ROCK (tier 2): stageRockOnly(false) — rock in range, enemies far+protected.
  //    Stage ONCE (re-staging would reset ship.cargo to 0 before chunks bank), then
  //    loiter in range with tiny net-zero taps so the pilot keeps auto-firing the rock.
  const rockStage = await page.evaluate(() => window.__tapCommanderStage.stageRockOnly(false));
  console.log('stageRockOnly', JSON.stringify(rockStage));
  let rockFrame = null, rockState = null;
  for (let i = 0; i < 70; i++) {
    const p = await page.evaluate(() => window.__tapCommanderStage.readout().shipPos);
    await page.evaluate(([x, y]) => window.__tapCommanderStage.tapWorld(x, y), [p.x + (i % 2 ? 26 : -26), p.y + (i % 2 ? 14 : -14)]);
    const s = await snap(page);
    const rose = rec.rock.length && s.cargo > rec.rock.at(-1).cargo + 1e-6;
    rec.rock.push({ i, tick: s.tick, firing: s.firing, cargo: s.cargo, rose, nEnemy: enemyBars(s).length });
    if (!rockFrame && s.cargo > 0 && s.firing && enemyBars(s).length === 0 && i > 6) { rockFrame = await page.screenshot(); rockState = s; }
    await wait(page, 45);
  }
  if (!rockFrame) { rockFrame = await page.screenshot(); rockState = await snap(page); }
  writeFileSync(join(OUT, 'autoaim-rock.png'), rockFrame);
  console.log('ROCK cargo', rec.rock[0].cargo, '->', rec.rock.at(-1).cargo, 'mineFrames', rec.rock.filter((x) => x.rose).length, 'maxEnemyBars', Math.max(...rec.rock.map((x) => x.nEnemy)));

  // ── ENEMY (tier 1 alone): stageAutoEngage — bot in range, field cleared. Loiter
  //    in range (tap current pos) so the bot's bar drains, cargo pinned 0 (no rocks).
  const eng = await page.evaluate(() => window.__tapCommanderStage.stageAutoEngage());
  console.log('stageAutoEngage', JSON.stringify(eng));
  let enemyFrame = null, enemyState = null; hpPrev = {};
  for (let i = 0; i < 60; i++) {
    const p = await page.evaluate(() => window.__tapCommanderStage.readout().shipPos);
    await page.evaluate(([x, y]) => window.__tapCommanderStage.tapWorld(x, y), [p.x + (i % 2 ? 18 : -18), p.y]);
    const s = await snap(page);
    const hpNow = Object.fromEntries(enemyBars(s).map((b) => [b.owner, b.fraction]));
    const hits = [];
    for (const [o, f] of Object.entries(hpNow)) if (hpPrev[o] != null && f < hpPrev[o] - 1e-6) hits.push({ owner: +o, from: hpPrev[o], to: f });
    rec.enemy.push({ i, tick: s.tick, firing: s.firing, cargo: s.cargo, enemyHits: hits, nearEnemy: nearestEnemy(s) });
    if (!enemyFrame && hits.length && s.cargo === 0 && i > 3) { enemyFrame = await page.screenshot(); enemyState = s; }
    hpPrev = hpNow;
    await wait(page, 45);
  }
  if (!enemyFrame) { enemyFrame = await page.screenshot(); enemyState = await snap(page); }
  writeFileSync(join(OUT, 'autoaim-enemy.png'), enemyFrame);
  console.log('ENEMY hitFrames', rec.enemy.filter((x) => x.enemyHits.length).length, 'cargoEnd', rec.enemy.at(-1).cargo);

  rec.states = { rock: rockState, enemy: enemyState, cluster: clusterState };
  await browser.close();
  writeFileSync('/tmp/autoaim-readback.json', JSON.stringify(rec, null, 2));
  console.log('errors', errs.slice(0, 3));
}
main().catch((e) => { console.error(e); process.exit(1); });
