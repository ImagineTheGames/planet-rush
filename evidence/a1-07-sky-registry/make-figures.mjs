/**
 * evidence/a1-07-sky-registry/make-figures.mjs — a1-07, the arithmetic and the
 * plates. OWNER: QA Manager.
 *
 * `shoot-skies.mjs` shot each arena's frozen scene four ways, differing by
 * exactly one hidden layer set. This subtracts them.
 *
 *   sky alone   = |A-frozen − B-no-nebula|     the `void-nebula-*` layer's own pixels
 *   stars alone = |A-frozen − C-no-stars|      the three `void-stars-*` layers'
 *
 * Both are amplified (×{@link AMP}) to be lookable-at: a0-07 chose "subtle" and
 * the skies paint at single-digit luma over Floor, so at page scale a true
 * difference and a black rectangle are the same picture to a reader.
 *
 * **The octagon plate is the method's own null control.** Its registry entry is
 * `none`, so hiding `void-nebula-*` there hides NOTHING and A and B are two
 * screenshots of the same unchanged scene. If the sim is really pinned by
 * `?freeze=1`, that difference must be identically zero — and whatever it
 * measures is the noise floor every other arena's number has to clear.
 *
 * Numbers land in `measurements.json`; the verdicts are written by hand into
 * `evidence/manifest.json` afterwards, after looking at the plates.
 *
 *   node evidence/a1-07-sky-registry/make-figures.mjs
 */
import { PNG } from 'pngjs';
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAMES = join(HERE, 'frames');
const AMP = 14;

const read = (name) => PNG.sync.read(readFileSync(join(FRAMES, name)));

/**
 * |a − b| per channel, amplified and clamped. Returns the image plus what it
 * measured: how much of the frame the layer touched at all, and how hard.
 */
function difference(a, b) {
  const out = new PNG({ width: a.width, height: a.height });
  const n = a.width * a.height;
  let touched = 0;
  let over2 = 0;
  let peak = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let peakLuma = 0;
  for (let i = 0; i < n; i++) {
    const p = i << 2;
    const dr = Math.abs(a.data[p] - b.data[p]);
    const dg = Math.abs(a.data[p + 1] - b.data[p + 1]);
    const db = Math.abs(a.data[p + 2] - b.data[p + 2]);
    const m = Math.max(dr, dg, db);
    if (m > 0) {
      touched++;
      sumR += dr;
      sumG += dg;
      sumB += db;
    }
    if (m > 2) over2++;
    if (m > peak) peak = m;
    const luma = 0.2126 * dr + 0.7152 * dg + 0.0722 * db;
    if (luma > peakLuma) peakLuma = luma;
    out.data[p] = Math.min(255, dr * AMP);
    out.data[p + 1] = Math.min(255, dg * AMP);
    out.data[p + 2] = Math.min(255, db * AMP);
    out.data[p + 3] = 255;
  }
  return {
    png: out,
    stats: {
      pixels: n,
      touchedPct: Math.round((touched / n) * 1000) / 10,
      over2Pct: Math.round((over2 / n) * 1000) / 10,
      peakChannelDelta: peak,
      peakLumaDelta: Math.round(peakLuma * 10) / 10,
      meanInkWhereTouched: touched
        ? { r: Math.round((sumR / touched) * 100) / 100, g: Math.round((sumG / touched) * 100) / 100, b: Math.round((sumB / touched) * 100) / 100 }
        : null,
    },
  };
}

const readback = JSON.parse(readFileSync(join(FRAMES, 'readback.json'), 'utf8'));
const out = { amp: AMP, served: readback.served, maps: [] };

for (const m of readback.maps) {
  const A = read(m.frames['A-frozen']);
  const B = read(m.frames['B-no-nebula']);
  const C = read(m.frames['C-no-stars']);

  const sky = difference(A, B);
  const stars = difference(A, C);
  writeFileSync(join(FRAMES, `${m.id}-sky-isolated.png`), PNG.sync.write(sky.png));
  writeFileSync(join(FRAMES, `${m.id}-stars-isolated.png`), PNG.sync.write(stars.png));

  const row = {
    id: m.id,
    name: m.name,
    registry: m.expect,
    rendered: m.actual,
    match: m.match,
    drawOrder: m.frozen.children.map((c) => c.label),
    liveNebula: m.live.nebulaLabels?.[0]?.replace('void-nebula-', '') ?? null,
    frozenNebula: m.frozen.nebulaLabels?.[0]?.replace('void-nebula-', '') ?? null,
    blendMode: m.frozen.children.find((c) => c.label?.startsWith('void-nebula-'))?.blendMode ?? null,
    skyAlone: sky.stats,
    starsAlone: stars.stats,
  };
  out.maps.push(row);
  console.log(
    `${m.id.padEnd(10)} registry ${m.expect.padEnd(11)} rendered ${String(m.actual).padEnd(11)} ` +
      `sky-alone: ${String(row.skyAlone.touchedPct).padStart(5)}% of frame, peak Δluma ${row.skyAlone.peakLumaDelta}` +
      `   stars-alone: ${row.starsAlone.touchedPct}% peak Δluma ${row.starsAlone.peakLumaDelta}`,
  );
}

writeFileSync(join(HERE, 'measurements.json'), `${JSON.stringify(out, null, 2)}\n`);

// --- the plates -------------------------------------------------------------
const CSS = `
  body { margin:0; padding:26px 24px 30px; background:#14181d; color:#b9c2cc;
         font-family:'Oxanium',ui-monospace,monospace; width:1520px; }
  h1 { font-size:20px; margin:0 0 3px; color:#4DC3FF; font-weight:600; }
  h1 .v { font-size:13px; padding:2px 8px; border-radius:3px; margin-left:10px; vertical-align:2px; }
  .ok { background:#123a26; color:#57d98a; } .bad { background:#3d1418; color:#ff6b74; }
  .lede { font-size:12.5px; margin:4px 0 16px; line-height:1.6; color:#8b96a3; max-width:1460px; }
  .lede b { color:#cfd7e0; } code { color:#e0c07a; }
  .row { display:flex; gap:12px; margin-bottom:6px; }
  figure { margin:0; }
  figure img { display:block; width:492px; border:1px solid #2b333c; }
  figcaption { font-size:11px; line-height:1.45; padding-top:5px; color:#8b96a3; width:492px; }
  figcaption b { color:#cfd7e0; }
  table { border-collapse:collapse; font-size:11.5px; margin-top:12px; }
  td,th { border:1px solid #2b333c; padding:3px 9px; text-align:left; }
  th { color:#7E8894; font-weight:400; }
  td.n { color:#e7edf3; }
`;

const plate = (m) => {
  const r = out.maps.find((x) => x.id === m.id);
  const skyFrame = r.frozenNebula ? m.frames['B-no-nebula'] : m.frames['C-no-stars'];
  const skyCap = r.frozenNebula
    ? `<b>B — the same frame, <code>void-nebula-${r.frozenNebula}</code> hidden.</b> One layer's visibility, nothing else.`
    : `<b>C — the same frame, all three <code>void-stars-*</code> layers hidden.</b> There is no nebula layer here to hide.`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
  <h1>${m.name} — the sky the running build actually loaded
    <span class="v ${r.match ? 'ok' : 'bad'}">${r.match ? 'REGISTRY MATCHES' : 'MISMATCH'}</span></h1>
  <p class="lede">
    Served bundle <b>${out.served.sha}</b>, desktop 1440×900 at dpr 2, map pinned through
    <code>localStorage['planet-rush:mapId'] = '${m.id}'</code>. <code>MAP_NEBULA.${m.id}</code> says
    <b>${r.registry}</b>; the live stage answers <b>${r.rendered}</b>. The layer names below are read off the
    running Pixi scene graph, not off the source: <code>Void.build()</code> writes
    <code>void-nebula-&lt;id&gt;</code> from the same <code>nebula.id</code> the sprite is drawn from.
    Draw order, back to front: <code>${r.drawOrder.join(' › ')}</code>.
  </p>
  <div class="row">
    <figure><img src="${m.frames['A-frozen']}"/><figcaption><b>A — <code>?debug=1&amp;freeze=1</code>, the seeded pinned world.</b> Everything drawing.</figcaption></figure>
    <figure><img src="${skyFrame}"/><figcaption>${skyCap}</figcaption></figure>
    <figure><img src="${m.id}-sky-isolated.png"/><figcaption>
      <b>|A − B| × ${AMP} — the sky's own pixels, and nothing else's.</b>
      ${r.skyAlone.touchedPct === 0
        ? 'Identically zero: not one pixel of this frame changed. Nothing draws a sky on this arena.'
        : `Touches ${r.skyAlone.touchedPct}% of the frame; peak Δluma ${r.skyAlone.peakLumaDelta} of 255 before amplification.`}
    </figcaption></figure>
  </div>
  <div class="row">
    <figure><img src="${m.frames['D-ground-only']}"/><figcaption><b>D — every void layer but <code>void-ground</code> hidden.</b> Floor and the world: what is left when neither sky nor star draws.</figcaption></figure>
    <figure><img src="${m.id}-stars-isolated.png"/><figcaption><b>|A − C| × ${AMP} — the three star layers alone</b>, for scale: ${r.starsAlone.touchedPct}% of the frame, peak Δluma ${r.starsAlone.peakLumaDelta}.</figcaption></figure>
    <figure><table>
      <tr><th>registry <code>MAP_NEBULA.${m.id}</code></th><td class="n">${r.registry}</td></tr>
      <tr><th>rendered (frozen, full VFX)</th><td class="n">${r.frozenNebula ?? 'none — no void-nebula-* layer'}</td></tr>
      <tr><th>rendered (live <code>?debug=1</code>)</th><td class="n">${r.liveNebula ?? 'none — no void-nebula-* layer'}</td></tr>
      <tr><th>blend mode</th><td class="n">${r.blendMode ?? 'normal'}</td></tr>
      <tr><th>sky alone — frame touched</th><td class="n">${r.skyAlone.touchedPct}%</td></tr>
      <tr><th>sky alone — peak Δluma</th><td class="n">${r.skyAlone.peakLumaDelta} / 255</td></tr>
      <tr><th>sky alone — mean ink (r,g,b)</th><td class="n">${r.skyAlone.meanInkWhereTouched ? `${r.skyAlone.meanInkWhereTouched.r}, ${r.skyAlone.meanInkWhereTouched.g}, ${r.skyAlone.meanInkWhereTouched.b}` : '—'}</td></tr>
      <tr><th>stars alone — frame touched</th><td class="n">${r.starsAlone.touchedPct}%</td></tr>
    </table></figure>
  </div>
</body></html>`;
};

const browser = await chromium.launch();
for (const m of readback.maps) {
  const file = join(FRAMES, `plate-${m.id}.html`);
  writeFileSync(file, plate(m));
  const ctx = await browser.newContext({ viewport: { width: 1570, height: 1200 }, deviceScaleFactor: 1.4 });
  const page = await ctx.newPage();
  await page.goto(`file://${file}`, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(FRAMES, `plate-${m.id}.png`), fullPage: true });
  await ctx.close();
  console.log(`  plate-${m.id}.png`);
}
await browser.close();
console.log(`\nwrote ${HERE}/measurements.json and six plates`);
