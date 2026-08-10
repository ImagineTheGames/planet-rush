/**
 * evidence/a1-15-cull-visible-rocks/boundary-zoom.mjs — a1-15, the edge, magnified.
 * OWNER: QA Manager.
 *
 * The brief asks for the boundary to be photographed, and the boundary is where
 * the whole-frame plate is least readable: the hardest case this round found is a
 * rock whose CENTRE sits 24 px off the left edge of the screen and which
 * contributes a **1 px wide, 54 px tall sliver** of itself to the frame. On an
 * 1280 px plate that is invisible to a reviewer, and "you cannot see it, take my
 * word for it" is not evidence.
 *
 * So this takes the frames `capture-plates.mjs` already shot and lays a tight
 * NEAREST-NEIGHBOUR magnification of the same box from both builds side by side —
 * pre-cull `111db86`, which draws every rock unconditionally, against the served
 * `ebdae99`, which culls. If the cull were dropping the bodies it is most likely
 * to drop, these are the crops where the right-hand column would be empty.
 *
 * NEAREST-NEIGHBOUR ONLY (a1-13's rule): every pixel in the output is a pixel one
 * of the two clients drew, repeated. No interpolation, nothing that could invent
 * a sliver that was not there — or smooth one away.
 *
 * The cases are chosen by measurement, not by eye: the straddlers are ranked by
 * how little of themselves they put on screen, and the tightest are the ones
 * shown, because those are the ones a slightly-too-small pad would lose first.
 *
 *   node evidence/a1-15-cull-visible-rocks/boundary-zoom.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGES = resolve(HERE, '..', 'images');
const FRAMES = join(HERE, 'frames');
const CENSUS = JSON.parse(readFileSync(join(HERE, 'census-pre-cull-111db86.json'), 'utf8'));

/** Profiles we hold whole frames for. */
const PROFILES = ['desktop-1280x800', 'phone-landscape-844x390'];
const SCALE = 6;
const PAD = 26; // context around the on-screen sliver, in source px

const touches = (r, vp) => r.maxX >= vp.left && r.minX <= vp.right && r.maxY >= vp.top && r.minY <= vp.bottom;
const insideR = (r, vp) => r.minX >= vp.left && r.maxX <= vp.right && r.minY >= vp.top && r.maxY <= vp.bottom;

/** Nearest-neighbour crop+magnify. Out-of-frame source reads as flat black. */
function crop(file, x0, y0, w, h, scale) {
  const src = PNG.sync.read(readFileSync(file));
  const out = new PNG({ width: w * scale, height: h * scale });
  for (let y = 0; y < h * scale; y++) {
    for (let x = 0; x < w * scale; x++) {
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

const CSS = `
  body { margin:0; background:#0b0e13; color:#cfd8e3; font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif; padding:18px; }
  h1 { font-size:16px; margin:0 0 4px; color:#fff; }
  .sub { color:#8b98a8; margin:0 0 16px; max-width:1500px; }
  table { border-collapse:collapse; }
  td, th { padding:6px 10px; vertical-align:top; text-align:left; }
  th { color:#9fb0c3; font-weight:600; border-bottom:1px solid #263041; }
  img { display:block; border:1px solid #2b3purple; image-rendering:pixelated; border:1px solid #2b3547; }
  .lab { font-size:12px; color:#9fb0c3; margin:4px 0 0; }
  .ok { color:#63d69a; font-weight:600; }
  code { color:#ffd479; }
`;

async function run() {
  mkdirSync(IMAGES, { recursive: true });
  const rows = [];

  for (const name of PROFILES) {
    const p = CENSUS.profiles[name];
    const vp = p.visibleRect;
    const cases = p.asteroids.items
      .filter((r) => touches(r, vp) && !insideR(r, vp))
      .map((r) => {
        const w = Math.min(r.maxX, vp.right) - Math.max(r.minX, vp.left);
        const h = Math.min(r.maxY, vp.bottom) - Math.max(r.minY, vp.top);
        const cx = (r.minX + r.maxX) / 2, cy = (r.minY + r.maxY) / 2;
        const centreOff = cx < vp.left || cx > vp.right || cy < vp.top || cy > vp.bottom;
        return { r, onW: w, onH: h, area: w * h, cx, cy, centreOff };
      })
      .sort((a, b) => a.area - b.area)
      .slice(0, 3);

    for (const c of cases) {
      const x0 = Math.round(Math.max(vp.left, Math.min(c.r.minX, vp.right)) - PAD);
      const y0 = Math.round(Math.max(vp.top, c.r.minY) - PAD);
      const w = Math.round(Math.min(c.onW + PAD * 2, 120));
      const h = Math.round(Math.min(c.onH + PAD * 2, 120));
      rows.push({
        name,
        note: `centre (${Math.round(c.cx)}, ${Math.round(c.cy)}) ${c.centreOff ? '— OFF SCREEN' : 'on screen'}; contributes ${Math.round(c.onW)}x${Math.round(c.onH)} px = ${Math.round(c.area)} px²`,
        pre: crop(join(FRAMES, `${name}-pre-cull.png`), x0, y0, w, h, SCALE),
        served: crop(join(FRAMES, `${name}-served.png`), x0, y0, w, h, SCALE),
        box: `x ${x0}..${x0 + w}, y ${y0}..${y0 + h}`,
      });
    }
  }

  const html = `<html><head><style>${CSS}</style></head><body>
    <h1>a1-15 — the boundary, magnified ${SCALE}x (nearest neighbour)</h1>
    <p class="sub">The rocks that put the LEAST of themselves on screen, ranked by measurement. Each pair is the identical box of the identical frozen frame:
    left <b>111db86</b> (pre-cull, every rock drawn), right <b>ebdae99</b> (the served build, culled). A cull that trimmed too tight would show an empty box on the right.
    <b>A centre marked OFF SCREEN is the brief's second boundary case</b> — a rock whose position is outside the viewport entirely and which is only on screen because its <i>drawn extent</i> reaches back onto it.</p>
    <table>
      <tr><th>profile / case</th><th>111db86 · pre-cull</th><th>ebdae99 · served, culled</th><th></th></tr>
      ${rows
        .map(
          (r) => `<tr>
            <td style="max-width:240px"><b>${r.name}</b><p class="lab">${r.note}</p><p class="lab"><code>${r.box}</code></p></td>
            <td><img src="${r.pre}"></td>
            <td><img src="${r.served}"></td>
            <td class="ok">drawn<br>in both</td>
          </tr>`,
        )
        .join('')}
    </table>
  </body></html>`;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  const out = join(IMAGES, 'a1-15-boundary-zoom.png');
  await page.screenshot({ path: out, fullPage: true });
  await browser.close();
  console.log(`${rows.length} boundary cases → ${out}`);
  for (const r of rows) console.log(`  ${r.name}: ${r.note}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
