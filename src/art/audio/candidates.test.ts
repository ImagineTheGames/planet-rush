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
import { isLayered, loops, soundSpec, SOUND_NAMES, type SoundName, type SoundSpec } from './bank';
import { renderLayered, renderVoice, seamless, peak, rms, type VoiceSpec } from './synth';
import { XP_FILL_GAIN } from './engine';

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

  // -------------------------------------------------------------------------
  // The end-of-match summary slots (p1-07)
  // -------------------------------------------------------------------------
  //
  // Four slots the developer has not seen yet, so unlike the forty they have
  // *denied*, any of these three offers could be the one that ships. That is the
  // whole reason these assertions live here as well as on the bank: a candidate
  // is a shipped sound that has not been chosen yet, and the constraints plan
  // §6.5 puts on the set are constraints on the offer, not on the incumbent.
  const SUMMARY_SLOTS = ['xpTick', 'xpBarFill', 'levelUp', 'xpSettle'] as const;
  const DENIED_STINGS = ['matchEnd', 'musicWin', 'musicLoss'] as const;

  const voicesOf = (spec: SoundSpec): readonly VoiceSpec[] =>
    isLayered(spec) ? spec.layers.map((l) => l.spec) : [spec as VoiceSpec];

  it('offers the four summary slots on the board, three characters each', () => {
    for (const id of SUMMARY_SLOTS) {
      expect(SLOT_IDS, `${id} is not on the board`).toContain(id);
      const slot = CANDIDATE_SLOTS[id]!;
      expect(slot.current, `${id} points its "current" somewhere else`).toBe(id);
      expect(slot.candidates.map((c) => c.id)).toEqual(['a', 'b', 'c']);
      // Three *characters*, not three takes on one: the labels differ, and so do
      // the spec names the review page prints beside them.
      expect(new Set(slot.candidates.map((c) => c.character)).size).toBe(3);
      expect(new Set(slot.candidates.map((c) => c.spec.name)).size).toBe(3);
    }
  });

  it('keeps every summary candidate inside the amended tone envelope (GDD §4.7)', () => {
    for (const id of SUMMARY_SLOTS) {
      for (const c of CANDIDATE_SLOTS[id]!.candidates) {
        for (const v of voicesOf(c.spec)) {
          const where = `${id}/${c.id} ${v.name}`;
          expect(v.wave, `${where} is an arcade oscillator`).not.toBe('square');
          expect(v.wave, `${where} is an arcade oscillator`).not.toBe('saw');
          expect(v.arpMul, `${where} arpeggios`).toBeUndefined();
          expect(v.arpTime, `${where} arpeggios`).toBeUndefined();
          expect(v.dutySweep, `${where} sweeps its duty`).toBeUndefined();
          // `repeat` is allowed here and only here, as the grain rate of a
          // granular texture — the non-arcade use `docs/audio-revoice-spec.md`
          // §5.3 leaves open with a written reason. Above 20 ms it stops being a
          // texture and starts being the trill the clause retires.
          if (v.repeat !== undefined) expect(v.repeat, `${where} trills`).toBeLessThanOrEqual(0.02);
          const material =
            v.wave === 'noise' || (v.noiseMix ?? 0) > 0 || v.lowPass !== undefined || v.highPass !== undefined;
          expect(material, `${where} is a bare tone generator`).toBe(true);
          if (v.decay > 0) expect(v.decayCurve ?? 0, `${where} fades in a straight line`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('holds every count-up offer to the `pressTick` bound, and every fill to a loop', () => {
    // The two structural promises of the set, checked on the offers rather than
    // only on what shipped — approving `xpTick/b` must not quietly approve a tick
    // that fatigues, and approving an `xpBarFill` that is a one-shot would ship a
    // bed a skip cannot stop.
    // The bound is the SHIPPED press tick, not one of its offers: the offers are
    // themselves under review, and a bound that moves when the board does is not
    // a bound. Same arithmetic as `audio.test.ts` uses on the shipped tick.
    const press = render(soundSpec('pressTick'));
    for (const c of CANDIDATE_SLOTS.xpTick!.candidates) {
      const tick = render(c.spec);
      expect(tick.length, `xpTick/${c.id} is longer than a press tick`).toBeLessThanOrEqual(press.length);
      expect(peak(tick), `xpTick/${c.id} peaks over a press tick`).toBeLessThanOrEqual(peak(press));
    }
    for (const c of CANDIDATE_SLOTS.xpBarFill!.candidates) {
      expect(loops(c.spec), `xpBarFill/${c.id} is not a loop — a skip could not stop it`).toBe(true);
    }
    // And nothing else in the set has a tail that outlives the screen.
    for (const id of ['xpTick', 'levelUp', 'xpSettle'] as const) {
      for (const c of CANDIDATE_SLOTS[id]!.candidates) {
        expect(render(c.spec).length / 44100, `${id}/${c.id} outlives a skip`).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('offers nothing that would play OVER the result (plan §6.5)', () => {
    // The set-level constraint an approval could otherwise break: the XP beat
    // plays beneath the result, so every one of the twelve is quieter than the
    // sting it lands under. The bar bed is measured at its own ceiling
    // (`./engine` XP_FILL_GAIN = 0.5) because it is a held voice, not a one-shot.
    const result = rms(render(soundSpec('matchEnd')));
    for (const id of SUMMARY_SLOTS) {
      for (const c of CANDIDATE_SLOTS[id]!.candidates) {
        const level = rms(render(c.spec)) * (id === 'xpBarFill' ? XP_FILL_GAIN : 1);
        expect(level, `${id}/${c.id} would play over the result`).toBeLessThan(result);
      }
    }
  });

  it('offers nothing drawn from the three denied stings (plan §6.5)', () => {
    // *"No lane may reach for those three slots for this sequence."* Twelve
    // offers, none of which may be `matchEnd`, `musicWin` or `musicLoss` wearing
    // a new label — so: not the slot's incumbent, not one of their voices, and
    // not named after one.
    const deniedVoices = new Set<string>();
    for (const name of DENIED_STINGS) {
      // Both halves of a denied slot: the sting the bank ships, and the three
      // takes this file is currently offering in its place.
      for (const v of voicesOf(soundSpec(name))) deniedVoices.add(JSON.stringify(v));
      for (const c of CANDIDATE_SLOTS[name]!.candidates) {
        for (const v of voicesOf(c.spec)) deniedVoices.add(JSON.stringify(v));
      }
    }
    for (const id of SUMMARY_SLOTS) {
      const slot = CANDIDATE_SLOTS[id]!;
      expect(DENIED_STINGS as readonly string[]).not.toContain(slot.current);
      for (const c of slot.candidates) {
        for (const v of voicesOf(c.spec)) {
          expect(deniedVoices.has(JSON.stringify(v)), `${id}/${c.id} re-uses a denied voice`).toBe(false);
          for (const sting of DENIED_STINGS) {
            expect(v.name, `${v.name} is named after ${sting}`).not.toContain(sting);
          }
        }
      }
    }
  });

  // -------------------------------------------------------------------------
  // The adoption (s10-01)
  // -------------------------------------------------------------------------
  //
  // On 2026-08-13 three verdicts came back from the review page, the first
  // approvals since the developer pressed DENY ALL on the whole board:
  //
  //   rockChip  → b   04:01:48Z    "blunt pressure bite, sub weight"
  //   hullHit   → a   04:02:30Z    "coil bite on plate, hard and dry"
  //   rockCrack → c   04:03:05Z    "crystalline shear, ringing shards"
  //
  // The two tests below are the ratification, held as code. The first says the
  // three slots really do play what was chosen; the second says nothing ELSE
  // came with them. The second is the one that matters most in a year: the
  // standing verdict on the other thirty-seven is `deny-all`, in the developer's
  // own words — *"still have all the old sounds i said i didnt want there"* —
  // and the failure mode of an adoption brief is that it quietly revives a
  // neighbour while it is in there.
  const ADOPTED: Readonly<Record<string, string>> = { rockChip: 'b', hullHit: 'a', rockCrack: 'c' };

  const sameSamples = (a: Float32Array, b: Float32Array): boolean => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  };

  it('plays the chosen candidate in the three adopted slots, sample for sample', () => {
    // Not "looks similar" and not "was copied carefully" — identical samples. The
    // bank builds these three out of `./instrument` with the candidate's own
    // arguments and seeds, so the only way this fails is if someone edited one
    // side and not the other, which is precisely the thing to catch. Only the
    // layer NAMES differ (the bank's convention, not the board's), and names do
    // not reach the renderer — `synth.renderVoice` reads `seed` and nothing else.
    for (const [slot, letter] of Object.entries(ADOPTED)) {
      const chosen = CANDIDATE_SLOTS[slot]!.candidates.find((c) => c.id === letter);
      expect(chosen, `${slot}/${letter} is not on the board — the letter does not resolve`).toBeDefined();
      const shipped = render(soundSpec(slot as SoundName));
      expect(
        sameSamples(shipped, render(chosen!.spec)),
        `${slot} does not play candidate ${letter} — the shipped voice has drifted off the ratified one`,
      ).toBe(true);
    }
  });

  it('leaves the other thirty-seven slots denied — nothing else was revived', () => {
    // Every slot the developer has NOT ruled on since the deny-all keeps a shipped
    // voice that is none of its three offers. Stated as an inequality rather than
    // as a list of what shipped, because the incumbents are allowed to be
    // re-voiced by a future brief; what is not allowed is one of the denied takes
    // arriving in the bank without a verdict behind it.
    const denied = SLOT_IDS.filter((id) => ADOPTED[id] === undefined);
    expect(denied.length, 'the adopted set is not three slots any more').toBe(SLOT_IDS.length - 3);
    for (const id of denied) {
      const slot = CANDIDATE_SLOTS[id]!;
      const shipped = render(soundSpec(slot.current));
      for (const c of slot.candidates) {
        expect(
          sameSamples(shipped, render(c.spec)),
          `${id} now plays candidate ${c.id} — that slot is denied, and no brief has adopted it`,
        ).toBe(false);
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
