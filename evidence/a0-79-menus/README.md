# evidence/a0-79-menus — the menus' margin, and the sky behind them

Four instruments. Two answer *"is there a margin"*, two answer *"what does the
sky cost"*. Read `audit.txt` first — it is the write-up; these are what it is
made of.

| file | what it answers | how to re-run |
| --- | --- | --- |
| `plate-room.ts` → `plate-room.txt` | How much field the plates and the settings rows leave, and whether the labels still fit when they leave more. Headless, no browser, no GPU — it reads the SHIPPED layout functions and the repo's own measured advance tables (`src/ui/font-metrics.ts`), so it is the number that travels. | `npx vite-node evidence/a0-79-menus/plate-room.ts` |
| `frames.mjs` → `frames/`, `frames.txt`, `frames.json` | The four menu screens photographed from the shipped bundles, **before and after**, at four viewports — reached by a real press at the point the menu's own seam says each plate is drawn. | see below |
| `frame-cost.mjs` → `frame-cost.txt`, `.json` | What the menu backdrop costs per frame, measured: `?sky=0` vs `?sky=1` in **one bundle, back to back, order alternated**, with the live match sampled in the same run as the denominator. | see below |
| `src/ui/menu-backdrop.test.ts` | The mechanism the cost depends on: the void is baked once and cropped to the screen. A silent stop-caching is pixel-identical and 2.33 blended screenfuls a frame more expensive. | `npx vitest run src/ui/menu-backdrop.test.ts` |

## Re-running the two browser rigs

```sh
git worktree add /tmp/a079-before origin/main
ln -sfn "$PWD/node_modules" /tmp/a079-before/node_modules
(cd /tmp/a079-before && npx vite build --outDir dist-a079-before)
npx vite build --outDir dist-a079-after

node evidence/a0-79-menus/frames.mjs        # pictures
node evidence/a0-79-menus/frame-cost.mjs    # timings — RUN THIS ALONE
```

## Three things this directory learned the hard way

1. **Run the timing rig alone.** a0-75 lost a whole sweep to a concurrent
   `vite build` — an "after" read 183 ms where "before" read 133. Not beside a
   build, not beside vitest.
2. **Headless rAF is vsync-quantised.** The first `frame-cost.mjs` run read
   `16.7 → 33.3 ms` on every phone pass: three passes, perfectly repeatable,
   and it means nothing except "the frame crossed one vsync boundary".
   `--disable-gpu-vsync --disable-frame-rate-limit` is what makes the delta the
   frame.
3. **Never attach to a preview server you did not start.** `vite preview` exits
   on a busy port and a loop that only polls for a 200 will happily photograph
   whatever bundle was already there — which this directory did once, silently
   re-shooting the previous run's build. Both rigs now refuse.
