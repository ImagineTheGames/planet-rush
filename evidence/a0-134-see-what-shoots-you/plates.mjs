/**
 * evidence/a0-134-see-what-shoots-you/plates.mjs — the plates. OWNER: UI
 * Engineer (a0-134).
 *
 * a0-131's compositor, unchanged and imported rather than copied (`crop`, `half`,
 * `stack`, `row`, `save`): nearest-neighbour only, no filtering, no annotation,
 * nothing drawn over a specimen. Captions live in the README as words, never
 * burnt into a pixel.
 *
 * Every plate here is a PAIR OF PAIRS — the before bundle over the after bundle,
 * each of those the phone beside the desktop — because the finding is not "the
 * phone shows a ship", it is "the phone shows what the desktop already showed".
 *
 *   node evidence/a0-134-see-what-shoots-you/plates.mjs
 */
import { PNG } from 'pngjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { crop, half, stack, row, save } from '../a0-131-online-with-eyes/plate.mjs';
import { SHOTS } from './lib.mjs';

const read = (name) => {
  const p = join(SHOTS, `${name}.png`);
  if (!existsSync(p)) throw new Error(`missing specimen: ${p}`);
  return PNG.sync.read(readFileSync(p));
};

/** The moment a0-131 read its finding off: the standoff, both clients. */
const MOMENT = process.env.MOMENT ?? 'V-01-standoff';

// 1. THE WHOLE FRAMES, halved (dpr 2 specimens): before over after, phone beside
//    desktop. The one plate that answers the brief on its own.
save(
  stack([
    row([half(read(`before-${MOMENT}-joiner`)), half(read(`before-${MOMENT}-host`))]),
    row([half(read(`after-${MOMENT}-joiner`)), half(read(`after-${MOMENT}-host`))]),
  ]),
  'a0-134-the-pair-restaged',
);

// 2. The phone alone, before and after, at full dpr-2 resolution — so the
//    attacker's hull and nameplate can be read rather than inferred from a
//    halved frame.
save(
  stack([
    crop(read(`before-${MOMENT}-joiner`), { x: 0, y: 0, w: 1596, h: 768, scale: 1 }),
    crop(read(`after-${MOMENT}-joiner`), { x: 0, y: 0, w: 1596, h: 768, scale: 1 }),
  ]),
  'a0-134-the-phone-before-and-after',
);

// 3. The top-right corner at 2×, both bundles: the VIEW chip. It reads `1×`
//    before and `1.5×` after WITHOUT ANYONE HAVING PRESSED IT, which is the whole
//    of the fix stated in two glyphs. The rect is `zoomControlBounds(798,384,
//    true)` in logical px, doubled for dpr 2.
const CHIP = { x: 1380, y: 100, w: 180, h: 130, scale: 2 };
save(
  row([crop(read(`before-${MOMENT}-joiner`), CHIP), crop(read(`after-${MOMENT}-joiner`), CHIP)]),
  'a0-134-the-view-chip-nobody-pressed',
);
console.log('DONE');
