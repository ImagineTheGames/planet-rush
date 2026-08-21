/**
 * evidence/a0-125-the-corner-two-boxes-share/shoot.mjs — take the specimens.
 * OWNER: UI Engineer (a0-125).
 *
 * Opens the bench (`corner.html`) on a dev server, waits for the ratified faces
 * and the two staged frames, and writes one PNG per frame plus a 4× nearest-
 * neighbour crop of the top-right corner the two elements share. Nothing is drawn
 * over a specimen and nothing is annotated; the crops are pixels from the frame
 * above them, enlarged.
 *
 *   npx vite --port 4325 --strictPort &
 *   PREVIEW_PORT=4325 node evidence/a0-125-the-corner-two-boxes-share/shoot.mjs before
 *   PREVIEW_PORT=4325 node evidence/a0-125-the-corner-two-boxes-share/shoot.mjs after
 *
 * `before` / `after` is only the filename prefix: WHICH build is on the bench is
 * whatever is in the working tree, which is why the README says exactly how the
 * before-frames were produced.
 *
 * The crop window is computed from the BUTTON's rect alone — never from the
 * readout's, which is the thing that moves — so the before and the after crop the
 * identical region of the screen and the pair reads as one comparison. (a0-116
 * cropped from the readout for the same reason, one element over: crop from
 * whichever of the two is standing still.)
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'shots');
const PORT = process.env.PREVIEW_PORT ?? '4325';
const TAG = process.argv[2] ?? 'after';
const URL = `http://localhost:${PORT}/evidence/a0-125-the-corner-two-boxes-share/corner.html`;

mkdirSync(OUT, { recursive: true });

/** `clip` out of `file`, enlarged 4× by pixel replication. Nearest neighbour on
 *  purpose: every pixel in the output is a pixel from the frame, repeated, so a
 *  reader is looking at the specimen and not at an interpolation of it. */
function crop4x(file, clip) {
  const src = PNG.sync.read(readFileSync(file));
  const x0 = Math.max(0, clip.x);
  const y0 = Math.max(0, clip.y);
  const w = Math.min(clip.width, src.width - x0);
  const h = Math.min(clip.height, src.height - y0);
  const out = new PNG({ width: w * 4, height: h * 4 });
  for (let y = 0; y < out.height; y++) {
    const sy = y0 + Math.floor(y / 4);
    for (let x = 0; x < out.width; x++) {
      const sx = x0 + Math.floor(x / 4);
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
// dpr 2, the profile a0-111/a0-118/a0-122 all read their numbers on — and it
// makes the element screenshot exactly the canvas's own backing store, so a crop
// is device pixels rather than a resample of them.
const DPR = 2;
const page = await browser.newPage({ viewport: { width: 1200, height: 1200 }, deviceScaleFactor: DPR });
page.on('console', (m) => console.log('  [page]', m.text()));
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('body[data-ready="1"]', { timeout: 30_000 });

const readbacks = await page.evaluate(() => window.__a0125.readbacks());
writeFileSync(join(OUT, `${TAG}-readback.json`), JSON.stringify(readbacks, null, 2));

for (const rb of readbacks) {
  const id = `phone-${rb.stop}`;
  const fig = page.locator(`figure[data-shot="${id}"] canvas`);
  await fig.screenshot({ path: join(OUT, `${TAG}-${id}.png`) });

  // The corner both elements are in: from a little left of where the readout can
  // possibly start, out to the glass edge, and down past the button. Anchored on
  // the BUTTON, which does not move.
  const left = rb.affordance.x - 190;
  const clip = {
    x: Math.floor(left * DPR),
    y: 0,
    width: Math.round((rb.affordance.x + rb.affordance.width - left + 4) * DPR),
    height: Math.round((rb.affordance.y + rb.affordance.height + 22) * DPR),
  };
  writeFileSync(join(OUT, `${TAG}-${id}-crop4x.png`), crop4x(join(OUT, `${TAG}-${id}.png`), clip));
}

const r = (v) => v.toFixed(1);
const box = (b) => (b ? `[${r(b.x)},${r(b.y)} ${r(b.width)}×${r(b.height)}]` : 'NOT DRAWN');
console.log(`${TAG}: ${readbacks.length} frames`);
for (const rb of readbacks) {
  console.log(
    `  phone/${rb.stop}: fullscreen-reenter=${box(rb.affordance)}` +
      `  station-hp(ink)=${box(rb.stationInk)}` +
      `  covered=${(rb.fraction * 100).toFixed(0)}%` +
      `  air=${r(rb.air)}px` +
      `  arrow=${box(rb.arrow)}` +
      `  arrow∩button=${rb.arrowOverlap ? box(rb.arrowOverlap) : 'none'}`,
  );
}
await browser.close();
