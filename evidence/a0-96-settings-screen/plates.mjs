/**
 * evidence/a0-96-settings-screen/plates.mjs — compose the manifest's plates.
 * OWNER: QA Manager (a0-96).
 *
 * The frames in `shots/` are the specimens; a plate is several of them on one
 * page with a caption under each, so a reader can see the comparison the
 * attestation is describing without opening six files and holding them in their
 * head. Captions state what is VISIBLE in the frame above them and nothing else —
 * every one was written after looking at that frame.
 *
 * Nothing here is drawn over a specimen: the frames are placed at their own pixel
 * size (scaled down as a whole where a plate would otherwise be enormous), never
 * cropped or annotated. Crops that DO appear on a plate are produced by
 * `crops.mjs` and named as crops in their caption.
 *
 *   node evidence/a0-96-settings-screen/plates.mjs
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'shots');
const OUT = resolve(HERE, '../images');
const PLATES = JSON.parse(readFileSync(join(HERE, 'plates.json'), 'utf8'));

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function html(plate) {
  const blocks = plate.blocks
    .map((b) => {
      const src = `file://${join(SHOTS, b.img)}`;
      const width = b.scale ? ` style="width:${b.scale}"` : '';
      return `<figure><img src="${src}"${width}><figcaption>${esc(b.caption)}</figcaption></figure>`;
    })
    .join('\n');
  return `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;padding:28px;background:#0b0e14;color:#c9d3e0;
       font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;width:${plate.width}px}
  h1{font-size:18px;letter-spacing:.10em;margin:0 0 4px;color:#eef3fa;text-transform:uppercase}
  p.sub{margin:0 0 22px;color:#8b97a8}
  figure{margin:0 0 22px}
  img{display:block;width:100%;border:1px solid #223}
  figcaption{margin-top:7px;color:#9fb0c4;white-space:pre-wrap}
  </style><h1>${esc(plate.title)}</h1><p class="sub">${esc(plate.sub)}</p>${blocks}`;
}

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });
for (const plate of PLATES) {
  const page = await browser.newPage({ viewport: { width: plate.width + 56, height: 900 } });
  const file = join(HERE, `.plate-${plate.id}.html`);
  writeFileSync(file, html(plate));
  await page.goto(`file://${file}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: join(OUT, `${plate.id}.png`), fullPage: true });
  console.log(`${plate.id}.png`);
  rmSync(file); // the page is scaffolding for the screenshot, not evidence
  await page.close();
}
await browser.close();
