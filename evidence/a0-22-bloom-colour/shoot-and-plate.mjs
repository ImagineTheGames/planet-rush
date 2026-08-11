/**
 * evidence/a0-22-bloom-colour/shoot-and-plate.mjs — the frames, and the crops.
 * OWNER: Art Agent.
 *
 * Two served bundles on two ports, the same frozen world, the same seed, the same
 * viewport — so every difference between the two columns is the tint and nothing
 * else. Three artefacts come out:
 *
 *  1. **`frame-<map>-<label>.png`** — the whole frame as a player sees it, world
 *     and all, at a real desktop viewport. This is the picture the developer
 *     judges the match on.
 *  2. **`plate-orbs-<map>.png`** — the bloomed stars the geometry read-back
 *     located, cut identically from both builds at 8× nearest neighbour and laid
 *     shipped-above / now-below. Nearest neighbour and no amplification: what is
 *     in these crops is what the GPU painted.
 *  3. **`plate-mockup-vs-now.png`** — the four bloom colours the developer's
 *     compositor page carried, against the three this build draws, each swatch
 *     composited at the alpha a bloom actually paints at. The two RESERVED ones
 *     are drawn and struck through, with the rule that bars them under each.
 *
 * The compositor page (`space-backdrop.html`) is the developer's own file and has
 * never been in this repo — a0-07 ratified off it without committing it. Its four
 * colours are taken from the a0-22 brief's measurement of it and the strip says
 * so on its face; nothing here claims to be a screenshot of that page.
 *
 *   node evidence/a0-22-bloom-colour/shoot-and-plate.mjs <shippedPort> <tintedPort>
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIPPED_PORT = process.argv[2] ?? '4923';
const TINTED_PORT = process.argv[3] ?? '4922';
const FRAMES = join(HERE, 'frames');
const PLATES = join(HERE, 'plates');

const VP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const DPR = VP.deviceScaleFactor;
const MAPS = [
  { id: 'octagon', sky: 'none' },
  { id: 'oval', sky: 'plasmaReef' },
];
const BUILDS = [
  { label: 'shipped', port: SHIPPED_PORT },
  { label: 'tinted', port: TINTED_PORT },
];

const settle = (page, n = 24) =>
  page.evaluate(
    (frames) =>
      new Promise((done) => {
        let i = 0;
        const tick = () => (++i < frames ? requestAnimationFrame(tick) : done());
        requestAnimationFrame(tick);
      }),
    n,
  );

async function shoot() {
  mkdirSync(FRAMES, { recursive: true });
  const browser = await chromium.launch();
  for (const b of BUILDS) {
    for (const map of MAPS) {
      const ctx = await browser.newContext(VP);
      await ctx.addInitScript(
        `try { localStorage.setItem('planet-rush:mapId', ${JSON.stringify(map.id)}); } catch (e) {}`,
      );
      const page = await ctx.newPage();
      await page.goto(`http://localhost:${b.port}/?debug=1&freeze=1`, { waitUntil: 'load' });
      await page.waitForFunction('!!globalThis.__planetRush', null, { timeout: 20000 });
      await settle(page, 30);
      await page.screenshot({ path: join(FRAMES, `frame-${map.id}-${b.label}.png`) });
      await ctx.close();
    }
  }
  await browser.close();
}

// --- plate helpers -----------------------------------------------------------

const read = (p) => PNG.sync.read(readFileSync(p));
const blank = (w, h, rgb = [8, 9, 12]) => {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    png.data[i * 4] = rgb[0];
    png.data[i * 4 + 1] = rgb[1];
    png.data[i * 4 + 2] = rgb[2];
    png.data[i * 4 + 3] = 255;
  }
  return png;
};

/** Copy a `size`×`size` window centred on (cx,cy) of `src`, scaled `k`× nearest
 *  neighbour, into `dst` at (dx,dy). No filtering and no amplification. */
function crop(src, cx, cy, size, k, dst, dx, dy) {
  const half = size / 2;
  for (let y = 0; y < size * k; y++) {
    for (let x = 0; x < size * k; x++) {
      const sx = Math.round(cx - half + Math.floor(x / k));
      const sy = Math.round(cy - half + Math.floor(y / k));
      const to = ((dy + y) * dst.width + (dx + x)) * 4;
      if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) {
        dst.data[to] = 0;
        dst.data[to + 1] = 0;
        dst.data[to + 2] = 0;
        dst.data[to + 3] = 255;
        continue;
      }
      const from = (sy * src.width + sx) * 4;
      dst.data[to] = src.data[from];
      dst.data[to + 1] = src.data[from + 1];
      dst.data[to + 2] = src.data[from + 2];
      dst.data[to + 3] = 255;
    }
  }
}

function rect(dst, x, y, w, h, rgb) {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const px = x + i;
      const py = y + j;
      if (px < 0 || py < 0 || px >= dst.width || py >= dst.height) continue;
      const o = (py * dst.width + px) * 4;
      dst.data[o] = rgb[0];
      dst.data[o + 1] = rgb[1];
      dst.data[o + 2] = rgb[2];
      dst.data[o + 3] = 255;
    }
  }
}

function frameRect(dst, x, y, w, h, rgb, t = 2) {
  rect(dst, x, y, w, t, rgb);
  rect(dst, x, y + h - t, w, t, rgb);
  rect(dst, x, y, t, h, rgb);
  rect(dst, x + w - t, y, t, h, rgb);
}

// A 5×7 bitmap font — enough to label a plate without shipping a font file.
const GLYPHS = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '11110', '10001', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '11110', '10000', '10000', '10000', '11111'],
  F: ['11111', '10000', '11110', '10000', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '11111', '10001', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  K: ['10001', '10010', '11100', '10100', '10010', '10001', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10001', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '11110', '10000', '10000', '10000', '10000'],
  R: ['11110', '10001', '11110', '10100', '10010', '10001', '10001'],
  S: ['01111', '10000', '01110', '00001', '00001', '10001', '01110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '01010', '00100', '00100', '00100', '01010', '10001'],
  Y: ['10001', '01010', '00100', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00010', '00100', '00100', '01000', '10000', '11111'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  3: ['11110', '00001', '00110', '00001', '00001', '10001', '01110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '01110', '10001', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ',': ['00000', '00000', '00000', '00000', '01100', '01100', '01000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '#': ['01010', '11111', '01010', '01010', '11111', '01010', '00000'],
  '%': ['11001', '11010', '00010', '00100', '01011', '10011', '00000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  '<': ['00010', '00100', '01000', '10000', '01000', '00100', '00010'],
  '>': ['01000', '00100', '00010', '00001', '00010', '00100', '01000'],
  '=': ['00000', '00000', '11111', '00000', '11111', '00000', '00000'],
  "'": ['00100', '00100', '00000', '00000', '00000', '00000', '00000'],
  '*': ['00000', '10101', '01110', '11111', '01110', '10101', '00000'],
};

function text(dst, str, x, y, rgb = [200, 208, 216], scale = 2) {
  let cx = x;
  for (const raw of str.toUpperCase()) {
    const g = GLYPHS[raw] ?? GLYPHS[' '];
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        if (g[r][c] === '1') rect(dst, cx + c * scale, y + r * scale, scale, scale, rgb);
      }
    }
    cx += 6 * scale;
  }
  return cx;
}

const unpack = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const overFloor = (c, a) => {
  const [r, g, b] = unpack(c);
  return [Math.round(a * r + (1 - a) * 1), Math.round(a * g + (1 - a) * 2), Math.round(a * b + (1 - a) * 4)];
};

// --- plate 1: the orbs, cut identically from both builds ---------------------

function orbPlate(mapId, report) {
  const A = read(join(FRAMES, `${mapId}-void-only.png`.replace(/^/, 'shipped/')));
  const B = read(join(FRAMES, `tinted/${mapId}-void-only.png`));
  // The bloomed stars the read-back located, biggest halo first, so the plate
  // shows the orbs a player actually notices rather than a random sample.
  const stars = report.maps
    .find((m) => m.map === mapId)
    .layers.filter((l) => l.label !== 'void-stars-deep')
    .flatMap((l) => l.bloomedStars.map((s) => ({ ...s, layer: l.label.replace('void-stars-', '') })))
    .sort((a, b) => b.outerR - a.outerR)
    .slice(0, 6);

  const K = 8;
  const WIN = 40; // device px window — a near halo is ~34 device px across
  const CELL = WIN * K;
  const PAD = 14;
  const TOP = 92;
  const w = PAD + stars.length * (CELL + PAD);
  const h = TOP + 2 * (CELL + 26) + PAD;
  const out = blank(w, h);
  text(out, `A0-22 BLOOM COLOUR - ${mapId} - THE ORBS, 8X NEAREST NEIGHBOUR, NO AMPLIFICATION`, PAD, 16);
  text(out, `TOP: SHIPPED 0F8FD05   BOTTOM: THIS BRANCH   SAME SEED, SAME FROZEN TICK, SAME PIXELS SAMPLED`, PAD, 40, [140, 150, 162]);
  text(out, `THE VOID ALONE - EVERY WORLD LAYER HIDDEN, SO NO ROCK CAN BE MISTAKEN FOR A STAR`, PAD, 62, [140, 150, 162]);
  stars.forEach((s, i) => {
    const x = PAD + i * (CELL + PAD);
    crop(A, s.x, s.y, WIN, K, out, x, TOP);
    crop(B, s.x, s.y, WIN, K, out, x, TOP + CELL + 26);
    frameRect(out, x, TOP, CELL, CELL, [46, 52, 60]);
    frameRect(out, x, TOP + CELL + 26, CELL, CELL, [46, 52, 60]);
    text(out, `${s.layer} ${s.haloDiameterCssPx.toFixed(0)}PX`, x + 2, TOP + CELL + 6, [140, 150, 162], 1);
    text(out, `CORE-HALO ${s.coreOverHalo?.toFixed(0) ?? '?'}`, x + 2, TOP + 2 * CELL + 32, [140, 150, 162], 1);
  });
  writeFileSync(join(PLATES, `plate-orbs-${mapId}.png`), PNG.sync.write(out));
}

// --- plate 2: the mockup's four colours against the three that ship ---------

function mockupPlate() {
  const SW = 190;
  const H = 150;
  const PAD = 18;
  const mock = [
    { hex: 0x4dc3ff, name: 'PLASMA CYAN', note: 'SHIPS - THIS IS THE TINT', ok: true },
    { hex: 0x7e8894, name: 'HULL STEEL', note: 'SHIPS - THE RAMP, UNCHANGED', ok: true },
    { hex: 0xf2d24b, name: 'SIGNAL YELLOW', note: 'BARRED AT ANY ALPHA - 2.2 CLAUSE 3', ok: false },
    { hex: 0xb23a3a, name: 'THREAT RED', note: 'CEILING 0.06 - A BLOOM IS 0.042-0.147', ok: false },
  ];
  const now = [
    { hex: 0x4dc3ff, alpha: 0.1408, name: 'PLASMA CYAN', note: 'MID 0.70 AND NEAR 0.88' },
    { hex: 0x4fa08b, alpha: 0.1472, name: 'PATINA TEAL', note: 'NEAR 0.92' },
    { hex: 0xffffff, alpha: 0.1024, name: 'THE STEEL RAMP', note: 'DEEP, MID AND NEAR' },
  ];
  const w = Math.max(PAD + Math.max(mock.length, now.length) * (SW + PAD), 1010);
  const h = 96 + 2 * (H + 60) + PAD;
  const out = blank(w, h, [4, 5, 7]);
  text(out, 'A0-22 - THE MOCKUP BLOOM COLOURS, AND THE ONES THAT SHIP', PAD, 16);
  text(out, "SWATCHES ARE COMPOSITED OVER FLOOR AT A BLOOM'S OWN ALPHA - NOT AT FULL VALUE", PAD, 38, [140, 150, 162]);
  text(out, 'THE COMPOSITOR PAGE IS THE DEVELOPERS OWN FILE AND IS NOT IN THIS REPO', PAD, 58, [140, 150, 162]);
  text(out, 'ITS FOUR COLOURS ARE THE A0-22 BRIEFS MEASUREMENT OF IT', PAD, 76, [140, 150, 162]);

  let y = 96;
  text(out, 'THE MOCKUP ASKED FOR', PAD, y, [200, 208, 216], 2);
  y += 24;
  mock.forEach((m, i) => {
    const x = PAD + i * (SW + PAD);
    rect(out, x, y, SW, H, overFloor(m.hex, 0.1408));
    frameRect(out, x, y, SW, H, m.ok ? [60, 120, 90] : [150, 60, 60]);
    if (!m.ok) {
      // struck through, so the plate cannot be misread at a glance
      for (let t = 0; t < H; t++) rect(out, x + Math.round((t * SW) / H) - 1, y + t, 3, 1, [190, 70, 70]);
    }
    text(out, m.name, x + 4, y + H + 6, m.ok ? [150, 200, 175] : [200, 130, 130], 1);
    text(out, m.note, x + 4, y + H + 18, [130, 140, 150], 1);
    text(out, `#${m.hex.toString(16).padStart(6, '0')}`, x + 4, y + H + 30, [110, 120, 130], 1);
  });

  y += H + 60;
  text(out, 'WHAT THIS BRANCH DRAWS', PAD, y, [200, 208, 216], 2);
  y += 24;
  now.forEach((m, i) => {
    const x = PAD + i * (SW + PAD);
    rect(out, x, y, SW, H, overFloor(m.hex, m.alpha));
    frameRect(out, x, y, SW, H, [60, 120, 90]);
    // the star that sits in it, at the size and value it actually paints
    rect(out, x + SW / 2 - 3, y + H / 2 - 3, 6, 6, [255, 255, 255]);
    text(out, m.name, x + 4, y + H + 6, [150, 200, 175], 1);
    text(out, m.note, x + 4, y + H + 18, [130, 140, 150], 1);
    text(out, `#${m.hex.toString(16).padStart(6, '0')} A ${m.alpha.toFixed(3)}`, x + 4, y + H + 30, [110, 120, 130], 1);
  });
  writeFileSync(join(PLATES, 'plate-mockup-vs-now.png'), PNG.sync.write(out));
}

// --- plate 3: the size ladder that answers "there are no stars in them" ------

function ladderPlate(shipped) {
  const rows = [];
  for (const m of shipped.maps) {
    for (const l of m.layers) {
      rows.push({
        what: `BLOOM HALO, ${l.label.replace('void-stars-', '')} (${m.map})`,
        d: l.medianHaloDiameterCssPx,
        star: `YES - CORE Y' ${l.medianCorePeak}, ${l.medianCoreOverHalo} OVER ITS OWN HALO`,
        good: true,
      });
    }
    for (const s of m.skyDiscs ?? []) {
      rows.push({
        what: `${s.label.replace('void-nebula-', 'SKY DISC, MEDIAN OF ')} (${m.map})`,
        d: s.medianDiameterCssPx,
        star: `NO - A NEBULA DISC HAS NO STAR, BY CONSTRUCTION (${s.discs} OF THEM)`,
        good: false,
      });
      rows.push({
        what: `${s.label.replace('void-nebula-', 'SKY DISC, LARGEST ')} (${m.map})`,
        d: s.maxDiameterCssPx,
        star: 'NO - THE SKYS BASE WASH, WIDER THAN THE WHOLE PLATE',
        good: false,
      });
    }
  }
  rows.push({ what: 'ASTEROID (A1-07, GROUND-ONLY FRAME)', d: 62.7, star: 'NO - IT IS A ROCK', good: false });
  rows.sort((a, b) => a.d - b.d);

  const PAD = 18;
  const ROW = 46;
  const SCALE = 1.9; // css px → plate px, so the bars are the real size ratio
  const w = 1180;
  const h = 108 + rows.length * ROW + PAD;
  const out = blank(w, h, [4, 5, 7]);
  text(out, 'A0-22 - "THERE ARE NO STARS IN THEM" - THE ROUND SOFT THINGS IN A FRAME, BY SIZE', PAD, 16);
  text(out, 'MEDIAN DIAMETER IN CSS PX AT 1440X900, MEASURED OFF THE RUNNING BUILD 0F8FD05', PAD, 38, [140, 150, 162]);
  text(out, 'BARS ARE TO SCALE WITH EACH OTHER. GREEN = HAS A STAR IN IT. RED = HAS NONE.', PAD, 58, [140, 150, 162]);
  text(out, 'A BLOOM IS THE SMALLEST THING HERE AND THE ONLY ONE WITH A STAR IN IT.', PAD, 78, [140, 150, 162]);
  rows.forEach((r, i) => {
    const y = 108 + i * ROW;
    const bar = Math.max(3, Math.round(Math.min(r.d, 300) * SCALE));
    rect(out, PAD, y + 8, bar, 16, r.good ? [70, 150, 120] : [150, 70, 70]);
    if (r.d > 300) text(out, '>>', PAD + bar + 4, y + 9, [150, 70, 70], 2);
    text(out, `${r.d.toFixed(1)} PX  ${r.what}`, PAD, y + 28, [200, 208, 216], 1);
    text(out, r.star, PAD + 420, y + 28, r.good ? [140, 200, 175] : [200, 140, 140], 1);
  });
  writeFileSync(join(PLATES, 'plate-size-ladder.png'), PNG.sync.write(out));
}

async function main() {
  mkdirSync(PLATES, { recursive: true });
  await shoot();
  const shipped = JSON.parse(readFileSync(join(HERE, 'star-in-bloom.shipped.json'), 'utf8'));
  for (const map of MAPS) orbPlate(map.id, shipped);
  mockupPlate();
  ladderPlate(shipped);
  console.log('plates written to', PLATES);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
