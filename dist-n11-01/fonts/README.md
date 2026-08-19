# public/fonts/ — the two ratified faces, self-hosted (GDD §5.6)

OWNER: UI Engineer. Shipped by `u14-01`.

GDD §5.6 ratifies **Audiowide** (wordmark, headings, menu confirmations) and
**Oxanium** (HUD numerals and body text), "both OFL licensed and self-hosted in
the repo, so they render offline and carry no licence risk." Until 2026-08-11
that sentence was aspiration: there was no `@font-face` anywhere and no font
file in the repo, so **every frame this project has ever drawn — every golden,
every screenshot in `evidence/`, every live round — was in a fallback face.**
These four files are the sentence made true.

| File | Bytes | What it is |
|---|---|---|
| `Audiowide-Regular-latin.woff2` | 14,132 | Audiowide 400, latin subset. Static, one weight — the family upstream has only Regular. |
| `Oxanium-Variable-latin.woff2` | 14,044 | Oxanium, latin subset. **Variable** (`wght` 200–800), so one file serves 400 and 700. |
| `Audiowide-OFL.txt` | 4,430 | SIL OFL 1.1, © 2012 Brian J. Bonislawsky DBA Astigmatic. RFN "Audiowide". |
| `Oxanium-OFL.txt` | 4,384 | SIL OFL 1.1, © 2019 The Oxanium Project Authors. |

**27.5 KB total over the wire**, both files, for the whole game.

## Why `public/` and not `assets/`

`assets/` is the Art agent's directory and holds *generated* art; nothing in it
is served. `public/` is Vite's static root — files here are copied verbatim to
the deploy root, so `./fonts/x.woff2` resolves under GitHub Pages' project
subpath, under `/dev`, and under a custom domain without a rebuild, exactly like
`icon.svg` and `manifest.webmanifest` already do. It is also the only placement
that keeps the URL stable enough for `<link rel="preload">` in `index.html`,
which is what makes the load deterministic. `assets/README.md` still says the
fonts live there; correcting that line is Art's to make.

## Provenance

Both faces are the current Google Fonts release, fetched from `fonts.gstatic.com`
and committed here. **They are served from this repo, never from a CDN**: GDD
§4.3/§4.8 require the game to run offline, and the strict artifact hosts these
builds are reviewed on do not allow a third-party `font-src`.

```sh
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
curl -H "User-Agent: $UA" \
  'https://fonts.googleapis.com/css2?family=Audiowide&family=Oxanium:wght@400;700&display=block'
# -> the `/* latin */` @font-face src of each family; Oxanium serves ONE url for
#    both 400 and 700 because the woff2 is variable (fvar wght 200..800).
curl -o Audiowide-Regular-latin.woff2 https://fonts.gstatic.com/s/audiowide/v22/l7gdbjpo0cum0ckerWCdlg_O.woff2
curl -o Oxanium-Variable-latin.woff2  https://fonts.gstatic.com/s/oxanium/v21/RrQQboN_4yJ0JmiMe2LE0Q.woff2
curl -o Audiowide-OFL.txt https://raw.githubusercontent.com/google/fonts/main/ofl/audiowide/OFL.txt
curl -o Oxanium-OFL.txt   https://raw.githubusercontent.com/google/fonts/main/ofl/oxanium/OFL.txt
```

## What the subset keeps, and what it cuts

**Kept — the `latin` range**, which is what the game's copy is written in:

```
U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC,
U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193,
U+2212, U+2215, U+FEFF, U+FFFD
```

That covers every character the UI actually renders, including the ones easy to
miss: `·` U+00B7, `×` U+00D7, `°` U+00B0, `§` U+00A7, `—` U+2014, `’` U+2019,
`…` U+2026, `−` U+2212, and the `á`/`ã` in the region names (`São Paulo`).
`src/ui/typography.test.ts` asserts this range against the ranges declared in
`index.html`, so the two can never drift.

**Cut — the `latin-ext` range** (Latin Extended-A/B, the accented and historic
letterforms at U+0100–02FF, U+1E00–1EFF, U+2C60–2C7F, U+A720–A7FF). It is
15,000 bytes across the two files — **+53% payload for glyphs no string in this
repo uses.** This ships to a phone browser on every load, so it is cut. If the
game is ever localised, the two `latin-ext` files are one `curl` away and the
`@font-face` blocks already carry `unicode-range`, so adding them is additive
and costs nothing to anyone reading English.

**Not cut, because neither face ever had them.** The UI draws a handful of
symbols the ratified faces simply do not contain — `→` U+2192, `○` U+25CB,
`●` U+25CF (the upgrade panel's pips), `▸` U+25B8, `△` U+25B3, `⌫` U+232B, and
thin space U+2009. Verified against the upstream TTF `cmap`s: **Audiowide has
366 codepoints and Oxanium 357, and neither includes any of them.** They were
falling through to the fallback stack before this change and they still do,
per-character, which is a browser behaviour and not a subsetting loss. Nothing
regressed; there was simply never a version of this where those glyphs were
Audiowide's.
