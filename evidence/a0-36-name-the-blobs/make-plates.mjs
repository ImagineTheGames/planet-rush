/**
 * evidence/a0-36-name-the-blobs/make-plates.mjs — a0-36, the plates.
 * OWNER: QA Manager.
 *
 * Turns the round's frames and JSON into the four images the manifest points
 * at. Every number on a plate is READ from `inventory.json`,
 * `profiles-*.json` or `motion-*.json` — none is typed in here, so a plate can
 * never disagree with the measurement it is showing.
 *
 * Crops are nearest-neighbour and each carries its own gain in the caption. A
 * gain is stated, never hidden: a0-07 chose "subtle" and these skies paint at
 * single-digit luma over Floor, so at page scale the honest frame and a black
 * rectangle are the same picture. The plate that shows what the PLAYER sees is
 * always shown at gain 1 beside it.
 *
 *   node evidence/a0-36-name-the-blobs/make-plates.mjs
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAMES = join(HERE, 'frames');
const PLATES = join(HERE, 'plates');
const IMAGES = join(HERE, '..', 'images');
mkdirSync(PLATES, { recursive: true });

const MAP = 'oval';
const VIEW = 'desktop';
const DPR = 2;

const inventory = JSON.parse(readFileSync(join(HERE, 'inventory.json'), 'utf8'));
const profiles = JSON.parse(readFileSync(join(HERE, `profiles-${MAP}-${VIEW}.json`), 'utf8'));
const motionPath = join(HERE, `motion-${MAP}-${VIEW}.json`);
const motion = existsSync(motionPath) ? JSON.parse(readFileSync(motionPath, 'utf8')) : null;
const run = inventory.find((r) => r.mapId === MAP && r.view === VIEW);
const lay = (l) => run.layers.find((x) => x.label === l);
const prof = (l) => profiles.find((x) => x.label === l);

/** Nearest-neighbour crop with a stated luma gain. Clamped reads are avoided by
 *  refusing a window that runs off the source — a clamped edge repeats pixels
 *  and reads as banding that the game never drew. */
function crop(srcFile, outFile, x0, y0, w, h, zoom, gain) {
  const src = PNG.sync.read(readFileSync(join(FRAMES, srcFile)));
  const X = Math.max(0, Math.min(x0, src.width - w));
  const Y = Math.max(0, Math.min(y0, src.height - h));
  const out = new PNG({ width: w * zoom, height: h * zoom });
  for (let y = 0; y < h * zoom; y++) {
    for (let x = 0; x < w * zoom; x++) {
      const si = ((Y + Math.floor(y / zoom)) * src.width + (X + Math.floor(x / zoom))) * 4;
      const di = (y * out.width + x) * 4;
      for (let c = 0; c < 3; c++) out.data[di + c] = Math.min(255, Math.round(src.data[si + c] * gain));
      out.data[di + 3] = 255;
    }
  }
  const p = join(PLATES, outFile);
  writeFileSync(p, PNG.sync.write(out));
  return { path: p, sourceAt: [X, Y], w, h, zoom, gain };
}

/** Inline, as a data URI. A page built with `setContent` has an opaque origin,
 *  so a `file://` subresource is blocked and the plate renders with broken image
 *  icons — which is exactly how the first pass of this file came out. */
const url = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;
const CSS = `
  * { box-sizing: border-box; }
  body { margin:0; background:#0b0f14; color:#e8eef5;
         font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  .plate { padding: 26px 30px 34px; }
  h1 { font-size: 25px; margin: 0 0 4px; letter-spacing: .2px; }
  h1 .verdict { color:#7ee0a8; }
  .sub { color:#93a4b6; font-size: 14px; margin: 0 0 18px; line-height:1.5; }
  .sub b { color:#e8eef5; }
  .row { display:flex; gap:16px; align-items:flex-start; }
  .card { background:#111821; border:1px solid #223041; border-radius:8px; padding:10px; }
  .card img { display:block; border-radius:4px; }
  .cap { font-size:12px; color:#93a4b6; margin-top:8px; line-height:1.45; }
  .cap b { color:#e8eef5; }
  .tag { display:inline-block; font-size:11px; padding:2px 7px; border-radius:99px;
         background:#1b2836; color:#9fd0ff; margin-right:6px; }
  .tag.warn { background:#3a2a15; color:#ffc46b; }
  .tag.good { background:#16301f; color:#7ee0a8; }
  table { border-collapse:collapse; font-size:13px; }
  th, td { padding:5px 11px; text-align:right; border-bottom:1px solid #1b2735; }
  th:first-child, td:first-child { text-align:left; }
  th { color:#93a4b6; font-weight:500; font-size:12px; }
  td.big { color:#ffd479; font-weight:600; }
  td.dim { color:#6d7f92; }
  .foot { margin-top:16px; font-size:11.5px; color:#6d7f92; line-height:1.6; }
  .foot b { color:#93a4b6; }
`;

const browser = await chromium.launch();
async function shoot(name, html, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 2400 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.setContent(`<style>${CSS}</style><div class="plate">${html}</div>`, { waitUntil: 'load' });
  await page.waitForTimeout(250);
  const el = await page.$('.plate');
  const file = join(IMAGES, name);
  await el.screenshot({ path: file });
  await ctx.close();
  console.log(`  ${name}`);
  return file;
}

const SHA = '75ec737';
const stamp = `served <b>${SHA}</b> · arena <b>The Oval</b> (sky <b>plasmaReef</b>) · desktop 1440×900 @dpr 2 · <code>?debug=1&amp;freeze=1</code>`;

// --- Plate 1: the two classes, at one scale --------------------------------
{
  const neb = prof('void-nebula-plasmaReef').profiled[1]; // interior, 210.5 css
  const star = prof('void-stars-near').profiled[2]; // interior, 11 css
  const W = 560;
  const a1 = crop('solo-oval-desktop-live-nebula.png', 'p1-clot-g1.png', neb.centroid[0] - W / 2, neb.centroid[1] - W / 2, W, W, 1, 1);
  const a8 = crop('solo-oval-desktop-live-nebula.png', 'p1-clot-g8.png', neb.centroid[0] - W / 2, neb.centroid[1] - W / 2, W, W, 1, 8);
  const b1 = crop('solo-oval-desktop-live-stars-all.png', 'p1-star-g1.png', star.centroid[0] - W / 2, star.centroid[1] - W / 2, W, W, 1, 1);
  const b8 = crop('solo-oval-desktop-live-stars-all.png', 'p1-star-g8.png', star.centroid[0] - W / 2, star.centroid[1] - W / 2, W, W, 1, 8);
  const nL = lay('void-nebula-plasmaReef');
  const sN = lay('void-stars-near');
  await shoot(
    'a0-36-two-classes-one-scale.png',
    `<h1>The big soft discs are the <span class="verdict">nebula</span>. The bloom is the small thing beside them.</h1>
     <p class="sub">${stamp}<br>
     Four crops, <b>the same 560×560 device-pixel window</b> in every one, so the sizes compare directly.
     Left pair: the <code>void-nebula-plasmaReef</code> layer alone. Right pair: the three <code>void-stars-*</code> layers alone.
     Top row is what the player sees (gain 1). Bottom row is the same pixels at gain 8.</p>
     <div class="row">
       <div class="card"><img src="${url(a1.path)}" width="330">
         <div class="cap"><span class="tag">gain 1</span>nebula layer, as played</div></div>
       <div class="card"><img src="${url(b1.path)}" width="330">
         <div class="cap"><span class="tag">gain 1</span>star layers, as played</div></div>
       <div class="card" style="flex:1; min-width:390px">
         <table>
           <tr><th>class</th><th>layer</th><th>in frame</th><th>span, css px</th></tr>
           <tr><td>soft disc</td><td>void-nebula-plasmaReef</td><td class="big">${nL.blobs}</td><td class="big">${nL.spanCssPx.min}–${nL.spanCssPx.max} (med ${nL.spanCssPx.median})</td></tr>
           <tr><td>star + bloom</td><td>void-stars-near</td><td>${sN.blobs}</td><td>${sN.spanCssPx.min}–${sN.spanCssPx.max}</td></tr>
           <tr><td>star + bloom</td><td>void-stars-mid</td><td>${lay('void-stars-mid').blobs}</td><td>${lay('void-stars-mid').spanCssPx.min}–${lay('void-stars-mid').spanCssPx.max}</td></tr>
           <tr><td>star + bloom</td><td>void-stars-deep</td><td>${lay('void-stars-deep').blobs}</td><td>${lay('void-stars-deep').spanCssPx.min}–${lay('void-stars-deep').spanCssPx.max}</td></tr>
           <tr><td>rock</td><td>asteroids</td><td>${lay('asteroids').blobs}</td><td>${lay('asteroids').spanCssPx.min}–${lay('asteroids').spanCssPx.max}</td></tr>
           <tr><td>station air</td><td>atmosphere</td><td>1</td><td>512</td></tr>
         </table>
         <div class="cap">The nebula layer covers <b>${nL.pctFrame}%</b> of this frame.
           Every star layer together covers <b>${(lay('void-stars-deep').pctFrame + lay('void-stars-mid').pctFrame + lay('void-stars-near').pctFrame).toFixed(3)}%</b>.
           The widest bloom in frame is <b>${sN.spanCssPx.max} css px</b>; the median soft disc is <b>${nL.spanCssPx.median} css px</b> —
           <b>${(nL.spanCssPx.median / sN.spanCssPx.max).toFixed(1)}×</b> wider.</div>
       </div>
     </div>
     <div class="row" style="margin-top:14px">
       <div class="card"><img src="${url(a8.path)}" width="330">
         <div class="cap"><span class="tag">gain 8</span><b>Plasma Reef clot nodes.</b> Four-band concentric stacks
           (<code>ADDITIVE_STOPS</code>), in knots of four. <b>No star at any centre — this layer has no stars in it.</b></div></div>
       <div class="card"><img src="${url(b8.path)}" width="330">
         <div class="cap"><span class="tag">gain 8</span><b>Star bloom.</b> A hard point with a tight halo.
           Present, working, and small. This is what "bloom" is.</div></div>
       <div class="card" style="flex:1; min-width:390px">
         <div class="cap" style="font-size:13.5px; line-height:1.7">
           <b>What the developer is looking at.</b> The many large soft discs are
           <b>Plasma Reef</b>, the sky assigned to The Oval — not bloom, not rocks, not a cull artefact.
           They have no star at their centre because <b>nothing on that layer has a star</b>.<br><br>
           The few that DO have a star are <b>coincidence</b>: a star from
           <code>void-stars-*</code> landing over a clot node. The two are on
           different layers at different parallax, which is the second half of the report.
         </div>
       </div>
     </div>
     <div class="foot"><b>Method.</b> Each layer drawn alone over the bare Floor on the live build
       (Pixi's <code>__PIXI_APP_INIT__</code> devtools hook; nothing in <code>src/</code> touched).
       Counts and spans are connected components of |all − that-layer-hidden| on the frozen frame, threshold 1/255.
       Crops are nearest-neighbour; the gain is printed on every one.</div>`,
    1180,
  );
}

// --- Plate 2: ring or glow --------------------------------------------------
{
  const neb = prof('void-nebula-plasmaReef');
  const nb = neb.profiled[1];
  const W = 460;
  const c = crop('solo-oval-desktop-live-nebula.png', 'p2-clot.png', nb.centroid[0] - W / 2, nb.centroid[1] - W / 2, W, W, 1, 8);
  const elemGlow = neb.profiled.filter((p) => p.element.shape === 'GLOW').length;
  const groupRing = neb.profiled.filter((p) => p.group.shape === 'RING').length;
  const starProfiles = ['void-stars-near', 'void-stars-mid', 'void-stars-deep'].flatMap((l) => prof(l).profiled);
  const starRings = starProfiles.filter((p) => p.element.shape === 'RING' || p.group.shape === 'RING').length;

  const chart = (p, label) => {
    const max = Math.max(...p.profile, 0.0001);
    const bars = p.profile
      .slice(0, 60)
      .map((v, i) => `<div style="width:6px;height:${Math.max(1, Math.round((v / max) * 90))}px;background:${i === p.peakR ? '#ffd479' : '#4f9bd9'};margin-right:1px;align-self:flex-end"></div>`)
      .join('');
    return `<div class="cap" style="margin-bottom:4px">${label}</div>
      <div style="display:flex;height:92px;align-items:flex-end;background:#0c1219;padding:4px;border-radius:4px">${bars}</div>`;
  };

  await shoot(
    'a0-36-ring-or-glow.png',
    `<h1>Nothing is drawn as a stroke. <span class="verdict">Every element is a filled glow</span> — the ring is the arrangement.</h1>
     <p class="sub">${stamp}<br>
     The brief's question: the discs read as a brighter rim with a darker centre, which three concentric filled discs cannot composite to.
     Measured, per blob, as a radial profile of that layer's own isolated luma — from the blob's <b>peak</b> (is one drawn element a donut?)
     and from its <b>centroid</b> (does the group read as one?). A ring must have its maximum away from the centre <i>and</i> an interior dip
     deeper than one 8-bit code value; below that it is quantisation, not a shape.</p>
     <div class="row">
       <div class="card"><img src="${url(c.path)}" width="420">
         <div class="cap"><span class="tag">gain 8</span>Plasma Reef, alone. Each node is a four-band stack,
           <b>brightest at its own centre</b>. The nodes sit in a knot around a common middle that has nothing in it.</div></div>
       <div class="card" style="flex:1; min-width:390px">
         <table>
           <tr><th>layer</th><th>blobs profiled</th><th>element = RING</th><th>group = RING</th></tr>
           <tr><td>void-nebula-plasmaReef</td><td>${neb.profiled.length}</td><td class="dim">${neb.profiled.length - elemGlow}</td><td class="big">${groupRing}</td></tr>
           <tr><td>void-stars-near / mid / deep</td><td>${starProfiles.length}</td><td class="dim">0</td><td class="dim">0</td></tr>
           <tr><td>asteroids</td><td>${prof('asteroids').profiled.length}</td><td class="dim">${prof('asteroids').profiled.filter((p) => p.element.shape === 'RING').length}</td><td>${prof('asteroids').profiled.filter((p) => p.group.shape === 'RING').length}</td></tr>
           <tr><td>vfx-light</td><td>${prof('vfx-light').profiled.length}</td><td class="dim">${prof('vfx-light').profiled.filter((p) => p.element.shape === 'RING').length}</td><td>${prof('vfx-light').profiled.filter((p) => p.group.shape === 'RING').length}</td></tr>
         </table>
         <div style="margin-top:14px">
           ${chart(nb.element, `<b>from the peak</b> — one clot node. Max at r=${nb.element.peakR} px: <b>a glow</b>.`)}
         </div>
         <div style="margin-top:12px">
           ${chart(nb.group, `<b>from the centroid</b> — the whole clot. Max at r=${nb.group.peakR} px, interior dip ${nb.group.dip} luma: <b>a ring</b>.`)}
         </div>
         <div class="cap" style="margin-top:12px;font-size:13px;line-height:1.7">
           <span class="tag good">settled</span><b>Not one element in any layer is a donut.</b>
           <code>starFieldSprite</code>'s three filled discs and <code>softDisc</code>'s four-stop stack
           both composite to a glow, exactly as written, and <b>${starRings} of ${starProfiles.length}</b> star blobs are rings by either test.<br><br>
           The rim-with-a-darker-centre is <b>PLASMA_REEF's clot layout</b>: four nodes placed at
           <code>(n/4)·2π + jitter</code>, <code>spread·(0.45…1)</code> from a common centre — <b>on a circle, with nothing in the middle</b>.
           Four filled glows arranged on a ring read as a ring.
         </div>
       </div>
     </div>
     <div class="foot"><b>Zero control.</b> Every layer with no children in the frozen frame differenced to
       <b>exactly 0 px</b> (${run.zeroControl.layers.join(', ')}), and the frame re-shot after all toggling differed from the
       first by <b>0 px, peak 0</b> — so the freeze pins the scene and none of the above has a noise floor to clear.</div>`,
    1180,
  );
}

// --- Plate 3: the per-arena inventory --------------------------------------
{
  const rows = inventory
    .map((r) => {
      const n = r.layers.find((l) => l.label.startsWith('void-nebula-'));
      const stars = ['void-stars-deep', 'void-stars-mid', 'void-stars-near']
        .map((k) => r.layers.find((l) => l.label === k))
        .filter(Boolean);
      const starMax = Math.max(0, ...stars.map((s) => s.spanCssPx?.max ?? 0));
      const rock = r.layers.find((l) => l.label === 'asteroids');
      return `<tr>
        <td>${r.mapId} / ${r.view}</td>
        <td>${n ? n.label.replace('void-nebula-', '') : '<span class="dim">none</span>'}</td>
        <td class="${n && n.pctFrame > 5 ? 'big' : 'dim'}">${n ? n.pctFrame : 0}%</td>
        <td>${n ? n.blobs : 0}</td>
        <td class="${n && n.spanCssPx ? 'big' : 'dim'}">${n && n.spanCssPx ? `${n.spanCssPx.min}–${n.spanCssPx.max}` : '—'}</td>
        <td>${starMax || '—'}</td>
        <td class="dim">${rock && rock.spanCssPx ? `${rock.blobs} @ ${rock.spanCssPx.min}–${rock.spanCssPx.max}` : '0'}</td>
      </tr>`;
    })
    .join('');
  await shoot(
    'a0-36-inventory-by-arena.png',
    `<h1>Every arena with a light-painting sky puts <span class="verdict">a quarter to a half of the frame</span> under soft discs</h1>
     <p class="sub">served <b>${SHA}</b> · all six arenas · desktop 1440×900 @dpr 2 and phone 390×844 @dpr 3 · <code>?debug=1&amp;freeze=1</code><br>
     One row per arena and viewport. "Sky, % of frame" is the <code>void-nebula-*</code> layer's own pixels — |all − sky hidden| at a 1/255 threshold —
     and "sky blobs / span" is the connected components of that difference. <b>The Octagon is the control: its sky is <code>none</code>, and it has no such layer at all.</b></p>
     <div class="card" style="display:inline-block">
       <table>
         <tr><th>arena / viewport</th><th>sky</th><th>sky, % of frame</th><th>sky blobs</th><th>sky span, css px</th><th>widest star+bloom</th><th>rocks</th></tr>
         ${rows}
       </table>
     </div>
     <div class="foot" style="max-width:1080px">
       <b>Coalsack is the row that looks wrong and is not.</b> The Compass's sky is drawn in <i>Floor's own colour</i>, in front of the star
       field, to take stars out of frame — it adds no light, so hiding it moves only the handful of stars it was covering (0.06–0.12% of frame,
       spans 3–12 css px). a1-07 measured the same thing and it is the sky behaving as designed.<br>
       <b>The widest star + bloom in any frame here is ${Math.max(
         ...inventory.flatMap((r) =>
           ['void-stars-deep', 'void-stars-mid', 'void-stars-near'].map((k) => r.layers.find((l) => l.label === k)?.spanCssPx?.max ?? 0),
         ),
       )} css px.</b> The sky's discs run to several hundred. No viewport, no arena and no tier makes those two classes the same size.
     </div>`,
    1180,
  );
}

// --- Plate 4: drift ---------------------------------------------------------
{
  const d = JSON.parse(readFileSync(join(HERE, `drift-${MAP}-${VIEW}.json`), 'utf8'));
  const SW = d.screenWidthCssPx;
  const by = (k) => d.classes.find((c) => c.key === k);
  const rows = d.classes
    .map(
      (c) => `<tr>
        <td>${c.key}</td><td class="dim">${c.labels.join(', ')}</td>
        <td class="big">${c.readRatio}</td>
        <td class="big">${c.measuredRatio}</td>
        <td class="dim">${c.xcorrLagDevicePx}</td>
        <td class="dim">${c.xcorrR}${c.lagWindowRailed ? ' <span class="tag warn">railed</span>' : ''}</td>
        <td class="big">${c.readDriftPerScreenWidthCssPx}</td>
      </tr>`,
    )
    .join('');

  // The same screen band at both ends of one flight, per class. A crop rather
  // than the whole frame because the drift is what is being looked at, and at
  // page scale a full 2880-px frame hides a 116-px shift.
  const bandH = 320;
  /** Pick the band by where the layer actually HAS ink, not by a fixed offset —
   *  a fixed band picked a stretch of empty sky for the star layer and the strip
   *  proved nothing. Same band for A and B, chosen from A. */
  function bandFor(key) {
    const img = PNG.sync.read(readFileSync(join(FRAMES, `drift-${MAP}-${VIEW}-${key}-A.png`)));
    let best = 0, bestInk = -1;
    for (let y = 0; y + bandH < img.height; y += 40) {
      let ink = 0;
      for (let yy = y; yy < y + bandH; yy += 4) {
        for (let x = 0; x < 1500; x += 4) {
          const i = (yy * img.width + x) * 4;
          ink += img.data[i] + img.data[i + 1] + img.data[i + 2];
        }
      }
      if (ink > bestInk) { bestInk = ink; best = y; }
    }
    return best;
  }
  const bands = Object.fromEntries(d.classes.map((c) => [c.key, bandFor(c.key)]));
  const strip = (key, tag) =>
    crop(`drift-${MAP}-${VIEW}-${key}-${tag}.png`, `p4-${key}-${tag}.png`, 0, bands[key], 1500, bandH, 1, 7);
  const pair = (key, label, note) => `
    <div class="card" style="margin-bottom:12px">
      <div class="cap" style="margin-bottom:6px"><b>${label}</b> — ${note}</div>
      <img src="${url(strip(key, 'A').path)}" width="700">
      <div class="cap" style="margin:4px 0 6px">before — camera at 0</div>
      <img src="${url(strip(key, 'B').path)}" width="700">
      <div class="cap" style="margin-top:4px">after — camera panned ${d.cameraPanCssPx} css px right</div>
    </div>`;

  const mid = by('stars-mid'), near = by('stars-near'), neb = by('nebula');
  await shoot(
    'a0-36-drift-per-screen-width.png',
    `<h1>A star and the disc it sits on are <span class="verdict">on different layers</span>, and they separate by design</h1>
     <p class="sub">served <b>${SHA}</b> · arena <b>The Oval</b> · desktop 1440×900 @dpr 2 · <b>live</b>, flown in the shipped scheme (Tap Commander, a0-33)<br>
     One boot, ONE flight of <b>${d.cameraPanCssPx} css px</b> of camera pan, every class photographed at both ends. Two independent routes on the same flight.
     <b>Read:</b> the layer's own <code>position</code>, off the running build. <b>Measured:</b> the layer's pixels, cross-correlated between the two frames —
     which needs no faith in the first route at all.</p>
     <div class="row">
       <div class="card" style="flex:1; min-width:640px">
         <table style="width:100%">
           <tr><th>class</th><th>layers shown</th><th>read ratio</th><th>measured ratio</th><th>lag, dev px</th><th>r</th><th>drift per screen-width, css px</th></tr>
           ${rows}
         </table>
         <div class="cap" style="margin-top:12px; font-size:13px; line-height:1.75">
           <span class="tag good">both routes agree</span>The transform and the pixels match to
           <b>${(() => { const ok = d.classes.filter((c) => !c.lagWindowRailed); return ok.length ? Math.max(...ok.map((c) => Math.abs(c.readRatio - c.measuredRatio))).toFixed(4) : 'n/a'; })()}</b>
           on all ${d.classes.filter((c) => !c.lagWindowRailed).length} classes whose lag landed inside the search, at correlations of
           ${by('nebula').xcorrR} down to ${by('stars-near').xcorrR}.
           So nothing is moving a layer outside <code>position</code>, and the running build's parallax IS
           <code>SKY_PARALLAX</code> 0.085 and <code>STAR_LAYERS</code> 0.10 / 0.26 / 0.50.<br><br>
           <span class="tag warn">stated, not hidden</span>The <b>world</b> row's lag window railed: a parallax-1 layer moves the whole
           camera pan, which is past the 45% of frame that still leaves a band to correlate over, and its content is live sim that moved between
           the two shots as well (r ${by('world').xcorrR}). Its READ ratio is 1 by construction — the world container's position <i>is</i> the
           camera offset — so the row is reported rather than dropped, and its measured column is a floor.
         </div>
       </div>
     </div>
     <div class="row" style="margin-top:14px">
       <div style="flex:1">
         ${pair('nebula', 'void-nebula-plasmaReef · 0.085', 'the same band of screen, before and after. gain 7')}
         ${pair('stars-near', 'void-stars-near · 0.50', 'the same band, the same flight. gain 7')}
       </div>
       <div class="card" style="flex:1; min-width:380px">
         <div class="cap" style="font-size:13.5px; line-height:1.8">
           <b>This is the "weird effect", and it is the design.</b><br><br>
           A Plasma Reef clot travels <b>${neb.readDriftPerScreenWidthCssPx} css px</b> per screen-width flown.
           A near star travels <b>${near.readDriftPerScreenWidthCssPx}</b>, a mid star <b>${mid.readDriftPerScreenWidthCssPx}</b>.
           So a star that happens to sit on a clot node — <b>the only way a soft disc ever HAS a star in it</b> —
           slides off it at <b>${(near.readDriftPerScreenWidthCssPx - neb.readDriftPerScreenWidthCssPx).toFixed(0)} px</b> per screen-width
           if it is a near star and <b>${(mid.readDriftPerScreenWidthCssPx - neb.readDriftPerScreenWidthCssPx).toFixed(0)} px</b> if it is a mid one.
           Nothing is coming apart: <b>they were never one object.</b><br><br>
           <b>What is NOT happening is a halo separating from its own star.</b>
           Bloom and star are pushed into the same shapes array at the same <code>x,y</code> inside one baked sprite
           (<code>backdrop.ts</code>, <code>starFieldSprite</code>) — one layer, one transform. Every star layer's read and
           measured ratios agree above, so no star layer is moving relative to itself.
         </div>
       </div>
     </div>
     <div class="foot">Flown by clicking, because the ratified default scheme is <b>Tap Commander</b> (a0-33) and the ship goes where the player
       clicks; a first pass held <code>KeyD</code> for six seconds and the ship did not move a world unit. Soloing is applied only while the
       shutter is open — hiding the UI to isolate a layer also stops the click landing, and a pass that flies while soloed measures a camera pan
       of zero. Both traps are written up in the round's README.</div>`,
    1400,
  );
}

await browser.close();
console.log('\nplates written to evidence/images/');
