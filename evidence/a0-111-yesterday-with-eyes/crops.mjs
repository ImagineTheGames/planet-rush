/**
 * evidence/a0-111-yesterday-with-eyes/crops.mjs — the magnified details.
 * OWNER: QA Manager (a0-111).
 *
 * Some of what this brief has to attest to is a few dozen pixels across: whether
 * anything is drawn behind the ore counter, whether a rival's nameplate is
 * landing on it. A full 2560x1600 frame shrunk onto a plate cannot show that, and
 * a reader should not have to take a magnifying glass to a PNG on trust.
 *
 * So: nearest-neighbour magnification of a stated rectangle of a stated frame,
 * and nothing else. No filtering (a smoothed crop is a crop that has invented
 * pixels), no annotation, no drawing over the specimen. Every crop's source file
 * and rectangle is in the table below and is repeated in the plate caption, so
 * any crop here can be re-cut from the committed frame it came from.
 *
 * Rectangles are in PHYSICAL pixels of the source PNG (the profiles are dpr 2, so
 * a logical 16px margin is 32px here).
 *
 *   node evidence/a0-111-yesterday-with-eyes/crops.mjs
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'shots');
const OUT = join(HERE, 'crops');

/** One magnified rectangle, nearest-neighbour. */
function crop(src, { x, y, w, h, scale }) {
  const png = PNG.sync.read(readFileSync(join(SHOTS, src)));
  const out = new PNG({ width: w * scale, height: h * scale });
  for (let j = 0; j < h * scale; j++) {
    for (let i = 0; i < w * scale; i++) {
      const sx = Math.min(png.width - 1, x + Math.floor(i / scale));
      const sy = Math.min(png.height - 1, y + Math.floor(j / scale));
      const si = (png.width * sy + sx) * 4;
      const di = (out.width * j + i) * 4;
      out.data[di] = png.data[si];
      out.data[di + 1] = png.data[si + 1];
      out.data[di + 2] = png.data[si + 2];
      out.data[di + 3] = 255;
    }
  }
  return out;
}

/** Several crops laid side by side with a hairline between them, so a comparison
 *  is one image rather than an instruction to open two. */
function strip(parts, gap = 8) {
  const height = Math.max(...parts.map((p) => p.height));
  const width = parts.reduce((n, p) => n + p.width, 0) + gap * (parts.length - 1);
  const out = new PNG({ width, height });
  out.data.fill(0);
  for (let i = 0; i < out.data.length; i += 4) out.data[i + 3] = 255;
  let x0 = 0;
  for (const p of parts) {
    for (let j = 0; j < p.height; j++) {
      for (let i = 0; i < p.width; i++) {
        const si = (p.width * j + i) * 4;
        const di = (out.width * j + (x0 + i)) * 4;
        out.data[di] = p.data[si];
        out.data[di + 1] = p.data[si + 1];
        out.data[di + 2] = p.data[si + 2];
        out.data[di + 3] = 255;
      }
    }
    x0 += p.width + gap;
  }
  return out;
}

const CROPS = [
  // The ore counter over the busiest background the sweep found, and over the
  // emptiest, so the ground can be judged against both.
  {
    out: 'ore-counter-over-a-station.png',
    parts: [
      ['desktop-1280x800-ore-stop-10.png', { x: 0, y: 0, w: 260, h: 220, scale: 4 }],
      ['desktop-1280x800-ore-stop-2.png', { x: 0, y: 0, w: 260, h: 220, scale: 4 }],
    ],
  },
  // The word ORE and a rival's nameplate, on the same pixels.
  {
    out: 'ore-counter-and-a-rival-nameplate.png',
    parts: [['desktop-1280x800-ore-stop-7.png', { x: 20, y: 30, w: 290, h: 130, scale: 5 }]],
  },
  // The phone minimap's bottom-right corner against the screen's own corner.
  {
    out: 'phone-minimap-bottom-right-corner.png',
    parts: [['phone-798x384-minimap-corner.png', { x: 1330, y: 520, w: 266, h: 248, scale: 3 }]],
  },
  // The locked FIRE MODE row beside the live CONTROLS row under it.
  {
    out: 'fire-mode-locked-row.png',
    parts: [['desktop-1280x800-fire-1-at-rest.png', { x: 590, y: 375, w: 1400, h: 280, scale: 1 }]],
  },
  // The refusal's DOM buttons, and the doors underneath them.
  {
    out: 'host-refusal-over-the-doors.png',
    parts: [['phone-798x384-join-3-host.png', { x: 690, y: 225, w: 520, h: 200, scale: 3 }]],
  },
  // The arrow, and the wave clock it is drawn across.
  {
    out: 'under-attack-arrow-and-wave-clock.png',
    parts: [['phone-798x384-under-attack-off-screen.png', { x: 590, y: 20, w: 460, h: 120, scale: 3 }]],
  },
];

mkdirSync(OUT, { recursive: true });
for (const c of CROPS) {
  const parts = c.parts.map(([src, rect]) => crop(src, rect));
  const img = parts.length === 1 ? parts[0] : strip(parts);
  writeFileSync(join(OUT, c.out), PNG.sync.write(img));
  console.log(`${c.out} ${img.width}x${img.height}`);
}
