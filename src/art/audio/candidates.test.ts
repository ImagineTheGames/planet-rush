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
import { grains, plate, swept } from './instrument';
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

  // The board promises three options per slot, always. The LETTERS are not part of
  // that promise and one slot has had to move off them: a letter is the whole of
  // how a verdict names an offer (`/status/sound-choices.json` records `{"verdict":
  // "b"}`), so a slot carrying a live deny on `a`/`b`/`c` re-offers under new
  // letters or its own record stops being readable. See `RE_LETTERED` below.
  const RE_LETTERED: Readonly<Record<string, readonly string[]>> = {
    // a0-48. Denied 2026-08-07 with the deny-all reason, never re-briefed, so the
    // denied bed was still shipping when the developer met it again in play.
    // a0-60 added `g` rather than replacing the three: they post-date the denial
    // and carry no verdict, so re-voicing them would destroy un-judged work.
    ambient: ['d', 'e', 'f', 'g'],
    // a0-49. The two slots whose denial post-dates every offer standing against
    // it — see `docs/sound-denials-outstanding.md`, which derives that for all 38
    // outstanding denials and dispositions each one revoice / cut / superseded.
    // `oreCollect` denied 2026-08-14 ("more sparkle… but subtle… shouldn't be too
    // long"), `levelUp` denied 2026-08-14 ("too toony, doesn't sound rewarding").
    oreCollect: ['d', 'e', 'f'],
    levelUp: ['d', 'e', 'f'],
  };

  /**
   * The a0-60 sweep's status of record, **read** rather than restated here.
   *
   * `docs/sound-revoice-manifest.md` is what the developer and the next brief look
   * at; a copy of it in this file would be a second truth that drifts the first
   * time a row moves. So the table is parsed: `| <slot> | <status> | <note> |`.
   */
  const REVOICE_MANIFEST: ReadonlyMap<string, string> = (() => {
    const rows = new Map<string, string>();
    for (const line of readFileSync('docs/sound-revoice-manifest.md', 'utf8').split('\n')) {
      const m = /^\|\s*([A-Za-z]+)\s*\|\s*(todo|done|held)\s*\|/i.exec(line);
      if (m) rows.set(m[1]!, m[2]!.toLowerCase());
    }
    return rows;
  })();

  /** The slots the sweep has actually landed — the only rows this file holds to the new bar. */
  const REVOICED: readonly string[] = [...REVOICE_MANIFEST].filter(([, s]) => s === 'done').map(([id]) => id);

  /**
   * The letters the 2026-08-07 `deny-all` was recorded against, on all 35 slots.
   *
   * The verdict names an offer by its letter and nothing else, so these three are
   * spent: an offer filed under one of them is a sound the developer has already
   * turned down wearing the same name as its replacement.
   */
  const DENIED_IDS: readonly string[] = ['a', 'b', 'c'];

  it('every re-voiced slot offers a fresh set', () => {
    // The a0-60 bar, driven off the manifest so the test cannot drift from what
    // shipped: a row that says `done` is a promise of four offers under letters
    // the record has not already spent, and this is where that promise is kept.
    expect(REVOICE_MANIFEST.size, 'the manifest does not list the thirty-five').toBe(35);
    expect(REVOICED.length, 'the DoD floor is eight re-voiced slots').toBeGreaterThanOrEqual(8);
    for (const id of REVOICED) {
      const slot = CANDIDATE_SLOTS[id];
      expect(slot, `${id} is marked done but is not on the board`).toBeDefined();
      if (!slot) continue;
      expect(slot.candidates.length, `${id} is marked done with fewer than four offers`).toBeGreaterThanOrEqual(4);
      for (const c of slot.candidates) {
        expect(DENIED_IDS, `${id}/${c.id} re-offers under a denied letter`).not.toContain(c.id);
      }
      // Four *characters*, not four takes on one — the same bar the board has
      // always been held to, applied to the wider set.
      expect(new Set(slot.candidates.map((c) => c.id)).size, `${id} offers a letter twice`).toBe(
        slot.candidates.length,
      );
      expect(new Set(slot.candidates.map((c) => c.character)).size).toBe(slot.candidates.length);
      expect(new Set(slot.candidates.map((c) => c.spec.name)).size).toBe(slot.candidates.length);
      for (const c of slot.candidates) expect(c.character.trim().length).toBeGreaterThan(0);
    }
    // A `todo` row is a slot still wearing the theme that was denied — it must
    // still be *on the board*, so the next brief has something to pick up.
    for (const [id, status] of REVOICE_MANIFEST) {
      if (status === 'todo') expect(CANDIDATE_SLOTS[id], `${id} is owed but missing`).toBeDefined();
    }
  });

  it('every slot offers a full set of candidates, one letter each, with characters', () => {
    for (const id of SLOT_IDS) {
      const slot = CANDIDATE_SLOTS[id]!;
      if (REVOICE_MANIFEST.get(id) === 'done') continue; // held to the wider bar above
      expect(slot.candidates.map((c) => c.id), `${id} does not offer three`).toEqual(
        RE_LETTERED[id] ?? ['a', 'b', 'c'],
      );
      for (const c of slot.candidates) {
        expect(c.character.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('never re-offers under a letter that carries a live verdict (a0-48)', () => {
    // The property, rather than the list: for any slot that has been re-lettered,
    // none of its offers may reuse a letter the record already spent. Stated this
    // way so the next re-offer on the next denied slot inherits the rule instead
    // of re-deriving it — and so `ambient` cannot quietly drift back onto `a`.
    for (const [id, letters] of Object.entries(RE_LETTERED)) {
      const slot = CANDIDATE_SLOTS[id]!;
      expect(slot, `${id} is re-lettered but not on the board`).toBeDefined();
      for (const c of slot.candidates) {
        expect(['a', 'b', 'c'], `${id}/${c.id} re-uses a denied letter`).not.toContain(c.id);
      }
      expect(new Set(slot.candidates.map((c) => c.id)).size, `${id} offers a letter twice`).toBe(letters.length);
      // Three characters, not three takes on one — the same bar every other family
      // on this board is held to.
      expect(new Set(slot.candidates.map((c) => c.character)).size).toBe(slot.candidates.length);
      expect(new Set(slot.candidates.map((c) => c.spec.name)).size).toBe(slot.candidates.length);
    }
  });

  it('offers a bed that could not repeat the complaint that re-opened the slot (a0-48)', () => {
    // The developer's words about the shipped bed were *"deep"* and *"annoying"*,
    // and the shipped one was four `attack: 0` layers of held pitch. An offer that
    // arrives at full level on sample zero, or that has nothing done to it, is the
    // sound that was complained about wearing a new letter — so the offers are held
    // to the same two properties the shipped bed now is (`./audio.test.ts`, "the
    // ambient bed is not a bare held tone"), plus the loop-seam rule that stops a
    // slow fade-in becoming a dip once per lap.
    for (const c of CANDIDATE_SLOTS.ambient!.candidates) {
      const spec = c.spec;
      expect(isLayered(spec), `ambient/${c.id} is a single voice — that is not a bed`).toBe(true);
      if (!isLayered(spec)) continue;
      const crossfade = spec.crossfade ?? 0.04;
      for (const { spec: v } of spec.layers) {
        const where = `ambient/${c.id} ${v.name}`;
        const moves =
          (v.decayCurve ?? 0) > 0 ||
          (v.lowPassEnd !== undefined && v.lowPassEnd !== v.lowPass) ||
          v.bandPass === true ||
          (v.resonance ?? 0) > 0;
        expect(moves, `${where} is a held pitch with nothing done to it`).toBe(true);
        expect(v.attack, `${where} arrives at full level on its first sample`).toBeGreaterThan(0);
        if (v.decay > 0) continue;
        expect(v.attack, `${where} is sustained across the seam but fades in past the crossfade`).toBeLessThanOrEqual(
          crossfade,
        );
      }
      // …and one of them genuinely swells, rather than every attack being a
      // click-guard that satisfies the clause above and changes nothing.
      expect(
        spec.layers.some((l) => l.spec.attack >= 1),
        `ambient/${c.id} has no swell in it`,
      ).toBe(true);
      // Quieter than the bed that was called annoying, measured rather than
      // asserted about: the complaint is a level complaint as much as a voicing one.
      expect(rms(render(spec)), `ambient/${c.id} is louder than the bed that was denied`).toBeLessThan(
        rms(render(soundSpec('ambient'))) * 1.35,
      );
    }
  });

  it('names the fourth answer on the one slot that is allowed one (a0-48)', () => {
    // *"Ship it off by default, with a toggle"* is a legitimate outcome for the
    // bed — item 3 on the GDD §4.9 cut list, and `./bank` records that nothing
    // else in the mix depends on it. It is offered rather than taken: the ruling
    // is the developer's. It is also the ONLY slot that may carry it, because
    // every other sound on this board is a mechanic and "cut it" is not on the
    // table for a mechanic (GDD §2.2, §4.9).
    const offered = SLOT_IDS.filter((id) => CANDIDATE_SLOTS[id]!.fourthOption !== undefined);
    expect(offered).toEqual(['ambient']);
    const text = CANDIDATE_SLOTS.ambient!.fourthOption!;
    expect(text.length, 'the fourth option is asserted rather than argued').toBeGreaterThan(120);
    expect(text).toContain('§4.9');
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
      // `levelUp` is on `d`/`e`/`f` since a0-49 — it collected a verdict of its
      // own on 2026-08-14, so it is no longer one of the four slots the developer
      // has not seen. The other three are still on their first letters.
      expect(slot.candidates.map((c) => c.id)).toEqual(RE_LETTERED[id] ?? ['a', 'b', 'c']);
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
  // The two answered denials (a0-49)
  // -------------------------------------------------------------------------
  //
  // `docs/sound-denials-outstanding.md` dispositions all 38 outstanding denials,
  // and exactly two of them come out as **revoice**: the slots where the denial
  // post-dates every offer standing against it. Each carries its own reason, in
  // the developer's own words, and the two reasons ask for opposite things — so
  // the offers are held to the words rather than to a house style, and the tests
  // below are those words turned into numbers. Every bound is measured against
  // **the takes that were denied**, not against a constant somebody picked: the
  // only thing that makes a re-offer an answer rather than another guess is that
  // it moved, in the direction that was asked for, from the thing being rejected.
  //
  // A third slot — `xpBarFill` — is dispositioned **cut** in the same ledger
  // (*"we don't need this at all no need for regeneration"*) and is deliberately
  // NOT re-offered, which is why it is absent from `RE_LETTERED` above.

  /** RMS of everything under `hz`, one-pole — the same filter `./synth` uses. */
  const lowBandRms = (buf: Float32Array, hz: number): number => {
    const a = 1 - Math.exp((-2 * Math.PI * hz) / 44100);
    let y = 0;
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      y += ((buf[i] ?? 0) - y) * a;
      sum += y * y;
    }
    return Math.sqrt(sum / Math.max(1, buf.length));
  };

  /** Share of total energy above `hz` — "how much of this sound is bright detail". */
  const brightShare = (buf: Float32Array, hz: number): number => {
    const a = 1 - Math.exp((-2 * Math.PI * hz) / 44100);
    let y = 0;
    let hi = 0;
    let all = 0;
    for (let i = 0; i < buf.length; i++) {
      const x = buf[i] ?? 0;
      y += (x - y) * a;
      hi += (x - y) * (x - y);
      all += x * x;
    }
    return all > 0 ? hi / all : 0;
  };

  /** RMS of the last 60% over the first 40% — is anything left after the landing. */
  const lateOverEarly = (buf: Float32Array): number => {
    const split = Math.floor(buf.length * 0.4);
    const seg = (from: number, to: number): number => {
      let s = 0;
      for (let i = from; i < to; i++) s += (buf[i] ?? 0) ** 2;
      return Math.sqrt(s / Math.max(1, to - from));
    };
    return seg(split, buf.length) / Math.max(1e-9, seg(0, split));
  };

  /** The denied takes for a re-lettered slot, from the commit before the re-offer. */
  const deniedOf = (slot: string): readonly SoundSpec[] =>
    DENIED_TAKES[slot]!.map((s) => s as SoundSpec);

  // The takes the developer denied, **inlined** rather than reached for with a
  // `git show`. They are gone from `./candidates` by design — that is the whole
  // point of a re-offer — so a test that compared against the file would have
  // nothing to compare against, and one that shelled out to git would stop
  // reproducing the day the commit is rewritten. These are copied verbatim from
  // `candidates.ts` at `334c460`, the tip of `main` when a0-49 opened.
  const DENIED_TAKES: Readonly<Record<string, readonly SoundSpec[]>> = {
    oreCollect: [
      {
        name: 'oreCollect_a_magneticSnap',
        layers: [
          ...plate('oreCollect_a.snap', 1500, { gain: 0.4, decay: 0.05, ratios: [1, 2.41], q: 8, curve: 6, punch: 0.6, grain: 0.34, seed: 30190 }),
          swept('oreCollect_a.pull', { wave: 'noise', freq: 300, from: 900, to: 380, q: 2.4, gain: 0.18, attack: 0.0008, hold: 0.004, decay: 0.045, curve: 5, seed: 30193 }),
        ],
      },
      {
        name: 'oreCollect_b_servoIntake',
        layers: [
          swept('oreCollect_b.intake', { wave: 'triangle', freq: 460, from: 380, to: 2600, q: 5.5, gain: 0.34, attack: 0.003, hold: 0.012, decay: 0.075, curve: 3.4, noiseMix: 0.22, seed: 30195 }),
          grains('oreCollect_b.step', { freq: 900, grain: 0.004, gain: 0.14, hold: 0.004, decay: 0.03, curve: 6, from: 2600, q: 3, hp: 500, seed: 30196 }),
        ],
      },
      {
        name: 'oreCollect_c_telemetry',
        layers: [
          ...plate('oreCollect_c.blip', 2200, { gain: 0.3, decay: 0.055, ratios: [1, 2.05], q: 12, curve: 6, punch: 0.4, grain: 0.08, edge: 0, seed: 30200 }),
        ],
      },
    ],
    levelUp: [
      {
        name: 'levelUp_a_dryArrival',
        layers: [
          grains('levelUp_a.approach', { freq: 300, grain: 0.005, gain: 0.2, attack: 0.006, hold: 0.014, decay: 0.06, curve: 2.6, from: 800, to: 3600, q: 3.4, hp: 220, seed: 35200 }),
          grains('levelUp_a.land', { freq: 900, grain: 0.0022, gain: 0.34, hold: 0.01, decay: 0.16, curve: 5, from: 5200, to: 1800, q: 3.6, hp: 500, at: 0.085, seed: 35201 }),
          swept('levelUp_a.seat', { wave: 'triangle', freq: 110, from: 300, to: 180, q: 2, gain: 0.2, attack: 0.002, hold: 0.012, decay: 0.2, curve: 4, noiseMix: 0.1, at: 0.085, seed: 35203 }),
        ],
      },
      {
        name: 'levelUp_b_pressureSeating',
        layers: [
          swept('levelUp_b.charge', { wave: 'noise', freq: 260, from: 600, to: 2800, q: 4.5, gain: 0.16, attack: 0.008, hold: 0.014, decay: 0.06, curve: 2.4, hp: 180, seed: 35210 }),
          swept('levelUp_b.seat', { wave: 'triangle', freq: 220, freqEnd: 208, from: 2400, to: 520, q: 3.4, gain: 0.36, attack: 0.002, hold: 0.016, decay: 0.3, curve: 4, punch: 0.5, noiseMix: 0.12, at: 0.085, seed: 35211 }),
          swept('levelUp_b.sub', { wave: 'sine', freq: 82.41, from: 240, to: 120, q: 2, gain: 0.22, attack: 0.003, hold: 0.012, decay: 0.22, curve: 3.6, noiseMix: 0.05, at: 0.085, seed: 35212 }),
        ],
      },
      {
        name: 'levelUp_c_struckPlate',
        layers: [
          swept('levelUp_c.approach', { wave: 'noise', freq: 320, from: 700, to: 3000, q: 5, gain: 0.13, attack: 0.006, hold: 0.012, decay: 0.06, curve: 2.6, hp: 200, seed: 35220 }),
          ...plate('levelUp_c.root', 880, { gain: 0.3, decay: 0.32, ratios: [1, 2.41], q: 8, curve: 4, punch: 0.4, grain: 0.22, at: 0.085, seed: 35222 }),
          ...plate('levelUp_c.fifth', 1318.51, { gain: 0.16, decay: 0.24, ratios: [1], q: 9, curve: 4.5, grain: 0.18, edge: 0, at: 0.085, seed: 35226 }),
        ],
      },
    ],
  };

  it('re-offers nothing a denied take already was (a0-49)', () => {
    // The floor under both slots: a re-offer under a fresh letter that renders the
    // same samples as a take the developer turned down is the denial being served
    // back with a new label, and the letter rule would then be hiding it rather
    // than exposing it.
    for (const slot of ['oreCollect', 'levelUp'] as const) {
      const denied = deniedOf(slot).map((s) => render(s));
      for (const c of CANDIDATE_SLOTS[slot]!.candidates) {
        const buf = render(c.spec);
        for (const [i, d] of denied.entries()) {
          expect(
            buf.length === d.length && buf.every((v, k) => v === d[k]),
            `${slot}/${c.id} is denied take ${'abc'[i]} under a new letter`,
          ).toBe(false);
        }
      }
    }
  });

  it('adds sparkle to `oreCollect` without adding level or length (a0-49)', () => {
    // *"add a little bit more of sparkle to it, like you've won a prize, but
    // subtle... it shouldn't be too long"* — three clauses, three bounds.
    //
    // SPARKLE is read as high-frequency detail with a short life, and measured as
    // the share of energy above 3 kHz — a share rather than a level, because
    // "sparkle" is a character and the next clause is what bounds the level.
    // 3 kHz and not higher because `./synth` clamps a resonant cutoff to
    // SVF_MAX_HZ_FRACTION (~6.5 kHz at 44.1 k), so 3–6.4 kHz *is* the top of this
    // bank's spectrum.
    const denied = deniedOf('oreCollect').map((s) => render(s));
    const deniedBrightest = Math.max(...denied.map((b) => brightShare(b, 3000)));
    const incumbent = render(soundSpec('oreCollect'));

    for (const c of CANDIDATE_SLOTS.oreCollect!.candidates) {
      const buf = render(c.spec);
      const where = `oreCollect/${c.id}`;
      // More sparkle than any of the three that were denied, with room to spare —
      // not "0.5% brighter than the brightest", which would satisfy a grep and
      // nobody's ear.
      expect(brightShare(buf, 3000), `${where} is no brighter than the takes that were denied`).toBeGreaterThan(
        deniedBrightest * 1.25,
      );
      // *"but subtle"* qualifies the sparkle, not the cue, so it binds the whole
      // sound: adding brightness may not make this louder than the sound the
      // developer was asking to add sparkle *to*.
      expect(rms(buf), `${where} is louder than the sound it adds sparkle to`).toBeLessThanOrEqual(rms(incumbent));
      expect(peak(buf), `${where} peaks over the sound it adds sparkle to`).toBeLessThanOrEqual(peak(incumbent));
      // *"it shouldn't be too long"* — a hard bound, because `TELL.oreCollect`
      // fires on every ore pickup. Shorter than the longest take that was denied.
      expect(buf.length, `${where} is longer than the takes that were denied`).toBeLessThanOrEqual(
        Math.max(...denied.map((b) => b.length)),
      );
    }
  });

  it('keeps `oreCollect` clear of `depositTick`, which has not moved (a0-49)', () => {
    // The tightest pair in the bank (§8) — *picked a chunk up* vs *banked a chunk*
    // — and the one way a re-voice can fail §4.7 while satisfying its own brief is
    // by colliding two mechanics. The sparkle moves this slot up, so the gap can
    // only widen; this asserts it did, against every `depositTick` offer, so a
    // mixed pair of verdicts is safe too.
    const zcr = (buf: Float32Array): number => {
      let n = 0;
      for (let i = 1; i < buf.length; i++) if ((buf[i]! >= 0) !== (buf[i - 1]! >= 0)) n++;
      return n / Math.max(1, buf.length);
    };
    const deposits = [
      render(soundSpec('depositTick')),
      ...CANDIDATE_SLOTS.depositTick!.candidates.map((c) => render(c.spec)),
    ];
    for (const c of CANDIDATE_SLOTS.oreCollect!.candidates) {
      const ore = render(c.spec);
      for (const dep of deposits) {
        expect(zcr(ore), `oreCollect/${c.id} sits on top of a depositTick voice`).toBeGreaterThan(zcr(dep) * 1.5);
      }
    }
  });

  it('answers `levelUp` with mass and with something left after the landing (a0-49)', () => {
    // *"sounds too toony, doesn't sound rewarding"*. The first half is already
    // held by the tone-envelope test above, which every offer on this slot passes.
    // The second half is the one that needed a number, because a0-01 learnt the
    // expensive way that removing the toy is not the same as adding the reward —
    // bare sine partials in place of an arcade oscillator produced *"a
    // glockenspiel… not less toony, differently toony."*
    //
    // A reward in this register is ARRIVAL WITH MASS: a low body under the landing
    // that is still there afterwards. Two measurements, both against the takes
    // that were called unrewarding.
    const denied = deniedOf('levelUp').map((s) => render(s));
    const deniedMass = Math.max(...denied.map((b) => lowBandRms(b, 200)));
    const deniedSustain = Math.max(...denied.map((b) => lateOverEarly(b)));
    const result = rms(render(soundSpec('matchEnd')));

    for (const c of CANDIDATE_SLOTS.levelUp!.candidates) {
      const buf = render(c.spec);
      const where = `levelUp/${c.id}`;
      expect(lowBandRms(buf, 200), `${where} has no more mass than the takes that were denied`).toBeGreaterThan(
        deniedMass,
      );
      expect(lateOverEarly(buf), `${where} is over as soon as it lands, like the takes that were denied`).toBeGreaterThan(
        deniedSustain,
      );
      // …and neither number may be bought by turning the cue up. The XP beat plays
      // BENEATH the result (plan §6.5), and the margin is stated rather than left
      // at the edge of the inequality the summary test already checks.
      expect(rms(buf), `${where} bought its mass with level`).toBeLessThan(result * 0.8);
    }
  });

  it('never spells a major third on `levelUp` (a0-49)', () => {
    // *The interface does not congratulate* (§4.7 register 2), and this cue can
    // land on top of a DEFEAT headline — so the one interval it may not contain is
    // the one that reads as a fanfare. Checked on the PITCHED voices only: a
    // `freq` on a noise voice sets a grain envelope, not a note, and holding noise
    // to an interval rule would be enforcing music on something that has no pitch.
    const MAJOR_THIRD = Math.pow(2, 4 / 12);
    for (const c of CANDIDATE_SLOTS.levelUp!.candidates) {
      const pitched = voicesOf(c.spec).filter((v) => v.wave !== 'noise' && (v.noiseMix ?? 0) < 0.5);
      for (const a of pitched) {
        for (const b of pitched) {
          if (a === b) continue;
          let r = Math.max(a.freq, b.freq) / Math.min(a.freq, b.freq);
          while (r >= 2) r /= 2; // interval class — a tenth congratulates too
          expect(
            Math.abs(r - MAJOR_THIRD) / MAJOR_THIRD,
            `levelUp/${c.id} spells a major third between ${a.name} and ${b.name}`,
          ).toBeGreaterThan(0.02);
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

  it('leaves every un-adopted slot alone — nothing else was revived', () => {
    // The other forty-one: thirty-seven carrying the developer's standing
    // `deny-all`, and the four summary slots (p1-07) they have not been shown
    // yet. Neither group has an approval behind it, so neither may be playing one
    // of its offers. Stated as an inequality rather than as a list of what
    // shipped, because the incumbents are allowed to be re-voiced by a future
    // brief; what is not allowed is one of the offers arriving in the bank
    // without a verdict behind it.
    const denied = SLOT_IDS.filter((id) => ADOPTED[id] === undefined);
    expect(denied.length, 'the adopted set is not three slots any more').toBe(SLOT_IDS.length - 3);
    for (const id of denied) {
      const slot = CANDIDATE_SLOTS[id]!;
      const shipped = render(soundSpec(slot.current));
      for (const c of slot.candidates) {
        expect(
          sameSamples(shipped, render(c.spec)),
          `${id} now plays candidate ${c.id} — no verdict has adopted that slot`,
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
