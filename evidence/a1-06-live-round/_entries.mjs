/**
 * evidence/a1-06-live-round/_entries.mjs — the a1-06 round's attestations, and
 * the one-shot that appends them to `evidence/manifest.json`. OWNER: QA Manager.
 *
 * The manifest's shape and contract are untouched: same eight keys, same order,
 * items are ADDED and nothing already in it is re-graded. The four a1-05
 * verdicts stay exactly as they are — they are the honest record of what was
 * true on `7e175ac`, and this round is what is true on `e567af0`.
 *
 *   node evidence/a1-06-live-round/_entries.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = resolve(HERE, '..', 'manifest.json');

/**
 * The served sha, established BEFORE any shutter fired and re-read off every
 * page afterwards: `version.json` said `e567af0`, the in-frame badge said
 * `e567af0`, and the served bundle's own sourcemap carries source byte-identical
 * to `git show e567af0:<path>` for every file the two fixes touched.
 */
const SHA = 'e567af0';

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
  item(
    'a1-06-served-build-carries-both-fixes',
    'The gate: the build under the camera is the one with both fixes in it — proven from the served sourcemap, not from the badge',
    'boot',
    'images/a1-06-clean-boot-desktop-match.png',
    '2026-08-10T01:05:00Z',
    'verified',
    "Every other item in this round is worthless if the page does not carry #362 and #363, so this was settled first. THREE INDEPENDENT WITNESSES AGREE ON e567af0. (1) https://imaginethegames.github.io/planet-rush/version.json reads {\"sha\":\"e567af0\",\"time\":\"2026-08-10T00:53:24.250Z\"}. (2) The frame itself: the build badge in the bottom-left corner of this clean-boot match reads 'e567af0', and the online frames add the gameserver to it — 'e567af0 0800d5b6 (iad) 602ms'. (3) The one that does not take the build's word for anything: the client ships sourcemaps, so assets/index-C-UgMqNF.js.map was pulled (6.3 MB, 380 sources) and its `sourcesContent` — the ORIGINAL SOURCE of the code on the page — compared BYTE FOR BYTE against `git show e567af0:<path>`. All eight mapped files are identical: shell-lifetime.ts (3584 ch), match-boot.ts (12142), session.ts (50081), wire.ts (31468), loopback.ts (15709), main.ts (464785), match.ts (17027), constants.ts (88439). src/ui/shell-lifetime.ts is decisive on its own — it did not exist before #363, and the served page has it. TWO TRAPS, BOTH HIT BEFORE BEING UNDERSTOOD, recorded so nobody re-files them: FIRST, the bundle FILENAME is not a gate — vite.config.ts injects __BUILD_INFO__ with an ISO build TIME, so the content hash moves on every build even when source is identical; a local build of e567af0 emitted index-Fw38SFaJ.js while the site served index-C-UgMqNF.js, and that mismatch is the timestamp, not a stale deploy. SECOND, two files in the fixes' diffs CANNOT appear in a sourcemap: src/net/transport.ts declares only types (zero runtime exports, erased at compile time) and src/ui/index.ts is a pure re-export barrel (flattened by rollup). Both are reported as 'erased', not as failures. WHAT THIS FRAME ALSO SHOWS, incidentally: WAVE 1/5 · Outer Drift / NEXT 2:52 / MATCH 0:09, ORE 3, HOME 100/100, a 'Rusty (EASY)' nameplate and six ore-bearing asteroids. Reproducible: evidence/a1-06-live-round/verify-served-source.mjs, output committed as served-source-check.json.",
  ),

  item(
    'a1-06-wave-clock-180-offline',
    'a1-05-wave-clock-counts-150-not-180 is FIXED offline — the same moment that read NEXT 2:27 now reads 2:57',
    'hud',
    'images/a1-06-wave-clock-offline-004s.png',
    '2026-08-10T01:08:00Z',
    'verified',
    "The same real player path a1-05 walked, on the served e567af0: PLAY -> PLAY SOLO -> a lobby whose own chip reads 'YIELD · SCARCE' (visible top-right of the roster in a1-06-wave-clock-lobby.png, beside 'MODE · FFA', over eight seats reading TAKEN + 7x BOT, with '1 PLAYING · 7 BOTS' and the e567af0 badge) -> RUSH!. This crop is four seconds in: 'WAVE 1/5 · Outer Drift / NEXT 2:57 / MATCH 0:04'. THE ARITHMETIC, the way a1-05 did it: for wave 1 the HUD counts to waveTime(2) = the interval itself, so MATCH + NEXT IS the interval. 4 + 177 = 181. a1-05 read 4 + 147 = 151 at this exact moment. Two more readings from the same boot: MATCH 0:17 / NEXT 2:44 = 17 + 164 = 181, and MATCH 0:37 / NEXT 2:24 = 37 + 144 = 181. THE ONE-SECOND OFFSET IS NOT A BUG AND MUST NOT BE FILED AS ONE: formatClock does Math.ceil and BOTH fields go through it, so for any non-integer t the displayed pair reads one second high — which is exactly why a1-05's readings summed to 151 against a 150 s baseline rather than 150. The comparison is therefore apples-to-apples: 151 -> 181, i.e. the metronome moved from the 'standard' 150 to SCARCE's ratified 150 x 1.2 = 180. A SECOND, INDEPENDENT READING OF THE SAME NUMBER, from a separate boot: at MATCH 2:47 the clock still reads 'WAVE 1/5' with NEXT 0:14 (167 + 14 = 181). A 150 s world cannot do that — it would have flipped to WAVE 2/5 at MATCH 2:30, seventeen seconds earlier. The lobby seam reports abundance 'scarce' on every boot in this round, and zero page errors were logged during the capture.",
  ),

  item(
    'a1-06-wave-clock-180-online',
    '…and a1-05-wave-clock-150-in-an-online-match-too is FIXED as well — on a real gameserver, with the wave counter advancing at 180 s',
    'hud',
    'images/a1-06-wave-clock-online-guest-full.png',
    '2026-08-10T01:16:00Z',
    'verified',
    "The half that needed a protocol field, so the half most likely to still be wrong. Two clean-boot clients against the LIVE fleet: the host pressed PLAY -> CREATE A CLAIM and got room B7GW, the guest pressed PLAY -> JOIN and typed B-7-G-W on the drawn keypad and was welcomed into SEAT 1; the host's roster then read TAKEN·TAKEN·OPEN x6 with humanCount 2, and both lobbies reported abundance 'scarce'. The host RUSHed. This frame is the GUEST's, and its badge along the bottom edge reads 'e567af0 0800d5b6 (iad) 602ms' — the shipped sha, the machine id of the real fly.io gameserver, and a live round-trip. THE EARLY READING, against a1-05's: guest 'WAVE 1/5 · Outer Drift / NEXT 2:52 / MATCH 0:09' = 9 + 172 = 181, and the host's own frame at the same moment 'NEXT 2:48 / MATCH 0:13' = 13 + 168 = 181. a1-05 read 6 + 145 = 151 here. THE COUNTER ACTUALLY ADVANCES ON THE NEW SCHEDULE, which is the part a clock reading alone cannot show: at MATCH 2:28 the guest still reads WAVE 1/5 (NEXT 0:33), at MATCH 2:37 still WAVE 1/5 (NEXT 0:24), at MATCH 2:58 still WAVE 1/5 (NEXT 0:03) — a 150 s world would have been on WAVE 2/5 since 2:30 — and by MATCH 3:08 it reads 'WAVE 2/5 · Far Belt', with NEXT 2:53 (188 + 173 = 361, i.e. 2 x 180). This frame at MATCH 3:27 / NEXT 2:34 gives 207 + 154 = 361 again. So the second wave landed at ~180 s, not 150, and the third is being counted to 360. WHY THIS IS THE SERVER'S NUMBER AND NOT A CLIENT GUESS: the guest is not the host and never chose an abundance; the only way its world can be built at SCARCE is for the room's level to have crossed the wire. WHAT THIS FRAME DOES NOT PROVE: I did not photograph the rocks of wave 2 physically appearing. The wave counter is computed from the clock, so what is shown here is the schedule the server and both clients agree on, not a rock arriving in view — asteroids ARE visible in this frame (a belt of ore-bearing rocks down the right-hand side) but I cannot show from these frames which of them wave 2 delivered. Zero page errors were logged across both clients for the whole match.",
  ),

  item(
    'a1-06-clean-boot-typeerror-gone',
    'a1-05-clean-boot-typeerror is FIXED — six clean boots, zero uncaught errors, and a control proving the recorder still catches one',
    'boot',
    'images/a1-06-clean-boot-desktop-match.png',
    '2026-08-10T01:19:00Z',
    'verified',
    "a1-05 logged exactly ONE uncaught 'TypeError: Cannot read properties of null (reading \"clear\")' in every one of six clean-boot sessions on 7e175ac. The same shape was repeated on e567af0: six clean boots, three on desktop 1280x800 and three on a 390x844 phone (deviceScaleFactor 3, hasTouch), each walked to a different depth — doors, lobby, and into a match — with the generous idles a1-05 used (6 s on the menu, 3 s on the doors, 4 s in the lobby, 8 s in the match). Every session recorded both `pageerror` and console-error. THE TOTAL ACROSS ALL SIX SESSIONS IS ZERO. Per session: desktop-doors 0, desktop-lobby 0, desktop-match 0, phone-doors 0, phone-lobby 0, phone-match 0; all six re-read the served sha as e567af0, and the three that reached a lobby all read abundance 'scarce'. ZERO IS ONLY WORTH REPORTING IF THE RECORDER WAS LIVE, and a recorder that was never wired up reports zero too — so the shot ends with a CONTROL: a seventh clean boot, settled exactly like the others, is handed a deliberate uncaught TypeError thrown from a setTimeout callback (off the boot stack, where the original came from). It was caught, and the string the sink captured is 'Cannot read properties of null (reading \\'clear\\')' — the a1-05 message verbatim. So the harness that reports zero for the shipped client is demonstrably capable of catching precisely the error a1-05 saw. This frame is the desktop-match session at the moment it was shot: the match is up and drawing normally, badge e567af0 bottom-left, 'WAVE 1/5 · Outer Drift / NEXT 2:52 / MATCH 0:09', ORE 3, HOME 100/100, and nothing anywhere on it is broken. Raw per-session counts and the control are in evidence/a1-06-live-round/readback.json under 'clean-boot-errors'.",
  ),
  item(
    'a1-06-wave-2-rocks-actually-arrive-at-180',
    'The rocks, not just the counter: new asteroids appear on a server-authoritative client at 180 s, not 150',
    'match',
    'images/a1-06-wave-arrival-field-guest-192s.png',
    '2026-08-10T01:52:00Z',
    'verified',
    "The brief's sharpest worry: 'a client predicting 180 against a server spawning at 150 would be worse than the old honest 150'. The wave COUNTER cannot settle that — 'WAVE n/5' is computed from the clock, so a mispredicting client would draw exactly the same words. Asteroids can settle it: in an online match they are server-authoritative entities streamed to the client, so rocks appearing is the SERVER's testimony about when it spawned. Room B38B on the live fleet, host + guest, both clean boots, guest badge 'e567af0 0800d5b6 (iad) 589ms', both lobbies reading abundance 'scarce'. Six full frames of the GUEST's view across the boundary, all with the ship parked so the camera never moves. WHAT THE FRAMES SHOW: at MATCH 2:48 'WAVE 1/5 · Outer Drift / NEXT 0:13' (168 + 13 = 181), a field of ore-bearing rocks down the right-hand side; at MATCH 3:00 'WAVE 1/5 / NEXT 0:01' — one second out, and the field is unchanged (a diff against the 2:48 frame moves 906 pixels in the whole 2560x1600 image, all of it the clock's own digits); at MATCH 3:15 'WAVE 2/5 · Far Belt / NEXT 2:46' (195 + 166 = 361 = 2 x 180) and THE FIELD IS VISIBLY FULLER — the upper-right cluster has thickened and a new rock sits at the lower-right edge. COUNTED RATHER THAN EYEBALLED, taking connected bodies over 1,500 px in the right-hand field: the MATCH 3:00 frame holds 5 rock bodies totalling 33,804 lit pixels, and the MATCH 3:15 frame holds 6 totalling 49,150 — one more body and half again as much rock. THE MEASUREMENT BEHIND THE EYE, counting pixels that are dark in the earlier frame and lit in the later one, HUD text row excluded: 140->165 s adds 64 new lit pixels in the play field, 165->178 adds 33, 192->205 adds 33, 205->225 adds 72 — a noise floor of a few dozen. The step that brackets the boundary, 178->192 s, adds 23,606. That is roughly 300x every other interval, and it lands between the frame that reads NEXT 0:01 and the frame that reads WAVE 2/5. So the second wave was DELIVERED at ~180 s by the authority that owns the asteroids, and the clock was not merely counting to a number the server disagreed with. ONE CORRECTION TO THE RECORD, kept because it matters: the capture's own inline `rockInkPct` first reported the step one frame earlier, because it took a SECOND screenshot for the measurement about a second after the one it saved, and the wave landed in that gap. The frames were right and the number beside them was not; the camera now measures exactly the bytes it commits, and the figures quoted here are recomputed from the committed PNGs by analyse-arrival.mjs (output: arrival-analysis.json). Zero page errors across both clients.",
  ),

  item(
    'a1-06-match-length-holds-the-10-15-rail',
    'A whole SCARCE match, played to its end for the first time: collapse at 12:30, resolved inside the 10–15 minute rail',
    'match',
    'images/a1-06-match-length-end-settled.png',
    '2026-08-10T01:26:00Z',
    'verified',
    "The risk the fix introduces, and nobody had ever played a 180 s SCARCE match to its end. PLAY -> PLAY SOLO under 'YIELD · SCARCE' (seam: abundance 'scarce') -> RUSH!, then the HUD clock strip polled every 15 s for the whole match on served e567af0. THE WAVES RAN ON THE NEW METRONOME ALL THE WAY DOWN, each crop's own arithmetic checkable: MATCH 1:01 / NEXT 2:00 = 181; MATCH 5:04 'WAVE 2/5 · Far Belt' / NEXT 0:57 = 361; MATCH 7:09 'WAVE 3/5 · Mid Field' / NEXT 1:52 = 541; MATCH 9:25 'WAVE 4/5 · Inner Ring' / NEXT 2:36 = 721; MATCH 11:42 / NEXT 0:19 = 721 again, i.e. the fifth and last wave due at 12:01 = 4 x 180. THE COLLAPSE HELD THE RAIL: by MATCH 12:50 the strip reads 'WAVE 5/5 · Claim Fall' with the middle line replaced by 'COLLAPSE' in threat red, and it did not read COLLAPSE at MATCH 11:42 — so the deadline fired between them, which is where `collapseDeadline`'s re-anchoring puts it (750 s = 12:30: the 180 s interval pushes the last wave out to 720 s but the deadline is anchored, not dragged). The match then resolved: the last frame with a live clock is MATCH 12:50, and 68 s of wall clock later the strip is blank and the result screen is up. So the match ended between MATCH 12:50 and roughly 13:58 — INSIDE the ratified 10–15 minute rail, with a minute or so to spare. THE RESULT SCREEN, looked at: 'CLAIM LOST' over 'Player 8 took the claim.', 'MATCH TIME · 05:12', a stat column of all zeroes (ORE MINED 0, DAMAGE DEALT 0 HP, SHIPS DESTROYED 0, DISTANCE TRAVELLED 0, SHIPS USED 2), '+50 XP', 'LEVEL 1', REMATCH and BACK TO MENU, badge e567af0. TWO THINGS THAT WOULD OTHERWISE BE MISREAD. FIRST, 'MATCH TIME · 05:12' is NOT the match's length — it is this client's own time in it. The ship was never piloted, so it was ELIMINATED ('7th of 8 — your reactor was destroyed') at a poll 20 s after the crop reading MATCH 5:04, and 5:12 sits inside that window; the camera then took SPECTATE and watched the remaining eight minutes. An earlier run of this shot stopped at the elimination and would have filed 'SCARCE matches run SHORT of the rail', which was flatly wrong. SECOND, the WALL clock for this run was 946 s, longer than the sim's ~830: the headless client accumulated about 96 s of lag while other captures in this round were running beside it, and once they finished the clock tracked real time exactly (four consecutive 68 s wall intervals each advanced MATCH by 68 s, from 8:17 to 12:50). The in-sim MATCH clock is the number the rail is about and the number reported here. SCOPE, honestly: this is ONE match, solo/offline, with an unpiloted local ship and seven bots. It shows the schedule and the collapse deadline behaving on a real 180 s world; it does not characterise a lobby of eight humans.",
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
