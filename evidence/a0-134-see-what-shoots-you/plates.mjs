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

/**
 * The two moments the recipe names. `V-01-standoff` is where a0-131 read its
 * finding off; `V-04-close-burst-12` is thirty seconds later in the same run,
 * kept because it is the frame in which the BEFORE bundle draws no attacker at
 * all — the phone alone with a vignette, which is a0-131's sentence exactly.
 */
const MOMENTS = ['V-01-standoff', 'V-04-close-burst-12'];

for (const moment of MOMENTS) {
  // 1. THE WHOLE FRAMES, halved (dpr 2 specimens): before over after, phone
  //    beside desktop. The one plate that answers the brief on its own.
  save(
    stack([
      row([half(read(`before-${moment}-joiner`)), half(read(`before-${moment}-host`))]),
      row([half(read(`after-${moment}-joiner`)), half(read(`after-${moment}-host`))]),
    ]),
    `a0-134-the-pair-restaged-${moment}`,
  );

  // 2. The phone alone, before over after, at full dpr-2 resolution — so the
  //    attacker's hull bar can be read rather than inferred from a halved frame.
  save(
    stack([read(`before-${moment}-joiner`), read(`after-${moment}-joiner`)]),
    `a0-134-the-phone-before-and-after-${moment}`,
  );

  // 3. The top-right corner at 2×, both bundles: the VIEW chip. It reads `1×`
  //    before and `1.5×` after WITH NOBODY HAVING PRESSED IT, which is the whole
  //    of the fix stated in two glyphs. The rect is `zoomControlBounds(798, 384,
  //    true)` in logical px, doubled for the dpr-2 specimen.
  const CHIP = { x: 1380, y: 100, w: 190, h: 130, scale: 2 };
  save(
    row([crop(read(`before-${moment}-joiner`), CHIP), crop(read(`after-${moment}-joiner`), CHIP)]),
    `a0-134-the-view-chip-nobody-pressed-${moment}`,
  );
}
console.log('DONE');
