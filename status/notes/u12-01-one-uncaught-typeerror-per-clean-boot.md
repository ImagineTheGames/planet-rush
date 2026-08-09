# u12-01 — the one uncaught TypeError on every clean boot

Branch: `agent/ui/u12-01-clean-boot-typeerror` (from `origin/main` @ `7e175ac`).

## BUILT

- `src/ui/shell-lifetime.ts` — the latch a screen shell tears down through.
- `src/ui/shell-lifetime.test.ts` — the failure reproduced headlessly (real Pixi
  `Graphics`, the identical `TypeError`) plus the latch that stops it. 6 tests.
- `src/ui/index.ts` — exports `createShellLifetime` / `ShellLifetime`.
- `src/main.ts` — both screen shells own a latch:
  - **menu shell** (`openMainMenu`): `life.dispose()` first in `teardown()`,
    `if (!life.alive) return;` at the top of `render()`. **This is the fix for
    the captured stack.**
  - **lobby shell** (`openLobby`): same latch, same guard in `render()`, plus
    `showHint`/`hideHint` (the one path that reaches a view without going
    through `render()`) and `clearTimeout` on the long-press timer in
    `teardown()`. Same defect class, one door over — not captured by QA, found
    while auditing the sibling shell.

## DECISIONS

### The cause, resolved from the stack — not guessed

`evidence/a1-05-live-round/readback.json` carries the full stack on two of the
six captures (`lobby-character`, `codex-by-tap-390`); the other four recorded the
message only. Built the bundle locally at `7e175ac` and resolved the minified
frames through the sourcemap (`index-De5ilkwi.js` vs. local `index-DLGgxC9M.js`:
different hash — the Pages build has a different base path — but the same line
249 and offsets within ~1% of each other, and all three frames landed on
mutually-consistent source):

| frame | offset | resolves to |
|---|---|---|
| `X.clear` → `X._callContextMethod` | 242:5209 / 242:2970 | Pixi `Graphics` |
| `z7.update` | 249:16647 | `src/ui/lobby-entry-view.ts:234` — `this.backdrop.clear()` |
| `Q` | 249:228814 | `src/main.ts` `render()` — the `entryView.update(...)` line |
| `jn` | 249:230579 | `src/main.ts` `measureFleet()` — its closing `render()` |

The chain, and every measured fact it accounts for:

1. **PLAY opens THE DOORS** (`activateMenu` → `openDoors`) — the one way in.
   `openDoors` sets `screen = 'online'` and fires `void surveyFleet()`, a
   fire-and-forget network probe of the allocator fleet.
2. The player presses **SOLO / CREATE / JOIN before the network answers**.
   `beginSolo` / `beginRoom` call `teardown()`, which destroys all four menu
   views — `destroy({ children: true })` nulls every `Graphics` context.
3. `teardown()` removed every DOM listener and had nothing to say to work already
   in flight. `screen` is still `'online'`; the closure is still reachable.
4. The probe lands. `measureFleet`'s guards (`screen === 'online'`,
   `entry.screen === 'home' && entry.status === 'idle'`) all still pass, it
   writes the region line into `entry.notice`, and calls `render()`.
5. `render()` sets `entryView.visible = true` and calls `entryView.update(...)`.
   The notice changed, so `./screen-cache` misses, and line 234 —
   `this.backdrop.clear()` — throws on a null context.

- **once per session**: `surveyFleet()` de-duplicates on `regionProbe`, so the
  probe resolves exactly once.
- **never reproducible on demand**: QA's scripted walk used *generous idles* —
  which is precisely what lets the probe resolve while the doors are still up,
  drawing into a live view. The bug needs a player faster than the network.
- **`?debug=1` never threw**: `src/main.ts:838` —
  `const mainMenu = flags.debug ? null : openMainMenu(...)`. Under the harness
  flag **the menu shell is never constructed**: no doors, no probe, no throw.
  Mechanical, not a red herring.
- **the `lobby-badge-and-hangar` capture threw *with* `query=debug=1`** — so the
  brief's "never on a `?debug=1` boot, not once" is slightly overstated by QA's
  own file. It is not a counter-example: EXIT / BACK TO MENU reload to
  `origin + pathname`, **dropping the debug flag on purpose**
  (`exitToMenu`, `src/main.ts:2724`), so that session was on a non-debug page
  with a real menu shell by the time it pressed PLAY. Same cause.
- **the `wave-clock-lobby` capture is `room: "LOCAL"`, offline** — consistent:
  the SOLO path is the one that leaves `entry` at `home`/`idle`, which is the
  only state in which `measureFleet` writes the notice, changes the cache
  signature, and gets past the view's early-out to `clear()`. A CREATE/JOIN in
  flight leaves `entry.status` non-idle, the signature unchanged, and the cache
  swallows the frame.

### Lifetime, not a null-guard

Rejected: guarding `Graphics.clear()`, or making the views tolerate `update()`
after `destroy()`. That is the option the brief warns about and it is the wrong
one — a view that quietly survives its own destruction makes the *next* lifetime
bug invisible instead of loud. `shell-lifetime.test.ts` keeps a test whose whole
job is to fail if that tolerance is ever added.

Rejected: unsubscribing the late callers instead. Not available — a promise
cannot be un-awaited, and `src/net/session.ts` `observe()` returns `void` with no
unsubscribe (and `src/net/` is not mine to change). The latch is the only place
the truth can live without touching another owner's file.

Rejected: a bare `let disposed = false` inline in `main.ts`. Correct, but
`src/main.ts` ends in `void boot()` and cannot be imported, so it would be
untestable. Extracting the seam and testing that is the house pattern — cf.
`src/platform/match-boot.test.ts`.

### Scope

- No behaviour change on any live path. The guard only fires *after* a
  `teardown()`, and every post-teardown `render()` that reached a view before
  this change either threw or was swallowed by the screen cache. Goldens do not
  move; nothing in the a1-05 attested set is touched.
- `src/main.ts` is outside `src/ui/` but is not on the never-touch list
  (`src/sim/`, `src/net/`, `src/bots/`); it hosts the UI shells, and the defect
  is in one of them. Flagged in the PR.

## Session 2 — resume, re-verify, ship

The fix above was committed and pushed but never opened as a PR, and the notes
file in `/status/notes/` was still the blank template. Both fixed here.

- **Merged `origin/main`** (`7e175ac` → `fc567ab`, 4 commits, clean — no
  conflicts). PR **#361** has landed, so
  `evidence/a1-05-live-round/readback.json` is now on main and the branch
  carries it. The stack is no longer second-hand.
- **Re-verified the diagnosis from the evidence, not from these notes.**
  `readback.json` `pageErrors`: six captures carry the message, two
  (`lobby-character`, `codex-by-tap-390`) carry the full five-frame stack
  quoted in the commit. Confirmed at source that the chain is real —
  `measureFleet` (`src/main.ts:6889`) awaits `surveyRegions` and then calls
  `render()` **unconditionally**; its `if (screen !== 'online') return;` guards
  only the notice write, not the draw. `src/ui/lobby-entry-view.ts:234` is
  `this.backdrop.clear()`, the first draw after the screen-cache early-out.
- **Proved the test fails without the fix.** Neutered `dispose()` to a no-op and
  ran the file: **4 of 6 tests fail**, including `is inert once the latch is
  disposed`, which then throws the live `TypeError` for real. Restored; tree
  clean.
- **Both gates green on the merged tree**: `npx tsc --noEmit` clean;
  `npm test -- --run` → **271 files, 4746 tests, all passing** (~582s).

## NEXT

- Nothing blocking. PR opened; DoD is the PR's checks.
- Not done, deliberately: no live-stage re-capture. Proving zero uncaught
  exceptions on a real clean boot is QA's round to run, and the race needs a
  human-speed walk that their scripted one cannot produce. The headless test is
  what this lane can honestly attest to.
