# Pinned tone paragraph (GDD §4.7, amended 2026-08-06)

> **BINDING.** This paragraph is PINNED verbatim into every codex generation and
> every critic pass. The Assignment-4 pipeline proved retrieval never surfaces it
> on its own (it lives in §4.7, far from any entry's source rows), so it is
> injected by hand, not retrieved. Every entry's voice is judged against it.

> *Planet Rush is a clean, modern science-fiction brawl: fast, precise, and cold.
> Ships are machines, explosions are pressure failures, bots are operators with
> names and habits. But homes are the one serious thing in it — when a station
> dies, the game goes briefly quiet, the wreck stays on the map all match, and
> nobody jokes for three seconds. Engineered on the surface, a small ache
> underneath.*

## How it lands in the codex

- **Systems / ships / bots** read precise and plain-spoken — a rival is "an
  operator with a name and habits," a shot is a discharge, a hull is machinery.
  Clean and cold, never cheeky and never grimdark.
- **Homes are the serious note.** Any entry that touches a station's death, a
  wreck, or the collapse drops the register for a beat — that is the "small ache
  underneath," and it is a rule, not a flourish. **Unchanged by the amendment.**

*Amended 2026-08-06 (s7-01), applied 2026-08-11 (a2-08): the paragraph above
replaces the arcade-cartoon one this file used to pin. The station-death sentence
is carried over verbatim. The retired wording is deliberately **not** quoted here
— this file is injected verbatim into every generation, so a quotation of it
would go on pinning the register it retires. GDD §4.7 holds the retired text, the
rationale, the old/new worked table, and the precedence rule.*

---

# Register 2 — the interface voice (GDD §4.7, ratified 2026-08-05)

> **BINDING.** §4.7's Propagation clause, in bold in the GDD: **"Both mirrors
> must gain register 2."** The block below is §4.7's own pinned register-2
> prompt — everything from *"Who speaks"* to *"The clarity rule"* — quoted
> **verbatim**, because §4.7 says verbatim and a paraphrase of a pinned prompt is
> a second contract. Copy work quotes it; it does not interpret it.

**Who speaks, and to whom.** The interface is **the claim's operating authority** addressing a **contracted operator**. Not a narrator, not a coach, not the game. The player holds a licence to work a plot; the interface is the office that issued it. It logs, prices, permits, and refuses. It has no stake in whether the operator wins.

**What the voice IS:**

1. **Procedural.** It states status, cost, condition, and — when it refuses — the reason. Nothing else.
2. **Unglamorous.** No adjective that praises, hypes, or dramatises. `VICTORY`, not `GLORIOUS VICTORY`. The register is carried by what is *left out* — a bare outcome word is already in voice.
3. **Faintly bureaucratic.** Where a game reaches for the nouns of play (level, score), the authority reaches for the nouns of work and paperwork (sector, yield, contract, seal, log). *(Amended 2026-08-19, a0-108 — `claim` left this list; see the vocabulary table.)*
4. **Terse and present-tense.** Second person, imperative for instructions. The interface has a word budget and spends it on the reason, not the fiction.
5. **Indifferent.** It is not on the operator's side. This — not jokes — is where the game's cheek lives in register 2.

**What the voice is NOT:**

1. **Not congratulatory.** It does not cheer, praise, or exclaim. It never says "Nice", "Great", "Awesome", or "!" — with exactly one sanctioned exception, `RUSH!` (§2.1, GDD-verbatim).
2. **Not menacing.** Indifferent, not hostile. No grimdark, no threats, no "DOOM". The authority does not care enough to menace.
3. **Not chatty and never winking.** No jokes in a string. The humour is structural — the flat voice over a brawl that is anything but flat — not lexical. *(Amended 2026-08-06: this read "over a toy-bright brawl." The joke is the indifference, not the toy, so the amendment costs register 2 exactly one adjective.)*
4. **Not a naval or space-opera register.** The operator is not "Commander", "Captain", or "Pilot". This is a mining company, not a fleet.
5. **Not worldbuilding.** A button never explains the fiction. If a string is teaching lore instead of naming an action, it is the wrong string.
6. **Not decorative punctuation.** No ellipses for mood, no em-dash flourishes where a full stop works. (`—` is fine where it separates a fact from its reason, which is most of the existing copy.)

**The clarity rule — the one that outranks everything above.** **Clarity always wins over flavour.** A player under fire reading a refusal needs the reason, not the fiction. Concretely:

- A refusal names its reason in the **first three words**. `NEED 1 ORE`, `REACTOR FULL`, `REPAIR IN 12s`.
- If the flavour word and the plain word compete on comprehension, **the plain word ships** — and the copy sweep records that it was considered and rejected, so nobody re-litigates it.
- A word a first-time player has to learn before they can act is a bug. The voice may rename the *world*; it may not rename the *verb*.
- **Length is part of clarity.** The HUD runs at 11–15px and nameplates truncate at 12 characters (`NAMEPLATE_MAX_CHARS`). A longer in-register word that ellipsizes has traded information for flavour, which this rule forbids. Measure before you ship it.

## How it lands in the codex

The two registers do different jobs in one entry, and an entry that confuses them
reads as a menu pretending to be a document:

- **The narration is register 1.** A codex entry is a document *about* the claim,
  not the authority speaking; §4.7's *"Where the voice applies"* list is screens —
  menu, lobby, wheel, HUD, onboarding, pause, end-of-match — and does not include
  codex prose. Entries are judged against the tone paragraph above.
- **Every interface string an entry names is register 2, quoted exactly as the
  interface says it.** `CLAIM HELD`, `YIELD · RICH`, `SECTOR · THE COMPASS`, a
  refusal line, a wheel segment label. An entry never re-words a string the player
  will read on a button — and §4.7's fixed strings (`RUSH!`, `BACK` / `CLOSE` /
  `DONE` / `JOIN` / `ERASE`, `HOME`, `FRIENDLY A` / `ENEMY B`, every wheel and
  settings label) are not the codex's to revisit either.
- **The vocabulary is shared.** Claim, operator, contract, sector, yield, seal,
  station, reactor, collection field, abandoned rig, the Crush — the §0 glossary
  wins wherever it has already fixed a word.
- **Where they compete:** register 1 wins on **moments**, register 2 wins on
  **words** (§4.7).

*Added 2026-08-11 (a2-08), executing §4.7's Propagation clause — ratified
2026-08-05 and never applied to either mirror (`docs/gdd-conformance.md` G-5).*
