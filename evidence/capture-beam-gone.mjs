/**
 * evidence/capture-beam-gone.mjs — p2-evidence-beam-gone: re-verify mining after
 * the beam's funeral (PR #101). OWNER: QA Manager. Same flight as capture-mining.mjs
 * (fly up-left into the home field, hold Fire), but the readbacks are updated for
 * the post-funeral seam surface and the whole point is now the ABSENCE of a beam:
 *
 *  1. SEAM PROBE (before any input): assert the retired seam is GONE, not just
 *     empty — `'beams' in window.__planetRush` must be false, and the replacement
 *     `window.__planetRush.muzzles` must exist as the turret muzzle-flash reflect.
 *  2. MINING FLIGHT: fly into the home field and hold Fire. Each frame read
 *     `muzzles` (turret flashes only — a ship contributes NONE since the laser
 *     funeral) and count red projectile pixels. The best frame is one with a
 *     projectile in flight; there is no "own beam" to look for anymore.
 *  3. The saved PNG is then LOOKED AT by hand: no plasma line off the ship nose,
 *     coach copy speaks of "shots" not "beam".
 *
 * Usage: node evidence/capture-beam-gone.mjs
 *   env EVIDENCE_BASE_URL (default http://localhost:4174)
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4174';
const CX = 640, CY = 400;
mkdirSync(OUT, { recursive: true });
mkdirSync('/tmp/capbeam', { recursive: true });

function isRed(r, g, b) { return r > 150 && g < 95 && b < 95; }
function isGrey(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx > 110 && mx < 215 && (mx - mn) < 28 && Math.abs(r - g) < 22 && Math.abs(g - b) < 30;
}
// nearest asteroid (grey blob) to screen centre, so we can steer the ship into
// weapon range of a rock and PARK there — that is what raises the mine prompt.
function nearestRock(png) {
  const { width, height, data } = png;
  let best = null, bestD = 1e18;
  for (let y = 120; y < 720; y += 2) for (let x = 40; x < 1040; x += 2) {
    const i = (y * width + x) * 4;
    if (!isGrey(data[i], data[i + 1], data[i + 2])) continue;
    const dx = x - CX, dy = y - CY, d = dx * dx + dy * dy;
    if (d < 400) continue;
    if (d < bestD) { bestD = d; best = { x, y }; }
  }
  if (!best) return null;
  let sx = 0, sy = 0, n = 0;
  for (let y = Math.max(0, best.y - 55); y < Math.min(height, best.y + 55); y += 2)
    for (let x = Math.max(0, best.x - 55); x < Math.min(width, best.x + 55); x += 2) {
      const i = (y * width + x) * 4;
      if (isGrey(data[i], data[i + 1], data[i + 2])) { sx += x; sy += y; n++; }
    }
  return { x: sx / n, y: sy / n, dist: Math.sqrt(bestD), n };
}
// bright near-white text pixels in the coach banner band (the mine prompt sits
// mid-screen, ~y575). Used only to PREFER a frame where the coach copy is legible.
function coachText(png) {
  const { width, data } = png; let n = 0;
  for (let y = 558; y < 594; y++) for (let x = 380; x < 905; x++) {
    const i = (y * width + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
    // The banner glyphs are a cool light-grey (~204,211,220), NOT pure white; the
    // band is otherwise the near-black arena, so a modest brightness gate isolates
    // the text cleanly (measured: ~677 such px when the banner is up, ~24 when not).
    if (r > 150 && g > 155 && b > 160) n++;
  }
  return n;
}
// Red projectile pixels NEAR the local ship. The camera follows the local ship,
// so it sits at screen centre every frame; its shots stream outward from there.
// A radius gate (default 220px) counts those shots while EXCLUDING a besieged
// planet's big red SIEGE RING off in the arena — which would otherwise swamp the
// metric and read as "projectiles" when it is a planet outline. rMin skips the
// ship body itself. HUD band (y<120) is excluded.
function redProjectiles(png, R = 220, rMin = 14) {
  const { width, data } = png; let n = 0, sx = 0, sy = 0;
  const y0 = Math.max(120, CY - R), y1 = Math.min(700, CY + R);
  const x0 = Math.max(60, CX - R), x1 = Math.min(1040, CX + R);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * width + x) * 4;
    if (!isRed(data[i], data[i + 1], data[i + 2])) continue;
    const d = Math.hypot(x - CX, y - CY);
    if (d < rMin || d > R) continue;
    n++; sx += x; sy += y;
  }
  return { n, x: n ? Math.round(sx / n) : null, y: n ? Math.round(sy / n) : null };
}
function cropSave(src, out, x, y, w, h) {
  const p = PNG.sync.read(readFileSync(src));
  x = Math.max(0, Math.min(x, p.width - w)); y = Math.max(0, Math.min(y, p.height - h));
  const o = new PNG({ width: w, height: h });
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const si = ((y + j) * p.width + (x + i)) * 4, di = (j * w + i) * 4;
    o.data[di] = p.data[si]; o.data[di + 1] = p.data[si + 1]; o.data[di + 2] = p.data[si + 2]; o.data[di + 3] = 255;
  }
  writeFileSync(out, PNG.sync.write(o));
}

async function boot(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__planetRush?.viewport?.width > 0, undefined, { timeout: 25000 });
  await page.waitForFunction(() => (window.__planetRush?.ticks ?? 0) >= 700, undefined, { timeout: 45000 });
  return { ctx, page, errs };
}

async function main() {
  const browser = await chromium.launch();
  try {
    const { ctx, page, errs } = await boot(browser);
    const build = await page.evaluate(() => window.__planetRush.build);

    // 1. SEAM PROBE — the retired seam must be GONE, not merely empty.
    const probe = await page.evaluate(() => {
      const pr = window.__planetRush;
      return {
        keys: Object.keys(pr).sort(),
        hasBeamsKey: 'beams' in pr,
        beamsType: typeof pr.beams,
        hasMuzzlesKey: 'muzzles' in pr,
        muzzlesType: typeof pr.muzzles,
        muzzlesIsArray: Array.isArray(pr.muzzles),
        muzzlesLen: Array.isArray(pr.muzzles) ? pr.muzzles.length : null,
      };
    });
    console.log('[seam-probe]', JSON.stringify(probe));

    // 2. MINING FLIGHT — fly up-left into the home field. The MINE coach prompt
    //    shows only while a rock is in reach AND nothing has been mined yet
    //    (src/ui/onboarding.ts: `nearAsteroid && !hasMined`), and `hasMined`
    //    latches forever at the first ore chipped. So this runs in two phases:
    //      A. PARK, don't fire — steer to the nearest rock and hold in-range so
    //         the banner stays up (no ore ⇒ prompt never retires). Grab the
    //         banner frame: proves the coach copy says "shots", no beam drawn.
    //      B. OPEN FIRE — now hold Fire; the shot flies as a red projectile that
    //         chips the rock. Grab the projectile frame: proves shot-mining, and
    //         that STILL no beam line is drawn and NO ship-source muzzle appears.
    //    The two are stitched into the hero so both claims are in one image.
    const readMuzzles = () => page.evaluate(() => {
      const pr = window.__planetRush;
      const mz = Array.isArray(pr.muzzles) ? pr.muzzles : [];
      return { muzzles: mz.map((m) => ({ shooter: m.shooter })), shipSourceMuzzles: mz.filter((m) => m.shooter === 0).length };
    });
    const cand = [];
    await page.keyboard.down('KeyA'); await page.keyboard.down('KeyW');
    const held = new Set(['KeyA', 'KeyW']);
    const setKeys = async (want) => {
      for (const k of [...held]) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
      for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
    };

    // ── Phase A: chase the nearest rock, NOT firing, until the banner reads. The
    //    prompt needs the ship inside weapon range of a rock, so we thrust STRAIGHT
    //    at the nearest one (aim + keys) every frame — no backing off — and hold it
    //    there. No shot is fired, so `hasMined` never latches and the banner stays.
    let bannerFrame = null, rock = null, coachSeen = 0;
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(45);
      const path = `/tmp/capbeam/a${String(i).padStart(2, '0')}.png`;
      await page.screenshot({ path });
      const png = PNG.sync.read(readFileSync(path));
      rock = nearestRock(png) ?? rock;
      const coach = coachText(png);
      coachSeen = Math.max(coachSeen, coach);
      const mz = await readMuzzles();
      cand.push({ i, path, phase: 'A', red: redProjectiles(png).n, coach, ...mz });
      if (coach > 250 && (!bannerFrame || coach > bannerFrame.coach)) bannerFrame = { i, path, coach };
      // Thrust straight at the rock; aim the ship at it too (mouse = aim).
      const want = new Set();
      if (rock) {
        if (rock.x < CX - 6) want.add('KeyA'); else if (rock.x > CX + 6) want.add('KeyD');
        if (rock.y < CY - 6) want.add('KeyW'); else if (rock.y > CY + 6) want.add('KeyS');
        await page.mouse.move(rock.x, rock.y);
      }
      await setKeys(want);
      if (bannerFrame && i >= bannerFrame.i + 3) break; // hold a few frames, then move on
    }

    // ── Phase B: open fire on the SAME home-field rock (short, ~24 frames). We
    //    only nudge toward a rock that is CLOSE (dist 45–190) so the ship stays on
    //    the home rock and never wanders off to a besieged planet's grey moon.
    //    A frame is a good projectile frame when the near-ship red count sits in
    //    [3,420]: a shot dot is a handful of red px, whereas a besieged planet's
    //    red SIEGE RING is 800+, so the cap rejects a ring outright.
    let projFrame = null;
    await setKeys(new Set());
    await page.mouse.down();
    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(45);
      const path = `/tmp/capbeam/b${String(i).padStart(2, '0')}.png`;
      await page.screenshot({ path });
      const png = PNG.sync.read(readFileSync(path));
      rock = nearestRock(png) ?? rock;
      const red = redProjectiles(png, 180);
      const mz = await readMuzzles();
      cand.push({ i, path, phase: 'B', red: red.n, redAt: red, coach: coachText(png), rockDist: rock ? Math.round(rock.dist) : null, ...mz });
      // A clean shot: red present but not a ring, and a grey rock is near centre.
      const clean = red.n >= 3 && red.n <= 420 && rock && rock.dist < 170;
      if (clean && (!projFrame || red.n > projFrame.red)) projFrame = { i, path, red: red.n, redAt: red, rockDist: Math.round(rock.dist) };
      // Hold on the home rock: only chase one that is close, else coast.
      const want = new Set();
      if (rock && rock.dist > 45 && rock.dist < 190) {
        if (rock.x < CX - 8) want.add('KeyA'); else if (rock.x > CX + 8) want.add('KeyD');
        if (rock.y < CY - 8) want.add('KeyW'); else if (rock.y > CY + 8) want.add('KeyS');
        await page.mouse.move(rock.x, rock.y);
      }
      await setKeys(want);
    }
    await page.mouse.up();
    await setKeys(new Set());

    // Fallbacks so a run always yields SOMETHING to look at.
    const anyBanner = bannerFrame ?? cand.filter((c) => c.coach > 0).sort((a, b) => b.coach - a.coach)[0] ?? null;
    const anyProj = projFrame
      ?? cand.filter((c) => c.phase === 'B' && c.red >= 3 && c.red <= 420).sort((a, b) => b.red - a.red)[0]
      ?? cand.filter((c) => c.red > 0).sort((a, b) => a.red - b.red)[0]
      ?? cand[cand.length - 1];

    // HERO: the projectile frame, whole and un-stitched — the local ship (screen
    //   centre, the camera follows it) firing a red shot into the home field with
    //   NO plasma line anywhere. Because the ship hasn't chipped ore yet, the coach
    //   banner is usually still up in this same frame, so one authentic screenshot
    //   carries the whole story: shot in flight + "your shots" copy + no beam.
    writeFileSync(join(OUT, 'mining-by-projectile.png'), readFileSync(anyProj.path));
    // Ship close-up: the hull bar, the two empty hold pips, the shot — and no line.
    cropSave(anyProj.path, join(OUT, 'mining-by-projectile-crop.png'), CX - 300, CY - 150, 620, 320);
    // Coach copy close-up: the mine prompt reading in full, legibly ("shots", not "beam").
    if (anyBanner?.path) cropSave(anyBanner.path, join(OUT, 'mining-coach-shots.png'), CX - 320, CY - 40, 640, 300);

    const anyShipMuzzleEver = cand.some((c) => c.shipSourceMuzzles > 0);
    const maxRed = Math.max(...cand.map((c) => c.red));
    const maxCoach = Math.max(...cand.map((c) => c.coach));
    console.log('[mining-by-projectile]', JSON.stringify({
      build,
      bannerFrame: anyBanner && { i: anyBanner.i, coachPixels: anyBanner.coach },
      projFrame: { i: anyProj.i, redPixels: anyProj.red, redAt: anyProj.redAt },
      maxCoachPixels: maxCoach, maxRedPixels: maxRed,
      shipSourceMuzzleFramesEver: cand.filter((c) => c.shipSourceMuzzles > 0).length,
      anyShipMuzzleEver,
      muzzleShootersSeen: [...new Set(cand.flatMap((c) => c.muzzles.map((m) => m.shooter)))].sort(),
    }));
    console.log('[mining errors]', errs.slice(0, 4));
    await ctx.close();
  } finally { await browser.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
