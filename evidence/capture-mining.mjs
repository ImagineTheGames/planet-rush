/**
 * evidence/capture-mining.mjs — p2-03b evidence: "mining is shooting, beam retired".
 * OWNER: QA Manager. Drives the LIVE build (?debug=1) through real input and the
 * ratified read-only seams, then dumps the numbers each attestation quotes. Every
 * pixel claim is written into the manifest AFTER looking at the PNG. No game code.
 *
 *  - mining-by-projectile — the local ship shoots an asteroid: projectiles (red
 *    dots) impact, ore chunks chip off. We ALSO read back __planetRush.beams to see
 *    whether a beam is still rendered while mining (the amendment says the beam is
 *    retired; the QA question is whether the RENDER retired it too).
 *  - tractor-rules-hold — GDD §2.3. AutoAim-pin the ship on a rock and fill the
 *    hold: with ROOM the chunks are tractored in (cargo climbs 0→cap); once FULL
 *    the chunks chip off and are left (cargo pinned at cap). Reads cargo/hold each
 *    frame off __oreDepositStage / __oreHudStage.
 *
 * Usage: node evidence/capture-mining.mjs [mining|tractor]
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
mkdirSync('/tmp/capmine', { recursive: true });

const LDLP = undefined; // launched via env in the shell

function isGrey(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx > 110 && mx < 215 && (mx - mn) < 28 && Math.abs(r - g) < 22 && Math.abs(g - b) < 30;
}
function isOre(r, g, b) { return r > 190 && g > 150 && b < 100; }
function isRed(r, g, b) { return r > 150 && g < 95 && b < 95; }

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
// red projectile pixels within the central arena (not HUD)
function redProjectiles(png) {
  const { width, data } = png; let n = 0, sx = 0, sy = 0;
  for (let y = 120; y < 700; y++) for (let x = 60; x < 1040; x++) {
    const i = (y * width + x) * 4;
    if (isRed(data[i], data[i + 1], data[i + 2])) { n++; sx += x; sy += y; }
  }
  return { n, x: n ? Math.round(sx / n) : null, y: n ? Math.round(sy / n) : null };
}
// ore pixels in an annulus around screen centre (free chunks at the rock, away
// from the under-ship hold pips which sit within ~50px of centre)
function oreRing(png, rmin, rmax) {
  const { width, data } = png; let n = 0, sx = 0, sy = 0;
  for (let y = 150; y < 680; y++) for (let x = 120; x < 1040; x++) {
    const i = (y * width + x) * 4;
    if (!isOre(data[i], data[i + 1], data[i + 2])) continue;
    const d = Math.hypot(x - CX, y - CY);
    if (d < rmin || d > rmax) continue;
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
function stitchH(paths, outPath, gap = 8, bg = [12, 14, 18]) {
  const imgs = paths.map((p) => PNG.sync.read(readFileSync(p)));
  const h = Math.max(...imgs.map((i) => i.height));
  const w = imgs.reduce((s, i) => s + i.width, 0) + gap * (imgs.length - 1);
  const out = new PNG({ width: w, height: h });
  for (let i = 0; i < out.data.length; i += 4) { out.data[i] = bg[0]; out.data[i + 1] = bg[1]; out.data[i + 2] = bg[2]; out.data[i + 3] = 255; }
  let ox = 0;
  for (const im of imgs) {
    for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
      const si = (y * im.width + x) * 4, di = (y * w + (ox + x)) * 4;
      out.data[di] = im.data[si]; out.data[di + 1] = im.data[si + 1]; out.data[di + 2] = im.data[si + 2]; out.data[di + 3] = 255;
    }
    ox += im.width + gap;
  }
  writeFileSync(outPath, PNG.sync.write(out));
}

const frames = (page, n = 2) => page.evaluate((k) => new Promise((r) => { let i = 0; const s = () => { i++; i >= k ? r() : requestAnimationFrame(s); }; requestAnimationFrame(s); }), n);
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

// ── mining-by-projectile ────────────────────────────────────────────────────
async function shotMining(browser) {
  const { ctx, page, errs } = await boot(browser);
  const build = await page.evaluate(() => window.__planetRush.build);
  // Manual mode (desktop default). Fly up-left into the home field and fire.
  await page.mouse.move(300, 320);
  await page.keyboard.down('KeyA'); await page.keyboard.down('KeyW');
  await page.mouse.down();
  const cand = [];
  for (let i = 0; i < 80; i++) {
    await page.waitForTimeout(45);
    await page.mouse.move(300, 320);
    const st = await page.evaluate(() => {
      const pr = window.__planetRush;
      return { beams: pr.beams, own: pr.beams.filter((b) => b.shooter === 0), sw: pr.shipWorld, ticks: pr.ticks };
    });
    const path = `/tmp/capmine/m${String(i).padStart(2, '0')}.png`;
    await page.screenshot({ path });
    const png = PNG.sync.read(readFileSync(path));
    const red = redProjectiles(png);
    cand.push({ i, path, ownBeam: st.own.length, own: st.own, red: red.n, redAt: red, beamsAll: st.beams });
  }
  await page.mouse.up(); await page.keyboard.up('KeyA').catch(()=>{}); await page.keyboard.up('KeyW').catch(()=>{});
  // Best frame: local ship has a mining beam AND a red projectile is in flight.
  const best = cand.filter((c) => c.ownBeam >= 1 && c.red > 0).sort((a, b) => b.red - a.red)[0]
    ?? cand.filter((c) => c.ownBeam >= 1).sort((a, b) => b.red - a.red)[0]
    ?? cand[0];
  writeFileSync(join(OUT, 'mining-by-projectile.png'), readFileSync(best.path));
  // Zoom crop around the local ship + its beam endpoint.
  const ob = best.own[0];
  cropSave(best.path, join(OUT, 'mining-by-projectile-crop.png'), CX - 200, CY - 140, 420, 300);
  console.log('[mining-by-projectile]', JSON.stringify({ build, frame: best.i, ownBeamCount: best.ownBeam, ownBeam: ob, redProjectilePixels: best.red, redAt: best.redAt, allBeamShooters: best.beamsAll.map((b)=>({shooter:b.shooter,source:b.source})) }));
  console.log('[mining errors]', errs.slice(0, 4));
  await ctx.close();
}

// ── tractor-rules-hold ──────────────────────────────────────────────────────
async function shotTractor(browser) {
  const { ctx, page, errs } = await boot(browser);
  const build = await page.evaluate(() => window.__planetRush.build);
  await page.keyboard.press('KeyF'); // AutoAim
  const held = new Set();
  const setKeys = async (want) => {
    for (const k of held) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  };
  const readSt = () => page.evaluate(() => {
    const pr = window.__planetRush;
    const ro = window.__oreDepositStage?.readout?.() ?? null;
    const hold = window.__oreHudStage?.hold?.() ?? null;
    return { cargo: ro?.cargo ?? null, hold, beam: pr.beams.filter((b) => b.shooter === 0).length };
  });

  let firing = false, fullAt = -1, rock = null;
  let roomFrame = null, fullFrame = null, capSlots = 2;
  const trace = [];
  for (let i = 0; i < 420; i++) {
    const path = `/tmp/capmine/t${String(i).padStart(3, '0')}.png`;
    await page.screenshot({ path });
    const png = PNG.sync.read(readFileSync(path));
    rock = nearestRock(png) ?? rock;
    const st = await readSt();
    if (st.hold?.slots) capSlots = st.hold.slots;
    const ring = oreRing(png, 70, 160);   // free chunks away from under-ship pips
    trace.push({ i, cargo: st.cargo, full: st.hold?.full ?? null, beam: st.beam, rockDist: rock ? Math.round(rock.dist) : null, ring: ring.n });
    const full = st.hold?.full;
    if (full && fullAt < 0) fullAt = i;
    if (!firing) { await page.mouse.down(); firing = true; }

    if (!full) {
      // pin against the rock to fill; grab a ROOM frame mid-fill with a chunk near ship
      const want = new Set();
      if (rock) {
        if (rock.x < CX - 10) want.add('KeyA'); else if (rock.x > CX + 10) want.add('KeyD');
        if (rock.y < CY - 10) want.add('KeyW'); else if (rock.y > CY + 10) want.add('KeyS');
      }
      await setKeys(want);
      if (st.cargo != null && st.cargo >= 0.4 && st.cargo < capSlots && !roomFrame) roomFrame = { i, path, ...st };
    } else {
      // FULL: back off a little so a freshly-chipped chunk is left visibly at the
      // rock, separated from the ship (isolates "not attracted" from the pips).
      const dt = i - fullAt;
      if (dt < 4) { if (!firing) { await page.mouse.down(); firing = true; } await setKeys(new Set()); }
      else if (dt < 16) {
        // hover ~110px off the rock, keep firing bursts to chip chunks
        if (!firing) { await page.mouse.down(); firing = true; }
        const want = new Set();
        if (rock) {
          const d = rock.dist;
          if (d < 100) { if (rock.x < CX) want.add('KeyD'); else want.add('KeyA'); if (rock.y < CY) want.add('KeyS'); else want.add('KeyW'); }
          else if (d > 140) { if (rock.x < CX) want.add('KeyA'); else want.add('KeyD'); if (rock.y < CY) want.add('KeyW'); else want.add('KeyS'); }
        }
        await setKeys(want);
        // best FULL frame: a free ore chunk in the ring (separated), ship full
        if (ring.n >= 3 && (!fullFrame || ring.n > fullFrame.ring)) fullFrame = { i, path, ring: ring.n, ...st, rockDist: rock ? Math.round(rock.dist) : null };
      } else { if (firing) { await page.mouse.up(); firing = false; } await setKeys(new Set()); break; }
    }
    await page.waitForTimeout(40);
  }
  if (firing) await page.mouse.up();
  await setKeys(new Set());

  // Fallbacks if a clean separated FULL frame never landed: use the first full frame.
  if (!roomFrame) roomFrame = { i: -1, path: null };
  if (!fullFrame) {
    const ff = trace.find((t) => t.full);
    const path = ff ? `/tmp/capmine/t${String(ff.i).padStart(3, '0')}.png` : null;
    fullFrame = ff ? { ...ff, path } : { path: null };
  }
  if (roomFrame.path) { cropSave(roomFrame.path, join(OUT, 'tractor-room.png'), CX - 190, CY - 150, 380, 300); }
  if (fullFrame.path) { cropSave(fullFrame.path, join(OUT, 'tractor-full.png'), CX - 190, CY - 150, 380, 300); }
  if (roomFrame.path && fullFrame.path) stitchH([join(OUT, 'tractor-room.png'), join(OUT, 'tractor-full.png')], join(OUT, 'tractor-rules-hold.png'));

  const maxCargo = Math.max(...trace.map((t) => t.cargo ?? 0));
  console.log('[tractor-rules-hold]', JSON.stringify({
    build, capSlots, maxCargo, fullAt,
    room: roomFrame && { i: roomFrame.i, cargo: roomFrame.cargo, full: roomFrame.hold?.full, filled: roomFrame.hold?.filled },
    full: fullFrame && { i: fullFrame.i, cargo: fullFrame.cargo, full: fullFrame.full ?? fullFrame.hold?.full, ring: fullFrame.ring, rockDist: fullFrame.rockDist },
    cargoTrace: trace.filter((t, k) => k % 4 === 0 || t.full).map((t) => ({ i: t.i, c: t.cargo, f: t.full, ring: t.ring, rd: t.rockDist })),
  }));
  console.log('[tractor errors]', errs.slice(0, 4));
  await ctx.close();
}

async function main() {
  const only = process.argv.slice(2);
  const browser = await chromium.launch();
  try {
    if (!only.length || only.includes('mining')) await shotMining(browser);
    if (!only.length || only.includes('tractor')) await shotTractor(browser);
  } finally { await browser.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
