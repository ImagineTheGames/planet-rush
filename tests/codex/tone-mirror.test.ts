/**
 * tests/codex/tone-mirror.test.ts — the anti-drift lock on the two tone mirrors
 * (brief a2-08; `docs/gdd-conformance.md` T-4, step 3).
 *
 * GDD §4.7 mirrors its tone contract in two files outside the GDD —
 * `style-guide.md` §8 and `content/codex/pipeline/tone.md` — because lexical
 * retrieval provably never surfaces a tone section on its own, so both are pinned
 * by hand and injected **verbatim**: into every codex generation and critic pass,
 * and into every player-facing-copy task. That is exactly why a stale mirror is
 * dangerous rather than untidy — it does not merely disagree with the GDD, it
 * actively re-pins whatever it still quotes.
 *
 * Both mirrors went stale and nobody noticed for days: `tone.md` kept quoting the
 * paragraph §4.7 retired on 2026-08-06, and **neither** mirror ever gained
 * register 2, ratified 2026-08-05 (`docs/gdd-conformance.md` G-4, G-5). §4.7 says
 * a mirror is quoted verbatim by definition — so a test is the only thing that
 * can notice when one drifts again.
 *
 * Four locks, in order of what each alone can catch:
 *   1. no mirror quotes the retired arcade-cartoon register;
 *   2. both mirrors carry register 2 by its load-bearing nouns;
 *   3. both carry §4.7's register-2 prompt byte-for-byte, sliced out of GDD.md
 *      at read time — so amending §4.7 fails here until the mirrors follow;
 *   4. both carry §4.7's tone paragraph word-for-word (line wrapping and
 *      blockquote markers normalised away, since the mirrors re-wrap it).
 *
 * OWNER: Art & Audio Agent (`style-guide.md`, `content/codex/pipeline/`).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const read = (rel: string): string => readFileSync(`${ROOT}${rel}`, 'utf8');

/** The two mirrors §4.7's Propagation clause names, by repo-relative path. */
const MIRRORS = ['style-guide.md', 'content/codex/pipeline/tone.md'] as const;

/** Everything between two markers, `start` included and `end` excluded. Throws
 *  rather than returning a silent empty string, because a marker that has been
 *  edited out of GDD.md must fail loudly here instead of passing vacuously. */
function between(text: string, start: string, end: string): string {
  const i = text.indexOf(start);
  const j = text.indexOf(end, i + start.length);
  expect(i, `GDD.md still contains the marker ${JSON.stringify(start)}`).toBeGreaterThanOrEqual(0);
  expect(j, `GDD.md still contains the marker ${JSON.stringify(end)}`).toBeGreaterThan(i);
  return text.slice(i, j).trimEnd();
}

/** Prose comparison: drop blockquote markers, emphasis and line breaks, so a
 *  mirror is free to re-wrap the paragraph but not to reword it. */
function normalise(prose: string): string {
  return prose
    .replace(/^\s*>\s?/gm, '')
    .replace(/[*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const GDD = read('GDD.md');

/** §4.7's register-2 prompt — "Everything from *"Who speaks"* to *"The clarity
 *  rule"* below is injected **verbatim**". The block ends where the vocabulary
 *  table (not part of the pinned prompt) begins. */
const REGISTER_2_BLOCK = between(GDD, '**Who speaks, and to whom.**', '**Vocabulary — in and out.**');

/** §4.7's tone paragraph — register 1, as amended 2026-08-06. */
const TONE_PARAGRAPH = normalise(
  between(GDD, '> *Planet Rush is a clean, modern science-fiction brawl', '\n\n**Why it changed'),
);

/**
 * The retired register, phrase by phrase. Deliberately the *quotations* and not
 * the bare words: §4.7's own register-2 prompt says "over a toy-bright brawl"
 * while explaining why that adjective went, and a mirror quoting it verbatim is
 * correct. What must never appear is the retired paragraph being pinned as if it
 * were still the contract.
 */
const RETIRED = [
  /[Ss]aturday.?morning/,
  /cartoon rivals?/i,
  /explosions are fireworks/i,
  /ships are toys/i,
  /arcade on the surface/i,
];

/** Register 2's load-bearing nouns — the ones G-5 grepped for and found nowhere. */
const REGISTER_2_TERMS = [/operating authority/i, /contracted operator/i, /interface voice/i];

describe('the two tone mirrors (GDD §4.7 Propagation)', () => {
  for (const path of MIRRORS) {
    describe(path, () => {
      const text = read(path);

      it('never quotes the retired arcade-cartoon register', () => {
        for (const pattern of RETIRED) {
          expect(pattern.test(text), `${path} must not quote ${pattern}`).toBe(false);
        }
      });

      it('carries register 2 — the interface voice', () => {
        for (const pattern of REGISTER_2_TERMS) {
          expect(pattern.test(text), `${path} must name ${pattern}`).toBe(true);
        }
      });

      it("carries §4.7's register-2 prompt verbatim", () => {
        expect(text).toContain(REGISTER_2_BLOCK);
      });

      it("carries §4.7's tone paragraph word for word", () => {
        expect(normalise(text)).toContain(TONE_PARAGRAPH);
      });
    });
  }
});
