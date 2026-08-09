/**
 * evidence/a1-05-live-round/_entries.mjs — the a1-05 round's attestations, and
 * the one-shot that appends them to `evidence/manifest.json`. OWNER: QA Manager.
 *
 * The manifest's shape and contract are untouched: same eight keys, same order,
 * items are ADDED and nothing already in it is re-graded. Every item names the
 * sha the page reported when its shutter fired — `7e175ac` throughout, the
 * GitHub Pages deployment of 2026-08-09T21:48Z, which was still the served build
 * when the round closed.
 *
 *   node evidence/a1-05-live-round/_entries.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = resolve(HERE, '..', 'manifest.json');
const SHA = '7e175ac';

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

const ENTRIES = [
  // ── 1. The alarm belongs to the seat the SERVER gave you ─────────────────
  item(
    'a1-05-alarm-online-nonzero-slot',
    "The alarm engine's idea of 'me' on a REAL online join, at a NON-ZERO seat",
    'online',
    'images/a1-05-alarm-online-guest-match.png',
    '2026-08-09T22:07:41Z',
    'verified',
    "Two clean-boot clients against the LIVE fleet (allocator + gameserver on fly.io, both answering /health): the host pressed PLAY → CREATE A CLAIM and got room XBPW, the guest pressed PLAY → JOIN, typed X-B-P-W on the drawn keypad, and was welcomed into SEAT 1. Both rosters then read TAKEN·TAKEN·OPEN×6 with humanCount 2, and the guest's own seam reports isHost false. The host RUSHed and both clients rendered the same match. In that match the GUEST's audio engine reports local: 1, localPlayer: 1, allies: [1] — the seat the server gave it — and the host reports local: 0. The frame is the guest's: its own station is labelled YOU and drawn in P2's teal rather than P1's blue, the HOME bar top-right is teal at 100/100, and the badge along the bottom edge reads '7e175ac 0800d5b6 (iad) 228ms' — the shipped sha, the machine id of the real gameserver and a live round-trip. This is the exact shape of the s9-01 bug (every online client believing it was slot 0) and it is not present: on a non-zero slot, which is the only slot that can tell the difference, the engine is listening as the seat it was given.",
  ),

  item(
    'a1-05-alarm-rings-once-under-a-real-siege',
    'The under-attack alarm fires ONCE across a 22-second siege, and only for your own station',
    'audio',
    'images/a1-05-alarm-under-attack.png',
    '2026-08-09T22:05:11Z',
    'verified',
    "Home abandoned on the live build (?debug=1 offline match, ship flown out to open space, core left undefended) and the alarm seam polled every 1.5 s for 111 s. Nothing at all until t=88.5 s, when a bot reached the undefended reactor: engagements went 0 → 1, sounds went 0 → 1 and active went true. Fifteen further samples across the next 22.5 s all read the same — active true, engagements 1, sounds 1. The sting did not repeat once per frame, or once per hit; it rang once for the engagement, which is the developer's 'it should only play once', on the shipped bundle. `allies` reads [0] throughout, i.e. this client's own seat and nothing else, so a rival's home taking fire cannot ring it. WHAT THE FRAME DOES NOT SHOW: no on-screen under-attack tell is visible in it — the home station is off-frame and the HOME readout top-right still reads 100/100, because the engagement had not yet landed damage. The audio half of §2.2 is what this proves; the red-frame/edge-arrow half is not in this picture.",
  ),

  // ── 2. Station health at any range ───────────────────────────────────────
  item(
    'a1-05-station-health-reads-true-at-any-range',
    "A damaged rival station's ring, near and far, in one figure — and the two are the same ring",
    'hud',
    'images/a1-05-station-health-figure.png',
    '2026-08-09T21:57:57Z',
    'verified',
    "Four frames from one frozen boot of the live build, composited: top row a rival core at 35%, bottom row the same core at 100%; left column staged 120 units off the station surface, right column 480. Every panel draws a ring around the station and a lit 'Rusty (EASY)' plate over it — there is no range at which the ring stops being drawn. The two damaged panels read identically: sampling the drawn circle at radius 69 px gives 34.9% cyan / 65.1% red at 120 units AND 34.9% / 65.1% at 480 units, against a staged core fraction of 0.35 — the arc is proportional to the core and does not change with distance. The two healthy panels are 100.0% cyan / 0.0% red at both ranges. The display this replaced asserted a falsehood at range; this one does not.",
  ),

  // ── 3. An ally's win is a win ────────────────────────────────────────────
  item(
    'a1-05-end-screen-calls-an-ally-win-a-victory',
    "Your side wins with an ALLY crowned — the end screen says CLAIM HELD, not DEFEAT",
    'match',
    'images/a1-05-end-ally-victory.png',
    '2026-08-09T21:55:48Z',
    'verified',
    "A sided match on the live build (?debug=1&sides=2; this client's side is slots [0,2,4,6]) with every core outside that side destroyed, leaving an ALLY — slot 6 — holding a reactor alongside the local one. The screen the client resolved reads kind 'victory', headline 'CLAIM HELD', subhead 'Your side took the claim — Player 7 held it.', with REMATCH and BACK TO MENU offered. Nothing on it says defeat, and the sentence names the ally who held it rather than pretending the local player did. The developer's screenshot of this scenario read DEFEAT with 'Player 7 took the claim' underneath it; on this build the same staging reads as a win.",
  ),

  item(
    'a1-05-eliminated-then-ally-wins',
    "…including the path the report came from: eliminated first, then your side wins",
    'match',
    'images/a1-05-end-eliminated-then-ally-wins.png',
    '2026-08-09T21:55:54Z',
    'verified',
    "The same sided match, walked the hard way. The local reactor is destroyed first and the DEFEATED overlay comes up correctly: 'ELIMINATED' in threat red, '8th of 8 — your reactor was destroyed.', REMATCH and SPECTATE (a1-05-end-eliminated-defeated.png). SPECTATE is taken, the match plays on, and then every core outside this client's side falls. The result screen that follows reads 'CLAIM HELD' with 'Your side took the claim — Player 7 held it.' and +215 XP still paid to a player who was already out. So a client that has been eliminated and is watching from the outside is still told its side won, in a win's words. Note for the record: the rule under the headline is drawn grey here and blue on a win the local player was alive for (a1-05-summary-settled.png); both frames say CLAIM HELD, but they do not carry the same accent.",
  ),

  // ── 4. The lobby picks the character ─────────────────────────────────────
  item(
    'a1-05-lobby-picks-the-character-not-the-tier',
    'The roster names a CHARACTER per seat and shows its tier as a label',
    'boot',
    'images/a1-05-lobby-character-cycled.png',
    '2026-08-09T22:03:55Z',
    'verified',
    "PLAY → PLAY SOLO on the live build, driven by real clicks at the points the client itself reported drawing. The roster comes up with a named cast, one per bot seat — P2 Rusty (HAULER), P3 Bolt (INTERCEPTOR), P4 Foreman (EXCAVATOR), P5 Patch, P6 Sable, P7 Vulture, P8 Warden — each row carrying its hull under the name, its difficulty in a column of its own as a WORD (EASY / MEDIUM / HARD) and a `?`. The tier column holds no control: it is shown, not chosen. A real click on P2's row BODY cycled the character rusty → bolt, and this frame is that state — P2 now reads 'Bolt 1 · INTERCEPTOR' beside P3's 'Bolt 2 · INTERCEPTOR', the duplicate disambiguated by the view rather than refused, and P2's tier following the new character from MEDIUM-for-Rusty to EASY. RUSH! was then pressed and the built world's own cast reads [null, bolt, bolt, foreman, patch, sable, vulture, warden] — the pick reached the sim, which is the half of a0-06 that was missing. Also on screen: MODE · FFA, YIELD · SCARCE, '1 PLAYING · 7 BOTS', and the badge 7e175ac.",
  ),

  item(
    'a1-05-codex-opens-by-tap-at-390px',
    "`?` opens the dossier BY TAP on a 390 px phone",
    'mobile',
    'images/a1-05-codex-390-after-tap.png',
    '2026-08-09T22:04:07Z',
    'verified',
    "A 390×844 phone (deviceScaleFactor 3, hasTouch) on the live build, held portrait so the whole lobby is under the landscape lock — the frame is rotated 90°, which is the shipped behaviour. Every roster row draws a `?`. ONE touchscreen tap on P2's `?`, at the physical point the client reported for it, opened the dossier: a panel over the roster reading 'Rusty — the timid hoarder / Easy · Hauler (Hammerhead) / Easy. Mines slowly, over-defends, and clutches its ore. Flies a Hauler.' No long press was needed — the seam read back hintTitle 'Rusty — the timid hoarder' after the single tap. The rest of the screen is legible at this width too: MODE · FFA, YIELD · SCARCE, '1 PLAYING · 7 BOTS', the ship card, MAP · CHANGE showing The Ring, and RUSH!. ONE BLEMISH: the dossier's last line is clipped by the panel's right edge — 'Flies a Hauler. LVL…' runs into the border rather than wrapping.",
  ),

  // ── 5. One cost number ───────────────────────────────────────────────────
  item(
    'a1-05-build-wedge-one-cost-number-payable',
    'The build wheel at 9 ore: one number per wedge, all of them yellow, ORE top-left',
    'build-wheel',
    'images/a1-05-wheel-ore-9.png',
    '2026-08-09T21:58:30Z',
    'verified',
    "The Build wheel open on the live build with 9 ore banked. Five wedges. TURRET shows the single numeral 3, SHIELD 5, RADAR 6, all in signal yellow; under each is its cap count ('0 / 4 BUILT', '0 / 2 BUILT', '0 / 1 BUILT') and above it what it spends on ('YOUR STATION'). REPAIR REACTOR shows 1 in grey with 'REACTOR FULL' as its reason, and UPGRADE SHIP shows 'OPEN ▸' rather than a price. Nowhere on the wheel is a cost written as a pair — no '3/9', no 'cost/held'. The held total appears once, in the hub: a large 9 over the word ORE, with CLOSE · ESC beneath it, and once more in the top-left corner where the word ORE sits above the numeral 9. The prompt band reads 'Spend ore on defense — or UPGRADE SHIP to mine and hit harder'.",
  ),

  item(
    'a1-05-build-wedge-unpayable-is-red',
    "…and at 2 ore the same three numbers turn red, in place",
    'build-wheel',
    'images/a1-05-wheel-ore-2.png',
    '2026-08-09T21:58:30Z',
    'verified',
    "The same open wheel, same boot, bank re-priced to 2 ore without closing it. TURRET's 3, SHIELD's 5 and RADAR's 6 are unchanged as numbers and are now drawn in threat red; their labels have dimmed with them. The hub reads 2 over ORE and the top-left reads ORE / 2, both still yellow — the total is what you have, not a price, and it is not recoloured. REPAIR REACTOR's 1 stays grey ('REACTOR FULL' — refused for a different reason) and UPGRADE SHIP still reads 'OPEN ▸'. So the wedge carries exactly one number and that number carries the affordability: yellow when the bank covers it, red when it does not.",
  ),

  // ── 6. The loot tell ─────────────────────────────────────────────────────
  item(
    'a1-05-full-hold-tell-flashes-and-clears',
    'A full hold flashes under the ship; a hold with room in it does not',
    'hud',
    'images/a1-05-hold-flash-figure.png',
    '2026-08-09T22:04:17Z',
    'verified',
    "Three panels, each a 3× nearest-neighbour blow-up of the same 160×36 strip under the ship, from one live boot. Top: hold 6/6 — six pips in full signal yellow. Middle: the SAME full hold ~90 ms later — the identical six pips, dimmed to olive. Bottom: hold 3/6 — three bright pips and three dark ones. A 16-frame burst measures it rather than leaving it to the eye: with the hold FULL the strip's mean luminance alternates between 12.57 and 22.19 (spread 9.6) across the burst; with the hold at 3/6 it is 15.253 in all sixteen frames, spread 0.0. So the full hold has a tell — a ~2 Hz blink of the pips — and the tell is gone the moment there is room in the hold. The clearing was also watched end to end: 6 in the hold, docked, and over five seconds the hold drains to 0 while the top-left total climbs 3 → 8 and the flashing row disappears (a1-05-loot-hold-freed.png). CAVEAT ON SCOPE: what is proven here is the FULL-HOLD tell. The sim also sets a per-kill `lootTake` / `lootBlocked` on the ship each tick, and I could find nothing outside src/sim that reads either, so I cannot claim a distinct tell for 'this particular kill's ore bounced off a full hold'.",
  ),

  // ── 7. Rooms and offline ─────────────────────────────────────────────────
  item(
    'a1-05-new-room-starts-empty',
    'A freshly created room: eight seats, the host in one, seven OPEN and no bots',
    'online',
    'images/a1-05-room-starts-empty-crop.png',
    '2026-08-09T22:01:14Z',
    'verified',
    "PLAY → CREATE A CLAIM on the live build against the live allocator, which minted room PLJ4. The roster that comes up is: P1 TAKEN — 'YOU ★', VANGUARD — and P2 through P8 all reading OPEN, with no character named on any of them (seatCharacters is eight nulls) and no BOT anywhere. N reads 1, humanCount 1. The room is real, not a local fiction: the allocator answers a join for PLJ4 with 200 while the lobby is up. This is the developer's report satisfied — the room fills with people if people come, and it is up to the host to add bots.",
  ),

  item(
    'a1-05-all-bot-match-reverts-to-offline',
    'Host plus bots presses RUSH!: the match plays, and the room is handed back',
    'online',
    'images/a1-05-all-bot-match-offline.png',
    '2026-08-09T22:01:14Z',
    'verified',
    "From that same empty room PLJ4, two seats were cycled OPEN → BOT with real clicks (roster then TAKEN·BOT·OPEN·OPEN·BOT·OPEN·OPEN·OPEN, N=3) and RUSH! pressed. The match boots and this frame is it, three seconds in: the world is up, the local station labelled YOU, and one line sits under the wave clock — 'NOBODY JOINED — PLAYING LOCALLY' — with zero buttons on it. A tell, not a dialog. The claim that matters was put to the ALLOCATOR rather than the client: a join for PLJ4 is refused after RUSH, so the room really was released rather than merely abandoned by this client. Twelve seconds later the match is still running with bots flying it (a1-05-all-bot-match-running.png).",
  ),

  // ── 8. Nameplates ────────────────────────────────────────────────────────
  item(
    'a1-05-nameplates-lit-over-a-ship-in-combat',
    "A nameplate over a ship taking fire — same plate, same brightness as at rest",
    'hud',
    'images/a1-05-nameplates-in-combat-crop.png',
    '2026-08-09T22:09:14Z',
    'verified',
    "A frozen frame on the live build with a bot parked in open space beside the local ship, put into a real fight: hull knocked to 45% and the sim's own firing flag set. In the crop the bot carries 'Rusty (EASY)' above it, a health bar under the name reading 32/70 part-filled, and a cyan turret beam running up into it from a turret whose own bar reads 10/10. The plate is not dimmed, hidden or deferred by the combat: the layer reports alpha 0.92 for it, which is the same 0.92 it reported for the same plate in the quiet frame taken moments earlier from the same boot (a1-05-nameplates-quiet.png), and the station plate below is drawn at 0.92 too. Corroborated on the ordinary player path as well — a lobby-booted match shows 'Warden (HARD)' and 'Bolt (EASY)' both lit at once, the latter over a 35/35 bar (a1-05-wave-clock-lobby-full.png).",
  ),

  // ── 9. The wave clock — the round's red ──────────────────────────────────
  item(
    'a1-05-wave-clock-counts-150-not-180',
    "FAILED — the lobby says YIELD · SCARCE and the clock counts to 150 s",
    'hud',
    'images/a1-05-wave-clock-lobby-early.png',
    '2026-08-09T22:00:25Z',
    'failed',
    "The real player path on the live build: PLAY → PLAY SOLO → a lobby whose own chip reads 'YIELD · SCARCE' and whose seam reports abundance 'scarce' → RUSH!. Four seconds into the match the clock reads 'WAVE 1/5 · Outer Drift / NEXT 2:27 / MATCH 0:04'. 4 + 147 = 151. SCARCE's interval is WAVE_INTERVAL_S × 1.2 = 150 × 1.2 = 180 s, so the first wave should be 2:56 away at that moment, not 2:27. The same reading appears everywhere I looked on this build, always summing to ~151: MATCH 0:05 → NEXT 2:26 and MATCH 0:37 → NEXT 1:54 in a ?debug=1 match; MATCH 0:03 → NEXT 2:28 in a lobby-booted one; MATCH 1:39 → NEXT 0:52 later in the same match. The clock is counting the BASELINE 150 s. I cannot tell from the screen alone whether the clock is reading the wrong interval or the SCARCE abundance the lobby shows never reached the world it built — but the promise 'the wave clock counts to the interval the match actually uses, and SCARCE is the default at 180 s' is not kept on the served build either way.",
  ),

  item(
    'a1-05-wave-clock-150-in-an-online-match-too',
    "FAILED — and it is 150 s in a real ONLINE match as well",
    'hud',
    'images/a1-05-alarm-online-guest-match.png',
    '2026-08-09T22:07:41Z',
    'failed',
    "The guest's frame from the live online match on the fly.io gameserver (badge '7e175ac 0800d5b6 (iad) 228ms'), six seconds in: 'WAVE 1/5 · Outer Drift / NEXT 2:25 / MATCH 0:06'. 6 + 145 = 151 again. So this is not an artefact of the offline boot or of the local-revert path: a match created through the doors, hosted on a real server and joined by a second client counts its first wave down from 150 s, the baseline, not from SCARCE's 180. Recorded separately from the solo reading because a wave interval that is wrong on the wire is a different blast radius from one that is wrong offline.",
  ),

  // ── 10. The backdrop and the sky ─────────────────────────────────────────
  item(
    'a1-05-darker-backdrop-is-floor',
    'The backdrop the shipped build paints is Floor #010204',
    'art',
    'images/a1-05-backdrop-frozen-desktop.png',
    '2026-08-09T21:57:46Z',
    'verified',
    "A frozen 1280×800 scene from the live build. Sampling the play area (x 20–1040, y 100–740, every other pixel) the modal colour is #010204 at 64.7% of the pixels, with #020206 (15.5%) and #010207 (9.4%) behind it — the star-field's own dither over the same ground. #010204 is Floor exactly, the ground the developer picked off the backdrop compositor on 2026-08-07 ('i like floor'), and it is a long way below the Vacuum #0D1015 it replaced as the backdrop. The frame carries it too: the rock family reads as a dark slab (the fourth-commonest colour in the sample is the rocks' #484E57 at 1.25%), the station's blue rings and the ore's yellow are the brightest things on screen, and the HUD text sits over near-black rather than over a wash. The darker backdrop is on the served build.",
  ),

  item(
    'a1-05-sky-parallax-not-camera-locked',
    'INCONCLUSIVE — the backdrop is provably not glued to the camera, but this arena has no sky to track',
    'art',
    'images/a1-05-sky-flight-1.png',
    '2026-08-09T21:57:50Z',
    'inconclusive',
    "Three frames along one straight flight on the live build, the camera moved 844 world units (one screen-width) between each. Between the second and third frames — both of which are open sky with no station or asteroid in them — the best horizontal re-alignment of one onto the other is a shift of 219 px, at which the mean absolute difference is 0.108; at a shift of ZERO it is 0.464, more than four times worse, with no local minimum there at all. So the backdrop travels when the ship travels: nothing in it is pinned to the glass, which is the shape of the developer's complaint. What I CANNOT show from these frames is the claim as stated — that the SKY rides with the far stars rather than ahead of them. The arena the boot builds (The Ring, wave 'Outer Drift') paints almost no sky: only 2.4% of the sampled region carries any luminance between 4 and 20, and there is no clot bright enough to track across three frames. Separating a 72 px sky from an 84 px deep-star layer needs a sky-rich arena, and I could not reach one from the live build without hand-flying a lobby match onto a specific map. Reported as unproven rather than passed.",
  ),

  // ── 11. The progression chain ────────────────────────────────────────────
  item(
    'a1-05-summary-sequence-counts-up',
    'The end-of-match summary counted, beat by beat, off one match',
    'match',
    'images/a1-05-summary-beat-2.png',
    '2026-08-09T21:56:03Z',
    'verified',
    "One match on the live build, won, with its summary clock pinned at four points so the same sequence could be photographed four times instead of raced. Beat 0 (phase 'result'): the headline and the stat labels are up, every value reads 0 or '—', XP EARNED reads +0 XP, LEVEL 1, the bar is empty and the buttons are dead. Beat 1.2 s (phase 'rows'): still counting in. Beat 3.0 s (phase 'total', the frame here): the rows have landed on their real values — ORE MINED 6 with '+6 XP' beside it, DAMAGE DEALT 0 HP, SHIPS DESTROYED 0, SHIPS USED 1 — and XP EARNED has climbed to +395 XP. Beat 6.0 s (phase 'fill'): LEVEL 2 with the bar part-filled and leveledUp true. It counts up; it does not simply appear.",
  ),

  item(
    'a1-05-xp-paid-and-a-level-earned',
    'The settled summary: +395 XP, LEVEL 2, and the profile written to disk',
    'match',
    'images/a1-05-summary-settled.png',
    '2026-08-09T21:56:03Z',
    'verified',
    "The same sequence, let go and allowed to settle. 'CLAIM HELD / You took the claim. / MATCH TIME · 00:08' on the left; on the right, the ledger with its per-row XP — ORE MINED 6 → +6 XP (one XP per ore, the ratified weight), DAMAGE DEALT 0 HP → +0 XP, SHIPS DESTROYED 0 → +0 XP, STATIONS DESTROYED — → +0 XP, and the three unpaid rows (DISTANCE TRAVELLED, SHIPS USED, ORE USED) carrying no XP column at all. Then XP EARNED +395 XP, LEVEL 2, a part-filled bar and '+395 XP · 814 TO NEXT'. That last number is the ratified curve visible on screen: 300 XP to reach level 2 and 909 more to reach level 3 (300 × L^1.6), and 395 + 814 = 1209 = 300 + 909. The career the boot read back afterwards is xp 395, level 2, matches 1, and localStorage holds {\"v\":1,\"xp\":395,\"level\":2,\"matches\":1} under planet-rush:profile. The build badge in the corner of the frame reads 7e175ac.",
  ),

  item(
    'a1-05-lobby-level-badge-after-the-win',
    'The level the match paid, back on the lobby roster after a reload',
    'boot',
    'images/a1-05-lobby-level-badge.png',
    '2026-08-09T22:01:40Z',
    'verified',
    "The same browser, the same origin, the chain walked end to end. A match on the live build was won and its summary skipped; the career went from xp 0 / level 1 / 0 matches to xp 355 / level 2 / 1 match. The page was then RELOADED clean — no debug flag, main menu, PLAY, PLAY SOLO — and the roster that comes up carries 'LVL 2' on the local player's row. Exactly one row carries a badge: the seam reports ['LVL 2', null, null, null, null, null, null, null], and no row anywhere shows an XP total, which is the ratified ruling (show the level, in the lobby, never the XP). The badge was drawn, not merely modelled — the client reported its bounds as a real 54×63 px box on the roster, and the crop at a1-05-lobby-level-badge-crop.png is that box.",
  ),

  item(
    'a1-05-hangar-honest-empty-state',
    "The HANGAR, and the sentence it says instead of nothing",
    'boot',
    'images/a1-05-hangar-empty-state.png',
    '2026-08-09T22:01:40Z',
    'verified',
    "The fourth door on the live build, opened from the main menu after that same win. Title HANGAR, 'FLEET BAY · YOUR RECORD' opposite. Left: the ship in the bay, drawn — a VANGUARD, named ANVIL, with its line 'All-rounder. Does everything second-best — the one to learn the game in.' Right: 'LEVEL 2', '55 / 909 XP', a part-filled bar, '854 TO LEVEL 3' and '1 MATCH'. Below that, the panel where cosmetics would go, and in it the sentence that makes this screen honest rather than broken: 'No cosmetics yet — they unlock as you level up.' BACK is the only other control. A hangar with no cosmetics and no sentence would be indistinguishable from a hangar that failed to load; this one tells you which it is.",
  ),

  // ── A finding that is not one of the ten ─────────────────────────────────
  item(
    'a1-05-clean-boot-typeerror',
    'INCONCLUSIVE — one uncaught TypeError per clean-boot session that I could not pin down',
    'boot',
    'images/a1-05-menu-after-a-win.png',
    '2026-08-09T22:01:40Z',
    'inconclusive',
    "Recording this because it is real and I could not make it reproducible, not because it broke anything visible. Every one of the six clean-boot captures in this round logged exactly ONE uncaught exception from the served bundle: 'TypeError: Cannot read properties of null (reading \"clear\")', thrown inside a Pixi Graphics clear() from an update on the shipped index-De5ilkwi.js — i.e. something being drawn after its context is gone. It appeared once per session on desktop and on the 390 px phone, on the doors, in the lobby and in a match, and never on a ?debug=1 boot. Nothing on screen went wrong in any frame I shot. I then tried to isolate it: a scripted walk of menu → doors → lobby → RUSH with generous idles logged ZERO errors, and adding full and clipped screenshots to that walk still logged zero. So I can say the shipped client throws it during ordinary front-door use, and I cannot say what provokes it. Someone who owns this code should read the stack in evidence/a1-05-live-round/readback.json before it becomes a crash rather than a log line.",
  ),
];

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
if (!Array.isArray(manifest)) throw new Error('manifest is not an array');
const seen = new Set(manifest.map((i) => i.id));
const added = [];
for (const entry of ENTRIES) {
  if (seen.has(entry.id)) {
    // Re-run: replace this round's own item in place, never touch anyone else's.
    manifest[manifest.findIndex((i) => i.id === entry.id)] = entry;
    continue;
  }
  manifest.push(entry);
  added.push(entry.id);
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
console.log(`${added.length} added, ${ENTRIES.length - added.length} replaced; manifest now ${manifest.length} items`);
