/**
 * evidence/capture-teams.mjs — the p14 TEAMS evidence camera. OWNER: QA Manager.
 *
 * Renders the p14 TEAMS states the shipped CLIENT cannot reach through real input
 * (the offline boot does not thread team config — main.ts "Task C4"; online is not
 * live) by handing the REAL `createWorld`/`step`/`Renderer` a team-stamped roster
 * via evidence/harness/teams.js. Three frames, both form factors (desktop +
 * landscape phone):
 *   - teams-identity          — do teammates LOOK like a team?
 *   - teams-no-friendly-fire  — a shot flies through an ally, hits the enemy
 *   - teams-spawn-adjacency   — teammates spawn clustered, clusters equidistant
 *
 * Nothing here asserts; it fixes WHAT WAS ON SCREEN and the numbers read off the
 * real World. The QA Manager LOOKS at every PNG and attests in evidence/manifest.json.
 *
 * Run (in this sandbox):
 *   CHROME=~/.cache/ms-playwright/chromium-1148/chrome-linux/chrome \
 *   LD_LIBRARY_PATH=/tmp/pwlibs/root/usr/lib/x86_64-linux-gnu:/tmp/pwlibs/root/lib/x86_64-linux-gnu \
 *   node evidence/capture-teams.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const TMP = join(HERE, '.teamstmp');
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

const HARNESS = process.env.EVIDENCE_HARNESS_URL ?? 'http://localhost:5199/evidence/harness/teams.html';

const DESKTOP = { w: 1280, h: 800, dpr: 2, tag: 'desktop' };
const PHONE = { w: 844, h: 390, dpr: 3, tag: 'phone (landscape)' }; // the game is landscape-locked on phones

function readPng(p) {
  return PNG.sync.read(readFileSync(p));
}
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
function stitchH(paths, outPath, { height = 700, sep = 8, bg = [13, 16, 21] } = {}) {
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
    for (let y = 0; y < im.height; y++) {
      for (let x = 0; x < im.width; x++) {
        const si = (y * im.width + x) * 4;
        const di = (y * out.width + (ox + x)) * 4;
        out.data[di] = im.data[si];
        out.data[di + 1] = im.data[si + 1];
        out.data[di + 2] = im.data[si + 2];
        out.data[di + 3] = 255;
      }
    }
    ox += im.width + sep;
  }
  writeFileSync(outPath, PNG.sync.write(out));
}

const tmp = (name) => join(TMP, name);
const collected = {};

async function withHarness(browser, ff, fn) {
  const page = await browser.newPage({ viewport: { width: ff.w, height: ff.h }, deviceScaleFactor: ff.dpr });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errs.push('console: ' + m.text()));
  await page.goto(`${HARNESS}?w=${ff.w}&h=${ff.h}&dpr=${ff.dpr}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__qa?.ready === true, undefined, { timeout: 25_000 });
  const out = await fn(page);
  if (errs.length) console.log(`  [${ff.tag}] harness errors:`, errs.slice(0, 6));
  await page.close();
  return out;
}

async function identity(browser) {
  const paths = [];
  const data = {};
  for (const ff of [DESKTOP, PHONE]) {
    const r = await withHarness(browser, ff, async (page) => {
      const d = await page.evaluate(() => window.__qa.identity());
      const p = tmp(`identity-${ff.tag.split(' ')[0]}.png`);
      await page.screenshot({ path: p });
      paths.push(p);
      return d;
    });
    data[ff.tag] = r;
  }
  stitchH(paths, join(OUT, 'teams-identity.png'), { height: 780 });
  collected.identity = data;
  console.log('teams-identity:', JSON.stringify(data.desktop));
}

async function noFriendlyFire(browser) {
  const paths = [];
  const data = {};
  for (const ff of [DESKTOP, PHONE]) {
    const r = await withHarness(browser, ff, async (page) => {
      const freeze = await page.evaluate(() => window.__qa.noFfInit());
      const pf = tmp(`noff-freeze-${ff.tag.split(' ')[0]}.png`);
      await page.screenshot({ path: pf });
      const resolve = await page.evaluate(() => window.__qa.noFfResolve());
      const pr = tmp(`noff-resolve-${ff.tag.split(' ')[0]}.png`);
      await page.screenshot({ path: pr });
      if (ff === DESKTOP) paths.push(pf, pr);
      else paths.push(pr);
      return { freeze, resolve };
    });
    data[ff.tag] = r;
  }
  stitchH(paths, join(OUT, 'teams-no-friendly-fire.png'), { height: 640 });
  collected.noFriendlyFire = data;
  console.log('teams-no-friendly-fire:', JSON.stringify(data));
}

async function spawnAdjacency(browser) {
  const paths = [];
  const data = {};
  for (const ff of [DESKTOP, PHONE]) {
    const r = await withHarness(browser, ff, async (page) => {
      const d = await page.evaluate(() => window.__qa.spawnAdjacency());
      const p = tmp(`spawn-${ff.tag.split(' ')[0]}.png`);
      await page.screenshot({ path: p });
      paths.push(p);
      return d;
    });
    data[ff.tag] = r;
  }
  stitchH(paths, join(OUT, 'teams-spawn-adjacency.png'), { height: 780 });
  collected.spawnAdjacency = data;
  console.log('teams-spawn-adjacency:', JSON.stringify(data.desktop));
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME });
  const only = process.argv.slice(2);
  const run = (id) => only.length === 0 || only.includes(id);
  if (run('identity')) await identity(browser);
  if (run('no-friendly-fire')) await noFriendlyFire(browser);
  if (run('spawn-adjacency')) await spawnAdjacency(browser);
  await browser.close();
  writeFileSync(join(TMP, 'collected.json'), JSON.stringify(collected, null, 2));
  console.log('\nDONE. Readouts in', join(TMP, 'collected.json'));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
