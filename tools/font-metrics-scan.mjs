#!/usr/bin/env node
/**
 * tools/font-metrics-scan.mjs — regenerate `src/ui/font-metrics.data.ts`. OWNER: UI Engineer.
 *
 * Text width is a font fact. Until a0-32 the only headless model of one in this
 * repo was a single number per face — *"a glyph is at most .82em of Audiowide"* —
 * and a guess is what let `UPGRADE` overrun its wedge and `& UPGRADE` overrun its
 * circle once u14-01 self-hosted the real faces and every advance in the game
 * moved underneath them.
 *
 * This script measures the ACTUAL advance of every glyph the UI can draw, out of
 * the repo's own `public/fonts/*.woff2`, in the same engine PixiJS measures with
 * (Chromium's `CanvasRenderingContext2D.measureText`), and writes the numbers out
 * as pure data. `src/ui/font-metrics.ts` reproduces Pixi's own width and height
 * arithmetic on top of them, headless — so *"does this label fit this shape"* is
 * a unit test rather than a screenshot somebody once looked at.
 *
 *     node tools/font-metrics-scan.mjs           # rewrite the data module
 *     node tools/font-metrics-scan.mjs --check   # fail if it is stale
 *
 * The table is also re-measured against the REAL booted page by
 * `tests/mobile/voice-copy-fit.spec.ts`, so it cannot rot into a note: if a font
 * file is replaced and this is not re-run, that spec goes red naming the glyph.
 *
 * ── WHY ONLY THE SUBSET RANGE IS TABLED ────────────────────────────────────
 * `index.html` declares both faces with a `unicode-range` (the latin subset —
 * `src/ui/typography.ts` LATIN_SUBSET_RANGE). INSIDE that range the browser is
 * contractually drawing from the file in this repo, so a measurement taken in the
 * studio container means the same thing on the GitHub runner — which is the whole
 * premise of committing a table at all. OUTSIDE it the browser picks a system
 * face, and which one it picks is a property of the machine: `●` measures .6001em
 * through the body stack and .604em through the heading stack on this box, and
 * neither number is promised anywhere else. That is the a1-01 trap (see
 * `src/ui/typography.ts`) waiting to be sprung a second time, so out-of-range
 * glyphs are deliberately NOT tabled — `font-metrics.ts` gives them a documented
 * upper bound instead, and says so on every measurement that touches one.
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/ui/font-metrics.data.ts');

/** The two stacks, spelled exactly as `src/ui/typography.ts` spells them. */
const FONT_HEADING = 'Audiowide, "Trebuchet MS", sans-serif';
const FONT_BODY = 'Oxanium, "Liberation Mono", monospace';

/** The `unicode-range` both faces are subsetted to — `index.html`'s own list. */
const UNICODE_RANGE =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, ' +
  'U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, ' +
  'U+2212, U+2215, U+FEFF, U+FFFD';

/**
 * Every codepoint the table carries: the printable ASCII the copy is written in,
 * the Latin-1 letters the region names need (`São Paulo`), and the in-range
 * punctuation the voice uses (`·` `—` `’` `…` `°` `§` `×` `−` `↑` `↓`).
 *
 * Deliberately not the whole subset range: 200 rows of `Ð` and `þ` that no string
 * in this repo contains would be table nobody reads. `src/ui/font-metrics.test.ts`
 * walks the UI's own strings and fails if one reaches a codepoint that is absent.
 */
function tabledChars() {
  const chars = [];
  for (let c = 0x20; c <= 0x7e; c++) chars.push(String.fromCharCode(c));
  for (const c of '¡¿°·×÷§©®µÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüý') chars.push(c);
  for (const c of '‘’“”–—…‰€™↑↓−∕') chars.push(c);
  return chars;
}

/** The face/weight pairs the UI actually draws in, and the key each gets. */
const FACES = [
  { key: 'heading', font: FONT_HEADING, weight: '400', note: 'Audiowide 400 — the one upstream weight.' },
  { key: 'headingBold', font: FONT_HEADING, weight: 'bold', note: 'Audiowide, synthesised bold.' },
  { key: 'body', font: FONT_BODY, weight: '400', note: 'Oxanium 400.' },
  { key: 'bodyBold', font: FONT_BODY, weight: '700', note: 'Oxanium 700.' },
  { key: 'bodyBlack', font: FONT_BODY, weight: '800', note: 'Oxanium 800.' },
];

async function serveFonts() {
  const server = createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url.endsWith('.woff2')) {
      res.writeHead(200, { 'content-type': 'font/woff2' });
      res.end(readFileSync(join(ROOT, 'public', url)));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(
      `<!doctype html><html><head><style>` +
        `@font-face{font-family:Audiowide;src:url(/fonts/Audiowide-Regular-latin.woff2) format('woff2');` +
        `font-weight:400;font-style:normal;unicode-range:${UNICODE_RANGE};}` +
        `@font-face{font-family:Oxanium;src:url(/fonts/Oxanium-Variable-latin.woff2) format('woff2');` +
        `font-weight:200 800;font-style:normal;unicode-range:${UNICODE_RANGE};}` +
        `</style></head><body></body></html>`,
    );
  });
  await new Promise((r) => server.listen(0, r));
  return server;
}

async function measure() {
  const server = await serveFonts();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${server.address().port}/`);
    await page.evaluate(async (loads) => {
      for (const f of loads) await document.fonts.load(f);
      await document.fonts.ready;
    }, FACES.map((f) => `${f.weight} 16px ${f.font.split(',')[0]}`));
    return await page.evaluate(
      ([faces, chars]) => {
        const ctx = document.createElement('canvas').getContext('2d');
        // 1000px, so a four-decimal `em` is an integer count of measured pixels
        // and the table is not a rounding of a rounding.
        const REF = 1000;
        const round = (n) => Math.round(n * 1e4) / 1e4;
        const advance = {};
        const lineHeight = {};
        for (const f of faces) {
          ctx.letterSpacing = '0px';
          ctx.font = `${f.weight} ${REF}px ${f.font}`;
          const t = {};
          for (const c of chars) t[c] = round(ctx.measureText(c).width / REF);
          advance[f.key] = t;
          // Pixi's own `CanvasTextMetrics.measureFont`: the ink box of
          // METRICS_STRING + BASELINE_SYMBOL is what becomes its line height.
          const m = ctx.measureText('|ÉqM');
          lineHeight[f.key] = round((m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / REF);
        }
        return { advance, lineHeight };
      },
      [FACES.map((f) => ({ key: f.key, font: f.font, weight: f.weight })), tabledChars()],
    );
  } finally {
    await browser.close();
    server.close();
  }
}

/** One face's advances, six glyphs to a row so a diff reads as a diff. */
function renderTable(chars, table) {
  const rows = [];
  for (let i = 0; i < chars.length; i += 6) {
    rows.push(
      '  ' +
        chars
          .slice(i, i + 6)
          .map((c) => `${JSON.stringify(c)}: ${table[c]}`)
          .join(', ') +
        ',',
    );
  }
  return rows.join('\n');
}

function render({ advance, lineHeight }) {
  const chars = tabledChars();
  return `/**
 * src/ui/font-metrics.data.ts — GENERATED. Do not edit by hand.
 *
 * Regenerate with \`node tools/font-metrics-scan.mjs\`; that script's header says
 * what these numbers are, where they come from, and why only the subsetted range
 * is tabled. \`./font-metrics.ts\` is the hand-written half — the arithmetic that
 * turns these into the width and height PixiJS will actually draw.
 *
 * Measured off \`public/fonts/*.woff2\` in Chromium at a 1000px reference size;
 * every value is an \`em\`. \`tests/mobile/voice-copy-fit.spec.ts\` re-measures the
 * whole table against the real booted page, so a font file replaced without a
 * rescan fails a test rather than a screenshot.
 */

/** The face/weight pairs the UI draws in, and the key each measurement takes. */
export type MetricFace = ${FACES.map((f) => `'${f.key}'`).join(' | ')};

${FACES.map(
  (f) =>
    `/** ${f.note} */\nconst ${f.key.replace(/([A-Z])/g, '_$1').toUpperCase()}: Readonly<Record<string, number>> = {\n${renderTable(
      chars,
      advance[f.key],
    )}\n};`,
).join('\n\n')}

/** Advance widths in \`em\`, per face, per glyph. */
export const ADVANCE_EM: Readonly<Record<MetricFace, Readonly<Record<string, number>>>> = {
${FACES.map((f) => `  ${f.key}: ${f.key.replace(/([A-Z])/g, '_$1').toUpperCase()},`).join('\n')}
};

/**
 * Pixi's own line height per face, in \`em\` — the ink box of its \`METRICS_STRING\`
 * (\`CanvasTextMetrics.measureFont\`), which is what a \`Text\` node's height is a
 * multiple of when \`lineHeight\` is left unset, as it is everywhere in this UI.
 */
export const LINE_HEIGHT_EM: Readonly<Record<MetricFace, number>> = {
${FACES.map((f) => `  ${f.key}: ${lineHeight[f.key]},`).join('\n')}
};
`;
}

const body = render(await measure());

if (process.argv.includes('--check')) {
  if (readFileSync(OUT, 'utf8') !== body) {
    console.error('src/ui/font-metrics.data.ts is stale — run `node tools/font-metrics-scan.mjs`.');
    process.exit(1);
  }
  console.log('src/ui/font-metrics.data.ts is current.');
} else {
  writeFileSync(OUT, body);
  console.log(`wrote ${OUT}`);
}
