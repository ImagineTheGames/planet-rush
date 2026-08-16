# a0-56 — the exported log after returning to the menu

Captured by `capture.mjs` against the preview bundle, one script, one build.
Both passes drive the same session: an offline match, ESC → EXIT → LEAVE (the
pause menu's own way out, which navigates the page), PLAY → PLAY SOLO → RUSH!
into a second match, then ESC → DOWNLOAD LOG. The file below is the one
Chromium actually saved.

## WITH the fix (`after-return-to-menu.json`)

```
file          planet-rush-log-da45657-20260816-031038.json
summary       Planet Rush playtest log — build da45657 (2026-08-16T03:09:57.441Z) · session 2026-08-16T03:10:38.844Z · desktop 1280x800 · net 4g · coverage match · covers 0.0s–25.9s · planet-rush.playtest-log/1
coverage      match
span          0ms – 25906ms   (durationMs 25906)
restored      5
events        11   dropped 0   capacity 600
by kind       {"session":3,"note":4,"match":3,"connect":1}
match events  match start, exit to menu, match start
page errors   none
```

First ten lines of the timeline:

```
      0ms  session session start
     19ms  note    Planet Rush build da45657 built 2026-08-16T03:09:57.441Z
     29ms  note    webgl
    153ms  match   match start
  17416ms  match   exit to menu
  18364ms  session restored after reload
  18364ms  session session start
  18365ms  note    Planet Rush build da45657 built 2026-08-16T03:09:57.441Z
  18374ms  note    webgl
  18549ms  connect front door idle
```

## WITHOUT persistence — the client as it shipped (`without-persistence.json`)

```
file          planet-rush-log-da45657-20260816-031135.json
summary       Planet Rush playtest log — build da45657 (2026-08-16T03:09:57.441Z) · session 2026-08-16T03:11:35.914Z · desktop 1280x800 · net 4g · coverage match · covers 0.0s–7.0s · planet-rush.playtest-log/1
coverage      match
span          0ms – 7002ms   (durationMs 7002)
restored      0
events        5   dropped 0   capacity 600
by kind       {"session":1,"note":2,"connect":1,"match":1}
match events  match start
page errors   none
```

First ten lines of the timeline:

```
      0ms  session session start
      0ms  note    Planet Rush build da45657 built 2026-08-16T03:09:57.441Z
      8ms  note    webgl
    175ms  connect front door idle
   7002ms  match   match start
```

