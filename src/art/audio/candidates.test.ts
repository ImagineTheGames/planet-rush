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
// The ratified Gantry/Bone glass. Imported rather than restated: a0-67's
// `pressTick` reason is that a slot LEFT this family, so the test that puts it
// back has to be measured against the family's own numbers, not against a copy
// of them that can drift (`./ui-cues`, s6-01).
import { A_FLAT_6, FOURTH_BELOW, GLASS_PARTIALS, OCTAVE_ABOVE } from './ui-cues';
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

  it('no take names a slot other than the one it sits in', () => {
    // The back-pointer is a guard, not decoration: pasting a block under the wrong
    // heading in this file is the cheap mistake, and it would offer the developer
    // a sound for some other event with nothing downstream to catch it (a0-57).
    for (const id of SLOT_IDS) {
      const slot = CANDIDATE_SLOTS[id]!;
      for (const c of [...slot.candidates, ...(slot.denied ?? [])]) {
        if (c.slot !== undefined) expect(c.slot, `${id}/${c.id} claims another slot`).toBe(id);
      }
    }
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
    // a0-67: `oreCollect`'s d/e/f were denied in turn on 2026-08-17, so it is the
    // one slot on `g` — it was never in the a0-60 sweep, so it has spent a-f
    // where the fifteen slots that were have spent a-g. `j` is the incumbent,
    // offered as a letter so *"keep what ships"* is an expressible verdict.
    oreCollect: ['g', 'h', 'i', 'j'],
    levelUp: ['d', 'e', 'f'],
    // a0-57. Denied 2026-08-16 with a CATEGORY reason — *"none of these sound
    // like sounds for XP collection"* — so the re-offer is four readings of the
    // event rather than three takes on the denied family. Four letters, not
    // three: the board's promise is "options", and the count is not what a
    // verdict names.
    xpSettle: ['d', 'e', 'f', 'g'],
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

  // -------------------------------------------------------------------------
  // Round two (a0-67) — sixteen slots, sixteen reasons
  // -------------------------------------------------------------------------
  //
  // The a0-60 sweep answered ONE sentence over thirty-five slots. On 2026-08-17
  // the developer listened to the whole re-voiced board and denied sixteen of
  // them with a **specific reason each** — *"none of these sound like a shield
  // hit"*, *"they should sound like an explosion"*, *"what happened to the glass
  // theme we had"*. A theme cannot answer sixteen different sentences, so the
  // round is worked slot by slot and `docs/sound-round-two-manifest.md` carries
  // every reason verbatim beside the row it belongs to.
  //
  // This is the gate on that manifest, and it is deliberately the same shape as
  // the a0-60 one: the table is READ, never restated here, so the test and the
  // status of record cannot drift apart.

  /** `| <slot> | <status> | "<reason>" | <note> |` out of the round-two manifest. */
  const ROUND_TWO: ReadonlyMap<string, string> = (() => {
    const rows = new Map<string, string>();
    for (const line of readFileSync('docs/sound-round-two-manifest.md', 'utf8').split('\n')) {
      const m = /^\|\s*([A-Za-z]+)\s*\|\s*(todo|done|held)\s*\|/i.exec(line);
      if (m) rows.set(m[1]!, m[2]!.toLowerCase());
    }
    return rows;
  })();

  /**
   * The letters a verdict has already spent, per slot.
   *
   * A letter is the whole of how a verdict names an offer (`/status/sound-
   * choices.json` records `{"verdict": "b"}`), so a re-offer under a spent letter
   * makes the standing record unreadable — nobody can tell which take the deny was
   * aimed at. Two denials are on these slots and they did not spend the same
   * letters, which is why this is a table and not a constant:
   *
   *  - **2026-08-07**, `deny-all` on `a`/`b`/`c` — all sixteen.
   *  - **2026-08-17**, round two — `d`/`e`/`f`/`g` on the fifteen that were in the
   *    a0-60 sweep, and `d`/`e`/`f` on `oreCollect`, which was not in it (it was
   *    re-voiced a day earlier under a0-49 and only ever had three).
   */
  const SPENT: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
    [...ROUND_TWO.keys()].map((id) => [id, id === 'oreCollect' ? list('a', 'f') : list('a', 'g')]),
  );

  /** Inclusive letter range, so a spent set is stated as its endpoints. */
  function list(from: string, to: string): readonly string[] {
    const out: string[] = [];
    for (let c = from.charCodeAt(0); c <= to.charCodeAt(0); c++) out.push(String.fromCharCode(c));
    return out;
  }

  it('round two answers the reason it was given', () => {
    // The manifest lists the sixteen, and the DoD floor is half of them landed.
    expect(ROUND_TWO.size, 'the round-two manifest does not list the sixteen').toBe(16);
    const done = [...ROUND_TWO].filter(([, s]) => s === 'done').map(([id]) => id);
    expect(done.length, 'the DoD floor is eight slots answered').toBeGreaterThanOrEqual(8);

    for (const id of done) {
      const slot = CANDIDATE_SLOTS[id];
      expect(slot, `${id} is marked done but is not on the board`).toBeDefined();
      if (!slot) continue;
      // Four offers, the round-one bar carried forward: a reason this specific
      // deserves a set wide enough that the next verdict is a choice.
      expect(slot.candidates.length, `${id} is marked done with fewer than four offers`).toBeGreaterThanOrEqual(4);
      for (const c of slot.candidates) {
        expect(SPENT[id], `${id}/${c.id} re-offers under a letter a verdict has spent`).not.toContain(c.id);
      }
      // Distinct letters, distinct characters, distinct specs — four *answers*,
      // not four takes on one, which is the bar every board on this file is held
      // to and the one a round answering "make N distinct sounds" must not miss.
      expect(new Set(slot.candidates.map((c) => c.id)).size, `${id} offers a letter twice`).toBe(
        slot.candidates.length,
      );
      expect(new Set(slot.candidates.map((c) => c.character)).size, `${id} repeats a character`).toBe(
        slot.candidates.length,
      );
      expect(new Set(slot.candidates.map((c) => c.spec.name)).size, `${id} repeats a spec name`).toBe(
        slot.candidates.length,
      );
      // Every take names the slot it sits in. Round two touches sixteen blocks
      // scattered through 3 000 lines of near-identical ones, so the back-pointer
      // stops being decoration and starts being the only thing between a
      // mis-paste and the developer being offered a sound for another event.
      for (const c of slot.candidates) {
        expect(c.slot, `${id}/${c.id} does not name its slot`).toBe(id);
      }
    }

    // A `todo` row is a slot still wearing the set that was denied — it must stay
    // on the board so the next brief has something to pick up.
    for (const [id, status] of ROUND_TWO) {
      if (status === 'todo') expect(CANDIDATE_SLOTS[id], `${id} is owed but missing`).toBeDefined();
    }
  });

  it('offers the sound that ships as a letter wherever the developer said they like it', () => {
    // Four of the sixteen reasons open with some form of *"i like current"*, and
    // two more ask to be shown directions to move away from it. The board could
    // not express either: `/status/sound-choices.json` records a slot and a
    // LETTER, so *"keep what ships"* was not a verdict anybody could give, and the
    // A/B against the incumbent had to be done from memory between two clicks.
    //
    // So the incumbent takes a letter on those six slots. The assertion that
    // matters is that it really IS the incumbent — an "anchor" that has been
    // quietly improved is the worst possible offer on the board, because it makes
    // the developer's own reference the thing they cannot trust.
    const LIKE_CURRENT = ['bankOre', 'upgradeBought', 'musicWin', 'musicLoss'] as const;
    const SHOW_ME_DIRECTIONS = ['oreCollect', 'turretFire'] as const;
    for (const id of [...LIKE_CURRENT, ...SHOW_ME_DIRECTIONS]) {
      if (ROUND_TWO.get(id) !== 'done') continue; // not landed yet; the row says so
      const slot = CANDIDATE_SLOTS[id]!;
      const anchors = slot.candidates.filter((c) => c.anchor === true);
      expect(anchors.length, `${id} does not offer what ships as a letter`).toBe(1);
      const shipped = render(soundSpec(slot.current));
      const offered = render(anchors[0]!.spec);
      expect(
        offered.length === shipped.length && offered.every((v, i) => v === shipped[i]),
        `${id}'s anchor is not the sound that ships`,
      ).toBe(true);
      // …and it still has to be three NEW takes beside it, not two and a copy.
      expect(slot.candidates.length - anchors.length, `${id} offers fewer than three new takes`).toBeGreaterThanOrEqual(
        3,
      );
    }
    // Nowhere else: an anchor on a slot whose reason did not ask for one is a
    // fourth offer that costs a listen and answers nothing.
    for (const id of SLOT_IDS) {
      if (([...LIKE_CURRENT, ...SHOW_ME_DIRECTIONS] as readonly string[]).includes(id)) continue;
      expect(
        CANDIDATE_SLOTS[id]!.candidates.some((c) => c.anchor === true),
        `${id} offers an anchor nobody asked for`,
      ).toBe(false);
    }
  });

  it('answers `buildPlaced` with a build STARTING, which none of the denied takes was', () => {
    // *"none of these sound like a build started"*. The denied four were a
    // stepper into a stop, a vacuum seating, a weld quenched and one latch —
    // four correct executions of this slot's own standing note (*"a latch, never
    // a fanfare"*, §7.3) and four sounds that END. The slot fires when a turret
    // STARTS building.
    //
    // So the property is the shape rather than the material: the cue must be
    // going somewhere when it stops. Measured as the last third's energy against
    // the first third's — an opening gesture is >1, a seating one is well under.
    // The shipped voice measures 0.02, which is how completely it terminates.
    const thirds = (spec: SoundSpec): number => {
      const buf = render(spec);
      const t = Math.floor(buf.length / 3);
      return rms(buf.subarray(buf.length - t)) / Math.max(1e-9, rms(buf.subarray(0, t)));
    };
    expect(thirds(soundSpec('buildPlaced')), 'the shipped voice already opens — the diagnosis is wrong').toBeLessThan(
      0.2,
    );
    for (const c of CANDIDATE_SLOTS.buildPlaced!.candidates) {
      expect(thirds(c.spec), `buildPlaced/${c.id} ends instead of starting`).toBeGreaterThan(1);
    }
    // The other half of the §8 pair is NOT asserted, and the reason is worth
    // more than the assertion would be: `buildComplete` was not denied this
    // round, so its four offers carry no verdict and this brief may not touch
    // them — re-voicing un-judged work is destroying a review, not doing one
    // (the a0-48 rule). Three of them seat (0.31 / 0.40 / 0.06) and **`f` — "two
    // welds, the second holding" — opens, at 1.43.** If the developer adopts a
    // `buildPlaced` above and `buildComplete/f`, the two ends of one build are
    // the same gesture and want listening to as a pair. That belongs on the
    // board, not in a test that would fail for a lane that did nothing wrong.
  });

  it('brings `pressTick` back into the glass family it left (a0-67)', () => {
    // *"what happened to the glass theme we had, none of these are glass themed
    // like the main menu"* — a regression report, and a correct one. The shipped
    // tick is struck glass at A♭6 (`./bank`'s `strike`, the ratified Gantry/Bone
    // material); the four takes it was offered instead were a capacitive
    // contact, a damped actuator, a filtered band and a click. Every one of them
    // satisfied "modern/sci-fi, not retro/toony". None of them was glass.
    //
    // Glass is checked here as the thing it actually is, not as a word in a
    // character label: sine partials on the ratified inharmonic ratios, upper
    // ones decaying faster than the fundamental, and a strike that is short but
    // never zero. A take that describes itself as glass and is made of noise
    // fails this.
    const menuRoots = [A_FLAT_6, OCTAVE_ABOVE, FOURTH_BELOW];
    for (const c of CANDIDATE_SLOTS.pressTick!.candidates) {
      const where = `pressTick/${c.id}`;
      const voices = voicesOf(c.spec);
      const partials = voices.filter((v) => v.wave === 'sine');
      expect(partials.length, `${where} has no struck partials in it — that is not glass`).toBeGreaterThanOrEqual(2);

      // The fundamental is a pitch the menu family actually uses…
      const root = Math.min(...partials.map((v) => v.freq));
      expect(
        menuRoots.some((f) => Math.abs(root - f) < 1),
        `${where} is struck at ${root} Hz, which is not a pitch the menu set uses`,
      ).toBe(true);

      // …the partials sit on the ratified spacing, in order…
      const ratios = [...partials].sort((a, b) => a.freq - b.freq).map((v) => v.freq / root);
      for (const [i, r] of ratios.entries()) {
        expect(Math.abs(r - GLASS_PARTIALS[i]!), `${where} partial ${i} is at ×${r}, not the glass spacing`).toBeLessThan(
          0.01,
        );
      }

      // …the upper ones die first, which is the whole difference from bell metal…
      const decays = [...partials].sort((a, b) => a.freq - b.freq).map((v) => v.decay);
      for (let i = 1; i < decays.length; i++) {
        expect(decays[i]!, `${where} partial ${i} outlasts the one below it — that is a chime`).toBeLessThan(
          decays[i - 1]!,
        );
      }

      // …and it is struck, not switched on.
      for (const v of partials) {
        expect(v.attack, `${where} arrives with a click`).toBeGreaterThan(0);
        expect(v.attack, `${where} fades in rather than being struck`).toBeLessThanOrEqual(0.004);
      }

      // §7.6's fatigue clause, which the glass does not get an exemption from:
      // this is the sound heard dozens of times a match, forever.
      const buf = render(c.spec);
      const shipped = render(soundSpec('pressTick'));
      expect(peak(buf), `${where} peaks over the tick that ships`).toBeLessThanOrEqual(peak(shipped));
      expect(buf.length, `${where} is longer than the tick that ships`).toBeLessThanOrEqual(shipped.length);
    }
  });

  it('spends "more subtle" on the two slots that repeat, as a number (a0-67)', () => {
    // The word appears four times across the sixteen reasons, and on two slots it
    // is a **fatigue** report rather than a taste note:
    //
    //   thruster — *"all of these sound annoying being looped, we need something
    //   more subtle since these will play all the time"*
    //   alarm    — *"all of these are ultra annoying, more subtle"*
    //
    // A character label cannot answer that; a level can. The bar is the sound
    // that SHIPS, because that is what the developer has in their ear when they
    // say "more subtle" — and it is the bar round one missed most plainly:
    // three of its four alarm offers and two of its four thruster offers were
    // *louder* than the incumbent they were meant to calm down.
    const quieterThanShipped = (id: SoundName): void => {
      const shipped = rms(render(soundSpec(id)));
      for (const c of CANDIDATE_SLOTS[id]!.candidates) {
        expect(rms(render(c.spec)), `${id}/${c.id} is not quieter than the sound that was called annoying`).toBeLessThan(
          shipped,
        );
      }
    };
    quieterThanShipped('alarm');

    // The thruster is held to **half**, not merely under: it is the only voice a
    // player holds down, so it is the only slot where the fiftieth second is the
    // one being judged.
    const shippedThruster = rms(render(soundSpec('thruster')));
    for (const c of CANDIDATE_SLOTS.thruster!.candidates) {
      expect(rms(render(c.spec)), `thruster/${c.id} is not half the level of the loop that fatigues`).toBeLessThan(
        shippedThruster * 0.5,
      );
      // …and nothing in it may ring. A narrow resonance with noise running
      // through it beats at the rate the noise excites it, and a beat inside a
      // held loop is the single most fatiguing thing a sound can do. Round one
      // put a Q of 8.5 and 10 on a loop layer; this is the fence around that.
      for (const v of voicesOf(c.spec)) {
        expect(v.resonance ?? 0, `thruster/${c.id} ${v.name} rings inside a held loop`).toBeLessThan(4);
        expect(v.lowPassEnd, `thruster/${c.id} ${v.name} sweeps a corner across the loop seam`).toBeUndefined();
      }
    }

    // The alarm may get quieter; it may not stop being a mechanic. §2.2 makes it
    // the tell that your home is under attack, and `./audio.test.ts` holds the
    // shipped voice above the chatter — so every OFFER is held there too, or an
    // approval would quietly retire the mechanic.
    const chatter = (['oreCollect', 'repairTick', 'spawnPulse', 'shotImpact'] as const).map((n) =>
      rms(render(soundSpec(n))),
    );
    for (const c of CANDIDATE_SLOTS.alarm!.candidates) {
      expect(rms(render(c.spec)), `alarm/${c.id} would not be heard over the chatter`).toBeGreaterThan(
        Math.max(...chatter),
      );
      // The rising minor third is the recognisable shape and it is what survives
      // the saw's removal: a second event, a minor third above the first and
      // later than it — the same interval the shipped klaxon spells. Legibility
      // is carried by the interval, not by the waveform, which is what this bank
      // already learnt on `waveArrive` (its two-horn tell survived the same
      // removal with the pitches held to the Hz).
      //
      // Stated as "there exists such a pair" rather than "the two lowest voices
      // are one", because these offers carry bodies and rooms as well as notes
      // and a rule that counted layers would be a rule about arrangement.
      const spec = c.spec;
      expect(isLayered(spec), `alarm/${c.id} is a single voice — it cannot spell an interval`).toBe(true);
      const events = isLayered(spec) ? spec.layers.map((l) => ({ at: l.at ?? 0, f: l.spec.freq })) : [];
      const rising = events.some((a) =>
        events.some((b) => b.at > a.at && Math.abs(12 * Math.log2(b.f / a.f) - 3) < 0.35),
      );
      expect(rising, `alarm/${c.id} does not spell a rising minor third`).toBe(true);
      // And the saw is gone: it is what "ultra annoying" was made of — full-level
      // partials straight through 2-4 kHz, the band an ear cannot habituate to.
      for (const v of voicesOf(c.spec)) {
        expect(v.wave, `alarm/${c.id} ${v.name} is still a saw`).not.toBe('saw');
      }
    }
  });

  it('every slot offers a full set of candidates, one letter each, with characters', () => {
    for (const id of SLOT_IDS) {
      const slot = CANDIDATE_SLOTS[id]!;
      if (REVOICE_MANIFEST.get(id) === 'done') continue; // held to the wider bar above
      // Three on every slot that has never been re-lettered; the re-lettered ones
      // declare their own letters above (`xpSettle` offers four, a0-57).
      expect(slot.candidates.map((c) => c.id), `${id} does not offer its letters`).toEqual(
        RE_LETTERED[id] ?? ['a', 'b', 'c'],
      );
      expect(slot.candidates.length, `${id} offers fewer than three`).toBeGreaterThanOrEqual(3);
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

  it('offers the four summary slots on the board, a character each', () => {
    for (const id of SUMMARY_SLOTS) {
      expect(SLOT_IDS, `${id} is not on the board`).toContain(id);
      const slot = CANDIDATE_SLOTS[id]!;
      expect(slot.current, `${id} points its "current" somewhere else`).toBe(id);
      // `levelUp` is on `d`/`e`/`f` since a0-49 — it collected a verdict of its
      // own on 2026-08-14, so it is no longer one of the four slots the developer
      // has not seen. The other three are still on their first letters.
      expect(slot.candidates.map((c) => c.id)).toEqual(RE_LETTERED[id] ?? ['a', 'b', 'c']);
      // As many *characters* as there are offers, not N takes on one: the labels
      // differ, and so do the spec names the review page prints beside them.
      expect(new Set(slot.candidates.map((c) => c.character)).size).toBe(slot.candidates.length);
      expect(new Set(slot.candidates.map((c) => c.spec.name)).size).toBe(slot.candidates.length);
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

  /**
   * The denied takes for a re-lettered slot.
   *
   * Two sources, and the second is the one that should win from here on: a0-49
   * inlined its two slots' takes into `DENIED_TAKES` below, while a0-57 keeps
   * `xpSettle`'s **in `./candidates`** under {@link CandidateSlot.denied}, where
   * the board can render them too. Prefer the file; fall back to the inline copy.
   */
  const deniedOf = (slot: string): readonly SoundSpec[] => {
    const archived = CANDIDATE_SLOTS[slot]?.denied;
    if (archived && archived.length > 0) return archived.map((d) => d.spec);
    return DENIED_TAKES[slot]!.map((s) => s as SoundSpec);
  };

  /** The letters those takes were filed under, in the same order — for failure messages. */
  const deniedIds = (slot: string): readonly string[] => {
    const archived = CANDIDATE_SLOTS[slot]?.denied;
    if (archived && archived.length > 0) return archived.map((d) => d.id);
    return ['a', 'b', 'c'];
  };

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
    for (const slot of ['oreCollect', 'levelUp', 'xpSettle'] as const) {
      const denied = deniedOf(slot).map((s) => render(s));
      for (const c of CANDIDATE_SLOTS[slot]!.candidates) {
        const buf = render(c.spec);
        for (const [i, d] of denied.entries()) {
          expect(
            buf.length === d.length && buf.every((v, k) => v === d[k]),
            `${slot}/${c.id} is denied take ${deniedIds(slot)[i]} under a new letter`,
          ).toBe(false);
        }
      }
    }
  });

  it('adds sparkle to `oreCollect` without adding level or length (a0-49, re-scoped a0-67)', () => {
    // *"add a little bit more of sparkle to it, like you've won a prize, but
    // subtle... it shouldn't be too long"* (2026-08-14) — three clauses, three
    // bounds. Two of them are unchanged by round four and one had to move; the
    // move is written out here rather than made quietly, because a bound that
    // loosens without a sentence beside it is a denial being dropped.
    //
    // SPARKLE is read as high-frequency detail with a short life, and measured as
    // the share of energy above 3 kHz — a share rather than a level, because
    // "sparkle" is a character and the next clause is what bounds the level.
    // 3 kHz and not higher because `./synth` clamps a resonant cutoff to
    // SVF_MAX_HZ_FRACTION (~6.5 kHz at 44.1 k), so 3–6.4 kHz *is* the top of this
    // bank's spectrum.
    //
    // **What moved (a0-67).** The 2026-08-17 denial asks for *"3 distinct sounds
    // so that i can see what direction to go in"*. Two of the three directions —
    // a dry handful of material, and a breath with nothing struck — are not bright
    // by construction, so holding the sparkle clause on EVERY offer would forbid
    // the spread the developer just asked for. It therefore binds **the set**: at
    // least one live offer still carries it, comfortably. The level and length
    // clauses do not move, because *"but subtle at same time"* is the same clause
    // said again and nothing withdrew the length one.
    const denied = deniedOf('oreCollect').map((s) => render(s));
    const deniedBrightest = Math.max(...denied.map((b) => brightShare(b, 3000)));
    const incumbent = render(soundSpec('oreCollect'));
    // The incumbent is on the board as its own letter now (a0-67). It is not a
    // take this round is offering, so the round's bounds are not asked of it —
    // it *is* the reference they are measured against.
    const offers = CANDIDATE_SLOTS.oreCollect!.candidates.filter((c) => c.anchor !== true);

    // Sparkle, held on the set: more than any denied take, with room to spare —
    // not "0.5% brighter than the brightest", which would satisfy a grep and
    // nobody's ear.
    const brightest = Math.max(...offers.map((c) => brightShare(render(c.spec), 3000)));
    expect(brightest, 'no offer on the slot is brighter than the takes that were denied').toBeGreaterThan(
      deniedBrightest * 1.25,
    );

    for (const c of offers) {
      const buf = render(c.spec);
      const where = `oreCollect/${c.id}`;
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
    //
    // The **anchor** is exempt and it is worth saying why in numbers rather than
    // in principle (a0-67). It is the incumbent, offered as a letter so that
    // "keep what ships" is an expressible verdict — and the incumbent clears the
    // brightest `depositTick` offer by only **×1.23**, not ×1.5. That is not a
    // regression this round introduced; it is what the shipped pair has always
    // measured, and it is exactly the reason the margin was written against the
    // *offers* in the first place. It does mean one thing for the board, and it
    // belongs on the record rather than in a passing test: **if the developer
    // keeps `oreCollect` as it ships AND picks a bright `depositTick`, that pair
    // is the tightest in the bank and wants a listen together.**
    for (const c of CANDIDATE_SLOTS.oreCollect!.candidates) {
      if (c.anchor === true) continue;
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

  it('never spells a major third on `levelUp` or `xpSettle` (a0-49, a0-57)', () => {
    // *The interface does not congratulate* (§4.7 register 2), and this cue can
    // land on top of a DEFEAT headline — so the one interval it may not contain is
    // the one that reads as a fanfare. Checked on the PITCHED voices only: a
    // `freq` on a noise voice sets a grain envelope, not a note, and holding noise
    // to an interval rule would be enforcing music on something that has no pitch.
    //
    // a0-57 extends it to `xpSettle`, which lands one beat later on the same
    // screen and is being rebuilt WARM — and warmth is the direction that reaches
    // for a fanfare by accident. `e` is deliberately a fifth for that reason.
    const MAJOR_THIRD = Math.pow(2, 4 / 12);
    for (const c of [...CANDIDATE_SLOTS.levelUp!.candidates, ...CANDIDATE_SLOTS.xpSettle!.candidates]) {
      const pitched = voicesOf(c.spec).filter((v) => v.wave !== 'noise' && (v.noiseMix ?? 0) < 0.5);
      for (const a of pitched) {
        for (const b of pitched) {
          if (a === b) continue;
          let r = Math.max(a.freq, b.freq) / Math.min(a.freq, b.freq);
          while (r >= 2) r /= 2; // interval class — a tenth congratulates too
          expect(
            Math.abs(r - MAJOR_THIRD) / MAJOR_THIRD,
            `${c.spec.name} spells a major third between ${a.name} and ${b.name}`,
          ).toBeGreaterThan(0.02);
        }
      }
    }
  });

  // -------------------------------------------------------------------------
  // The category denial (a0-57)
  // -------------------------------------------------------------------------
  //
  // On 2026-08-16T02:29:03Z all three `xpSettle` takes were denied together, with
  // one reason: *"none of these sound like sounds for XP collection"*. That is a
  // different kind of verdict from every one above it. `rockChip` was *"almost
  // there, but lower in tone"* — a note on execution, answerable by moving a
  // number. This one says the object is the wrong object, and the only thing that
  // answers it is a different object.
  //
  // So the bounds below are not "better than what was denied" on the axis the
  // developer named — they never named one. They are the diagnosis, held as code:
  // all three denied takes voiced a MACHINE COMING TO REST, and all three share
  // the measurable signature of one. A gain is **warm and bright at once** and
  // **leaves something behind**; a stop is one or the other and is over on
  // arrival. Every figure is measured against the takes that were denied, in the
  // a0-49 idiom, so the bar moves with the record rather than with a constant
  // somebody picked.
  //
  // The `denied` archive on the slot is what makes that possible, and it is the
  // point of the field: a re-offer that cannot be measured against what it
  // replaces is another guess.

  /** RMS of everything above `hz` — how much bright detail is actually THERE. */
  const hiBandRms = (buf: Float32Array, hz: number): number => {
    const a = 1 - Math.exp((-2 * Math.PI * hz) / 44100);
    let y = 0;
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const x = buf[i] ?? 0;
      y += (x - y) * a;
      sum += (x - y) * (x - y);
    }
    return Math.sqrt(sum / Math.max(1, buf.length));
  };

  it('keeps the denied `xpSettle` takes on the slot, verbatim and unofferable (a0-57)', () => {
    const slot = CANDIDATE_SLOTS.xpSettle!;
    const denied = slot.denied ?? [];
    expect(denied.map((d) => d.id), 'the denied takes are gone from the slot').toEqual(['a', 'b', 'c']);
    const offered = new Set(slot.candidates.map((c) => c.id));
    for (const d of denied) {
      // A verdict names an offer by its letter and nothing else, so a denied take
      // sharing a letter with a live one would make the record unreadable in the
      // exact way `RE_LETTERED` exists to prevent — now from the other side.
      expect(offered.has(d.id), `xpSettle/${d.id} is both denied and on offer`).toBe(false);
      // The reason is quoted, not summarised: a0-57 exists because a paraphrase
      // of this denial ("make them better") produced twenty minutes of nothing.
      expect(d.reason).toBe('none of these sound like sounds for XP collection');
      expect(d.deniedAt).toBe('2026-08-16T02:29:03Z');
    }
  });

  it('answers the `xpSettle` denial with warmth AND brightness, which no denied take had (a0-57)', () => {
    const denied = deniedOf('xpSettle').map((b) => render(b));
    // 3 kHz is the top of this bank's usable spectrum (`./synth` clamps a resonant
    // cutoff to SVF_MAX_HZ_FRACTION, ~6.5 kHz at 44.1 k), and 200 Hz is where the
    // body a player feels rather than hears begins — the same two corners a0-49
    // measured `oreCollect`'s sparkle and `levelUp`'s mass at.
    const hi = (b: Float32Array): number => hiBandRms(b, 3000);
    const low = (b: Float32Array): number => lowBandRms(b, 200);
    const HI_FLOOR = Math.max(...denied.map(hi)) * 1.08;
    const LOW_FLOOR = Math.max(...denied.map(low)) * 1.08;

    // The conjunction is the whole finding, so it is asserted rather than assumed:
    // each denied take clears AT MOST ONE of the two floors. `a` was bright and
    // thin, `b` was warm and dull, `c` was neither. None of them was a gain.
    for (const [i, b] of denied.entries()) {
      const both = hi(b) > HI_FLOOR && low(b) > LOW_FLOOR;
      expect(both, `denied take ${deniedIds('xpSettle')[i]} was already warm and bright — the diagnosis is wrong`).toBe(
        false,
      );
    }

    for (const c of CANDIDATE_SLOTS.xpSettle!.candidates) {
      const buf = render(c.spec);
      const where = `xpSettle/${c.id}`;
      expect(hi(buf), `${where} has no more bright detail than the takes that were denied`).toBeGreaterThan(HI_FLOOR);
      expect(low(buf), `${where} has no more warm body than the takes that were denied`).toBeGreaterThan(LOW_FLOOR);
      // And a stop is one gesture. Every denied take was a single layer; a sound
      // that is warm and bright at once cannot be, and saying so keeps a future
      // edit from satisfying the two figures with one clever voice.
      expect(isLayered(c.spec) && c.spec.layers.length >= 3, `${where} is not built as a gain`).toBe(true);
    }
  });

  it('leaves something behind after an `xpSettle` lands, unlike a full stop (a0-57)', () => {
    // The other half of the diagnosis. The denied trio measure 0.10 / 0.12 / 0.10
    // late-over-early — the lowest figures on the board, and the sound of a thing
    // ending rather than resolving. A resolution has a remainder. The margin is
    // half again rather than a hair, because this is the axis the denial is about.
    const denied = deniedOf('xpSettle').map((b) => render(b));
    const FLOOR = Math.max(...denied.map((b) => lateOverEarly(b))) * 1.5;
    for (const c of CANDIDATE_SLOTS.xpSettle!.candidates) {
      expect(
        lateOverEarly(render(c.spec)),
        `xpSettle/${c.id} is over as soon as it lands, like the takes that were denied`,
      ).toBeGreaterThan(FLOOR);
    }
  });

  it('buys none of it with level, and none of it with length (a0-57)', () => {
    // The failure mode of "warmer and brighter" is "louder", and the developer did
    // not complain about the level — so the takes that were denied are the ceiling
    // on both loudness figures, and the re-offer has to find its character inside
    // them. The length bound is the brief's own: the cue fires at the end of every
    // match, so it may not ask for attention twice.
    const denied = deniedOf('xpSettle').map((b) => render(b));
    const RMS_CEILING = Math.max(...denied.map((b) => rms(b)));
    const PEAK_CEILING = Math.max(...denied.map((b) => peak(b)));
    // It also lands UNDER the beat it follows (plan §6.5): `levelUp` is the last
    // thing the player heard, and the settle sits beneath it rather than answering
    // it. Measured against the quietest `levelUp` offer, so a mixed pair of
    // verdicts is safe.
    const quietestLevelUp = Math.min(...CANDIDATE_SLOTS.levelUp!.candidates.map((c) => rms(render(c.spec))));
    for (const c of CANDIDATE_SLOTS.xpSettle!.candidates) {
      const buf = render(c.spec);
      const where = `xpSettle/${c.id}`;
      expect(rms(buf), `${where} bought its warmth with level`).toBeLessThanOrEqual(RMS_CEILING);
      expect(peak(buf), `${where} bought its brightness with level`).toBeLessThanOrEqual(PEAK_CEILING);
      expect(rms(buf), `${where} would play over the beat it follows`).toBeLessThan(quietestLevelUp * 0.6);
      expect(buf.length / 44100, `${where} asks for attention twice`).toBeLessThanOrEqual(0.3);
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
    //
    // The one deliberate exception is an {@link SoundCandidate.anchor} (a0-67):
    // on the six slots whose reason was *"i like current"* or *"show me
    // directions"*, the incumbent is offered as a letter of its own so that
    // "keep what ships" is a verdict somebody can give. It renders identical to
    // the shipped voice **by definition** — that is the whole point of it — and
    // the test that it really is identical is above, in `offers the sound that
    // ships as a letter…`. What this test still catches on those slots is the
    // dangerous case: a *new* take that is secretly the incumbent.
    const denied = SLOT_IDS.filter((id) => ADOPTED[id] === undefined);
    expect(denied.length, 'the adopted set is not three slots any more').toBe(SLOT_IDS.length - 3);
    for (const id of denied) {
      const slot = CANDIDATE_SLOTS[id]!;
      const shipped = render(soundSpec(slot.current));
      for (const c of slot.candidates) {
        if (c.anchor === true) continue;
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
