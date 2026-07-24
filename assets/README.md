# assets/

Generated game assets live here. OWNER: Art & Audio Agent (GDD §3.6, §4.5).

Art is generated **as code** (procedural SVG / sprite generators, jsfxr-style
SFX) — reproducible, diffable, license-clean, and regenerable offline. Fonts
(Audiowide, Oxanium; both OFL) are self-hosted here so the game renders offline
with no license risk (GDD §5.6).

Nothing in here is hand-drawn, and nothing in here is the source of truth: the
generators in `src/art/` are. What lands in this directory is either **output**
of those generators (committed so it is reviewable in a diff) or **third-party
licensed files** that cannot be generated, like the fonts.

## `preview/sprite-sheet.svg`

The contact sheet: every sprite the generators can make, grouped, captioned, on
Vacuum — with an **actual-size 24px strip** at the top, because that is the size
the style guide's hard readability rule is written at (style-guide §4).

This is the art review surface for a repo with no art tool. Open it in a browser
and you are looking at the whole sprite set; open it in a PR diff and you are
looking at exactly what changed, as shapes and colours rather than as a binary
blob.

It is a **golden**: `src/art/preview.test.ts` fails if the committed sheet and
the generators disagree, so the picture can never go stale. Regenerate it after
any art change:

```sh
UPDATE_ART_PREVIEW=1 npx vitest run src/art/preview.test.ts
```

## What the generators guarantee

Both of these are CI assertions, not review notes (see `src/art/`):

- **The RESERVED rule holds across the whole catalogue** — signal yellow appears
  only on ore, the planet core, and hazard/danger; threat red only on danger;
  player colour only on trim (style-guide §2, §3). Every shape carries a role,
  and the audit walks all of them.
- **The four hulls stay distinguishable at 24×24 px**, flat, in greyscale
  (style-guide §4), measured as pairwise overlap of their rasterized mass.

Everything is deterministic — same inputs, byte-identical output, all randomness
drawn from the ratified `mulberry32` — so a rock looks the same on the client,
on the server, and in a replay (GDD §4.1).

Still to come in later Art & Audio briefs: the VFX set (GDD §3.6), synthesized
SFX including the under-attack alarm and the rock-vs-hull beam voices, the
ambient loop, and the self-hosted font files.
