# GDD conformance — what the design promises, and what the build delivers

**Brief:** a0-19 · **Agent:** Architect · **Date:** 2026-08-11
**Audited against:** `GDD.md` in the repo root (v0.7, 645 lines, 40 headings, 130 KB)
— the richer, canonical copy, **not** the course-folder `Planet_Rush_GDD_v0.5.md`.
**Audited build:** `main` @ `7461192`.

> *"something never made it into the game, it has no onboarding even though im
> pretty sure the design doc mentions it, what else does the gdd have that we
> are missing?"* — the developer

---

## 0. The answer, in one paragraph

**Almost everything shipped.** **226 claim rows** were checked against code across
three checklists — the Not-cuttable list, the milestone table, and every numbered
section — and the verdicts are **208 SHIPPED**, **13 PARTIAL**, **5 MISSING**.
Every one of the ten items the GDD marks **Not cuttable** is in the build; nine
are whole, one — onboarding — is the PARTIAL you asked about. The simulation is
the strongest part of the picture: §2.8's baseline constants table matches **row
for row**, the §2.11 ship-class table matches **number for number**, and the
Mk I→III turret ladder matches the amended costs and stats exactly.

**The gaps are not where you would look for them.** They are not in the sim, the
bots or the netcode. They are: a typeface pair that was ratified and never
shipped (so the whole game draws in fallback fonts), a deploy topology that has
never existed (every merge to `main` replaces the classroom's link), an
onboarding memory that lasts one page load, and two tone mirrors that still quote
a paragraph the GDD retired.

**And onboarding is not missing.** `src/ui/onboarding.ts` exists, all four §2.10
prompts fire, they are wired at `src/ui/hud.ts:59` and `:470`, and a live-stage
test photographs one on the running client (`tests/live-stage/prompt-band.spec.ts`).
What is broken is narrower and is described in full in §3, gap **G-3**: the
"never appear again" promise is scoped to a single page load, so **EXIT TO MENU
→ a second match re-teaches you the game from scratch**, and the prompt that
exists specifically to stop you missing UPGRADE SHIP can be retired by pressing
BANK.

| Verdict | Rows | What it means |
|---|---:|---|
| **SHIPPED** | **208** | Implemented, with a `file:line` citation. A claim with no citation is not shipped, it is believed. |
| **PARTIAL** | **13** | Half of it is there. The other half is named exactly. |
| **MISSING** | **5** | Nothing implements it. |

**Rows are not gaps.** A few claims are checked in more than one place because
the GDD asserts them in more than one place — onboarding is on the not-cuttable
list, in M1's check, *and* in §2.10, so it accounts for five of the thirteen
PARTIAL rows. Collapsed to distinct defects, the 18 PARTIAL/MISSING rows are
**16 things to fix** (G-1 … G-16 in §3), of which:

- **4 are outright MISSING** — the typefaces (G-1), the `/dev` deploy path (G-2,
  asserted twice in the GDD, hence two rows), and the two tone mirrors (G-4, G-5);
- **12 are PARTIAL** — led by onboarding (G-3, three separate halves);
- and **one further row, G-17, is listed but is not a defect**: it is the GDD
  correctly holding two consequences of the tone amendment open and unratified,
  and the build correctly not acting on them. It is in the report so nobody
  "fixes" it.

---

## 1. Method, and what would make this report wrong

- Every SHIPPED row carries a citation I opened myself. Nothing in this document
  is inferred from a filename or from a doc-comment's own claim about itself.
- **Where the build and the GDD disagree, the GDD is the record** (LESSONS §8).
  I did not re-scope a claim to fit what shipped. The one class of exception is
  a **later developer ratification**, and where I applied it I cite the
  ratification — see §2.2's ore squares (`src/ui/ore-hold.ts:4`), which moved
  from top-left to under the ship on a quoted developer rule.
- **`npm run dark-matter` earned one finding and cost an hour.** It reports 2764
  exports under `src/`, 1471 with zero production references. It counts
  *exports*, not *features*: its 43-entry `orphan-module` list is dominated by
  test-only art tooling. It surfaced exactly one thing worth reading — the
  `ArtPresenter` façade (`src/art/presenter.ts:68`) is unwired — and that is
  **not** a gap: `main.ts` constructs the pieces it wraps directly
  (`vfxField` at `src/main.ts:1274`, `audioObserver` at `:900`, `VfxLayer` at
  `:1275`), so it is a convenience wrapper nobody needed. Same story for
  `AUTO_AIM_ARC` (`src/sim/constants.ts:1099`, unreferenced — but auto-aim has
  no arc filter to skip, so the 360° behaviour is correct *by construction*) and
  `miningRate()` (`src/sim/constants.ts:1153`, superseded by the projectile's
  `mineYield` path at `src/sim/projectiles.ts:113`).
  **Read that as the tool's shape, not as its failure:** dark-matter finds
  built-and-unwired *symbols*. Design that was never built at all is invisible
  to it, which is exactly what this brief was asked to find.
- **What could still be wrong.** Two verdicts rest on reading, not on running:
  the fps gates (§4.3) and the balance targets (§2.8, §2.11) are marked SHIPPED
  because the *instruments* exist and are green, not because I re-measured them.
  QA owns those numbers.

---

## 2. The Not-cuttable list — the most serious place a gap could be

> *"Not cuttable: the triangle (mine/defend/attack), the finite field and
> collapse phase, onboarding prompts, the under-attack alarm, gamepad support,
> offline solo mode, 2-player online, touch controls (twin sticks), the auto-aim
> fire mode, and mobile-browser playability."* — GDD §4.9

Two more things are declared not-cuttable outside that sentence (§2.2's arrow,
§4.7's station-death beat), so twelve claims are checked here.

| # | Not-cuttable claim | Verdict | Evidence |
|---|---|---|---|
| 1 | **The triangle** — mine / defend / attack, one ship, three jobs | **SHIPPED** | Mining: `src/sim/projectiles.ts:367` `chipAsteroid`. Defending: `src/sim/buildings.ts:511` (turrets, shields, repair). Attacking: `src/sim/damage.ts`, `src/sim/projectiles.ts:262`. One trigger drives all of it — `src/sim/step.ts:660` `fireShip`. |
| 2 | **The finite field and collapse phase** | **SHIPPED** | `FIELD_YIELD = 400` / `WAVE_COUNT = 5` — `src/sim/constants.ts:509,512`; `src/sim/waves.ts:101` `fieldExhausted`; collapse shuts off repair (`src/sim/buildings.ts:327` → `'collapsed'`) and shield regen (`:529`). |
| 3 | **Onboarding prompts** | **PARTIAL** | All four fire and are wired (`src/ui/onboarding.ts:69`, `src/ui/hud.ts:470`, `:1809`). The "never again" promise survives one page load only. **Full detail: gap G-3.** |
| 4 | **The under-attack alarm** | **SHIPPED** | `src/ui/alarm.ts:170` `UnderAttackAlarm`; once-per-engagement latch at `:173`; own-side scoping via `deriveAlarmAllies` (`src/art/audio/scope.ts`), re-derived per match at `src/main.ts:2751`(`alarmSide = null`). |
| 5 | **The screen-edge arrow** *(same amendment, "neither is cuttable")* | **SHIPPED** | `src/ui/alarm.ts:326` `homeArrow`, with the inset rule at `:313` and the "home already on screen" suppression at `:298`. |
| 6 | **Gamepad support** | **SHIPPED** | Browser Gamepad API read in `src/platform/input.ts` and `src/platform/wheel-input.ts`; bindings `Left stick / Right stick / Right trigger / Y △` at `src/platform/actions.ts:176–197`. |
| 7 | **Offline solo mode** | **SHIPPED** | `src/net/loopback.ts:114` `LocalLoopback`, `OFFLINE_ROOM = 'LOCAL'` at `:70`; the sim never learns which transport it has (`src/net/transport.ts`). |
| 8 | **2-player online** | **SHIPPED** | `src/net/websocket-transport.ts`; authoritative server `server/match-server.ts`, `server/room.ts`; deployed by `.github/workflows/deploy-server.yml:71`. |
| 9 | **Touch controls (twin sticks)** | **SHIPPED** | `src/platform/touch.ts:55` `VirtualStick`, `:116` `TouchController`; dynamic-under-thumb, one per screen half. |
| 10 | **The auto-aim fire mode** | **SHIPPED** | `FireMode.AutoAim` at `src/platform/actions.ts:35`; full-360° acquisition and intercept lead at `src/sim/step.ts:623–665`; platform default (Manual desktop / Auto-aim touch) at `src/platform/actions.ts:43`. |
| 11 | **Mobile-browser playability** | **SHIPPED** | Landscape lock `src/platform/orientation.ts:11`; PWA `public/manifest.webmanifest` + `public/sw.js:16`; thumb-scale HUD and safe-area anchoring `src/platform/layout-registry.ts`; the whole `tests/mobile/` Playwright matrix runs in CI (`.github/workflows/ci.yml:192`). |
| 12 | **The station-death beat** — *briefly quiet, wreck all match, nobody jokes for three seconds* (§4.7, "a mechanic of tone, not polish") | **SHIPPED** | `src/art/vfx/death-moment.ts:37` (the three seconds, named as the tone contract's number); the hush rides the mix's duck node — `src/art/audio/engine.ts:275`, with `hushedCount` at `:291` proving one-shots are actually suppressed rather than merely quiet. The wreck persists: `src/sim/state.ts:456`. |

**Not-cuttable tally: 11 SHIPPED · 1 PARTIAL · 0 MISSING.** Nothing on the list
was cut. This is the strongest single result in the audit.

---

## 3. The gaps, ranked by what a player would notice

Seventeen rows below. This is the section the developer's question was actually
asking for, and it is ordered by *how loudly the absence shows on screen*, not by
GDD section number.

### G-1 · MISSING · The game has never rendered in its own typefaces

**§5.6.** *"**Audiowide** for the wordmark, headings and menu confirmations …
**Oxanium** for HUD numerals and body text … Both are OFL licensed and
**self-hosted in the repo**, so they render offline and carry no licence risk."*

There is **no `@font-face` anywhere** (`index.html`, `src/`, `public/` — zero
hits), **no font file in the repo** (no `.woff`/`.woff2`/`.ttf` outside
`node_modules`), and `assets/` contains only `README.md` and `preview/`. Every
screen in the game — the wordmark, the menus, the HUD numerals, the build wheel,
the codex — draws in the *fallback* half of the stack:

```
src/ui/typography.ts:37   FONT_HEADING = 'Audiowide, "Trebuchet MS", sans-serif'
src/ui/typography.ts:22   "The self-hosting never happened (found by a1-01, 2026-08-07):
                           there is no @font-face in index.html and no font file under
                           assets/, so neither ratified face has ever loaded and every
                           screen in this game draws in its fallback."
```

The module's own header has known this since 2026-08-07 and it has not been
briefed out. **This is the most player-visible gap in the report**: it is not one
screen, it is the typographic identity of the entire product, and §5.6 says *"This
document is typeset in them"* — so the GDD looks like the game was supposed to
look and the game does not.

No developer ratification supersedes it. It is a gap.

### G-2 · MISSING · There is no `/dev` URL, so every merge to `main` replaces the classroom's link

**§4.8.** *"**Release on tag:** the stable classroom link serves the latest
*tagged* build, with `main`'s newest on a `/dev` path, so experiments never break
the link the class is using."*
**§4.6a.** *"**On-demand deploys.** Saying 'deploy now' to the Director pushes the
current `main` to the `/dev` URL and fires the same ping, with no tag required."*

`.github/workflows/ci.yml:81` and `:91` gate the Pages artifact and the deploy on
`refs/heads/main` **or** `refs/tags/v*` — **both publish to the same Pages root**.
There is no second path, no second artifact, and `vite.config.ts:17` has one
`base`. Grep for a `/dev` deploy target across the workflows returns nothing but
shell redirections to `/dev/null`.

The consequence is exactly the one §4.8 wrote the rule to prevent: the link the
classroom has open is whatever landed on `main` in the last few minutes. The
ntfy ping on tag *does* work (`ci.yml:112–135`), so the milestone half of §4.6a
is real; it is the stability half that was never built.

**Something in the repo already assumes it exists.** The performance harness
documents its own invocation as
`PERF_GATE=1 PERF_URL=https://…/dev npx playwright test …`
(`tests/perf/frame-time.spec.ts:31`) — pointing at a URL that has never been
published. Whoever wrote it read §4.8 and believed the topology was real.

### G-3 · PARTIAL · Onboarding fires, but it forgets you between matches — and one prompt retires on the wrong action

**§2.10.** *"contextual first-match prompts fire on triggers … The upgrade prompt
fires the first time the wheel opens, because upgrades are the half of the economy
a player can most easily miss … **they never appear again after each is completed
once**. No separate tutorial mode: the first match is the tutorial."*

**What is there, and is correct.** All four prompts exist with the GDD's own
trigger set (`src/ui/onboarding.ts:69–96`), fire once each and are permanently
retired inside a match (`:179` `completed`, `:216`), resolve their bindings
through the *same* action map that drives the sim so the copy is device-correct
for free (`:129` `resolvePromptText` → `src/platform/actions.ts:170`), and are
drawn by the HUD (`src/ui/hud.ts:59`, `:470`, `:1809`) with all four signals fed
live — `nearAsteroid` (`src/main.ts:3337`), `cargo`, `wheelOpen`, `hasOrdered`
(`:3312`), `underAttack` (`src/ui/hud.ts:883`). A live-stage test drives the real
client and asserts the prompt band clears the open wheel
(`tests/live-stage/prompt-band.spec.ts`). **Onboarding is wired. That part of the
developer's memory was wrong, and this report says so plainly.**

**Missing half A — the memory lasts one page load.** `Onboarding` is a plain
in-memory class with no persistence (no `planet-rush:onboarding` key; the eleven
persisted keys are settings, profile and lobby state only). It is a field of the
`Hud`, constructed once per page (`src/ui/hud.ts:470`; `new Hud(...)` at
`src/main.ts:1351`). REMATCH keeps it — `rematch()` (`src/main.ts:2723`)
deliberately does not touch the HUD — but **EXIT TO MENU does a full navigation**:

```
src/main.ts:2905  function exitToMenu(): void {
src/main.ts:2907    const menuUrl = window.location.origin + window.location.pathname;
src/main.ts:2908    window.location.assign(menuUrl);
```

so the next match gets a fresh `Onboarding` and re-teaches all four lessons. So
does a reload, a PWA cold start, and tomorrow. §2.10's "never appear again after
each is completed once" is a claim about a *player*, not about a page.

**Missing half B — SPEND retires on BANK.** `hasOrdered` is set by *any* wheel
order, including a BANK press (`src/main.ts:3266`). The prompt whose stated
purpose is *"upgrades are the half of the economy a player can most easily miss"*
is therefore retired forever by a player who opened the wheel, dumped their hold,
and never saw UPGRADE SHIP. The onboarding module believes otherwise — its own
comment at `src/ui/onboarding.ts:207–208` reads *"SPEND is done the moment ore is
actually spent from the wheel — the player has found the economy, including the
segment behind the arrow"* — and banking is not spending.

**Missing half C — the HAUL-HOME copy teaches the retired mechanic.** §2.10
quotes the prompt verbatim, post-amendment:

> *"Hold full — **fly into your collection field to bank**, then press E to spend"*
> *(amended 2026-07-27 — projectile mining, collection-field banking)*

The shipped string is `'Hold full — fly home and press {build}'`
(`src/ui/onboarding.ts:82`). The clause the 2026-07-27 amendment *added* — that
banking happens by flying into the collection field, with no docking and no
parking (§2.3) — is the clause that was dropped. The prompt teaches the player to
dock and press E, which is the *other* way to bank, and leaves the auto-drain
(the one §2.3 calls the primary path) untaught.

### G-4 · MISSING · `content/codex/pipeline/tone.md` still quotes the paragraph the GDD retired

**§4.7 Propagation.** *"The tone paragraph is mirrored in two places outside this
document — `style-guide.md` §8 and `content/codex/pipeline/tone.md` — because
lexical retrieval provably never surfaces a tone section on its own … so it is
pinned by hand."* The 2026-08-06 amendment adds: *"`content/codex/pipeline/tone.md`
is **still stale** and is flagged with ready-to-paste replacement text in
`docs/audio-revoice-spec.md` §9."*

Still stale, five days later:

```
content/codex/pipeline/tone.md:8   "Planet Rush is a Saturday-morning space brawl: fast, bright, and a little
content/codex/pipeline/tone.md:9    cheeky. Ships are toys, explosions are fireworks, bots are cartoon rivals..."
content/codex/pipeline/tone.md:17   "'cartoon rival with a name,' a shot is a firework, a hull is a toy."
```

A mirror is quoted **verbatim** into asset prompts by definition, so a stale one
does not merely disagree with the GDD — it actively pins the retired register
into whatever it is injected into. §4.7 says so itself: *"a stale one is as
damaging as a stale GDD."* The replacement text is already written and waiting in
`docs/audio-revoice-spec.md` §9; nobody has pasted it.

### G-5 · MISSING · Neither tone mirror ever gained register 2

**§4.7 Propagation, in bold in the GDD:** *"**Both mirrors must gain register 2.**"*

Register 2 — the interface voice, the claim's operating authority addressing a
contracted operator — appears in **neither** mirror. Grepping `style-guide.md`
and `content/codex/pipeline/tone.md` for `Register 2`, `interface voice`,
`operating authority` and `contracted operator` returns **zero hits in both
files**. `style-guide.md` §8 was updated for register 1 in the 2026-08-06 pass
(it carries the new tone paragraph and the modern/futura language at `:391`) —
but the register-2 half of the propagation instruction, ratified 2026-08-05, was
never executed in either file.

This is why it matters and is not bookkeeping: §4.7 says the voice block *"is
injected **verbatim** into every player-facing-copy task"*. If the mirrors are
where copy tasks retrieve tone, every copy task since 2026-08-05 has been pinned
with register 1 only.

### G-6 · PARTIAL · `style-guide.md` still prices a repair mechanic that was retired

`style-guide.md:25` — *"| **Patina** | `#4FA08B` | Corrosion, continents, **the
repair channel**. |"*. Repair has been a **discrete purchase, not a channel**
since 2026-07-26 (§2.5, folded into v0.6; `src/sim/constants.ts:403` — one press,
1 ore, 15 HP, no channel). GDD §645 flags this exact string as unreconciled. The
palette row itself is correct; the words describe a mechanic that does not exist.
The same stale phrasing survives in the shipped code's own palette comment
(`src/art/tokens.ts:47`).

### G-7 · PARTIAL · `docs/mobile-cross-platform-amendment.md` still lists two cut mechanics as live

GDD §4.9 and §2.4: boost and the minimap ping were **cut from the game outright**
— *"they are gone, not deferred."* That doc still specs them as shipping
behaviour: `:50` — *"ping: tap the minimap"* — and it is the same doc GDD §645
names as needing the sweep. It also carries the `/dev` URL promise at `:18`,
which is G-2's other half and is likewise unbuilt.

### G-8 · PARTIAL · The GDD is behind the build on the map count

**§2.1** — *"**Four maps, fair at every N** … four hand-authored arena layouts
ship in core scope — octagon, compass, oval, diamond."* The registry ships
**six**: `src/sim/maps.ts:623` — `[octagon, compass, oval, diamond, line,
crescents]`, with `line` and `crescents` added by brief a0-12 as the two-sided
Teams boards (`src/sim/maps.ts:4–6`).

This is the inverse of every other row in this section: the *build* is ahead and
the *GDD* is stale. It is still a conformance defect, because the GDD is the
record of what was promised and it now under-reports the shipped game. It needs
an amendment, not a code change — see Q-2.

### G-9 · PARTIAL · Four CI obligations run, but not as the named steps §4.8 describes

**§4.8** names five things CI runs on every push: *typecheck, unit tests, the
determinism replay test, the ore-conservation invariant, and a headless bot smoke
match (with timeout)*. All five **do** execute — but three of them only as
un-named specs inside one `npx vitest run` (`ci.yml:40`): `tests/determinism.test.ts`,
`tests/harness/ore-conservation.test.ts`, `tests/harness/match.test.ts`. The patch
that would give them their own named, individually-timed steps was written and
**never applied** — it is sitting in the repo as `docs/ci-determinism-step.patch`.

Marked PARTIAL rather than SHIPPED for one reason with teeth: §4.8's stated
purpose is *"a commit that breaks or **hangs** the game cannot merge."* A hung
smoke match inside a bundled `vitest run` does not fail in seconds against its own
`timeout-minutes: 5`; it sits on the runner. The patch's own comment says exactly
this. The obligation is met; the failure mode it was written for is not.

### G-10 → G-17 · The remaining PARTIALs, in one table

| # | Claim | Verdict | What is missing |
|---|---|---|---|
| G-10 | §2.10 the SPEND prompt's retirement condition | **PARTIAL** | Folded into G-3, half B. Listed separately because it is a two-line fix in a different file from G-3's other halves. |
| G-11 | §2.10 the HAUL-HOME prompt copy | **PARTIAL** | Folded into G-3, half C. Same reason. |
| G-12 | §4.6 M5 *"art/VFX/audio replace placeholders"* | **PARTIAL** | The VFX and audio halves are complete and wired (`src/art/tells.ts:142` — 23 tell kinds with a documented payload each; `src/art/vfx/field.ts`; `src/art/audio/bank.ts`). The **type** placeholders were never replaced — G-1. |
| G-13 | §2.8 `AUTO_AIM_ARC` as a live `TUNABLE` | **PARTIAL** | The behaviour is right (360°, no front arc — `src/sim/step.ts:623`), but it is right *by having no arc check at all*: `AUTO_AIM_ARC` (`src/sim/constants.ts:1099`) is referenced by nothing. Setting it to π would silently do nothing, which is the same class of trap §2.8 retired `Sensor range` to avoid — *"a `0` would still read as tunable."* |
| G-14 | §2.8 `SHIP_HULL = 50` as a live `TUNABLE` | **PARTIAL** | Superseded in practice by the per-class `SHIP_STATS` table (`src/sim/constants.ts:1125`) and referenced by nothing (`src/sim/constants.ts:62`). The GDD lists it as the baseline row *"Ship hull \| Base; upgradable \| 50"*; a QA agent who retunes that row changes nothing. |
| G-15 | §4.3 the renderer's 60 fps gate | **PARTIAL** | The gate exists (`tests/perf/frame-time.spec.ts`, `tests/perf/playwright.perf.config.ts`) and the **sim** half runs headless (`tests/harness/perf.test.ts`), but the renderer half is `PERF_GATE=1` and out of CI by design — so §4.3's *"Verified by the M5 performance gate, not assumed"* holds only as often as somebody runs it by hand. Correct engineering; a standing manual obligation the GDD does not describe as manual. |
| G-16 | §0 the in-fiction noun for a home | **PARTIAL** | §0 says the document uses **FACILITY** as a *working placeholder* until the developer ratifies one of FACILITY / RIG / STATION / OUTPOST. The build settled on **station** throughout (`src/sim/state.ts` `MiningStation`, `src/ui/station-hp.ts`, every player-facing string), and §1/§4.7's vocabulary table now assume it. The pick was made by shipping, not by ratifying — see Q-1. |
| G-17 | §4.7 the two open, unratified consequences of the tone amendment | **PARTIAL** *(correctly so)* | §4.7 records the amendment's **VFX** and **bot-naming** consequences as *"open, unratified, and must not be acted on until the developer rules."* They have not been acted on — `docs/audio-revoice-spec.md` carries them as questions. **This row is conformance working, not failing**, and is here so nobody "fixes" it. |

---

## 4. The milestone table — the player-facing checks (§4.6, §4.6a)

§4.6a defines a playable milestone as one *"a first-time player can open on a
phone browser and verify … in under 2 minutes."* That makes these unusually
testable, so each row below is checked against the thing a player would look at.

| M | Playable check (abridged) | Verdict | Evidence |
|---|---|---|---|
| **M0** | Concept boards + tone locked into `style-guide.md`; repo, CI, Pages, server deploy live; netcode spike measures snapshot size, tick rate, host | **SHIPPED** | Boards: `docs/art-direction/concept-boards.html`, `concept-round2.html`, `ui-mockup.html`, `scene-gallery.html`. Spike: `docs/netcode-spike.md`, decided rate lands as `server/room.ts:135` (*"Snapshot every 2nd sim tick = 30 Hz, the rate the day-0 spike decided"*). Host: `docs/hosting-plan.md` → Fly.io, `.github/workflows/deploy-server.yml`. |
| **M1** | Ship flies, shoots, mines; two-number ore HUD; first onboarding prompts; touch + keyboard/mouse + gamepad; playable at the public URL | **SHIPPED** | `src/sim/step.ts` (flight, fire, mine); ore readout `src/ui/ore-hud.ts:9` + hold pips `src/ui/ore-hold.ts:97`; prompts `src/ui/onboarding.ts` (see G-3 for the caveat, which does not stop them firing); `src/platform/touch.ts:116`; `milestones.json` `v0.1.0-m1`. |
| **M2** | Facilities, reactors, turrets, shields, discrete repair, build menu, under-attack alarm; win/loss + last-to-die | **SHIPPED** | `src/sim/buildings.ts`; repair `src/sim/constants.ts:403`; wheel `src/ui/build-wheel.ts`; alarm `src/ui/alarm.ts:170`; last-to-die `src/sim/match.ts:338,365`. |
| **M3** | WebSocket transport + authoritative server deployed; 2-player online match works | **SHIPPED** | `src/net/websocket-transport.ts`; `server/match-server.ts`; live-boot check in CI at `ci.yml:295`. |
| **M4** | 8-slot lobby with room codes, ship-class select, player colors; Easy/Medium/Hard bots with personalities fill empty slots | **SHIPPED** | `src/ui/lobby.ts`; codes `src/net/room-code.ts:32,36`; ship select `src/ui/ship-select.ts`; 8 colours `src/art/palette.ts:72`; the seven characters `src/bots/personalities.ts:357+`. |
| **M5** | Full 8-slot online match end-to-end; 60 fps gate; first balance pass; **art/VFX/audio replace placeholders** | **PARTIAL** | VFX/audio complete (`src/art/tells.ts:142`, `src/art/audio/bank.ts`); balance `docs/balance-01`/`harness/balance.ts:8`; 60 fps gate `tests/perf/frame-time.spec.ts` (G-15). **The type placeholders were never replaced — G-1.** |
| **M6** | QA balance passes to the 10–15 min target; gamepad and touch verified; onboarding polished | **SHIPPED** | `harness/balance.ts:8-9` encodes both stated targets; abundance spread measured in `tests/reports/abundance-spread-a0-17.md`; touch matrix `tests/mobile/`. |
| **M7** | Polish, main menu + settings + end-of-match/rematch flow, tagged v0.1 | **SHIPPED** | `src/ui/main-menu.ts`, `src/ui/settings.ts`, `src/ui/end-of-match.ts`, `rematch()` at `src/main.ts:2723`; `milestones.json` `v0.1`, `v0.1.1`. |

---

## 5. §0–§2 — the fiction and the mechanics

### §0 Fiction glossary *(4 claims: 3 SHIPPED · 1 PARTIAL)*

| Claim | Verdict | Evidence |
|---|---|---|
| Lift-and-shift only — no mechanic, number or rule moves | **SHIPPED** | The v0.6 constants survive v0.7 unchanged; §2.8's table matches the code (§5, §2.8 below). |
| Code identifiers rename to `MiningStation`; `planet` kept in title only | **SHIPPED** | `src/sim/state.ts` `MiningStation`; `src/sim/maps.ts` uses `station` throughout. |
| The Crush / ore surges / collection field as fiction over unchanged mechanics | **SHIPPED** | Wave metronome `src/sim/waves.ts:436`; collapse `src/sim/buildings.ts:327`; deposit `src/sim/constants.ts:1584`. |
| The home noun is a **working placeholder** until ratified | **PARTIAL** | G-16 / Q-1. |

### §1 Executive summary *(8 claims: 8 SHIPPED)*

| Claim | Verdict | Evidence |
|---|---|---|
| 2–8 players, FFA or Teams, one ship + one station each | **SHIPPED** | `src/sim/match-config.ts:41,94`; `MIN_MATCH_SIZE`/`MAX_MATCH_SIZE`. |
| Bots fill open slots (as amended: only `bot` slots) | **SHIPPED** | `src/sim/match-config.ts:41`, `src/ui/lobby.ts:1413`. |
| One dodgeable projectile chips rock and bites hull | **SHIPPED** | `src/sim/projectiles.ts:101` `fireShipProjectile`, `:276` chip-or-damage on first contact. |
| Ships respawn free; facilities do not; wreck stays all match | **SHIPPED** | `RESPAWN_S = 5` `src/sim/constants.ts:961`; `src/sim/state.ts:456`. |
| Finite yield in five waves, each closer to centre; collapse ends it | **SHIPPED** | `src/sim/waves.ts:366`, `src/sim/constants.ts:509–515`. |
| Win = last reactor standing; ties resolve last-to-die | **SHIPPED** | `src/sim/match.ts:338`, `:365` `lastToDie`. |
| In Teams, your own reactor dying ends **your** match | **SHIPPED** | `src/sim/match.ts:142`; end screen `eliminated` kind at `src/ui/end-of-match.ts:108`. |
| Browser desktop + mobile, PWA-installable, online and offline | **SHIPPED** | `public/manifest.webmanifest`, `public/sw.js:16`, `src/platform/install-prompt.ts`. |

### §2.1 Match setup *(17 claims: 17 SHIPPED)*

| Claim | Verdict | Evidence |
|---|---|---|
| Two modes over one slot model; FFA is teams-of-one, one predicate | **SHIPPED** | `src/sim/allegiance.ts` — the single friend/foe predicate. |
| 8 physical slots, each `open` / `bot` / `closed` | **SHIPPED** | `src/sim/match-config.ts:41` `SlotState`, `:142`. |
| A new room seeds every slot but the host's `open`; nothing AI-filled until asked | **SHIPPED** | `src/sim/match-config.ts:142`; `src/ui/lobby.ts:1055`. |
| `N` counts humans **plus bots**; an untaken `open` slot is not in the match | **SHIPPED** | `src/sim/match-config.ts:94` (`state !== 'closed'` → participants), `configToPlayers`. |
| **RUSH! is refused, with a reason on screen, below two participants** | **SHIPPED** | `src/ui/lobby.ts:1898` → `NEEDS_TWO`; reason drawn at `src/ui/lobby-view.ts:1179`. |
| Friendly fire off; turrets and auto-aim ignore allies | **SHIPPED** | `FRIENDLY_FIRE = false` `src/sim/constants.ts:355`; `src/sim/allegiance.ts:87`. |
| Uneven team sizes allowed; the lobby shows the split, never blocks it | **SHIPPED** | `src/ui/lobby.ts` roster split; `src/main.ts:2020`. |
| The host picks each bot's **CHARACTER**; its difficulty is **shown, not chosen** | **SHIPPED** | `src/ui/lobby.ts:94`; the tier read off `src/bots/personalities.ts:251`-era table. |
| Repeats allowed and numbered only when repeated (`Warden 1` / `Warden 2`) | **SHIPPED** | `src/ui/lobby.ts:1413`, `:1423`, `:2140` (`castDisplayNames`, one pass over the whole cast). |
| **Every bot row carries a `?`** that opens the codex dossier, **on a tap, every device** | **SHIPPED** | `SEAT_HELP_GLYPH = '?'` `src/ui/lobby.ts:217`; per-row hit rect `src/ui/lobby-geometry.ts:1510`; tap routed at `src/ui/lobby-flow.ts:575`; drawn per row at `src/ui/lobby-view.ts:359`. |
| `WORD + LETTER`: letter absolute, word viewer-relative | **SHIPPED** | `resolveTeamLabel` `src/ui/nameplates.ts:309`. |
| A view with no local player falls back to neutral `TEAM <letter>`, never `ENEMY` | **SHIPPED** | `src/ui/nameplates.ts:239`; `src/main.ts:2027`. |
| Colour reinforces the word, never replaces it; hulls take no side colour | **SHIPPED** | `SIDE_COLORS` `src/ui/lobby.ts:439`, applied only to the plate's side tag (`src/ui/nameplates.ts:171`, `:379`); the identity roster stays per-slot at `src/art/palette.ts:72` and hulls stay steel at `src/render/index.ts:436`. |
| MAP SELECT is a screen opened from the lobby; the lobby keeps one arena card | **SHIPPED** | `src/ui/map-select.ts`; lobby card + open at `src/ui/lobby.ts:1353`. |
| A guest may **open** map select read-only (a control that refuses to open reads as broken) | **SHIPPED** | `src/ui/lobby.ts:1297–1302` — *"what this screen refuses is authoring, not looking."* |
| Four maps, rotationally fair at every N; octagon/oval regenerate, compass/diamond derelict-fill | **SHIPPED** *(see G-8 — the build ships six)* | `src/sim/maps.ts:39–45`, `:623`; fairness test `tests/sim/resource-fairness.test.ts`. |
| Starting ore, 10 s spawn protection on **ship and reactor** | **SHIPPED** | `STARTING_ORE = 3` `src/sim/constants.ts:65` (banked — `src/sim/state.ts:818`); `SPAWN_PROTECTION_S = 10` applied to both at `src/sim/state.ts:821` (ship) and `:849` (core). |

### §2.2 What the player sees *(15 claims: 15 SHIPPED — one of them by a cited developer ratification)*

| Claim | Verdict | Evidence |
|---|---|---|
| Camera follows the ship from above | **SHIPPED** | `src/platform/camera.ts`. |
| Held ore as filled squares, one per cargo slot, flashing when full | **SHIPPED** *(relocated by ratification)* | `src/ui/ore-hold.ts:97` `oreHoldModel`, flash at `:67`. §2.2 puts them top-left; the developer moved them under the ship — quoted verbatim at `src/ui/ore-hold.ts:4`: *"We're supposed to show ore held on ship under the ship, not top left — top left is to show total ore."* **Cited ratification, so SHIPPED, not a gap.** |
| The top-left readout is captioned **`ORE`** and prints the bank alone | **SHIPPED** | `src/ui/ore-hud.ts:9`, `:39`. |
| Your own station's HP top-right in your colour, mirrored over the station | **SHIPPED** | `src/ui/station-hp.ts:34`, `:55`. |
| A narrow hull bar in the owner's colour over **every** ship, yours included | **SHIPPED** | `src/ui/healthbar.ts:82`; forced-show under alarm `src/ui/hud.ts:1294`. |
| ASTEROID WAVE clock: wave number, countdown to next, match time | **SHIPPED** | `src/ui/wave-clock.ts:47–57`, reading the sim's own `waveTime` at `:33`. |
| Build & Upgrade wheel near your own station; minimap bottom-right; controls strip along the bottom | **SHIPPED** | `src/ui/build-wheel.ts`; `src/ui/minimap.ts:93`; `src/ui/controls-strip.ts:39`. |
| The controls strip is **desktop-only**; on touch the visible controls replace it | **SHIPPED** | `src/ui/controls-strip.ts:29` — `return !isTouch`. |
| In Teams every name label carries its side, in words, one step dimmer | **SHIPPED** | `src/ui/nameplates.ts:150`, `:299`. |
| **Station health is always visible**, whoever owns it, at every range | **SHIPPED** | `src/sim/sensing.ts:107` `stationHealthVisible` — takes both parameters and ignores both, deliberately. |
| Sensor range retired, not zeroed | **SHIPPED** | No station-HP sensor constant survives; the three minimap radii are separate and present — 520 `src/sim/constants.ts:1026`, 300 `:1034`, 900 `:1089`. |
| Damage-ring grammar: owner-colour ring = health left, threat-red fills clockwise from twelve | **SHIPPED** | `src/art/rings.ts:31` `RING_DAMAGE_START = -π/2` (twelve o'clock), `:54` `ringDamageShapes`. |
| The alarm **sounds once per engagement**, with the hold/release as a re-trigger guard | **SHIPPED** | `src/ui/alarm.ts:170–185`; `ALARM_HOLD_S` `:74`. |
| It rings **only for your own side's** station, read off the seat the server actually seated you at | **SHIPPED** | `deriveAlarmAllies` (`src/art/audio/scope.ts`), re-derived per match — `src/main.ts:2751` *"last match's alarm roster is a stale claim about who is on your side."* |
| Asteroids visibly crack as mined and burst into drifting chunks | **SHIPPED** | Three crack stages `src/art/asteroids.ts:23,105`; chunks `src/sim/projectiles.ts:375`. |

### §2.3 Core loop *(9 claims: 9 SHIPPED)*

| Claim | Verdict | Evidence |
|---|---|---|
| Hold fire on a rock; the same projectile chips it; chunks tractor in by proximity | **SHIPPED** | `src/sim/projectiles.ts:276`, `:367`; proximity tractor `src/sim/step.ts:296`, `:749`. |
| Hold starts at 2 and grows only with cargo upgrades | **SHIPPED** | `CARGO_BASE = 2`, `CARGO_PER_TIER = 2`, `CARGO_CAP_MAX = 8` — `src/sim/constants.ts:71–77`. |
| A full hold refuses chunks; they stay where they are for anyone | **SHIPPED** | `src/sim/step.ts:749` (*"a full hold exerts no pull"*), `:950`. |
| Death drops **the whole hold** where you exploded | **SHIPPED** | `DEATH_ORE_DROP_FRACTION = 1` `src/sim/constants.ts`. Was `0.5` until **2026-08-16 (a0-59)** — the developer withdrew the half-burn ore sink ("destroyed ships should drop all their ore, no more 1/2 the ore stuff"); GDD §2.3/§2.7/§2.8 amended to match. |
| **Banking is by flying into your own collection field**, ~4× radius, 2 ore/s, stops on leaving | **SHIPPED** | `DEPOSIT.drainRate = 2` `src/sim/constants.ts:1584`; `DEPOSIT_RANGE` drawn at `src/render/index.ts:969`. |
| Ore chunks visibly courier ship→station, one per unit banked | **SHIPPED** | `src/sim/step.ts:291–297`, `:926`. |
| The wheel's BANK segment dumps the hold in one tap | **SHIPPED** | `src/ui/build-wheel.ts:193`. |
| Five timed waves, each closer to centre; after the last, collapse | **SHIPPED** | `src/sim/waves.ts:366`; `src/sim/buildings.ts:511`. **The claim is delivered; the delivery has a known defect — see Q-6.** By wave 5 the ring is oversubscribed with rock **3.66×**, closes to 71 u and seals the map centre behind a solid annulus with a 19.3 u free pocket, against a `SHIP_RADIUS` of 16: any ship — bot or human — standing there when it lands is entombed for the match. Open on `main` at ~1.25% of seeds. Measured in `docs/wave-commons-entombment.md`. Graded SHIPPED rather than PARTIAL deliberately: the waves *do* land, each closer than the last, and collapse *does* follow, so this is not a gap against §2.3's claim — it is a defect in a shipped mechanic, and the honest place for it is Q-6. |
| **A pickup and a pickup REFUSED must both be visible** (2026-08-08, a0-08) | **SHIPPED** | `Ship.lootTake` / `Ship.lootBlocked` published per tick — `src/sim/step.ts:922–923`, set at `:950` and `:988`. |

### §2.4 Controls and actions *(12 claims: 12 SHIPPED)*

| Claim | Verdict | Evidence |
|---|---|---|
| The abstract set is exactly **six verbs** | **SHIPPED** | `thrust, aim, fire, build` `src/platform/actions.ts:59–66`; `buildOrder`, `upgradeOrder` `src/shared/types.ts:216,274`; contract named at `:283`. |
| The binding table, cell for cell (WASD / Left stick / Left virtual stick, etc.) | **SHIPPED** | `src/platform/actions.ts:174–198` — matches §2.4's table including `Y / △` for build. |
| Parity: every action reachable from every source, **enforced by a CI test** | **SHIPPED** | `src/platform/input-parity.test.ts`, run by `npx vitest run` (`ci.yml:40`). |
| The CONTROLS row names the **device**: `STICKS` / `TWIN STICKS` / `KEYBOARD + MOUSE` | **SHIPPED** | `src/ui/settings.ts:365`; `controlsDevice` imported at `src/main.ts:209` and called at `:2934`. |
| …on **connection**, not last use, and a disconnect reverts it | **SHIPPED** | `controlsDevice({ isTouch, gamepadConnected })` — `src/main.ts:2934`, `:7003`; `gamepadConnected` is a live read from `src/platform/input.ts`. |
| The persisted value still says `sticks` (renaming would seat an unknown scheme) | **SHIPPED** | `CONTROL_SCHEME_STORAGE` `src/ui/settings.ts:67`; key `planet-rush:controlScheme`. |
| Tap Commander as an opt-in scheme; not a fourth device, not a new verb | **SHIPPED** | `ControlScheme = 'sticks' \| 'tap'` `src/ui/settings.ts:55`; local pilot `src/platform/tap-pilot.ts`; label `TAP_COMMANDER_LABEL` `:115`. |
| Minimap toggle reachable identically on both platforms (`M` on desktop, a tap on touch) | **SHIPPED** | `MINIMAP_TOGGLE_KEY = 'KeyM'` `src/ui/minimap.ts:68`; `src/main.ts:5803`. |
| The controls strip reads its labels from the same map that drives the sim | **SHIPPED** | `describeBindings` `src/platform/actions.ts:170` feeds both the strip and onboarding. |
| Two dynamic virtual sticks, one per screen half, under the thumb | **SHIPPED** | `src/platform/touch.ts:55,116`. |
| The right half morphs with fire mode; Auto-aim replaces the aim stick with hold-to-FIRE | **SHIPPED** | `src/platform/actions.ts:189–193`, `:202`. |
| Fire mode is a setting on every platform; defaults Manual desktop / Auto-aim touch | **SHIPPED** | `src/platform/actions.ts:43`. |

### §2.5 Building, repair, and upgrades *(16 claims: 16 SHIPPED)*

| Claim | Verdict | Evidence |
|---|---|---|
| One place to buy: the Build & Upgrade wheel, at your own station | **SHIPPED** | `src/ui/build-wheel.ts`. |
| The segments, in the GDD's own words — TURRET, SHIELD, RADAR, REPAIR REACTOR, UPGRADE SHIP, BANK | **SHIPPED** | `src/ui/build-wheel.ts:5`, `:193`. |
| **The cost is ONE number**, signal yellow if payable, threat red if not | **SHIPPED** | `src/ui/build-wheel.ts:42–62`; no `/` in a cost label, structurally asserted by `src/ui/build-wheel.test.ts`. |
| REPAIR REACTOR also shows the HP a tap restores — including the real partial | **SHIPPED** | `src/ui/build-wheel.ts:306`, `:583` (`"+15 HP"` / `"+7 HP"`). |
| Every capped wedge shows count over cap — `2 / 4 BUILT` — including queued | **SHIPPED** | `src/ui/build-wheel.ts:342–352`. |
| UPGRADE SHIP carries an arrow, not a price | **SHIPPED** | `src/ui/build-wheel.ts:22`, `:333`. |
| The upgrade wheel's cost is ONE number, and `MAX` on a finished ladder | **SHIPPED** *(Q-3 CLOSED by the developer 2026-08-13 — the denominator goes on every page; GDD §2.5 amended, the ⚠ OPEN struck)* | `costLabelOf` `src/ui/upgrade-wheel.ts:329` → `costNumeral` `src/ui/affordability.ts`; `MAXED_COST` `:304`. No `/` in any cost slot on any page, structurally asserted by `src/ui/wheel-cost-grammar.test.ts`. |
| Each upgrade track shows its ladder position as pips | **SHIPPED** | `pipRow` `src/ui/wheel-stack.ts:251`. |
| The WEAPON wedge says `OPEN ▸` in the cost slot | **SHIPPED** | `OPENS_SCREEN` `src/ui/wheel-stack.ts:286`. |
| Construction times: turret ~10 s, shield ~15 s, radar ~12 s | **SHIPPED** | `src/sim/constants.ts:84` (`buildTime: 10`), `:382` (`15`), `:1065` (`12`). |
| Per-station caps 4 / 2 / 1, **queued construction counts against the cap** | **SHIPPED** | `capPerStation` at `src/sim/constants.ts:84,382,1065`; queue counted `src/sim/buildings.ts`. |
| Turret ladder Mk I→III, +4 / +7 ore, HP 45/60, DPS 6/8, tighter aim | **SHIPPED** | `src/sim/constants.ts:230–232` — matches §2.8 exactly. |
| Every mark's range stays **under** the ship's weapon reach | **SHIPPED** | `TURRET.range 240` and Mk II/III `245/250` vs `WEAPON_RANGE = 260` — `src/sim/constants.ts:92,231,232,1466`. |
| Shield: 5 ore, 40 HP, regen 2/s after 8 s undamaged, cap 2 | **SHIPPED** | `src/sim/constants.ts:382–390`. |
| Repair: 1 ore → 15 HP, discrete, clamped, **15 s cooldown per station** with a live countdown wedge | **SHIPPED** | `src/sim/constants.ts:403,406,438`; `"REPAIR in 12s"` `src/ui/build-wheel-view.ts:105`. |
| Ship upgrades split DAMAGE / SPEED, plus engine, cargo, hull; persist through respawn; multiply class bases | **SHIPPED** | `src/sim/upgrades.ts`; `src/sim/constants.ts:1106` (*"Upgrades multiply these bases"*). |

### §2.6 Siege balance *(6 claims: 6 SHIPPED)*

| Claim | Verdict | Evidence |
|---|---|---|
| Turrets deter; a patient attacker picks them off from outside their range | **SHIPPED** | `src/sim/constants.ts:88–92` — the range gap is documented as the mechanic. |
| Turret shots have travel time and **lead** their target; aim tightens with tier | **SHIPPED** | `fireTurretProjectile` `src/sim/projectiles.ts:131`; `aimSpread`/`aimLatency` per tier `src/sim/constants.ts:230–232`; one lead solver `src/sim/buildings.ts:926`. |
| Pressure beats regeneration — shields regen only after 8 undamaged seconds | **SHIPPED** | `SHIELD.regenDelay = 8` `src/sim/constants.ts:386`. |
| Repair cannot be interrupted, but every tap is finite ore | **SHIPPED** | `src/sim/constants.ts:392–406`. |
| Two beats one (emergent from the regen gate, not a coded rule) | **SHIPPED** | Follows from `regenDelay`; harness-checked in `tests/sim/turret-natural-siege.test.ts`. |
| The radar satellite and its fog-of-war minimap | **SHIPPED** | `SATELLITE` `src/sim/constants.ts:1065–1088`; fog `src/sim/sensing.ts:150,236`; coverage collapses the tick it dies `src/sim/buildings.ts:697`. |

### §2.7 Death, respawn, debris *(8 claims: 8 SHIPPED)*

| Claim | Verdict | Evidence |
|---|---|---|
| Respawn free and fast — 5 s at home, upgrades intact | **SHIPPED** | `RESPAWN_S = 5` `src/sim/constants.ts:961`. |
| **All** the held ore drops where you exploded; banked ore is never lost | **SHIPPED** | `DEATH_ORE_DROP_FRACTION = 1` `src/sim/constants.ts`. Read "half" until **2026-08-16 (a0-59)** — the same ruling the §2.3 row above records; §2.7's prose was amended with it and this row was not. Banked ore was never at risk and is unchanged (`killShip`, `src/sim/damage.ts`). |
| Reactor death eliminates the owner and offers **Rematch** plus **spectate** | **SHIPPED** | `src/main.ts:1441–1462`, `:2686`, `rematch()` `:2723`. |
| This holds in Teams — out even while your side plays on | **SHIPPED** | `src/sim/match.ts:142`. |
| A wreck persists all match, surrounded by scavengable, owner-funded debris | **SHIPPED** | `src/sim/state.ts:456`, `:1073`. |
| **Lootable derelicts** on compass/diamond below 8 players; no siege damage | **SHIPPED** | `src/sim/maps.ts:122–132`, `:199`; `src/sim/state.ts:444`. |
| **Ore is conserved, exactly**, asserted every tick of a full match | **SHIPPED** | `src/sim/ore-ledger.ts`; `tests/harness/ore-conservation.test.ts` (CI — G-9 on how it runs). |
| The ledger's second job: proving there *isn't* a leak, and sending you to look at what the player could see | **SHIPPED** | `src/sim/ore-ledger.ts:18` names a0-08 and the two render tells by field. |

### §2.8 Baseline constants *(19 rows: 17 SHIPPED · 2 PARTIAL)*

Checked row by row against `src/sim/constants.ts`. **Every live number matches.**

| GDD row | Baseline | Code | Verdict |
|---|---|---|---|
| Core HP | 100 | `:44` | **SHIPPED** |
| Weapon vs core | 5 | `:49` | **SHIPPED** |
| Weapon vs ships/turrets | 10 | `:53` | **SHIPPED** |
| Mining rate | 0.5 | `:58` | **SHIPPED** |
| Ship hull | 50 | `:62` | **PARTIAL** — G-14, the knob is unreferenced |
| Starting ore | 3 | `:65` | **SHIPPED** |
| Spawn protection | 10 s | `:68` | **SHIPPED** |
| Cargo hold | 2, +2/tier, cap 8 | `:71,74,77` | **SHIPPED** |
| Turret Mk I | 3 / 30 / 4 / 10 s / cap 4 | `:84–92` | **SHIPPED** |
| Turret Mk II–III | +4/+7 · 45/60 · 6/8 | `:231–232` | **SHIPPED** |
| Shield | 5 / 40 / 2 per s after 8 s / 15 s / cap 2 | `:382–390` | **SHIPPED** |
| Repair core | 1 tap = 15 HP for 1 ore, discrete | `:403,406` | **SHIPPED** |
| Atmosphere deposit | ~4× radius at 2 ore/s | `:1584` | **SHIPPED** |
| Field yield / waves / interval | 400 · 5 · ~150 s | `:509,512,515` | **SHIPPED** |
| Respawn | 5 s | `:961` | **SHIPPED** |
| ~~Sensor range~~ retired, not zeroed | — | absent by design | **SHIPPED** |
| Minimap radii | 520 / 300 / 900 | `:1026`, `:1034`, `:1089` | **SHIPPED** |
| Auto-aim arc `TUNABLE` | 2π | `:1099` | **PARTIAL** — G-13, unreferenced |
| **Ore abundance table** (SCARCE ×0.55/×0.75/×1.2 default · STANDARD ×1 · RICH ×1.6/×1.25/×0.75) | — | `src/sim/match-config.ts` + measured in `tests/reports/abundance-spread-a0-17.md` | **SHIPPED** |

### §2.9 AI opponents *(10 claims: 10 SHIPPED)*

| Claim | Verdict | Evidence |
|---|---|---|
| Hand-coded behaviour trees on the same action interface; **no LLM at runtime** | **SHIPPED** | `src/bots/tree.ts`, `src/bots/behaviors.ts`; nothing in `src/` calls a model. |
| Bots respect allegiance — never target an ally, shots pass, turrets ignore | **SHIPPED** | `src/sim/allegiance.ts:47,87`. |
| Allegiance is **read, never re-implemented** — one predicate for every question | **SHIPPED** | `src/sim/allegiance.ts`; proved with two slots sharing a side in `src/bots/teams-hostility.test.ts` (FFA cannot prove it — §2.9's own trap). |
| Bots lead a mover by last-seen velocity and their own muzzle speed | **SHIPPED** | one shared solver, `src/sim/buildings.ts:926` `leadAim`. |
| **Fog-honest**: same visual range, same hidden cargo/bank, same station health as a human | **SHIPPED** | `src/bots/perception.ts`; `src/sim/sensing.ts:107` (retired for player and bot in one pass); `src/bots/fog-honesty.test.ts`. |
| Easy / Medium / Hard behaviours as described | **SHIPPED** | `src/bots/easy.ts`, `src/bots/medium.ts:17` (*"gangs up on the current leader"*), `src/bots/hard.ts`. |
| Bots **keep their own house** — patch as a rationed emergency, never under fire, never past cooldown | **SHIPPED** | `src/bots/rebuild.test.ts`, `src/bots/repair-honesty.test.ts`. |
| …and **fly home to do it**, at a distance set by the character's territorial dial | **SHIPPED** | `src/bots/personalities.ts`. |
| The seven characters with fixed tiers | **SHIPPED** | `src/bots/personalities.ts:357+` — Rusty, Bolt, Foreman, Patch, Sable, Vulture, Warden. |
| Characters map to hulls (Bolt/Sable Interceptors, Foreman/Warden Excavators, Rusty/Patch Haulers, Vulture Vanguard) | **SHIPPED** | `src/bots/personalities.ts:342–390` — the mapping is quoted from §2.11 in the source. |

### §2.10 Onboarding *(7 claims: 4 SHIPPED · 3 PARTIAL)*

| Claim | Verdict | Evidence |
|---|---|---|
| Four contextual first-match prompts fire on triggers | **SHIPPED** | `src/ui/onboarding.ts:69–96`, `:224` `isTriggered`; all four signals fed (G-3). |
| The upgrade prompt fires the first time the wheel opens | **SHIPPED** | `src/ui/onboarding.ts:235`; `wheelOpen` from `src/ui/hud.ts:891`. |
| Input-agnostic for free via the action mapping | **SHIPPED** | `src/ui/onboarding.ts:129` → `src/platform/actions.ts:170`. |
| **They never appear again after each is completed once** | **PARTIAL** | G-3 half A — one page load only; `EXIT TO MENU` navigates (`src/main.ts:2905`). |
| The upgrade prompt retires when the lesson is learned | **PARTIAL** | G-3 half B — retires on BANK (`src/main.ts:3266`). |
| The HAUL-HOME prompt's amended copy (collection field, then E) | **PARTIAL** | G-3 half C — `src/ui/onboarding.ts:82`. |
| No separate tutorial mode: the first match is the tutorial | **SHIPPED** | No tutorial mode exists; correct. |

### §2.11 Ship classes *(8 claims: 8 SHIPPED)*

| Claim | Verdict | Evidence |
|---|---|---|
| Four hulls, locked at the lobby, setting all five attributes | **SHIPPED** | `ShipStats` `src/sim/constants.ts:1109`; lock at RUSH! `src/ui/lobby.ts:1247`. |
| The table, number for number (130/120/140·35·8·2 / 100·50·10·2 / 90/100/80·55·13·2 / 85/80/85·70·9·3) | **SHIPPED** | `src/sim/constants.ts:1125–1133` — **exact match**. |
| Power is also mining speed — one weapon, one stat | **SHIPPED** | `classWeaponDps` `src/sim/constants.ts:1141`, `classCoreDps` `:1147`, `shipMineYield` `src/sim/projectiles.ts:113`. |
| SHIP SELECT is a screen of its own; the lobby keeps one hull card | **SHIPPED** | `src/ui/ship-select.ts`, `src/ui/class-tile-view.ts`; card at `src/ui/lobby.ts:1278`. |
| Stats on the tiles as **pips AND numbers**, read from the sim's class table | **SHIPPED** | `src/ui/class-tile-view.ts`; source is `SHIP_STATS`. |
| A short tile drops its role blurb first, its nickname second, **never its stats** | **SHIPPED** | `src/ui/class-tile-view.ts`; regression-shot in `tests/mobile/`. |
| The Vanguard is the pre-selected onboarding default | **SHIPPED** | `src/ui/hud.ts:312`; `tests/live-stage/lobby-flow.spec.ts:162`. |
| QA target: **no class exceeds 55% win rate** in mirror-vs-field | **SHIPPED** | `harness/balance.ts:9` encodes it verbatim; `harness/abundance.ts:289` runs it. |

---

## 6. §3–§5 — architecture, technical strategy, art

### §3 The agent team *(2 claims: 2 SHIPPED)*

§3 describes the studio, not the product, so most of it is out of scope for a
build audit. The two product-facing claims it makes:

| Claim | Verdict | Evidence |
|---|---|---|
| *"There is no runtime multi-agent system in the shipped game … Runtime token cost: zero."* | **SHIPPED** | No model call anywhere in `src/` or `server/`; bots are `src/bots/tree.ts`. |
| §3.6 *"Every mechanic in section 2 has a visible **and** audible tell"* | **SHIPPED** | 23 tell kinds, each with a documented payload and unit — `src/art/tells.ts:142–165`; VFX consumption `src/main.ts:2276`, audio `:2241`. |

### §4.1 Stack and platform *(9 claims: 9 SHIPPED)*

| Claim | Verdict | Evidence |
|---|---|---|
| TypeScript throughout, one codebase for client/server/bots | **SHIPPED** | `src/`, `server/`, shared `src/shared/types.ts`. |
| PixiJS WebGL2 renderer | **SHIPPED** | `pixi.js@8.6.6` (`package.json`); `src/render/index.ts`. |
| PWA manifest + service worker caching the app shell | **SHIPPED** | `public/manifest.webmanifest`; `public/sw.js:16,20`. |
| One `platform.ts` seam for fullscreen/vibration/storage/orientation | **SHIPPED** | `src/platform/platform.ts`, `fullscreen.ts`, `haptics.ts`, `orientation.ts`. |
| Broad phase: uniform-grid spatial hash, cell ≈ 2× largest radius | **SHIPPED** | `src/sim/spatial-hash.ts:20`; `HASH_CELL_SIZE = 2 * ASTEROID.maxRadius` `src/sim/constants.ts:1600`. |
| Narrow phase: `dx²+dy² < (r1+r2)²`, no square roots | **SHIPPED** | `src/sim/projectiles.ts:262`-region; `src/sim/step.ts` distance tests are all squared. |
| Pooled projectiles with finite muzzle speed and lifetime, despawn on hit | **SHIPPED** | `takeProjectile` `src/sim/projectiles.ts:69`. |
| Euler integration with drag; ship-vs-asteroid reflects | **SHIPPED** | `DRAG = 3.0`, `SHIP_ASTEROID_RESTITUTION = 0.8` — `src/sim/constants.ts:1340,1348`. |
| Deterministic fixed 60 Hz sim, decoupled from render; the server imports no Pixi; CI replay test | **SHIPPED** | `TICK_DT = 1/60` `src/sim/constants.ts:37`; `server/room.ts:349`; `tests/determinism.test.ts` (G-9 on how it runs). |

### §4.2 Multiplayer *(12 claims: 12 SHIPPED)*

| Claim | Verdict | Evidence |
|---|---|---|
| Authoritative Node WebSocket server holds all authority | **SHIPPED** | `server/match-server.ts`, `server/ws.ts`. |
| Rooms from the lobby with a shareable code | **SHIPPED** | `src/net/room-code.ts:32,36,51`. |
| Bots fill **only** the slots the host set to `bot`, server-side | **SHIPPED** | `server/room.ts`; mirrors `src/sim/match-config.ts:41`. |
| **A room whose only human is the host boots locally at RUSH!** and the room is released | **SHIPPED** | `src/net/local-revert.ts`; decision at `src/main.ts:9238` (*"ask the roster, not the door"*), release at `:9258`. |
| …and the player is told, once and quietly | **SHIPPED** | `src/net/local-revert.ts:31`, `ROOM_COST_NOTE` `:165`. |
| Rooms advertise mode, size and open seats on the heartbeat, not the snapshot | **SHIPPED** | `server/heartbeat.ts:194–198`. |
| **No pause online** — one `pausable` flag; offline freezes, online does not | **SHIPPED** | `shouldFreezeSim(screen, pausable)` `src/ui/pause-menu.ts:85`. |
| "Host" is a lobby word, not a network role; no listen servers, no P2P | **SHIPPED** | `src/ui/lobby.ts:929`. |
| Static entities as events on join and on change; only ships and projectiles stream | **SHIPPED** | `src/net/entity-events.ts:2–9`; producer `server/static-events.ts`; 10 Hz static diffs `server/room.ts:151`. |
| Server ticks 20–30 Hz, clients render at 60 with interpolation | **SHIPPED** | 30 Hz `server/room.ts:135`; `INTERP_DELAY_MS = 100` `src/net/interpolation.ts:52`. |
| Client-side prediction and reconciliation | **SHIPPED** | `src/net/prediction.ts:93,105`. |
| **Reconnect grace** — a bot substitutes immediately, the seat is held ~60 s, upgrades intact | **SHIPPED** | Client verdict `src/net/reconnect.ts:46,79`; server side `server/room.ts:132`, reclaim tokens `server/match-server.ts:62,373`, refusals `server/room.ts:200–202`. |

### §4.3 Named constraints *(6 claims: 5 SHIPPED · 1 PARTIAL)*

| Claim | Verdict | Evidence |
|---|---|---|
| Bounded scope, milestone-gated; the cut list is the instrument | **SHIPPED** | `milestones.json`; §4.9 below. |
| Offline-first dev, cloud deploys | **SHIPPED** | `.github/workflows/`. |
| Entity-count budget at 60 fps with pooling, spatial hash, zero per-frame sim allocations | **SHIPPED** | `src/sim/spatial-hash.ts`; pooled projectiles `src/sim/projectiles.ts:69`; reused `Actions` object `src/platform/actions.ts:54`; sim gate `tests/harness/perf.test.ts`. |
| **Sustained drops below the floor auto-engage "reduce VFX"** | **SHIPPED** | `VfxAutoQuality` `src/platform/vfx-quality.ts:60`, floor + hysteresis `:47`; applied `src/main.ts:2226`. |
| The renderer's phone gate, verified not assumed | **PARTIAL** | G-15 — exists, out of CI, manual. |
| Runtime token cost zero | **SHIPPED** | §3 above. |

### §4.6 / §4.6a *(3 claims beyond the milestone table: 2 SHIPPED · 1 MISSING)*

| Claim | Verdict | Evidence |
|---|---|---|
| Each milestone gains a `test_notes` field in `milestones.json` | **SHIPPED** | `milestones.json` — every entry carries `test_notes`. |
| The deploy workflow pings ntfy on tag with the URL and those notes | **SHIPPED** | `.github/workflows/ci.yml:112–135`. |
| **On-demand deploys push current `main` to the `/dev` URL** | **MISSING** | G-2. |

### §4.7 Tone and voice *(10 claims: 7 SHIPPED · 1 PARTIAL · 2 MISSING)*

| Claim | Verdict | Evidence |
|---|---|---|
| M0 concept mode: theme boards, layout variants, UI mockups | **SHIPPED** | `docs/art-direction/` — `concept-boards.html`, `concept-round2.html`, `ui-mockup.html`, `scene-gallery.html`, `facility-concepts*.html`, `ship-classes.html`. |
| The direction frozen into `style-guide.md`, changeable only through the Director | **SHIPPED** | `style-guide.md`. |
| Register 1 replaced with clean/modern/futura; the ache carried over verbatim | **SHIPPED** | `style-guide.md:391`; the beat itself `src/art/vfx/death-moment.ts:8–13`. |
| Register 2 exists and is honoured in the shipped copy | **SHIPPED** | `CLAIM HELD`/`CLAIM LOST` shape in `src/ui/end-of-match.ts`; `src/ui/online-copy.ts`; the match/machine line kept at `src/platform/boot-error.ts`, `src/platform/build-info.ts`. |
| Fixed strings the voice may not revisit (`RUSH!`, `BACK`/`CLOSE`/`DONE`/`JOIN`/`ERASE`, `HOME`, the wheel labels, the settings rows) | **SHIPPED** | `RUSH_LABEL` `src/ui/lobby.ts:133`; nav verbs `src/ui/codex.ts:68`; wheel labels `src/ui/build-wheel.ts:5`; settings `src/ui/settings.ts:115`. |
| The blast radius is audio-only; VFX and bot-naming stay unratified and untouched | **SHIPPED** | `docs/audio-revoice-spec.md`; G-17. |
| The alarm is a sanctioned exception — legibility outranks register | **SHIPPED** | `docs/audio-revoice-spec.md:435`; `src/ui/alarm.ts` unchanged. |
| The tone paragraph is mirrored in `style-guide.md` §8 | **PARTIAL** | Register 1 landed; register 2 did not — G-5. |
| The tone paragraph is mirrored in `content/codex/pipeline/tone.md` | **MISSING** | G-4 — still the retired paragraph. |
| **Both mirrors must gain register 2** | **MISSING** | G-5 — zero hits in either file. |

### §4.8 Source control, CI, distribution *(6 claims: 4 SHIPPED · 1 PARTIAL · 1 MISSING)*

| Claim | Verdict | Evidence |
|---|---|---|
| One repo holds code, the GDD, the style guide, briefs and generated assets | **SHIPPED** | This repo. |
| Short-lived branches, Director merges via PR | **SHIPPED** | `git log` — every merge is a PR. |
| CI on every push: typecheck, unit tests, determinism replay, ore conservation, headless smoke | **PARTIAL** | G-9 — all five run; three are un-named specs inside one `vitest run`. |
| Deploy on green `main`: client to Pages, server to its host | **SHIPPED** | `ci.yml:89`; `deploy-server.yml:71`. |
| **Release on tag: stable link serves the latest tag, `main` on `/dev`** | **MISSING** | G-2. |
| Git is offline-first — commit all day, push in a burst | **SHIPPED** | No pre-push hooks; CI does the building. |

### §4.9 Ranked cut list *(4 claims: 3 SHIPPED · 1 PARTIAL)*

Nothing has been cut, which is the point of checking.

| Claim | Verdict | Evidence |
|---|---|---|
| Item 1 (ambient music) still present | **SHIPPED** | `src/art/audio/music.ts:290` `MusicDirector`; ambient bed at `:4`. |
| Items 2–4 (bot personality flavour, end-of-match summary, 8-player online) still present | **SHIPPED** | `src/bots/personalities.ts`; `src/ui/summary-sequence.ts`; `MAX_MATCH_SIZE` = 8. |
| Items 6–7 (PWA installability, landscape lock) still present | **SHIPPED** | `src/platform/install-prompt.ts:29`; `src/platform/orientation.ts:11`. |
| Boost and minimap ping are **gone, not deferred** | **SHIPPED** in code · **PARTIAL** in docs | No boost/ping verb in `src/platform/actions.ts:59–66`. But G-7 — `docs/mobile-cross-platform-amendment.md:50` still specs the ping. |

### §5 Art direction *(15 claims: 13 SHIPPED · 1 PARTIAL · 1 MISSING)*

| Claim | Verdict | Evidence |
|---|---|---|
| The Cold Vacuum palette, six roles, exact hexes | **SHIPPED** | `src/art/tokens.ts:42–54` — `0x0d1015 / 0x7e8894 / 0x4fa08b / 0xf2d24b / 0x4dc3ff / 0xb23a3a`, **all six exact**. |
| Signal yellow means ore or danger and nothing else | **SHIPPED** | `RESERVED` marked at `src/art/tokens.ts:48`; enforced by `src/art/compliance.ts:200` `assertPaletteCompliance` in `src/art/backdrop.test.ts`. |
| Eight identity colours; hulls stay steel; colour on trim/cockpit/flame/ring/bar only | **SHIPPED** | `src/art/palette.ts:72`; `src/render/index.ts:436`. |
| Every ship carries its player number as a hull decal (colourblind-safe path) | **SHIPPED** | `hullDecal` `src/art/decals.ts:97`, per-hull placement `src/art/ships.ts:132`, `:155`, `:179`. |
| The team motif is the one second colour layer, and never reaches a hull | **SHIPPED** | `SIDE_COLORS` `src/ui/lobby.ts:439` reaches `Nameplate.teamColor` (`src/ui/nameplates.ts:171`) and nothing else. |
| Four hulls, four silhouettes, readable at 24 px | **SHIPPED** | `src/art/ships.ts:20–22`; rasterised and compared at 24 px in `src/art/ships.test.ts`. |
| **Exactly two rings** around your own station and none around anyone else's | **SHIPPED** | `src/render/index.ts:969`, `:997` — the haze at `DEPOSIT_RANGE`, dashed plasma at `STATION.dockRange`. |
| The haze must be a haze — banding steps are a bug, and **CI counts them** | **SHIPPED** | `scanRings` `src/art/ring-scan.ts:120`, `RING_JND` `:50`, asserted in `src/art/generators.test.ts`. |
| The planetoid body randomised per player from four variants | **SHIPPED** | `src/art/stations.ts:65`, `:273`. |
| The reactor stays signal yellow; ownership = beacon ring, always visible; health = damage ring, also always visible | **SHIPPED** | `src/art/tokens.ts:48`; `style-guide.md:300–310`; `src/sim/sensing.ts:107`. |
| Turrets read their mark as a distinct silhouette (Breech Cannon / Twin Cannon / Rail Spike) | **SHIPPED** | `src/art/buildings.ts:18–22`, mapped to the sim ladder at `:80–88`. |
| Asteroids crack across three stages so a payout can be judged before committing fire | **SHIPPED** | `src/art/asteroids.ts:23`, `:105`, `:383`. |
| **Audiowide + Oxanium, self-hosted** | **MISSING** | G-1. |
| §5.7's HUD inventory and the "enemy health is the ring, not a HUD bar" rule | **SHIPPED** | `src/ui/station-hp.ts` is the local player's only; `src/art/rings.ts:54` is the whole enemy grammar. |
| `style-guide.md` free of retired mechanics | **PARTIAL** | G-6 — `:25` still says "the repair channel". |

---

## 7. QUESTIONS FOR THE DEVELOPER

Only a human can settle these. Each is a decision, not a bug — with one
deliberate exception, **Q-6**, which is a measured defect whose every remaining
fix is a design call, so the decision is yours even though the bug is real.

**Q-1 · What is a home called, in fiction?** §0 names **FACILITY** as a *working
placeholder* and asks you to pick from FACILITY / RIG / STATION / OUTPOST. The
build has been shipping **station** for months — every player-facing string,
every code identifier (`MiningStation`), and §1, §4.7's vocabulary table and §5.4
now all assume it. The pick has effectively been made by shipping. **Ratify
`STATION` and delete the placeholder paragraph**, or name a different noun and
accept a copy sweep. Doing nothing keeps a live "TBD" in the term contract every
copy task reads.

**Q-2 · Is the six-map registry the design, or is it drift?** §2.1 says *"Four
maps"* and names four; the build ships six (`line` and `crescents`, added by
a0-12 as the two-sided Teams boards). Either the GDD gains an amendment folding
a0-12 in — my recommendation, because they shipped for a reason you asked for —
or two maps come out. Right now the record under-reports the game.

**Q-3 · The upgrade wheel's `cost/held`. — ANSWERED 2026-08-13, CLOSED by
a0-41.** The question was: *"Two screenshots, one press apart: does the
denominator go, or does it stay and the build wheel become the exception?"* The
developer answered with a screenshot of the live upgrade wheel at 8 ore:

> "I had said I didn't want stuff like 5/6 only the cost . it got done on the
> page before this one but none of the sub pages. we need to make sure changes to
> build menu affect all pages"

**The denominator goes, on every level of the wheel** — main and WEAPON sub-wheel
both. The build wheel was not the exception; it was the first page to be fixed.
GDD §2.5's upgrade-wheel bullet is rewritten and its ⚠ OPEN flag struck; the
second sentence is enforced by `src/ui/wheel-cost-grammar.test.ts`, which walks
every wedge on every page of the menu. Full entry in `docs/design-amendments.md`.

**Q-4 · Should onboarding remember you across matches, or across sessions?**
§2.10 says *"never appear again after each is completed once"* and *"the first
match is the tutorial."* Fixing G-3 half A means persisting completion — and the
choice of scope is yours: **(a)** per session (survives EXIT TO MENU, forgotten on
a reload), or **(b)** per device, in `localStorage`, so the tutorial is genuinely
once-ever. (b) is what the sentence says; it also means a friend borrowing the
phone never gets taught, and you lose the ability to see the prompts again
without clearing storage. If (b), do you want a **RESET ONBOARDING** row in
settings? *(Recommendation: (b), plus the settings row — one line of copy, and it
makes the prompts demonstrable at a milestone check.)*

**Q-5 · G-1 re-baselines every golden.** Shipping the two typefaces changes how
every screen looks, so `tests/mobile/goldens.spec.ts` re-baselines wholesale.
That is a real cost and it is worth naming before it is spent. **Confirm you want
the ratified faces shipped** (they are §5.6, so my assumption is yes), and QA
should schedule the re-baseline in the same pass rather than after it.

**Q-6 · Wave 5 seals the map centre and entombs whoever is standing in it. Which
of the three fixes do you want, and does a0-59 wait for it?** *(Raised
2026-08-16 by a0-59 / PR #436. Full report, with the measurements behind every
number here: `docs/wave-commons-entombment.md`.)*

This is a **live defect on `main`**, not a regression: from wave 2 onward the
commons ring carries more rock than its circumference can hold, and by wave 5 it
is **3.66× oversubscribed** — 1632 u of rock arc on a 446 u ring. It closes to
71 u from the map centre and seals the disc inside as a solid annulus with a
**19.3 u** free pocket; `SHIP_RADIUS` is **16**. A ship caught there is entombed
for the rest of the match, at full throttle, and **a human player is caught
exactly as a bot is**. Incidence is **~1.25% of seeds** (measured both arms over
200 seeds: 3/200 on `main`, at seeds 142/146/147; 2/200 on a0-59's branch, at 15
and 142 — indistinguishable, and every instance at or beside the map centre).

**Why it needs you and not an engineer.** Everything inside the gameplay lane is
measured and exhausted. No rearrangement of the rocks can work — a 3.66×
oversubscribed ring has no corridor at any angle or radius, since passability
needs `R ≥ 276 u` and the ring is at 71 u. `commonsHoleFraction` is at the end of
its travel and was never the right knob. `commonsSpokeGap` is an *angular*
constant, so the linear corridor it promises shrinks with the ring — 84.6 u at
wave 1, **21.2 u at wave 5** against the 62 u its own doc-comment claimed, a
false promise now struck. And the sim's own ratified anti-wedge mechanic (the p14
escape hatch) **fires on 98.4% of the wedge's ticks, cycles its entire
four-direction search at 68.7 u/s, and still cannot get out**, because the
pocket's widest clearance is 5.5 u for a 16 u hull. The hatch defeats *pinning*
against a surface; it cannot defeat *enclosure*, and no knob makes space.

**The three candidates, costed.** *(1)* **Widen the last ring**
(`WAVE.lastRadiusFraction`) — passability needs ≈ **0.90** against wave 1's 1.00,
which lands wave 5 on top of wave 1 and **deletes** §2.3's shrinking ring. Named
only to rule it out. *(2)* **Taper late-wave rock size or count** — the only knob
with real travel; keeps the ring closing in; costs §5.5's "a payout the player can
judge" (rock size reads as ore) and changes the field's texture. The *count*
variant is likely cheaper, because the wave's fixed ore budget makes the survivors
richer on its own. **My recommendation.** *(3)* **Eject a live ship a landing wave
would entomb** — touches no rock, so `FIELD_YIELD` and the field's symmetry stay
exact and almost no golden moves; but it is a new sim rule, and it treats the
symptom, since the centre stays sealed for anyone who flies in *after* the wave.

**One warning, because it is the edit anyone would reach for first.** There is a
fourth-looking option — reserve the commons eye by rock **body** instead of
**centre**, correcting a genuine inconsistency with the launch pocket 90 lines
above in the same file. **Measured, both arms: it turns the red gate green while
leaving the ring 360/360 sealed.** It doubles the free pocket (21.6 → 42.1 u) and
opens *zero* escape bearings; the worst wedge at seed 15 falls 133.5 s → 2.7 s
purely because `unstuck.test.ts` re-anchors once a hull moves 8 u, and a ship in a
42 u sealed cell clears that. The player is still entombed — in a slightly larger
cell — and the only instrument that detects it has been switched off. The
correction is still worth making, but it must land **with** candidate 2, never
before it, and a green `unstuck` must not be the evidence that the trap is gone.

**And the scheduling half, which is the part actually blocking work.** a0-59 is a
one-constant developer ruling ("destroyed ships should drop all their ore") that
**neither caused this nor worsens it** — its entire behavioural delta against
`main` is that one constant, verified mechanically. But it re-rolls *which* seeds
hit the trap, and seed 15 lands inside the 24 that `tests/harness/unstuck.test.ts`
draws, so PR #436 is red on a defect it did not introduce while `main` is green on
the same defect purely by luck. **Land a0-59 and brief the wave trap separately,
or hold a0-59 behind the fix.** Either is fine; the PR cannot settle it itself.

---

## 8. Task breakdown — needs-ordered, with TDD steps

Each gap becomes its own brief. Ordered by need, not by size: **G-1 first because
it is what a player sees; G-2 second because it is what the classroom sees.**
Every step below is written to be followed verbatim.

### T-1 → G-1 · Ship the two typefaces *(owner: UI Engineer, with Art & Audio; QA for the re-baseline)*

Blocked on **Q-5** only for scheduling, not for the decision.

1. **Red first.** Add `src/ui/typography.test.ts`: assert that `index.html`
   contains an `@font-face` block naming `Audiowide` **and** one naming
   `Oxanium`, and that each `src:` target exists on disk under `assets/fonts/`.
   It fails today, for the right reason.
2. Add the two OFL `.woff2` files under `assets/fonts/` with their `OFL.txt`
   licence beside them (§4.5 — license-clean, regenerable offline).
3. Add the `@font-face` declarations to `index.html` with `font-display: swap`
   — `src/ui/typography.ts:17` already explains why the fallback must stay
   legible for the frame or two before decode.
4. Add both files to the service worker's `SHELL` array (`public/sw.js:20`) and
   bump `CACHE_VERSION` (`:16`). **Skipping this makes the offline PWA render in
   fallback faces, which is the bug you just fixed, only harder to see.**
5. Do **not** change `FONT_HEADING` / `FONT_BODY` (`src/ui/typography.ts:37,42`).
   The stacks are already correct; they have simply never had the first name
   available. Deleting the fallbacks is a separate decision — leave them.
6. Re-baseline `tests/mobile/goldens.spec.ts` in the same PR, and say in the PR
   body that the diff is *expected and total*. Read
   `tests/reports/golden-diffs-and-highdpi-settle-q8.md` first — it is the
   institutional memory for why goldens go red for reasons that are not the
   change.
7. Green the test from step 1.

### T-2 → G-2 · Build the `/dev` path *(owner: Platform Engineer)*

1. **Red first.** Add `tests/tools/deploy-topology.test.ts`: parse
   `.github/workflows/ci.yml` and assert the Pages artifact for
   `refs/heads/main` publishes under a `dev/` prefix while `refs/tags/v*`
   publishes at the root. Fails today.
2. In the `ci` job (`ci.yml:74`), build twice, or build once and stage: on
   `main`, `VITE_BASE=/dev/` and copy `dist` to `_site/dev`; on a `v*` tag,
   `VITE_BASE=/` at `_site/`. `vite.config.ts:17` already honours `VITE_BASE`, so
   **no client code changes.**
3. The tag deploy must not clobber `dev/` and the `main` deploy must not clobber
   the root. `actions/deploy-pages` publishes a whole artifact, so the artifact
   has to carry **both** — fetch the currently-published other half, or keep the
   last tagged `dist` as a CI artifact and re-stage it. **This is the step that
   will be got wrong**: a naive two-target change silently deletes whichever half
   this run did not build, which is a worse outcome than today's.
4. Teach the ntfy step (`ci.yml:112`) an on-demand mode that pings the `/dev`
   URL with `milestones.json`'s `.default` entry, so §4.6a's "deploy now" is
   real.
5. Update `docs/mobile-cross-platform-amendment.md:18` (G-7's other half) to
   describe what now exists.

### T-3 → G-3 · Make onboarding remember the player *(owner: UI Engineer)*

Blocked on **Q-4** for scope (a) vs (b). Everything below is written for (b), the
GDD's literal reading; for (a), swap `localStorage` for an in-memory module
singleton and skip step 3.

1. **Red first, three tests in `src/ui/onboarding.test.ts`:**
   - a fresh `Onboarding` seeded from a persisted completion set never returns a
     completed prompt;
   - completing a prompt writes it through a supplied sink;
   - **`hasOrdered` from a BANK order does not complete `PromptId.Spend`.**
   All three fail today.
2. Give `Onboarding` an optional constructor arg — a `{ load(), save(set) }`
   port. Keep the class pure and DOM-free (`src/ui/onboarding.ts:10` — that is
   the whole reason it tests headless; do not import `localStorage` into it).
3. Add `planet-rush:onboarding` to the persisted-key set and wire the port at the
   `new Onboarding()` call site (`src/ui/hud.ts:470`), beside the other eleven
   keys.
4. **Split the SPEND signal.** `OnboardingSignals.hasOrdered` currently means
   "any wheel order". Add `hasSpent` — true only for an order that spends
   (`BuildItem` turret/shield/radar/repair, or an `upgradeOrder`), false for
   BANK — and complete `PromptId.Spend` on that. The call site is
   `src/main.ts:3250–3267`: `writeWheelOrders` and the `pendingUpgrade` drain
   both feed one `ordered` flag today, so this is where the two meanings separate.
5. **Fix the HAUL-HOME copy** at `src/ui/onboarding.ts:82` to carry the amended
   lesson: `'Hold full — fly into your collection field to bank, or press {build} to spend'`.
   Then **measure it**: §4.7's clarity rule says *"Length is part of clarity … A
   longer in-register word that ellipsizes has traded information for flavour."*
   `tests/live-stage/prompt-band.spec.ts` is the instrument — the prompt band is
   sized from measured text height, and this string is longer than the one it
   replaces. If it wraps to a third line on a 390 px handset, shorten it and say
   so in the PR; do not ship a prompt that ellipsizes.
6. If Q-4 says (b): add a `RESET ONBOARDING` settings row. It is a fixed string
   the voice does not get to revisit — plain and imperative, per §4.7's
   navigation-verb floor.

### T-4 → G-4 + G-5 · Re-pin both tone mirrors *(owner: Director + Art & Audio — **not** the architect; these are their files)*

1. Paste the ready-made replacement paragraph from `docs/audio-revoice-spec.md`
   §9 over `content/codex/pipeline/tone.md:8–17`. It is written and waiting.
2. Add register 2 — GDD §4.7's block from *"Who speaks"* to *"The clarity rule"* —
   **verbatim** to **both** `style-guide.md` §8 and
   `content/codex/pipeline/tone.md`. §4.7 says verbatim; a paraphrase of a pinned
   prompt is a second contract.
3. **Red first, and this is the step that stops it rotting again:** add
   `tests/codex/tone-mirror.test.ts` asserting that neither mirror contains
   `Saturday-morning`, `cartoon rival`, `explosions are fireworks` or `a toy`,
   and that both contain `operating authority` and `contracted operator`. §4.7
   says a mirror is quoted verbatim by definition — so a test is the only thing
   that can notice when one drifts.

### T-5 → G-6 + G-7 · Sweep the two stale docs *(owner: Director)*

1. `style-guide.md:25` — "the repair channel" → "repair". Discrete since
   2026-07-26 (§2.5). Same string in `src/art/tokens.ts:47`.
2. `docs/mobile-cross-platform-amendment.md:50` — delete the minimap-ping line
   and any boost reference; both were cut outright (§2.4, §4.9).
3. Fold into the same PR as T-2's step 5 if the timing works — it is the same
   file.

### T-6 → G-9 · Apply the CI step patch *(owner: QA Agent)*

`git apply docs/ci-determinism-step.patch`, confirm the four named steps go
green, and **delete the patch file** — a patch that lives in `docs/` forever is a
change nobody applied, which is the same class of miss this whole audit is about.

### T-7 → G-13 + G-14 · Two dead knobs in the constants table *(owner: Gameplay Engineer, with QA — QA owns the table from M2)*

Small, and worth doing precisely because §2.8 already set the precedent when it
**retired** `Sensor range` rather than zeroing it: *"a `0` would still read as
tunable."*

1. `AUTO_AIM_ARC` (`src/sim/constants.ts:1099`) — either make the acquisition in
   `src/sim/step.ts:623` actually read it (so the `TUNABLE` is true), or retire
   the row from §2.8 the way `Sensor range` was retired, with the reason written
   in. **Do not delete it silently**: §2.4 states the 360° rule as design, so the
   constant is the only place that rule is currently written down in code.
2. `SHIP_HULL` (`:62`) — same fork against `SHIP_STATS` (`:1125`). Note in the
   GDD that per-class hull superseded the single baseline.

---

## 9. Traps — read this before touching anything above

1. **Do not "wire" `ArtPresenter`.** `src/art/presenter.ts:68` is an orphan in
   the dark-matter scan and looks exactly like the built-and-never-wired pattern
   LESSONS §1 warns about. It is not. `main.ts` constructs the pieces it wraps
   directly (`:900`, `:1274`, `:1275`) and calls them every frame (`:2241`,
   `:2276`). Wiring the façade would double-observe the world.
2. **The dark-matter table counts exports, not features.** A "zero production
   references" row can name a file that boots, and — as G-13 shows — a live
   *behaviour* can have a dead *constant*. Read the call site before believing
   the row.
3. **`hasOrdered` is one flag doing two jobs** (`src/main.ts:3266`). It feeds
   both the haptic confirm and the SPEND prompt's retirement. Splitting it for
   T-3 must not stop the haptic firing on a BANK press — banking *is* an order,
   it just is not spending.
4. **Onboarding must stay DOM-free.** `src/ui/onboarding.ts:10` is explicit that
   the trigger machine is pure so it tests headless. Importing `localStorage` in
   there trades every unit test for one integration test.
5. **A longer prompt string is a design change, not a copy change.** §4.7:
   *"Length is part of clarity … Measure before you ship it."* The prompt band is
   sized from measured text (`src/ui/hud.ts:1921`), and
   `tests/live-stage/prompt-band.spec.ts` exists because a prompt once collided
   with the open wheel.
6. **The `/dev` split can delete the classroom's build.** See T-2 step 3. Pages
   publishes whole artifacts; a two-target change that only stages one half
   removes the other. Stage both, always.
7. **Shipping the fonts turns every golden red at once.** That is expected. Do
   not chase the diffs individually, and do not land T-1 in a PR with anything
   else in it.
8. **`content/` is invisible to the dark-matter scan.** Its own output warns:
   *"unclassified directories in the program: content — if any of those ship, add
   it to `roleOf()`."* G-4 lives in `content/`. That is not a coincidence — it is
   the one directory no instrument in this repo looks at.

---

## 10. Closing

The developer asked what the GDD has that the build does not. The honest answer
is: **remarkably little, and none of it is a mechanic.** Every rule in §2 that a
player can act on is implemented, and the numbers behind them match the design
document row for row. Nothing on the not-cuttable list was cut.

What did not make it are the things nobody plays and everybody sees: the
typefaces, a deploy path, a memory, and two mirrored paragraphs. Three of the
four were already known to somebody — `src/ui/typography.ts:22` has said so since
2026-08-07, GDD §4.7 says its own mirror is stale, and `docs/ci-determinism-step.patch`
has been sitting in `docs/` waiting to be applied. **The pattern worth taking
from this audit is not that these were missed; it is that each was written down,
in the repo, and written down is not the same as briefed.**

Onboarding, specifically, exists and works. It just forgets you the moment you go
back to the menu.
