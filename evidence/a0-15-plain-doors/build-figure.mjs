/**
 * evidence/a0-15-plain-doors/build-figure.mjs — the before/after figure. a0-15.
 *
 * The developer's complaint is about reading the entry screen AT A GLANCE, so
 * the frame is the argument: the two states side by side, same scene, same
 * viewport, no crop and no zoom.
 *
 * Both inputs are `goldens.spec.ts` baselines of `phone-landscape-doors` — the
 * iphone project rotated to landscape, i.e. a 390px-tall phone held the way the
 * game locks it (844×390 logical). BEFORE is that baseline as it stands on
 * `origin/main`; AFTER is the one this branch re-shot. Using the golden for both
 * sides means the two frames were produced by the same machinery on the same
 * machine, so every difference in the picture is a difference in the copy.
 *
 * Chromium is only doing layout and captions here — nothing is re-rendered.
 *
 *   node evidence/a0-15-plain-doors/build-figure.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const dir = fileURLToPath(new URL('./', import.meta.url));
const b64 = (name) => readFileSync(dir + name).toString('base64');

const html = `<!doctype html><meta charset="utf-8"><style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0b0d11; font: 13px/1.4 "Liberation Mono", monospace; color: #c8d2dd; }
  .row { display: flex; gap: 24px; padding: 24px; }
  figure { margin: 0; }
  figcaption { padding: 10px 2px 0; }
  .tag { font-size: 15px; letter-spacing: .12em; color: #eef3f8; }
  .sub { color: #7f8b99; }
  img { display: block; border: 1px solid #2a323d; width: 844px; height: 390px; image-rendering: pixelated; }
</style>
<div class="row">
  <figure>
    <img src="data:image/png;base64,${b64('before-390-landscape.png')}">
    <figcaption>
      <div class="tag">BEFORE — origin/main</div>
      <div class="sub">CAMPAIGN · SOLO CONTRACT · OPEN A CLAIM · JOIN A CLAIM</div>
    </figcaption>
  </figure>
  <figure>
    <img src="data:image/png;base64,${b64('after-390-landscape.png')}">
    <figcaption>
      <div class="tag">AFTER — a0-15</div>
      <div class="sub">CAMPAIGN · SOLO · HOST · JOIN</div>
    </figcaption>
  </figure>
</div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1780, height: 470 }, deviceScaleFactor: 2 });
await page.setContent(html);
await page.waitForLoadState('networkidle');
const shot = await page.locator('.row').screenshot();
writeFileSync(dir + 'before-after-390-landscape.png', shot);
await browser.close();
console.log('wrote before-after-390-landscape.png');
