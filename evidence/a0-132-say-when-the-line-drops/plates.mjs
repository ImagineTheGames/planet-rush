/**
 * plates.mjs — the before/after plates. OWNER: Netcode Engineer (a0-132).
 *
 * a0-131's `plate.mjs` does the pixel work, unchanged and imported rather than
 * copied, so the discipline is theirs: crops are nearest-neighbour, `half` drops
 * every other pixel, **nothing is resampled and nothing is annotated**. The words
 * live in `README.md`, where they can be read as words rather than trusted as
 * pixels.
 *
 * Each plate is one question with the two answers stacked: the same frame of the
 * same staging on the code that shipped, and on this branch.
 *
 *   node evidence/a0-132-say-when-the-line-drops/plates.mjs
 */
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crop, half, stack, save } from '../a0-131-online-with-eyes/plate.mjs';
import { SHOTS } from './lib.mjs';

const read = (name) => PNG.sync.read(readFileSync(join(SHOTS, `${name}.png`)));

// 1. THE JOINER'S PHONE, THIRTY SECONDS AFTER THE CUT. a0-131's instant, and the
//    frame their finding is about. Halved: the phone is 798x384 at dpr2.
save(stack([half(read('before-04-30s-joiner')), half(read('after-04-30s-joiner'))]),
  'a0-132-joiner-30s-before-after');

// 2. THE JOINER AT THE MOMENT OF THE CUT. Same pair, the other required instant.
save(stack([half(read('before-02-at-cut-joiner')), half(read('after-02-at-cut-joiner'))]),
  'a0-132-joiner-at-cut-before-after');

// 3. THE HOST'S BAND, while the room's verdict is on screen. The banner is chalk on
//    black at 1280x800 dpr2 and is genuinely hard to see at plate scale — which is
//    itself worth knowing — so this one crop is taken at 2x from the region
//    `src/ui/hud-geometry` `presenceBand` lays out, on both builds, at the closest
//    match-clock reading the two runs share (0:21 before, 0:20 after).
const band = { x: 700, y: 120, w: 1200, h: 130, scale: 2 };
save(stack([crop(read('before-03-dense-t08800ms-host'), band), crop(read('after-03-dense-t06600ms-host'), band)]),
  'a0-132-host-band-before-after');

// 4. THE HOST'S WHOLE SCREEN on this branch, so the band above is not read out of
//    context and the HUD budget can be checked against it (nothing new is drawn;
//    the banner is a0-76's, already laid out and already swept by a0-122).
save(half(read('after-03-dense-t06600ms-host')), 'a0-132-host-told');
