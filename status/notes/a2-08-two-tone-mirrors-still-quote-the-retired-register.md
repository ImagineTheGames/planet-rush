# a2-08 — two tone mirrors still quote the retired register

Branch: `agent/art/a2-08-tone-mirrors`

## BUILT

- **`content/codex/pipeline/tone.md`** — `docs/audio-revoice-spec.md` §10's
  ready-to-paste block, pasted (verified byte-identical against the fenced block,
  with one deliberate exception below), plus a **register 2** section carrying GDD
  §4.7's pinned prompt — *"Who speaks"* → *"The clarity rule"* — **verbatim**, plus
  a "How it lands in the codex" reading for register 2.
- **`style-guide.md` §8** — the *other* mirror §4.7 names. Same register-2 block,
  verbatim, plus an art-facing operational reading. Register 1 untouched: it was
  already current after the 2026-08-06 pass.
- **`content/codex/codex-systems.json`** — `sys-core-loop`'s body no longer opens
  *"a Saturday-morning space brawl"* (→ *"a clean, cold science-fiction brawl"*),
  and `sys-mining` no longer calls a shot *"a firework you can watch cross the
  gap"* (→ *"a round"*). Two clauses; no fact, number, `facts[]` pointer or
  `generated` stamp touched.
- **`tests/codex/tone-mirror.test.ts`** — new. The audit's own step 3 (T-4), and
  the thing that stops this rotting a third time. Four locks per mirror: no
  retired-register quotation; register 2's nouns present; §4.7's register-2 prompt
  present **byte-for-byte, sliced out of `GDD.md` at read time**; §4.7's tone
  paragraph present word-for-word (wrapping normalised).

Red-first proven, not assumed: with `main`'s `tone.md` restored, all four locks on
that mirror fail; with the new one, 8/8 pass. Probe reverted, not committed.

## DECISIONS

- **§10 is pasted, not rewritten — with one edit, and §4.7 wins.** §10's trailing
  provenance note *quotes* the retired paragraph ("the retired paragraph read 'a
  Saturday-morning space brawl…'"). This whole file is injected verbatim into
  every generation, so keeping that sentence would go on pinning the register it
  retires — the exact harm G-4 describes — and it also fails the brief's own DoD
  probe. The note stays; the quotation is replaced by a pointer to GDD §4.7, which
  holds the retired text and the old/new table. Everything above that note is
  §10 byte-for-byte.
- **Register 2 is quoted, never paraphrased.** §4.7: *"injected verbatim"*; the
  audit: *"a paraphrase of a pinned prompt is a second contract."* My own framing
  sits outside the quoted block, clearly marked.
- **Three mirrors updated, not two.** The brief names `tone.md` + the JSON; §4.7's
  bold *"Both mirrors must gain register 2"* and G-5 name `style-guide.md` §8 +
  `tone.md`. Both files are mine, so all three are correct now rather than two of
  three under either reading.
- **The codex corpus is left alone outside `codex-systems.json`.**
  `codex-bots.json:11` (*"Cartoon rivals with names…"*) and `codex-ships.json:22`
  (*"a toy dart"*) are the same retired register, and both were **left**: the
  copy-sweep's Q4 recommends keeping the corpus and is still unanswered, they are
  outside the file the brief handed me, and — decisive — the BOTS tab is what the
  two CODEX goldens shoot, so editing that summary is a render change needing the
  full re-baseline protocol. Recorded as a follow-up, not smuggled in.
- **`src/art/wrecks.ts:7` and `src/art/tells.ts:77` quote the retired paragraph
  in comments and were left.** Both are mine, but both quote it on the **VFX**
  side (*"explosions are fireworks"*), and §4.7's blast radius makes the VFX
  consequence **UNRATIFIED** pending the developer's Q1. Re-registering those
  comments would answer an open question in a comment.
- **No provenance re-stamp.** `generated.against` still reads `GDD.md v0.7` —
  true, and re-stamping it would claim a regeneration that did not happen
  (`docs/copy-sweep-industrial-voice.md` §3.8 item 2 leaves that call open).
- **Nothing that is a record of the old tone was touched** — see the PR's file
  list; `docs/art-direction/concept-boards.html` in particular is the Day-0
  selection round, judged against the then-current paragraph and containing a
  *rejected* theme literally named "Saturday Cartoon", in pre-Cold-Vacuum
  palettes. Rewriting it would falsify the record that justifies the palette.

## NEXT

Nothing outstanding for the DoD. Open follow-ups, each needing a decision that is
not mine:

1. **Q1 (VFX) is still unruled.** When it lands, `src/art/wrecks.ts:7` and
   `src/art/tells.ts:77` are two one-line comment fixes.
2. **Q4 (the corpus).** If the answer is "re-register the corpus", it is
   `codex-bots.json:11`, `codex-ships.json:22`, and a golden re-baseline of
   `desktop-codex` + `phone-landscape-codex`.
3. `docs/copy-sweep-industrial-voice.md:368` quotes the codex opener I changed;
   it is the architect's dated record, so it is now historical rather than wrong.
