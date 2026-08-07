# Planet Rush — Style Guide

## Cold Vacuum — the frozen art contract

**Status:** FROZEN. Extracted and operationalized from GDD chapter 5 (Art
Direction), §2.11 (ship classes), and §4.7 (tone). This file is a contract, like
the shared TypeScript interfaces. **Changeable only through the Director.** The
Art & Audio and UI agents build against it and check every asset against it.

**Cold Vacuum** in one line: gunmetal hulls, teal patina for corrosion, signal
yellow for anything that matters, a cold plasma-blue cutting torch for the beam.
Industrial and grubby, but in vacuum rather than in a mine shaft — no rust, no
amber, no cave.

The palette is small on purpose: every colour has exactly one job.

---

## 1. Palette — the six colours (frozen)

| Role | Hex | Job |
|---|---|---|
| **Vacuum** | `#0D1015` | Background. Near-black, so every entity carries its own contrast. |
| **Hull steel** | `#7E8894` | All ships, all players. Hulls never take player colour. |
| **Patina** | `#4FA08B` | Corrosion, continents, the repair channel. The "old system" tint. |
| **Signal yellow** | `#F2D24B` | Ore, hazard stripes, costs, the planet core. **RESERVED — see §2.** |
| **Plasma** | `#4DC3FF` | Beams, cockpits, energy. Per-player beams are this hue, tinted by player colour. |
| **Threat red** | `#B23A3A` | Damage, alarms, enemy fire, the under-attack tell. |

**These six are the whole world palette.** No seventh material colour enters
the game without the Director. Player identity colours (§3) are a separate,
additive layer that lives only on trim — they never replace a material colour.

**Contrast rule:** every entity must read against Vacuum `#0D1015` on its own.
Do not rely on a lighter backdrop; there isn't one.

---

## 2. The RESERVED rule (the rule that carries the most weight)

> **Signal yellow `#F2D24B` means ore or danger, and nothing else. Ever.**

- Yellow is allowed on: ore chunks, asteroids' ore veins, the ore HUD squares
  and banked total, cost numerals on the build wheel, hazard/danger stripes, and
  the planet **core** (it is the win condition — a thing that matters).
- Yellow is **forbidden** as decoration, as a player identity colour, as a UI
  accent, in a menu highlight, in a particle that isn't ore or a hazard — in
  anything a player might mistake for "ore is here" or "this is dangerous."
- A player scanning a chaotic screen must be able to trust yellow completely.
  Every misuse spends that trust. Treat yellow as a controlled substance.

Threat red `#B23A3A` carries the danger half of the same discipline: it is
damage, alarm, and enemy fire only — never a neutral or friendly accent.

### 2.1 The cost-numeral carve-out — one exception, stated in both colours *(amended 2026-08-06 — the ratified Gantry/Bone build wheel, u7-02; **scope clarified 2026-08-06 by u7-06 — it covers BOTH wheels**; see `docs/design/gantry-bone-handoff.md` and GDD §2.5)*

There is exactly **one** place in this game where a RESERVED colour is spent on a
piece of interface, and this section is it, written down so it is a decision
rather than a drift:

> **A cost numeral on the Build & Upgrade wheel is signal yellow `#F2D24B` when
> the player can pay it, and threat red `#B23A3A` when they cannot.**

The yellow half was already carved out above ("cost numerals on the build
wheel") and is unchanged. The red half is new, and it is the *same* carve-out on
the *same* numerals rather than a second one: the ratified design colours an
unaffordable cost red precisely so that the wheel needs no "need 2 more" copy —
the numbers already say it. It survives the RESERVED test because it is not
chrome taking a warm hue for decoration; it is the **price of a thing telling
you it is out of reach**, which is the same "this is against you" reading red
carries on a damage ring.

Four hard limits travel with it, and they are what keep an exception from
becoming a licence:

1. **The numerals only.** Nothing else on the wheel may go red — not a wedge
   body, not a label, not a ring, not a target line, not a count. (The wheel's
   press-*rejection* flash is a separate, earlier ratification — field report
   v0.2.2 — and is red as a refusal tell, not as chrome.)
2. **Only for "you cannot pay this."** A wedge that is capped, or inert (a full
   reactor, one on its repair cooldown, a collapsed match) draws its cost slot in
   **steel**, never red: red there would name the wrong reason. Poverty is the
   only thing this red is allowed to mean.
3. **No new hue.** `#B23A3A` is the frozen threat red of §1, unmodified. This
   amendment adds no colour to the palette.
4. **It does not travel.** "Cost numerals on the Build & Upgrade wheel" is a
   statement about cost numerals on the Build & Upgrade wheel. It licenses
   nothing in a menu, on the HUD, in the lobby, or on any other screen.

**Scope: the two wheels, which are one control *(clarified 2026-08-06, u7-06 —
flagged for the Director; nothing shipped changed colour)*.** As first written
this section said "the build wheel" throughout, and limit 4 said the carve-out
travels nowhere else. Read strictly that excluded the **upgrade wheel** — which
had already been drawing an unaffordable tier's cost in threat red since before
this section existed, and which is not "another screen" in the sense limit 4 is
guarding against: it is the second level of the same radial control, reached by
pressing a wedge of the first, drawn by the same code, and since u7-06 quoting
its price in the same `cost/held` grammar. A player crosses between them in one
press; a rule that changed colour across that press would be the drift this
section exists to prevent.

So the wording is "the Build & Upgrade wheel" — the control GDD §2.5 names, both
its levels — and **no pixel changed colour when it was corrected.** All four
limits above apply unchanged on both levels; in particular a **maxed** track
draws its `MAX` in steel, not red, under limit 2, because a finished ladder is
not a poverty problem. Everything limit 4 rules out — menus, the HUD, the lobby,
any other screen — stays ruled out.

Everything else in the Gantry/Bone direction is deliberately hueless — the
accent is **Bone**, which is brightness rather than colour (`src/art/materials.ts`)
— which is exactly what leaves this one carve-out affordable.

---

## 3. Player colour and identity

Eight players, eight identity colours — humans and bots alike. Identity is an
**additive trim layer** over the steel fleet, never a repaint.

**Rules (all four are hard):**

1. **Hulls stay steel `#7E8894`.** Every ship reads as one industrial fleet.
2. **Player colour appears only on:** wing tips / trim, cockpit glass, engine
   flame, beam tint, planet **beacon ring**, and the **HP / hull bar**. Nowhere
   else on the sprite. This makes a livery a palette swap, not a new sprite.
3. **Every ship carries its player number as a hull decal.** Identity never
   depends on colour alone — this is the colourblind-safe path and costs nothing.
   The decal is the source of truth; the colour is the fast-read shortcut.
4. **Silhouette carries class identity** (§4), colour carries player identity.
   The two channels are independent so a colourblind player still reads *who*
   (decal) and *what* (shape) with colour removed.

### 3.1 Player colour roster — operational (8 slots)

Concrete instantiation of the 8-colour roster the lobby assigns (GDD §2.1).
Chosen for mutual distinctness and to avoid semantic collision with RESERVED
signal yellow and threat red. Distinctness is backed by the hull decal (§3 rule
3), so no player is ever identified by hue alone.

| Slot | Name | Hex |
|---|---|---|
| P1 | Azure | `#3D7BFF` |
| P2 | Cyan | `#22D3C5` |
| P3 | Spring | `#3DD68C` |
| P4 | Violet | `#9B5DE5` |
| P5 | Magenta | `#F15BB5` |
| P6 | Orange | `#FF8A3D` |
| P7 | Chalk | `#DCE3EC` |
| P8 | Slate-Blue | `#5C6CE0` |

Roster hues sit clear of `#F2D24B` (ore) and `#B23A3A` (danger); no slot is pure
red or pure yellow. This roster is part of the frozen contract — change it only
through the Director.

---

## 4. Ship classes — four silhouettes

Four hulls, four silhouettes, four playstyles (GDD §2.11). Because bot
personalities map to hulls, **the shape is information.**

> **Readability requirement (hard): each of the four silhouettes must be
> unambiguously distinguishable from the other three at 24×24 px, in flat steel
> `#7E8894` with player colour removed.** Test every hull sprite by rendering it
> at 24 px, greyed, on Vacuum — if two hulls are confusable at that size, the
> shape has failed and must be redrawn. This is why hulls stay steel: the
> silhouette must carry the read, not the colour.

| Class (hull) | Role | Silhouette intent |
|---|---|---|
| **Interceptor** (Quadfin) | Scout, miner-hunter | Fastest read: narrow, swept, four fins — visibly the light, quick shape. |
| **Vanguard** (Anvil) | All-rounder, onboarding default | The neutral baseline shape; balanced, symmetric, "default ship." |
| **Excavator** (Pincer) | Mining engine, close bruiser | Front-heavy pincer/mandible prow — reads as a mining tool up front. |
| **Hauler** (Hammerhead) | Logistics, siege tank | Widest, blunt hammerhead mass — visibly the heavy, slow, tanky hull. |

One livery per bot personality (GDD §2.9) is a palette swap over these four
silhouettes — never a new shape.

---

## 5. Planets

Earthlike, randomised per player from **four variants** so no two home worlds
look identical (GDD §5.4).

**Rules:**

- **Oceans are steel-blue, continents are patina-green `#4FA08B`** — keeps
  "Earth" inside the Cold Vacuum palette instead of importing a second one.
- **The core is signal yellow `#F2D24B`** — it is the win condition, a thing
  that matters, so it obeys the RESERVED rule (§2).
- **Ownership = beacon ring in the player's colour (§3), always visible.**
- **Health = a damage ring, visible only within sensor range** (GDD §2.2) —
  enemy planet HP is scouted, never broadcast.
- **Four variants** differ in continent layout / ocean-to-land ratio only;
  all four stay within the ocean-steel-blue + continent-patina + yellow-core
  rule. Variety comes from arrangement, not from new colours.
- A burning/dying planet reads from further away than its numbers do (smoke) —
  see the tone contract (§8) for the planet-death moment.

---

## 6. Turrets and asteroids

- **Turrets must read as cannons at a glance and telegraph threat while
  spinning** (GDD §5.5). Steel hull, player-colour trim, plasma/threat accents
  on the barrel per state.
- **Asteroids are the economy, so they crack visibly across three stages** and
  let a player judge a payout before committing beam time. Ore veins are the
  only yellow on an asteroid; the rock body is neutral steel-grey mineral.
  Crack stages are sprite swaps at damage thresholds (GDD §4.1 animation).

---

## 7. Typography

Both faces are **OFL licensed and self-hosted in the repo** (GDD §4.5 / §5.6),
so they render offline and carry no licence risk.

| Face | Use | Why |
|---|---|---|
| **Audiowide** | Wordmark, headings, menu confirmations | Rounded retro-techno — playful without being a toy, which is exactly the tone brief (§8). *(Note 2026-08-06: this justification quotes the retired tone paragraph, and "retro" is now the word §8 rules out. **The face itself is unchanged and still frozen** — a typeface swap is a separate decision with its own cost, and it is raised as an open question in `docs/audio-revoice-spec.md` §10, not taken here.)* |
| **Oxanium** | HUD numerals, body text | Designed for game interfaces; holds up at 12px; shares Audiowide's squared geometry without competing with it. |

**Rules:**

- Never set HUD numerals in Audiowide, never set the wordmark in Oxanium.
- Both fonts ship as self-hosted `@font-face` files under `assets/` — no CDN,
  no Google Fonts network call. Offline-first (GDD §4.3, §4.8).
- Oxanium must remain legible at 12px on the HUD — verify at the mobile
  thumb-scale layout, not just desktop.

---

## 8. Tone — the emotional contract (GDD §4.7, verbatim)

*(Amended 2026-08-06 — the tone paragraph is replaced at the source. This mirror
now carries the new one, and the pre-pivot "when a **planet** dies" wording is
gone with it. The full rationale, the old/new worked table, and the precedence
rule live in GDD §4.7; the audio execution list is `docs/audio-revoice-spec.md`.)*

Every asset, every VFX, every sound is judged against this paragraph. It is
quoted here unaltered as the contract:

> *Planet Rush is a clean, modern science-fiction brawl: fast, precise, and cold.
> Ships are machines, explosions are pressure failures, bots are operators with
> names and habits. But homes are the one serious thing in it — when a station
> dies, the game goes briefly quiet, the wreck stays on the map all match, and
> nobody jokes for three seconds. Engineered on the surface, a small ache
> underneath.*

**Operational reading for Art & Audio:**

- **Engineered on the surface:** ships are machines, explosions are pressure
  failures. Assets are clean, precise and unornamented — an asset carries the
  material it needs and nothing decorative. *Clean* is not the same as sparse:
  impacts, muzzle flashes, thruster trails and spawn glow stay punchy and
  readable, because legibility is a mechanic (below). What goes is the toy —
  sparkle over an explosion, a wobble on a chip, an arcade blip on a purchase.
- **Modern / futura:** it must read as equipment built this century, not as a
  1980s cabinet. Forward-looking and engineered, never retro-futurist. The
  ratified Gantry/Bone UI direction (`docs/design/gantry-bone-handoff.md`) is the
  worked example: machined plates, lit top edges, rivets — and, in sound, *"no
  square, no saw, no pitch bends — each of those is what made earlier passes
  sound retro or cartoonish."*
- **A small ache underneath:** homes are the one serious thing. The
  **station-death moment goes briefly quiet** — audio drops out, the beat holds
  for ~3 seconds, and nobody jokes. This quiet is a *mechanic of tone*, not
  polish, and cannot be cut. It is **unchanged by the 2026-08-06 amendment**: a
  clean, cold palette makes the drop bigger, not smaller.
- Every mechanic in GDD §2 gets a **visible and audible tell** — that is the
  Art & Audio mandate, and it **outranks the register**. If a re-styled or
  re-voiced asset makes two mechanics harder to tell apart, it has failed this
  section. If a moment doesn't read at a glance, that's a design bug found in
  pre-production, not on day 6 (GDD §5.8).
- **Precedence, when they compete:** mechanic legibility first, then the frozen
  palette (§1–§2 — no new hue enters on a tone amendment), then the register.
- **Scope of the 2026-08-06 amendment:** ratified and applied to **audio** only
  (s7-02, per `docs/audio-revoice-spec.md`). Its **VFX** and **bot-naming**
  consequences are open developer questions and are **not** ratified — do not
  restyle an explosion or rename a bot against this section until they are.

---

## 9. Legibility test (the standing check)

Each of the ruleset's distinct moments is a legibility test (GDD §5.8): mine,
spend, fight, alarm, siege, planet-death, wreck-scavenge. **If a moment doesn't
read at a glance — at 24px, at mobile thumb-scale, against Vacuum, with colour
removed — it fails and is redrawn.** This guide exists so that "reads at a
glance" has criteria instead of vibes.

---

*Frozen day 0. Changeable only through the Director (GDD §4.7).*
