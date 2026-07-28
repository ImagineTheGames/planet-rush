/**
 * evidence/capture-p11.mjs — the p11 evidence camera. OWNER: QA Manager.
 *
 * Five p11 gates: damage-fills-red, scarce-default, bot-resites, zero-means-dead,
 * shot-tier-colors. It shoots from TWO surfaces and says which for every frame:
 *
 *  - LIVE preview build (`npm run build && vite preview` on :4173, ?debug=1):
 *    zero-means-dead — the shipped client's real over-ship health bar, staged
 *    through the `__healthbarStage` seam. This is the shipped game, unmodified.
 *
 *  - RENDER HARNESS (evidence/harness/scene.html on the `vite dev` server, :5199):
 *    the other four. Each is a p11 state the shipped CLIENT cannot currently
 *    reach — the offline boot never threads `abundance` (so it always runs
 *    STANDARD; there is no in-app scarce/rich knob yet), no seam sets an enemy's
 *    Power tier or grants a home a shield, and bots are not exposed on window.
 *    The harness renders the REAL src modules (`createWorld`/`step`/bots brain +
 *    the real `Renderer`) so the p11 CODE's own output is on screen, and every
 *    caption number is read straight off the real World. See scene.js header.
 *
 * Nothing here asserts; it only fixes WHAT WAS ON SCREEN. The QA Manager LOOKS at
 * every PNG and attests in evidence/manifest.json.
 *
 * Run (in this sandbox):
 *   CHROME=~/.cache/ms-playwright/chromium-1148/chrome-linux/chrome \
 *   LD_LIBRARY_PATH=/tmp/pwlibs/root/usr/lib/x86_64-linux-gnu:/tmp/pwlibs/root/lib/x86_64-linux-gnu \
 *   node evidence/capture-p11.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const TMP = join(HERE, '.p11tmp');
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

const LIVE = process.env.EVIDENCE_LIVE_URL ?? 'http://localhost:4173';
const HARNESS = process.env.EVIDENCE_HARNESS_URL ?? 'http://localhost:5199/evidence/harness/scene.html';

// ---- tiny PNG toolbox (pngjs) --------------------------------------------
function readPng(p) {
  return PNG.sync.read(readFileSync(p));
}
/** Nearest-neighbour resize to a target height, keeping aspect. */
function resizeToH(src, targetH) {
  const scale = targetH / src.height;
  const w = Math.max(1, Math.round(src.width * scale));
  const out = new PNG({ width: w, height: targetH });
  for (let y = 0; y < targetH; y++) {
    const sy = Math.min(src.height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x / scale));
      const si = (sy * src.width + sx) * 4;
      const di = (y * w + x) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3];
    }
  }
  return out;
}
/** Stitch PNG files left→right at a common height, thin separators between. */
function stitchH(paths, outPath, { height = 560, sep = 6, bg = [13, 16, 21] } = {}) {
  const imgs = paths.map((p) => resizeToH(readPng(p), height));
  const totalW = imgs.reduce((s, im) => s + im.width, 0) + sep * (imgs.length - 1);
  const out = new PNG({ width: totalW, height });
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = bg[0];
    out.data[i + 1] = bg[1];
    out.data[i + 2] = bg[2];
    out.data[i + 3] = 255;
  }
  let ox = 0;
  for (const im of imgs) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < im.width; x++) {
        const si = (y * im.width + x) * 4;
        const di = (y * out.width + (ox + x)) * 4;
        out.data[di] = im.data[si];
        out.data[di + 1] = im.data[si + 1];
        out.data[di + 2] = im.data[si + 2];
        out.data[di + 3] = im.data[si + 3];
      }
    }
    ox += im.width + sep;
  }
  writeFileSync(outPath, PNG.sync.write(out));
}
/** Average colour of a small box on a PNG (for shot-tint attestation). */
function sampleHex(png, cx, cy, r = 3) {
  let R = 0, G = 0, B = 0, n = 0;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
      const i = (y * png.width + x) * 4;
      R += png.data[i]; G += png.data[i + 1]; B += png.data[i + 2]; n++;
    }
  }
  const h = (v) => Math.round(v / n).toString(16).padStart(2, '0');
  return '#' + h(R) + h(G) + h(B);
}

const tmp = (name) => join(TMP, name);
const collected = {};

async function withHarness(browser, { w, h, dpr }, fn) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`${HARNESS}?w=${w}&h=${h}&dpr=${dpr}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__qa?.ready === true, undefined, { timeout: 25_000 });
  const out = await fn(page);
  if (errs.length) console.log('  harness errors:', errs.slice(0, 4));
  await page.close();
  return out;
}

// ---- 1) scarce-default (harness) -----------------------------------------
async function scarceDefault(browser) {
  const stats = await withHarness(browser, { w: 1000, h: 1000, dpr: 2 }, async (page) => {
    const s = await page.evaluate(() => window.__qa.abundance('scarce'));
    await page.screenshot({ path: tmp('ab-scarce.png') });
    const r = await page.evaluate(() => window.__qa.abundance('rich'));
    await page.screenshot({ path: tmp('ab-rich.png') });
    return { scarce: s, rich: r };
  });
  stitchH([tmp('ab-scarce.png'), tmp('ab-rich.png')], join(OUT, 'p11-scarce-default.png'), { height: 900, sep: 8 });
  collected.scarceDefault = stats;
  console.log('scarce-default:', JSON.stringify(stats));
}

// ---- 2) damage-fills-red (harness) ---------------------------------------
async function damageFillsRed(browser) {
  const frames = [
    { label: 'FRAME 1 — healthy', args: [40, 40, 100] },
    { label: 'FRAME 2 — shield falling', args: [8, 40, 100] },
    { label: 'FRAME 3 — shield dead, core hit', args: [0, 40, 58] },
    { label: 'FRAME 4 — core deep red', args: [0, 40, 22] },
  ];
  const paths = [];
  const readouts = await withHarness(browser, { w: 760, h: 760, dpr: 2 }, async (page) => {
    const rs = [];
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const r = await page.evaluate(([a, lbl]) => window.__qa.siege(a[0], a[1], a[2], lbl), [f.args, f.label]);
      const p = tmp(`siege-${i}.png`);
      await page.screenshot({ path: p });
      paths.push(p);
      rs.push({ ...f, ...r });
    }
    return rs;
  });
  stitchH(paths, join(OUT, 'p11-damage-fills-red.png'), { height: 620, sep: 8 });
  collected.damageFillsRed = readouts;
  console.log('damage-fills-red:', JSON.stringify(readouts));
}

// ---- 3) shot-tier-colors (harness) ---------------------------------------
async function shotTierColors(browser) {
  const data = await withHarness(browser, { w: 1000, h: 1000, dpr: 2 }, async (page) => {
    const r = await page.evaluate(() => window.__qa.shots());
    await page.screenshot({ path: join(OUT, 'p11-shot-tier-colors.png') });
    return r;
  });
  // Sample the six shot centres off the PNG (CSS px × dpr).
  const png = readPng(join(OUT, 'p11-shot-tier-colors.png'));
  const sampled = {};
  for (const [id, c] of Object.entries(data.screenCenters)) {
    sampled[id] = sampleHex(png, c.x * data.dpr, c.y * data.dpr, 4);
  }
  collected.shotTierColors = { spec: data.ownColors && data, sampled, expected: data };
  console.log('shot-tier-colors expected own/enemy:', JSON.stringify({ own: data.ownColors, enemy: data.enemyColors }));
  console.log('shot-tier-colors sampled:', JSON.stringify(sampled));
}

// ---- 4) bot-resites (harness) --------------------------------------------
async function botResites(browser) {
  const checkpoints = [3, 90, 130, 130]; // steps between shots: t≈0.05, 1.55, 3.7, 5.9s
  const paths = [];
  const readouts = await withHarness(browser, { w: 900, h: 460, dpr: 2 }, async (page) => {
    const init = await page.evaluate(() => window.__qa.resiteInit());
    const rs = [{ init }];
    for (let i = 0; i < checkpoints.length; i++) {
      const r = await page.evaluate((n) => window.__qa.resiteStep(n), checkpoints[i]);
      const p = tmp(`rs-${i}.png`);
      await page.screenshot({ path: p });
      paths.push(p);
      rs.push(r);
    }
    return rs;
  });
  stitchH(paths, join(OUT, 'p11-bot-resites.png'), { height: 560, sep: 8 });
  collected.botResites = readouts;
  console.log('bot-resites:', JSON.stringify(readouts));
}

// ---- 5) zero-means-dead (LIVE shipped client) ----------------------------
async function zeroMeansDead(browser) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 2 });
  await page.goto(`${LIVE}/?debug=1&freeze=1`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__healthbarStage && window.__planetRush?.viewport?.width > 0,
    undefined,
    { timeout: 25_000 },
  );
  // Tiny fraction: enemy hull = 0.004 × maxHull → well under 1, but the readout
  // must show "1", never "0", and the bar must keep a visible sliver.
  const staged = await page.evaluate(() => window.__healthbarStage.damageEnemy(0.004));
  await page.waitForTimeout(700); // let a render frame draw the bar
  const bars = await page.evaluate(() => window.__healthbarStage.bars());
  await page.screenshot({ path: tmp('zmd-full.png') });
  const bar = bars.find((b) => !b.local) ?? bars[0];
  // A crisp zoom on the bar so "1/70" is legible.
  if (bar) {
    const cx = bar.x, cy = bar.y;
    await page.screenshot({
      path: tmp('zmd-zoom.png'),
      clip: { x: Math.max(0, cx - 90), y: Math.max(0, cy - 70), width: 200, height: 130 },
    });
    stitchH([tmp('zmd-full.png'), tmp('zmd-zoom.png')], join(OUT, 'p11-zero-means-dead.png'), { height: 560, sep: 8 });
  } else {
    await page.screenshot({ path: join(OUT, 'p11-zero-means-dead.png') });
  }
  const hpActual = staged ? +(staged.fraction * (bar ? Number(bar.hpText.split('/')[1]) : 70)).toFixed(3) : null;
  collected.zeroMeansDead = { staged, bar, hpActual };
  console.log('zero-means-dead:', JSON.stringify({ staged, bar, hpActual }));
  await page.close();
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME });
  const only = process.argv.slice(2);
  const run = (id) => only.length === 0 || only.includes(id);
  if (run('scarce-default')) await scarceDefault(browser);
  if (run('damage-fills-red')) await damageFillsRed(browser);
  if (run('shot-tier-colors')) await shotTierColors(browser);
  if (run('bot-resites')) await botResites(browser);
  if (run('zero-means-dead')) await zeroMeansDead(browser);
  await browser.close();
  writeFileSync(tmp('readbacks.json'), JSON.stringify(collected, null, 2));
  console.log('\nAll readbacks →', tmp('readbacks.json'));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
