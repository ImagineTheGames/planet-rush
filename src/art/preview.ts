/**
 * src/art/preview.ts — the contact sheet. OWNER: Art & Audio Agent.
 *
 * A repo has no art tool, so the art review surface has to be a file. This
 * builds one: every sprite in the catalogue, grouped, captioned, on Vacuum —
 * plus an **actual-size 24px strip** at the top, because that is the size the
 * style guide's hard readability rule is stated at (§4) and the only honest way
 * to look at it is to look at it that small.
 *
 * `preview.test.ts` keeps `assets/preview/sprite-sheet.svg` in sync with these
 * generators: the committed sheet must equal the generated one, so a shape
 * change that nobody re-rendered fails CI, and every art change arrives in a PR
 * as a readable diff (GDD §4.5, "reproducible, diffable").
 */

import { ART_CATALOGUE, type CatalogueEntry } from './catalogue';
import { hex, PALETTE } from './palette';
import { SHIP_CLASSES, shipSilhouette, shipSprite } from './ships';
import { spriteToGroup } from './svg';

const TILE = 104;
const GAP = 10;
const COLS = 8;
const PAD = 24;
const HEADER = 40;
const CAPTION = 16;

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function caption(text: string, cx: number, y: number, size = 10, color = 0x7e8894): string {
  return `<text x="${cx}" y="${y}" font-family="Oxanium, ui-monospace, monospace" font-size="${size}" fill="${hex(color)}" text-anchor="middle">${escapeText(text)}</text>`;
}

function heading(text: string, x: number, y: number): string {
  return `<text x="${x}" y="${y}" font-family="Audiowide, ui-sans-serif, sans-serif" font-size="15" fill="${hex(PALETTE.plasma)}">${escapeText(text)}</text>`;
}

function groupOrder(entries: readonly CatalogueEntry[]): string[] {
  const seen: string[] = [];
  for (const e of entries) if (!seen.includes(e.group)) seen.push(e.group);
  return seen;
}

/**
 * The 24px strip: the four silhouettes and four full liveries at the size the
 * legibility rule is written for, drawn 1:1 with no zoom. If a hull is
 * ambiguous here, it is ambiguous in the game.
 */
function actualSizeStrip(y: number): { svg: string; height: number } {
  const parts: string[] = [heading('At 24 px — actual size (style-guide §4)', PAD, y + 18)];
  let x = PAD;
  const top = y + 34;
  for (const c of SHIP_CLASSES) {
    parts.push(spriteToGroup(shipSilhouette(c), 24, x, top));
    parts.push(caption(c.slice(0, 6), x + 12, top + 36, 8));
    x += 24 + 22;
  }
  x += 20;
  for (const c of SHIP_CLASSES) {
    parts.push(spriteToGroup(shipSprite({ shipClass: c, playerId: SHIP_CLASSES.indexOf(c) }), 24, x, top));
    parts.push(caption(`P${SHIP_CLASSES.indexOf(c) + 1}`, x + 12, top + 36, 8));
    x += 24 + 22;
  }
  return { svg: parts.join(''), height: 34 + 24 + 24 };
}

/** The whole catalogue as one SVG document. Deterministic, byte-stable. */
export function buildContactSheet(entries: readonly CatalogueEntry[] = ART_CATALOGUE): string {
  const groups = groupOrder(entries);
  const parts: string[] = [];
  let y = PAD;

  parts.push(
    `<text x="${PAD}" y="${y + 20}" font-family="Audiowide, ui-sans-serif, sans-serif" font-size="22" fill="${hex(PALETTE.hullSteel)}">STATION RUSH — procedural sprite set</text>`,
    caption(
      'Cold Vacuum · generated from src/art/ · regenerate with UPDATE_ART_PREVIEW=1 npx vitest run src/art/preview.test.ts',
      PAD + 320,
      y + 38,
      10,
    ),
  );
  y += 56;

  const strip = actualSizeStrip(y);
  parts.push(strip.svg);
  y += strip.height;

  for (const group of groups) {
    const inGroup = entries.filter((e) => e.group === group);
    parts.push(heading(group, PAD, y + 22));
    y += HEADER;
    inGroup.forEach((entry, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = PAD + col * (TILE + GAP);
      const ty = y + row * (TILE + GAP + CAPTION);
      parts.push(
        `<rect x="${x}" y="${ty}" width="${TILE}" height="${TILE}" fill="${hex(PALETTE.vacuum)}" stroke="${hex(0x262a31)}"/>`,
      );
      parts.push(spriteToGroup(entry.def, TILE, x, ty));
      parts.push(caption(entry.label, x + TILE / 2, ty + TILE + 12));
    });
    const rows = Math.ceil(inGroup.length / COLS);
    y += rows * (TILE + GAP + CAPTION) + 14;
  }

  const width = PAD * 2 + COLS * TILE + (COLS - 1) * GAP;
  const height = y + PAD;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="${hex(PALETTE.vacuum)}"/>`,
    parts.join(''),
    '</svg>',
    '',
  ].join('\n');
}
