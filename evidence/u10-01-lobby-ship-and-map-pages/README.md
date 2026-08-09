# u10-01 — the lobby is too crowded: ship and map selection move to their own screens

Evidence for `agent/ui/u10-lobby-ship-and-map-pages`.

The developer, 2026-08-07, with a screenshot of the live lobby:

> "in the lobby page select ship and select map need to open different pages, we
> should only show 1 ship and 1 map in lobby because it's too cluttered now"

Every image here is a **golden baseline taken by the real client**, on the real
Gantry/Bone build, reached by pressing the real controls — `tests/mobile/goldens.spec.ts`,
`npm run test:mobile`. Nothing here is a mock-up and nothing is cropped.

## The pair the report is about

| before | after |
|---|---|
| `before-phone-landscape-lobby.png` | `after-phone-landscape-lobby.png` |
| `before-desktop-lobby.png` | `after-desktop-lobby.png` |
| `before-phone-portrait-lobby.png` | `after-phone-portrait-lobby.png` |

**Read the phone-landscape pair first — it is the device the report was filed
from.** The `before` is the screenshot's own contents: eight roster rows in two
columns, **four hull tiles** each carrying six stats in a 172×66 box with GDD
§2.11's role blurb dropped for want of height, and **six arena cards** at the
bottom right whose names ("The Ring", "The Oval") are down at the size where they
stop being words. Three blocks competing for one 844×390 screen.

The `after` is one ship card and one arena card, each under an eyebrow that says
what it is and that pressing it does something — `SHIP · CHANGE`, `MAP · CHANGE`.
The hull card carries the full stat row at a size it can be read at, which the
four tiles beside each other could not.

## What the roster got back

`before-phone-portrait-lobby.png` → `after-phone-portrait-lobby.png` is the
clearest single measure. That is the one-column shape, where the band used to be
divided **three** ways — roster, a 2×2 of hull tiles, an arena row — and the
roster took what was left. It now shares with one row of two cards, and every
roster row clears the 48px thumb floor (asserted in `src/ui/lobby-geometry.test.ts`,
"hands the roster the height the three tiles and five cards used to take").

## The two new screens

| | |
|---|---|
| `new-desktop-ship-select.png` | `new-phone-landscape-ship-select.png` |
| `new-desktop-map-select.png` | `new-phone-landscape-map-select.png` |

**SHIP SELECT.** The four hulls, pips AND numbers (u4, ratified 2026-08-05 —
unchanged by this brief), in a 2×2. Compare the stat rows against the `before`
lobby: on the phone the six stats now lay out as **one table-like row** per hull
instead of folding to 3×2, and every tile draws GDD §2.11's role blurb, which no
phone in QA's matrix drew before. The picked hull (VANGUARD) is the raised plate;
BACK is the screen's one bright plate.

**MAP SELECT.** Six arenas with their registry previews — the dots are
`map.stations(...)` itself, so the picture is the board the sim will build — their
names at a legible size, and the VETERAN tag on Double Diamond. On the landscape
phone they come out 3×2 at 240×114; the row they replace was six cards with a
**two-pixel** gutter (a0-12 compressed it there to hold the thumb floor, and left
a note saying a seventh map could not join). The registry itself is untouched.

## The TEAMS pair, and what it proves by NOT changing

`before-desktop-lobby-teams.png` → `after-desktop-lobby-teams.png` and the
landscape-phone twin. The brief is explicit that the seat-state control (u5) and
the `FRIENDLY A` / `ENEMY B` labels (u3) were developer reports in their own right
and are not in scope. Both are per-row, and what moved is the column beside the
roster: in the pair, every row still carries its state control, its side chip in
the viewer's words, its tier chip and its `?`, and the footer still shows the
`A 4 · B 4` tally.

The two **level-badge region** baselines
(`tests/mobile/goldens.spec.ts-snapshots/*-lobby-level-badge-*.png`) are byte-identical
across this change and are deliberately not copied here: the roster column did not
move, so there was nothing to re-baseline, and that absence is the assertion.
