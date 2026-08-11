/**
 * src/ui/typography.test.ts — THE WIRING, NOT THE NOTE (u14-01).
 *
 * GDD §5.6 has ratified Audiowide + Oxanium "self-hosted in the repo" since the
 * document was written. For four days `typography.ts` carried that sentence as a
 * *comment describing a gap*: there was no `@font-face` anywhere, no font file in
 * the repo, and every frame the project had ever drawn was in a fallback face.
 * A comment cannot fail, which is exactly how it survived four days and an
 * unknown number of goldens.
 *
 * So the contract lives in `RATIFIED_FACES` and this file reads it against the
 * page and the bytes on disk. Everything asserted here is something whose silent
 * loss would put the game back in Trebuchet with nothing red:
 *
 *  - the two woff2 files EXIST, are really woff2, and fit the payload budget;
 *  - `index.html` declares an `@font-face` per face, at the right file, at the
 *    right weight descriptor, subsetted to the range we say we subsetted to;
 *  - both are PRELOADED, with `crossorigin` (without it the browser fetches the
 *    file twice and the preload buys nothing);
 *  - the boot gate still AWAITS both faces BEFORE it imports `src/main.ts` —
 *    the one assertion that keeps the goldens from being a coin flip, since Pixi
 *    bakes text into a texture and `font-display` does nothing for a canvas;
 *  - the gate is bounded, so a font that hangs cannot cost the player the game
 *    (`src/platform/boot-error.ts` — no black screens, ever);
 *  - nothing reintroduces a CDN, which would break offline play (§4.3/§4.8) and
 *    the strict-artifact-host CSP.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  FONT_BODY,
  FONT_HEADING,
  FONT_PAYLOAD_BUDGET_BYTES,
  LATIN_SUBSET_RANGE,
  RATIFIED_FACES,
} from './typography';

const repoPath = (rel: string): string => fileURLToPath(new URL(`../../${rel}`, import.meta.url));
const INDEX_HTML = readFileSync(repoPath('index.html'), 'utf8');

/** `/fonts/x.woff2` as index.html spells it → the file on disk under public/. */
const onDisk = (href: string): string => repoPath(`public${href}`);

/** Collapse whitespace so a prettier reflow of a long declaration is not a fail. */
const flat = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** The `@font-face { ... }` bodies in the page, keyed by their font-family. */
const fontFaceBlocks = (): Map<string, string> => {
  const blocks = new Map<string, string>();
  for (const m of INDEX_HTML.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = m[1] ?? '';
    const family = /font-family:\s*'([^']+)'/.exec(body)?.[1];
    if (family) blocks.set(family, flat(body));
  }
  return blocks;
};

describe('the ratified faces are self-hosted (GDD §5.6)', () => {
  it('names exactly the two ratified families, and the stacks ask for them first', () => {
    expect(RATIFIED_FACES.map((f) => f.family)).toEqual(['Audiowide', 'Oxanium']);
    // The stacks are the consumer-facing half of the same contract: if a face is
    // shipped under a name nothing asks for, it is 14 KB of dead payload.
    expect(FONT_HEADING.split(',')[0]?.trim()).toBe('Audiowide');
    expect(FONT_BODY.split(',')[0]?.trim()).toBe('Oxanium');
  });

  it('ships a real woff2 for each face', () => {
    for (const face of RATIFIED_FACES) {
      const bytes = readFileSync(onDisk(face.href));
      // wOF2 magic. A woff (v1) or a raw ttf renamed .woff2 would be served with
      // the wrong format() hint and silently ignored by every browser.
      expect(bytes.toString('ascii', 0, 4), `${face.family} signature`).toBe('wOF2');
      expect(bytes.length, `${face.family} is not empty`).toBeGreaterThan(1024);
    }
  });

  it('keeps the whole type payload inside its budget', () => {
    const total = RATIFIED_FACES.reduce((n, f) => n + statSync(onDisk(f.href)).size, 0);
    expect(total).toBeLessThanOrEqual(FONT_PAYLOAD_BUDGET_BYTES);
  });

  it('ships the OFL licence beside each file, which is what redistribution costs', () => {
    for (const name of ['Audiowide-OFL.txt', 'Oxanium-OFL.txt']) {
      const text = readFileSync(repoPath(`public/fonts/${name}`), 'utf8');
      expect(text, name).toContain('SIL OPEN FONT LICENSE Version 1.1');
      expect(text, name).toContain('Copyright');
    }
  });
});

describe('index.html declares what typography.ts promises', () => {
  it('has an @font-face per ratified face, at the right file and weight', () => {
    const blocks = fontFaceBlocks();
    expect([...blocks.keys()].sort()).toEqual(['Audiowide', 'Oxanium']);

    for (const face of RATIFIED_FACES) {
      const body = blocks.get(face.family) ?? '';
      expect(body, `${face.family} src`).toContain(`url('${face.href}') format('woff2')`);
      expect(body, `${face.family} weight`).toContain(`font-weight: ${face.weight};`);
      expect(body, `${face.family} unicode-range`).toContain(flat(LATIN_SUBSET_RANGE));
    }
  });

  it("declares Oxanium's real variable axis, not its default instance", () => {
    // The file's own fvar default is wght 200 (ExtraLight). Declaring the face
    // without the range does not fail, it just renders the entire HUD hairline —
    // the kind of regression that reads as "the font looks a bit thin".
    const oxanium = RATIFIED_FACES.find((f) => f.family === 'Oxanium');
    expect(oxanium?.weight).toBe('200 800');
  });

  it('preloads both files, with crossorigin', () => {
    for (const face of RATIFIED_FACES) {
      const link = new RegExp(
        `<link[^>]*rel="preload"[^>]*href="${face.href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`,
        's',
      ).exec(flat(INDEX_HTML))?.[0];
      expect(link, `${face.family} preload link`).toBeTruthy();
      expect(link, `${face.family} preload as=font`).toContain('as="font"');
      expect(link, `${face.family} preload crossorigin`).toContain('crossorigin');
    }
  });

  it('never reaches for a CDN', () => {
    // Offline-first (§4.3/§4.8), and the strict artifact hosts these builds are
    // reviewed on refuse a third-party font-src outright.
    expect(INDEX_HTML).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    expect(INDEX_HTML).not.toMatch(/@font-face[^}]*url\(\s*['"]?https?:/s);
  });
});

describe('the boot gate makes the first painted frame deterministic', () => {
  const gate = flat(INDEX_HTML);

  it('awaits every ratified face before the app module is evaluated', () => {
    for (const face of RATIFIED_FACES) {
      for (const shorthand of face.load) {
        expect(gate, `${face.family} is awaited as "${shorthand}"`).toContain(`'${shorthand}'`);
      }
    }
    expect(gate).toContain('document.fonts.load');

    // Order is the whole point. Pixi bakes text into a texture at draw time and
    // never redraws it because a font arrived late, so main.ts must not be
    // evaluated until the faces have resolved (or the deadline has passed).
    expect(gate.indexOf('document.fonts.load')).toBeLessThan(gate.indexOf("import('/src/main.ts')"));
  });

  it('bounds the wait, so a font that hangs never costs the player the game', () => {
    // src/platform/boot-error.ts: NO BLACK SCREENS, EVER.
    const deadline = /BOOT_FONT_DEADLINE_MS\s*=\s*(\d+)/.exec(gate)?.[1];
    expect(deadline, 'the gate has an explicit deadline').toBeTruthy();
    expect(Number(deadline)).toBeGreaterThan(0);
    expect(Number(deadline)).toBeLessThanOrEqual(3000);
    expect(gate).toContain('Promise.race');
  });
});
