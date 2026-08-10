/**
 * evidence/a1-15-cull-visible-rocks/chunk-zoom.mjs — a1-15, the ore chunk, magnified.
 * OWNER: QA Manager.
 *
 * An ore chunk is a 12 px signal-yellow disc. On a 1280x800 plate it is a speck,
 * and "the served build drew a chunk, take my word for it" is not evidence. This
 * crops the exact rectangle `mine-chunks.json` recorded for the drawn chunk out of
 * both builds' mining frames and magnifies it 8x, nearest-neighbour, so the disc
 * can be seen in both columns — the served build's culled frame included.
 *
 * The two crops are NOT at the same coordinates, and that is the finding rather
 * than a mistake: the builds are ~1 sim tick apart (their HUD MATCH clocks say
 * so), so the same drifting chunk sits ~7 px further along in one of them. Each
 * crop is centred on that build's OWN recorded rect, and the offset is printed.
 *
 *   node evidence/a1-15-cull-visible-rocks/chunk-zoom.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGES = resolve(HERE, '..', 'images');
const FRAMES = join(HERE, 'frames');
const J = JSON.parse(readFileSync(join(HERE, 'mine-chunks.json'), 'utf8'));
const V = JSON.parse(readFileSync(join(HERE, 'chunk-verdict.json'), 'utf8'));
const SCALE = 8;
const BOX = 56;

const drawnOnly = (items) => items.filter((c) => c.visible && c.renderable && c.alpha > 0);

function crop(file, cx, cy, box, scale) {
  const src = PNG.sync.read(readFileSync(file));
  const out = new PNG({ width: box * scale, height: box * scale });
  const x0 = Math.round(cx - box / 2), y0 = Math.round(cy - box / 2);
  for (let y = 0; y < box * scale; y++) {
    for (let x = 0; x < box * scale; x++) {
      const sx = x0 + Math.floor(x / scale), sy = y0 + Math.floor(y / scale);
      const di = (y * out.width + x) * 4;
      out.data[di + 3] = 255;
      if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue;
      const si = (sy * src.width + sx) * 4;
      out.data[di] = src.data[si]; out.data[di + 1] = src.data[si + 1]; out.data[di + 2] = src.data[si + 2];
    }
  }
  return 'data:image/png;base64,' + PNG.sync.write(out).toString('base64');
}

const s = J.samples[0];
const pre = drawnOnly(s.rawPre).filter((c) => c.minY < 800 && c.maxY > 0 && c.minX < 1280 && c.maxX > 0)[0];
const served = drawnOnly(s.rawServed)[0];
if (!pre || !served) throw new Error('no drawn on-screen chunk in sample 0');

const mid = (r) => ({ x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 });
const offset = Math.round(Math.hypot(mid(pre).x - mid(served).x, mid(pre).y - mid(served).y) * 10) / 10;

const CSS = `
  body { margin:0; background:#0b0e13; color:#cfd8e3; font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif; padding:18px; }
  h1 { font-size:16px; margin:0 0 4px; color:#fff; }
  .sub { color:#8b98a8; margin:0 0 16px; max-width:1100px; }
  .row { display:flex; gap:18px; }
  img { display:block; border:1px solid #2b3547; image-rendering:pixelated; }
  .cap { font-size:12px; color:#9fb0c3; margin:6px 0 0; max-width:460px; }
  b { color:#fff; } .ok { color:#63d69a; }
`;

const html = `<html><head><style>${CSS}</style></head><body>
  <h1>a1-15 — an ore chunk, drawn by the culled build (8x, nearest neighbour)</h1>
  <p class="sub">A played match, MATCH 0:04, desktop 1280x800. The 12 px signal-yellow disc is an ore chunk chipped off a rock.
  Each crop is centred on that build's OWN recorded rect, because the two builds are about one sim tick apart — their HUD MATCH clocks say so —
  so the same drifting chunk sits <b>${offset} px</b> further along in one of them. That drift is why this round matches chunks with a tolerance
  and not by exact position, and why it reports the chunk result as suggestive rather than settled.</p>
  <div class="row">
    <div>
      <img src="${crop(join(FRAMES, 'mining-pre-cull.png'), mid(pre).x, mid(pre).y, BOX, SCALE)}">
      <p class="cap"><b>111db86 · pre-cull</b>, nothing culled. Chunk drawn at screen (${pre.minX.toFixed(1)}, ${pre.minY.toFixed(1)})&ndash;(${pre.maxX.toFixed(1)}, ${pre.maxY.toFixed(1)}).</p>
    </div>
    <div>
      <img src="${crop(join(FRAMES, 'mining-served.png'), mid(served).x, mid(served).y, BOX, SCALE)}">
      <p class="cap"><b>ebdae99 · served, culled.</b> Chunk drawn at (${served.minX.toFixed(1)}, ${served.minY.toFixed(1)})&ndash;(${served.maxX.toFixed(1)}, ${served.maxY.toFixed(1)}).
      <span class="ok">The cull did not take it.</span></p>
    </div>
  </div>
  <p class="cap" style="max-width:1100px;margin-top:14px">Across the ${V.comparableSamples} of ${V.totalSamples} samples where both builds' MATCH clocks agree:
  <b>${V.onScreen}</b> on-screen chunk instances drawn by the pre-cull build, <b>${V.matched}</b> of them drawn by the served build too, <b>${V.missing}</b> missing;
  and <b>${V.offScreen}</b> off-screen chunks drawn by the pre-cull build, of which the served build drew <b>${V.offScreenWronglyDrawn}</b> &mdash; which is the cull's whole job.
  Two on-screen instances is a thin sample and this round says so rather than rounding it up to a clearance.</p>
</body></html>`;

mkdirSync(IMAGES, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'load' });
await page.waitForTimeout(250);
const out = join(IMAGES, 'a1-15-ore-chunk-drawn.png');
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(`offset ${offset} px → ${out}`);
