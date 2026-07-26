import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4174';
const OUT = new URL('./images/', import.meta.url).pathname;
mkdirSync('/tmp/sp', { recursive: true });
const CX = 640, CY = 400;
function isGrey(r, g, b) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx > 110 && mx < 215 && (mx - mn) < 28 && Math.abs(r - g) < 22 && Math.abs(g - b) < 30; }
function isOre(r, g, b) { return r > 190 && g > 150 && b < 100; }
function nearestRock(png) {
  const { width, height, data } = png; let best = null, bestD = 1e18;
  for (let y = 120; y < 720; y += 2) for (let x = 40; x < 1040; x += 2) { const i = (y * width + x) * 4; if (!isGrey(data[i], data[i+1], data[i+2])) continue; const dx = x - CX, dy = y - CY, d = dx*dx+dy*dy; if (d < 400) continue; if (d < bestD) { bestD = d; best = { x, y }; } }
  if (!best) return null; let sx = 0, sy = 0, n = 0;
  for (let y = Math.max(0, best.y-55); y < Math.min(height, best.y+55); y += 2) for (let x = Math.max(0, best.x-55); x < Math.min(width, best.x+55); x += 2) { const i = (y*width+x)*4; if (isGrey(data[i], data[i+1], data[i+2])) { sx += x; sy += y; n++; } }
  return { x: sx/n, y: sy/n, dist: Math.sqrt(bestD), n };
}
// free ore chunk in an annulus 55..150 from centre (away from under-ship pips <45),
// reported with its distance from centre so we can prefer a well-separated one.
function freeChunk(png) {
  const { width, data } = png; let n = 0, sx = 0, sy = 0;
  for (let y = 160; y < 660; y++) for (let x = 140; x < 1000; x++) { const i = (y*width+x)*4; if (!isOre(data[i], data[i+1], data[i+2])) continue; const d = Math.hypot(x-CX, y-CY); if (d < 55 || d > 150) continue; n++; sx += x; sy += y; }
  return n ? { n, x: Math.round(sx/n), y: Math.round(sy/n), dist: Math.round(Math.hypot(sx/n-CX, sy/n-CY)) } : { n: 0 };
}
function crop(src, out, x, y, w, h) { const p = PNG.sync.read(readFileSync(src)); x = Math.max(0, Math.min(x, p.width-w)); y = Math.max(0, Math.min(y, p.height-h)); const o = new PNG({ width: w, height: h }); for (let j=0;j<h;j++) for (let i=0;i<w;i++){const si=((y+j)*p.width+(x+i))*4,di=(j*w+i)*4;o.data[di]=p.data[si];o.data[di+1]=p.data[si+1];o.data[di+2]=p.data[si+2];o.data[di+3]=255;} writeFileSync(out, PNG.sync.write(o)); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
await p.goto(BASE + '/?debug=1', { waitUntil: 'load' });
await p.waitForFunction(() => window.__planetRush?.viewport?.width > 0, undefined, { timeout: 25000 });
await p.waitForFunction(() => (window.__planetRush?.ticks ?? 0) >= 700, undefined, { timeout: 45000 });
await p.keyboard.press('KeyF');
const held = new Set();
const setKeys = async (want) => { for (const k of held) if (!want.has(k)) { await p.keyboard.up(k); held.delete(k); } for (const k of want) if (!held.has(k)) { await p.keyboard.down(k); held.add(k); } };
const readSt = () => p.evaluate(() => { const pr = window.__planetRush; const ro = window.__oreDepositStage?.readout?.() ?? null; const hold = window.__oreHudStage?.hold?.() ?? null; return { cargo: ro?.cargo ?? null, full: hold?.full ?? null, filled: hold?.filled ?? null, beam: pr.beams.filter((x) => x.shooter === 0).length }; });

// Phase 1: pin & fill to full.
let firing = false, rock = null, full = false;
for (let i = 0; i < 400 && !full; i++) {
  await p.screenshot({ path: '/tmp/sp/fill.png' });
  rock = nearestRock(PNG.sync.read(readFileSync('/tmp/sp/fill.png'))) ?? rock;
  const st = await readSt(); full = st.full;
  if (!firing) { await p.mouse.down(); firing = true; }
  const want = new Set();
  if (rock && !full) { if (rock.x < CX-10) want.add('KeyA'); else if (rock.x > CX+10) want.add('KeyD'); if (rock.y < CY-10) want.add('KeyW'); else if (rock.y > CY+10) want.add('KeyS'); }
  await setKeys(want);
  await p.waitForTimeout(40);
}
console.log('filled full=', full);
// Phase 2: full. Back OFF the rock to ~100px, chip a chunk, then hold still and
// capture — a full hold must leave the chunk sitting at the rock.
await p.mouse.up(); firing = false;
const best = { n: 0 };
const shots = [];
for (let i = 0; i < 70; i++) {
  const path = `/tmp/sp/s${String(i).padStart(2, '0')}.png`;
  await p.screenshot({ path });
  const png = PNG.sync.read(readFileSync(path));
  rock = nearestRock(png) ?? rock;
  const st = await readSt();
  const fc = freeChunk(png);
  shots.push({ i, path, cargo: st.cargo, full: st.full, beam: st.beam, rockDist: rock ? Math.round(rock.dist) : null, fc });
  // steer to hold the rock at ~100px off-centre, fire brief bursts to chip
  const want = new Set();
  if (rock) { const d = rock.dist;
    if (d < 90) { if (rock.x < CX) want.add('KeyD'); else want.add('KeyA'); if (rock.y < CY) want.add('KeyS'); else want.add('KeyW'); }
    else if (d > 125) { if (rock.x < CX) want.add('KeyA'); else want.add('KeyD'); if (rock.y < CY) want.add('KeyW'); else want.add('KeyS'); }
  }
  await setKeys(want);
  // fire in short bursts (chip) then release so the chunk is left, not shoved
  if (i % 6 < 3) { if (!firing) { await p.mouse.down(); firing = true; } }
  else { if (firing) { await p.mouse.up(); firing = false; } }
  // a good stay-put frame: full, a free chunk 70..140px out (at the rock), not firing
  if (st.full && fc.n >= 4 && fc.dist >= 70 && (i % 6 >= 3) && fc.n > best.n) Object.assign(best, { ...shots[shots.length-1] });
  await p.waitForTimeout(40);
}
if (firing) await p.mouse.up();
await setKeys(new Set());

if (best.n) {
  writeFileSync(OUT + 'tractor-full.png'.replace('images/', ''), readFileSync(best.path)); // (full frame overwrite handled below)
  crop(best.path, OUT + 'tractor-full-clean.png', CX - 200, CY - 150, 400, 300);
  console.log('BEST stay-put frame:', JSON.stringify({ i: best.i, cargo: best.cargo, full: best.full, beam: best.beam, rockDist: best.rockDist, freeChunk: best.fc }));
} else {
  console.log('no clean separated stay-put frame; candidates:');
}
for (const s of shots) if (s.full && s.fc.n) console.log(`s${String(s.i).padStart(2,'0')} cargo=${s.cargo} full=${s.full} beam=${s.beam} rockDist=${s.rockDist} freeChunk n=${s.fc.n} dist=${s.fc.dist} at=${s.fc.x},${s.fc.y}`);
console.log('errors', errs.slice(0, 4));
await b.close();
