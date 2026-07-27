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
