# a0-85 — the three settings goldens, rebaked from the merged tree

**The conflict.** a0-77 (the `?` help affordance on every settings row) and a0-79
(menu plate geometry + the void behind the menus) both re-baselined the same
three baselines. a0-79 merged first; a0-77 sat six hours and came back `DIRTY`
on exactly three binary files:

```
tests/mobile/goldens.spec.ts-snapshots/desktop-settings-desktop-linux.png
tests/mobile/goldens.spec.ts-snapshots/phone-landscape-settings-iphone-linux.png
tests/mobile/goldens.spec.ts-snapshots/phone-portrait-settings-iphone-linux.png
```

Neither side is correct. `--ours` is a settings screen with no plate geometry and
no void; `--theirs` is one with no `?` marks. The merged CODE draws both, so the
only correct baseline is a frame rendered FROM the merged tree.

## How to re-run it

Everything below runs from the repo root, in the studio container, on a private
port (the lanes share this box and the committed config pins 4173 with
`reuseExistingServer: !CI` — a0-06's trap).

```sh
# 1. the three goldens, rebaked from the merged tree
rm tests/mobile/goldens.spec.ts-snapshots/{desktop,phone-landscape,phone-portrait}-settings-*.png
PREVIEW_PORT=4285 npm run test:mobile -- --update-snapshots --grep "settings screen"

# 2. and green against the SHIPPED tolerance, nothing edited
PREVIEW_PORT=4285 npm run test:mobile -- --grep "settings screen"

# 3. the developer's own 798x384, which no CI baseline covers
PREVIEW_PORT=4286 npx playwright test --config evidence/a0-85-settings-goldens/playwright.config.ts
```

`compare.mjs` is a0-03's cluster localiser taking two explicit paths, used to
show each rebaked frame differs from BOTH sides — `sides/ours-a0-77-*.png` and
`sides/theirs-a0-79-*.png` are the two conflicting halves, kept so the claim is
checkable without a git checkout.

`audit.txt` is the finding: both changes, named, and confirmed visible in each of
the three frames plus the developer's 798x384.
