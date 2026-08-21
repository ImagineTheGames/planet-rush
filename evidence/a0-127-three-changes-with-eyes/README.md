# a0-127 — three things changed what the player sees, and a camera went to look

a0-123 (fewer blooms, the cross its own draw), a0-124 (previews generated from the
real map) and a0-125 (four overlap fixes) all merged on green CI. Two of the three
were direct requests from the developer, so what matters is not that the tests
pass but whether the screen looks like what was asked for.

**Five of the five items came back verified. Two other things did not.**

| # | item | verdict |
|---|---|---|
| 1 | the menu backdrop — how many bloom, how many wear a cross | **verified** — 52 bloom, 20 crossed |
| 2 | the bloom radius, which was out of scope | **verified** — the same disc, r for r |
| 3 | the picker at true size, six cards on a phone | **verified** — readable, not mush |
| 4 | the previews against the boards they advertise | **verified** — same arrangement |
| 5 | the own-station HP readout with the fullscreen button up | **verified** — 0% covered |
| — | D5, the pin that was deliberately kept | **failed** — the pair is never drawn |
| — | the build stamp on MAP SELECT | **failed** — 55% under the BACK plate |

## The ruler

Everything here is the app's own production pipeline — `npm run build` plus
`npm run preview` on this brief's own port (4327, because the lanes share this box
and a neighbouring preview may be serving another lane's pixels — a0-06's trap) —
on a0-111's two profiles, unchanged so a finding here and a finding there are
comparable rather than two different rulers: **phone landscape 798×384 dpr 2
touch** and **desktop 1280×800 dpr 2**.

**No capture passes `?freeze=1`.** `src/main.ts` sets
`buildBadge.visible = !flags.freeze`, so a frozen frame is a frame with the build
stamp deliberately hidden, and the brief asks for the stamp in frame. Every
specimen wears `0910de2*`. The star is an untracked `dist-a088/` directory that
was in the tree when the bundle was built; no tracked file differed from
`0910de26`.

One capture uses a second bundle: `68bac05e` — `main` with a0-124 in it and a0-123
not yet — built from a worktree and served on 4328, for the before/after that item
2 is about. Its frames wear `68bac05*`.

## Where each number comes from

### Counting blooms (items 1 and 2)

A menu is not only backdrop. The wordmark, the eyebrow, the two rules, the four
plates and the build stamp are **ink**, and a local maximum inside the letter P is
not a star — the first pass of this bench proved that by handing back a contact
sheet of the word PLANET. So the frame is masked to a **sky window** before
anything is counted:

- the plate band is measured off the frame (the longest run of pixels above L=55
  per row; the plates are the only large flat bright areas on the screen), giving
  desktop `x480..2060 y459..1160` and phone `x293..1277 y128..655`, rounded
  outward;
- plus a header band and a footer band, as fractions of the frame.

The same rectangles are applied to **both builds**, so the comparison is taken
through one window. It leaves 44.3% of the desktop frame and 28.6% of the phone's,
which is why the headline count is the desktop's — a count taken on the phone
would be a count of the margins.

Then three files, in this order:

1. `candidates.mjs` — proposes every local maximum that stands clear of its own
   local sky and carries some ring of light. It **over-collects on purpose**
   (plain stars and companions sitting inside a neighbour's halo come through),
   because a checklist that only listed blooms would be deciding the question it
   exists to help answer. Its counts are an upper bound, never the answer.
2. `mark.mjs` — draws a thin hollow magenta ring around each candidate on a
   **separate, clearly named count sheet**. A ring is a question, not an answer.
   Nothing is ever drawn on a specimen in `shots/`.
3. an eye, on `sky-tiles.mjs`'s native-size tiles — 1 image pixel = 1 device
   pixel — quadrant by quadrant. The manifest's numbers are what was found inside
   the rings: **52 haloed, 20 crossed**, by quadrant 15/5, 7/3, 22/10, 8/2.

The merge radius earned its own round: at 28px the checklist collapsed two
distinct bloomed stars 12px apart into one, which `adjudicate.mjs` caught at 6×.
It is 10px now.

`halo-compare.mjs` answers item 2 twice — a 6× side-by-side of the same star from
both builds, and the radial luminance profile of both, sampled 22.5° off-axis so a
diffraction cross cannot contribute to a measurement about a halo.

### The picker (item 3)

`shoot-picker.mjs` reaches MAP SELECT the way a player does — real taps at the
points the client itself reports drawing its controls at, PLAY → PLAY SOLO → the
lobby's arena card — and the verdict is taken on the **unmagnified** 1596×768
frame, one image pixel per device pixel of the handset. The 4× card crops exist
only to show a reader the detail the attestation names; no verdict is read off
them. The plate that carries the frame is 1596 wide so the frame renders 1:1.

### The boards (item 4)

The game never shows a whole arena: the follow camera holds the ship at the middle
of a handset-sized window and the minimap draws only what the player has sensed.
So `shoot-boards.mjs` runs the production bundle in a window big enough to hold
the arena — 3300×2100 for the WIDE maps, 2500×2500 for the SQUARE ones, dpr 1 —
with the ship flown to the arena centre with real clicks. **An unusual window, not
an unusual build.** The arena is chosen through `planet-rush:mapId`, the key MAP
SELECT itself writes.

### D1 and D5 (item 5, and the pin)

`shoot-corner.mjs` stubs **the browser's Fullscreen API** — the same stub
`tests/live-stage/fullscreen.spec.ts` installs — and nothing else. Headless
Chromium grants no element fullscreen, which is the real content of a0-125's
*"a headless screenshot run never leaves fullscreen"*: it is a fact about the
browser, not about the game. With the API in place the shipping bundle draws its
own button on a real match reached through the front door.

`shoot-wheel.mjs` flies the ship to stated standoffs directly below its own
station, one fresh boot per stop (a siege really costs the core HP, so a second
stop on a besieged station arrives under the pump's floor with the alarm drained),
holds the siege with a0-111's pump, and presses BUILD for real at each stop.

## Re-running it

```sh
npm run build && npx vite preview --port 4327 --strictPort &
node evidence/a0-127-three-changes-with-eyes/shoot-menu.mjs after
node evidence/a0-127-three-changes-with-eyes/shoot-picker.mjs
node evidence/a0-127-three-changes-with-eyes/shoot-boards.mjs
node evidence/a0-127-three-changes-with-eyes/shoot-corner.mjs
node evidence/a0-127-three-changes-with-eyes/shoot-wheel.mjs
# the before-build, for item 2 only
git worktree add /tmp/a0127-pre123 68bac05e
ln -s "$PWD/node_modules" /tmp/a0127-pre123/node_modules
(cd /tmp/a0127-pre123 && npm run build && npx vite preview --port 4328 --strictPort &)
BEFORE_PORT=4328 node evidence/a0-127-three-changes-with-eyes/shoot-menu.mjs before
# then the counting aids and the plates
for n in after-menu-desktop-1280x800 before-menu-desktop-1280x800 \
         after-menu-phone-798x384 before-menu-phone-798x384; do
  node evidence/a0-127-three-changes-with-eyes/candidates.mjs "$n"
  node evidence/a0-127-three-changes-with-eyes/mark.mjs "$n"
done
node evidence/a0-127-three-changes-with-eyes/sky-tiles.mjs after-menu-desktop-1280x800 before-menu-desktop-1280x800
node evidence/a0-127-three-changes-with-eyes/halo-compare.mjs 626,222 776,321 36,683 441,688
node evidence/a0-127-three-changes-with-eyes/plates.mjs
```

`shots/` holds the specimens and a JSON readback beside each; `crops/` holds
nearest-neighbour magnifications of stated rectangles of stated frames, with no
filtering and no annotation; `plates.json` composes them into the images the
manifest points at, with a caption under each written **after looking at that
frame**. Where a readback and an image ever disagreed, the image won and the
disagreement went into the attestation — which is how item 1's merge radius and
D5's verdict were found.
