/**
 * evidence/a0-115-nothing-lands-in-the-counter/shoot.mjs — take the specimens.
 * OWNER: UI Engineer (a0-115).
 *
 * Opens the bench (`counter-plate.html`) on a dev server, waits for the ratified
 * faces and the four staged frames, and writes one PNG per frame plus a 5×
 * nearest-neighbour crop of each counter's own rect — the magnification QA read
 * `Rusty` across `ORE` at. Nothing is drawn over a specimen and nothing is
 * annotated; the crops are pixels from the frame above them, enlarged.
 *
 *   npx vite --port 4315 --strictPort &
 *   node evidence/a0-115-nothing-lands-in-the-counter/shoot.mjs before
 *   node evidence/a0-115-nothing-lands-in-the-counter/shoot.mjs after
 *
 * `before` / `after` is only the filename prefix: WHICH build is on the bench is
 * whatever is in the working tree, which is why the README says exactly how the
 * before-frames were produced.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'shots');
const PORT = process.env.PREVIEW_PORT ?? '4315';
const TAG = process.argv[2] ?? 'after';
const URL = `http://localhost:${PORT}/evidence/a0-115-nothing-lands-in-the-counter/counter-plate.html`;

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
// dpr 2, the profiles a0-111 shot on — and it makes the element screenshot
// exactly the canvas's own backing store, so a crop is device pixels and not a
// resample of them.
const DPR = 2;
const page = await browser.newPage({ viewport: { width: 1400, height: 1400 }, deviceScaleFactor: DPR });
page.on('console', (m) => console.log('  [page]', m.text()));
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('body[data-ready="1"]', { timeout: 30_000 });

const readbacks = await page.evaluate(() => window.__a0115.readbacks());
writeFileSync(join(OUT, `${TAG}-readback.json`), JSON.stringify(readbacks, null, 2));

for (const rb of readbacks) {
  const id = `${rb.profile}-${rb.stop}`;
  const fig = page.locator(`figure[data-shot="${id}"] canvas`);
  await fig.screenshot({ path: join(OUT, `${TAG}-${id}.png`) });

  // The counter's own rect, 5× nearest-neighbour, cropped out of the frame that
  // was just written — device pixels enlarged, no filtering and no annotation.
  // Done here rather than with a canvas `drawImage` in the page: the WebGL
  // drawing buffer is gone by the time script runs, and a crop of an empty buffer
  // is a black rectangle that looks like a finding.
  const pad = 8;
  const clip = {
    x: Math.max(0, Math.floor((rb.counter.x - pad) * DPR)),
    y: Math.max(0, Math.floor((rb.counter.y - pad) * DPR)),
    // Wide enough to carry the counter, the air past it, and wherever the plate
    // ended up — the point of the crop is the relationship between the two.
    width: Math.round((rb.counter.width + pad * 2 + 130) * DPR),
    height: Math.round((rb.counter.height + pad * 2) * DPR),
  };
  writeFileSync(join(OUT, `${TAG}-${id}-crop5x.png`), crop5x(join(OUT, `${TAG}-${id}.png`), clip));
}

console.log(`${TAG}: ${readbacks.length} frames`);
for (const rb of readbacks) {
  console.log(
    `  ${rb.profile}/${rb.stop}: drawn=${rb.drawn ? `${rb.drawn.text} [${rb.drawn.left.toFixed(1)}..${rb.drawn.right.toFixed(1)}]` : 'none'}` +
      `  withheld=${rb.withheld ? `${rb.withheld.text} (${rb.withheld.reason})` : 'none'}` +
      `  counter=[${rb.counter.x.toFixed(1)}..${(rb.counter.x + rb.counter.width).toFixed(1)}]`,
  );
}
await browser.close();
