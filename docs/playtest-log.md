# The playtest log — how to hand a session back

**Owner:** Netcode Engineer. **Status:** shipped (M10, `agent/netcode/m10-playtest-log`).
Ratified by the developer: *"Should we add logging to the browser so that I can share
back with you after a playtest?"*

The problem it solves is not "we have no logs". It is that **the developer's reports
and the Director's probes talk past each other**: a report reads *"it wouldn't
connect"*, a probe reads *"the fleet is healthy"*, and nothing in between says which
build was on the phone, which Machine it dialled, or what the socket actually said.

---

## For the developer: two taps

1. Play. Logging is always on — there is no flag to remember, because a bug that
   reproduces once must not require you to have guessed beforehand.
2. When something goes wrong (or any time from the pause menu), press **COPY LOG**.
   It sits bottom-right and appears on exactly three occasions:
   - the **pause menu**,
   - a **dropped or refused connection** (it names which: *"Disconnected
     (grace-elapsed) — COPY LOG to report this."*),
   - the **boot-error screen** ("the can't reach servers page especially").
3. Paste it into chat. That is the whole workflow.

If the clipboard refuses — an insecure origin, a Safari gesture rule, a denied
permission, all of which happen on real phones — the button says **LOG SAVED** and the
log is downloaded as `planet-rush-log-<sha>-<UTC>.json` instead. Attach that file.

**It never uploads anything.** There is no endpoint in the feature; you choose what to
share.

## What a pasted log says

The first line answers *"which build were you on?"* by itself:

```
Planet Rush playtest log — build 1a2b3c4 (2026-07-30T09:00:00.000Z) · session
2026-07-30T12:00:00.000Z · phone 390x844 touch · net 4g · planet-rush.playtest-log/1
```

Then a timeline, each entry stamped in ms since session start:

| kind | what it carries |
|---|---|
| `session` | build sha / time / dirty flag, the session instant, form factor, viewport, connection type |
| `connect` | the whole lifecycle: `allocate` → `ticket` (room, **machine id**, region, expiry) → `dial` (host, room) → `welcome` / `joinError` **with the server's own reason**, plus every transport state change and its close reason |
| `net` (`sample`) | one entry per finalized second of the #238 instrument: `rtt`/`rttMax` (ms), `jitter`, `corr`/`corrMax` (world units), `mispred` (rate), `recon`, `resync` (the snap events), `snap`, `lead` (ticks), and **`align`/`alignMax`/`alignN`** — how much later authority ran this client's input than the tick it was predicted at (M10 tick-alignment; `align 0` means the two clocks agree and a correction beside it is *not* a misalignment) |
| `net` (`volley` / `order` / `echo` / `expiry`) | the action events — one line per shot fired, per one-shot order sent, per answer authority gave it (`adopt` / `refused` / `unknown`, with the ticks waited), and per prediction that was never answered and expired. A player reporting "I tapped twice and got three turrets" is describing an *event*; a per-second average is the wrong instrument for one (`src/net/action-journal.ts`) |
| `match` | `matchStart` (and whether it was a reclaim replay), local `spawn` / `death` / `eliminated`, `playerSubstituted` / `playerReclaimed` with the grace seconds, `matchEnd` |
| `error` | `console.error` / `console.warn` from our own code, uncaught errors, unhandled rejections |
| `note` | the boot line, the WebGL API, anything else worth a marker |

## What it deliberately does **not** carry

- **No PII beyond what the game already knows.** No user-agent string, no device id,
  no location. The header is enumerated in a test, so adding a field forces the
  question again rather than answering it once and forgetting.
- **No secrets.** A reclaim token is never logged (only *that* a reclaim is possible);
  a signed ticket is logged as `ticket: true` and by its **machine id**, never by
  value; a dial URL is logged by host, without its `?ticket=` query.
- **No per-tick traffic.** 30 snapshots a second would spend the whole ring in twenty
  seconds and say nothing a per-second sample does not.

## Bounds — memory is a budget

- **600 events**, oldest evicted; the export reports `dropped` so a partial session
  says so rather than presenting itself as a whole one.
- Messages capped at 240 chars, string values at 160, `data` at 12 keys.
- **Consecutive identical events coalesce** into a `repeat` count with the last
  occurrence's timestamp — a `console.warn` inside a 60 Hz render loop costs one slot.

## The schema

`schema: "planet-rush.playtest-log"`, `version: 1`. Top-level fields: `schema`,
`version`, `summary`, `env`, `durationMs`, `capacity`, `dropped`, `events`. Adding a
field is a compatible change; the version bumps only when an existing field's meaning
changes. A unit test asserts the field set, so a removal or a rename cannot happen
quietly.

## The code

| file | role |
|---|---|
| `src/net/playtest-log.ts` | the ring, the header, the versioned export |
| `src/net/playtest-log-capture.ts` | console + uncaught-error capture (`isOurFrame` filters extensions and third-party origins) |
| `src/net/playtest-log-attach.ts` | a live `OnlineSession` → log events |
| `src/net/playtest-log-export.ts` | clipboard, then download fallback |
| `src/net/playtest-log-button.ts` | the COPY LOG affordance (DOM, pure model + markup + one DOM edge) |
| `src/main.ts` | the wiring: install at boot, the allocate/ticket/dial lifecycle, and where the button is offered |

Tests: `src/net/playtest-log*.test.ts` (unit, node) and
`tests/net/playtest-log-online.test.ts` — a **real** ticket-enforcing match server
refusing a **real** ticketless join over a **real** socket, proving the log carries the
server's `bad-ticket` reason and the terminal `join-rejected` close; plus a healthy
match whose welcome, RUSH! and per-second telemetry all land.

### Why the button is DOM and not PixiJS

The moments it has to work in are the moments the game may not be drawing — a dead
socket, a refused join, a boot failure where the renderer *is* the fault. Same reason
`src/platform/boot-error.ts` is DOM-only. It is also the whole of this feature's UI: it
appears only when a screen already owns the display and hides the instant the match
does, so the HUD budget is untouched and `src/ui/` keeps its screens.

**Open handoff for UI (not blocking):** if a native Pixi row is wanted inside the pause
overlay later, `pauseButtons()` / `PauseButton` in `src/ui/pause-menu.ts` would gain a
`copyLog` id, and its handler calls `copyLogButton()?.copy()` — the export path needs
no change. That is a UI-owned edit, which is why it was not made here.
