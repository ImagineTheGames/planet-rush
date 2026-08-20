/**
 * evidence/a0-102-ore-counter-ground/crop.mjs — the before/after crops.
 *
 * The A/B is taken from the GOLDEN BASELINES rather than from a bespoke capture,
 * because the golden scene already is the frame a0-99 was filed on: `?freeze=1`
 * pins the seeded sim at a fixed tick, and at that tick an ore-bearing asteroid
 * — three yellow crystals and a gold vein ring — is drifting under the top-left
 * counter on both the desktop and the landscape-phone profile. Same scene, same
 * renderer, same tick; the only thing between the two images is this branch.
 *
 *   before = git show origin/main:<baseline>
 *   after  = the rebaked baseline in the worktree
 *
 * Usage: node evidence/a0-102-ore-counter-ground/crop.mjs
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const SNAPS = 'tests/mobile/goldens.spec.ts-snapshots';
const OUT = 'evidence/a0-102-ore-counter-ground/shots';

/** The corner each profile draws the counter in, and how far out to look. */
const CUTS = [
  { name: 'desktop-1280x800', file: 'desktop-hud-top-desktop-linux.png', w: 150, h: 96, zoom: 4 },
  { name: 'phone-844x390', file: 'phone-landscape-hud-top-iphone-linux.png', w: 120, h: 96, zoom: 4 },
];

const read = (buf) => PNG.sync.read(buf);
const fromGit = (ref, path) =>
  read(execFileSync('git', ['show', `${ref}:${path}`], { maxBuffer: 1 << 28 }));
const fromDisk = (path) => read(execFileSync('cat', [path], { maxBuffer: 1 << 28 }));

/** Nearest-neighbour zoom of a crop — the pixels are the evidence, so they are
 *  magnified without being interpolated into something softer than they are. */
function crop(src, w, h, zoom) {
  const cw = Math.min(w, src.width);
  const ch = Math.min(h, src.height);
  const out = new PNG({ width: cw * zoom, height: ch * zoom });
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = (y * src.width + x) << 2;
      for (let dy = 0; dy < zoom; dy++) {
        for (let dx = 0; dx < zoom; dx++) {
          const j = ((y * zoom + dy) * cw * zoom + (x * zoom + dx)) << 2;
          out.data[j] = src.data[i];
          out.data[j + 1] = src.data[i + 1];
          out.data[j + 2] = src.data[i + 2];
          out.data[j + 3] = 255;
        }
      }
    }
  }
  return out;
}

/** Two crops side by side, with a hairline between them. */
function pair(a, b) {
  const gap = 8;
  const out = new PNG({ width: a.width + gap + b.width, height: Math.max(a.height, b.height) });
  out.data.fill(0);
  const blit = (src, ox) => {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const i = (y * src.width + x) << 2;
        const j = (y * out.width + (x + ox)) << 2;
        out.data[j] = src.data[i];
        out.data[j + 1] = src.data[i + 1];
        out.data[j + 2] = src.data[i + 2];
        out.data[j + 3] = 255;
      }
    }
  };
  blit(a, 0);
  blit(b, a.width + gap);
  for (let y = 0; y < out.height; y++) {
    const j = (y * out.width + a.width + gap / 2) << 2;
    out.data[j] = out.data[j + 1] = out.data[j + 2] = 90;
    out.data[j + 3] = 255;
  }
  return out;
}

for (const cut of CUTS) {
  const before = crop(fromGit('origin/main', `${SNAPS}/${cut.file}`), cut.w, cut.h, cut.zoom);
  const after = crop(fromDisk(`${SNAPS}/${cut.file}`), cut.w, cut.h, cut.zoom);
  writeFileSync(`${OUT}/${cut.name}-before.png`, PNG.sync.write(before));
  writeFileSync(`${OUT}/${cut.name}-after.png`, PNG.sync.write(after));
  writeFileSync(`${OUT}/${cut.name}-before-after.png`, PNG.sync.write(pair(before, after)));
  console.log(`${cut.name}: ${cut.w}×${cut.h} at ${cut.zoom}× — before | after`);
}
