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
2. When something goes wrong (or any time from the pause menu), press **DOWNLOAD LOG**.
   It sits bottom-right and appears on exactly three occasions:
   - the **pause menu**,
   - a **dropped or refused connection** (it names which: *"Disconnected
     (grace-elapsed) — DOWNLOAD LOG to report this."*),
   - the **boot-error screen** ("the can't reach servers page especially").
3. Attach the file to chat. That is the whole workflow.

**There is one control, and it produces a file — never a clipboard paste, on any
device.** Ratified by the developer at M10: *"Clipboard goes away for all (PC and
mobile). It should be DOWNLOAD LOG not COPY LOG."* A 40 KB JSON blob on a clipboard is
a paste no chat app takes and no human scrolls, so the old route could report success
while the log went nowhere — a failure that is not smaller on a desktop, just quieter.

The press answers itself in the label: **SAVING…**, then **LOG SENT** (the share sheet
took it), **LOG SAVED** (it landed in Downloads) or **SAVE FAILED**, reverting to
DOWNLOAD LOG after four seconds. Two routes, both producing the same named
`planet-rush-log-<sha>-<YYYYMMDD-HHMMSS>.json`:

- **The share sheet with the file** (`navigator.share` + `files:`), where the platform
  takes it — the OS chooser puts the file straight into Messages, Mail or Drive with no
  trip through a Downloads folder. Never the `text:` variant: a share that degrades to
  text is the wall of JSON this route exists to avoid, so a browser that refuses
  `files:` falls through to the download rather than pasting.
- **The blob download**, always available in a browser, landing in Downloads.

**It never uploads anything.** There is no endpoint in the feature; you choose what to
share.

## What a downloaded log says

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
| `src/net/playtest-log-export.ts` | `downloadPlaytestLog` — share-sheet-with-file, then blob download. No clipboard seam exists in this file |
| `src/net/playtest-log-button.ts` | the DOWNLOAD LOG affordance (DOM, pure model + markup + one DOM edge) |
| `src/net/connect-trace-view.ts` | the refusal panel's own pair: RETRY and DOWNLOAD LOG, under the line that named the failure |
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
`downloadLog` id, and its handler calls `downloadLogButton()?.download()` — the export
path needs no change. That is a UI-owned edit, which is why it was not made here.

### Proved on both form factors

`tests/live-stage/log-download.spec.ts` runs the same spec under two projects
(`playwright.log-download.config.ts`): the 390×844 DPR-3 phone and the 1280×800 desk.
Each asserts the affordance offers **exactly one** button, that it reads `DOWNLOAD LOG`,
and that a real press produces a file the test then `JSON.parse`s — on the phone by the
share sheet's `files:` payload as well as the download. "For all (PC and mobile)" is a
claim about two devices, so a phone-only spec could only ever assert half of it.
