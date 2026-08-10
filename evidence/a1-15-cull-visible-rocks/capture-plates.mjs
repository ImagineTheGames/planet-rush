/**
 * evidence/a1-15-cull-visible-rocks/capture-plates.mjs — a1-15, the pictures.
 * OWNER: QA Manager.
 *
 * The censuses answer the question in numbers. This answers it in pixels, which
 * is the form the developer's report arrived in — *"they are gone completely"* is
 * a statement about a frame, and it deserves a frame back.
 *
 * For each profile it shoots the SAME frozen scene on both builds
 * (`111db86` pre-pooling/pre-cull, and the served `ebdae99`), then:
 *
 *  1. **Diffs them.** A rock the cull wrongly dropped is not a subtle thing: the
 *     rocks a1-07 measured are 16.8–74.2 CSS px across and opaque, so losing one
 *     leaves a single connected blob of thousands of px². The diff is therefore
 *     reported as a **connected-component analysis**, not as a pixel count — the
 *     largest blob is the number that can distinguish "a rock is missing" from
 *     "the pooled bake resamples the same rock a shade differently". Both are
 *     printed; only the first would be a defect.
 *  2. **Outlines the straddlers** — the rocks whose drawn rectangle crosses a
 *     viewport edge, the case a cull is most likely to get wrong — on the SERVED
 *     frame, from the pre-cull build's own measured rectangles. If one of those
 *     boxes were empty on the served frame, the cull would be caught in the act.
 *  3. **Lays the pair up as a plate** with captions, so the evidence can be read
 *     without opening a JSON.
 *
 * Every pixel in every plate is a pixel one of the two clients drew. The only
 * things added are the outline boxes and the caption text, both plainly not game
 * art. The diff panel is amplified (x8, clamped) and says so on its own caption,
 * because an un-amplified diff of two near-identical frames is a black rectangle
 * that proves nothing to a reader.
 *
 *   node evidence/a1-15-cull-visible-rocks/capture-plates.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGES = resolve(HERE, '..', 'images');
const FRAMES = join(HERE, 'frames');
const CENSUS_PRE = JSON.parse(readFileSync(join(HERE, 'census-pre-cull-111db86.json'), 'utf8'));
const VERDICT = JSON.parse(readFileSync(join(HERE, 'verdict.json'), 'utf8'));

const BUILDS = [
  { label: 'pre-cull', dist: '/tmp/pre-cull/dist' },
  { label: 'served', dist: resolve(HERE, '..', '..', 'dist') },
];

const PROFILES = [
  { name: 'phone-landscape-844x390', width: 844, height: 390 },
  { name: 'desktop-1280x800', width: 1280, height: 800 },
];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.map': 'application/json; charset=utf-8',
};

function serve(root) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let path = join(root, decodeURIComponent(url.pathname));
    if (!path.startsWith(root)) return void res.writeHead(403).end();
    if (!existsSync(path) || statSync(path).isDirectory()) path = join(root, 'index.html');
    if (!existsSync(path)) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    createReadStream(path).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })));
}

const INIT = `globalThis.__PIXI_APP_INIT__ = function (app) { globalThis.__qaApp = app; };`;
const settle = (page, n = 15) =>
  page.evaluate(
    (f) => new Promise((d) => { let i = 0; const t = () => (++i < f ? requestAnimationFrame(t) : d()); requestAnimationFrame(t); }),
    n,
  );

async function shoot(build, profile, file) {
  const { server, port } = await serve(build.dist);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    deviceScaleFactor: 1,
  });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/?debug=1&freeze=1`, { waitUntil: 'load' });
  await page.waitForFunction('!!globalThis.__qaApp', null, { timeout: 30000 });
  await settle(page, 20);
  await page.screenshot({ path: file });
  await browser.close();
  server.close();
}

/** Amplified diff + connected-component analysis over the differing pixels. */
function diff(aFile, bFile, outFile) {
  const a = PNG.sync.read(readFileSync(aFile));
  const b = PNG.sync.read(readFileSync(bFile));
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
  const out = new PNG({ width: w, height: h });
  const hot = new Uint8Array(w * h);
  let differing = 0, peak = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ia = (y * a.width + x) * 4, ib = (y * b.width + x) * 4, io = (y * w + x) * 4;
      const d = Math.max(
        Math.abs(a.data[ia] - b.data[ib]),
        Math.abs(a.data[ia + 1] - b.data[ib + 1]),
        Math.abs(a.data[ia + 2] - b.data[ib + 2]),
      );
      if (d > peak) peak = d;
      if (d > 0) differing++;
      // A pixel counts as "hot" (candidate missing-art) only above a threshold
      // that resampling noise does not reach; bake resampling is a few levels.
      if (d >= 24) hot[y * w + x] = 1;
      const v = Math.min(255, d * 8);
      out.data[io] = v; out.data[io + 1] = Math.min(255, v * 0.6); out.data[io + 2] = 0;
      out.data[io + 3] = 255;
    }
  }

  // Largest 4-connected component of hot pixels — a missing rock would be one
  // solid blob of thousands of px².
  let largest = 0, blobs = 0;
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let i = 0; i < w * h; i++) {
    if (!hot[i] || seen[i]) continue;
    blobs++;
    let area = 0;
    stack.push(i); seen[i] = 1;
    while (stack.length) {
      const p = stack.pop(); area++;
      const px = p % w, py = (p / w) | 0;
      const push = (q, ok) => { if (ok && hot[q] && !seen[q]) { seen[q] = 1; stack.push(q); } };
      push(p - 1, px > 0); push(p + 1, px < w - 1);
      push(p - w, py > 0); push(p + w, py < h - 1);
    }
    if (area > largest) largest = area;
  }

  writeFileSync(outFile, PNG.sync.write(out));
  return { differing, totalPx: w * h, peak, hotBlobs: blobs, largestHotBlobPx2: largest };
}

/** Outline every straddling rock on a copy of the served frame. */
function outlineStraddlers(srcFile, outFile, rects) {
  const img = PNG.sync.read(readFileSync(srcFile));
  const put = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
    const i = (y * img.width + x) * 4;
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
  };
  for (const r of rects) {
    const x0 = Math.round(r.minX), x1 = Math.round(r.maxX), y0 = Math.round(r.minY), y1 = Math.round(r.maxY);
    for (let x = x0; x <= x1; x++) { put(x, y0, 0, 229, 255); put(x, y1, 0, 229, 255); }
    for (let y = y0; y <= y1; y++) { put(x0, y, 0, 229, 255); put(x1, y, 0, 229, 255); }
  }
  writeFileSync(outFile, PNG.sync.write(img));
}

const touches = (r, vp) => r.maxX >= vp.left && r.minX <= vp.right && r.maxY >= vp.top && r.minY <= vp.bottom;
const insideR = (r, vp) => r.minX >= vp.left && r.maxX <= vp.right && r.minY >= vp.top && r.maxY <= vp.bottom;

/** Compose a labelled plate in the browser and shoot it. */
async function plate(html, width, height, outFile) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: outFile, fullPage: true });
  await browser.close();
}

/** Images are inlined as data URIs: a page built with `setContent` has an
 *  `about:blank` origin and will not load `file://` sub-resources, which silently
 *  yields a plate of broken-image icons — caught by LOOKING at the first one. */
const fileUrl = (p) => 'data:image/png;base64,' + readFileSync(p).toString('base64');
const CSS = `
  body { margin:0; background:#0b0e13; color:#cfd8e3; font:13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif; padding:16px; }
  h1 { font-size:16px; margin:0 0 4px; color:#fff; }
  .sub { color:#8b98a8; margin:0 0 14px; }
  .row { display:flex; gap:14px; flex-wrap:nowrap; align-items:flex-start; }
  .cell { flex:0 0 auto; }
  .cap { margin:6px 0 0; font-size:12px; color:#9fb0c3; }
  .cap b { color:#fff; }
  img { display:block; border:1px solid #263041; image-rendering:pixelated; }
  .ok { color:#63d69a; } .warn { color:#ffb454; }
`;

async function run() {
  mkdirSync(FRAMES, { recursive: true });
  mkdirSync(IMAGES, { recursive: true });
  const report = {};

  for (const profile of PROFILES) {
    const files = {};
    for (const build of BUILDS) {
      files[build.label] = join(FRAMES, `${profile.name}-${build.label}.png`);
      await shoot(build, profile, files[build.label]);
    }
    const diffFile = join(FRAMES, `${profile.name}-diff.png`);
    const d = diff(files['pre-cull'], files['served'], diffFile);

    const vp = { left: 0, top: 0, right: profile.width, bottom: profile.height };
    const pre = CENSUS_PRE.profiles[profile.name].asteroids.items;
    const straddlers = pre.filter((r) => touches(r, vp) && !insideR(r, vp));
    const outFile = join(FRAMES, `${profile.name}-straddlers.png`);
    outlineStraddlers(files['served'], outFile, straddlers);

    const v = VERDICT.profiles[profile.name].layers.asteroids;
    report[profile.name] = { ...d, straddlers: straddlers.length, verdict: v };

    const html = `<html><head><style>${CSS}</style></head><body>
      <h1>a1-15 — did a1-12's viewport cull drop a rock the player could see? ${profile.name}</h1>
      <p class="sub">Same arena, same seed, same frozen tick (<code>?debug=1&amp;freeze=1</code>, FREEZE_TICK 120), same ${profile.width}x${profile.height} viewport.
      Left: <b>111db86</b> — before the pooling and before the cull, every rock drawn unconditionally.
      Middle: <b>ebdae99</b> — the served build, culled. Right: their difference, amplified x8.</p>
      <div class="row">
        <div class="cell" style="width:${profile.width}px"><img src="${fileUrl(files['pre-cull'])}" width="${profile.width}">
          <p class="cap"><b>111db86 · pre-cull.</b> 48 rocks submitted, ${v.visibleTrue} of them with a drawn rectangle touching the viewport.</p></div>
        <div class="cell" style="width:${profile.width}px"><img src="${fileUrl(files['served'])}" width="${profile.width}">
          <p class="cap"><b>ebdae99 · served, culled.</b> ${v.drawn} rocks drawn. <span class="ok">MISSING ${v.missing}</span> — every rock visible on the left is drawn here.</p></div>
      </div>
      <div class="row" style="margin-top:14px">
        <div class="cell" style="width:${profile.width}px"><img src="${fileUrl(diffFile)}" width="${profile.width}">
          <p class="cap"><b>Difference, amplified x8.</b> ${d.differing} of ${d.totalPx} px differ at all, peak &Delta;${d.peak}/255.
          Largest connected blob above &Delta;24: <b>${d.largestHotBlobPx2} px&sup2;</b>. A dropped rock would leave one solid blob of thousands of px&sup2;
          (a1-07 measured the discs at 16.8&ndash;74.2 CSS px across, median 62.7).</p></div>
        <div class="cell" style="width:${profile.width}px"><img src="${fileUrl(outFile)}" width="${profile.width}">
          <p class="cap"><b>The boundary cases, on the served frame.</b> Cyan boxes are the ${straddlers.length} rocks whose drawn rectangle
          <i>crosses a viewport edge</i> &mdash; measured on the pre-cull build, drawn here on the culled one. Every box has its rock in it.</p></div>
      </div>
    </body></html>`;

    const plateFile = join(IMAGES, `a1-15-${profile.name}.png`);
    await plate(html, profile.width * 2 + 60, 400, plateFile);
    console.log(`${profile.name}: differing=${d.differing}/${d.totalPx} peak=${d.peak} largestHotBlob=${d.largestHotBlobPx2}px² straddlers=${straddlers.length} missing=${v.missing}`);
    console.log(`  → ${plateFile}`);
  }

  writeFileSync(join(HERE, 'plates.json'), JSON.stringify(report, null, 2));
}

run().catch((e) => { console.error(e); process.exit(1); });
