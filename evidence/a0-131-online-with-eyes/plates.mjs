/**
 * evidence/a0-131-online-with-eyes/plates.mjs — the images the manifest points at.
 * OWNER: QA Manager (a0-131).
 *
 * Almost every plate here is a PAIR, host over joiner, because the brief's whole
 * question is what the two clients each showed. Frames are HALVED rather than
 * resampled (`plate.mjs` `half`: every output pixel is a source pixel), and crops
 * are nearest-neighbour. Nothing is annotated - the words are in the manifest.
 *
 *   node evidence/a0-131-online-with-eyes/plates.mjs [plate ...]
 */
import { crop, half, read, save, stack, row } from './plate.mjs';

const H = (n) => half(read(n));           // a full frame, halved
const C = (n, r) => crop(n, r);           // a magnified detail

const PLATES = {
  'a0-131-join-path-both-clients': () =>
    stack([
      row([H('1-03-host-creating'), H('1-04-host-lobby-with-code')]),
      row([H('1-06-joiner-keypad-empty'), H('1-07-joiner-code-typed'), H('1-08-joiner-connecting')]),
    ]),

  'a0-131-join-code-read-off-the-screen': () =>
    row([
      C('1-04-host-lobby-with-code', { x: 2270, y: 20, w: 270, h: 120, scale: 3 }),
      C('1-07-joiner-code-typed', { x: 870, y: 185, w: 480, h: 125, scale: 3 }),
    ]),

  'a0-131-same-moment-two-clients': () =>
    stack([H('T-01-standoff-host'), H('T-01-standoff-joiner')]),

  'a0-131-phone-cannot-see-its-attacker': () =>
    stack([H('T-01-standoff-joiner'), H('T-06-view-2x-joiner'), H('T-06-view-2x-host')]),

  'a0-131-drop-what-each-client-sees': () =>
    stack([
      row([H('4-01-before-drop-host'), H('4-04-dropped-30s-host')]),
      row([H('4-01-before-drop-joiner'), H('4-04-dropped-30s-joiner')]),
    ]),

  'a0-131-dropped-client-frozen-for-30s': () =>
    stack([
      row([
        C('4-02-just-dropped-joiner', { x: 600, y: 25, w: 400, h: 140, scale: 2 }),
        C('4-03-dropped-8s-joiner', { x: 600, y: 25, w: 400, h: 140, scale: 2 }),
        C('4-04-dropped-30s-joiner', { x: 600, y: 25, w: 400, h: 140, scale: 2 }),
      ]),
      row([
        C('4-02-just-dropped-host', { x: 1040, y: 25, w: 460, h: 140, scale: 2 }),
        C('4-03-dropped-8s-host', { x: 1040, y: 25, w: 460, h: 140, scale: 2 }),
        C('4-04-dropped-30s-host', { x: 1040, y: 25, w: 460, h: 140, scale: 2 }),
      ]),
    ]),

  'a0-131-rejoin-refused-match-live': () =>
    stack([
      H('4-07-fresh-client-code-typed'),
      H('4-08-fresh-client-answer'),
      C('4-08-fresh-client-answer', { x: 820, y: 250, w: 760, h: 100, scale: 2 }),
    ]),

  'a0-131-lobby-host-and-guest': () =>
    stack([
      H('5-01-lobby-both-host'),
      H('5-01-lobby-both-joiner'),
      row([
        C('5-01-lobby-both-host', { x: 1180, y: 780, w: 700, h: 90, scale: 2 }),
        C('5-01-lobby-both-joiner', { x: 940, y: 375, w: 480, h: 70, scale: 2 }),
      ]),
    ]),
  'a0-131-a-shot-fired-by-the-other-player': () =>
    stack([H('X-fire-0-4-host'), H('X-fire-0-4-joiner')]),

  'a0-131-the-same-shot-drawn-two-ways': () =>
    stack([
      C('X-fire-0-4-host', { x: 1240, y: 640, w: 900, h: 400, scale: 2 }),
      C('X-fire-0-4-joiner', { x: 210, y: 300, w: 480, h: 190, scale: 3.75 }),
    ]),

  'a0-131-same-client-recovers-on-reconnect': () =>
    stack([
      row([H('4-04-dropped-30s-joiner'), H('4-06-link-restored-12s-joiner')]),
      row([
        C('4-04-dropped-30s-joiner', { x: 600, y: 25, w: 400, h: 140, scale: 2 }),
        C('4-06-link-restored-12s-joiner', { x: 600, y: 25, w: 400, h: 140, scale: 2 }),
      ]),
    ]),

  'a0-131-no-claim-on-any-online-screen': () =>
    stack([
      row([
        C('5-01-lobby-both-host', { x: 80, y: 235, w: 1450, h: 100, scale: 1.6 }),
      ]),
      row([
        C('5-01-lobby-both-host', { x: 1180, y: 780, w: 700, h: 90, scale: 2 }),
        C('5-01-lobby-both-joiner', { x: 940, y: 375, w: 480, h: 70, scale: 2 }),
      ]),
    ]),

  'a0-131-bots-only-online-match': () =>
    stack([
      H('6-02-seats-set-to-bot'),
      row([H('6-03-browse-sees-the-room'), H('6-04-bots-only-match')]),
      C('6-04-bots-only-match', { x: 890, y: 165, w: 800, h: 100, scale: 2 }),
    ]),
};

const wanted = process.argv.slice(2);
for (const [name, build] of Object.entries(PLATES)) {
  if (wanted.length && !wanted.includes(name)) continue;
  save(build(), name);
}
