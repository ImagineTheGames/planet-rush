# u13-01 — the hub you see is not the hub you press

Branch: `agent/platform/u13-01-hub-hit-matches-hub-drawn`
Owner: Platform Engineer. Files touched: `src/platform/wheel-input.ts`,
`src/platform/wheel-input.test.ts`, `evidence/u13-01-hub-hit/`. **No file outside
`src/platform/` was edited** — see DECISIONS, the brief's cross-team authorisation
turned out not to be needed.

## BUILT

- `8682cad` — **test(u13-01): press the drawn hub's rim — RED, it buys a segment.**
  The evidence commit, deliberately failing on `main`'s geometry (LESSONS §24).
  Three new cases in `src/platform/wheel-input.test.ts`:
  - presses at **0.305r and 0.315r on all four axes** must read `hub`;
  - the boundary from both sides — **0.318r `hub`, 0.321r `segment`**;
  - the same boundary read off the profile table at **r = 80, 140, 188, 235, 400**,
    which is the case a copied constant cannot pass.

  Red run captured verbatim at `evidence/u13-01-hub-hit/red-before-fix.txt`:
  `3 failed | 21 passed`, every failure `expected 'segment' to be 'hub'`.

- `57efa74` — **fix(u13-01): the hit-test reads the hub the wheel is DRAWN with.**
  `INNER_FRACTION = 0.3` deleted; `hubRadius(radius) = radius * wheelMetrics(radius).hub`
  in its place, and `hitWheel` uses it. 24/24 green.

Gates, all run locally on `57efa74`:

- `npx tsc --noEmit` — clean.
- `npm test -- --run` — **274 files, 4786 tests, all passing.**
- `npm run dark-matter:check` — no new dark exports (278 known, unchanged: the
  new `hubRadius` export is read by `hitWheel` and by the spec).

## DECISIONS

**The number was not where the brief said it was, and that changed the fix for
the better.** The brief points at `src/ui/build-wheel-view.ts:193` — "a 150 px hub
inside a 470 px disc" — and authorises editing that file to export the number.
That line is a *comment*. The number itself lives in `src/art/materials.ts` as
`WHEEL_PROFILES.{desktop,phone}.hub`, and the view reads it through
`wheelMetrics(r)` (`build-wheel-view.ts:543`, `const inner = r * m.hub`). So the
shared home the brief asks for **already exists**, and the fix is one import in my
own file. The cross-team edit was authorised and turned out to be unnecessary —
nothing outside `src/platform/` is touched, so there is nothing here for the
Director to arbitrate that they have not already ratified.

**It is not a constant, and could not have been.** `wheelMetrics` interpolates:
`hub` is **0.32** at the phone reference (r = 140) and **0.319** at the desktop one
(r = 235), mixed in between and held flat outside. Had I taken the brief's literal
target and exported a single `0.319`, the hit-test would have been wrong on a
phone — the exact device the brief calls this worst on — on the day it was
written. This is the strongest argument against the trap the brief names: the
mirror is not merely *liable* to drift, at two profiles it is born drifted.

**Rejected: nudge `INNER_FRACTION` to 0.319.** The brief's named trap, and a1-09
deleted `HUB_FRACTION = 0.22` from this same module for being that mirror.

**Rejected: import `src/ui`.** It would be a cycle — `src/ui` already depends on
`@platform` — and the module header says so.

**Rejected: a new home under `src/shared/`.** `src/shared` is ratified contracts;
adding to it to relocate a number that already has a working shared home would be
a unilateral contract change to solve nothing.

**Accepted: `src/platform` → `src/art/materials`.** Checked before taking it:
`materials.ts` imports only `./palette`, which imports only `./tokens`, which
imports nothing. No DOM, no PixiJS, no `src/sim`, and **no `@platform`**, so no
cycle. `src/platform` already reaches across for `@render/index` (`touch-visuals.ts`)
and `../sim`, `../net`, `../bots` (`match-boot.ts`), so this is not a new kind of
edge. Read-only: no art file is edited.

**The a1-09 assertion that moved, and why it was not a silent flip.** That guard
asserted `0.31r → segment` as "the first ring radius outside the hub, so this is
pinning a boundary rather than a wheel that refuses every press." 0.31r was never
outside the hub — it sat *inside* the disputed 0.300–0.319 band, i.e. inside the
painted disc, and it recorded what the code did rather than what the wheel showed.
It is the bug the guard was written beside, not a second guard. So: the intent
moves out to **0.33r**, on the ring under every profile, and 0.31r's new answer
(`hub`) is pinned by name. The reason is written in the test body, not only here.
The four presses a1-09 actually meant — 0, 0.10, 0.22, 0.29r — are untouched and
still miss.

**Nothing drawn moved.** No `src/ui` or `src/art` file is edited, so the mobile
golden suite has nothing to re-baseline. The hit boundary moved onto the paint;
the paint did not move — which is the brief's own test for having gone too far.

**Worth knowing for whoever picks up the neighbouring bug.** `src/main.ts:1733`
and `:1779` route *both* wheels' presses through `hitWheel`, so this fixed the
upgrade wheel's rim at the same time — the annulus there bought a *track*. The
hub also carries a PixiJS BACK tap surface drawn at the true `r * m.hub`
(`build-wheel-view.ts:721`), which is the other half of why the band read as hub
to the player: it was painted hub, it registered a hub-sized affordance, and only
the hit-test disagreed.

## NEXT

Nothing outstanding on the brief's scope. Remaining: PR review, and CI green
(the same three gates above plus `npx vite build` and the mobile golden job,
which this change gives nothing to move).

No blockers. Nothing here needs a Director call.
