# a0-98 — state × viewport × topmost element, the **fixed** bundle

Generated, not typed: `node evidence/a0-98-corner-collisions-everywhere-else/table.mjs fixed` (add `--full` for every control of every state, including
the ones where the offer is not on the screen at all).

A **COLLISION** is the brief's own definition and a0-97's: `document.elementFromPoint`
answering with the log affordance at the point the CLIENT ITSELF reports drawing a
control a press can reach (`./pressable.mjs` — `main.ts`'s own `pointerdown` order).

| state | viewport | the offer | control, at the point the client reports | topmost there | verdict |
| --- | --- | --- | --- | --- | --- |
| front-door-room-list | desktop-1280x800 | never mounted | — | — | 5 controls drawn; the offer is not on this screen |
| front-door-row-refused | desktop-1280x800 | **SHOWN** x1062–1268 y706–788 | `__onlineMenu.doorControls[0]<mode:browse>` @ 128,216 | `CANVAS#app` | clear |
| front-door-row-refused | desktop-1280x800 | **SHOWN** x1062–1268 y706–788 | `__onlineMenu.doorControls[1]<mode:code>` @ 303,216 | `CANVAS#app` | clear |
| front-door-row-refused | desktop-1280x800 | **SHOWN** x1062–1268 y706–788 | `__onlineMenu.doorControls[2]<back>` @ 114,754 | `CANVAS#app` | clear |
| boot-failure | desktop-1280x800 | **SHOWN** x978–1268 y706–788 | `dom#boot-error-retry` @ 358,694 | `BUTTON#boot-error-retry` | clear |
| boot-failure-retry-scrolled-into-view | desktop-1280x800 | **SHOWN** x978–1268 y706–788 | `dom#boot-error-retry` @ 358,690 | `BUTTON#boot-error-retry` | clear |
| menu | desktop-1280x800 | never mounted | — | — | 4 controls drawn; the offer is not on this screen |
| doors-idle | desktop-1280x800 | never mounted | — | — | 5 controls drawn; the offer is not on this screen |
| doors-error | desktop-1280x800 | never mounted | — | — | 5 controls drawn; the offer is not on this screen |
| join-browse | desktop-1280x800 | never mounted | — | — | 3 controls drawn; the offer is not on this screen |
| join-keypad-idle | desktop-1280x800 | never mounted | — | — | 37 controls drawn; the offer is not on this screen |
| join-keypad-error | desktop-1280x800 | never mounted | — | — | 37 controls drawn; the offer is not on this screen |
| lobby | desktop-1280x800 | never mounted | — | — | 28 controls drawn; the offer is not on this screen |
| match-live-offline | desktop-1280x800 | never mounted | — | — | 10 controls drawn; the offer is not on this screen |
| match-pause-menu | desktop-1280x800 | **SHOWN** x1079–1268 y744–788 | `__pauseStage.controls[0]<resume>` @ 640,313 | `CANVAS#app` | clear |
| match-pause-menu | desktop-1280x800 | **SHOWN** x1079–1268 y744–788 | `__pauseStage.controls[1]<settings>` @ 640,404 | `CANVAS#app` | clear |
| match-pause-menu | desktop-1280x800 | **SHOWN** x1079–1268 y744–788 | `__pauseStage.controls[2]<exit>` @ 640,491 | `CANVAS#app` | clear |
| match-pause-menu | desktop-1280x800 | **SHOWN** x1079–1268 y744–788 | `__cornerStage.elements[0]<ship-local>` *(drawn, not pressable)* @ 640,400 | `CANVAS#app` | clear (readout, not a control) |
| match-pause-menu | desktop-1280x800 | **SHOWN** x1079–1268 y744–788 | `__cornerStage.elements[1]<build-badge>` *(drawn, not pressable)* @ 30,760 | `CANVAS#app` | clear (readout, not a control) |
| match-pause-menu | desktop-1280x800 | **SHOWN** x1079–1268 y744–788 | `__cornerStage.elements[2]<pause-menu>` *(drawn, not pressable)* @ 640,400 | `CANVAS#app` · 1% under the offer | clear (readout, not a control) |
| match-pause-menu | desktop-1280x800 | **SHOWN** x1079–1268 y744–788 | `__cornerStage.elements[3]<ore-hud>` *(drawn, not pressable)* @ 41,42 | `CANVAS#app` | clear (readout, not a control) |
| match-pause-menu | desktop-1280x800 | **SHOWN** x1079–1268 y744–788 | `__cornerStage.elements[4]<banked-total>` *(drawn, not pressable)* @ 23,43 | `CANVAS#app` | clear (readout, not a control) |
| match-pause-menu | desktop-1280x800 | **SHOWN** x1079–1268 y744–788 | `__cornerStage.elements[5]<controls-strip>` *(drawn, not pressable)* @ 640,780 | `CANVAS#app` · 10% under the offer | clear (readout, not a control) |
| match-pause-menu | desktop-1280x800 | **SHOWN** x1079–1268 y744–788 | `__cornerStage.elements[6]<station-hp>` *(drawn, not pressable)* @ 1185,37 | `CANVAS#app` | clear (readout, not a control) |
| match-pause-menu | desktop-1280x800 | **SHOWN** x1079–1268 y744–788 | `__cornerStage.elements[7]<nameplates>` *(drawn, not pressable)* @ 474,512 | `CANVAS#app` | clear (readout, not a control) |
| match-pause-menu | desktop-1280x800 | **SHOWN** x1079–1268 y744–788 | `__cornerStage.elements[8]<minimap>` *(drawn, not pressable)* @ 1194,674 | `CANVAS#app` · 3% under the offer | clear (readout, not a control) |
| online-match-live | desktop-1280x800 | never mounted | — | — | 8 controls drawn; the offer is not on this screen |
| online-match-severed | desktop-1280x800 | **SHOWN** x959–1268 y706–788 | `__cornerStage.elements[0]<ship-local>` *(drawn, not pressable)* @ 640,400 | `P#pr-link-loss-detail` | clear (readout, not a control) |
| online-match-severed | desktop-1280x800 | **SHOWN** x959–1268 y706–788 | `__cornerStage.elements[1]<build-badge>` *(drawn, not pressable)* @ 101,760 | `DIV#pr-link-loss` | clear (readout, not a control) |
| online-match-severed | desktop-1280x800 | **SHOWN** x959–1268 y706–788 | `__cornerStage.elements[2]<ore-hud>` *(drawn, not pressable)* @ 41,42 | `DIV#pr-link-loss` | clear (readout, not a control) |
| online-match-severed | desktop-1280x800 | **SHOWN** x959–1268 y706–788 | `__cornerStage.elements[3]<banked-total>` *(drawn, not pressable)* @ 23,43 | `DIV#pr-link-loss` | clear (readout, not a control) |
| online-match-severed | desktop-1280x800 | **SHOWN** x959–1268 y706–788 | `__cornerStage.elements[4]<controls-strip>` *(drawn, not pressable)* @ 640,780 | `DIV#pr-link-loss` · 17% under the offer | clear (readout, not a control) |
| online-match-severed | desktop-1280x800 | **SHOWN** x959–1268 y706–788 | `__cornerStage.elements[5]<station-hp>` *(drawn, not pressable)* @ 1185,37 | `DIV#pr-link-loss` | clear (readout, not a control) |
| online-match-severed | desktop-1280x800 | **SHOWN** x959–1268 y706–788 | `__cornerStage.elements[6]<nameplates>` *(drawn, not pressable)* @ 736,320 | `DIV#pr-link-loss` | clear (readout, not a control) |
| online-match-severed | desktop-1280x800 | **SHOWN** x959–1268 y706–788 | `__cornerStage.elements[7]<minimap>` @ 1194,674 | `DIV#pr-link-loss` · 28% under the offer | clear |
| online-match-severed | desktop-1280x800 | **SHOWN** x959–1268 y706–788 | `dom#pr-link-loss-reconnect` @ 535,446 | `BUTTON#pr-link-loss-reconnect` | clear |
| online-match-severed | desktop-1280x800 | **SHOWN** x959–1268 y706–788 | `dom#pr-link-loss-abandon` @ 744,446 | `BUTTON#pr-link-loss-abandon` | clear |
| online-match-kicked-out | desktop-1280x800 | **SHOWN** x959–1268 y706–788 | `__cornerStage.elements[0]<ship-local>` *(drawn, not pressable)* @ 640,400 | `P#pr-link-loss-detail` | clear (readout, not a control) |
| online-match-kicked-out | desktop-1280x800 | **SHOWN** x959–1268 y706–788 | `__cornerStage.elements[1]<build-badge>` *(drawn, not pressable)* @ 101,760 | `DIV#pr-link-loss` | clear (readout, not a control) |
| online-match-kicked-out | desktop-1280x800 | **SHOWN** x959–1268 y706–788 | `__cornerStage.elements[2]<ore-hud>` *(drawn, not pressable)* @ 41,42 | `DIV#pr-link-loss` | clear (readout, not a control) |
| online-match-kicked-out | desktop-1280x800 | **SHOWN** x959–1268 y706–788 | `__cornerStage.elements[3]<banked-total>` *(drawn, not pressable)* @ 23,43 | `DIV#pr-link-loss` | clear (readout, not a control) |
| online-match-kicked-out | desktop-1280x800 | **SHOWN** x959–1268 y706–788 | `__cornerStage.elements[4]<controls-strip>` *(drawn, not pressable)* @ 640,780 | `DIV#pr-link-loss` · 17% under the offer | clear (readout, not a control) |
| online-match-kicked-out | desktop-1280x800 | **SHOWN** x959–1268 y706–788 | `__cornerStage.elements[5]<station-hp>` *(drawn, not pressable)* @ 1185,37 | `DIV#pr-link-loss` | clear (readout, not a control) |
| online-match-kicked-out | desktop-1280x800 | **SHOWN** x959–1268 y706–788 | `__cornerStage.elements[6]<nameplates>` *(drawn, not pressable)* @ 736,320 | `DIV#pr-link-loss` | clear (readout, not a control) |
| online-match-kicked-out | desktop-1280x800 | **SHOWN** x959–1268 y706–788 | `__cornerStage.elements[7]<minimap>` @ 1194,674 | `DIV#pr-link-loss` · 28% under the offer | clear |
| online-match-kicked-out | desktop-1280x800 | **SHOWN** x959–1268 y706–788 | `dom#pr-link-loss-reconnect` @ 535,446 | `BUTTON#pr-link-loss-reconnect` | clear |
| online-match-kicked-out | desktop-1280x800 | **SHOWN** x959–1268 y706–788 | `dom#pr-link-loss-abandon` @ 744,446 | `BUTTON#pr-link-loss-abandon` | clear |
| online-match-dropped-pause-menu | desktop-1280x800 | **SHOWN** x916–1268 y688–788 | `__pauseStage.controls[0]<resume>` @ 640,313 | `DIV#pr-link-loss` | clear |
| online-match-dropped-pause-menu | desktop-1280x800 | **SHOWN** x916–1268 y688–788 | `__pauseStage.controls[1]<settings>` @ 640,404 | `P#pr-link-loss-detail` | clear |
| online-match-dropped-pause-menu | desktop-1280x800 | **SHOWN** x916–1268 y688–788 | `__pauseStage.controls[2]<exit>` @ 640,491 | `DIV#pr-link-loss` | clear |
| online-match-dropped-pause-menu | desktop-1280x800 | **SHOWN** x916–1268 y688–788 | `__cornerStage.elements[0]<ship-local>` *(drawn, not pressable)* @ 640,400 | `P#pr-link-loss-detail` | clear (readout, not a control) |
| online-match-dropped-pause-menu | desktop-1280x800 | **SHOWN** x916–1268 y688–788 | `__cornerStage.elements[1]<build-badge>` *(drawn, not pressable)* @ 30,760 | `DIV#pr-link-loss` | clear (readout, not a control) |
| online-match-dropped-pause-menu | desktop-1280x800 | **SHOWN** x916–1268 y688–788 | `__cornerStage.elements[2]<pause-menu>` *(drawn, not pressable)* @ 640,400 | `P#pr-link-loss-detail` · 3% under the offer | clear (readout, not a control) |
| online-match-dropped-pause-menu | desktop-1280x800 | **SHOWN** x916–1268 y688–788 | `__cornerStage.elements[3]<ore-hud>` *(drawn, not pressable)* @ 41,42 | `DIV#pr-link-loss` | clear (readout, not a control) |
| online-match-dropped-pause-menu | desktop-1280x800 | **SHOWN** x916–1268 y688–788 | `__cornerStage.elements[4]<banked-total>` *(drawn, not pressable)* @ 23,43 | `DIV#pr-link-loss` | clear (readout, not a control) |
| online-match-dropped-pause-menu | desktop-1280x800 | **SHOWN** x916–1268 y688–788 | `__cornerStage.elements[5]<controls-strip>` *(drawn, not pressable)* @ 640,780 | `DIV#pr-link-loss` · 19% under the offer | clear (readout, not a control) |
| online-match-dropped-pause-menu | desktop-1280x800 | **SHOWN** x916–1268 y688–788 | `__cornerStage.elements[6]<station-hp>` *(drawn, not pressable)* @ 1185,37 | `DIV#pr-link-loss` | clear (readout, not a control) |
| online-match-dropped-pause-menu | desktop-1280x800 | **SHOWN** x916–1268 y688–788 | `__cornerStage.elements[7]<nameplates>` *(drawn, not pressable)* @ 736,320 | `DIV#pr-link-loss` | clear (readout, not a control) |
| online-match-dropped-pause-menu | desktop-1280x800 | **SHOWN** x916–1268 y688–788 | `__cornerStage.elements[8]<minimap>` *(drawn, not pressable)* @ 1194,674 | `DIV#pr-link-loss` · 41% under the offer | clear (readout, not a control) |
| online-match-dropped-pause-menu | desktop-1280x800 | **SHOWN** x916–1268 y688–788 | `dom#pr-link-loss-menu` @ 640,449 | `BUTTON#pr-link-loss-menu` | clear |
| online-match-guest-healthy | guest-desktop | never mounted | — | — | 8 controls drawn; the offer is not on this screen |
| front-door-room-list | phone-798x384 | never mounted | — | — | 5 controls drawn; the offer is not on this screen |
| front-door-row-refused | phone-798x384 | never mounted | — | — | 3 controls drawn; the offer is not on this screen |
| boot-failure | phone-798x384 | **SHOWN** x496–786 y290–372 | `dom#boot-error-retry` *(drawn, not pressable)* @ 117,486 | `off-viewport` | not probed — off-viewport |
| boot-failure-retry-scrolled-into-view | phone-798x384 | **SHOWN** x496–786 y290–372 | `dom#boot-error-retry` @ 117,274 | `BUTTON#boot-error-retry` | clear |
| menu | phone-798x384 | never mounted | — | — | 4 controls drawn; the offer is not on this screen |
| doors-idle | phone-798x384 | never mounted | — | — | 5 controls drawn; the offer is not on this screen |
| doors-error | phone-798x384 | never mounted | — | — | 5 controls drawn; the offer is not on this screen |
| join-browse | phone-798x384 | never mounted | — | — | 3 controls drawn; the offer is not on this screen |
| join-keypad-idle | phone-798x384 | never mounted | — | — | 37 controls drawn; the offer is not on this screen |
| join-keypad-error | phone-798x384 | never mounted | — | — | 37 controls drawn; the offer is not on this screen |
| lobby | phone-798x384 | never mounted | — | — | 28 controls drawn; the offer is not on this screen |
| match-live-offline | phone-798x384 | never mounted | — | — | 11 controls drawn; the offer is not on this screen |
| match-pause-menu | phone-798x384 | **SHOWN** x597–786 y328–372 | `__pauseStage.controls[0]<resume>` @ 399,122 | `CANVAS#app` | clear |
| match-pause-menu | phone-798x384 | **SHOWN** x597–786 y328–372 | `__pauseStage.controls[1]<settings>` @ 399,196 | `CANVAS#app` | clear |
| match-pause-menu | phone-798x384 | **SHOWN** x597–786 y328–372 | `__pauseStage.controls[2]<exit>` @ 399,266 | `CANVAS#app` | clear |
| match-pause-menu | phone-798x384 | **SHOWN** x597–786 y328–372 | `__cornerStage.elements[0]<ship-local>` *(drawn, not pressable)* @ 399,192 | `CANVAS#app` | clear (readout, not a control) |
| match-pause-menu | phone-798x384 | **SHOWN** x597–786 y328–372 | `__cornerStage.elements[1]<build-button>` *(drawn, not pressable)* @ 92,172 | `CANVAS#app` | clear (readout, not a control) |
| match-pause-menu | phone-798x384 | **SHOWN** x597–786 y328–372 | `__cornerStage.elements[2]<build-badge>` *(drawn, not pressable)* @ 30,370 | `CANVAS#app` | clear (readout, not a control) |
| match-pause-menu | phone-798x384 | **SHOWN** x597–786 y328–372 | `__cornerStage.elements[3]<pause-menu>` *(drawn, not pressable)* @ 399,192 | `CANVAS#app` · 3% under the offer | clear (readout, not a control) |
| match-pause-menu | phone-798x384 | **SHOWN** x597–786 y328–372 | `__cornerStage.elements[4]<ore-hud>` *(drawn, not pressable)* @ 39,37 | `CANVAS#app` | clear (readout, not a control) |
| match-pause-menu | phone-798x384 | **SHOWN** x597–786 y328–372 | `__cornerStage.elements[5]<banked-total>` *(drawn, not pressable)* @ 21,38 | `CANVAS#app` | clear (readout, not a control) |
| match-pause-menu | phone-798x384 | **SHOWN** x597–786 y328–372 | `__cornerStage.elements[6]<station-hp>` *(drawn, not pressable)* @ 705,36 | `CANVAS#app` | clear (readout, not a control) |
| match-pause-menu | phone-798x384 | **SHOWN** x597–786 y328–372 | `__cornerStage.elements[7]<zoom-control>` *(drawn, not pressable)* @ 750,85 | `CANVAS#app` | clear (readout, not a control) |
| match-pause-menu | phone-798x384 | **SHOWN** x597–786 y328–372 | `__cornerStage.elements[8]<onboarding>` *(drawn, not pressable)* @ 399,339 | `CANVAS#app` | clear (readout, not a control) |
| match-pause-menu | phone-798x384 | **SHOWN** x597–786 y328–372 | `__cornerStage.elements[9]<nameplates>` *(drawn, not pressable)* @ 495,112 | `CANVAS#app` | clear (readout, not a control) |
| match-pause-menu | phone-798x384 | **SHOWN** x597–786 y328–372 | `__cornerStage.elements[10]<minimap>` *(drawn, not pressable)* @ 626,332 | `BUTTON#playtest-download-log-button` · 47% under the offer | covered — but a readout, not a control |
| online-match-live | phone-798x384 | never mounted | — | — | 10 controls drawn; the offer is not on this screen |
| online-match-severed | phone-798x384 | never mounted | — | — | 11 controls drawn; the offer is not on this screen |
| online-match-kicked-out | phone-798x384 | never mounted | — | — | 11 controls drawn; the offer is not on this screen |
| online-match-dropped-pause-menu | phone-798x384 | **SHOWN** x434–786 y272–372 | `__pauseStage.controls[0]<resume>` @ 399,122 | `CANVAS#app` | clear |
| online-match-dropped-pause-menu | phone-798x384 | **SHOWN** x434–786 y272–372 | `__pauseStage.controls[1]<settings>` @ 399,196 | `CANVAS#app` | clear |
| online-match-dropped-pause-menu | phone-798x384 | **SHOWN** x434–786 y272–372 | `__pauseStage.controls[2]<exit>` @ 399,266 | `CANVAS#app` | clear |
| online-match-dropped-pause-menu | phone-798x384 | **SHOWN** x434–786 y272–372 | `__cornerStage.elements[0]<ship-local>` *(drawn, not pressable)* @ 399,192 | `CANVAS#app` | clear (readout, not a control) |
| online-match-dropped-pause-menu | phone-798x384 | **SHOWN** x434–786 y272–372 | `__cornerStage.elements[1]<build-button>` *(drawn, not pressable)* @ 92,172 | `CANVAS#app` | clear (readout, not a control) |
| online-match-dropped-pause-menu | phone-798x384 | **SHOWN** x434–786 y272–372 | `__cornerStage.elements[2]<build-badge>` *(drawn, not pressable)* @ 30,370 | `CANVAS#app` | clear (readout, not a control) |
| online-match-dropped-pause-menu | phone-798x384 | **SHOWN** x434–786 y272–372 | `__cornerStage.elements[3]<pause-menu>` *(drawn, not pressable)* @ 399,192 | `CANVAS#app` · 12% under the offer | clear (readout, not a control) |
| online-match-dropped-pause-menu | phone-798x384 | **SHOWN** x434–786 y272–372 | `__cornerStage.elements[4]<ore-hud>` *(drawn, not pressable)* @ 39,37 | `CANVAS#app` | clear (readout, not a control) |
| online-match-dropped-pause-menu | phone-798x384 | **SHOWN** x434–786 y272–372 | `__cornerStage.elements[5]<banked-total>` *(drawn, not pressable)* @ 21,38 | `CANVAS#app` | clear (readout, not a control) |
| online-match-dropped-pause-menu | phone-798x384 | **SHOWN** x434–786 y272–372 | `__cornerStage.elements[6]<station-hp>` *(drawn, not pressable)* @ 705,36 | `CANVAS#app` | clear (readout, not a control) |
| online-match-dropped-pause-menu | phone-798x384 | **SHOWN** x434–786 y272–372 | `__cornerStage.elements[7]<zoom-control>` *(drawn, not pressable)* @ 750,85 | `CANVAS#app` | clear (readout, not a control) |
| online-match-dropped-pause-menu | phone-798x384 | **SHOWN** x434–786 y272–372 | `__cornerStage.elements[8]<nameplates>` *(drawn, not pressable)* @ 495,112 | `CANVAS#app` | clear (readout, not a control) |
| online-match-dropped-pause-menu | phone-798x384 | **SHOWN** x434–786 y272–372 | `__cornerStage.elements[9]<minimap>` *(drawn, not pressable)* @ 626,332 | `BUTTON#playtest-download-log-button` · 100% under the offer | covered — but a readout, not a control |
| online-match-dropped-pause-menu | phone-798x384 | **SHOWN** x434–786 y272–372 | `dom#pr-link-loss-menu` @ 399,241 | `CANVAS#app` | clear |
| online-match-guest-healthy | guest-desktop | never mounted | — | — | 8 controls drawn; the offer is not on this screen |
| online-match-live | phone-portrait-390x844 | never mounted | — | — | 10 controls drawn; the offer is not on this screen |
| online-match-severed | phone-portrait-390x844 | never mounted | — | — | 11 controls drawn; the offer is not on this screen |
| online-match-kicked-out | phone-portrait-390x844 | never mounted | — | — | 11 controls drawn; the offer is not on this screen |
| online-match-dropped-pause-menu | phone-portrait-390x844 | **SHOWN** x12–91 y491–832 | `__pauseStage.controls[0]<resume>` @ 265,422 | `CANVAS#app` | clear |
| online-match-dropped-pause-menu | phone-portrait-390x844 | **SHOWN** x12–91 y491–832 | `__pauseStage.controls[1]<settings>` @ 192,422 | `CANVAS#app` | clear |
| online-match-dropped-pause-menu | phone-portrait-390x844 | **SHOWN** x12–91 y491–832 | `__pauseStage.controls[2]<exit>` @ 122,422 | `CANVAS#app` | clear |
| online-match-dropped-pause-menu | phone-portrait-390x844 | **SHOWN** x12–91 y491–832 | `__cornerStage.elements[0]<ship-local>` *(drawn, not pressable)* @ 195,422 | `CANVAS#app` | clear (readout, not a control) |
| online-match-dropped-pause-menu | phone-portrait-390x844 | **SHOWN** x12–91 y491–832 | `__cornerStage.elements[1]<build-button>` *(drawn, not pressable)* @ 212,92 | `CANVAS#app` | clear (readout, not a control) |
| online-match-dropped-pause-menu | phone-portrait-390x844 | **SHOWN** x12–91 y491–832 | `__cornerStage.elements[2]<build-badge>` *(drawn, not pressable)* @ 15,30 | `CANVAS#app` | clear (readout, not a control) |
| online-match-dropped-pause-menu | phone-portrait-390x844 | **SHOWN** x12–91 y491–832 | `__cornerStage.elements[3]<pause-menu>` *(drawn, not pressable)* @ 195,422 | `CANVAS#app` · 8% under the offer | clear (readout, not a control) |
| online-match-dropped-pause-menu | phone-portrait-390x844 | **SHOWN** x12–91 y491–832 | `__cornerStage.elements[4]<ore-hud>` *(drawn, not pressable)* @ 354,39 | `CANVAS#app` | clear (readout, not a control) |
| online-match-dropped-pause-menu | phone-portrait-390x844 | **SHOWN** x12–91 y491–832 | `__cornerStage.elements[5]<banked-total>` *(drawn, not pressable)* @ 353,21 | `CANVAS#app` | clear (readout, not a control) |
| online-match-dropped-pause-menu | phone-portrait-390x844 | **SHOWN** x12–91 y491–832 | `__cornerStage.elements[6]<station-hp>` *(drawn, not pressable)* @ 355,751 | `CANVAS#app` | clear (readout, not a control) |
| online-match-dropped-pause-menu | phone-portrait-390x844 | **SHOWN** x12–91 y491–832 | `__cornerStage.elements[7]<zoom-control>` *(drawn, not pressable)* @ 305,796 | `CANVAS#app` | clear (readout, not a control) |
| online-match-dropped-pause-menu | phone-portrait-390x844 | **SHOWN** x12–91 y491–832 | `__cornerStage.elements[8]<nameplates>` *(drawn, not pressable)* @ 275,518 | `CANVAS#app` | clear (readout, not a control) |
| online-match-dropped-pause-menu | phone-portrait-390x844 | **SHOWN** x12–91 y491–832 | `__cornerStage.elements[9]<minimap>` *(drawn, not pressable)* @ 52,672 | `BUTTON#playtest-download-log-button` · 99% under the offer | covered — but a readout, not a control |
| online-match-dropped-pause-menu | phone-portrait-390x844 | **SHOWN** x12–91 y491–832 | `dom#pr-link-loss-menu` @ 195,469 | `CANVAS#app` | clear |
| online-match-guest-healthy | guest-desktop | never mounted | — | — | 8 controls drawn; the offer is not on this screen |
