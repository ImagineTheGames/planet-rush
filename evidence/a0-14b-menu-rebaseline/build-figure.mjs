/**
 * evidence/a0-14b-menu-rebaseline/build-figure.mjs — the before/after figure. a0-14b.
 *
 * The claim this figure has to carry is narrow and visual: **four doors where
 * there were three, and nothing else moved.** So the two frames go side by side
 * at full size — same scene, same viewport, no crop and no zoom — once for the
 * landscape phone and once for the same phone held PORTRAIT under the landscape
 * lock, which is a genuinely different layout path (the whole game root rotates)
 * and therefore its own baseline.
 *
 * Both sides of each pair are `goldens.spec.ts` BASELINES of the same test:
 * BEFORE is the committed baseline as it stood before this branch re-shot it,
 * AFTER is the one this branch wrote. Using the golden itself for both sides
 * means the same machinery on the same machine produced both frames, so every
 * difference in the picture is a difference in what the menu draws — not a
 * difference in how it was captured.
 *
 * Chromium is only doing layout and captions here — nothing is re-rendered.
 *
 * The eye is not the proof, though; it is the summary. The measurement is
 * `band-compare.txt` (see `./band-compare.mjs`), which walks the two PNGs row by
 * row and shows the header band is byte-identical.
 *
 *   node evidence/a0-14b-menu-rebaseline/build-figure.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const dir = fileURLToPath(new URL('./', import.meta.url));
const b64 = (name) => readFileSync(dir + name).toString('base64');

const STYLE = `
  :root { color-scheme: dark; }
  body { margin: 0; background: #0b0d11; font: 13px/1.4 "Liberation Mono", monospace; color: #c8d2dd; }
  .row { display: flex; gap: 24px; padding: 24px; align-items: flex-start; }
  figure { margin: 0; }
  figcaption { padding: 10px 2px 0; }
  .tag { font-size: 15px; letter-spacing: .12em; color: #eef3f8; }
  .sub { color: #7f8b99; }
  img { display: block; border: 1px solid #2a323d; image-rendering: pixelated; }
`;

/** One figure: two frames of the same test, before and after, at native size. */
async function figure(browser, { out, before, after, w, h, beforeSub, afterSub, pageW, pageH }) {
  const html =
    `<!doctype html><meta charset="utf-8"><style>${STYLE}
     img { width: ${w}px; height: ${h}px; }</style>
     <div class="row">
       <figure>
         <img src="data:image/png;base64,${b64(before)}">
         <figcaption>
           <div class="tag">BEFORE — three doors</div>
           <div class="sub">${beforeSub}</div>
         </figcaption>
       </figure>
       <figure>
         <img src="data:image/png;base64,${b64(after)}">
         <figcaption>
           <div class="tag">AFTER — a0-14, four doors</div>
           <div class="sub">${afterSub}</div>
         </figcaption>
       </figure>
     </div>`;

  const page = await browser.newPage({
    viewport: { width: pageW, height: pageH },
    deviceScaleFactor: 2,
  });
  await page.setContent(html);
  await page.waitForLoadState('networkidle');
  writeFileSync(dir + out, await page.locator('.row').screenshot());
  await page.close();
  console.log(`wrote ${out}`);
}

const browser = await chromium.launch();

await figure(browser, {
  out: 'before-after-390-landscape.png',
  before: 'before-390-landscape.png',
  after: 'after-390-landscape.png',
  w: 844,
  h: 390,
  pageW: 1780,
  pageH: 470,
  beforeSub: 'PLAY · CODEX · SETTINGS',
  afterSub: 'PLAY · CODEX · SETTINGS · HANGAR',
});

await figure(browser, {
  out: 'before-after-390-portrait.png',
  before: 'before-390-portrait.png',
  after: 'after-390-portrait.png',
  w: 390,
  h: 844,
  pageW: 872,
  pageH: 924,
  beforeSub: 'portrait-held, under the landscape lock',
  afterSub: 'portrait-held, under the landscape lock',
});

await browser.close();
