# a0-33 — the tutorial teaches a scheme the player may not be using

Branch: `agent/ui/a0-33-scheme-aware-onboarding`. Owner: UI Engineer.

The developer: *"if we are using tap commander we need tutorials for it… we need
control specific tutorials and device specific, but also need to teach people
they can change settings to their desired preference."*

`a0-30` made **Tap Commander + Auto-aim the default on every platform**, so the
first sentence a new player reads — *"Hold {fire} on the asteroid"* — described a
gesture their configuration does not have.

## BUILT

- **`c687371` — the red test.** `resolvePromptText(PromptId.Mine, …, 'tap')` must
  not say "hold". Watched fail first (LESSONS §24):
  `AssertionError: expected 'Hold Left mouse on the asteroid — you…' not to match /hold/i`.
- **`4258403` — the fix.** `src/ui/onboarding.ts` now branches the LESSON on
  `(scheme, mode)` and still fills the KEY from `describeBindings` — the action
  layer is extended, not replaced. `PromptCopy` requires all three wordings
  (`manual` / `autoAim` / `tap`), so a prompt that forgets Tap Commander cannot
  compile. Adds the fifth prompt (the settings tip). Wires
  `HudFrame.controlScheme` (required, beside `device`/`fireMode`) through
  `src/ui/hud.ts`, fed by `src/main.ts` from the live `controlScheme`.
  `hud-geometry.test.ts`'s authored-prompt sweep walks both schemes now.
- **`evidence/a0-33-scheme-aware-onboarding/readback.{ts,json}`** — the readings
  under all 60 configurations (5 prompts × 3 devices × 2 modes × 2 schemes), the
  same sentences laid out on a 390 px handset, and two trigger walks (the first
  match with two mid-match scheme switches; the settings tip's dwell).

## DECISIONS

- **The scheme is a required argument, not an optional one.** The default scheme
  moved under this module's feet once already (a0-30). A caller that forgets it
  would go on quietly teaching whichever scheme the file guessed — that is the
  bug, not the fix. Same reasoning for `HudFrame.controlScheme` being required.
- **`import type { ControlScheme } from './settings'`** — type-only, so the pure
  module's runtime graph stays empty (settings.ts pulls in art/gantry). Rejected:
  a second `ControlScheme` union here (drift), and moving the type to
  `@shared/types` (a ratified contract; not mine to change unilaterally).
- **All three wordings required, even where identical.** SPEND and UNDER-ATTACK
  repeat one sentence three times. An optional field that fell back to the stick
  copy is exactly how a prompt silently teaches the wrong scheme.
- **Tap Commander ignores the fire mode.** The pilot writes thrust, aim AND fire
  (`@platform/tap-pilot`), so once you are in it the fire mode has nothing left
  to say about how a rock gets mined. One `tap` string per prompt.
- **Auto-aim keeps the press, drops the aiming.** §2.4 is explicit that the
  player still decides *when* to fire; only *what* is automatic. So the a0-33
  auto-aim copy still names the fire binding and swaps "on the asteroid" for
  "near the asteroid — auto-aim does the aiming". (The developer's phrasing —
  *"you don't need that with auto aim"* — reads as though auto-aim also
  auto-fires; it does not, per §2.4. Flagged in the PR.)
- **A prompt on screen when the setting changes RE-WORDS on the next frame.**
  The HUD resolves the text every frame from the live frame values. An
  instruction has to describe what the player can do now; a stale one is the
  whole bug. Rejected: freezing the wording for the life of one showing.
- **The settings tip retires on a DWELL (8 s of *shown* time), not on "settings
  opened".** The HUD cannot see the settings screen (different screen, wiring
  layer's), and a tip that waits for a screen the player may never open nags
  every match forever — which is what §2.10's "never appear again" forbids. The
  dwell counts only frames where the tip is the prompt actually shown, so a siege
  cannot burn it unread, and a backwards clock (a rematch resetting `world.time`)
  contributes nothing.
- **The tip fires only after one whole loop** (MINE and HAUL-HOME both learned)
  and sits last in `PROMPT_ORDER`. It may never take the band from a lesson.
- **New copy is flagged, not smuggled.** GDD §2.10 has words for Sticks+Manual
  only; every other sentence is marked `NEW (a0-33)` in the evidence and listed
  in the PR for the developer to approve.

## NEXT

- Full `npx vitest run` + `npm run dark-matter:check` green, then push and open
  the PR with the readings table and the new-copy list.
- Not done, deliberately: no GDD/`docs/design-amendments.md` edit — those are the
  Director's to ratify, and the PR is where the copy is proposed.
