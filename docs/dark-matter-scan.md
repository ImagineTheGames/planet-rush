# Dark matter — exports production never calls

**a1-09 · Platform Engineer · 2026-08-10 · every number below is reproducible
with `npm run dark-matter` on this branch**

**Corrected by a1-14 (2026-08-10): §4.3 recommended deleting a live module.
[§4.0](#40-correction--a-dead-row-that-was-not-dead-a1-14-2026-08-10) is the
correction and the post-mortem — the scan was right, the triage was not.**

`matchAbundance` (`src/sim/match-config.ts`) is three lines,
correct, and tested. Its entire job is applying the ratified SCARCE default. It
had zero non-test callers: production read `config.abundance` raw, which
resolved to `standard`, so every match ever played ran a 150 s wave schedule
while the lobby promised SCARCE. The developer reported it twice, QA measured
151 s on the live build, and `n5-01` fixed it.

Nothing failed. Types passed, tests passed, CI was green, the function was
covered. **The only symptom was that nobody called it** — the fifth time a
merged-green feature turned out never to have been wired into the boot path, and
every one of the five was found by a human eventually noticing.

`tools/dark-matter-scan.mjs` finds that mechanically. This file is the triage.

---

## 1. Running it

```
npm run dark-matter              # the candidate list, grouped by verdict hint
npm run dark-matter -- --modules # per-module rollup + the modules nothing boots
npm run dark-matter -- --json    # machine-readable
npm run dark-matter:check        # the CI gate: exit 1 on a NEW dark export
npm run dark-matter:audit        # hold this file's verdicts to the numbers (§4.0)
```

For every `export` declared under `src/`, it counts references from production
files — resolved through the TypeScript compiler API, so an identifier counts
only when its symbol resolves to that export. Four rules decide what a use is,
and each of them changes the answer:

| Rule | Why |
|---|---|
| **A name in prose is not a call.** | `matchAbundance` has three non-test grep hits at `51e8445^` and all three are comments. `singlePrimary` has 19 at HEAD, every one a comment. A grep-based scan calls both live and finds nothing. |
| **A re-export is plumbing.** | The barrels forward nearly everything; counting them would report the whole repo live. A symbol re-exported and consumed by nobody is still dark. |
| **An import is not a use.** | `import { x }` with no call in the body is the signature of half-finished wiring. |
| **Production means *reachable* production.** | Following imports from the three deployed apps' entry points, 17 modules under `src/` cannot be reached at all. Without this a dead cluster keeps itself alive, every member "called" by a sibling nobody loads. |

A reference from inside the declaring module is counted separately (`self-used`):
that code *runs*, and only the `export` is wider than the use. Ranking it with
the real findings buries them — 1221 of the 1528 raw candidates are this.

## 2. The acceptance test — it finds the bug we already know about

Run against `51e8445^` (`7e175ac`), the tree QA measured the 151 s interval on:

```
src/sim/match-config.ts:83  matchAbundance  [function]
    prod:0  orphan:0  test:3  tool:0  self:0  re-export:0     → dark, test-only
```

Full output and the grep counterfactual: `evidence/a1-09-dark-matter/`.

**It still flags at HEAD.** `n5-01` fixed the *behaviour* — correctly, and the
wave schedule is right now — by threading the lobby's pick through both
producers. It did not make anything call the helper: `server/room.ts:510` and
`src/ui/lobby.ts:1131` each write `config.abundance ?? DEFAULT_ABUNDANCE`
inline. The function whose entire job is applying that default has, today, five
spec references and no callers. That is finding §4.1's first entry, and it is
the honest reading of a scan that would otherwise look like it had nothing to
say about the case it was built for.

## 3. The numbers

2769 exports under `src/`. 1528 have zero production references. Split by what
the zero means:

| Hint | All | Values | In the gate |
|---|---:|---:|---|
| `self-used` — its own module calls it; only the `export` is wide | 1221 | 826 | no |
| `test-only` — specs call it, production does not ← **the `matchAbundance` shape** | 157 | 156 | yes |
| `orphan-module` — declared in a file no entry point reaches | 105 | 80 | yes |
| `unreferenced` — nothing anywhere names it | 37 | 34 | yes |
| `reexported-unused` — a barrel forwards it; nobody takes it | 8 | 8 | yes |
| **triaged below** | | **278** | |

Types (interfaces, aliases) are reported but excluded from the gate: an
interface exported for one caller to spell a parameter is not a wiring failure.

## 4. Triage

Every one of the 278 carries its verdict in `tools/dark-matter-allowlist.json`,
one line each. The sections below are the reasoning. **§4.0 is a correction to
§4.3 and supersedes it where they disagree.** **§4.1 is verified** — I
read the production path for each and it either does the work itself or does not
do it at all. **§4.2 is the same shape but confirmed only by the scan**, and is
flagged for its owner rather than asserted. **§4.4 is triaged by pattern**, and
says so.

### 4.0 CORRECTION — a DEAD row that was not dead (a1-14, 2026-08-10)

**Read this before §4.3.** One row in the DEAD table recommended deleting a live
feature. `n7-01` caught it while doing the deleting, and left the module alone
rather than editing this file. The row as it shipped:

> | `src/net/connect-trace-view.ts` (2) | its own header says it "is no longer a panel of its own" |

**What that module actually is.** It puts **RETRY and DOWNLOAD LOG under the
title of a connecting screen that just failed** — the developer's ask, *"with
RETRY and the log right there"*. It is DOM rather than PixiJS on purpose: the
moments it exists for are a socket that never opened and a join the server
refused, when the renderer may not be drawing at all. It is installed at boot and
driven from `src/main.ts`'s connect state machine, through the `src/net` barrel:

| Site (at `ecc1496`, and unchanged at `ffc414e`) | Call |
|---|---|
| `src/main.ts:365-367` | imports `hideConnectTrace`, `installConnectTraceView`, `showConnectTrace` from `./net` |
| `src/main.ts:6804` | `installConnectTraceView({…})` — the boot install |
| `src/main.ts:6831`, `:6864` | `showConnectTrace(…)` — per trace step, and on the re-render timer |
| `src/main.ts:6911` | `hideConnectTrace()` — in `endConnectTrace` |

Its `TraceDom` / `TraceElement` types are imported by `src/net/link-loss-view.ts`,
`src/net/local-revert-view.ts` and `src/net/link-loss-attach.ts` — the module
`n6-01` wired into the match's boot path. Deleting this file takes the CONNECTION
LOST overlay down with it. *(`n7-01` read the call sites at `:6790`, `:6817`,
`:6850` and `:6897`; `a1-11` has moved `main.ts` under them since. The line
numbers rot — the scan's `prodSites`, below, do not.)*

**The scan was right. The triage was wrong.** This is the important half, so it
is worth being exact about. Re-run at `ecc1496` — the tree the row was written
against, before `n7-01` landed — the scan's own numbers for that file were:

```
src/net/connect-trace-view.ts  — 14 exports, 5 live, 2 dark, 7 self-used
    installConnectTraceView   prod:1  → live      (src/main.ts)
    showConnectTrace          prod:2  → live      (src/main.ts)
    hideConnectTrace          prod:1  → live      (src/main.ts)
    TraceDom                  prod:3  → live      (link-loss-view, link-loss-attach, local-revert-view)
    TraceElement              prod:3  → live      (link-loss-view, local-revert-view)
    connectTraceView          prod:0 test:0 self:0  → dark, unreferenced
    resetConnectTraceView     prod:0 test:0 self:0  → dark, unreferenced
```

The reachability walk did not miss the module: it resolved five of its exports to
production call sites and named them. **There is no bug in
`tools/dark-matter-scan.mjs` here, so there is none for another row to share.**
Checked rather than assumed — a sweep of all 241 allowlist entries against that
same run found none the scan now calls live and none naming a symbol that no
longer exists.

The two exports it did flag — a `connectTraceView()` accessor and a
`resetConnectTraceView()` teardown seam, zero references of any kind, not even
from the module's own spec — were genuinely dark, and they are exactly the two
`n7-01` deleted (PR #375). At `ffc414e` the file is 12 exports, 5 live, 7
`self-used`, and **nothing in it is dark**. Its allowlist lines went with the
symbols; the module has no verdict left to be wrong about.

What went wrong is one step later, in this document. The triage:

1. **Wrote the verdict from the header instead of from the numbers.** The header
   sentence is *true* — that panel is gone, folded into the connecting screen's
   title line by `connectTitleLine`. It describes a **panel that became two
   buttons**, not a module that died. A file's prose says what it used to be;
   only the call sites say whether it still runs, and they were in the same
   report, one column over.
2. **Filed two symbol findings as one module row.** Every other DEAD row is
   honestly scoped — the spike row names three files that are dead entire, the
   `vec.ts` row names four members of a live file. This row put a bare module
   path under a heading reading *"safe to delete"*, and a reader deletes what the
   row names. The `(2)` was doing all the load-bearing work and none of the
   reading.

A human misreading a header is not fixable in code, and pretending otherwise
would be the second wrong claim in this section. What *is* fixable is the shape
that misreading leaves behind — a DEAD verdict written next to symbols in a file
whose other exports the same scan calls live. `npm run dark-matter:audit`
(`--audit`) now looks for it. It reports and never fails; it is a prompt to
re-read a row, not a gate. Run in the `ecc1496` tree — this branch's tool, that
tree's allowlist, before `n7-01`'s deletions — it names the row:

```
VERDICTS TO RE-READ: 2 modules carry a DEAD verdict and still have exports production calls.
      The verdict may still be right about the symbols it names — but it is
      not right about the file, and a reader will take it for the file.

      src/net/connect-trace-view.ts  — 2 marked DEAD, 5 live
        LIVE  TraceElement (prod:3 — src/net/link-loss-view.ts, src/net/local-revert-view.ts)
        LIVE  TraceDom (prod:3 — src/net/link-loss-view.ts, src/net/link-loss-attach.ts, src/net/local-revert-view.ts)
        LIVE  installConnectTraceView (prod:1 — src/main.ts)
        LIVE  showConnectTrace (prod:2 — src/main.ts)
        LIVE  hideConnectTrace (prod:1 — src/main.ts)

      src/sim/vec.ts  — 4 marked DEAD, 3 live
        LIVE  dist2 (prod:19 — src/sim/projectiles.ts)
        LIVE  normalize (prod:6 — src/sim/projectiles.ts, src/sim/step.ts)
        LIVE  turnToward (prod:2 — src/sim/buildings.ts)
```

At `ffc414e` — `n7-01`'s deletions landed — only the `vec.ts` block remains, and
that row is **correct**; see the re-check below. Which is the honest limit of
what a tool can do here: the two rows were indistinguishable to it, and differed
only in how a human wrote them down. It narrows "re-read the section" to "re-read
these rows", and that is the whole of the help available.

**Every DEAD row re-checked, then.** The section had one wrong row, so its method
is suspect until each is checked the way `n7-01` checked that one — against the
call sites, not against the prose:

| Row | Re-checked at `ecc1496` | Verdict |
|---|---|---|
| `src/net/spike/{bench,sim-standin,snapshot}.ts` (13 gated) | all 20 exports of the three files `prod:0`, and no entry point reaches any of them | **stands.** Correctly scoped: the files *are* dead entire. Deleted by `n7-01` |
| `src/sim/vec.ts` — `vec`, `len2`, `dist`, `dot` (4) | all four `prod:0 test:0 self:0`, `unreferenced`. `dist2` (prod:19), `normalize` (prod:6) and `turnToward` (prod:2) are live | **stands**, with one correction below |
| ~~`src/net/connect-trace-view.ts` (2)~~ | above | **withdrawn.** The module is live; the two symbols were dark and are gone |

The `vec.ts` correction is small and is the same error in miniature: the row's
aside said "(`len`, `dist2` are live)". `dist2` is live. **`len` is not** — it has
`prod:0 test:0 self:1` and is `self-used`, called only by `normalize` inside
`vec.ts`. The code runs; nothing outside the module calls it, so the `export` is
wider than the use. Worth saying because `vec.ts`'s own header makes the claim
that fooled §4.3 the first time — *"`len`/`dist` exist for geometry that
genuinely needs a magnitude"* — and this time the numbers were believed over the
prose, which is why that row is right.

The row is corrected in place below rather than deleted, so the next reader knows
it was checked and what it looked like when it looked dead.

### 4.1 DARK — should be called, and is not (verified)

**`src/ui/lobby-flow.ts` — 25 of its 26 value exports, 222 spec references, one
caller.** The front-of-match state machine. Its own header says why it exists:

> *"A comment is not a seam. M2 shipped a HUD whose every element was merged,
> tested and unwired, and the milestone was retracted for it… So the order lives
> here, in code, asserted headless — and Platform's job in `main.ts` shrinks
> from transcribing a comment to draining an effect list."*

The one thing `src/main.ts` calls from it is `wireFireMode`. It names
`./ui/lobby-flow` **nine times in prose** — "rule 1", "rule 2", "rule 3", "the
same targets `flowTapSettings`", "exactly as `flowConnected` does". The module
written to stop a state machine living in a comment is being consumed as a
comment. `flowTapLobby` has 50 spec references and no callers.
**Should be called by:** `src/main.ts`. *(Owner: UI + Platform.)*

**`src/art/vfx/` + `src/art/presenter.ts` — 50 dark value exports, an unreachable
island.**
`emitters.ts`, `kinds.ts`, `layer.ts`, `particles.ts`, `field.ts` and the
`ArtPresenter` that wires them are reachable from no entry point. GDD §3.6 does
not ask for "some effects", it names them, and `emitters.ts` implements all 25:
`weaponImpact`, `asteroidCrack`, `oreCollect`, `shieldDown`, `explosion`,
`collapsePulse`… Nothing constructs `ArtPresenter` or `VfxLayer`. The *audio*
half of the same design is wired — `src/main.ts:876` builds a `WorldObserver`
and names it `audioObserver` — so the tell stream is sounded and not drawn.
`src/render/index.ts` draws no particles.
**Should be called by:** `src/main.ts` / `src/render/index.ts`. *(Owner: Art.)*

**`src/net/link-loss-view.ts` — 11 of its 12 value exports, and the entry point
has zero references of any kind.**
The CONNECTION LOST overlay, from the developer's zombie-match report: *"I should
get kicked out and presented reconnect / abandon buttons, and verbosity of what
happened."* `installLinkLossView` is never called — not by production, not by a
spec, not by the barrel it is exported through.
**Should be called by:** the client's session boot. *(Owner: Netcode.)*
**FIXED 2026-08-10 by n6-01** — installed on the match's boot through
`src/net/link-loss-attach.ts`, which also folds `visibilitychange` in (nothing in
`src/` listened for it) and polls the watchdog each rendered frame, so the freeze in
`session.sendInput` engages too. `installLinkLossView`, `showLinkLoss` and
`resetLinkLossView` left the allowlist; `hideLinkLoss` and `linkLossView` stay as
surface. Proved by `tests/live-stage/link-loss.spec.ts`, which boots the shipped
bundle, kills a real socket silently and clicks the real buttons — a unit test
cannot prove a wire, which is how this shipped.

**`src/art/atlas.ts` — 11 of its 12 value exports, and a performance claim.**
The translation layer from sim state to pooled textures, whose stated job is
that "a field of 200 rocks shares a couple of dozen textures (GDD §4.3: zero
per-frame allocation on the hot paths)". `src/render/index.ts` imports exactly
one thing from it, `asteroidArt`, and draws ships, stations, turrets and shields
by calling the sprite generators directly through `spriteGraphics`/`drawSprite`.
Every `*Texture` pooling function is uncalled. This one is mine to care about —
60 fps on integrated graphics is a Platform gate — and it is a measurement, not
a bug report: the pooling that was built is not the pooling that runs.
**Should be called by:** `src/render/index.ts`. *(Owner: Art + Platform.)*
**PARTLY FIXED 2026-08-10 by a1-11** — rocks, turrets and shots (`asteroidArt`,
`asteroidTexture`, and the renderer's own keyed lookups) went through the pool;
263 draw calls a frame → 32. The other nine `*Texture` functions stayed in the
allowlist as *dark by deferral*, quoting a1-10 §6B as the costed follow-up.
**`oreChunkTexture` FIXED 2026-08-14 by a0-41**, and this row is the reason it
is worth restating rather than just deleting. The ore field was not deferred
art — it was **better art nobody drew**. `oreChunkSprite` (facets, a lit and a
shadowed pair, a findability halo) shipped in M1; `src/render/index.ts` drew
`new Graphics().circle(0, 0, 1).fill(PALETTE.signalYellow)` — one flat disc —
for every one of the 120 chunks on the §4.3 scene, for the whole milestone. The
scan called the *texture* function dark and was right; what it could not say is
that the sprite behind it was dark too, in the only sense that matters, because
a generator called by a catalogue and a contact sheet is "called". The developer
found it by looking at the screen: *"less just like a simple circle"*.
`oreChunkTexture` leaves the allowlist because it is now called from
`drawChunks`, and `src/art/shapes.ts#filledStroke` leaves it because a0-41's rim
is the first production call to it. Measured on the same instrument a1-11 used
(`node spikes/atlas-pooling/run.mjs`, whole-frame desktop baseline), the ore
layer costs **+1 draw call** for 120 entities and 4 textures — which is the
shape a1-10 §6B predicted, taken one layer at a time.

**`src/ui/main-menu.ts#mainMenuRoute` — and it defaults differently.**
`main.ts#activateMenu` (line 7809) reimplements the route as an if/else chain.
The pure model returns `null` for an unknown option, and its header explains
that this is deliberate: *"`default` returns `null` so a case deleted at runtime
is a red test rather than a dead button."* The shipped chain ends in a bare
`else` that opens the hangar. The spec pins a safety property the shipped path
does not have. **Should be called by:** `src/main.ts`. *(Owner: UI.)*

**`src/ui/button-theme.ts` — 6 exports, no importer at all.**
"The ONE button style contract", written for the v0.2.2 field report. No file
imports it — not even the `src/ui/index.ts` barrel. If `./gantry`'s plate roles
superseded it, this is DEAD rather than DARK; that is UI's call, and either way
the "ONE contract" claim in its header is not true today. *(Owner: UI.)*

**`src/sim/match-config.ts#matchAbundance` — the case that started this.**
See §2. **Should be called by:** `server/room.ts:510`, which today writes the
helper's exact body inline. *(Owner: Gameplay + Netcode.)*

### 4.2 DARK, family — a pure model of a screen, driven inline (owner to confirm)

The same shape as `mainMenuRoute`, found by the scan and not individually
verified against the production path: a headless model with specs, and a
`src/main.ts` that does the work itself. Listed so the owner can confirm or
dismiss each; **not** asserted here.

| Module | Gate-relevant dark values | Note |
|---|---:|---|
| `src/ui/lobby-geometry.ts` | 4 (of 74 exports, 61 dark counting `self-used`) | the lobby's rects |
| `src/ui/hud-geometry.ts` | 8 | "every rect the day-2 elements occupy" — the M2 retraction's own subject |
| `src/ui/lobby.ts` | 7 | `pickShipClass`, `pickMap`, `seatDifficulty` — reducers named in 8 comments, called by none |
| `src/ui/map-select.ts`, `src/ui/ship-select.ts` | 5 | the screens' target-key and card-hit models |
| `src/ui/menu-nav.ts` | 3 | the navigation graph, including `reachesMainMenuWithoutMatch` |
| `src/ui/connection-status.ts` | 1 | `connectionStatusModel`, zero non-test references |

`src/platform/touch-visuals.ts` — my own file — names `buildButtonHighlighted`
in two comments and calls it zero times. That is the family in one line.

### 4.3 DEAD — safe to delete, by its owner

**This table shipped with a wrong row, withdrawn in §4.0 — read that first.** It
named a whole module, under this heading, for a file that is installed at boot
and called three times from `src/main.ts`. What is left below has been re-checked
against call sites rather than headers (§4.0), and each row now says how much it
claims: a file, or named members of a live file.

| Scope | Module / symbol | Why |
|---|---|---|
| ~~the whole file~~ | ~~`src/net/spike/{bench,sim-standin,snapshot}.ts` (13 gated, 20 exports)~~ | the day-0 netcode spike, superseded by `src/net/snapshot.ts`. Every export `prod:0`, no entry point reached any of the three. **Deleted by `n7-01`, PR #375** |
| **these members only** | `src/sim/vec.ts` — `vec`, `len2`, `dist`, `dot` (4) | four unreferenced members of a **live** module: `dist2`, `normalize` and `turnToward` are called from production, and `len` runs inside `normalize`. Delete the four; the file stays. *(Owner: Gameplay.)* |
| ~~one symbol~~ | ~~`src/platform/wheel-input.ts#HUB_FRACTION`~~ | **deleted in this branch** — see below |

**One deletion, and only one.** `HUB_FRACTION = 0.22` had zero references of any
kind, including from its own spec, and triage found it was worse than unused: it
mirrored a `src/ui/build-wheel-view.ts` geometry that no longer exists. That file
now draws "a 150 px hub inside a 470 px disc, so there is one number rather than
two" — 0.319, which `tests/mobile/upgrade-wheel-gantry.spec.ts` also uses. A
stale mirror of a number the other side already merged away is exactly the drift
`wheel-input.ts`'s spec exists to catch. Guarded rather than just removed
(LESSONS §14): `wheel-input.test.ts` now presses at 0, 0.10, 0.22 and 0.29 of the
radius on two axes and requires every one to miss, then requires 0.31r to still
buy. Watched it fail first — setting `INNER_FRACTION` to 0.22 turns it red with
`at 0.22r: expected 'segment' to be 'hub'`.

The rest are other agents' files. The scan found them; deleting them is theirs
to do, and a dark-matter scan that turns into a deletion spree is a worse outcome
than the dark matter. §4.0 is why that is not merely good manners: the one row
here that named a whole file was wrong about the file, and the owner who came to
do the deleting is the one who caught it. As of `ffc414e` the only row left
un-acted-on is `vec.ts`'s four members, and it is Gameplay's to take.

**Observation, not a finding:** the hit-test's dead zone is `INNER_FRACTION`
0.300 of the drawn radius while the hub is *drawn* at 0.319, so presses in that
thin annulus land on the drawn hub and hit-test as a segment. No behaviour is
changed in this brief; flagged for a later one.

### 4.4 SURFACE — intentionally exported past the boot path

157 entries, triaged by pattern rather than one at a time. The pattern and its
justification, so the classification can be argued with:

**(a) The art review and audit surface** — `compliance.ts` (style-guide §2
mechanised: *"`src/art/compliance.ts` fails any sprite that paints an entity in
it"*), `raster.ts`, `ring-scan.ts`, `svg.ts`, `preview.ts`, `catalogue.ts`,
`audio/candidates.ts`. These are linters and review tools. They are *supposed*
to be unreachable from `main.ts`: they run in specs and in `evidence/` scripts.
Reported as `orphan-module`, verdict SURFACE.

**(b) Invariants and tuning exported so a spec can hold production to them.**
`src/ui/gantry.ts#singlePrimary` is the clearest: *"that rule written down so a
test can hold each screen to it."* `src/ui/build-wheel.ts#segmentAtDirection` is
cross-checked against `@platform/wheel-input`, which cannot import `src/ui`
without a cycle — the spec is the only place the two can meet. `src/sim/
constants.ts`'s derived-stat helpers and the `art/tokens.ts` / `art/palette.ts`
tables are the same: QA and the balance harness own them from day 2.

`src/ui/build-button.ts#BUILD_BUTTON_LABEL` (a0-32, 2026-08-12) is the same
shape as `segmentAtDirection` and, unlike the 157 above, was checked one row at
a time. It is the arithmetic that fits `BUILD` and `& UPGRADE` inside the 38px
circle. `@platform/touch-visuals` draws the sizes it produces, spelled out as
literals because `src/platform` may not import `src/ui` at runtime, and
`touch-visuals.test.ts` pins the two together — the discipline the two font
stacks were already held to. The spec is the only place the layers can meet, so
"no production caller" is the design and not a gap.

The same brief resolved its other two findings the other two ways, which is
worth recording because the gate's whole point is that allowlisting is the last
option and not the first: `font-metrics.ts#textBox` was **wired** — the wedge
placement in `wheel-stack.ts` was building the same box inline, so the export
replaced a second arithmetic rather than sitting beside one — and
`font-metrics.ts#untabledGlyphs` was **deleted**, having no caller in production
or in a spec. Only the seam that could not be wired was allowed.

**(c) Test seams** — `resetBuildIdentity`, `resetPlaytestLog`,
`resetLinkLossView`, `createDoNothingBot`, `LatencyTransport`,
`platform/freeze.ts#buildFrozenWorld`. Reset and stand-in helpers whose entire
purpose is to be called from a spec.

**(d) `src/art/shapes.ts#inkAlphaAt`** (a0-39, 2026-08-13) — checked one row at
a time, like `BUILD_BUTTON_LABEL` above. a0-39 replaced the sky's four-disc
approximation of a nebula with one gradient-filled shape, which put a `falloff`
on `Ink`; `inkAlphaAt` is the answer to "what alpha does this ink paint at this
point", and it exists so a picture, a measurement and a frame cannot disagree
about a gradient. Its callers are `raster.ts` — already SURFACE under (a) — and
`backdrop.test.ts`'s overdraw and peak-luma measurements.

**Wiring it up was the first option and it does not fit.** Production does draw
the same falloff, through `falloffProfile`, and that one has two real production
callers: `textures.ts` bakes it into the shared radial ramp texture, and
`svg.ts` emits it as `<radialGradient>` stops. But both work in the falloff's
own unit space (`t ∈ [0,1]`) and neither holds a world-space point, which is
`inkAlphaAt`'s entire signature — routing them through it would add a coordinate
round-trip to invent an argument they do not have. The shared arithmetic is
already factored out and already called: `falloffProfile` is not dark.

So the split is deliberate — `falloffProfile` is the shape of the falloff and is
production's; `inkAlphaAt` is that shape applied to an ink at a point and is the
measurement surface's. Deleting it would duplicate the same product in the
rasterizer and in the spec, which is the thing it was extracted to prevent.

This is the section most likely to be wrong, and wrong in the expensive
direction — a DARK finding filed as SURFACE stays invisible. It is a pattern
judgement over 157 items, not 157 investigations — plus the two rows above
((b)'s `BUILD_BUTTON_LABEL` and (d)'s `inkAlphaAt`) that were checked singly.

### 4.5 SEAM — a feature landed in two halves, on purpose (n10-01, 2026-08-12)

**CLOSED, 2026-08-12 (u17-01). Both entries are gone from the allowlist.**

| Export | Verdict then | Now |
|---|---|---|
| `src/net/lobby-list.ts#readLobbyList` | SEAM — the browse screen's read | called by `src/main.ts` `refreshLobbyList` |
| `src/net/lobby-list.ts#joinListing` | SEAM — the browse screen's JOIN button | called by `src/main.ts` `startListingJoin` |

`docs/lobby-browser-plan.md` split the lobby browser across two owners: the route
and its client (Netcode, Milestone B — n10-01) and the browse screen that calls
them (UI, Milestone D — u17-01). For one brief's width these two were the client
half of a route with no caller, allowed with a named and dated successor.

The successor landed, so the entries came out. That is the whole of the promise
n10-01 wrote into both of them: *"if the browse screen does not land, these
entries are the evidence that it did not — the right response then is to delete
them, not to re-justify them."* The screen landed; they are deleted either way.

**What this half-brief allowance is worth keeping**, because the gate will meet
it again: `matchAbundance` shipped tested and uncalled *and nobody was waiting for
it*, which is why it survived weeks. A SEAM entry is only defensible with a named
successor brief and a date — and the entry has to say what evidence its own
survival would be.

### 4.6 SURFACE — the design, exported to be compared against (a0-40, 2026-08-13)

| Export | Verdict |
|---|---|
| `src/art/mockup-reference.ts#MOCKUP_GROUND` | SURFACE — the reference half of a CI comparison |
| `src/art/mockup-reference.ts#MOCKUP_SKY_IDS` | SURFACE — the design's own index, iterated by the gate |
| `src/art/mockup-reference.ts#starRampColor` | SURFACE — shared with the dev-only review surface |

`src/art/mockup-reference.ts` is a new kind of module in this repo and it is
worth naming the shape rather than pattern-matching it onto §4.4. It is **the
design, committed as data**: the backdrop compositor's own per-sky counts, radii,
alphas, ground and star curve, frozen, with a test that holds the shipping art to
them. It exists because the backdrop drew five times darker than its design for
six developer reports and *nothing in CI compared the two* — every ceiling the
gate could see (`peakLuma`, `overdraw`, `SKY_ALPHA_MAX`) rewards a darker sky, so
five briefs optimised toward them and nothing pulled back.

Most of the module *is* called by production — `backdrop.ts` builds every sky out
of `MOCKUP_REFERENCE` and `mockupBlobs`, so a sky cannot exist without a design
entry. The three rows above are the part that cannot be, and each for its own
reason:

- **`MOCKUP_GROUND`** is the reference half of an equality. `backdrop.test.ts`
  asserts `FLOOR === MOCKUP_GROUND`; a version of it that production imported
  could not fail that assertion, which is the only thing it is for.
- **`MOCKUP_SKY_IDS`** is the *design's* list of skies, so the gate iterates the
  design rather than `NEBULA_IDS`. Iterating production's list would let a sky
  that vanished from the registry pass by not being looked at.
- **`starRampColor`** is shared with `sky-preview.ts`, the dev-only three-panel
  review surface (design | game | design-through-the-game) that made this
  visible, so the design panel and the game cannot disagree about what a
  magnitude looks like. Production reaches the same table through `STAR_LAYERS`.

**a0-44 adds four more of the same kind, and the reason is sharper than the three
above** (2026-08-14):

| Export | Verdict |
|---|---|
| `src/art/mockup-reference.ts#haloRadiusOf` | SURFACE — the rule its own data is asserted against |
| `src/art/mockup-reference.ts#haloPeakAlphaOf` | SURFACE — ditto |
| `src/art/mockup-reference.ts#haloKneeAlphaOf` | SURFACE — ditto |
| `src/art/mockup-reference.ts#spikeLengthOf` | SURFACE — ditto |

Two numbers in this file — the star bloom's halo radius and its spike length —
were wrong for a release **while a test asserted each of them**, because what the
test asserted was that the constant equalled the constant someone had typed. The
design states both as *rules* (`5 + 13 × intensity`; `haloRadius × 0.62`), and
those two rules are why the halo cannot be narrower than the cross it contains —
which is precisely what shipped, and what the developer photographed.

So the rules are exported and `backdrop.test.ts` asserts the data against them.
Production reads the **values** and must: they are the design's committed
numbers, and a `mockup-reference` whose values were computed at import time would
be a file that can no longer disagree with the design — the same reason
`MOCKUP_GROUND` is not imported by production above. The rules are the half of
that comparison CI holds.

**a0-45 adds one, and takes one away** (2026-08-14):

| Export | Verdict |
|---|---|
| `src/art/mockup-reference.ts#STAR_TEMPERATURE_COLORS` | SURFACE — the allow-list's own oracle |
| `src/art/mockup-reference.ts#starRampColor` | **dropped** — deleted with the magnitude ramp |

`starRampColor` is gone from the allowlist because it is gone from the file: the
design colours a star from its **temperature**, not from its magnitude, and a
colour ramp left standing beside a temperature is how the old behaviour survives
a fix.

`STAR_TEMPERATURE_COLORS` is the one place in the art where a colour is a
*continuous function* rather than a member of a set. `starColorFor(temp)` paints
about 117 distinct hexes across the design's two branches, none of them one of the
six or a declared shade of one, so `./palette`'s `ALLOWED_COLORS` cannot hold
them and the audit had to learn what a star colour *is*. This is that function
enumerated over the design's own domain, and its only reader is `compliance.ts` —
which is itself SURFACE for the same reason as the four exports above it: a
linter, run by specs (§4.4a). Production paints `starColorFor(temp)` directly and
must, because the set exists precisely so that a hand-edited star hex still fails
the audit rather than being whatever someone typed.

**One thing for the tool's owner, not a request:** the scan now names
`sky-preview.ts` in its unclassified-directories warning alongside `content/`. It
is a root-level dev-server module — `vite build`'s default input is `index.html`
alone, so it is not in the bundle — and it is deliberately unreachable from
`main.ts`, exactly like the `evidence/` scripts in §4.4(a). It needs no entry
point; if `roleOf()` ever grows a *dev-surface* bucket, this belongs in it.

## 5. Should it gate CI? Yes — and here is the number

**It ships as a gate**, `npm run dark-matter:check`, in the `ci` job. It fails on
a NEW dark export only; the 278 triaged above sit in the allowlist and fail
nothing.

The question that decides whether a gate is worth having is how often it fires
and how often it is *right*. Measured, rather than guessed, by running the scan
at three points on `main` and diffing the candidate sets:

| Span | Merges | New dark exports the gate would have failed on |
|---|---:|---:|
| `11659df` (Aug 2) → HEAD | 99 | 65 |
| `08c00ac` (Aug 8) → HEAD | 50 | 31 |
| `7e175ac` (Aug 9) → HEAD | 6 | 0 |

So roughly **one every other merge**, arriving in clusters (a PR that adds seven
`flow*` functions trips it once, with seven names). Of the 65 in the week-long
span, **23 carry a DARK verdict above** — genuine findings, each catchable the
day it landed instead of five retractions later. The other 42 are
SURFACE-by-pattern: a spec-asserted invariant or a tuning constant, where the
correct response is one allowlist line with a reason. The 50-merge span splits
13/18 the same way.

That ratio — about a third actionable — is why it gates rather than merely
reports. A check that is right a third of the time and costs one line to answer
is worth keeping; the cost of being wrong the other two-thirds is a line of
JSON, and the cost of not having it is `matchAbundance`, five times.

Two things keep it from becoming noise nobody reads:

- **It ignores `self-used`.** 826 value exports are called by their own module.
  They would have been 75% of the gate's output and 0% of its value.
- **Stale allowlist entries are a note, not a failure.** When production starts
  calling something on the list, `--check` says so and stays green. Failing a
  build because someone *fixed* dark matter is how a check gets disabled.

And the third, which is why `--audit` (a1-14, §4.0) is **deliberately not a CI
step** next to it: `--audit` has a standing hit today — `vec.ts`, whose row is
*correct* — and it will keep printing for as long as that file holds four dead
members. A step that is amber every run, forever, teaches people to skip the
window the real gate's output appears in. It is run by hand when this document
is edited, or before a DEAD verdict is acted on, and it always exits 0.

## 6. What it cannot see

Stated so the report is read at the right strength:

- **String-keyed dispatch.** A handler reached through a registry, a
  `Record<string, Fn>` built elsewhere, or a computed `import()` resolves to no
  identifier and reports dark. False positive; triage catches it.
- **A production tree it does not know about.** This bit already: `allocator/` is
  a third deployed app that imports `signTicket` and `verifyFleetRequest` from
  `src/net/`, and until it was added to `roleOf()` the scan called the fleet's
  request-signing dark while the control plane called it on every request. The
  tool now names unclassified directories in every report for exactly this
  reason. (It currently names `content/`, which is JSON and contributes no
  references.)
- **Reachability is static.** A module reached only through a dynamic import
  with a computed specifier reads as an orphan.
- **A caller that is not TypeScript.** `index.html` is a front door too, and
  since u14-01 it opens **two**: its inline entry script imports
  `src/ui/font-boot.ts` and awaits it before it dynamically imports
  `src/main.ts`, so the font boot gate runs on every boot of every build while
  the scan sees no caller for it at all. The fix has two halves and both are
  needed. `src/ui/font-boot.ts` is now in `DEFAULT_ENTRIES`, which makes
  everything *beyond* the door live — without it `RATIFIED_FACES`, the table of
  the two self-hosted typefaces the page actually loads, reported dark while
  running on every load. The door's own export (`awaitRatifiedFaces`) is then
  unreachable by construction, because the only thing that calls it is HTML, and
  that one is allowlisted. **This is the same shape as `allocator/` above:** a
  real production caller the scan's model did not contain. Adding an entry point
  is the fix; allowlisting the whole module would have hidden the table behind
  the door.
- **It says nothing about whether a called thing is *correctly* called.** It
  finds "nobody calls this", which is one bug shape, not all of them.
- **It cannot check the triage, which is the half a human writes.** §4.0 is the
  demonstration: the scan resolved five live call sites in a module this document
  then recommended deleting. `--audit` catches the one shape that mistake leaves
  in the allowlist — a DEAD verdict beside symbols in a file with live exports —
  and nothing catches a wrong DARK or a wrong SURFACE. §4.4's own warning ("the
  section most likely to be wrong") should now be read at full strength: the one
  section that *was* checked one row at a time still shipped a wrong row.
