# a0-100c — SETTINGS does not belong on the doors screen

Developer, 2026-08-19, from the CAMPAIGN / SOLO / HOST / JOIN screen:

> *"there should not be a settings button on this page, the settings page was
> literally in the main menu one page up... it should be there and pause menu
> only..."*

---

## 1. The verdict: **the button navigated.** The map was wrong.

The brief asks which of two things is true, and says the answer decides whether
anything else has to move. It is the first: **a real route that `NAV_EDGES`
never recorded.** The chain, established before anything was deleted:

| step | file | what it does |
| --- | --- | --- |
| the rect | `lobby-geometry.ts` `entryLayout` | a `beamPlate` at the footer beam's trailing end |
| the hit | `lobby-geometry.ts:1956` `entryHitTest` | returns `{ kind: 'settings' }`, home screen only |
| the handler | `main.ts:9281` `applyEntryTarget` | `ctx.cue('press'); openSettings()` |
| the move | `main.ts:9725` `openSettings` | `screen = 'settings'` |

`lobby-flow.ts:452` also had a `case 'settings'` — **a deliberate no-op** (a0-95).
That is what makes this look like dead chrome on a first read, and it is not the
live path: the doors screen is wired directly in `main.ts`, not through the flow
seam. Reading only the flow would have produced the wrong answer to the brief's
question.

**Proven in the running production bundle, not just read:** `shots/*-before-*`.
The capture presses the plate and asserts where it lands — `__mainMenu.screen`
becomes `settings`.

### The second finding, which argues the developer's case again

`closeSettings()` (`main.ts:9730`) sets `screen = 'menu'` **unconditionally**.
There is no return-to-whence-you-came. So the full shipped behaviour was:

    doors --SETTINGS--> settings --DONE--> MAIN MENU

The button never came back to the doors. It relocated the player one screen
further out than where they pressed — a disguised "leave the doors, via
settings". `shots/*-before-3-done-lands-on-main-menu.png` is that frame.

This is also what settles *"whether anything else has to move with it"*:
**nothing does.** The `settings → main-menu via DONE` edge already in the graph
stays exactly true after the deletion.

---

## 2. Every menu control, checked against `NAV_EDGES`

The brief asks for the whole enumeration, because this is the first time the
graph has been checked against the screens rather than trusted. Controls are
read from each screen's hit-test target union — the set the code can actually
produce, so a control cannot be missed by being forgotten.

Legend: **✓ edge** = recorded in `NAV_EDGES` · **· edgeless** = navigates
nowhere · **⚠** = the audit found something.

| screen | control | result |
| --- | --- | --- |
| **title-gate** | a press (operate the door) | ⚠ **WHOLE SCREEN MISSING** → node + edge added |
| | `Escape` (reseal, top level only) | ⚠ added |
| **main-menu** | PLAY / SETTINGS / CODEX / HANGAR | ✓ edge ×4 |
| **online (the doors)** | **SETTINGS** | ⚠ **NAVIGATED, NO EDGE — deleted by this PR** |
| | SOLO / HOST / JOIN / BACK | ✓ edge ×4 |
| | CAMPAIGN | · edgeless, already recorded (the teaser) |
| **online-keypad** (code) | JOIN (submit) / BACK | ✓ edge ×2 |
| | pad keys, ERASE | · edgeless — now recorded |
| | mode switch CODE ⇄ BROWSE | · edgeless (same node) — now recorded |
| **online-keypad** (browse) | a listing row | ⚠ navigated, affordance unnamed → edge added |
| | BACK, mode switch | ✓ edge / · edgeless |
| **settings** | DONE | ✓ edge |
| | FIRE MODE, CONTROLS, REDUCE VFX, 3 × volume ∓, 6 × `?` | · edgeless (in-screen values / help panel) |
| **codex** | BACK | ✓ edge |
| | tabs, entry rows | · edgeless |
| **hangar** | BACK | ✓ edge |
| | cosmetic rows | · edgeless, already recorded ("the hangar is a leaf") |
| **lobby** / **lobby-online** | BACK, ship card, arena card, RUSH | ✓ edge ×4 (RUSH flagged `startsMatch`) |
| | seat body, seat state, team chip, MODE, ABUNDANCE, CLAIM | · edgeless (in-screen edits) |
| | seat `?` | · edgeless — opens the codex **dossier overlay** in place, not the codex screen |
| | room code | · edgeless — a label, hit-testable, no-op by design |
| **ship-select** | BACK, hull tiles | ✓ edge ×2 |
| **map-select** | BACK, arena cards | ✓ edge ×2 |
| **match** | pause button / `ESC` | ✓ edge |
| **pause** | RESUME / SETTINGS / EXIT TO MENU | ✓ edge ×3 |
| **pause-settings** | BACK | ✓ edge (rows as per settings) |
| **pause-confirm** | LEAVE / STAY | ✓ edge ×2 |
| **end-over** | BACK TO MENU / REMATCH | ✓ edge ×2 |
| **end-eliminated** | SPECTATE / REMATCH | ✓ edge ×2 |

Also examined and correctly absent: the **region picker** on the doors
(`regionPickerVisible` is `false` in the shipped single-region config and it has
no rect in `entryLayout`, so it draws no control), and the in-match
**connection-status dismiss**, which is an overlay rather than a menu screen.

**Three findings from one audit.** One control navigating with no edge (deleted),
one navigating under an unnamed affordance (edge added), one whole screen absent
from the map (node added). Everything else was either recorded or is genuinely
edgeless, and the edgeless ones are now written down rather than left to be
noticed — which is the rule the file's own header already stated for CAMPAIGN.

---

## 3. The footer is **not** rebalanced

BACK is bolted to the beam's **leading** end on both the doors and the keypad —
*"it must not move as the screen changes under it"* (u2 menu-back), stated in
`entryLayout`'s own comment. Centring BACK to fill the gap would make it jump
back to the leading end the moment JOIN drew ERASE beside it, so the beam is
left as it is: one plate, where it always was. The squeeze factor is solved
against the three-plate keypad case (BACK + ERASE + JOIN) and never counted
SETTINGS, so **no other plate moves by a pixel.** Nothing replaces it.

---

## 4. Running it

    A0_100C_MODE=before npx playwright test --config evidence/a0-100c-settings-two-places-only/playwright.config.ts
    A0_100C_MODE=after  npx playwright test --config evidence/a0-100c-settings-two-places-only/playwright.config.ts

`before` only passes against a tree that still has the button; `after` only
passes against one that does not. Its own port (4301), because the lanes share
this box and 4173 may be serving another lane's bundle.

Two profiles, both already used by a0-100b: the phone is the developer's own
screenshot size (798×384 landscape), the desktop is the golden suite's control
width (1280×800), `dpr: 2` on both.

### Why the press point is computed rather than read from a seam

It cannot be read from one. `__onlineMenu.doorControls` reports the four doors,
the join segments and BACK — **and not SETTINGS.** The live-stage seam had the
same hole in it as the nav graph. So the point is mirrored from BACK about the
canvas centre (both are `beamPlate`s on one strip with one gutter), and **every
press asserts the screen it lands on**, so a missed press fails the run instead
of quietly producing a frame that says what the author hoped. That is how the
first run caught its own bug: "physical" in this codebase means un-rotated page
space (`logicalToPhysical` is the identity when unrotated), not device pixels.

---

## 5. The goldens were hiding this change

`desktop-doors` and `phone-landscape-doors` **passed** against a screen that had
visibly lost a button, and `--update-snapshots` rewrote nothing, because from its
point of view they still matched. `GOLDEN` is `{ maxDiffPixelRatio: 0.01 }` and
the SETTINGS plate is ~7,600 px of a 1,024,000 px desktop frame — about 0.74%,
under the 1% tolerance.

Both baselines were deleted and regenerated to force a true rebake, and both now
show the one-plate footer beam. Worth knowing beyond this PR: **any single small
control on a full-frame menu golden sits under that tolerance**, so those
baselines cannot be relied on to catch one appearing or disappearing.
`tests/mobile/` is QA's, so this PR rebakes only what it moved and leaves the
tolerance alone — flagged for the owner rather than changed unilaterally.

## 6. The frames

| | phone 798×384 | desktop 1280×800 |
| --- | --- | --- |
| the doors, before | `phone-798x384-before-1-doors.png` | `desktop-1280x800-before-1-doors.png` |
| the press opens settings | `…-before-2-press-opens-settings.png` | `…-before-2-press-opens-settings.png` |
| DONE lands on the main menu | `…-before-3-done-lands-on-main-menu.png` | `…-before-3-done-lands-on-main-menu.png` |
| the doors, after | `phone-798x384-after-1-doors.png` | `desktop-1280x800-after-1-doors.png` |
| the same press hits nothing | `…-after-2-same-press-lands-on-nothing.png` | `…-after-2-same-press-lands-on-nothing.png` |
| BACK still reaches the menu | `…-after-3-back-reaches-the-menu-where-settings-lives.png` | `…-after-3-back-reaches-the-menu-where-settings-lives.png` |
