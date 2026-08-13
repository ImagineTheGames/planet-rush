/**
 * evidence/a1-17-defaults-and-browser/_entries.mjs — the a1-17 round's
 * attestations, and the one-shot that appends them to `evidence/manifest.json`.
 * OWNER: QA Manager.
 *
 * The manifest's shape and contract are untouched: same eight keys in the same
 * order, items are ADDED, and nothing already in it is re-graded. This was a
 * read-only round; the historical record stays exactly as it was written.
 *
 * ONE SHA FOR THE WHOLE ROUND. The site did not redeploy under this one:
 * `version.json` read `75ec737` before the first capture and `75ec737` after the
 * last, and `75ec737` is the merge commit of #404 itself — the newest of the
 * five PRs. Every frame here carries the badge `75ec737` in its corner, and the
 * bundle behind it was byte-compared against that tree's sources before any of
 * it was photographed (`served-source-check.json`).
 *
 *   node evidence/a1-17-defaults-and-browser/_entries.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = resolve(HERE, '..', 'manifest.json');
const SHA = '75ec737';

/** Shorthand — keeps the eight keys in the manifest's own order. */
const item = (id, title, area, image, capturedAt, verdict, attestation) => ({
  id,
  title,
  area,
  image,
  capturedAt,
  buildSha: SHA,
  attestation,
  verdict,
});

const ITEMS = [
  // -----------------------------------------------------------------------
  item(
    'a1-17-the-served-build-is-the-newest-merge-not-a-stale-one',
    'THE GATE: the served build is 75ec737 — the merge of #404 itself — and 24 of the 26 src files the five merges touched are byte-identical on the wire',
    'boot',
    'images/a1-17-defaults-desktop-fresh.png',
    '2026-08-13T01:05:00Z',
    'verified',
    "THE FIRST THING THE BRIEF ASKS, ANSWERED BEFORE ANY OTHER FRAME WAS TAKEN. https://imaginethegames.github.io/planet-rush/version.json reads {\"sha\":\"75ec737\",\"time\":\"2026-08-13T00:29:46.941Z\"} and the HTML's last-modified is 00:30:07Z. 75ec737 is not merely newer than the five merges — IT IS ONE OF THEM: it is the merge commit of #404 (a0-33), the last of the batch, and therefore the tip of main. git merge-base --is-ancestor confirms all six merge commits are in it: #399 9a9fa88, #400 e0c160d, #401 655c18e and 185eaa9, #402 12b86fe, #403 193dc38, #404 75ec737. So the served build does not predate the merges and the round proceeds. NOT TAKEN ON version.json's WORD, WHICH IS A STRING THE BUILD WRITES ABOUT ITSELF. build.sourcemap is on, so the served bundle ships sourcesContent — the ORIGINAL SOURCE of the code on the page. verify-served-source.mjs walks the served chunk graph (10 chunks: index, typography, main with 396 sources, browserAll, webworkerAll, WebGPURenderer, WebGLRenderer, colorToUniform, CanvasPool, SharedSystems), pulls every map, and byte-compares each of the 26 non-test src files the five merges touched against `git show 75ec737:<path>`. 24 of 26 IDENTICAL TO THE BYTE, 0 failures. THE TWO THAT ARE NOT PRESENT ARE ACCOUNTED FOR BY MEASUREMENT, NOT BY ASSERTION — a1-06 filed two such absences as failures before checking why, and that is the trap this avoids. src/net/transport.ts: the script greps it at the sha for any export surviving type erasure and finds ZERO, so it cannot reach a bundle or a map at all; #400's change to it was interface fields. src/net/ticket.ts: it HAS runtime exports (signTicket, verifyTicket) but no src/ file value-imports it — its runtime lives in the allocator and the match server, not the client; #400's change to it was the `intent` claim plus a server-side validator. The two barrels src/net/index.ts and src/ui/index.ts are pure re-exports that rollup flattens. AND THE SERVER HALF OF #400 IS LIVE INDEPENDENTLY: GET https://planet-rush-allocator.fly.dev/health returns {\"status\":\"ok\",\"machines\":3,...} and GET /rooms answers with the listing route's own payload shape. The image attached is one of the frames the round rests on; the badge in its bottom-left corner reads 75ec737, and every image in every a1-17 item carries the same badge.",
  ),
  // -----------------------------------------------------------------------
  item(
    'a1-17-a-fresh-profile-gets-tap-commander-and-auto-aim-on-both-form-factors',
    'A FRESH PROFILE, desktop and 390 px phone: the settings screen reads FIRE MODE · AUTO-AIM and CONTROLS · TAP COMMANDER, and the scheme carries into the running match',
    'boot',
    'images/a1-17-defaults-desktop-fresh.png',
    '2026-08-13T01:05:00Z',
    'verified',
    "THE WORDS ON THE SCREEN, ON A PROFILE WITH NOTHING STORED. localStorage is cleared before the app's first line runs, so the client's own boot read is what sees an empty profile; SETTINGS is then reached by a real click/tap at the physical point the client itself reported drawing that control at, never by a seam call. DESKTOP 1280x800 (images/a1-17-defaults-desktop-fresh.png): a six-row settings panel. Row 1 FIRE MODE, and the button on its right says AUTO-AIM. Row 2 CONTROLS, and its button says TAP COMMANDER. Then REDUCE VFX · OFF, and MASTER / SFX / MUSIC VOLUME with their bar meters. Header SETTINGS, top-right CHANGES SAVE IMMEDIATELY, bottom-right DONE, bottom-left the badge 75ec737. I read those two words off the picture and they are the two the developer ratified. 390 PX PHONE (images/a1-17-defaults-phone390-fresh.png), 390x844 portrait, which the client draws under its landscape lock so the whole panel is rotated 90 degrees: the same three toggle rows read, in rotated type, FIRE MODE · AUTO-AIM, CONTROLS · TAP COMMANDER, REDUCE VFX · OFF. Same two words. The seam's settingsRows — the same model object the view was handed, so it cannot say one thing while the screen says another — reports FIRE MODE:AUTO-AIM | CONTROLS:TAP COMMANDER on both. AND IT IS NOT JUST THE SETTINGS SCREEN. A settings row that says TAP while the match drives sticks would be the real defect, so the scheme was followed all the way in: on a clean front-door boot (PLAY -> PLAY SOLO -> RUSH!, every press at the client's own reported point) __mainMenu.controlScheme is 'tap' AND __mainMenu.matchControlScheme — read through bindMatch off the running match — is 'tap', on desktop 1280x800, on 844x390 landscape and on 390x844 portrait. ONE THING WORTH THE DEVELOPER'S ATTENTION AND NOT A DEFECT: a fresh profile leaves BOTH keys unwritten. After boot, localStorage's planet-rush:controlScheme and planet-rush:fireMode are still null on the fresh profiles — the defaults are read, not stamped. That is the correct shape (it is what lets the default move again without overwriting anybody), and it is recorded here because a future round that asserts on storage rather than on the screen would find nothing there and could mistake it for a failure.",
  ),
  // -----------------------------------------------------------------------
  item(
    'a1-17-a-saved-preference-survives-the-new-default',
    'THE REGRESSION THAT MATTERS MORE: a profile that had already chosen Sticks + Manual still reads MANUAL and its own device wording, on desktop and on the 390 px phone',
    'boot',
    'images/a1-17-defaults-desktop-saved-sticks-manual.png',
    '2026-08-13T01:05:00Z',
    'verified',
    "MOVING A DEFAULT IS ONE LINE; MOVING EVERYONE'S SAVED SETTING WITH IT IS THE REGRESSION, and it lives in the boot path's storage read, not in any pure model. So a profile that has already chosen was staged the way a returning player's profile really is: planet-rush:controlScheme='sticks' and planet-rush:fireMode='manual' written BEFORE the app's first line, so the client's own boot read is what sees them. No reload, no post-hoc poke at a value already read. DESKTOP 1280x800 (images/a1-17-defaults-desktop-saved-sticks-manual.png): FIRE MODE · MANUAL. CONTROLS · KEYBOARD + MOUSE. Not AUTO-AIM, not TAP COMMANDER. The stored choice won. 390 PX PHONE (images/a1-17-defaults-phone390-saved-sticks-manual.png), rotated under the landscape lock: FIRE MODE · MANUAL, CONTROLS · STICKS. THE TWO CONTROLS ROWS SAY DIFFERENT WORDS FOR THE SAME STORED VALUE AND THAT IS CORRECT, NOT A DRIFT: the row names the DEVICE in front of the player and never the internal scheme name (the u8-01 rule the developer has already caught this row breaking once, with a screenshot). Same stored 'sticks'; a desktop is a keyboard and a mouse, a handset is two sticks. After boot the two keys still read exactly 'sticks' and 'manual' — nothing overwrote them. AND THE SAVED SCHEME REACHES THE SIM TOO: on a clean front-door boot with the same stored profile, __mainMenu.matchControlScheme off the running match reads 'sticks'. So a returning player is seated where they left themselves, on both form factors and in the match, not only on the menu that reports it.",
  ),
  // -----------------------------------------------------------------------
  item(
    'a1-17-the-first-tutorial-sentence-teaches-the-tap-not-a-hold',
    'THE FIRST PROMPT, quoted off the pixels of a clean front-door boot: "Tap the asteroid to mine it — your shots chip the rock" — no hold-fire anywhere near a Tap Commander seat',
    'hud',
    'images/a1-17-prompt-clean-desktop-fresh-band.png',
    '2026-08-13T01:40:00Z',
    'verified',
    "THE DEVELOPER'S OWN REPORT, ANSWERED IN THE DEVELOPER'S OWN TERMS: the words a player reads. Every frame here is a CLEAN BOOT — no ?debug=1, so there is no seam on the page to read a string off. The client was walked in through the front door (PLAY -> PLAY SOLO -> RUSH!, each press at the physical point the client itself reported drawing that control at) and then the ship was FLOWN, because MINE's trigger is an asteroid in weapon range and a ship parked at its own station has none. It was flown by the gesture the scheme under test gives the player: a tap on the world. Nothing was staged — in particular __oreHudStage.mine() was NOT used, because granting cargo sets hasMined and RETIRES the very prompt this is about. WHAT THE PICTURES SAY. images/a1-17-prompt-clean-desktop-fresh-band.png, desktop 1280x800, the bottom band at 3x nearest-neighbour: one line of white type behind a bright caret — \"Tap the asteroid to mine it — your shots chip the rock\". I read it glyph by glyph off the zoom; the em-dash is an em-dash. images/a1-17-prompt-clean-phone844x390-fresh-band.png, a 844x390 phone: the same sentence, wrapped over two lines, \"Tap the asteroid to mine it — your shots\" / \"chip the rock\". images/a1-17-prompt-clean-phone390x844-fresh-band.png, a 390x844 portrait phone drawn under the landscape lock so the band is the left edge of the physical frame and the type runs bottom-to-top: the same sentence again. Three form factors, three clean boots, one sentence, and the word \"Hold\" appears in none of them. The badge 75ec737 is in every one. THE CONTROL, WHICH IS WHAT MAKES THIS A RESULT RATHER THAN A COINCIDENCE. a0-33 would be no fix at all if it had simply replaced one wrong sentence with another, so a profile that had CHOSEN sticks was booted the same way: images/a1-17-prompt-clean-desktop-saved-sticks-band.png reads \"Hold Left mouse near the asteroid — auto-aim does the aiming, your shots chip the rock\", and images/a1-17-prompt-clean-phone844x390-saved-sticks.png reads \"Hold FIRE button near the asteroid — auto-aim does the aiming, your shots chip the rock\" with the round FIRE button it names sitting on the same screen. The sentence changes with the SCHEME and the key inside it changes with the DEVICE, which is exactly the two-layer behaviour a0-33 claims. ?debug=1's __onboardingStage agrees character for character on all five configurations and reports scheme/device beside each; where it and the pixels could have disagreed they did not. ONE INSTRUMENT ARTEFACT, CAUGHT AND REMOVED RATHER THAN FILED. The first pass drove every sticks profile with the keyboard, including the handset, and duly recorded a phone being told to \"Hold Left mouse\". That would have been a fabricated finding: the HUD re-resolves bindings for whatever device last supplied input, so my keyboard press had turned the phone into a keyboard. Touch profiles are now driven by touch only and device() is read in the same evaluate as the text. The corrected phone reading is \"Hold FIRE button\", above.",
  ),
  // -----------------------------------------------------------------------
  item(
    'a1-17-the-controls-strip-still-teaches-wasd-to-a-ship-that-ignores-it',
    'FAILED: one line under the fixed tutorial sentence, the HUD strip tells every new desktop player "WASD Thrust · Left mouse Fire / Mine" — and W held for 3 s moves a fresh-profile ship 0.0 world units',
    'hud',
    'images/a1-17-prompt-clean-desktop-fresh-band.png',
    '2026-08-13T01:40:00Z',
    'failed',
    "TWO INSTRUCTIONS, ON THE SAME SCREEN, AT THE SAME MOMENT, DISAGREEING. images/a1-17-prompt-clean-desktop-fresh-band.png is a clean front-door boot on a FRESH profile — which since a0-30 is every new desktop player — at 1280x800, bottom band, 3x nearest-neighbour. Two lines of type, one directly above the other. The upper line is a0-33's fixed tutorial prompt: \"Tap the asteroid to mine it — your shots chip the rock\". The lower line is the HUD's permanent controls strip: \"WASD Thrust    Left mouse Fire / Mine    Build & Upgrade — get closer to your station\". The tutorial teaches the tap; the legend under it teaches the sticks. THE STRIP IS NOT MERELY REDUNDANT, IT IS WRONG, AND THAT IS MEASURED RATHER THAN ARGUED. On a clean front-door boot into a solo match on a fresh profile, with the ship parked at its own station and the local ship's world position read through __mainMenu.localShipPos: over 3 s of NO input the ship moved 0.0 world units (1968,1200 -> 1968,1200); over 3 s with W HELD DOWN it moved 0.0 world units (1968,1200 -> 1968,1200); and over 3 s after ONE click on the world it moved 326.9 (1968,1200 -> 1656.9,1099.4). The same probe, same code, same key dispatch, on a profile that had stored 'sticks': idle 0.0, W held 737.7 (1968,1198.6 -> 1968,460.9), click 0.25. So the keyboard is not unfocused and the dispatch is not broken — W simply does nothing on a Tap Commander seat, and the strip names it first. \"Left mouse Fire / Mine\" is the milder half of the same problem: the left mouse button does do something under Tap Commander, but what it does is fly and target, not fire and mine, so the label describes the wrong verb rather than a dead key. \"Build & Upgrade\" is contextual and honest (it reads \"— get closer to your station\" away from the station). WHY IT LOOKS SYSTEMIC RATHER THAN INCIDENTAL: the HudFrame gained a controlScheme field in #404 and the prompt now resolves from it, but the strip's rows come from a binding description taken on the DEVICE and the FIRE MODE only, with no scheme anywhere in it — which is consistent with a strip that cannot vary by scheme even in principle. That is a reading of the code and it is offered only as a direction to look; the finding itself is the two lines in the photograph and the 0.0 against 737.7. WHAT THIS IS NOT: it is not a defect in a0-33, which fixed the prompt it was briefed to fix and fixed it correctly (see a1-17-the-first-tutorial-sentence-teaches-the-tap-not-a-hold). It is the next surface along, uncovered by the same default move, and it is filed failed because a new player on the shipped build is being told in the HUD's own permanent legend to press a key that will not move their ship.",
  ),
  // -----------------------------------------------------------------------
  item(
    'a1-17-a-room-is-found-in-the-list-and-joined-with-no-code-typed',
    'THE BROWSER WORKS: two clients on the real fleet — the guest finds the host\'s room in the list, presses JOIN, and lands in CLAIM YWX7 as seat 2 without ever touching the keypad',
    'online',
    'images/a1-17-browser-guest-list.png',
    '2026-08-13T02:10:00Z',
    'verified',
    "TWO REAL CLIENTS, THE REAL FLEET, NO LOCAL SERVER. planet-rush-allocator.fly.dev was up with 3 machines and the served client has that allocator baked in at build time, so a local fleet would have been testing a bundle nobody is served. THE HOST pressed PLAY then CREATE ROOM at the client's own reported points and landed in a lobby headed CLAIM YWX7 (online=true, isHost=true, seat 0, humanCount 1). THE GUEST is a separate browser context with its own cleared storage. It pressed PLAY, then JOIN — and the JOIN screen OPENS ON THE LIST, joinMode 'browse', not on the keypad. images/a1-17-browser-guest-list.png: header DEEP FIELD MINING AUTHORITY / OPEN CLAIMS under the PLANET RUSH wordmark, the line PICK A CLAIM, a two-segment control reading BROWSE (drawn as the selected segment) and ENTER ROOM CODE, the stamp UPDATED 0s AGO at the right, and exactly one row. images/a1-17-browser-guest-row.png is that row at 3x nearest-neighbour: on the left VE3MRL in white over 1 PLAYER · 7 SEATS OPEN · FFA in grey; on the right IAD — and a boxed JOIN button. The row appeared in the guest's list within the first poll — 0 s of waiting. THEN THE PRESS THAT IS THE WHOLE FEATURE. The guest clicked the centre of the row's OWN joinBounds rect — the JOIN button the developer asked for, at the rect the client reported drawing it at — and nothing else. Its code field read '' before that press and '' after it: NO CODE WAS EVER TYPED. images/a1-17-browser-guest-lobby.png is where it landed: CREW MUSTER, CLAIM YWX7 top-right — the host's room, matched exactly — with P1 \"PLAYER 1 ★ ·72ms\" and P2 \"YOU ·69ms\", seats P3 through P8 all OPEN, WAITING FOR THE CLAIM HOLDER, and RUSH! drawn dim because the guest is not the holder. The seam agrees: room YWX7, you=1, humanCount=2. AND THE HOST'S SCREEN MOVED TOO, which is the half a one-client test cannot show: images/a1-17-browser-host-lobby-after-join.png now reads P1 \"YOU ★ ·73ms\", P2 \"PLAYER 2 ·70ms\", and the footer counts 2 PLAYING · 0 BOTS with RUSH! live. NO ROW PRINTED A CODE, CHECKED TWICE. Every string on the row — owner, meta, where, action, state — was searched for YWX7 and none contains it; the 3x zoom of the row shows no four-character code anywhere on it. And the allocator does not even hand the client one: fetched while a room was live, GET /rooms returned {\"rooms\":[{\"id\":\"b7ddcy6UMw981qr-\",\"owner\":\"YLXCUV\",\"region\":\"iad\",\"size\":8,\"mode\":\"ffa\",\"players\":1,\"joinableSeats\":7}],...} — an opaque listing handle, an owner name, a region and two counts. The room code is not in the payload, so it cannot reach a pixel.",
  ),
  // -----------------------------------------------------------------------
  item(
    'a1-17-the-keypad-still-joins-by-code-after-a-browser-was-put-in-front-of-it',
    'The other half of the JOIN screen survived #401: 4H39 pressed key by key on the real keypad, then JOIN, then the lobby — and that screen prints "YOUR PING 167ms"',
    'online',
    'images/a1-17-browser-keypad-typed.png',
    '2026-08-13T02:25:00Z',
    'verified',
    "PUTTING A NEW SCREEN IN FRONT OF A WORKING ONE IS A CLASSIC WAY TO BREAK IT, and the brief's private-room half rests entirely on \"must still join by code\", so the keypad was driven for real. A second room was hosted on the live fleet — 4H39 — and a fresh guest pressed PLAY, JOIN, then the ENTER ROOM CODE segment. joinMode moved from 'browse' to 'code' and the screen redrew as the keypad. images/a1-17-browser-keypad-typed.png: header DEEP FIELD MINING AUTHORITY / CLAIM CODE, the title line ROOM IN IAD · YOUR PING 167ms, the same two segments with ENTER ROOM CODE now selected, a 32-key pad laid out A-H / J-R / S-Z / 2-9 (no I, O, 0 or 1 — the confusable glyphs are absent from the alphabet), the four typed characters 4 H 3 9 shown in their own boxes above the pad, and BACK / ERASE / JOIN along the bottom. Each of those four characters was produced by clicking that key's own control at the point the client reported for it — key:4, key:H, key:3, key:9 — never through the seam's typeCode(). The code field read exactly \"4H39\" afterwards. Pressing JOIN landed the guest in the lobby: room 4H39, seat 1, humanCount 2. So both halves of the JOIN screen work on the same build, and a player who has a code typed to them can still use it.",
  ),
  // -----------------------------------------------------------------------
  item(
    'a1-17-there-is-no-private-toggle-to-press',
    'FAILED (the privacy half): the brief\'s PRIVATE room cannot be created — the host\'s lobby draws MODE, YIELD, eight seats, SHIP, MAP, BACK and RUSH! and no listing control at all',
    'online',
    'images/a1-17-browser-host-lobby-after-join.png',
    '2026-08-13T02:15:00Z',
    'failed',
    "THE BRIEF ASKS FOR A PRIVATE ROOM THAT DOES NOT APPEAR IN THE LIST AND STILL JOINS BY CODE. I could not make one, because on the served build there is nothing to press. WHAT THE HOST'S LOBBY ACTUALLY DRAWS. images/a1-17-browser-host-lobby-after-join.png is a real room on the real fleet, seen from the CLAIM HOLDER's side (P1 marked with the star, footer 2 PLAYING · 0 BOTS, RUSH! live — so this is the fully-powered host view, not a joiner's). Every control on it: a MODE · FFA chip top-left; a YIELD · SCARCE chip beside it; eight roster rows each with its own leading state control (TAKEN / TAKEN / OPEN x6); a SHIP · CHANGE card; a MAP · CHANGE card; BACK bottom-left; RUSH! bottom-right. Top-right, the room's code, CLAIM YWX7. There is no PUBLIC, no PRIVATE, no VISIBILITY, no LISTED, no lock glyph, nowhere on the screen. THE SEAM AGREES, AND IT IS THE SAME REPORT THE MOBILE SUITE TURNS INTO SCREENSHOT REGIONS. Enumerating every key on __lobby that carries a physicalCenter — i.e. everything the lobby says it drew as a pressable thing — yields exactly: seatStates, rushControl, modeControl, seatControls, seatHelpControls, shipCardControl, mapCardControl. Nothing about listing. A control that is not drawn and not reported is not a control. WHAT DOES EXIST, WHICH IS WHY THIS IS A MISSING BUTTON RATHER THAN A MISSING FEATURE: the wire already carries the flag (the lobbyChoice message has an optional `listed` boolean) and the match server already holds the state (a room field defaulting to listed/public, which is the developer's own ruling — public by default with a PRIVATE toggle). The client never sends it: the single call site that builds a lobbyChoice passes shipClass, fireMode, bot difficulties, bot personalities, mode, teams, seats and abundance, and no `listed`. That last part is read off the source and is offered as a direction to look, not as the finding. THE FINDING IS THE PHOTOGRAPH AND THE CONTROL INVENTORY: every room a player can host on this build is public and will appear in the browser, so the brief's \"a PRIVATE room must not appear in the list\" is not a test that can be run here, and I am not going to manufacture a private room through a seam no player has and report the result as if a player could reach it. The other half of the brief's sentence — \"must still join by code\" — IS proved on this build, against a public room, in a1-17-the-keypad-still-joins-by-code-after-a-browser-was-put-in-front-of-it. Filed failed rather than inconclusive because the absence itself is certain and photographed; what is unknown is only whether the server half would behave once a button reaches it.",
  ),
  // -----------------------------------------------------------------------
  item(
    'a1-17-the-browse-row-draws-a-dash-where-a-ping-belongs',
    'The list\'s ping column prints "IAD —" on a build that measures the ping perfectly well — 167 ms one segment away, 69-73 ms two screens later',
    'online',
    'images/a1-17-browser-guest-row.png',
    '2026-08-13T02:10:00Z',
    'failed',
    "THE ROW HAS A PING COLUMN AND IT IS EMPTY. images/a1-17-browser-guest-row.png, the single listed room at 3x nearest-neighbour: left side VE3MRL over 1 PLAYER · 7 SEATS OPEN · FFA; right side, immediately before the JOIN button, the characters `IAD` followed by an em-dash. Not a number, not \"—ms\", not a spinner: a dash. The seam's own string for that field is \"IAD —\", so the view and the model agree that there is nothing to show. THE SAME CLIENT MEASURES THAT PING FINE, WHICH IS WHY THIS IS WORTH FILING. One segment away on the very same screen, the ENTER ROOM CODE half draws the title \"ROOM IN IAD · YOUR PING 167ms\" (images/a1-17-browser-keypad-typed.png). Two screens later, inside the room, the roster prints a per-seat round trip beside every human: ·72ms and ·69ms on the guest's view, ·73ms and ·70ms on the host's (images/a1-17-browser-guest-lobby.png, images/a1-17-browser-host-lobby-after-join.png). This box is a US-east machine and the room's machine is iad, so 69-73 ms in-room and 167 ms on the region probe are both plausible numbers for it and neither is missing for want of a measurement. THE CONSEQUENCE, IN THE DEVELOPER'S OWN FRAMING OF THE FEATURE: the browse row exists so a player can choose a room by who is in it and how far away it is. With one room listed the dash costs nothing. With six rooms listed across regions, the column that is supposed to break the tie shows six dashes. Recorded as failed on the narrow claim that the row's ping column does not print a ping; the region tag IAD beside it is correct and drawn.",
  ),
  // -----------------------------------------------------------------------
  item(
    'a1-17-a-solo-lobby-offers-no-open-seat-and-an-online-one-still-does',
    'SOLO cycles a seat BOT ⇄ CLOSED and never offers OPEN — seven presses, four full turns; the same press in an online room still cycles OPEN → BOT → CLOSED',
    'online',
    'images/a1-17-seat-solo-lobby.png',
    '2026-08-13T02:35:00Z',
    'verified',
    "AN OPEN SEAT IN A ROOM NOBODY CAN JOIN IS A SEAT THAT NEVER FILLS, so the test is not whether SOLO omits OPEN once — it is whether it omits it every time round. Seat 3 (index 2, chosen because it is neither this client's own seat nor the one a joiner takes) was cycled by clicking its leading state control at the physical point the lobby reported drawing it at, one click at a time, seven times, reading the label back after each. SOLO (reached by PLAY -> PLAY SOLO; the lobby reports online=false): the label sequence was BOT -> CLOSED -> BOT -> CLOSED -> BOT -> CLOSED -> BOT -> CLOSED. Eight readings, four complete turns of the cycle, and the set of distinct labels seen is exactly {BOT, CLOSED}. OPEN never appeared. ONLINE (reached by PLAY -> CREATE ROOM on the real fleet; online=true), the identical procedure on the identical seat: OPEN -> BOT -> CLOSED -> OPEN -> BOT -> CLOSED -> OPEN -> BOT. Distinct labels {OPEN, BOT, CLOSED}, and OPEN comes round every third press exactly as it should. So the seat control did not lose a state globally — it lost it precisely where the state is meaningless. Each press has its own frame, and each frame has a 4x nearest-neighbour crop of that seat's own reported rect beside it (images/a1-17-seat-solo-press1-zoom.png through press7, and the same series for online), so the word on the control can be read directly rather than trusted from the readback. images/a1-17-seat-solo-lobby.png is the whole solo lobby at the end of the run and images/a1-17-seat-online-lobby.png the whole online one.",
  ),
  // -----------------------------------------------------------------------
  item(
    'a1-17-build-and-upgrade-and-the-upgrade-ship-wedge-fit-at-390px',
    'THE LABELS FIT at 390 px landscape, measured: "& UPGRADE" is 60 px inside 66 px of circle, and the UPGRADE SHIP wedge clears its rim by 45.2 px resting and 37.6 px SELECTED',
    'build-wheel',
    'images/a1-17-labels-390-build-button.png',
    '2026-08-13T02:50:00Z',
    'verified',
    "a0-32 ARGUES IN MEASURED PIXELS — \"the room is 63.6px and the word is 67.8px\" — so this measures pixels back, off the frames the served client drew, at 844x390. THE BUILD BUTTON. images/a1-17-labels-390-build-button.png is the round button at 4x nearest-neighbour, cropped 16 px wider than the button on every side ON PURPOSE, so the space OUTSIDE the circle is in frame and an overflow would have nowhere to hide. Two lines: BUILD in bright type, & UPGRADE in dim type beneath it. Both are inside the rim, and the rim is an unbroken ring — nothing crosses it on either side. Measured on the frame rather than judged by eye: over the seven rows the second line occupies (y 185-191), its glyphs span x 62..121, i.e. 60 px wide, while the rim's inner edge over those same rows runs 59..124, i.e. 66 px of room. Clearance 3 px on the left and 3 px on the right. The measurement separates type from rim by run structure, not brightness — & UPGRADE is drawn in the same dim ink as the rim, so a threshold alone could not have told them apart; the rim is the outermost run on each row and the type is everything inside it. Three pixels is not generous, and it is the honest number: the word fits, with about a glyph-stroke to spare per side. THE WEDGE, IN BOTH STATES, WHICH IS THE HALF THAT COULD STILL HAVE BEEN BROKEN — a selected wedge's name goes UP a size step (u16-01), so a fix measured only on the resting label would prove nothing about the state a player puts it in by pointing at it. The wheel was opened at 844x390 and the pointer swept round the hub until THE VIEW ITSELF reported the nine-o'clock wedge as selected (its own record of what it drew, `selected: true`, id `upgrade`) — the coordinate was never trusted, the readback was. RESTING (images/a1-17-labels-390-wedge-resting-zoom.png, 4x): the stack reads UPGRADE / SHIP / YOUR SHIP / OPEN ▸, upright inside a wedge that points left, with clear dark wedge face between the end of UPGRADE and the wheel's outer arc. Measured: the furthest glyph pixel in that sector sits at radius 132.8 px from the hub and the wheel's own outer rim on those same rays is at 178 px — 45.2 px of clearance. SELECTED (images/a1-17-labels-390-wedge-selected-zoom.png, 4x): the wedge face lightens and its outline brightens, and the name is visibly larger — the glyph count in the sector rises from 442 to 716 px and the furthest glyph moves out from 132.8 to 140.4. Clearance 37.6 px. So the selected state costs 7.6 px of the margin and still leaves nearly forty. Both crops also show the four other wedges (TURRET 3 / 0 of 4 BUILT, SHIELD 5 / 0 of 2, RADAR 6 / 0 of 1, REPAIR REACTOR / REACTOR FULL) and the hub reading 3 ORE over ▲ CLOSE, none of them crossing anything. ONE DISCLOSED STAGING SEAM: __upgradeWheelStage.openBuild() parks the local ship docked at its own station and opens the wheel, because the button and the wheel only exist while docked and flying there is not what is under test. It moves the same state a real dock does; every label read afterwards is what the view drew.",
  ),
];

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
if (!Array.isArray(manifest)) throw new Error('manifest.json is not an array');
let added = 0;
let updated = 0;
for (const entry of ITEMS) {
  const i = manifest.findIndex((x) => x.id === entry.id);
  if (i >= 0) {
    manifest[i] = entry;
    updated += 1;
  } else {
    manifest.push(entry);
    added += 1;
  }
}
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`a1-17: ${added} added, ${updated} updated; manifest now holds ${manifest.length} items.`);
console.log(
  `verdicts in this round: ${ITEMS.reduce((acc, i) => ((acc[i.verdict] = (acc[i.verdict] ?? 0) + 1), acc), {}) && JSON.stringify(ITEMS.reduce((acc, i) => ((acc[i.verdict] = (acc[i.verdict] ?? 0) + 1), acc), {}))}`,
);
