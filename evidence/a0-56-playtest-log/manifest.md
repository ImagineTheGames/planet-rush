# a0-56 — the exported log after returning to the menu

Captured by `capture.mjs` against the preview bundle, one script, one build.
Both passes drive the same session: an offline match, ESC → EXIT → LEAVE (the
pause menu's own way out, which navigates the page), PLAY → PLAY SOLO → RUSH!
into a second match, then ESC → DOWNLOAD LOG. The file below is the one
Chromium actually saved.

## WITH the fix (`after-return-to-menu.json`)

```
file          planet-rush-log-3758871-20260816-024126.json
summary       Planet Rush playtest log — build 3758871* (2026-08-16T02:40:46.271Z) · session 2026-08-16T02:41:26.875Z · desktop 1280x800 · net 4g · coverage match · covers 0.0s–22.8s · planet-rush.playtest-log/1
coverage      match
span          0ms – 22842ms   (durationMs 22842)
restored      5
events        11   dropped 0   capacity 600
by kind       {"session":3,"note":4,"match":3,"connect":1}
match events  match start, exit to menu, match start
page errors   none
```

First ten lines of the timeline:

```
      0ms  session session start
     20ms  note    Planet Rush build 3758871* built 2026-08-16T02:40:46.271Z
     29ms  note    webgl
    160ms  match   match start
  15245ms  match   exit to menu
  16040ms  session restored after reload
  16040ms  session session start
  16040ms  note    Planet Rush build 3758871* built 2026-08-16T02:40:46.271Z
  16047ms  note    webgl
  16211ms  connect front door idle
```

## WITHOUT persistence — the client as it shipped (`without-persistence.json`)

```
file          planet-rush-log-3758871-20260816-024219.json
summary       Planet Rush playtest log — build 3758871* (2026-08-16T02:40:46.271Z) · session 2026-08-16T02:42:19.874Z · desktop 1280x800 · net 4g · coverage match · covers 0.0s–7.1s · planet-rush.playtest-log/1
coverage      match
span          0ms – 7137ms   (durationMs 7137)
restored      0
events        5   dropped 0   capacity 600
by kind       {"session":1,"note":2,"connect":1,"match":1}
match events  match start
page errors   none
```

First ten lines of the timeline:

```
      0ms  session session start
      0ms  note    Planet Rush build 3758871* built 2026-08-16T02:40:46.271Z
      9ms  note    webgl
    175ms  connect front door idle
   7137ms  match   match start
```

