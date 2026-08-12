# a0-30 — Tap Commander and Auto-aim are the default on every platform

Branch: `agent/platform/a0-30-defaults-everywhere` · Lane: Platform Engineer

**The ruling, and it is not a question:** *"is tap commander and auto aim default
on all platforms it should be"* … *"I already said BOTH"*. Both defaults, every
platform. Do not re-litigate it (LESSONS §17); do not "restore" the per-platform
split in a later pass because §2.4 used to say so — §2.4 has been amended.

---

## BUILT

- **`src/platform/actions.ts`** — `defaultFireMode()` is Auto-aim, everywhere, and
  lost its `isTouch` parameter (a parameter the answer no longer depends on invites
  the split back in). Added `DEFAULT_FIRE_MODE` and `readStoredFireMode(stored)` —
  the "read before you default" resolver, so the storage rule is unit-tested
  instead of trapped in the bootstrap.
- **`src/main.ts`** — `readFireMode(platform)` delegates to that resolver;
  `readControlScheme(platform)` defaults to `DEFAULT_CONTROL_SCHEME = 'tap'` and
  reaches that default **only** for an absent/unrecognised key. A saved `sticks` or
  `tap` is still decoded by the UI's own round trip.
- **`src/ui/lobby-flow.ts`** (brief-authorised, UI's lane) — `createFlow()` seats
  `defaultFireMode()` + `'tap'`, so the flow seam cannot disagree with the boot path
  about what a fresh player starts in. Its own test updated to toggle *away* from
  the new default.
- **`src/platform/input-parity.test.ts`** — the gamepad column now folds Manual
  **and** the new default from the same pad frame. Parity is about what a device can
  reach, not what it starts in: **auto-aim everywhere must not become auto-aim
  only**, and that is what this line now holds.
- **Seam + evidence** — `window.__mainMenu.settingsRows` reports what each settings
  row *says* (label + value, from the same `settingsModel` the view draws, into
  reused records so an open settings screen allocates nothing).
  `tests/live-stage/a0-30-defaults.spec.ts` reads it back on desktop, on touch, and
  with a pad connected, plus a saved-preference boot.
- **Docs** — `docs/design-amendments.md` (new top entry, including the ⚠ OPEN
  conflict below) and `GDD.md` §2.4 (two sentences retired, header marked) + §5.7's
  settings-row note.

Commits: see `git log` on the branch; each of the above is its own commit.

## DECISIONS (and what was rejected)

- **The CONTROLS row needed no wording change, and that is a finding, not an
  omission.** `controlsValue()` already lets the *scheme* decide first, and
  `TAP COMMANDER` is true on every device (a tap is a tap from a finger or a mouse).
  Rejected: renaming the row for the tap scheme per device — there is nothing
  device-specific to say, and inventing something would re-open exactly the u8-01
  lie. What *was* added is the assertion: the row's words are now read off a booted
  client on three device profiles instead of reasoned about.
- **`parseControlScheme` (UI) left alone.** It folds everything unrecognised to
  `'sticks'`, which is no longer the default — the honest single-source fix is one
  line in `src/ui/settings.ts`, but `settings.test.ts` pins that behaviour
  deliberately and it is another lane's ratified rule. So `main.ts` distinguishes
  *saved* from *absent/stale* itself and the boot path is correct either way. Flagged
  for UI in the PR; its doc comment's phrase "folds to the default" is now imprecise.
- **`src/ui/settings.ts`'s `STICKS_LABELS` doc comment** still calls the sticks "the
  default scheme". Not edited (UI's lane, comment only) — flagged in the PR.
- **Storage strings untouched.** `sticks` / `tap` still persist as themselves. A
  save from any earlier build still means what it meant; renaming them would seat an
  unknown scheme for everyone who has already chosen.

## ⚠ OPEN — the desktop conflict, reported not resolved (brief item 5)

**Tap Commander and the `WASD` thrust binding do not both work, and Tap Commander
is now what a first-run desktop player gets.** In the tap scheme the pilot replaces
the sticks: `sampleInput` zeroes the devices' thrust/aim/fire and writes the
pilot's. So `W` does nothing while the controls strip still reads `Thrust · WASD`
(`describeBindings` takes a device and a fire mode, never a scheme). `E` → Build is
**not** affected (`merged.build` is left as the devices wrote it).

Nothing was silently dropped or re-bound. Two candidate resolutions are written up
in `docs/design-amendments.md` ("The one conflict") for the Director: **thrust takes
the wheel back** (a real thrust input drops the standing order) or **the strip reads
the scheme**. Until one is ratified the build behaves exactly as Tap Commander
always has; only how many players meet it first changed.

**Corollary that costs test time:** every spec that drove the ship with `W` under
`?debug=1` was implicitly relying on the sticks default. Those specs now have to
*ask* for the sticks (pre-seed `planet-rush:controlScheme`), and that is worth
knowing before debugging one: a dead `W` in a harness run is this change, not a
broken loop.

## NEXT

- Full `npx tsc --noEmit` + `npx vitest run` green, mobile (CI) Playwright suite
  green, live-stage evidence captured, PR opened with the four evidence screenshots.
- Cross-lane follow-ups to flag, not to fix here: `src/ui/settings.ts`'s
  `parseControlScheme` / `STICKS_LABELS` comments, and `src/net/session.ts`'s
  `options.fireMode ?? 'manual'` protocol default (harmless today — the client
  always sends the field — but it is a third fire-mode default in the tree).
