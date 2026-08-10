/**
 * evidence/a1-07-sky-registry/make-throttle-plate.mjs — a1-07, the plate for the
 * one thing the six arenas turned up. OWNER: QA Manager.
 *
 * Renders `frames/throttle.json` (from `probe-throttle.mjs`) as a picture: the
 * per-second sky/fps trace for the subject (oval → plasmaReef, `reducedDensity 0`)
 * and the control (line → deepEmber, `reducedDensity 1`), run side by side on the
 * same box under the same load, plus each arena's frame after 40 s.
 *
 *   node evidence/a1-07-sky-registry/make-throttle-plate.mjs
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAMES = join(HERE, 'frames');
const t = JSON.parse(readFileSync(join(FRAMES, 'throttle.json'), 'utf8'));

/** One second of one arena as a cell: green while the sky is on the stage, red
 *  once it is gone. The trace IS the evidence; the frames only corroborate it. */
const trace = (c) =>
  c.samples
    .map(
      (s) =>
        `<i class="${s.nebula ? 'on' : 'off'}" title="t+${s.t}s  fps ${s.fps}  ${s.nebula ?? 'no nebula layer'}"></i>`,
    )
    .join('');

const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; padding:26px 24px 30px; background:#14181d; color:#b9c2cc;
         font-family:'Oxanium',ui-monospace,monospace; width:1520px; }
  h1 { font-size:20px; margin:0 0 4px; color:#4DC3FF; font-weight:600; }
  .lede { font-size:12.5px; margin:4px 0 16px; line-height:1.6; color:#8b96a3; }
  .lede b { color:#cfd7e0; } code { color:#e0c07a; }
  .case { margin-bottom:16px; }
  .case h2 { font-size:14px; margin:0 0 5px; color:#e7edf3; font-weight:600; }
  .case h2 .sub { color:#7E8894; font-weight:400; font-size:12px; }
  .trace { display:flex; gap:2px; margin:4px 0 6px; }
  .trace i { width:34px; height:26px; border-radius:2px; display:block; }
  .on { background:#1f7a4a; } .off { background:#8a2028; }
  .axis { font-size:10.5px; color:#68727e; margin-bottom:10px; }
  .row { display:flex; gap:12px; }
  figure { margin:0; } figure img { display:block; width:740px; border:1px solid #2b333c; }
  figcaption { font-size:11px; padding-top:5px; color:#8b96a3; width:740px; line-height:1.45; }
  figcaption b { color:#cfd7e0; }
  .key { font-size:11.5px; color:#7E8894; margin:2px 0 14px; }
  .key i { display:inline-block; width:10px; height:10px; border-radius:2px; vertical-align:-1px; margin:0 4px 0 10px; }
  .note { font-size:11.5px; color:#7E8894; line-height:1.55; margin-top:12px; }
  .note b { color:#cfd7e0; }
</style></head><body>
  <h1>The Oval is the one arena that can end up with no sky at all — by design, and nobody had watched it happen</h1>
  <p class="lede">
    Served bundle <b>${t.served.sha}</b>. Reading the sky twice on The Oval gave two different answers:
    <code>?debug=1&amp;freeze=1</code> had <code>void-nebula-plasmaReef</code> on the stage, and a LIVE
    <code>?debug=1</code> boot of the same bundle had <b>no nebula layer at all</b>. Every other arena answered the
    same both ways. This is why: <code>Void.build()</code> computes
    <code>density = reduced ? nebula.reducedDensity : 1</code> and then
    <code>drawSky = id !== 'none' &amp;&amp; density &gt; 0</code>, and <b>plasmaReef is the only sky whose
    <code>reducedDensity</code> is 0</b> — coalsack 1, deepEmber 1, ironVeil 0.5, patinaDrift 0.45. When
    <code>VfxAutoQuality</code> engages, the reef is the one sky that goes to nothing. Freeze never throttles
    (<code>flags.freeze ? false : vfxQuality.sample(...)</code>), which is why the frozen frame still has it.
  </p>
  <p class="key">Each cell is one second of one arena's live boot:
    <i class="on"></i> a <code>void-nebula-*</code> layer is on the stage &nbsp;
    <i class="off"></i> it is not.</p>
  ${t.cases
    .map(
      (c) => `<div class="case">
    <h2>${c.id} → ${c.sky} <span class="sub">— <code>reducedDensity ${c.reducedDensity}</code>, the ${c.role}${
      c.role === 'control' ? ': same box, same load, same 40 s, a sky that must survive' : ''
    }</span></h2>
    <div class="trace">${trace(c)}</div>
    <div class="axis">t+1s ────────────────────────────────────────── t+${t.seconds}s
      &nbsp;&nbsp;·&nbsp;&nbsp; fps ${c.fpsFirst} → ${c.fpsLast} (median ${c.fpsMedian})
      &nbsp;&nbsp;·&nbsp;&nbsp; sky ${c.skyAtStart ?? '—'} → ${c.skyAtEnd ?? '—'}${
        c.droppedAtSeconds ? `, <b style="color:#ff6b74">dropped at t+${c.droppedAtSeconds}s</b>` : ', held for the whole run'
      }</div>
  </div>`,
    )
    .join('')}
  <div class="row">
    ${t.cases
      .map(
        (c) => `<figure><img src="${c.frame}"/><figcaption><b>${c.id} after ${t.seconds} s</b> — ${
          c.skyAtEnd ? `${c.skyAtEnd} still on the stage` : 'no nebula layer on the stage'
        }</figcaption></figure>`,
      )
      .join('')}
  </div>
  <p class="note">
    <b>What this is and is not.</b> It is not a bug and not a registry fault: <code>MAP_NEBULA.oval</code> says
    plasmaReef and the build loads plasmaReef. It is a consequence of the registry that the registry does not
    state — <b>on a throttled client The Oval flies under a bare star field</b>, and it is the only arena of the
    six for which that is true. The threshold is <code>DEFAULT_VFX_QUALITY</code>: smoothed fps at or under 30,
    held 3 s. <b>This box is nowhere near a real device</b> — software WebGL running two contexts at once,
    median ${t.cases[0].fpsMedian} fps — so what is demonstrated here is the MECHANISM and which sky it takes,
    not that any particular phone crosses that line. A device that never drops below 30 fps never sees this.
  </p>
</body></html>`;

const file = join(FRAMES, 'plate-throttle.html');
writeFileSync(file, HTML);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1570, height: 1100 }, deviceScaleFactor: 1.4 });
const page = await ctx.newPage();
await page.goto(`file://${file}`, { waitUntil: 'load' });
await page.waitForTimeout(500);
await page.screenshot({ path: join(FRAMES, 'plate-throttle.png'), fullPage: true });
await browser.close();
console.log('wrote frames/plate-throttle.png');
