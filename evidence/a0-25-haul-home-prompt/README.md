# a0-25 — the onboarding taught a mechanic the game no longer has

Evidence for `agent/ui/a0-25-haul-home-prompt`. Every frame is a **live boot of
the built bundle** (`npm run build && vite preview`, headless Chromium,
`?debug=1`), captured by `tests/live-stage/haul-prompt.spec.ts`. Nothing here is
a render model or a mock: the string in each picture is the string
`Hud.debugOnboardingPrompt()` reports having drawn on that same frame, and the
prompt fired through `Onboarding.update` off live sim cargo.

## The frames

| | |
|---|---|
| `before-desktop-haul-prompt.png` | `Hold full — fly home and press E` |
| `after-desktop-haul-prompt.png` | `Hold full — fly into your collection field to bank, then press E to spend` |
| `before-phone-landscape-haul-prompt.png` | `Hold full — fly home and press BUILD` |
| `after-phone-landscape-haul-prompt.png` | `Hold full — fly into your collection field to bank, then press BUILD to spend` |
| `after-phone-portrait-haul-prompt.png` | same sentence, 390×844 held upright (the client rotates its stage into landscape) |

**Disclosure on the "before" pair.** It is this branch with **only**
`src/ui/onboarding.ts` reverted to `main`'s copy — the read-back seam has to
exist for the capture to state what was drawn rather than what it looks like.
Nothing else differs; the build stamp in the corner reads `9f4f602*` (the `*` is
the dirty marker for that one reverted file).

## What the pair proves, and what it does not

**Proves:** on `main` the second prompt a first-time player meets told them to
*fly home* — dock-and-park banking, retired by the 2026-07-27 amendment (GDD
§2.3: the hold drains inside your own collection field, no docking, no parking).
The frames after the fix carry §2.10's amended sentence, verbatim.

**Does not prove — and worth saying plainly:** the phone was **never** saying
"press E". The `{build}` token was already doing its job, which the
`before-phone-landscape` frame shows: it read "press BUILD" while still teaching
the wrong mechanic. The brief's stated fear was a real risk of the fix (§2.10's
sentence contains the literal words "press E"), not a bug that already existed —
so the fix keeps the token and the phone frames are the check that it held.

## Length is part of clarity (GDD §4.7)

The amended sentence is 41 characters longer than the one it replaced, and
`docs/gdd-conformance.md` asked for it to be measured rather than assumed. It is,
in the spec, on the narrowest handset in QA's matrix — drawn width against the
band's own wrap width, both read off the live Pixi text:

| Frame | drawn width / wrap width | drawn height | verdict |
|---|---|---|---|
| desktop 1280×800 | 808.3 / 904.0 px | 19 px (1 line) | fits |
| phone landscape 844×390 | 363.5 / 374.0 px | 28 px (2 lines) | fits |
| phone portrait 390×844 | 363.5 / 374.0 px | 28 px (2 lines) | fits |

(Logical units — the phone shoots at dpr 3, so the picture is 3× these numbers.
The two phone rows agree because the client rotates a portrait stage into
landscape; they are still two boots, and both were shot.)

No ellipsis on any device; the prompt clears the controls strip on desktop and
the FIRE button and minimap on the phone. The band and its clipping are `a0-24`'s
and were not touched — this changed a string.

## The other three prompts

Diffed against §2.10 in the same pass. `SPEND` and `UNDER-ATTACK` match the GDD
word for word. `MINE` does not — and it is **deliberately left alone**; the two
ratifications disagree with each other, which is a Director call, not a lane's.
The reasoning is in the PR body and in
`status/notes/a0-25-the-onboarding-teaches-the-old-game.md`.
