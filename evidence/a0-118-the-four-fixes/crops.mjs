/**
 * evidence/a0-118-the-four-fixes/crops.mjs — the magnified details, and the
 * before/after pairs. OWNER: QA Manager (a0-118).
 *
 * Most of what this brief has to attest to is a few dozen pixels across: whether
 * a nameplate is landing in the ore counter, whether a DOM button is sitting on
 * the word HOST, whether an arrow is covering the A of WAVE. A full 2560x1600
 * frame shrunk onto a plate cannot show that.
 *
 * So: nearest-neighbour magnification of a stated rectangle of a stated frame,
 * and nothing else. No filtering (a smoothed crop is a crop that has invented
 * pixels), no annotation, no drawing over the specimen. Every crop's source file
 * and rectangle is in the table below and is repeated in the plate caption, so
 * any crop here can be re-cut from the committed frame it came from.
 *
 * THE BEFORE FRAMES ARE a0-111'S OWN COMMITTED FRAMES, cut at the SAME rectangle
 * and the SAME scale as the after. That is the point of the brief — the two runs
 * used the same profiles and the same staging, so the same rectangle of the two
 * frames is a fair comparison and not a rhetorical one. `src` may therefore name
 * either directory; the caption always says which run a panel came from.
 *
 * Rectangles are in PHYSICAL pixels of the source PNG (the profiles are dpr 2, so
 * a logical 16px margin is 32px here).
 *
 *   node evidence/a0-118-the-four-fixes/crops.mjs
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'shots');
const BEFORE = resolve(HERE, '../a0-111-yesterday-with-eyes/shots');
const OUT = join(HERE, 'crops');

/** Resolve a source name: `a0-111:` prefixed names come from that brief's shots. */
function sourcePath(src) {
  return src.startsWith('a0-111:') ? join(BEFORE, src.slice('a0-111:'.length)) : join(SHOTS, src);
}

/** One magnified rectangle, nearest-neighbour. */
function crop(src, { x, y, w, h, scale }) {
  const png = PNG.sync.read(readFileSync(sourcePath(src)));
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
  // 1. The headline and the line under it. a0-111's frame beside this run's, the
  //    same rectangle of the same profile, so the two sentences can be read
  //    against each other.
  {
    out: 'draw-headline-before-and-after.png',
    parts: [
      ['a0-111:desktop-1280x800-end-draw.png', { x: 230, y: 450, w: 810, h: 310, scale: 2 }],
      ['desktop-1280x800-draw-eight-at-once.png', { x: 230, y: 450, w: 810, h: 310, scale: 2 }],
    ],
  },
  // 2. The refusal and the doors under it — a0-111's rectangle (it cut x690 y225
  //    w520 h200 at 3x to show DOWNLOAD LOG on the word HOST), widened to take in
  //    the whole strip and the top row of doors on both frames.
  {
    out: 'host-refusal-before-and-after.png',
    parts: [
      ['a0-111:phone-798x384-join-3-host.png', { x: 620, y: 190, w: 660, h: 320, scale: 2 }],
      ['phone-798x384-host-1-refused.png', { x: 620, y: 190, w: 660, h: 320, scale: 2 }],
    ],
  },
  // 3. The ore counter, at a0-111's own crop rectangle on a0-111's own worst
  //    frame — desktop stop 7, where `Rusty (EASY)` was drawn across the word ORE.
  {
    out: 'ore-counter-before-and-after.png',
    parts: [
      ['a0-111:desktop-1280x800-ore-stop-7.png', { x: 20, y: 30, w: 290, h: 130, scale: 4 }],
      ['desktop-1280x800-ore-stop-7.png', { x: 20, y: 30, w: 290, h: 130, scale: 4 }],
    ],
  },
  // 4. The top-centre band, where the wave clock is drawn and where a0-111 found
  //    the red arrow sitting on it — *"it covers the A of WAVE and most of the
  //    V"*. a0-111's arrow rect on this profile was x500.4 y13.9 w19.8 h24.7
  //    logical, i.e. x1001 y28 physical at dpr 2, so this band takes in both the
  //    arrow's position and the centre of the glass where the clock strip sits.
  //    Same rectangle, same scale, on a0-111's frame and on this run's.
  {
    out: 'alarm-arrow-before-and-after.png',
    parts: [
      ['a0-111:desktop-1280x800-under-attack-off-screen.png', { x: 850, y: 0, w: 900, h: 200, scale: 3 }],
      ['desktop-1280x800-arrow-0-a0111-bearing.png', { x: 850, y: 0, w: 900, h: 200, scale: 3 }],
    ],
  },
  // 5. The same band on the PHONE, which is the frame a0-111's verdict is written
  //    from — *"the red arrow covers the A of WAVE"*. Three panels, same
  //    rectangle and scale throughout: a0-111's frame; this run at a0-111's own
  //    bearing; and this run at the WORST bearing the eight-tap sweep could find,
  //    sweep stop 1, where the arrow's centre stands 1.8 logical px from the
  //    horizontal centre of the glass — i.e. dead centre of the top edge, right
  //    under the clock.
  {
    out: 'alarm-arrow-phone-before-and-after.png',
    parts: [
      ['a0-111:phone-798x384-under-attack-off-screen.png', { x: 500, y: 0, w: 600, h: 220, scale: 3 }],
      ['phone-798x384-arrow-0-a0111-bearing.png', { x: 500, y: 0, w: 600, h: 220, scale: 3 }],
      ['phone-798x384-arrow-sweep-1.png', { x: 500, y: 0, w: 600, h: 220, scale: 3 }],
    ],
  },
  // 6. NOT one of the four fixes — something this run's frames show that a0-111's
  //    did not. Desktop ore stop 7 drew TWO plates, both owner 1, both reading
  //    "Rusty", and they land on each other. Same frame as panel 3's right half,
  //    cut wider and to the right so both labels are in view at once.
  {
    out: 'two-nameplates-on-the-same-pixels.png',
    parts: [['desktop-1280x800-ore-stop-7.png', { x: 120, y: 55, w: 620, h: 80, scale: 4 }]],
  },
];

mkdirSync(OUT, { recursive: true });
for (const c of CROPS) {
  const parts = c.parts.map(([src, rect]) => crop(src, rect));
  const img = parts.length === 1 ? parts[0] : strip(parts);
  writeFileSync(join(OUT, c.out), PNG.sync.write(img));
  console.log(`${c.out} ${img.width}x${img.height}`);
}
