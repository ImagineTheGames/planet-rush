/**
 * evidence/build-figures.mjs — round-10: compose the captioned deliverable images
 * from the analysed crops. OWNER: QA Manager. Renders an HTML montage and
 * screenshots it (proper text captions with tick numbers). Read-only over the
 * already-captured PNGs; adds no interpretation to the frames themselves.
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const b64 = (p) => 'data:image/png;base64,' + readFileSync(p).toString('base64');

const TURRET_PANELS = [
  { img: '/tmp/panel_i0.png', tick: 15702, cap: 'REST — both turrets sit at their mount (home) angles, NE & SE rim, barrels radially outward. No attacker in range. Core 93.' },
  { img: '/tmp/panel_i12.png', tick: 15986, cap: 'A besieger arrives: Sable (orange) closes from the south, d≈204. Bots deciding for themselves — nothing placed.' },
  { img: '/tmp/panel_i14.png', tick: 16036, cap: 'A turret has SLID to the south rim, barrel aimed down onto Sable (d≈103). The NE mount is now vacated.' },
  { img: '/tmp/panel_i18.png', tick: 16131, cap: 'Both turrets slid onto the EAST rim, barrels converged east, tracking Sable as it circles the planet (d≈307).' },
  { img: '/tmp/panel_i34.png', tick: 16499, cap: 'Sable driven off; both turrets have returned to their NE & SE rest angles. Engagement was threat-driven.' },
];

function figureHTML(title, subtitle, panels, cols) {
  const cells = panels.map((p) => `
    <figure>
      <img src="${b64(p.img)}"/>
      <figcaption><span class="t">tick ${p.tick}</span> ${p.cap}</figcaption>
    </figure>`).join('');
  return `<!doctype html><html><head><meta charset="utf8"><style>
    :root{color-scheme:dark}
    body{margin:0;background:#0a0c10;color:#dce3ec;font:15px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;padding:26px}
    h1{font-size:22px;margin:0 0 4px}
    .sub{color:#8b96a5;font-size:13px;margin:0 0 20px;max-width:1400px}
    .grid{display:grid;grid-template-columns:repeat(${cols},1fr);gap:14px;max-width:${cols * 340 + (cols - 1) * 14}px}
    figure{margin:0;background:#11151b;border:1px solid #1e2530;border-radius:8px;overflow:hidden}
    img{width:100%;display:block}
    figcaption{padding:9px 11px;font-size:12.5px;color:#b9c2cf}
    .t{display:inline-block;background:#1b3a6b;color:#cfe0ff;border-radius:4px;padding:1px 7px;font-weight:600;margin-right:6px;font-variant-numeric:tabular-nums}
  </style></head><body>
    <h1>${title}</h1>
    <p class="sub">${subtitle}</p>
    <div class="grid">${cells}</div>
  </body></html>`;
}

async function main() {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1820, height: 1000 }, deviceScaleFactor: 2 })).newPage();

  // turret-natural-siege
  const html = figureHTML(
    'turret-natural-siege — a turret slides from its rest angle to engage a naturally-arrived attacker',
    'Build 038457b. Live ?debug=1 natural match (fixed seed), local ship idle at home, wide 1:1 follow-camera. NO staging: no placed attacker, no core/ship damage seam — the eight-planet ring fights on its own. Warden (P7) home, its two rim turrets, and the bot Sable (P5) besieging it. Frames are one continuous capture; ticks are the sim’s own clock (window.__planetRush.ticks).',
    TURRET_PANELS, 5);
  const file = '/tmp/fig_turret.html';
  writeFileSync(file, html);
  await page.goto('file://' + file, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  const grid = await page.$('.grid');
  const box = await page.evaluate(() => { const b = document.body.getBoundingClientRect(); return { w: Math.ceil(b.width), h: Math.ceil(document.body.scrollHeight) }; });
  await page.setViewportSize({ width: Math.min(1820, box.w + 52), height: box.h + 52 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(OUT, 'turret-natural-siege.png'), fullPage: true });
  console.log('wrote turret-natural-siege.png');

  // turret-natural-siege-fire — seam-certain muzzle corroboration (same deterministic
  // seed/match, run capture-round10). window.__planetRush.beams reports the turret
  // muzzle: shooter (== planet owner), origin (rim pixel) and end/hit (what it fires at).
  const FIRE_PANELS = [
    { img: '/tmp/fire_i8.png', tick: 16269, cap: 'Both P7 turret muzzles fire EAST — beams origin (1218,700)/(1222,665) → end (1418,711)/(1419,709), hit=true — onto besieger Sable (P5) at (1434,687). A projectile is in flight.' },
    { img: '/tmp/fire_i17.png', tick: 16587, cap: 'Turrets have slid SOUTH — muzzles fire to (1179,903)/(1185,902), hit=true — onto a second naturally-arrived attacker, Foreman (P3), below the planet.' },
  ];
  const html2 = figureHTML(
    'turret-natural-siege (instrument corroboration) — turrets FIRE on the attacker, read from window.__planetRush.beams',
    'Build 038457b, same fixed-seed natural match. The beams seam reports every firing emitter’s muzzle: for shooter===7 (Warden) it gives origin (the turret’s rim pixel) and end/hit (its target). Not a placed fixture — the sim’s own combat state. Barrels + in-flight projectile in the screenshot match the seam readout quoted below each frame.',
    FIRE_PANELS, 2);
  const file2 = '/tmp/fig_fire.html';
  writeFileSync(file2, html2);
  await page.goto('file://' + file2, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  const box2 = await page.evaluate(() => ({ w: Math.ceil(document.body.getBoundingClientRect().width), h: document.body.scrollHeight }));
  await page.setViewportSize({ width: Math.min(1820, box2.w + 52), height: box2.h + 52 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(OUT, 'turret-natural-siege-fire.png'), fullPage: true });
  console.log('wrote turret-natural-siege-fire.png');

  // player-nameplates
  const NP_PANELS = [
    { img: '/tmp/np_warden.png', tick: 780, cap: 'Bot “Warden” (P7, slate-blue #5c6ce0) named over BOTH its ship (lower-left) and its home planet (upper-right) — same name, and the label colour matches the ship trim AND the planet ring. HP bars sit above the labels.' },
    { img: '/tmp/np_rusty.png', tick: 780, cap: 'Bot “Rusty” (P1, cyan #22d3c5) named over its ship AND its planet — same identity colour on both.' },
    { img: '/tmp/np_you.png', tick: 780, cap: 'Local player “YOU” (P0, azure #3d7bff) named over the home planet. Own-SHIP label is intentionally OFF by design (follow-camera pins the local ship centre-screen with its own HP bar) — the local ship (grey, azure cockpit) is unlabeled.' },
    { img: '/tmp/np_bars.png', tick: 16036, cap: 'A damaged bot ship mid-match (Sable, P5, orange): the name label sits clear ABOVE its HP bar — labels never obstruct bars (and fade under combat).' },
  ];
  const html3 = figureHTML(
    'player-nameplates — personality names over ships and owned planets, identity colours matching, bars unobstructed',
    'Build 038457b, live ?debug=1 natural match, wide 1:1 follow-camera. Panels 1–3 at tick 780; panel 4 mid-match. Names are the seated cast: window.__nameplateStage.names() = ["YOU","Rusty","Bolt","Foreman","Patch","Sable","Vulture","Warden"]; each label’s colour equals that owner’s roster identity colour (verified against the drawn plate colours). NOTE, reported as-is not staged: the brief asks for the local name “over their own ship”, but the shipped design places it over the local PLANET and suppresses the own-ship label by default.',
    NP_PANELS, 4);
  const file3 = '/tmp/fig_np.html';
  writeFileSync(file3, html3);
  await page.goto('file://' + file3, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  const box3 = await page.evaluate(() => ({ w: Math.ceil(document.body.getBoundingClientRect().width), h: document.body.scrollHeight }));
  await page.setViewportSize({ width: Math.min(1820, box3.w + 52), height: box3.h + 52 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(OUT, 'player-nameplates.png'), fullPage: true });
  console.log('wrote player-nameplates.png');

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
