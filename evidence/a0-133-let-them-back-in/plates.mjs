/**
 * plates.mjs — the door's two answers, stacked. OWNER: Netcode Engineer (a0-133).
 *
 * a0-131's `plate.mjs` does the pixel work, imported rather than copied, so the
 * discipline is theirs: crops are nearest-neighbour, `half` drops every other
 * pixel, **nothing is resampled and nothing is annotated**. The words live in
 * `README.md`, where they can be read as words rather than trusted as pixels.
 *
 *   node evidence/a0-133-let-them-back-in/plates.mjs
 */
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crop, half, stack, save } from '../a0-131-online-with-eyes/plate.mjs';
import { SHOTS } from './lib.mjs';

const read = (name) => PNG.sync.read(readFileSync(join(SHOTS, `${name}.png`)));

// 1. THE ANSWER, on both builds. The same phone, the same room, the same correct
//    code typed into the same live match — three seconds after SUBMIT. Halved: the
//    phone profile is 798x384 at dpr2.
save(stack([half(read('before-06-the-answer')), half(read('after-06-the-answer'))]),
  'a0-133-the-answer-before-after');

// 2. THE CODE, TYPED. The keypad on the rebuilt page, before SUBMIT, on both
//    builds — so the plate above cannot be read as "they typed it wrong".
save(stack([half(read('before-05-code-typed-again')), half(read('after-05-code-typed-again'))]),
  'a0-133-code-typed-before-after');

// 3. A DIFFERENT DEVICE, on this branch. Same four letters, no credential: the
//    refusal a0-131 photographed, still exactly where it was.
save(half(read('after-09-stranger-answer')), 'a0-133-stranger-still-refused');

// 4. THE HOST, twelve seconds after the returning player came back through the
//    door — the other end of the wire agreeing that a human has the controls
//    again. Halved from 1280x800 dpr2.
save(half(read('after-07-the-answer-late-host')), 'a0-133-host-when-they-return');

// 5. THE PHONE'S REFUSAL, up close, on the build that shipped. The sentence this
//    brief exists to delete, at 2x from the title row `src/ui/online-menu` draws.
save(crop(read('before-06-the-answer'), { x: 60, y: 210, w: 700, h: 150, scale: 2 }),
  'a0-133-refused-match-live');
