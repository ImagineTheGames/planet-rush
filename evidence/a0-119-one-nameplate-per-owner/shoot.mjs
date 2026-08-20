/**
 * evidence/a0-119-one-nameplate-per-owner/shoot.mjs — take the specimens.
 * OWNER: UI Engineer (a0-119).
 *
 * Opens the bench (`two-plates.html`) on a dev server, waits for the ratified
 * faces and the six staged frames (two profiles × three stops), and writes one
 * PNG per frame plus a 5× nearest-neighbour crop of the band the two labels are
 * in — the magnification QA and the developer read `Rusty (EASY)` across `Rusty
 * (EASY)` at. Nothing is drawn over a specimen and nothing is annotated; the
 * crops are pixels from the frame above them, enlarged.
 *
 *   npx vite --port 4319 --strictPort &
 *   node evidence/a0-119-one-nameplate-per-owner/shoot.mjs before
 *   node evidence/a0-119-one-nameplate-per-owner/shoot.mjs after
 *
 * `before` / `after` is only the filename prefix: WHICH build is on the bench is
 * whatever is in the working tree, which is why the README says exactly how the
 * before-frames were produced.
 *
 * Lifted from a0-115's shoot.mjs next door and kept deliberately identical in
 * shape — same crop routine, same dpr, same readback-then-screenshot order — so
 * the two sets of specimens are comparable rather than merely adjacent.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'shots');
const PORT = process.env.PREVIEW_PORT ?? '4319';
const TAG = process.argv[2] ?? 'after';
const URL = `http://localhost:${PORT}/evidence/a0-119-one-nameplate-per-owner/two-plates.html`;

mkdirSync(OUT, { recursive: true });

/** `clip` out of `file`, enlarged 5× by pixel replication. Nearest neighbour on
 *  purpose: every pixel in the output is a pixel from the frame, repeated, so a
 *  reader is looking at the specimen and not at an interpolation of it. */
function crop5x(file, clip) {
  const src = PNG.sync.read(readFileSync(file));
  const w = Math.min(clip.width, src.width - clip.x);
  const h = Math.min(clip.height, src.height - clip.y);
  const out = new PNG({ width: w * 5, height: h * 5 });
  for (let y = 0; y < out.height; y++) {
    const sy = clip.y + Math.floor(y / 5);
    for (let x = 0; x < out.width; x++) {
      const sx = clip.x + Math.floor(x / 5);
      const si = (src.width * sy + sx) << 2;
      const di = (out.width * y + x) << 2;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3];
    }
  }
  return PNG.sync.write(out);
}

const browser = await chromium.launch();
// dpr 2, so an element screenshot is exactly the canvas's own backing store and
// a crop is device pixels rather than a resample of them.
const DPR = 2;
const page = await browser.newPage({ viewport: { width: 1400, height: 1400 }, deviceScaleFactor: DPR });
page.on('console', (m) => console.log('  [page]', m.text()));
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('body[data-ready="1"]', { timeout: 30_000 });

const readbacks = await page.evaluate(() => window.__a0119.readbacks());
writeFileSync(join(OUT, `${TAG}-readback.json`), JSON.stringify(readbacks, null, 2));

for (const rb of readbacks) {
  const id = `${rb.profile}-${rb.stop}`;
  const fig = page.locator(`figure[data-shot="${id}"] canvas`);
  await fig.screenshot({ path: join(OUT, `${TAG}-${id}.png`) });

  // The band both labels are in, 5× nearest-neighbour, cropped out of the frame
  // just written. Anchored on the STATION's row — the plate that survives the
  // fix — and tall enough to carry the ship's row above it, so the before and the
  // after are cut at the same rect and can be laid side by side (a0-118's rule
  // for a magnified detail).
  const pad = 10;
  const top = Math.min(rb.station.y, rb.ship.y) - 90;
  const left = Math.min(rb.station.x, rb.ship.x) - 90;
  const clip = {
    x: Math.max(0, Math.floor((left - pad) * DPR)),
    y: Math.max(0, Math.floor((top - pad) * DPR)),
    width: Math.round((Math.abs(rb.ship.x - rb.station.x) + 180 + pad * 2) * DPR),
    height: Math.round((Math.abs(rb.ship.y - rb.station.y) + 110 + pad * 2) * DPR),
  };
  writeFileSync(join(OUT, `${TAG}-${id}-crop5x.png`), crop5x(join(OUT, `${TAG}-${id}.png`), clip));
}

console.log(`${TAG}: ${readbacks.length} frames`);
for (const rb of readbacks) {
  console.log(
    `  ${rb.profile}/${rb.stop}: drawn=${rb.drawn.length}` +
      ` [${rb.drawn.map((d) => `${d.kind} ${d.left.toFixed(1)}..${d.right.toFixed(1)} @y${d.y.toFixed(1)}`).join(' | ') || 'none'}]` +
      `  withheld=[${rb.withheld.map((h) => `${h.kind}:${h.reason}`).join(' | ') || 'none'}]` +
      `  overlap=${rb.overlap ? `${rb.overlap.width.toFixed(1)}×${rb.overlap.height.toFixed(1)}` : 'none'}`,
  );
}
await browser.close();
