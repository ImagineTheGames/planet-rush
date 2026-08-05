/**
 * candidates.test.ts — the s2 sound-review candidates hold up. OWNER: Sound Agent.
 *
 * The candidates (`./candidates`) are a review artifact, not wired into the game,
 * so nothing else would ever exercise them. This does: every candidate renders on
 * the real synth without a NaN or an out-of-range sample (the same bar the shipped
 * bank is held to in `./audio.test.ts`), every slot offers exactly three, and the
 * committed `sound-review/manifest.json` — the contract the portal reads — still
 * matches the source it was generated from.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CANDIDATE_SLOTS, CANDIDATE_SLOT_ORDER } from './candidates';
import { isLayered, loops, SOUND_NAMES, type SoundName, type SoundSpec } from './bank';
import { renderLayered, renderVoice, seamless, peak, type VoiceSpec } from './synth';

/** The faithful render recipe (mirrors `graph.renderSound`), headless. */
function render(spec: SoundSpec): Float32Array {
  const looped = loops(spec);
  const options = looped ? { edges: false } : {};
  const samples = isLayered(spec)
    ? renderLayered(spec.layers, 44100, options)
    : renderVoice(spec as VoiceSpec, 44100, options);
  if (!looped) return samples;
  const crossfade = (isLayered(spec) ? spec.crossfade : undefined) ?? 0.04;
  return seamless(samples, 44100, crossfade);
}

const SLOT_IDS = CANDIDATE_SLOT_ORDER;

describe('sound-review candidates', () => {
  it('the slot order and the slot map agree', () => {
    expect(new Set(SLOT_IDS).size).toBe(SLOT_IDS.length); // no dupes
    expect(new Set(SLOT_IDS)).toEqual(new Set(Object.keys(CANDIDATE_SLOTS)));
    expect(SLOT_IDS.length).toBeGreaterThanOrEqual(8); // the DoD floor; we ship the full bank
  });

  it('every slot points its "current" at a real shipped sound', () => {
    const names = new Set<SoundName>(SOUND_NAMES);
    for (const id of SLOT_IDS) {
      expect(names.has(CANDIDATE_SLOTS[id]!.current)).toBe(true);
    }
  });

  it('every slot has exactly three candidates, ids a/b/c, with characters', () => {
    for (const id of SLOT_IDS) {
      const slot = CANDIDATE_SLOTS[id]!;
      expect(slot.candidates.map((c) => c.id)).toEqual(['a', 'b', 'c']);
      for (const c of slot.candidates) {
        expect(c.character.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('every candidate renders without a NaN and stays in range', () => {
    // One assertion per candidate, not per sample: a per-sample expect() over ~268
    // voices is millions of calls and times out on a slow CI box.
    for (const id of SLOT_IDS) {
      for (const c of CANDIDATE_SLOTS[id]!.candidates) {
        const buf = render(c.spec);
        let finite = true;
        for (let i = 0; i < buf.length; i++) {
          if (!Number.isFinite(buf[i]!)) { finite = false; break; }
        }
        const p = peak(buf);
        expect(
          buf.length > 0 && finite && p > 0 && p <= 1,
          `${id}/${c.id}: len=${buf.length} finite=${finite} peak=${p}`,
        ).toBe(true);
      }
    }
  });

  it('every looping candidate keeps a sustained voice so its seam is not silent', () => {
    for (const id of SLOT_IDS) {
      for (const c of CANDIDATE_SLOTS[id]!.candidates) {
        const spec = c.spec;
        if (!loops(spec) || !isLayered(spec)) continue;
        const hasSustain = spec.layers.some((l) => (l.spec.decay ?? 0) === 0 && (l.spec.hold ?? 0) > 0);
        expect(hasSustain, `${id}/${c.id} loop has no sustained voice`).toBe(true);
      }
    }
  });

  it('keeps every rockChip candidate below the tone that was denied (s4-01)', () => {
    // The developer denied all three rockChip candidates with one note — "almost
    // there, but they should be lower in tone" — so the re-offer's whole point is
    // a number: each candidate's spectral centre. Zero crossings stand in for it,
    // the same cheap proxy `./audio.test.ts` uses for rock-vs-hull, measured over a
    // fixed window so a long rasp and a short tick are compared on equal terms.
    // The denied trio measured 0.049 / 0.036 / 0.070 in this window; the re-offer
    // measures 0.017 / 0.012 / 0.031. The ceiling sits under the *darkest* thing
    // that was denied, so no future edit can drift a candidate back up into the
    // range the note rejected.
    const CEILING = 0.034;
    const rate = (spec: SoundSpec): number => {
      const buf = render(spec);
      const from = Math.round(0.003 * 44100); // past the attack transient
      const to = Math.min(buf.length, from + 2048);
      let n = 0;
      for (let i = from + 1; i < to; i++) if ((buf[i]! >= 0) !== (buf[i - 1]! >= 0)) n++;
      return n / Math.max(1, to - from);
    };
    for (const c of CANDIDATE_SLOTS.rockChip!.candidates) {
      expect(rate(c.spec), `rockChip/${c.id} is not lower in tone`).toBeLessThan(CEILING);
    }
    // And still a real choice rather than three takes on one idea: the brightest of
    // the three sits at least half again above the darkest.
    const rates = CANDIDATE_SLOTS.rockChip!.candidates.map((c) => rate(c.spec));
    expect(Math.max(...rates)).toBeGreaterThan(Math.min(...rates) * 1.5);
  });

  it('the committed manifest matches the source', () => {
    const manifest = JSON.parse(readFileSync('sound-review/manifest.json', 'utf8')) as {
      slots: { id: string; candidates: { id: string; params: string }[] }[];
    };
    expect(manifest.slots.map((s) => s.id)).toEqual([...SLOT_IDS]);
    for (const s of manifest.slots) {
      const slot = CANDIDATE_SLOTS[s.id]!;
      expect(slot).toBeDefined();
      expect(s.candidates.map((c) => c.id)).toEqual(slot.candidates.map((c) => c.id));
      for (const c of s.candidates) {
        expect(c.params).toBe(`src/art/audio/candidates.ts#${s.id}.${c.id}`);
      }
    }
  });
});
