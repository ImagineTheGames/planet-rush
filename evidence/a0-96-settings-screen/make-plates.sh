#!/bin/sh
# evidence/a0-96-settings-screen/make-plates.sh — crops, then plates.
# OWNER: QA Manager (a0-96). Run from the repo root, after the four capture specs:
#
#   npx playwright test -c evidence/a0-96-settings-screen/playwright.config.ts
#   sh evidence/a0-96-settings-screen/make-plates.sh
#
# The crops exist so a reader can COUNT — pips on a volume bar, and which of two
# overlapping buttons is on top. Every one is a straight cut out of a committed
# frame, scaled with nearest neighbour; the frames themselves are never edited.
set -e
D=evidence/a0-96-settings-screen
S=$D/shots
C=$D/crops
mkdir -p "$C"

# The three volume rows, at the width where a pip is 3 px: rest, changed, reloaded.
for f in menu-rest menu-changed menu-reloaded; do
  node $D/crops.mjs crop $S/phone-798x384-$f.png $C/phone-$f-volumes.png 1180 220 400 320 3
done
# …and the desktop pair, whose bars sit in one column.
for f in menu-rest menu-reloaded; do
  node $D/crops.mjs crop $S/desktop-1280x800-$f.png $C/desktop-$f-volumes.png 1650 1240 1250 620 1
done

# The bottom-right corner of the IN-MATCH settings screen, where DOWNLOAD LOG
# lands on DONE. Both viewports, at 2x.
node $D/crops.mjs crop $S/phone-798x384-pause-rest.png $C/phone-pause-done-corner.png 1000 630 596 138 2
node $D/crops.mjs crop $S/desktop-1280x800-pause-rest.png $C/desktop-pause-done-corner.png 1820 1400 700 190 2

# Every `?` panel, cut out by difference against the same screen with none open.
node $D/crops.mjs panel $S/desktop-1280x800-menu-rest.png $C/desktop-help-panels.png \
  $S/desktop-1280x800-menu-help-fireMode.png $S/desktop-1280x800-menu-help-controls.png \
  $S/desktop-1280x800-menu-help-reduceVfx.png $S/desktop-1280x800-menu-help-master.png \
  $S/desktop-1280x800-menu-help-sfx.png $S/desktop-1280x800-menu-help-music.png
node $D/crops.mjs panel $S/phone-798x384-menu-rest.png $C/phone-help-panels.png \
  $S/phone-798x384-menu-help-fireMode.png $S/phone-798x384-menu-help-controls.png \
  $S/phone-798x384-menu-help-reduceVfx.png $S/phone-798x384-menu-help-master.png \
  $S/phone-798x384-menu-help-sfx.png $S/phone-798x384-menu-help-music.png
# FIRE MODE's help on the OTHER control scheme — the same row, a different story.
node $D/crops.mjs panel $S/desktop-1280x800-menu-rest.png $C/desktop-help-fireMode-sticks.png \
  $S/desktop-1280x800-menu-help-fireMode-sticks.png

# The FIRE MODE chip, either side of one press, on both surfaces' own frames.
for m in autoaim manual; do
  node $D/crops.mjs crop $S/desktop-1280x800-fire-chip-tap-$m.png $C/desktop-chip-tap-$m.png 590 370 1390 260 1
  node $D/crops.mjs crop $S/phone-798x384-fire-chip-tap-$m.png $C/phone-chip-tap-$m.png 40 205 760 240 2
done

node $D/plates.mjs
