/**
 * evidence/a2-03-cutterhead/probe-facility-palette.mjs — the facility, measured
 * against the board it was picked from. OWNER: Art Agent (brief a2-03).
 *
 * The brief: *"Judge it against the board with measured pixels, not impressions …
 * If your facility's palette diverges from D, say so with numbers and justify it,
 * or match it."* a3-01 is the reason that sentence exists — the live scene read
 * luminance 154 on rock where the board read 77, and nobody noticed until it was
 * measured.
 *
 * So this shoots three things and counts:
 *
 *  - **the board** — `#dir-d`'s live-at-rest card in `facility-concepts-r2.html`,
 *    from the file:// source in the repo;
 *  - **the sprite** — `stationSprite()` from this branch, through the same
 *    `spriteToSvg` → Chromium path at the same scale. This is the like-for-like
 *    half, and it is where the palette claim is made;
 *  - **the build** — the frozen debug scene on a preview of this branch, cropped
 *    to the home.
 *
 * and reports, for each, the colour histogram of the cropped body with every
 * colour resolved to its nearest palette token, plus BT.601 luminance. A colour
 * that is not a token, or a token whose luminance is far from the board's tone for
 * the same part, is the finding. Nothing is smoothed: these are raw pixel counts.
 *
 * **Read the LIVE column knowing what is on top of it.** The frozen scene's home
 * has two shield generators standing, and a shield is a translucent plasma bubble
 * over the whole body (`shieldSprite`), inside the collection-field haze. So every
 * live sample is composited under plasma and lands ~20/255 toward blue of the
 * token underneath it. That is the shield doing its job, not the station drifting:
 * the LIVE column is here to show that the same *structure* reaches the screen,
 * and the SPRITE column is what the palette is audited against.
 *
 *   node evidence/a2-03-cutterhead/probe-facility-palette.mjs [previewPort]
 *
 * Writes evidence/a2-03-cutterhead/palette-readback.json and two crops beside it.
 */
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const PORT = Number(process.argv[2] ?? process.env.A2_03_PREVIEW_PORT ?? 4291);

/** The palette, as the audit knows it (kept literal so this runs standalone). */
const TOKENS = {
  vacuum: 0x0d1015,
  hullSteel: 0x7e8894,
  patina: 0x4fa08b,
  signalYellow: 0xf2d24b,
  plasma: 0x4dc3ff,
  threatRed: 0xb23a3a,
  hullLight: 0xa5acb4,
  hullShadow: 0x515861,
  hullDark: 0x383e45,
  decalInk: 0x262a31,
  hullWell: 0x2d3239,
  rockBody: 0x484e57,
  rockShadow: 0x40474f,
  rockFissure: 0x272c32,
  continentShade: 0x36695e,
  continentLight: 0x72b3a2,
  oreDeep: 0x9b8836,
  coreHot: 0xf7e28a,
  wreckBody: 0x2f343b,
  wreckCrust: 0x40464e,
  white: 0xffffff,
};

const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const hex = (n) => '#' + n.toString(16).padStart(6, '0').toUpperCase();

function nearestToken(r, g, b) {
  let best = null;
  let bestD = Infinity;
  for (const [name, v] of Object.entries(TOKENS)) {
    const d = Math.hypot(r - ((v >> 16) & 255), g - ((v >> 8) & 255), b - (v & 255));
    if (d < bestD) { bestD = d; best = name; }
  }
  return { token: best, distance: Math.round(bestD) };
}

/** Top-N colours in a crop, with their nearest token and luminance. */
function histogram(png, top = 14) {
  const counts = new Map();
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i + 3] < 200) continue;
    const key = (png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([c, n]) => {
      const [r, g, b] = [(c >> 16) & 255, (c >> 8) & 255, c & 255];
      return {
        hex: hex(c),
        share: +((100 * n) / total).toFixed(2),
        luma: +luma(r, g, b).toFixed(1),
        ...nearestToken(r, g, b),
      };
    });
}

function crop(buf, cx, cy, half) {
  const src = PNG.sync.read(buf);
  const out = new PNG({ width: half * 2, height: half * 2 });
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const si = ((cy - half + y) * src.width + (cx - half + x)) << 2;
      const di = (y * out.width + x) << 2;
      for (let c = 0; c < 4; c++) out.data[di + c] = src.data[si + c] ?? 0;
    }
  }
  return out;
}

const browser = await chromium.launch();
mkdirSync(HERE, { recursive: true });

// --- the board -------------------------------------------------------------
const boardPage = await browser.newPage({ viewport: { width: 1240, height: 1000 }, deviceScaleFactor: 2 });
await boardPage.goto('file://' + join(REPO, 'docs/art-direction/facility-concepts-r2.html'));
await boardPage.evaluate(() => document.fonts?.ready).catch(() => {});
// The live-at-rest card's own <svg>, so the crop is the drawing and not the card
// chrome. The body sits at the SVG's centre, drawn at scale 1.7 on a 1000x630 box.
const boardSvg = await boardPage.$('#dir-d .card.wide svg');
const boardShot = await boardSvg.screenshot();
const bs = PNG.sync.read(boardShot);
const boardCrop = crop(boardShot, Math.round(bs.width * 0.5), Math.round(bs.height * (300 / 630)), Math.round(bs.width * 0.09));
writeFileSync(join(HERE, 'board-d-body.png'), PNG.sync.write(boardCrop));

// --- the sprite, through the same SVG-in-Chromium path as the board ---------
// Same renderer, same rasteriser, same scale: what is left is the drawing.
const { stationSprite } = await import(join(REPO, 'src/art/stations.ts'));
const { spriteToSvg } = await import(join(REPO, 'src/art/svg.ts'));
const SPRITE_PX = 1000; // the board's card is 1000 wide; body = 0.9 of it there
const spritePage = await browser.newPage({ viewport: { width: SPRITE_PX, height: SPRITE_PX }, deviceScaleFactor: 2 });
await spritePage.setContent(
  `<body style="margin:0;background:#0D1015">${spriteToSvg(stationSprite(0, 0), SPRITE_PX)}</body>`,
);
const spriteShot = await spritePage.screenshot();
const sp = PNG.sync.read(spriteShot);
// The sprite is authored at extent 1.95, so the body (radius 1) is 1/1.95 of the
// half-width. Crop the same fraction of the body the board crop takes.
const spriteCrop = crop(spriteShot, sp.width >> 1, sp.height >> 1, Math.round((sp.width / 2 / 1.95) * 0.92));
writeFileSync(join(HERE, 'sprite-facility-body.png'), PNG.sync.write(spriteCrop));

// --- the build -------------------------------------------------------------
const gamePage = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await gamePage.goto(`http://localhost:${PORT}/?debug=1&freeze=1`);
await gamePage.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
await gamePage.waitForFunction(() => window.__planetRush?.frozen === true, null, { timeout: 30_000 });
await gamePage.evaluate(() => document.fonts?.ready).catch(() => {});
await gamePage.waitForTimeout(2000);
const gameShot = await gamePage.screenshot();
// The frozen home sits at the viewport centre-ish; the station is 128 world units
// across at 1:1, so a 100px half-crop at dpr 2 is the body and a little vacuum.
const gameCrop = crop(gameShot, 1470, 810, 100);
writeFileSync(join(HERE, 'live-facility-body.png'), PNG.sync.write(gameCrop));

await browser.close();

const readback = {
  what: 'Direction D (facility-concepts-r2.html) vs the shipped facility body, by pixel count',
  note: 'LIVE is composited under two plasma shield bubbles and the collection-field haze; SPRITE is the like-for-like half.',
  board: histogram(boardCrop),
  sprite: histogram(spriteCrop),
  live: histogram(gameCrop),
};
writeFileSync(join(HERE, 'palette-readback.json'), JSON.stringify(readback, null, 2) + '\n');

const table = (rows) => {
  console.log('  hex        share   luma  nearest token (distance)');
  for (const r of rows) {
    console.log(`  ${r.hex}  ${String(r.share).padStart(5)}%  ${String(r.luma).padStart(5)}  ${r.token} (${r.distance})`);
  }
};
console.log('\nBOARD — direction D, live at rest');
table(readback.board);
console.log('\nSPRITE — stationSprite() on this branch, same path, same scale');
table(readback.sprite);
console.log('\nLIVE — the frozen scene (under two shield bubbles — see the header)');
table(readback.live);

/**
 * A colour that is not a token may still be legal: a translucent shape composites
 * with what is under it, and both halves being tokens is the whole rule. So the
 * verdict tests "token, or a blend of two tokens" rather than "token" — otherwise
 * every deliberate `alpha` in the sprite reads as a violation, and the board's own
 * histogram would fail its own audit (it carries `#7C7E70` and `#737466` for the
 * same reason: signal yellow at low alpha over steel).
 */
const ENTRIES = Object.entries(TOKENS);
function explain(hexStr) {
  const v = parseInt(hexStr.slice(1), 16);
  const [r, g, b] = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  const direct = nearestToken(r, g, b);
  if (direct.distance <= 6) return { kind: 'token', as: direct.token, distance: direct.distance };
  let best = null;
  for (const [an, av] of ENTRIES) {
    for (const [bn, bv] of ENTRIES) {
      if (an === bn) continue;
      for (let t = 1; t < 20; t++) {
        const k = t / 20;
        const mr = ((av >> 16) & 255) + (((bv >> 16) & 255) - ((av >> 16) & 255)) * k;
        const mg = ((av >> 8) & 255) + (((bv >> 8) & 255) - ((av >> 8) & 255)) * k;
        const mb = (av & 255) + ((bv & 255) - (av & 255)) * k;
        const d = Math.hypot(r - mr, g - mg, b - mb);
        if (!best || d < best.distance) best = { kind: 'blend', as: `${an} + ${bn} @${k.toFixed(2)}`, distance: Math.round(d) };
      }
    }
  }
  return best;
}

console.log('\nEvery sprite colour, explained:');
let unexplained = 0;
for (const row of readback.sprite) {
  const e = explain(row.hex);
  if (e.distance > 6) unexplained++;
  console.log(`  ${row.hex}  ${e.kind.padEnd(5)}  ${e.as} (${e.distance})`);
}
console.log(
  unexplained === 0
    ? '\nVERDICT: every measured sprite colour is a palette token or a composite of two — no seventh hue (style-guide §1).'
    : `\nVERDICT: ${unexplained} sprite colour(s) are neither a token nor a two-token composite.`,
);
