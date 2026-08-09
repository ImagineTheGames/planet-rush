/**
 * evidence/a0-06c-lobby-rebaseline/measure-team-chip.mjs — is the side word still a WORD?
 * OWNER: Bot Engineer (a0-06c).
 *
 * GDD §2.1 is explicit that in Teams the side reads as a WORD and that the colour
 * only reinforces it: "Color reinforces the word; it never replaces it … the
 * readout survives with the hue removed." §2.2 records why — a Teams match was
 * played in which it was "impossible to know who is on your team."
 *
 * a0-06 adds the ratified `?` affordance to every bot row (§2.1). On a 390 px
 * landscape phone in TEAMS that is a SIXTH column in a row that already carried
 * five, and the team chip is what gives up the width. This script measures what
 * is left of the word rather than judging it by eye: it counts the chip's own
 * ink — the FRIENDLY blue / ENEMY red pixels — inside a given rectangle and
 * reports the bounding box, so "the word shrank from 6 px tall to 2 px" is a
 * measurement.
 *
 *   node evidence/a0-06c-lobby-rebaseline/measure-team-chip.mjs FRAME.png X Y W H
 *
 * Ink is any pixel whose blue or red channel dominates the other two by more
 * than 24/255 — the chips are the only saturated hue in the roster panel, so
 * that separates them from the bone text and the plate without a colour table.
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const [, , src, X, Y, W, H] = process.argv;
const png = PNG.sync.read(readFileSync(src));
const x0 = +X;
const y0 = +Y;
const w = +W;
const h = +H;

let ink = 0;
let minX = Infinity;
let maxX = -1;
let minY = Infinity;
let maxY = -1;
const rowInk = new Map();

for (let y = y0; y < y0 + h; y++) {
  for (let x = x0; x < x0 + w; x++) {
    const i = (png.width * y + x) << 2;
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    const blue = b - Math.max(r, g) > 24;
    const red = r - Math.max(g, b) > 24;
    if (!blue && !red) continue;
    ink++;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    rowInk.set(y, (rowInk.get(y) ?? 0) + 1);
  }
}

console.log(`${src}`);
console.log(`  window x ${x0}–${x0 + w - 1}, y ${y0}–${y0 + h - 1}`);
if (ink === 0) {
  console.log('  NO CHIP INK FOUND in this window');
  process.exit(0);
}
console.log(`  chip ink: ${ink} px`);
console.log(`  bounding box: x ${minX}–${maxX} (${maxX - minX + 1} px wide), y ${minY}–${maxY} (${maxY - minY + 1} px tall)`);
const rows = [...rowInk.keys()].sort((a, b) => a - b);
console.log(`  ink rows: ${rows.length} of ${h}`);
console.log(`  per-row ink: ${rows.map((y) => `${y}:${rowInk.get(y)}`).join(' ')}`);
