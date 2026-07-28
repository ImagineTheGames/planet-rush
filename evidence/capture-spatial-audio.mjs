/**
 * evidence/capture-spatial-audio.mjs — the a3-03 spatial-audio camera. OWNER: QA Manager.
 *
 * Sound cannot screenshot, so the spatial mix is attested with NUMBERS. This shoots
 * the SHIPPED preview bundle (`npm run build && vite preview` on :4173, ?debug=1&
 * freeze=1) and reads the real `window.__audioStage` seam the Sound Agent left for
 * exactly this (a3-03):
 *
 *   - read().listener  — where the mix is listening from (the camera on the ship)
 *   - probe(x, y)      — PURE geometry: how the live listener would PLACE a sound at
 *                        world (x, y): { gain, pan, cutoff, culled }. Plays nothing,
 *                        so it is deterministic under ?freeze.
 *
 * It probes ONE event at a ladder of known world-unit distances to the right of the
 * camera and mirrored to the left, then paints those readouts as a caption panel
 * over the real game frame and screenshots the whole page. The panel IS the
 * evidence: gain falling to zero past earshot (the off-screen war is gone), pan
 * flipping sign across the ship, the distance lowpass closing. The QA Manager LOOKS
 * at the PNG and attests in evidence/manifest.json.
 *
 * Run (in this sandbox):
 *   CHROME=~/.cache/ms-playwright/chromium-1148/chrome-linux/chrome \
 *   LD_LIBRARY_PATH=/tmp/pwlibs/root/usr/lib/x86_64-linux-gnu:/tmp/pwlibs/root/lib/x86_64-linux-gnu \
 *   node evidence/capture-spatial-audio.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const TMP = join(HERE, '.spatialtmp');
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

const LIVE = process.env.EVIDENCE_LIVE_URL ?? 'http://localhost:4173';

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));

  await page.goto(`${LIVE}/?debug=1&freeze=1`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__audioStage?.read === 'function', undefined, { timeout: 20_000 });

  // A real, trusted gesture so the mix actually wakes — the same door the audio-alive
  // spec uses. The probe is pure geometry and works either way, but we want the
  // readout to show a LIVE, running context (not a suspended one) for honesty.
  await page.mouse.click(200, 400);
  try {
    await page.waitForFunction(() => window.__audioStage.read().contextState === 'running', undefined, { timeout: 8_000 });
  } catch {
    // Headless may not count the synthetic click as a gesture; fall back to the
    // seam's own resume() escape hatch (documented for exactly this).
    await page.evaluate(() => window.__audioStage.resume?.());
    await page.waitForTimeout(500);
  }
  // Let a few real frames run so the listener latches onto the followed ship.
  await page.waitForFunction(() => window.__audioStage.read().listener.has === true, undefined, { timeout: 8_000 });

  // --- probe a distance ladder, right (+dx) then mirrored left (−dx) ----------
  const data = await page.evaluate(() => {
    const stage = window.__audioStage;
    const st = stage.read();
    const { x, y } = st.listener;
    // World-unit offsets along the horizontal (dy = 0), so pan is purely horizontal
    // and distance == |dx|. Chosen to straddle the model's named radii:
    //   R_NEAR ~260 (full level ends), PAN_WIDTH ~900 (pan saturates), R_FAR ~1400 (cull).
    const rings = [0, 130, 260, 450, 900, 1400, 6000];
    const probeAt = (d) => {
      const p = stage.probe(x + d, y);
      return { d, gain: p.gain, pan: p.pan, cutoff: p.cutoff, culled: p.culled };
    };
    const right = rings.map(probeAt);
    // The mirror: same magnitudes to the LEFT, to show pan sign flips and gain matches.
    const left = rings.filter((d) => d !== 0).map((d) => {
      const p = stage.probe(x - d, y);
      return { d: -d, gain: p.gain, pan: p.pan, cutoff: p.cutoff, culled: p.culled };
    });
    return { audio: st, listener: st.listener, right, left };
  });

  // --- paint the readout as a caption panel over the live frame ---------------
  await page.evaluate((d) => {
    const fmt = (n, dp) => (Math.round(n * 10 ** dp) / 10 ** dp).toFixed(dp);
    const rows = [...d.right, ...d.left];
    const row = (r) => {
      const side = r.d === 0 ? 'HERE' : r.d > 0 ? 'RIGHT' : 'LEFT';
      const sideCol = r.d === 0 ? '#9fe8ff' : r.d > 0 ? '#7CFF9B' : '#FFC46B';
      const gainCol = r.gain >= 0.999 ? '#7CFF9B' : r.gain < 0.001 ? '#FF6B6B' : '#e8e8e8';
      const panCol = r.pan > 0.01 ? '#7CFF9B' : r.pan < -0.01 ? '#FFC46B' : '#9fe8ff';
      return `<tr>
        <td style="color:${sideCol};font-weight:700">${side}</td>
        <td style="text-align:right">${r.d === 0 ? '0' : (r.d > 0 ? '+' : '') + r.d}</td>
        <td style="text-align:right">${Math.abs(r.d)}</td>
        <td style="text-align:right;color:${gainCol};font-weight:700">${fmt(r.gain, 3)}</td>
        <td style="text-align:right;color:${panCol};font-weight:700">${r.pan > 0 ? '+' : ''}${fmt(r.pan, 3)}</td>
        <td style="text-align:right">${Math.round(r.cutoff)}</td>
        <td style="text-align:center;color:${r.culled ? '#FF6B6B' : '#6f7d8c'};font-weight:700">${r.culled ? 'CULLED' : '·'}</td>
      </tr>`;
    };
    const panel = document.createElement('div');
    panel.style.cssText = [
      'position:fixed', 'left:24px', 'top:70px', 'z-index:99999',
      'font-family:ui-monospace,Menlo,Consolas,monospace', 'font-size:15px', 'line-height:1.35',
      'background:rgba(8,11,15,0.93)', 'color:#e8e8e8', 'padding:16px 18px', 'border-radius:10px',
      'border:1px solid #2a3644', 'box-shadow:0 8px 30px rgba(0,0,0,0.6)',
    ].join(';');
    panel.innerHTML = `
      <div style="font-size:17px;font-weight:800;color:#9fe8ff;margin-bottom:2px">SPATIAL AUDIO — the listener is the camera (a3-03)</div>
      <div style="color:#8b98a6;margin-bottom:10px">one event, probed at a distance ladder along the horizon.
        context <b style="color:${d.audio.contextState === 'running' ? '#7CFF9B' : '#FFC46B'}">${d.audio.contextState}</b>
        · listener has=<b style="color:#7CFF9B">${d.listener.has}</b>
        at world (${Math.round(d.listener.x)}, ${Math.round(d.listener.y)})
        · model R_NEAR 260 · PAN_WIDTH 900 · R_FAR 1400</div>
      <table style="border-collapse:collapse">
        <thead><tr style="color:#8b98a6;border-bottom:1px solid #2a3644">
          <th style="text-align:left;padding:2px 10px 4px 0">SIDE</th>
          <th style="text-align:right;padding:0 10px">dx</th>
          <th style="text-align:right;padding:0 10px">dist</th>
          <th style="text-align:right;padding:0 10px">gain</th>
          <th style="text-align:right;padding:0 10px">pan</th>
          <th style="text-align:right;padding:0 10px">cutoff&nbsp;Hz</th>
          <th style="text-align:center;padding:0 0 4px 10px">synth</th>
        </tr></thead>
        <tbody>${rows.map(row).join('')}</tbody>
      </table>
      <div style="color:#8b98a6;margin-top:10px;max-width:620px">
        <b style="color:#7CFF9B">gain 1.000</b> = own fire, full presence &nbsp;·&nbsp;
        <b style="color:#FF6B6B">gain 0.000 / CULLED</b> = past earshot, not synthesised &nbsp;·&nbsp;
        pan <b style="color:#7CFF9B">+</b> right / <b style="color:#FFC46B">−</b> left, sign flips across the ship.</div>`;
    document.body.appendChild(panel);
  }, data);

  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, 'spatial-audio.png') });

  if (errs.length) console.log('page errors:', errs.slice(0, 5));
  console.log('readouts:', JSON.stringify(data, null, 2));
  writeFileSync(join(TMP, 'readbacks.json'), JSON.stringify(data, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
