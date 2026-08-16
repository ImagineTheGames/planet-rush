# a0-62 — the star bloom, reproduced off the developer's own surface

Fifth report on this element, and the first that **reproduced the absence before
concluding anything**. The developer, on the live build `bb6f283`:

> *"what you are showing as 'game today' is false. there is no glowing bloom
> around the stars, heres a foto that shows actual game today, so i dont know how
> the agent keeps messsing it up"*

They were right, and this round says why — including why four correct fixes
changed nothing a player could see.

## The short answer

**The falloff ramp was premultiplied twice.** Every soft fill in the game —
every star halo, every nebula body, every station glow — painted `f²` where the
design says `f`. That is not a dimmer halo, it is a different curve: at the
design's own knee it keeps under a third of its ink, and the whole outer half of
every star's glow falls under one 8-bit code value. The star's point and its
diffraction cross are a flat fill and a stroke, neither of which samples the
ramp, so they survive untouched. That is the developer's photograph.

Read back off the GPU of the running client (`probe-ramp.mjs`):

| ramp texel authored | correct boot order | the collapse | a²/255 |
|---|---|---|---|
| 203 | 203 | **161** | 161.6 |
| 154 | 154 | **93** | 93.0 |
| 68 | 68 | **18** | 18.1 |
| 21 | 21 | **1** | 1.7 |

## Why it took five rounds

`UNPACK_PREMULTIPLY_ALPHA_WEBGL` is **global GL state**. pixi 8.6.6 sets it in
exactly one place — `glUploadImageResource`, for image and canvas sources — and
`glUploadBufferImageResource` never touches it. The ramp was a
`BufferImageSource` carrying already-premultiplied texels, so it inherited
whatever the last upload left behind:

- a page with fonts, atlases and a build badge (**the game**) leaves it TRUE, and
  the ramp is premultiplied a second time;
- a page with no image texture at all (**`field-probe`, `renderer-probe`,
  `sky-preview`, the unit suite**) leaves it FALSE, and the ramp is correct.

Every instrument this repo had was in the second column. That is the whole of
a0-22, a0-44, a0-45 and a0-53 measuring correctly on a broken game.

## What the variable is NOT — each disproved by measurement

- **deviceScaleFactor.** The real app shell was driven at 1, 1.5, 2 and 3. All
  four collapse identically (median reach/design 0.690, 0.690, 0.695, 0.695).
  `main.ts:793`'s `resolution` and `main.ts:1420`'s baker resolution are not it.
- **The build configuration, and a0-53's control.** a0-53 concluded the defect
  was "in the app shell and its build" because the same `index.html` built by
  its probe config drew the design's radius. **That does not reproduce today:**
  that bundle is collapsed too (0.690), while `renderer-probe.html` inside the
  SAME bundle is correct (0.908). The control was measuring the absence of image
  textures on the probe page, not the build.
- **`configure()`'s rebuild path**, frame count, `document.fonts.ready`, the
  scene contents, filters, render groups, `cacheAsTexture` — all measured, all
  ruled out (`audit.txt`, `scene.json`).

The two boot orders differ by **one early DOM query** and nothing else, and they
reproduced **6/6 collapsed against 6/6 correct**. That is the intermittency: a
page's texture schedule was deciding what a star looked like.

## The fix

`src/art/textures.ts` routes the ramp through the one uploader that PINS the
flag: straight-alpha texels on a canvas source declaring
`alphaMode: 'premultiply-alpha-on-upload'`. The authored bytes are unchanged and
still come from a pure function (`rampPixels`), so the node fallback — a runner
with no DOM and no GPU — keeps the old premultiplied buffer, which is the only
correct pairing for an uploader that pins nothing.

**Nothing in the design moved.** `BLOOM.radius` (11.24) and `BLOOM.intensity`
(0.48) are untouched, as the brief required. The fixed frame measures
**0.885–0.915** of the design radius — the same as every correct reference in
a0-53.

## Reproducing it

```sh
npx vite build
npx vite preview --port 4262 --strictPort &
node evidence/a0-62-app-shell-bloom/capture.mjs   --port 4262            # four ratios
node evidence/a0-62-app-shell-bloom/probe-ramp.mjs --port 4262 --waitsel # the collapse
node evidence/a0-62-app-shell-bloom/probe-ramp.mjs --port 4262           # the correct order
npx vite-node evidence/a0-62-app-shell-bloom/audit.ts > evidence/a0-62-app-shell-bloom/audit.txt
npx vite-node evidence/a0-62-app-shell-bloom/make-plate.ts
```

`capture.mjs` carries an early `waitForSelector('canvas')` **on purpose**: it is
the perturbation of boot order that puts the ramp's upload after a font atlas,
and it is what makes the collapse reproduce every time rather than sometimes.

## The frames

| file | what |
|---|---|
| `app-dpr{1,1_5,2,3}.png` | the shipped app shell before the fix — **the reproduced absence** |
| `fixed-dpr{1,1_5,2,3}.png` | the same, after the fix |
| `plate-star-*.png` | 88 px crops at 4×: before \| after \| before@2 \| after@2 |
| `rendererprobe-today.png` | a0-53's probe, rebuilt today — correct, and always was |
| `probecfg-dpr{1,2}.png` | the real `index.html` built by a0-53's probe config — collapsed |
| `field-build1.png`, `field-rebuild.png` | `configure()` built once vs rebuilt — identical |
| `fresh0`, `freshwaitsel0` | the two boot orders, nothing else changed |
| `solo-*.png`, `when-*.png` | scene-stripping and frame-count ladders — no effect |
| `ramp-{good,bad}-frame-dpr1.png` | the frames the GPU read-backs belong to |

## The gate

`src/art/backdrop-bloom.test.ts` → `at the resolution the app bakes at`. It
models pixi's own two uploaders and requires the ramp to arrive premultiplied
ONCE **whatever the page left the flag set to**. It is anchored to the measured
GPU read-back rather than to itself: the test beside it replays the old
arrangement and requires it to reproduce 203→161, 154→93, 68→18, so a model that
could not produce the defect could not gate the fix either.
`mutation-check.txt` is that gate going red on the pre-fix behaviour.

The name is the brief's, and the brief's hypothesis was resolution. It is kept
because it is the handle a sixth round will look for; what it gates is the same
question asked properly — what the **app's own** upload does to the ramp, rather
than what a probe's does.
