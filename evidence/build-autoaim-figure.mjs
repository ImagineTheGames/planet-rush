// Build evidence/images/autoaim-enemies-strip.png — a captioned ROCK / ENEMY /
// CLUSTER strip for the `auto-aim-enemies-first` gate, from the three raw frames
// and /tmp/autoaim-readback.json ground truth. Follows the turret-leads figure pattern.
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const rec = JSON.parse(readFileSync('/tmp/autoaim-readback.json', 'utf8'));

// crop a PNG (screen px) to a window
function crop(file, x0, y0, w, h) {
  const png = PNG.sync.read(readFileSync(join(OUT, file)));
  const o = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x0 + x, sy = y0 + y, di = (y * w + x) * 4;
    if (sx < 0 || sy < 0 || sx >= png.width || sy >= png.height) { o.data[di + 3] = 255; continue; }
    const si = (sy * png.width + sx) * 4;
    o.data[di] = png.data[si]; o.data[di + 1] = png.data[si + 1]; o.data[di + 2] = png.data[si + 2]; o.data[di + 3] = 255;
  }
  const f = 'crop-' + file; writeFileSync(join(OUT, f), PNG.sync.write(o)); return f;
}

// ship is camera-centred at screen (640,400). Crop windows around it.
const rockCrop = crop('autoaim-rock.png', 470, 300, 480, 260);
const enemyCrop = crop('autoaim-enemy.png', 470, 300, 480, 260);
const clusterCrop = crop('autoaim-cluster.png', 300, 130, 700, 560);

const b64 = (f) => readFileSync(join(OUT, f)).toString('base64');
const sha = rec.build?.sha;
const clusterFiring = rec.cluster.filter((f) => f.firing).length;
const clusterHit = rec.cluster.filter((f) => f.enemyHits.length).length;
const clusterMine = rec.cluster.filter((f) => f.rose).length;
const enemyDrain = rec.enemy.filter((f) => f.enemyHits.length).length;

const panels = [
  { f: clusterCrop, w: 700, title: 'CLUSTER — enemies-first, amid rock', body:
    `Live arena: the ship (blue, hull <b>42/50</b>) parked in the natural asteroid field — grey rock in every direction, the game even prompting <i>"Hold Left mouse on the asteroid — your shots chip the rock."</i> An enemy is in range: <b>Rusty (EASY) 23/30</b>, ~109px off. Ground truth over the ${rec.cluster.length}-frame hold: firing <b>${clusterFiring}</b> frames, an ENEMY bar drained on <b>${clusterHit}</b> of them, a rock was mined on only <b>${clusterMine}</b>. Surrounded by minable rock, the shots go to the enemy — cargo flat.` },
  { f: enemyCrop, w: 480, title: 'ENEMY alone (tier 1)', body:
    `stageAutoEngage: one bot in weapon range, the field cleared, no rock. The ship auto-fires the bot — <b>Rusty (EASY) 70→53/70</b> over ${enemyDrain} draining frames (frame shown <b>60/70</b>). No ore squares under the ship — cargo pinned <b>0</b>. Tier 1 taken when it is the only target.` },
  { f: rockCrop, w: 480, title: 'ROCK alone (tier 2 — returns to rock)', body:
    `stageRockOnly: one rock in weapon range, every enemy parked far out & spawn-protected (no enemy bar on screen). With no hittable enemy the ladder falls to the rock — the ship mines it, one <b>yellow ore square</b> banked under the hull (<b>cargo 0→1</b>), firing the whole time. This is the fallback the CLUSTER frame withholds while an enemy is up.` },
];

const html = `<!doctype html><meta charset=utf8><body style="margin:0;background:#0a0d12;font-family:system-ui">
  <div style="color:#cfe0ff;padding:14px 18px 4px;font-size:15px;max-width:1180px">
    <b>auto-aim-enemies-first</b> — the player's auto-aim ladder (src/sim/step.ts <code>acquireAimTarget</code>) takes a hittable ENEMY (tier 1)
    ahead of a rock (tier 2), and falls to the rock when no enemy is hittable. Live <code>?debug=1</code> boot, build <code>${sha}</code>, tap scheme.
    No target-readout seam exists, so the target is proven by its EFFECT: an enemy hit ⇒ its health-bar drains; a rock mined ⇒ the hold cargo rises.
    <span style="color:#8fa">No seam can place a hittable enemy AND a rock in one frame (stageRockOnly parks enemies with 999&nbsp;s protection; stageAutoEngage clears the field),
    so tier 1 and tier 2 are shown deterministically, and the enemy-amid-rock case is shown live.</span>
  </div>
  <div style="display:flex;gap:10px;padding:8px 14px 16px;flex-wrap:wrap;align-items:flex-start">
    ${panels.map((p) => `<div class=p style="width:${p.w}px"><img src="data:image/png;base64,${b64(p.f)}" style="width:${p.w}px">
      <div class=t>${p.title}</div><div class=c>${p.body}</div></div>`).join('')}
  </div>
  <style>.p{background:#11151b;border-radius:6px;padding:8px}.p img{display:block;border-radius:4px}
  .t{color:#ffe14d;font-size:13px;font-weight:700;padding:8px 4px 2px}.c{color:#c8d2df;font-size:12px;line-height:1.55;padding:2px 4px 4px}
  .c b{color:#fff}.c i{color:#9fb3c8}</style></body>`;

const browser = await chromium.launch();
const pg = await (await browser.newContext({ viewport: { width: 1240, height: 1200 }, deviceScaleFactor: 1 })).newPage();
await pg.setContent(html, { waitUntil: 'load' });
await pg.waitForTimeout(200);
await (await pg.$('body')).screenshot({ path: join(OUT, 'autoaim-enemies-strip.png') });
await browser.close();
console.log('wrote autoaim-enemies-strip.png');
