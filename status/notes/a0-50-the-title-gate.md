# a0-50 — the title gate

Branch `agent/ui/a0-50-title-gate`. Working note, not evidence: it never
substitutes for the DoD, the PR, or QA attestation.

## BUILT

- **`b2171bb` feat(a0-50): the title gate — the menu behind a door that gets
  operated.** `src/ui/title-gate.ts` (the screen: geometry, the four beats, the
  title CSS, the markup, the starfield + punch, the DOM seam and its browser
  adapter), `src/ui/game-name.ts` (`GAME_NAME` and the wordmark split),
  `src/ui/sfx.ts` (+`GateCue`, `GateSfx`, `NO_GATE_SFX`),
  `src/ui/title-gate.test.ts` (44 tests, both named gates among them).
- **`f091f98` feat(a0-50): the door's four cues, as slots in the ratified bank.**
  `src/art/audio/ui-cues.ts` — `gateUnlock` / `gateSeated` / `gateReseal` /
  `gateSealed`, plus the swept-filter `AirNote` (`to`, `band`) the pressure
  relief needs and a `bandpass` in the offline biquad. **Cross-ownership: this
  commit is deliberately alone**, so Art & Audio can review or revert it without
  touching the screen.
- **`482a839` feat(a0-50): put the gate's two canvases behind VfxAutoQuality, and
  hold the seam.** `TitleGateOptions.quality`, the per-paint reduced read (the
  doc claimed it and the code sampled once per resize, which on a phone is never
  during this screen's life), and the tests that hold the cue seam to the slots
  behind it.
- **`c685d81` feat(a0-50): mount the gate over the menu, and give it its voice.**
  `src/main.ts` — the overlay goes into `#app` above the game canvas on a clean
  boot, `sfx` is `audio.uiCues.play`, `quality` is a `VfxAutoQuality` of its own.
  Plus the bug the mount found: both screens listen for keys on the same
  `window` and the menu registered first, so `Enter` behind a closed door booted
  a match nobody could see. `src/ui/index.ts` exports the screen.

## DECISIONS

- **DOM overlay, never a Pixi port.** `clip-path`, `background-clip:text`,
  `-webkit-text-stroke` and `drop-shadow()` have no cheap Pixi equivalent, and
  the port would be a rewrite of a finished screen. The doorway punch reveals
  the real `MainMenuView`, which is what makes the design's central claim true
  rather than simulated.
- **The punch tracks the door's MEASURED scale every frame** — a deviation from
  the design file, demanded by the design's own reasoning. The prototype could
  jump the punch to its final size because it had a second identical starfield
  behind the menu; here the hole reveals the actual menu, so an early punch is
  the cross-dissolve this screen exists to avoid.
- **One field, not two.** The design's rear field (behind the menu, never
  punched) is `MainMenuView`'s own backdrop here. Only the front field — the
  punched one — is this screen's, and it is the one the invariant is about.
- **The reduced path drops the twinkle and the drift, NOT the punch.** The
  handoff's own suggested reduction is "a single field with the punch dropped",
  which was right for a prototype where dropping the front field changed nothing
  visible. Here the punch is the only thing making the doorway a hole; dropping
  it paints the menu shut. So a throttled device gets a still field with ~⅓ the
  stars, and the frame loop survives at a fixed clock purely to keep the hole
  tracking the door for the one-and-a-half seconds it grows.
- **`gateSeated` is not a re-mount.** Through, the overlay goes inert —
  `visibility:hidden`, `pointer-events:none`, frame loop stopped, zero paint —
  rather than being removed, because `Escape` reseals and a door that has been
  taken out of the DOM cannot come back. `dispose()` is the real removal and
  runs when the menu screen ends. **Rejected:** unmount on beat 4 and rebuild
  the subtree on `Escape` — a fresh element cannot start a CSS transition from
  the through-scale without a forced-reflow dance, and that is a new failure
  mode in exchange for a word.
- **Four cue slots in the bank, not a second synthesiser.** The design's engine
  builds `unlock`, `seated`, `hover`, `confirm`, `select` in a few hundred
  lines. Three of those five were already ratified slots (`hover`, `confirm`/
  `purchase`, `pick`), so only the door's own beats are new. Two engines would
  mean two tone contracts and a `measure-bank-tone.ts` that audits one of them.
- **`UI_CUE_NAMES` still names the handoff's nine.** The door cues are a second
  list, `DOOR_CUE_NAMES`. That is not bookkeeping: every rule in
  `ui-cues.test.ts` — back is the only falling cue, nothing borrows back's note,
  everything resolves but `refused` — is a statement about *the interface
  answering a fingertip*, and the door is a machine running a sequence. Folding
  them into one list would either break those rules or quietly weaken them.
- **Floor `#070910`, not the design's `#010204`.** Same correction a0-40 already
  made in the play-field; `#010204` is Floor's retired value (style-guide §1.1).
- **Signal yellow appears once: the hazard stripes** at the leaves' meeting
  edges, which style-guide §2 names in so many words. The design also paints the
  lock's open-position index mark in it; that is a machine marking, not a
  hazard, so it is steel here.
- **The name is a token.** `GAME_NAME` ships saying what the tab and the
  manifest already say. Docs and evidence keep saying Planet Rush — they are
  records of what was true. The rename is a separate decision (it reaches the
  repo name and the Pages URL, which breaks every evidence link).
- **The menu asks whether it is blocked; the gate does not swallow.** Keys are
  the one case the overlay does not solve by existing. `stopImmediatePropagation`
  in the gate would have worked on the menu and broken something worse: the
  window's keydown is ALSO what arms audio (`AudioUnlock`, risk 7), so
  protecting the menu that way costs a keyboard player the sound of the door
  they just opened. **Rejected**, for that reason.
- **`Escape` only reseals at the menu's top level.** It already means BACK on
  settings, the doors, the codex and the hangar. `MainMenuHandle.atTopLevel()`
  → `TitleGateOptions.canReseal`.

- **`a2d762d` fix(a0-50): the gate must not NAME a CDN either.** The DoD greps
  the SOURCE — `grep -qiE 'unpkg|googleapis|gstatic' && exit 1` — and it was
  FAILING on this branch: three lines of header prose explained which hosts the
  design file pulls from and named both while doing it. The markup was always
  clean, which is why nothing was red; the existing offline test only read
  `titleGateHtml()`. The prose now describes the hosts instead of naming them,
  and the test reads the source as well.

### The CI pass (2026-08-15, a fourth session — the note said "nothing outstanding" and CI said otherwise)

- **`ae608fd` fix(a0-50): triage the doorway invariant.** `dark-matter:check` is
  a step of the required `Typecheck, test, build` job and it was RED:
  `skyCoversPoint` is a new export no production code calls. Allowlisted as
  SURFACE with the verdict in `docs/dark-matter-scan.md` §4.7, because a version
  production called could only be the paint restated — and the failure it guards
  is a paint that *looks right*.
- **`d026851` fix(a0-50): `?gate=0`.** The mobile-emulation shards had never run
  on this branch (they are skipped while the unit job is red). With the unit job
  green, four of six shards failed, and structurally: **~30 automated specs walk
  through the front door on their way somewhere else** — they boot at `/`, read
  `window.__mainMenu` and click where it says a plate is drawn, and a sealed door
  takes that click instead. So the screen ships with a narrow off switch read at
  the mount (`gateEnabled`): it turns off this screen and nothing else, the
  default is on, and it has to be asked for by name.
- **`d7410fe` chore(a0-50): the flag on boots this lane does not own.** 22 sites
  in 22 files, one line each, alone in its own commit so QA and Platform can
  revert it without touching the screen.
- **`5bececa` test(a0-50): measure the sealed door.** The gate is sampled in
  `menu-frame-cost.spec.ts`'s title test, against the same live-match yardstick.
  17.6 s → 24.3 s in-container, both green; `shard-plan` 109 → 144, DERIVED.
- **`5c53a10` fix(a0-50): the doorway was a hole in the canvas and a lid
  everywhere else.** **THE FINDING OF THIS PASS.** See below.
- **`0901349` evidence(a0-50): the door operated, and the failure put back
  beside it.** `evidence/a0-50-title-gate/` — five beats, `before`/`after`, and a
  regenerable `shoot.mjs` that fails loudly if the gate does not mount.

- **`0b9832a` fix(a0-50): the door turns with the game.** The landscape lock
  reaches the overlay: `gateRootLayoutCss` is the CSS spelling of the same
  `RootTransform` the Pixi root takes, and every `vw`/`vh` on the screen now
  reads `--pr-gate-vw` / `--pr-gate-vh` — the LOGICAL viewport — because rotating
  a root does not change what a viewport unit means. Second browser-only find.

### The bugs three sessions of green unit tests could not see

**The overlay root was painted `background:#070910`.** The punch is
`destination-out` on the CANVAS, so it erases the canvas; the root sits behind
the canvas, inside the overlay, between the doorway and the menu — and the punch
cannot reach it. The shipped screen showed a **black doorway for the whole of
beats 2 and 3.** The leaves parted onto nothing.

Three things worth keeping from it:

- **`skyCoversPoint` was right the entire time.** The named test asserts the
  canvas geometry and the canvas geometry was never wrong. Trap 1 is not *"is
  the punch a ring"* — it is *"is the doorway a hole ALL THE WAY THROUGH"*, and a
  canvas predicate cannot answer the second. The new case says so by name.
- **Sealed is the state anyone would photograph, and sealed is where the leaves
  cover the defect.** `before-1-sealed.png` and `after-1-sealed.png` are
  indistinguishable. So is beat 2. Only the frame carrying the claim differs.
- **Nothing in this repo would have caught it.** Not the unit suite (no DOM), not
  the goldens (they boot `?gate=0`, and before this brief there was no gate at
  all). It took loading the built bundle in Chromium and pressing the door. **Do
  that before claiming this screen works** — it is four minutes and it is the
  only thing that can see this class of failure.

**And then the same four minutes found a second one, on a phone.** A handset held
portrait gets a game rotated +90°; the DOM overlay did not turn with it. Worse
than sideways, because rotating a root does not change what `vw` and `vh` mean —
the lock is `min(148px,17vh)`, portrait `vh` is the LONG side, so the rotor sat
at its pixel cap while the door shrank under it. Rotor two thirds the height of
its own door, clearance eating the whole leaf, both words clipped through the
middle. Fixed in `0b9832a`, and it needs BOTH halves: the transform, and the
units read against the logical viewport. **The first half alone makes it worse.**

## DECISIONS (the CI pass)

- **`?gate=0`, not `?debug=1`, and not a `navigator.webdriver` sniff.**
  `?debug=1` skips the whole front of the game — those specs want the real menu,
  doors and lobby, they just should not have to open a door to reach them. A
  webdriver check was **rejected outright**: it would make the shipped bundle
  behave differently under test than in a browser, which is the one thing a
  browser suite exists to prevent, and it would have hidden this screen from CI
  permanently rather than visibly.
- **The gate is measured, not merely excused.** `menu-frame-cost.spec.ts`'s own
  header states the rule — *a screen added to the set and not added here is a
  screen that can peg the runner in silence* — so the sealed door is sampled in
  the same pass as the menu, against the same live-match yardstick. Folded into
  the existing test rather than added as a third, so the shard grows by one boot
  and one 3 s window instead of a whole test.

## VERIFIED LOCALLY (this pass, in-container, against the real preview build)

- `npx tsc --noEmit` — clean.
- `npm test -- --run` — 295 files, 5428 tests, all passing (re-run after the last
  edit is the one that counts; see the final run in the PR).
- `npm run dark-matter:check` — no new dark exports.
- `--project=iphone menu-frame-cost.spec.ts` — 2 passed, with the sealed door
  sampled: the door is inside the same ceiling the menu is.
- `--project=desktop goldens.spec.ts` — **24 passed, 26 skipped, no rebaseline.**
  This is the one that mattered: `?gate=0` restores the exact pixels every
  existing baseline was taken against, so the flag costs QA nothing.
- Chromium, by hand, on the built bundle — which is what found the black doorway.

## NEXT

- Watch the shards. The four that failed (2, 3, 4, 5) are exactly the ones
  carrying a front-door spec; 1 and 6 carry `goldens`, which fails on PIXELS
  rather than on a timeout if the flag is wrong — and desktop `goldens` is green
  locally.
- **For QA / the Director, not blocking:** the `?gate=0` opt-out means the
  goldens do not photograph this screen. A golden of the sealed door is worth
  having and belongs in `goldens.spec.ts`, which is QA's — the seam it needs
  (`window.__titleGate`) does not exist yet either. `evidence/a0-50-title-gate/`
  is the interim, and it is regenerable.

**Read this before touching the branch again** (it is the reason this file
exists). A later session in a fresh lane started from a stale local branch — the
remote had five commits it never fetched — and rebuilt the whole screen from the
brief before discovering them. Nothing was lost (no force-push; the duplicate
lives on the local-only ref `a0-50-lane-local-attempt` and is not on the
remote), but the hour was. **`git fetch origin <branch>` before writing a line.**

Two things that second pass produced which are worth keeping in mind:

- **The DoD had a failing check the note above claimed was clean.** "Verified"
  has to mean the command was run, not that the intent was met. Every DoD line is
  now run against `FETCH_HEAD` rather than against the working tree.
- **The punch tracking `measureDoorScale()` is load-bearing and not obvious.**
  The independent rebuild derived the punch's scale from the phase model instead,
  which jumps the hole to its final size on the first frame of `entering` while
  the CSS door is still small — a bright crescent, and exactly the beat the
  screen exists for. Do not "simplify" it back.

Both named gates were verified RED before being claimed — twice, and the second
is the stronger evidence: against `main` (neither `src/ui/title-gate.ts` nor
`src/ui/title-gate.test.ts` exists there, so the suite cannot even load) and
against a copy of this implementation on `main` with each trap deliberately
reintroduced, where each failed on its own failure mode and said so:

    the doorway is a hole, not a fade
      → the doorway is painted shut: expected true to be false
    nothing sounds before the first press
      → the gate called the cue seam before a gesture:
        expected [ 'gateUnlock' ] to deeply equal []

Open for the Director / other owners, none blocking:

- **Art & Audio owns `src/art/audio/ui-cues.ts`.** The four slots are one
  isolated commit for exactly that reason. The pressure-relief numbers are the
  handoff's own (7.6k→3k over 200 ms; 4.8k→620 over 1.7 s; a shorter blast as
  the leaves break contact with the sub arriving only when the weight moves).
- **`Escape` is the only reseal.** Touch has no `Escape`, so a phone plays the
  gate once. The design's `RESEAL AIRLOCK` button is a design-tool affordance
  and shipping it would put UI the brief did not ask for over the real menu.
