/**
 * evidence/a0-131-online-with-eyes/manifest-entries.mjs — merge a0-131's
 * attestations into `evidence/manifest.json`. OWNER: QA Manager (a0-131).
 *
 * Every attestation below was written AFTER looking at the image it points at.
 * Where the two clients disagreed, both frames are on the plate and the entry
 * names which screen showed what; nothing is averaged into one verdict.
 *
 *   node evidence/a0-131-online-with-eyes/manifest-entries.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HERE } from './lib.mjs';

const MANIFEST = join(HERE, '..', 'manifest.json');
const AT = '2026-08-22T11:40:00Z';
const SHA = '01a83531';

/** The rig every one of these frames came off, repeated in short at the head of
 *  each attestation because a reader should never have to go looking for it. */
const RIG =
  'PRODUCTION BUNDLE built with VITE_ALLOCATOR_URL at a REAL local fleet (tests/net/local-fleet.ts: a real allocator, a Fly-shaped edge, two ticket-enforcing Machines), served by vite preview. TWO browser contexts against ONE room over real WebSockets: HOST = desktop 1280x800 dpr2 pointer, JOINER = phone 798x384 dpr2 touch (a0-111\'s two profiles, unchanged). Clean boot, ?gate=0 only - no ?freeze=1, so the build stamp 01a8353 is in the corner of every frame.';

const ENTRIES = [
  {
    id: 'a0-131-the-join-path-end-to-end-on-both-clients',
    title: 'HOST mints a code and the joiner types it in - every screen both clients see, and all of them work as displayed',
    area: 'online',
    image: 'images/a0-131-join-path-both-clients.png',
    verdict: 'verified',
    attestation:
      `${RIG} BRIEF ITEM 1. Top row, HOST: the doors screen carries four plates - CAMPAIGN ("A run of linked contracts"), SOLO ("Play on your own against bots. No internet needed."), HOST ("Start a new game and get a code for friends to join") and JOIN ("Type in a friend's code to join their game") - and while the room is being allocated the TITLE reads "DIALING MACHINE 4d891e33...". The door is labelled HOST, not CREATE. The lobby it lands on says CREW MUSTER, JOIN CODE C7TV top right, the chips MODE - FFA / YIELD - SCARCE / VISIBILITY - PUBLIC, one roster row "P1 YOU * -4ms VANGUARD / LVL 1" and seven OPEN, and at the foot "NEEDS 2 - ADD A BOT OR WAIT" beside a dimmed RUSH!. Bottom row, JOINER: the JOIN door opens on ENTER THE ROOM CODE with four empty boxes over an A-Z + 2-9 keypad and BACK / ERASE / JOIN; after four characters the boxes read C 7 T V and the title has become "ROOM IN IAD - PING -"; the third frame is the guest lobby, P1 PLAYER 1 *, P2 YOU LVL 1, MAP - HOST\'S, "WAITING FOR THE HOST" and a dimmed RUSH!. It worked exactly as displayed: the code shown was the code accepted, and the joiner was seated. TWO THINGS I DID NOT CATCH AND WILL NOT CLAIM: the joiner\'s "connecting" state - the screenshot 120 ms after JOIN was already the lobby, because a loopback fleet answers faster than that, so the third bottom frame is the joined lobby and not a connecting screen; and the JOIN preview\'s ping, which reads "PING -" with an em dash rather than a number on this local fleet.`,
  },
  {
    id: 'a0-131-the-code-on-the-host-screen-is-the-code-the-joiner-typed',
    title: 'JOIN CODE C7TV on the host\'s lobby, C 7 T V in the joiner\'s four boxes - read off the two screens and compared, not taken from the wire',
    area: 'online',
    image: 'images/a0-131-join-code-read-off-the-screen.png',
    verdict: 'verified',
    attestation:
      `${RIG} BRIEF ITEM 1, the half that has to be done by eye. Left: a 3x nearest-neighbour magnification of the top-right corner of the host\'s lobby (frame 1-04, rect 2270,20 270x120). It reads "JOIN CODE" in small letter-spaced grey caps with "C7TV" under it in large white. Right: a 3x magnification of the joiner\'s four code boxes (frame 1-07, rect 870,185 480x125), reading C, 7, T, V - one character per box. I read both magnifications with my own eyes and they are the same four characters in the same order. HOW THE CHARACTERS GOT TYPED, STATED PLAINLY: the harness read the code from the __lobby seam and pressed it one character at a time, so this plate does not prove that a HUMAN could transcribe it - it proves that what the host\'s screen displayed and what the joiner\'s screen displayed are the same string, which is the thing a wrong-code bug would break. The typeface distinguishes the pairs that matter here: the 7 has a bar, the C is open, the V is pointed.`,
  },
  {
    id: 'a0-131-two-clients-one-moment-agree-on-every-number',
    title: 'The same instant on both screens: identical wave, clock and hull numbers - and the desktop can see both ships while the phone can see only one',
    area: 'online',
    image: 'images/a0-131-same-moment-two-clients.png',
    verdict: 'verified',
    attestation:
      `${RIG} BRIEF ITEM 2. Both frames were requested together and awaited together - that is two concurrent captures tens of milliseconds apart, NOT a hardware-synchronised capture, and nothing here should be read as one. Top, HOST: "WAVE 1/5 - Outer Drift", "NEXT 2:35", "MATCH 0:26", ORE 3, HOME 100/100, its own hull bar reading 12/50 at the centre of the screen, and to the right P2\'s station (teal ring with a red damage arc) with P2\'s ship beside it nameplated "P2" and 15/50. Bottom, JOINER: "WAVE 1/5 - Outer Drift", "NEXT 2:35", "MATCH 0:26", ORE 3, its own station centred and labelled YOU, its own hull 15/50, HOME 92/100, VIEW 1x, and a red vignette around all four edges. THE TWO CLIENTS AGREE ON EVERY NUMBER THEY BOTH SHOW: same wave name, same NEXT, same MATCH clock, same ORE, and the joiner\'s hull is 15/50 on both screens. Each HOME reads its own station (100/100 for the host, 92/100 for the joiner), which is agreement rather than a conflict. They differ in what is DRAWN, and that difference has its own entry: measured off the host\'s frame the two ships are 416 world units apart, and one world unit is one CSS pixel (src/ui/viewport.ts), so 416 fits inside the desktop\'s 1280-wide view and does not fit inside the phone\'s 798.`,
  },
  {
    id: 'a0-131-the-phone-cannot-see-the-player-shooting-it',
    title: 'DISAGREEMENT: at the shipped VIEW 1x the phone player is being shot by an attacker its screen does not draw - the desktop attacker can see them the whole time',
    area: 'online',
    image: 'images/a0-131-phone-cannot-see-its-attacker.png',
    verdict: 'failed',
    attestation:
      `${RIG} BRIEF ITEM 2, recorded as its own entry because it is a disagreement between the two clients. TOP PANE, the phone at VIEW 1x (MATCH 0:26): its own station centred, its own hull falling (15/50), HOME 92/100, a red vignette on all four edges - and NO attacker anywhere on the glass. There is no arrow, no marker and no nameplate for the ship that is doing it; the vignette is the only tell, and a vignette has no direction. MIDDLE PANE, the same phone after its own VIEW control was pressed twice for real at the rect src/ui/zoom-control.ts reports (718,61 64x48), now reading VIEW 2x (MATCH 2:12): the attacker is on screen, nameplated "P1", hull 12/50, out to the left. BOTTOM PANE, the desktop at the same instant as the middle pane (MATCH 2:12): it draws BOTH ships - its own 12/50 and "P2" 15/50 - and has drawn both throughout. THE ARITHMETIC BEHIND IT, because it is not a glitch but a consequence: one world unit is one CSS pixel (src/ui/viewport.ts), the standoff was 416 units, the desktop sees 1280 units across and the phone 798, so the attacker sits 17 pixels outside the phone\'s half-width. I am recording this FAILED because a player being shot cannot see or locate who is shooting them on the narrower of the two supported screens, while their opponent sees everything. What softens it, and is on the plate: the phone has a VIEW control the desktop does not, one tap widens it to 1596 units, and at 2x the attacker is drawn. Whether the default should be the wide one is the developer\'s call; what the frames establish is that at the shipped default it is not.`,
  },
  {
    id: 'a0-131-a-shot-fired-by-the-other-player',
    title: 'A remote player\'s shot, on both screens at one instant - the heading agrees to within a couple of degrees, but I could not follow one bolt across frames',
    area: 'online',
    image: 'images/a0-131-a-shot-fired-by-the-other-player.png',
    verdict: 'inconclusive',
    attestation:
      `${RIG} BRIEF ITEM 3, the developer\'s report: "other players' shots don't follow the direction they were fired in." Staged with the DESKTOP as the shooter (it is driven with real mouse clicks on the shipped "Click anywhere - Move or attack" control) and the PHONE at VIEW 2x as the observer, so every bolt on the phone\'s screen is another player\'s. Top, the shooter\'s own screen: its ship at 5/50 on the left and a long thin BLUE TRACER running from its nose up and to the right into the centre of the teal station it is attacking. Bottom, the observer\'s screen at the same instant: the attacker drawn as "P1 - 5/50" with its hull bar and ship glyph, its own station\'s rim carrying a red damage arc, and a short bright red-and-white streak at the point of impact on that rim. I measured both off the pixels: on the shooter\'s frame the tracer runs at about -22 degrees; on the observer\'s frame the line from the attacker\'s ship to the impact point is about -23 degrees and the streak itself lies at about -20. So for THIS shot the direction the observer sees is the direction it was fired in, within a couple of degrees. WHY THIS IS INCONCLUSIVE RATHER THAN VERIFIED, stated in full: (1) it is ONE shot - the attacker was near-stationary and the target was a station, which is not the manoeuvring case the report is likely about; (2) this headless lane renders the game at a MEASURED 2.7-2.8 rAF frames per second (measured in-page in the same run), so I never had one identifiable bolt in two consecutive frames and could not track a projectile the way the brief asks; (3) I cannot tell from these frames whether the short red streak IS the projectile or is an impact effect drawn where it landed. What is established is what is written above; the rest is not.`,
  },
  {
    id: 'a0-131-the-same-shot-is-drawn-two-different-ways-on-the-two-clients',
    title: 'DISAGREEMENT: your own fire draws a tracer the whole way to the target; the same shot on the other player\'s screen is a streak at the impact and nothing else',
    area: 'online',
    image: 'images/a0-131-the-same-shot-drawn-two-ways.png',
    verdict: 'inconclusive',
    attestation:
      `${RIG} BRIEF ITEM 3, recorded separately because the two clients drew the same event differently and the brief asks for that as its own entry. Both crops are the same instant (frames X-fire-0-4, host and joiner). TOP, 2x magnification of the shooter\'s own screen: a continuous thin blue line from the ship\'s nose across roughly 300 pixels of open space into the middle of the target station, plus a separate small blue chevron in flight below it. BOTTOM, 3.75x magnification of the observing client\'s screen at the same instant: the attacker\'s ship and its "P1 5/50" nameplate are drawn, the target station\'s damage arc is drawn - and between the two there is NO line at all. What the observer gets is a short bright streak and a white flare AT the station rim where the shot lands. INCONCLUSIVE, deliberately: I can see that the presentation differs, and I cannot tell from frames whether that is intended (a local-ship tracer that remote ships are not meant to get) or the visible edge of the bug the developer reported. It is put here because it is the difference a player would describe as "I can't tell what the other guy is shooting at", and it wants a ruling rather than a guess.`,
  },
  {
    id: 'a0-131-a-dropped-client-is-told-nothing-and-freezes',
    title: 'FAILED: 30 seconds after the joiner\'s link is cut its screen is frame-for-frame identical to the moment of the drop - no banner, no message, the clock stopped at MATCH 1:16',
    area: 'online',
    image: 'images/a0-131-dropped-client-frozen-for-30s.png',
    verdict: 'failed',
    attestation:
      `${RIG} BRIEF ITEM 4. THE DROP IS EMULATED and no part of this is evidence about a real radio: Playwright took the joiner\'s whole browser context offline mid-match, which closes its WebSocket the way a phone losing signal does, and it is evidence about exactly that. TOP ROW, the dropped client\'s clock at +2.5 s, +8 s and +30 s after the cut: "WAVE 1/5 - Outer Drift / NEXT 1:45 / MATCH 1:16" in all three - the same numbers, not merely similar. The rest of that client\'s screen is likewise unchanged across the three full frames: hull 19/50, HOME 92/100, and the build badge\'s ping suffix frozen at 356ms while the host\'s ticks 372 / 392 / 385. BOTTOM ROW, the host\'s clock at the same three instants: MATCH 1:18, 1:30, 1:53 - running normally. THE FINDING IS THE ABSENCE: on the dropped client there is no banner, no "reconnecting", no greyed-out state and no error - the match simply stops, and for at least thirty seconds nothing on the screen says why. A player looking at this would reasonably conclude the game had hung. src/net/link-loss-view.ts exists and tests/live-stage has evidence PNGs for a LOST / RECONNECT / RECOVERED sequence, so there is a surface for this; on this build, on this drop, none of it came up.`,
  },
  {
    id: 'a0-131-the-host-is-not-told-that-the-other-player-dropped',
    title: 'FAILED: the host plays on with no notice that the only other human is gone - the one visible change is the rival station\'s minimap blip going dark',
    area: 'online',
    image: 'images/a0-131-drop-what-each-client-sees.png',
    verdict: 'failed',
    attestation:
      `${RIG} BRIEF ITEM 4, the other half of the question the brief asks: "is the player marked as gone, and how?" Left column, both clients before the cut; right column, both clients thirty seconds after it. The HOST\'s two frames (top row) are a live match either side: MATCH runs on, HOME 100/100, its ship respawned at its own station. Nothing anywhere on the host\'s screen names the other player, says a player left, or marks a seat. The roster that carries names is a lobby screen and the lobby is gone once the match starts, so there is nowhere for a "P2 disconnected" to appear and nothing appears. The ONE difference I can see between the before and after frames is in the minimap in the bottom-right corner: the rival station\'s blip is a bright pink-red square before the drop and a dark maroon one after it. That is the entire notification. Recorded FAILED because a player cannot be expected to read a two-pixel colour change on a corner map as "the other human has gone", and because the answer to "is the player marked as gone" has to be a word somewhere and there is none.`,
  },
  {
    id: 'a0-131-rejoining-a-running-match-is-refused-outright',
    title: 'FAILED: a fresh client typing the correct code into a live match is told "REFUSED: match-live - that match already started" - the developer\'s ruling is that this must work',
    area: 'online',
    image: 'images/a0-131-rejoin-refused-match-live.png',
    verdict: 'failed',
    attestation:
      `${RIG} BRIEF ITEM 4, and the answer the brief asks for in words: A PLAYER WHO COMES BACK AS A FRESH CLIENT CANNOT GET BACK INTO A RUNNING MATCH. A third phone-profile client was booted while room C7TV was still playing, walked to JOIN, and typed the same four characters the host\'s lobby had displayed. Top pane: the keypad with C 7 T V in the boxes and JOIN live. Middle pane: the answer, three seconds later. Bottom pane: that line at 2x - "REFUSED: match-live - that match already started" in red, with "DOWNLOAD LOG to report this." under it and RETRY / DOWNLOAD LOG beneath that. RETRY is offered and cannot help: the refusal is about the match being live, and it will still be live. The developer\'s ruling is quoted in the brief - "i should be able to join back if the match is still on-going no matter what" - and this screen is its exact opposite. The seam readback beside the frame says the same thing in the same words (status "error", title "REFUSED: match-live - that match already started"), and the image is what a player would actually see. What this entry does NOT cover, because it has its own: the same client redialling inside the grace window, which does work.`,
  },
  {
    id: 'a0-131-the-same-client-does-recover-when-its-link-comes-back',
    title: 'VERIFIED: the client whose socket returns is put back into the running match, caught up and playing - the grace path works even though the fresh-client path does not',
    area: 'online',
    image: 'images/a0-131-same-client-recovers-on-reconnect.png',
    verdict: 'verified',
    attestation:
      `${RIG} BRIEF ITEM 4, the good half, and the reason the rejoin answer has to be given in two sentences rather than one. The SAME browser context that had been offline for thirty seconds was put back online. Left, before: the frozen frame, MATCH 1:16, ping 356ms, hull 19/50, ORE 3. Right, twelve seconds after the link returned: MATCH 2:11 - it has caught up to real time rather than resuming from where it stopped - NEXT 0:50, HOME 92/100, ping 707ms, and the ship still the player\'s own at 1/50 with ORE 1. No error screen, no refusal, no return to the menu: it is simply in the match again. The hull and ore numbers changed while the player could not act, which is what being absent from a live match costs. TAKEN TOGETHER WITH THE ENTRY ABOVE, the state of rejoin on this build is: a socket that comes back inside the grace window reclaims its seat; a client that has to dial the room again - a reload, a killed tab, the phone screen the developer\'s report was about - is refused.`,
  },
  {
    id: 'a0-131-the-lobby-the-guest-sees-before-the-match',
    title: 'The roster, the ready state and the map pick as the GUEST sees them - two-column roster, host-only chips dimmed, MAP - HOST\'S, WAITING FOR THE HOST',
    area: 'online',
    image: 'images/a0-131-lobby-host-and-guest.png',
    verdict: 'verified',
    attestation:
      `${RIG} BRIEF ITEM 5. Top, the HOST\'s lobby at 1280x800: CREW MUSTER, JOIN CODE C7TV, the three chips MODE - FFA / YIELD - SCARCE / VISIBILITY - PUBLIC, a single-column roster with "P1 YOU * -4ms" and "P2 PLAYER 2 -5ms" both marked TAKEN over six OPEN rows, SHIP - CHANGE and MAP - CHANGE panels on the right, "2 PLAYING - 0 BOTS" and a bright RUSH!. Middle, the GUEST\'s lobby at 798x384 at the same moment: the roster is laid out in TWO columns to fit the short screen, "P1 PLAYER 1 *" and "P2 YOU LVL 1", the MODE and YIELD chips are drawn DIMMED and there is no VISIBILITY chip at all, the panel header reads MAP - HOST\'S rather than MAP - CHANGE, and the foot carries "WAITING FOR THE HOST" beside a RUSH! whose label is grey rather than white. Bottom, 2x magnifications of the two map headers: "MAP - CHANGE" on the host and "MAP - HOST\'S" on the guest. ONE THING I CHECKED AND FOUND FINE: at full frame size the guest\'s "WAITING FOR THE HOST" looks as if the RUSH! plate is sitting on the last letter; magnified 2x it is not - the word ends and the plate\'s bevel begins after it, with clear space between.`,
  },
  {
    id: 'a0-131-no-claim-survives-on-any-online-screen',
    title: 'The word "claim" appears nowhere: 2,930 strings recorded as they were rasterised across thirteen screen-walks on both clients, zero hits, with the strings that DID ship in that slot as the control',
    area: 'online',
    image: 'images/a0-131-no-claim-on-any-online-screen.png',
    verdict: 'verified',
    attestation:
      `${RIG} BRIEF ITEM 5, the half that is an ABSENCE and so cannot be settled by looking at a screenshot and not noticing something. Every visible word in this game is a Pixi Text rasterised through a 2D canvas, so both clients ran with the canvas patched ahead of the bundle (evidence/a0-131-online-with-eyes/words.mjs, lifted from a0-111) and every string was recorded at the moment it became pixels. a0-111 paid for the trap this avoids: the game letter-spaces its type and a canvas context cannot, so Pixi draws ONE CHARACTER PER fillText CALL and a naive recorder returns an alphabet - a hunt over that comes back clean on a screen that is shouting the word. Runs are rejoined per canvas and measureText is kept beside them as a second opinion. THE WALK: main menu, doors, host lobby, JOIN browse, JOIN keypad, guest lobby, host lobby with two humans, map picker, ship picker and the match, on host and joiner as applicable - thirteen screen-captures, 2,930 distinct strings. "claim", case-insensitive, over both lists: ZERO. THE CONTROL, which is what makes the zero worth anything: the same recorder caught "VISIBILITY - PUBLIC" 4 times, "MAP - HOST\'S" 16 times, "MAP - CHANGE" and "MAP SELECT" - it was demonstrably able to see the strings that occupy the slots a0-108 renamed. The plate shows those strings at magnification. LIMITS, stated: this is a census of the screens this walk reached, not a proof about screens nobody opened, and it sees text rather than pictures - a word baked into an image asset is invisible to it.`,
  },
  {
    id: 'a0-131-a-bots-only-online-match-says-nobody-joined-playing-locally',
    title: 'The developer\'s question answered on screen: starting an online room with only bots gives you a real listed room, and then a banner reading "NOBODY JOINED - PLAYING LOCALLY"',
    area: 'online',
    image: 'images/a0-131-bots-only-online-match.png',
    verdict: 'verified',
    attestation:
      `${RIG} BRIEF ITEM 6 - "the developer asked whether starting one with only bots still puts them online." BEFORE RUSH the room is online in every way a player can see. Top pane: CREW MUSTER, JOIN CODE W7DS, VISIBILITY - PUBLIC, and three seats cycled to BOT by PRESSING the drawn seat-state control at the physical point the seam reports (never by calling a lever) - "P2 Rusty HAULER EASY", "P3 Bolt INTERCEPTOR EASY", "P4 Foreman EXCAVATOR MEDIUM", each with a ? beside it - four OPEN below, "1 PLAYING - 3 BOTS", and the build badge reading "01a8353 - 4d891e33 (iad)", naming the Machine. Bottom left: a SECOND client on the phone profile, which had never been told the code, opened JOIN - BROWSE and the room is in the list - one row, "1 PLAYER - 4 SEATS OPEN - FFA", VIRGINIA, with a live JOIN button. So the room is real, placed on a Machine, and joinable by a stranger. AFTER RUSH, bottom right and the magnified strip: a banner under the clock reading "NOBODY JOINED - PLAYING LOCALLY", with the build badge still naming the same Machine. THE ANSWER, in the game\'s own words: hosting with only bots creates a genuine online room that other people can find and join, and if nobody has joined by the time you press RUSH the client tells you it is running the match locally. The one thing on that screen that could be read two ways is the badge, which goes on naming a server on a frame that says the match is local; it is not wrong - the client did connect to that Machine to mint the room - but the two lines sit six hundred pixels apart saying different-sounding things.`,
  },
  {
    id: 'a0-131-the-browse-row-shows-an-owner-tag-not-the-join-code',
    title: 'Checked and NOT a defect: BROWSE headlines a six-character owner id where the lobby shows a four-character JOIN CODE, and the length difference is deliberate',
    area: 'online',
    image: 'images/a0-131-bots-only-online-match.png',
    verdict: 'verified',
    attestation:
      `${RIG} Recorded because it looks like a defect on the frames and is not, and the next sweep should not spend the time twice. On the JOIN - BROWSE list the row\'s headline is a SIX-character string ("YJ2B8R" in the item-1 run, "4CQCGF" in the item-6 run on the plate) while the host\'s own lobby displays a FOUR-character JOIN CODE for the same room ("C7TV", "W7DS"). Two screens naming one room with two different strings is exactly the shape of a real bug, so I read the source before writing it up: allocator/listing.ts says the developer asked that "a browse shouldn't show the room code, just the room owner id and location / ping", the row shows a derived owner tag instead, and the tag is deliberately SIX characters where a code is FOUR so that anyone who reads one off a row and types it into the CODE keypad is stopped rather than silently refused. The frames match that design: the row\'s own JOIN button is what carries the real handle, and pressing it is the supported path. VERIFIED as working-as-designed, and flagged only so the discrepancy is on the record as understood.`,
  },
];

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const kept = manifest.filter((e) => !e.id.startsWith('a0-131-'));
const merged = [...kept, ...ENTRIES.map((e) => ({ ...e, capturedAt: AT, buildSha: SHA }))];
writeFileSync(MANIFEST, `${JSON.stringify(merged, null, 2)}\n`);
console.log(`manifest: ${kept.length} kept + ${ENTRIES.length} a0-131 = ${merged.length}`);
for (const e of ENTRIES) console.log(`  ${e.verdict.padEnd(12)} ${e.id}`);
