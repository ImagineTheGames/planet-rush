/**
 * evidence/a0-116-arrow-clear-of-the-clock/shoot.mjs — take the specimens.
 * OWNER: UI Engineer (a0-116).
 *
 * Opens the bench (`arrow-clock.html`) on a dev server, waits for the ratified
 * faces and the four staged frames, and writes one PNG per frame plus a 4×
 * nearest-neighbour crop of the band the readout and the arrow share. Nothing is
 * drawn over a specimen and nothing is annotated; the crops are pixels from the
 * frame above them, enlarged.
 *
 *   npx vite --port 4316 --strictPort &
 *   node evidence/a0-116-arrow-clear-of-the-clock/shoot.mjs before
 *   node evidence/a0-116-arrow-clear-of-the-clock/shoot.mjs after
 *
 * `before` / `after` is only the filename prefix: WHICH build is on the bench is
 * whatever is in the working tree, which is why the README says exactly how the
 * before-frames were produced.
 *
 * The crop window is computed from the READOUT's rect alone — never from the
 * arrow's — so the before and the after crop the identical region of the screen
 * and the pair can be read as one comparison.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'shots');
const PORT = process.env.PREVIEW_PORT ?? '4316';
const TAG = process.argv[2] ?? 'after';
const URL = `http://localhost:${PORT}/evidence/a0-116-arrow-clear-of-the-clock/arrow-clock.html`;

mkdirSync(OUT, { recursive: true });

/** `clip` out of `file`, enlarged 4× by pixel replication. Nearest neighbour on
 *  purpose: every pixel in the output is a pixel from the frame, repeated, so a
 *  reader is looking at the specimen and not at an interpolation of it. */
function crop4x(file, clip) {
  const src = PNG.sync.read(readFileSync(file));
  const w = Math.min(clip.width, src.width - clip.x);
  const h = Math.min(clip.height, src.height - clip.y);
  const out = new PNG({ width: w * 4, height: h * 4 });
  for (let y = 0; y < out.height; y++) {
    const sy = clip.y + Math.floor(y / 4);
    for (let x = 0; x < out.width; x++) {
      const sx = clip.x + Math.floor(x / 4);
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
// dpr 2, the profiles a0-111 shot on — and it makes the element screenshot
// exactly the canvas's own backing store, so a crop is device pixels and not a
// resample of them.
const DPR = 2;
const page = await browser.newPage({ viewport: { width: 1400, height: 1400 }, deviceScaleFactor: DPR });
page.on('console', (m) => console.log('  [page]', m.text()));
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('body[data-ready="1"]', { timeout: 30_000 });

const readbacks = await page.evaluate(() => window.__a0116.readbacks());
writeFileSync(join(OUT, `${TAG}-readback.json`), JSON.stringify(readbacks, null, 2));

for (const rb of readbacks) {
  const id = `${rb.profile}-${rb.stop}`;
  const fig = page.locator(`figure[data-shot="${id}"] canvas`);
  await fig.screenshot({ path: join(OUT, `${TAG}-${id}.png`) });

  // The band the readout and the arrow share: the readout's own column, from the
  // top of the screen down past where a yielded arrow can land. From the READOUT
  // only, so before and after are the same window.
  const pad = 26;
  const clip = {
    x: Math.max(0, Math.floor((rb.readout.x - pad) * DPR)),
    y: 0,
    width: Math.round((rb.readout.width + pad * 2) * DPR),
    height: Math.round((rb.readout.y + rb.readout.height + 90) * DPR),
  };
  writeFileSync(join(OUT, `${TAG}-${id}-crop4x.png`), crop4x(join(OUT, `${TAG}-${id}.png`), clip));
}

console.log(`${TAG}: ${readbacks.length} frames`);
for (const rb of readbacks) {
  const a = rb.arrow;
  console.log(
    `  ${rb.profile}/${rb.stop}: bearing=${rb.bearingDeg.toFixed(1)}°` +
      `  arrow=${a ? `[${a.x.toFixed(1)},${a.y.toFixed(1)} ${a.width.toFixed(1)}×${a.height.toFixed(1)}]` : 'NOT DRAWN'}` +
      `  ${rb.readout.id}=[${rb.readout.x.toFixed(1)},${rb.readout.y.toFixed(1)} ${rb.readout.width.toFixed(1)}×${rb.readout.height.toFixed(1)}]` +
      `  air=${rb.air.toFixed(1)}px`,
  );
}
await browser.close();
