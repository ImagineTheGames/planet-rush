# a0-100b — FIRE MODE is locked under Tap Commander

What is here, and what each frame is for. Captured from the app's own production
bundle (`npm run build` → `npm run preview`) on its own port, driven through the
front door: every press lands at the physical point the client reports drawing
that control at.

    npx playwright test --config evidence/a0-100b-fire-mode-locked/playwright.config.ts

Two profiles, because "on a phone and a desktop" is two claims — the developer's
own 798x384 landscape phone (where the screen wraps into two columns and a row is
372px wide) and the golden suite's 1280x800 desktop control. Both at dpr 2: the
finding is that the row reads as *unavailable before it is pressed*, and a 1x
frame is a frame whose greys have to be taken on trust.

| Frame | What it shows |
|---|---|
| `1-locked-tap-autofire` | The shipped default. FIRE MODE reads `AUTO-FIRE`, its label and value dim, beside five rows that are not. |
| `2-help-panel` | The `?` panel on that row — where the lock keeps its reason (p4-03). |
| `3-after-one-press` | The screen after ONE press on the row. Identical to frame 1: that is the deliverable. |
| `4-sticks-live-autoaim` | CONTROLS switched to the sticks. The same row, live and bright, reading `AUTO-AIM`. |
| `5-sticks-manual` | One press there → `MANUAL`. The control for the frames above: the harness can move this row, so frame 3 is about the lock and not about the capture. |

`*-rows.json` is the readback — the model's own `label` / `value` / `disabled`
for all six rows at each of those points, plus the open panel's title. It is a
CROSS-CHECK, never the finding: if it and the image ever disagreed, the image
would win and the disagreement would be the story.

The measurement that put this brief here is a0-96's, not repeated: one press on
this chip under Tap Commander moved **0 pixels of 4,096,000** of a frozen match
frame, against a null re-shot that proved the capture honest, where the same
press on the sticks moved 18,935 (`evidence/a0-96-settings-screen`).
